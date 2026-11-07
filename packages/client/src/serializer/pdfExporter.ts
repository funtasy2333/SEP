/**
 * PDF 出件请求构建器（薄壳）。
 *
 * IR→HTML→两遍构建管线的请求构建：
 *   ProseMirror 文档 → pmToIr → resolve → renderHtml(variant:'print') → print HTML + 目次目标
 *
 * WP9.2e 起请求构建迁入 @ses/io（目次目标不再依赖浏览器 DOMParser），由服务端按文档 id 导出 PDF
 * （GET /api/documents/:id/export/pdf）。编辑器的「导出 PDF」调用该接口，不再在浏览器里构建请求，
 * 也没有接受任意 HTML 的转换接口。本文件只把 Tiptap/ProseMirror 文档转为纯 JSON 并调用 io，
 * 保留 `buildPdfExportRequest(doc, meta)` 供测试和对照使用。
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { buildPdfExportRequest as buildPdfExportRequestFromJson, type PdfExportOptions, type PdfExportRequest } from '@ses/io'
import type { IRDocMeta, PMJsonNode } from '@ses/shared'

export type { PdfExportRequest, PdfTocTarget } from '@ses/io'

/**
 * 构建 PDF 出件请求体。
 * @param doc  当前编辑器 ProseMirror 文档
 * @param meta 导出面板元数据（覆盖 IR meta，保证书眉/正文首页名称与 DOCX 导出一致）
 */
export function buildPdfExportRequest(doc: PMNode, meta: Partial<IRDocMeta>, options: PdfExportOptions = {}): PdfExportRequest {
  return buildPdfExportRequestFromJson(doc.toJSON() as PMJsonNode, meta, options)
}
