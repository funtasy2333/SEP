import { defineStore } from 'pinia'
import { ref } from 'vue'
import { documentApi, type DocumentData, type DocumentUpdateData, type TrashDocumentData } from '@/api/document'

/** {@link useDocumentStore} 的 runDocumentWrite 交给 task 的写文档函数：此刻读取 revision 直接请求，不排队。 */
export type DocumentPut = (doc: Omit<DocumentUpdateData, 'baseRevision'>) => Promise<DocumentData>

export const useDocumentStore = defineStore('document', () => {
  const documents = ref<DocumentData[]>([])
  const currentDocument = ref<DocumentData | null>(null)
  const loading = ref(false)
  const trashDocuments = ref<TrashDocumentData[]>([])
  const trashLoading = ref(false)
  const unavailableDocuments = ref(new Set<number>())

  // In-flight list reads must not replace state after a newer read or local mutation.
  let documentListGeneration = 0
  let documentListEpoch = 0
  let trashListGeneration = 0
  let trashListEpoch = 0
  const documentAvailabilityGeneration = new Map<number, number>()

  async function fetchDocuments() {
    const generation = ++documentListGeneration
    const epoch = documentListEpoch
    loading.value = true
    try {
      const { data } = await documentApi.list()
      if (generation === documentListGeneration && epoch === documentListEpoch) documents.value = data
    } finally {
      if (generation === documentListGeneration) loading.value = false
    }
  }

  async function fetchDocument(id: number) {
    const availabilityGeneration = documentAvailabilityGeneration.get(id) ?? 0
    loading.value = true
    try {
      const { data } = await documentApi.get(id)
      // A read started before a delete/404 must not revive a stale editor when it resolves late.
      if ((documentAvailabilityGeneration.get(id) ?? 0) !== availabilityGeneration) return
      currentDocument.value = data
      unavailableDocuments.value.delete(id)
      const index = documents.value.findIndex((entry) => entry.id === id)
      if (index < 0) documents.value.unshift(data)
      else documents.value[index] = data
    } finally {
      loading.value = false
    }
  }

  /**
   * 读取服务端最新的文档，但不改动 currentDocument。
   * 感知到外部修改时先读取、校验，确认能载入编辑器后才用 {@link adoptDocument} 安装：
   * 若直接 fetchDocument，读到的内容装不进编辑器时本地 revision 已前进，之后的保存会静默覆盖外部修改。
   */
  async function readDocument(id: number): Promise<DocumentData> {
    try {
      const { data } = await documentApi.get(id)
      return data
    } catch (error) {
      if (isNotFoundError(error)) markDocumentUnavailable(id)
      throw error
    }
  }

  /**
   * 把已读取（并已装入编辑器）的最新文档安装为当前文档。只前进不后退：
   * revision 不大于本地记录时忽略，避免较早发出的读取覆盖了之后保存得到的更新。
   */
  function adoptDocument(doc: DocumentData): boolean {
    const current = currentDocument.value
    if (!current || doc.id !== current.id || doc.revision <= current.revision) return false
    currentDocument.value = doc
    const idx = documents.value.findIndex((d) => d.id === doc.id)
    if (idx !== -1) documents.value[idx] = doc
    return true
  }

  /**
   * 只前移本地修订号，不改内容。用于确认「期间只有 system 写入（补齐 nodeId，语义不变）」的情形：
   * 本地内容仍然有效，只是 baseRevision 需要追上，否则下一次保存会无谓地 409。
   */
  function adoptRevision(id: number, revision: number): boolean {
    const current = currentDocument.value
    if (!current || current.id !== id || revision <= current.revision) return false
    current.revision = revision
    const entry = documents.value.find((d) => d.id === id)
    if (entry && entry.revision < revision) entry.revision = revision
    return true
  }

  async function createDocument(doc: Partial<DocumentData>) {
    const { data } = await documentApi.create(doc)
    documentListEpoch += 1
    documents.value.unshift(data)
    return data
  }

  async function fetchTrash() {
    const generation = ++trashListGeneration
    const epoch = trashListEpoch
    trashLoading.value = true
    try {
      const { data } = await documentApi.listTrash()
      if (generation === trashListGeneration && epoch === trashListEpoch) trashDocuments.value = data
    } finally {
      if (generation === trashListGeneration) trashLoading.value = false
    }
  }

  function isDocumentUnavailable(id: number): boolean {
    return unavailableDocuments.value.has(id)
  }

  function markDocumentUnavailable(id: number): void {
    documentAvailabilityGeneration.set(id, (documentAvailabilityGeneration.get(id) ?? 0) + 1)
    unavailableDocuments.value.add(id)
  }

  function isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const response = (error as { response?: unknown }).response
    if (typeof response !== 'object' || response === null) return false
    return (response as { status?: unknown }).status === 404
  }

  // 同一文档的写入排队执行：后一个请求等前一个结束后才读取 revision，
  // 这样设置保存、正文自动保存、版本保存先后发生时总是带上上一次响应里的最新值，不会与自己冲突。
  const pendingUpdates = new Map<number, Promise<void>>()

  /** 在写入队列里发出一次 PUT：此刻才读取 baseRevision，不再排队（只能在 {@link runDocumentWrite} 的 task 内使用）。 */
  async function putDocument(id: number, doc: Omit<DocumentUpdateData, 'baseRevision'>): Promise<DocumentData> {
    if (isDocumentUnavailable(id)) {
      throw new Error('文档已不可用，请返回标准库并在恢复后重新打开')
    }
    const baseRevision = currentDocument.value?.id === id ? currentDocument.value.revision : undefined
    if (typeof baseRevision !== 'number') {
      throw new Error('无法确定文档的修订号，请重新打开文档后再保存')
    }
    let data: DocumentData
    try {
      ({ data } = await documentApi.update(id, { ...doc, baseRevision }))
    } catch (error) {
      if (isNotFoundError(error)) markDocumentUnavailable(id)
      throw error
    }
    currentDocument.value = data
    documentListEpoch += 1
    const idx = documents.value.findIndex((d) => d.id === id)
    if (idx !== -1) documents.value[idx] = data
    return data
  }

  /**
   * 把一段包含多个步骤的本地写入登记为该文档的一次进行中的写入：排在已有写入之后执行，
   * 期间 {@link waitForPendingUpdates} 不会返回，编辑器据此推迟处理外部修改，本地 revision 不会被中途前移。
   *
   * 适用于「先做别的异步操作（如保存版本快照），再写文档」的流程：需要写入的内容应在 task 里（轮到这次写入时）
   * 才读取，保证拿到的是最新的本地内容；task 里用传入的 `put` 发出 PUT，它此刻读取 revision 并直接请求。
   * 此时若别处已写入文档，PUT 会得到 409（本地记录保持不变），由 task 的调用方处理冲突。
   *
   * 注意：task 里不能再调用 updateDocument / runDocumentWrite（它们要排在 task 之后，会等待 task 自己而死锁），
   * 只能通过 `put` 写文档；task 结束后 `put` 失效。task 抛错只让这一次失败，队列照常继续。
   */
  function runDocumentWrite<T>(id: number, task: (put: DocumentPut) => Promise<T> | T): Promise<T> {
    const run = async () => {
      if (isDocumentUnavailable(id)) {
        throw new Error('文档已不可用，请返回标准库并在恢复后重新打开')
      }
      let active = true
      const put: DocumentPut = (doc) => {
        if (!active) return Promise.reject(new Error('写入任务已结束，不能再通过它写文档'))
        return putDocument(id, doc)
      }
      try {
        return await task(put)
      } finally {
        active = false
      }
    }
    const result = (pendingUpdates.get(id) ?? Promise.resolve()).then(run)
    const settled = result.then(() => undefined, () => undefined)
    pendingUpdates.set(id, settled)
    void settled.then(() => {
      if (pendingUpdates.get(id) === settled) pendingUpdates.delete(id)
    })
    return result
  }

  /**
   * 更新文档。baseRevision 取本地已知的最新 revision（打开文档或上一次写入的响应），
   * 服务端与当前 revision 不一致时返回 409，此时本地记录保持不变，由调用方处理冲突。
   */
  function updateDocument(id: number, doc: Omit<DocumentUpdateData, 'baseRevision'>): Promise<DocumentData> {
    return runDocumentWrite(id, (put) => put(doc))
  }

  /** 该文档是否有排队或进行中的写入（同步判断，用于在不能等待的地方识别「本地写入正在进行」）。 */
  function hasPendingUpdates(id: number): boolean {
    return pendingUpdates.has(id)
  }

  /**
   * 等待该文档所有已排队和进行中的写入结束（无论成功或失败）。
   * 编辑器自己的保存会在响应返回前就从变更推送里收到对应事件，必须等写入落定、本地 revision 更新之后
   * 再判断一个事件是不是「别人的修改」。
   */
  async function waitForPendingUpdates(id: number): Promise<void> {
    for (let pending = pendingUpdates.get(id); pending; pending = pendingUpdates.get(id)) {
      await pending
    }
  }

  async function deleteDocument(id: number) {
    await documentApi.delete(id)
    markDocumentUnavailable(id)
    documentListEpoch += 1
    trashListEpoch += 1
    documents.value = documents.value.filter((d) => d.id !== id)
    // Keep the current snapshot available to an open editor so it can preserve unsaved text,
    // while the unavailable marker prevents every queued or future write from using it.
  }

  async function restoreDocument(id: number): Promise<DocumentData> {
    const { data } = await documentApi.restore(id)
    trashListEpoch += 1
    trashDocuments.value = trashDocuments.value.filter((entry) => entry.id !== id)
    documentListEpoch += 1
    const index = documents.value.findIndex((entry) => entry.id === id)
    if (index < 0) documents.value.unshift(data)
    else documents.value[index] = data
    // Do not revive an old editor here. A deliberate fetchDocument on a reopened page
    // is the only operation that clears its unavailable marker and adopts the new revision.
    return data
  }

  async function permanentlyDeleteDocument(id: number, revision: number): Promise<void> {
    await documentApi.permanentDelete(id, revision)
    trashListEpoch += 1
    trashDocuments.value = trashDocuments.value.filter(
      (entry) => entry.id !== id || entry.revision !== revision,
    )
  }

  async function emptyTrash(snapshot: Array<{ id: number; revision: number }> = trashDocuments.value.map(
    ({ id, revision }) => ({ id, revision }),
  )): Promise<void> {
    const confirmed = snapshot.map((entry) => ({ ...entry }))
    await documentApi.emptyTrash(confirmed)
    trashListEpoch += 1
    const revisions = new Map(confirmed.map(({ id, revision }) => [id, revision]))
    trashDocuments.value = trashDocuments.value.filter(
      (entry) => revisions.get(entry.id) !== entry.revision,
    )
  }

  return {
    documents,
    currentDocument,
    loading,
    trashDocuments,
    trashLoading,
    fetchDocuments,
    fetchDocument,
    fetchTrash,
    readDocument,
    adoptDocument,
    adoptRevision,
    createDocument,
    isDocumentUnavailable,
    markDocumentUnavailable,
    updateDocument,
    runDocumentWrite,
    hasPendingUpdates,
    waitForPendingUpdates,
    deleteDocument,
    restoreDocument,
    permanentlyDeleteDocument,
    emptyTrash,
  }
})
