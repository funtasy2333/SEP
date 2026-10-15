import { assertOutputSupported } from '../outputBoundary'
/**
 * DOCX 渲染组装（docs/wp7-docx-delivery.md §1.2 render.ts、§4.7、§9 WP7.2「文档结构」）。
 *
 * `renderDocxTraced` 按文档结构依次开节、渲染各部分内容，最后打包成 `DocxPackage`；同时返回
 * `numbered`（§4.7 追踪，供一致性测试用）。本文件不经 `index.ts` 导出（§4.7）。
 *
 * 文档结构（节序见 sections.ts）：
 * 1. 封面节：§6 六类封面，其中标准文件编号同时为书眉 STYLEREF 的取值来源；
 * 2. 目次节：SesTocTitle 与固定条目/PAGEREF；
 * 3. 前言、引言（各自非空才有）；
 * 4. 正文节：正文首页名称 + 各章；
 * 5. 每个附录一节；
 * 6. 参考文献节（非空才有）。WP7.4 的横排图表插入续编分节。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRAppendix, IRDoc, IRFootnote, NodeId, ResolvedLabel } from '../../ir/types'
import { appendixLetterOf as strategyAppendixLetterOf } from '../../ir/strategies'
import { renderAppendix } from './body/appendix'
import { renderBibliography } from './body/bibliography'
import { LANDSCAPE_END, LANDSCAPE_START } from './body/block'
import { renderChapter } from './body/clause'
import { createRenderContext, emitParagraph, type NumberedParagraphTrace, type RenderContext } from './body/context'
import { renderBodyTitle, renderForeword, renderIntroduction, renderTocTitle } from './body/front'
import { normalizeCoverStdCode, renderCover } from './cover'
import { buildStaticToc } from './toc'
import { buildPackage, createRelationshipIdAllocator, type DocxRelatedPart } from './package'
import { buildHeaderFooterParts, createSectionManager, type HeaderFooterRelIds, type SectionKind, type SectionManager } from './sections'
import { buildStylesXml } from './styles'
import type { DocxPackage, DocxRenderOptions } from './types'
import { assertFootnoteReferences, documentHasFootnotes } from '../footnotes'
import { renderInlines, superscriptRun, tabRun } from './body/inline'

export type { NumberedParagraphTrace }

function paragraphWithKeepNext(paragraph: string): string {
  if (paragraph === '<w:p/>') return '<w:p><w:pPr><w:keepNext/></w:pPr></w:p>'
  const pPrStart = paragraph.indexOf('<w:pPr>')
  const pPrEnd = paragraph.indexOf('</w:pPr>')
  if (pPrStart < 0 || pPrEnd < 0) throw new Error('renderDocx: 最后内容段缺少 pPr')
  const pPrXml = paragraph.slice(pPrStart, pPrEnd + '</w:pPr>'.length)
  if (pPrXml.includes('<w:keepNext')) return paragraph

  const styleEnd = pPrXml.indexOf('/>')
  const insertAt = styleEnd >= 0 && pPrXml.slice(0, styleEnd).includes('<w:pStyle') ? styleEnd + 2 : '<w:pPr>'.length
  const updatedPPr = pPrXml.slice(0, insertAt) + '<w:keepNext/>' + pPrXml.slice(insertAt)
  return paragraph.replace(pPrXml, updatedPPr)
}

/** 找出结尾表格中最后一个顶层行，忽略单元格中的嵌套表。 */
function lastTopLevelTableRow(xml: string): { start: number; end: number } | undefined {
  let depth = 0
  let rowStart = -1
  let lastRow: { start: number; end: number } | undefined
  for (const match of xml.matchAll(/<\/?w:(?:tbl|tr)>/g)) {
    const tag = match[0]
    if (tag === '<w:tbl>') depth += 1
    else if (tag === '</w:tbl>') depth -= 1
    else if (tag === '<w:tr>' && depth === 1) rowStart = match.index
    else if (tag === '</w:tr>' && depth === 1 && rowStart >= 0) {
      lastRow = { start: rowStart, end: match.index + tag.length }
    }
  }
  return lastRow
}

/** 表格为末要素时，使最后一整行与其后的终结线同页；其他末段沿用 WP7.3 的 keepNext。 */
function keepLastContentWithEndMark(xml: string): string {
  if (xml.endsWith('</w:tbl>')) {
    const row = lastTopLevelTableRow(xml)
    if (row) {
      const original = xml.slice(row.start, row.end)
      const updated = original.replace(/<w:p>([\s\S]*?)<\/w:p>|<w:p\/>/g, paragraphWithKeepNext)
      return xml.slice(0, row.start) + updated + xml.slice(row.end)
    }
  }
  const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)]
  const last = [...paragraphs].reverse().find((match) => !match[1].includes('<w:sectPr'))
  if (!last || last.index === undefined) return xml
  return xml.slice(0, last.index) + paragraphWithKeepNext(last[0]) + xml.slice(last.index + last[0].length)
}

const DOCUMENT_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'

/** 只在完整的横排图/表块之间分节；相邻横排块共享同一节。 */
function insertLandscapeSections(xml: string, baseKind: SectionKind, sections: SectionManager): { xml: string; endsLandscape: boolean } {
  const pieces = xml.split(/(<!--SES:landscape:start-->|<!--SES:landscape:end-->)/)
  let out = ''
  let landscape = false
  let finishedLandscapeBlock = false
  for (const piece of pieces) {
    if (piece === LANDSCAPE_START) {
      if (!landscape) out += sections.startSection(baseKind, { continuation: true, landscape: true })
      landscape = true
      finishedLandscapeBlock = false
    } else if (piece === LANDSCAPE_END) {
      finishedLandscapeBlock = true
    } else if (piece) {
      if (finishedLandscapeBlock) {
        out += sections.startSection(baseKind, { continuation: true })
        landscape = false
        finishedLandscapeBlock = false
      }
      out += piece
    }
  }
  return { xml: out, endsLandscape: landscape }
}

/** 附录字母：优先取 Resolver 写好的 label（"附录A" → "A"），保证与 labels 完全一致；
 * label 缺失时按数组顺序退化（正常情况下不会走到这里，Resolver 总会给附录赋 label）。 */
function appendixLetterFor(ctx: RenderContext, appendix: IRAppendix, index: number): string {
  const label = ctx.labels[appendix.id]?.label
  const m = label ? /^附录(.+)$/.exec(label) : null
  return m ? m[1] : strategyAppendixLetterOf(index + 1)
}

function noteNumber(noteId: string, labels: Record<NodeId, ResolvedLabel>): number {
  const match = /^fn_(\d+)$/.exec(labels[noteId]?.xmlId ?? '')
  const value = match ? Number(match[1]) : Number.NaN
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`renderDocx: 条文脚注 "${noteId}" 缺少有效的 resolver 编号`)
  }
  return value
}

function separatorFootnote(id: -1 | 0, kind: 'separator' | 'continuationSeparator'): string {
  // Word extends paragraph borders by about 0.5 mm at each end. Compensate so the visible
  // portrait rule starts at the left text edge and measures approximately 41.25 mm (¼ of 165 mm).
  const pPr = '<w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="000000"/></w:pBdr>' +
    '<w:ind w:left="28" w:right="7044"/></w:pPr>'
  // The typed special entry tells Word which separator this is; the empty run avoids the
  // built-in separator glyph so only the measured paragraph border is visible.
  return `<w:footnote w:type="${kind}" w:id="${id}"><w:p>${pPr}<w:r/></w:p></w:footnote>`
}

function footnotesXml(
  footnotes: IRFootnote[],
  labels: Record<NodeId, ResolvedLabel>,
): string {
  const definitions = footnotes.map((footnote) => {
    const resolved = labels[footnote.id]
    const id = noteNumber(footnote.id, labels)
    if (!resolved) throw new Error(`renderDocx: 条文脚注 "${footnote.id}" 在 labels 中没有编号`)
    const marker = superscriptRun(resolved.refText)
    const body = renderInlines(footnote.content, labels)
    return `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="SesFootnoteText"/></w:pPr>` +
      marker + tabRun() + body + '</w:p></w:footnote>'
  }).join('')
  return `${XML_DECL}<w:footnotes ${DOCUMENT_NS}>${separatorFootnote(-1, 'separator')}` +
    `${separatorFootnote(0, 'continuationSeparator')}${definitions}</w:footnotes>`
}

export function renderDocxTraced(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  opts: DocxRenderOptions,
): { pkg: DocxPackage; numbered: NumberedParagraphTrace[] } {
  const bodyFootnotes = assertFootnoteReferences(doc, labels)
  assertOutputSupported(doc, 'DOCX')
  const toc = buildStaticToc(doc, labels)

  // 页眉页脚四个部件的关系 ID：按 header1、header2、footer1、footer2 的顺序申请（§2.3）
  const allocateRelId = createRelationshipIdAllocator()
  const ctx = createRenderContext(labels, toc.bookmarksByNodeId, opts, allocateRelId)
  ctx.pageFlow.setFootnoteHeights(new Map(bodyFootnotes.map(footnote => {
    const text = footnote.content.map(run => run.text).join('')
    const lineCount = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(
      [...line].reduce((width, char) => width + (char.charCodeAt(0) < 128 ? 0.55 : 1), 0) / 48)), 0)
    return [noteNumber(footnote.id, labels), lineCount * 4.2 + 2]
  })))
  const relIds: HeaderFooterRelIds = {
    header1: allocateRelId(),
    header2: allocateRelId(),
    footer1: allocateRelId(),
    footer2: allocateRelId(),
  }
  const footnotesRelId = bodyFootnotes.length > 0 ? allocateRelId() : undefined
  const headerFooterParts = buildHeaderFooterParts(normalizeCoverStdCode(doc.meta.stdCode))
  const sectionManager = createSectionManager(relIds)

  let body = ''
  let finalContentLandscape = false

  // 1. 封面节
  body += sectionManager.startSection('cover')
  body += renderCover(ctx, doc.meta, opts.stage)

  // 2. 目次节
  body += sectionManager.startSection('toc')
  body += renderTocTitle(ctx)
  body += toc.xml

  // 3. 前言、引言（各自非空才有）
  if (doc.front.foreword.length > 0) {
    body += sectionManager.startSection('foreword')
    ctx.pageFlow.startSection()
    const rendered = insertLandscapeSections(renderForeword(ctx, doc.front.foreword, toc.forewordBookmark), 'foreword', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  }
  if (doc.front.introduction.length > 0) {
    body += sectionManager.startSection('introduction')
    ctx.pageFlow.startSection()
    const rendered = insertLandscapeSections(renderIntroduction(ctx, doc.front.introduction, toc.introductionBookmark), 'introduction', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  }

  // 4. 正文节：正文首页名称 + 各章
  body += sectionManager.startSection('body')
  ctx.pageFlow.startSection()
  let bodyContent = renderBodyTitle(ctx, doc.meta.title)
  for (const chapter of doc.body) bodyContent += renderChapter(ctx, chapter)
  const renderedBody = insertLandscapeSections(bodyContent, 'body', sectionManager)
  body += renderedBody.xml
  finalContentLandscape = renderedBody.endsLandscape

  // 5. 每个附录一节
  doc.appendices.forEach((appendix, i) => {
    body += sectionManager.startSection('appendix')
    ctx.pageFlow.startSection()
    const rendered = insertLandscapeSections(renderAppendix(ctx, appendix, appendixLetterFor(ctx, appendix, i)), 'appendix', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  })

  // 6. 参考文献节（非空才有）
  if (doc.bibliography.length > 0) {
    body += sectionManager.startSection('bibliography')
    ctx.pageFlow.startSection()
    const rendered = insertLandscapeSections(renderBibliography(ctx, doc.bibliography, toc.bibliographyBookmark), 'bibliography', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  }

  // Word merges adjacent tbl elements, including their repeated header rows. A normal
  // empty paragraph separates distinct tables without changing section or numbering rules.
  body = body.replace(/<\/w:tbl><w:tbl>/g, '</w:tbl>' + emitParagraph(ctx, 'SesNormal') + '<w:tbl>')
  body = keepLastContentWithEndMark(body)
  body += emitParagraph(ctx, finalContentLandscape ? 'SesEndMarkLandscape' : 'SesEndMark')
  body += sectionManager.finalSectPr()

  if (bodyFootnotes.length > 0 && body.includes('w:orient="landscape"')) {
    ctx.warnings.push({ code: 'footnote-landscape-separator', message: '文档含条文脚注和横排节；Word 横排页的条文脚注分隔线尚未支持按版心1/4自动调整，请校对横排脚注及跨页延续。' })
  }

  const documentXml = `${XML_DECL}<w:document ${DOCUMENT_NS}><w:body>${body}</w:body></w:document>`

  const relatedParts: DocxRelatedPart[] = [
    { id: relIds.header1, target: 'word/header1.xml', relationshipType: `${REL}header`, content: headerFooterParts.header1, contentType: `${WML}header+xml` },
    { id: relIds.header2, target: 'word/header2.xml', relationshipType: `${REL}header`, content: headerFooterParts.header2, contentType: `${WML}header+xml` },
    { id: relIds.footer1, target: 'word/footer1.xml', relationshipType: `${REL}footer`, content: headerFooterParts.footer1, contentType: `${WML}footer+xml` },
    { id: relIds.footer2, target: 'word/footer2.xml', relationshipType: `${REL}footer`, content: headerFooterParts.footer2, contentType: `${WML}footer+xml` },
    ...(footnotesRelId ? [{
      id: footnotesRelId,
      target: 'word/footnotes.xml',
      relationshipType: `${REL}footnotes`,
      content: footnotesXml(bodyFootnotes, labels),
      contentType: `${WML}footnotes+xml`,
    }] : []),
    ...ctx.relatedParts,
  ]

  const pkg = buildPackage({
    documentXml,
    title: doc.meta.title ?? '',
    customProperties: Object.fromEntries(
      (['applicant', 'proposer', 'technicalCommittee'] as const)
        .filter(field => Boolean(doc.meta[field]))
        .map(field => [`ses-${field}`, doc.meta[field]!]),
    ),
    createdAt: opts.createdAt,
    stylesXml: buildStylesXml({ includeFootnotes: documentHasFootnotes(doc, bodyFootnotes) }),
    numberingXml: ctx.numbering.buildNumberingXml(),
    relatedParts,
  })
  // buildPackage 目前总是返回空 warnings（WP7.1 起没有自己的告警来源），这里把渲染期间
  // 收集到的 ctx.warnings 并入；写成拼接而不是直接赋值，是为了不依赖这个「目前总是空」的细节。
  const finalPkg: DocxPackage = { ...pkg, warnings: [...pkg.warnings, ...ctx.warnings] }

  return { pkg: finalPkg, numbered: ctx.numbered }
}
