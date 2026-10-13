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
  /** 修订号（乐观锁）：服务端每次写入加 1；更新时作为 baseRevision 提交 */
  revision: number
  createdAt?: string
  updatedAt?: string
}

/** 更新文档的请求体：baseRevision 必填（取自上一次读取或写入响应里的 revision），其余只带要修改的字段。 */
export type DocumentUpdateData = Partial<Pick<DocumentData, 'title' | 'meta' | 'stage' | 'content'>> & {
  baseRevision: number
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
  /** 与当前 revision 不一致时服务端返回 409（响应体含最新 revision），缺少 baseRevision 返回 428 */
  update(id: number, data: DocumentUpdateData) {
    return api.put<DocumentData>(`/documents/${id}`, data)
  },
  delete(id: number) {
    return api.delete(`/documents/${id}`)
  },
}
