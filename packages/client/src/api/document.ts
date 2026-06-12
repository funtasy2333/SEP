import axios from 'axios'
import type { DocumentMeta } from '@ses/shared'

const api = axios.create({
  baseURL: '/api',
})

export interface DocumentData {
  id?: number
  title: string
  meta: DocumentMeta
  stage: string
  content: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export const documentApi = {
  list() {
    return api.get<DocumentData[]>('/documents')
  },
  get(id: number) {
    return api.get<DocumentData>(`/documents/${id}`)
  },
  create(data: Partial<DocumentData>) {
    return api.post<DocumentData>('/documents', data)
  },
  update(id: number, data: Partial<DocumentData>) {
    return api.put<DocumentData>(`/documents/${id}`, data)
  },
  delete(id: number) {
    return api.delete(`/documents/${id}`)
  },
}
