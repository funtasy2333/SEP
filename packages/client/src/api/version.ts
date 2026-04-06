import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export interface VersionData {
  id?: number
  documentId: number
  versionNo: string
  stage: string
  content: Record<string, unknown>
  xml?: string
  note?: string
  createdAt?: string
}

export interface CreateVersionData {
  documentId: number
  versionNo: string
  stage: string
  content: Record<string, unknown>
  xml?: string
  note?: string
}

export const versionApi = {
  /** 获取文档的所有版本 */
  listByDocument(documentId: number) {
    return api.get<VersionData[]>(`/versions/document/${documentId}`)
  },
  /** 获取单个版本详情 */
  get(id: number) {
    return api.get<VersionData>(`/versions/${id}`)
  },
  /** 创建新版本 */
  create(data: CreateVersionData) {
    return api.post<VersionData>('/versions', data)
  },
}
