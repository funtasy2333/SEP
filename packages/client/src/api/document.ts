import axios from 'axios'
import type { DocumentMeta } from '@ses/shared'

const api = axios.create({
  baseURL: '/api',
})

export interface DocumentData {
  id?: number
  /** 服务端稳定文档身份；本地未持久化对象可能暂时没有该字段。 */
  uid?: string | null
  title: string
  meta: DocumentMeta
  stage: string
  content: Record<string, unknown>
  /** 修订号（乐观锁）：服务端每次写入加 1；更新时作为 baseRevision 提交 */
  revision: number
  createdAt?: string
  updatedAt?: string
}

/** 回收站摘要，不包含正文与版本列表。 */
export interface TrashDocumentData {
  id: number
  title: string
  meta: DocumentMeta
  stage: string
  revision: number
  deletedAt: string
}

/** 更新文档的请求体：baseRevision 必填（取自上一次读取或写入响应里的 revision），其余只带要修改的字段。 */
export type DocumentUpdateData = Partial<Pick<DocumentData, 'title' | 'meta' | 'stage' | 'content'>> & {
  baseRevision: number
}

export const SES_PACKAGE_MIME = 'application/vnd.ses-package+json'

export interface SesExportWarning {
  code: string
  nodeId?: string
  message: string
}

export interface SesPackageExport {
  blob: Blob
  warningCount: number
  warnings: SesExportWarning[]
  warningsTruncated: boolean
}

export interface SesImportPreview {
  match: { id: number; title: string; revision: number } | null
  inTrash: boolean
  newVersions: number
  localOnlyVersions: number
  contentDiffers: boolean
  /** update 时是否会先把本地正文存为自动快照（本地正文已在版本历史中时不建）。 */
  createsSnapshot: boolean
  versionNoCollisions: string[]
}

export type SesImportFile = File | Blob | ArrayBuffer

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const candidate = headers as { get?: (header: string) => unknown }
  const fromGetter = candidate.get?.(name)
  if (typeof fromGetter === 'string') return fromGetter
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase())
  const value = key ? (headers as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function parseExportWarnings(raw: string | undefined): SesExportWarning[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is SesExportWarning =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as SesExportWarning).code === 'string'
      && typeof (entry as SesExportWarning).message === 'string',
    )
  } catch {
    return []
  }
}

async function readableExportError(error: unknown): Promise<Error> {
  const response = typeof error === 'object' && error !== null
    ? (error as { response?: { data?: unknown } }).response
    : undefined
  const data = response?.data
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const text = await data.text().catch(() => '')
    try {
      const message = readableMessage(JSON.parse(text))
      if (message) return new Error(message)
    } catch {
      if (text.trim()) return new Error(text)
    }
  }
  const message = readableMessage(data)
    ?? (error instanceof Error && error.message ? error.message : 'SES 文档包导出失败')
  return new Error(message)
}

function readableMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (Array.isArray(value)) {
    const parts = value.map(readableMessage).filter((entry): entry is string => Boolean(entry))
    return parts.length ? parts.join('；') : undefined
  }
  if (typeof value === 'object' && value !== null && 'message' in value) {
    return readableMessage((value as { message?: unknown }).message)
  }
  return undefined
}

async function postSesImport<T>(file: SesImportFile, query: string): Promise<T> {
  const { data } = await api.post<T>(`/documents/import/ses?${query}`, file, {
    headers: { 'Content-Type': SES_PACKAGE_MIME },
  })
  return data
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
  listTrash() {
    return api.get<TrashDocumentData[]>('/documents/trash')
  },
  restore(id: number) {
    return api.post<DocumentData>(`/documents/${id}/restore`)
  },
  permanentDelete(id: number, baseRevision: number) {
    return api.delete(`/documents/${id}/permanent`, { data: { baseRevision } })
  },
  emptyTrash(documents: Array<{ id: number; revision: number }>) {
    return api.post('/documents/trash/empty', { documents })
  },
  async exportSesPackage(id: number): Promise<SesPackageExport> {
    try {
      const { data, headers } = await api.get<Blob>(`/documents/${id}/export/ses`, { responseType: 'blob' })
      const rawCount = Number(headerValue(headers, 'X-SES-Export-Warning-Count'))
      return {
        blob: data,
        warningCount: Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : 0,
        warnings: parseExportWarnings(headerValue(headers, 'X-SES-Export-Warnings')),
        warningsTruncated: headerValue(headers, 'X-SES-Export-Warnings-Truncated')?.toLowerCase() === 'true',
      }
    } catch (error) {
      throw await readableExportError(error)
    }
  },
  async previewSesImport(file: SesImportFile): Promise<SesImportPreview> {
    return postSesImport<SesImportPreview>(file, 'mode=preview')
  },
  async importSesPackage(
    file: SesImportFile,
    mode: 'new' | 'update',
    target?: { targetId: number; baseRevision: number },
  ): Promise<DocumentData> {
    const query = new URLSearchParams({ mode })
    if (target) {
      query.set('targetId', String(target.targetId))
      query.set('baseRevision', String(target.baseRevision))
    }
    return postSesImport<DocumentData>(file, query.toString())
  },
}
