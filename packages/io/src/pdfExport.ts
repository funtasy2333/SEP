/**
 * PDF 出件请求构建（平台无关）：ProseMirror JSON → IR → Resolver → print HTML + 目次目标。
 *
 * 原先在 client 的 serializer/pdfExporter.ts，目次目标靠浏览器 DOMParser 从渲染后的 HTML 提取。
 * 迁入 io 后 client 与服务端共用：目次提取改为按 shared `renderToc` 的确定标记直接解析，
 * 不依赖 DOMParser，结果与原实现逐项相同（见 extractPdfTocTargets 的说明与对照测试）。
 *
 * 服务端据目次目标在第一遍 PDF 中定位页码并注入，产出 GB/T 1.1 版式 PDF；
 * 不在这里渲染 KaTeX、不做编号（编号在 shared Resolver，KaTeX 在服务端 PDF 管线）。
 */

import { pmToIr, renderHtml, resolve, type IRDocMeta, type PMJsonNode } from '@ses/shared'

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

/**
 * 目次条目：`<li class="ses-toc-item …">`。renderToc 在 print 变体输出
 * `<span class="ses-toc-text">文本</span>` 与 `<span class="ses-toc-page" data-target="目标">`。
 *
 * 之所以能直接按文本匹配而不必真正解析 HTML：shared 的 escapeHtml/escapeAttr 把文档里的
 * `&`、`<`、`>`（属性里还有 `"`）全部转义，原始 HTML 中的 `<` 与属性里的 `"` 只会出现在渲染器自己写的标记上，
 * 用户文本不可能伪造出标记；`[^<]*` 与 `[^"]*` 因此恰好取到文本与属性值。
 * 与原 DOMParser 实现的另一处对应：screen 变体的目次没有 `.ses-toc-page`，原实现因 target 为空而跳过，
 * 这里同样匹配不到而跳过。
 */
const TOC_ITEM_PATTERN = /<li class="ses-toc-item(?: [^"<>]*)?">([\s\S]*?)<\/li>/g
const TOC_TEXT_PATTERN = /<span class="ses-toc-text">([^<]*)<\/span>/
const TOC_PAGE_PATTERN = /<span class="ses-toc-page" data-target="([^"]*)">/

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"' }

/**
 * 还原 HTML 解析器对一段原始文本/属性值的处理，范围限于 escapeHtml/escapeAttr 产出的内容：
 * - 输入流预处理：`\r\n` 与单个 `\r` 都变成 `\n`；
 * - U+0000：文本中被树构建阶段忽略，属性值中变为 U+FFFD；
 * - 字符引用：只可能出现 `&amp; &lt; &gt; &quot;`（每个 `&` 都被转义成 `&amp;`），一次扫描还原，
 *   因此文档里原文就是 `&amp;` 的文字会经 `&amp;amp;` 还原回 `&amp;`，不会被二次解码。
 */
function decodeHtml(raw: string, nul: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, nul)
    .replace(/&(amp|lt|gt|quot);/g, (_match, name: string) => ENTITIES[name]!)
}

/**
 * 从 print HTML 的目次节点提取目次目标。前言/引言归前置分区，其余归正文分区。
 * 文本与原实现的 `textContent.trim()` 等价；target 或文本为空的条目跳过。
 */
export function extractPdfTocTargets(html: string): PdfTocTarget[] {
  const out: PdfTocTarget[] = []
  for (const item of html.matchAll(TOC_ITEM_PATTERN)) {
    const inner = item[1]!
    const rawTarget = TOC_PAGE_PATTERN.exec(inner)?.[1]
    const rawText = TOC_TEXT_PATTERN.exec(inner)?.[1]
    const target = rawTarget === undefined ? '' : decodeHtml(rawTarget, '�')
    const text = rawText === undefined ? '' : decodeHtml(rawText, '').trim()
    if (!target || !text) continue
    const division: 'front' | 'body' =
      target === 'front_foreword' || target === 'front_intro' ? 'front' : 'body'
    out.push({ target, text, division })
  }
  return out
}

/**
 * 构建 PDF 出件请求体。
 * @param pmJson 编辑器文档的 ProseMirror JSON（`doc.toJSON()` / `editor.getJSON()` 的形态）
 * @param meta   导出面板元数据（覆盖 IR meta，保证书眉/正文首页名称与 DOCX 导出一致）
 */
export function buildPdfExportRequest(pmJson: PMJsonNode, meta: Partial<IRDocMeta>): PdfExportRequest {
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
    toc: extractPdfTocTargets(html),
    docTitle: ir.meta.title ?? meta.title ?? '',
    filename: meta.title || '标准文件',
  }
}
