import { defineStore } from 'pinia'
import { ref } from 'vue'
import { documentApi, type DocumentData, type DocumentUpdateData } from '@/api/document'

export const useDocumentStore = defineStore('document', () => {
  const documents = ref<DocumentData[]>([])
  const currentDocument = ref<DocumentData | null>(null)
  const loading = ref(false)

  async function fetchDocuments() {
    loading.value = true
    try {
      const { data } = await documentApi.list()
      documents.value = data
    } finally {
      loading.value = false
    }
  }

  async function fetchDocument(id: number) {
    loading.value = true
    try {
      const { data } = await documentApi.get(id)
      currentDocument.value = data
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
    const { data } = await documentApi.get(id)
    return data
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
    documents.value.unshift(data)
    return data
  }

  // 同一文档的写入排队执行：后一个请求等前一个结束后才读取 revision，
  // 这样设置保存、正文自动保存、版本保存先后发生时总是带上上一次响应里的最新值，不会与自己冲突。
  const pendingUpdates = new Map<number, Promise<void>>()

  /**
   * 更新文档。baseRevision 取本地已知的最新 revision（打开文档或上一次写入的响应），
   * 服务端与当前 revision 不一致时返回 409，此时本地记录保持不变，由调用方处理冲突。
   */
  function updateDocument(id: number, doc: Omit<DocumentUpdateData, 'baseRevision'>): Promise<DocumentData> {
    const run = async () => {
      const baseRevision = currentDocument.value?.id === id ? currentDocument.value.revision : undefined
      if (typeof baseRevision !== 'number') {
        throw new Error('无法确定文档的修订号，请重新打开文档后再保存')
      }
      const { data } = await documentApi.update(id, { ...doc, baseRevision })
      currentDocument.value = data
      const idx = documents.value.findIndex((d) => d.id === id)
      if (idx !== -1) documents.value[idx] = data
      return data
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
    documents.value = documents.value.filter((d) => d.id !== id)
    if (currentDocument.value?.id === id) {
      currentDocument.value = null
    }
  }

  return {
    documents,
    currentDocument,
    loading,
    fetchDocuments,
    fetchDocument,
    readDocument,
    adoptDocument,
    adoptRevision,
    createDocument,
    updateDocument,
    waitForPendingUpdates,
    deleteDocument,
  }
})
