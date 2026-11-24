import axios from 'axios'
import type {
  CoverLayoutConfig,
  DocumentStage,
  StandardTemplate,
  StandardType,
  TemplateDefaultMeta,
} from '@ses/shared'
import type { DocumentOperation } from '@ses/io'

const api = axios.create({
  baseURL: '/api',
})

export const SES_TEMPLATE_MIME = 'application/vnd.ses-template+json'

export interface CreateTemplateRequest {
  name: string
  description?: string
  baseType?: StandardType
  defaultStage?: DocumentStage
  defaultMeta?: TemplateDefaultMeta
  coverLayout?: CoverLayoutConfig
  content?: Record<string, unknown>
  fromDocumentId?: number
  fromTemplateId?: string | number
}

export interface UpdateTemplateRequest {
  baseRevision: number
  name?: string
  description?: string
  baseType?: StandardType
  defaultStage?: DocumentStage
  defaultMeta?: TemplateDefaultMeta
  coverLayout?: CoverLayoutConfig | null
  content?: Record<string, unknown>
}

export interface TemplateImportPayload {
  uid: string
  name: string
  description: string
  baseType: StandardType
  defaultStage: DocumentStage
  defaultMeta: TemplateDefaultMeta
  coverLayout?: CoverLayoutConfig
  content: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface TemplateImportPreview {
  status: 'new' | 'match'
  incoming: TemplateImportPayload
  existing: StandardTemplate | null
}

export const templateApi = {
  eventsUrl(): string {
    return '/api/templates/events'
  },
  list() {
    return api.get<StandardTemplate[]>('/templates')
  },
  get(id: string | number) {
    return api.get<StandardTemplate>(`/templates/${encodeURIComponent(String(id))}`)
  },
  create(data: CreateTemplateRequest) {
    return api.post<StandardTemplate>('/templates', data)
  },
  createFromDocument(documentId: number, data: { name: string; description?: string }) {
    return api.post<StandardTemplate>(`/templates/from-document/${documentId}`, data)
  },
  update(id: number, data: UpdateTemplateRequest) {
    return api.put<StandardTemplate>(`/templates/${id}`, data)
  },
  remove(id: number) {
    return api.delete(`/templates/${id}`)
  },
  revert(id: number, baseRevision: number) {
    return api.post<StandardTemplate>(`/templates/${id}/revert`, { baseRevision })
  },
  applyOperations(id: number, baseRevision: number, operations: DocumentOperation[]) {
    return api.post<{
      template: StandardTemplate
      revision: number
      operations: unknown[]
      problems: unknown[]
      warnings: unknown[]
    }>(`/templates/${id}/operations`, { baseRevision, operations, source: 'human' })
  },
  async exportPackage(id: string | number): Promise<Blob> {
    const { data } = await api.get<Blob>(`/templates/${encodeURIComponent(String(id))}/export`, {
      responseType: 'blob',
    })
    return data
  },
  async previewImport(file: File | Blob | ArrayBuffer): Promise<TemplateImportPreview> {
    const { data } = await api.post<TemplateImportPreview>('/templates/import?mode=preview', file, {
      headers: { 'Content-Type': SES_TEMPLATE_MIME },
    })
    return data
  },
  async importPackage(
    file: File | Blob | ArrayBuffer,
    mode: 'new' | 'update',
    target?: { targetId: number; baseRevision: number },
  ): Promise<StandardTemplate> {
    const query = new URLSearchParams({ mode })
    if (target) {
      query.set('targetId', String(target.targetId))
      query.set('baseRevision', String(target.baseRevision))
    }
    const { data } = await api.post<StandardTemplate>(`/templates/import?${query.toString()}`, file, {
      headers: { 'Content-Type': SES_TEMPLATE_MIME },
    })
    return data
  },
  async previewDocx(id: string | number): Promise<Blob> {
    const { data } = await api.post<Blob>(
      `/templates/${encodeURIComponent(String(id))}/preview/docx`,
      {},
      { responseType: 'blob' },
    )
    return data
  },
  async previewPdf(id: string | number): Promise<Blob> {
    const { data } = await api.post<Blob>(
      `/templates/${encodeURIComponent(String(id))}/preview/pdf`,
      {},
      { responseType: 'blob' },
    )
    return data
  },
}
