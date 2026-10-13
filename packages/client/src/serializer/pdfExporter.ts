/**
 * PDF 出件请求构建器（薄壳）。
 *
 * Phase 5.5 / WP5 起的 IR→HTML→服务端两遍构建管线：
 *   ProseMirror 文档 → pmToIr → resolve → renderHtml(variant:'print') → print HTML + 目次目标
 * 再与 print HTML 一并 POST 给 `/api/convert/html-to-pdf`。
 *
 * WP9.2e 起请求构建迁入 @ses/io（目次目标不再依赖浏览器 DOMParser），使服务端能按文档 id 导出同样的 PDF。
 * 本文件只把 Tiptap/ProseMirror 文档转为纯 JSON 并调用 io，保留原 `buildPdfExportRequest(doc, meta)` 签名。
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { buildPdfExportRequest as buildPdfExportRequestFromJson, type PdfExportRequest } from '@ses/io'
import type { IRDocMeta, PMJsonNode } from '@ses/shared'

export type { PdfExportRequest, PdfTocTarget } from '@ses/io'

/**
 * 构建 PDF 出件请求体。
 * @param doc  当前编辑器 ProseMirror 文档
 * @param meta 导出面板元数据（覆盖 IR meta，保证书眉/正文首页名称与 DOCX 导出一致）
 */
export function buildPdfExportRequest(doc: PMNode, meta: Partial<IRDocMeta>): PdfExportRequest {
  return buildPdfExportRequestFromJson(doc.toJSON() as PMJsonNode, meta)
}
