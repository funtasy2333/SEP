/**
 * DOCX 渲染组装（docs/wp7-docx-delivery.md §1.2 render.ts、§4.7、§9 WP7.2「文档结构」）。
 *
 * `renderDocxTraced` 按文档结构依次开节、渲染各部分内容，最后打包成 `DocxPackage`；同时返回
 * `numbered`（§4.7 追踪，供一致性测试用）。本文件不经 `index.ts` 导出（§4.7）。
 *
 * 文档结构（节序见 sections.ts）：
 * 1. 封面节（WP7.5 前占位）：SesCoverStdNo 段；
 * 2. 目次节：SesTocTitle 与固定条目/PAGEREF；
 * 3. 前言、引言（各自非空才有）；
 * 4. 正文节：正文首页名称 + 各章；
 * 5. 每个附录一节；
 * 6. 参考文献节（非空才有）。WP7.4 的横排图表插入续编分节。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRAppendix, IRDoc, NodeId, ResolvedLabel } from '../../ir/types'
import { appendixLetterOf as strategyAppendixLetterOf } from '../../ir/strategies'
import { renderAppendix } from './body/appendix'
import { renderBibliography } from './body/bibliography'
import { LANDSCAPE_END, LANDSCAPE_START } from './body/block'
import { renderChapter } from './body/clause'
import { createRenderContext, emitParagraph, type NumberedParagraphTrace, type RenderContext } from './body/context'
import { renderBodyTitle, renderForeword, renderIntroduction, renderTocTitle } from './body/front'
import { renderCoverPlaceholder } from './cover'
import { buildStaticToc } from './toc'
import { buildPackage, createRelationshipIdAllocator, type DocxRelatedPart } from './package'
import { buildHeaderFooterParts, createSectionManager, type HeaderFooterRelIds, type SectionKind, type SectionManager } from './sections'
import { buildStylesXml } from './styles'
import type { DocxPackage, DocxRenderOptions } from './types'

export type { NumberedParagraphTrace }

/** 将唯一 keepNext 加到最后一个内容段；跳过仅含 sectPr 的分节空段。 */
function keepLastContentParagraphWithNext(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)]
  const last = [...paragraphs].reverse().find((match) => !match[1].includes('<w:sectPr'))
  if (!last || last.index === undefined) return xml
  const paragraph = last[0]
  const pPrStart = paragraph.indexOf('<w:pPr>')
  const pPrEnd = paragraph.indexOf('</w:pPr>')
  if (pPrStart < 0 || pPrEnd < 0) throw new Error('renderDocx: 最后内容段缺少 pPr')
  const pPrXml = paragraph.slice(pPrStart, pPrEnd + '</w:pPr>'.length)
  if (pPrXml.includes('<w:keepNext')) return xml

  const styleEnd = pPrXml.indexOf('/>')
  const insertAt = styleEnd >= 0 && pPrXml.slice(0, styleEnd).includes('<w:pStyle') ? styleEnd + 2 : '<w:pPr>'.length
  const updatedPPr = pPrXml.slice(0, insertAt) + '<w:keepNext/>' + pPrXml.slice(insertAt)
  const updatedParagraph = paragraph.replace(pPrXml, updatedPPr)
  return xml.slice(0, last.index) + updatedParagraph + xml.slice(last.index + paragraph.length)
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

export function renderDocxTraced(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  opts: DocxRenderOptions,
): { pkg: DocxPackage; numbered: NumberedParagraphTrace[] } {
  const toc = buildStaticToc(doc, labels)

  // 页眉页脚四个部件的关系 ID：按 header1、header2、footer1、footer2 的顺序申请（§2.3）
  const allocateRelId = createRelationshipIdAllocator()
  const ctx = createRenderContext(labels, toc.bookmarksByNodeId, opts, allocateRelId)
  const relIds: HeaderFooterRelIds = {
    header1: allocateRelId(),
    header2: allocateRelId(),
    footer1: allocateRelId(),
    footer2: allocateRelId(),
  }
  const headerFooterParts = buildHeaderFooterParts(doc.meta.stdCode ?? '')
  const sectionManager = createSectionManager(relIds)

  let body = ''
  let finalContentLandscape = false

  // 1. 封面节（占位）
  body += sectionManager.startSection('cover')
  body += renderCoverPlaceholder(ctx, doc.meta.stdCode)

  // 2. 目次节
  body += sectionManager.startSection('toc')
  body += renderTocTitle(ctx)
  body += toc.xml

  // 3. 前言、引言（各自非空才有）
  if (doc.front.foreword.length > 0) {
    body += sectionManager.startSection('foreword')
    const rendered = insertLandscapeSections(renderForeword(ctx, doc.front.foreword, toc.forewordBookmark), 'foreword', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  }
  if (doc.front.introduction.length > 0) {
    body += sectionManager.startSection('introduction')
    const rendered = insertLandscapeSections(renderIntroduction(ctx, doc.front.introduction, toc.introductionBookmark), 'introduction', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  }

  // 4. 正文节：正文首页名称 + 各章
  body += sectionManager.startSection('body')
  let bodyContent = renderBodyTitle(ctx, doc.meta.title)
  for (const chapter of doc.body) bodyContent += renderChapter(ctx, chapter)
  const renderedBody = insertLandscapeSections(bodyContent, 'body', sectionManager)
  body += renderedBody.xml
  finalContentLandscape = renderedBody.endsLandscape

  // 5. 每个附录一节
  doc.appendices.forEach((appendix, i) => {
    body += sectionManager.startSection('appendix')
    const rendered = insertLandscapeSections(renderAppendix(ctx, appendix, appendixLetterFor(ctx, appendix, i)), 'appendix', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  })

  // 6. 参考文献节（非空才有）
  if (doc.bibliography.length > 0) {
    body += sectionManager.startSection('bibliography')
    const rendered = insertLandscapeSections(renderBibliography(ctx, doc.bibliography, toc.bibliographyBookmark), 'bibliography', sectionManager)
    body += rendered.xml
    finalContentLandscape = rendered.endsLandscape
  }

  body = keepLastContentParagraphWithNext(body)
  body += emitParagraph(ctx, finalContentLandscape ? 'SesEndMarkLandscape' : 'SesEndMark')
  body += sectionManager.finalSectPr()

  const documentXml = `${XML_DECL}<w:document ${DOCUMENT_NS}><w:body>${body}</w:body></w:document>`

  const relatedParts: DocxRelatedPart[] = [
    { id: relIds.header1, target: 'word/header1.xml', relationshipType: `${REL}header`, content: headerFooterParts.header1, contentType: `${WML}header+xml` },
    { id: relIds.header2, target: 'word/header2.xml', relationshipType: `${REL}header`, content: headerFooterParts.header2, contentType: `${WML}header+xml` },
    { id: relIds.footer1, target: 'word/footer1.xml', relationshipType: `${REL}footer`, content: headerFooterParts.footer1, contentType: `${WML}footer+xml` },
    { id: relIds.footer2, target: 'word/footer2.xml', relationshipType: `${REL}footer`, content: headerFooterParts.footer2, contentType: `${WML}footer+xml` },
    ...ctx.relatedParts,
  ]

  const pkg = buildPackage({
    documentXml,
    title: doc.meta.title ?? '',
    createdAt: opts.createdAt,
    stylesXml: buildStylesXml(),
    numberingXml: ctx.numbering.buildNumberingXml(),
    relatedParts,
  })
  // buildPackage 目前总是返回空 warnings（WP7.1 起没有自己的告警来源），这里把渲染期间
  // 收集到的 ctx.warnings 并入；写成拼接而不是直接赋值，是为了不依赖这个「目前总是空」的细节。
  const finalPkg: DocxPackage = { ...pkg, warnings: [...pkg.warnings, ...ctx.warnings] }

  return { pkg: finalPkg, numbered: ctx.numbered }
}
