import { defineStore } from 'pinia'
import { ref } from 'vue'
import { documentApi, type DocumentData } from '@/api/document'

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

  async function updateDocument(id: number, doc: Partial<DocumentData>) {
    const { data } = await documentApi.update(id, doc)
    currentDocument.value = data
    const idx = documents.value.findIndex((d) => d.id === id)
    if (idx !== -1) documents.value[idx] = data
    return data
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
