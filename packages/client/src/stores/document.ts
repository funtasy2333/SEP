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
    createDocument,
    updateDocument,
    deleteDocument,
  }
})
