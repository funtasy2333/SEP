import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

/** 版本来源：人工保存 / AI 写入 / 导入 */
export type VersionSource = 'human' | 'ai' | 'import'

export interface VersionData {
  id?: number
  documentId: number
  versionNo: string
  stage: string
  content: Record<string, unknown>
  xml?: string
  note?: string
  /** 版本来源；旧数据由服务端补为 human */
  source?: VersionSource
  /** 写入方标识（如 MCP 客户端名称），人工保存时为空 */
  client?: string | null
  createdAt?: string
}

export interface CreateVersionData {
  documentId: number
  versionNo: string
  stage: string
  content: Record<string, unknown>
  xml?: string
  note?: string
  source?: VersionSource
  client?: string | null
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
