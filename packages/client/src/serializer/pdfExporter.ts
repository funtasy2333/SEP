/**
 * PDF 出件请求构建器（Phase 5.5 / WP5，客户端）。
 *
 * 走 IR→HTML→服务端两遍构建管线：
 *   ProseMirror 文档 → pmToIr → resolve → renderHtml(variant:'print') → print HTML
 * 再用浏览器 DOMParser 从渲染后 HTML 的目次节点提取目次目标（target/显示文本/分区），
 * 与 print HTML 一并 POST 给 `/api/convert/html-to-pdf`。服务端据目次目标在第一遍 PDF 中
 * 定位页码并注入，产出 GB/T 1.1 版式 PDF。
 *
 * 不在客户端渲染 KaTeX、不在客户端做编号（编号在 shared Resolver；KaTeX 在服务端）。
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { pmToIr, resolve, renderHtml, type IRDocMeta, type PMJsonNode } from '@ses/shared'

export interface PdfTocTarget {
  target: string
  text: string
  division: 'front' | 'body'
}

export interface PdfExportRequest {
  html: string
  toc: PdfTocTarget[]
  /** 正文首页文件名称（服务端据此定位正文起始页做分区页码换算） */
  docTitle: string
  /** 下载文件名（不含扩展名） */
  filename: string
}

/** 从 print HTML 的目次节点提取目次目标。前言/引言归前置分区，其余归正文分区。 */
function extractToc(html: string): PdfTocTarget[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const out: PdfTocTarget[] = []
  for (const li of Array.from(parsed.querySelectorAll('.ses-toc-item'))) {
    const pageEl = li.querySelector('.ses-toc-page')
    const textEl = li.querySelector('.ses-toc-text')
    const target = pageEl?.getAttribute('data-target') ?? ''
    const text = (textEl?.textContent ?? '').trim()
    if (!target || !text) continue
    const division: 'front' | 'body' =
      target === 'front_foreword' || target === 'front_intro' ? 'front' : 'body'
    out.push({ target, text, division })
  }
  return out
}

/**
 * 构建 PDF 出件请求体。
 * @param doc  当前编辑器 ProseMirror 文档
 * @param meta 导出面板元数据（覆盖 IR meta，保证书眉/正文首页名称与 DOCX 导出一致）
 */
export function buildPdfExportRequest(doc: PMNode, meta: Partial<IRDocMeta>): PdfExportRequest {
  const pmJson = doc.toJSON() as PMJsonNode
  const { doc: ir } = pmToIr(pmJson)

  // 用面板 meta 覆盖书眉/标题相关字段（standardType 等仍沿用 pmToIr 推断结果）
  if (meta.title !== undefined) ir.meta.title = meta.title
  if (meta.titleEn !== undefined) ir.meta.titleEn = meta.titleEn
  if (meta.stdCode !== undefined) ir.meta.stdCode = meta.stdCode
  if (meta.icsCode !== undefined) ir.meta.icsCode = meta.icsCode
  if (meta.ccsCode !== undefined) ir.meta.ccsCode = meta.ccsCode

  const { labels } = resolve(ir)
  const html = renderHtml(ir, labels, { variant: 'print' })

  return {
    html,
    toc: extractToc(html),
    docTitle: ir.meta.title ?? meta.title ?? '',
    filename: meta.title || '标准文件',
  }
}
