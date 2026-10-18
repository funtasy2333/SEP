/**
 * body/*.ts 共用的渲染上下文与「唯一段落输出函数」（docs/wp7-docx-delivery.md §4.7）。
 *
 * `emitParagraph` 是全部段落渲染的唯一入口：写了段落级 numPr、或样式是属主样式（§4.1）时，
 * 要求调用方传入 `numbered`（nodeId/kind），并记入 `ctx.numbered`（供 §4.7 的比对使用）；
 * 漏传即抛错——这样任何一处忘记标注编号段落的 bug 都会在测试阶段暴露，而不是让 §4.7 的
 * 覆盖检查悄悄漏掉一项。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API；不用 class 的参数属性。
 */

import type { NodeId, ResolvedLabel } from '../../../ir/types'
import { createNumberingAllocator, type NumberingAllocator } from '../numbering'
import { OWNER_STYLE_IDS, styleSpecs } from '../styles'
import type { DocxBookmark, DocxPackage } from '../types'
import type { DocxRenderOptions } from '../types'
import type { DocxRelatedPart } from '../package'
import { escapeXmlAttr, numPr as numPrXml, pPr, type XmlChild } from '../xml'
import { mmToTwips } from '../units'
import { createPageFlow, type PageFlow } from './pageFlow'

const styles = new Map(styleSpecs().map(spec => [spec.id, spec]))

/** §4.7 render.ts 导出的追踪类型；本文件是它的唯一实现来源，render.ts 直接 re-export，
 * 避免 render.ts ↔ body/*.ts 之间因为「类型定义在 render.ts」而产生循环 import。 */
export interface NumberedParagraphTrace {
  nodeId: NodeId
  kind: 'chapter' | 'clause' | 'termEntry' | 'appendix' | 'figure' | 'table' | 'note' | 'example' | 'bibEntry' | 'listItem'
}

export interface RenderContext {
  readonly labels: Record<NodeId, ResolvedLabel>
  readonly numbering: NumberingAllocator
  readonly warnings: DocxPackage['warnings']
  readonly numbered: NumberedParagraphTrace[]
  readonly bookmarksByNodeId: ReadonlyMap<NodeId, DocxBookmark>
  readonly resources: Pick<DocxRenderOptions, 'images' | 'formulaOmml' | 'formulaWidths'>
  readonly pageFlow: PageFlow
  readonly relatedParts: DocxRelatedPart[]
  allocateImage(): { relationshipId: string; mediaIndex: number }
  /** Deferred paragraph properties let a later table request a break before an earlier keepNext chain. */
  deferParagraphBreak(): { marker: string; force: () => void }
  resolveParagraphBreaks(xml: string): string
}

export function createRenderContext(
  labels: Record<NodeId, ResolvedLabel>,
  bookmarksByNodeId: ReadonlyMap<NodeId, DocxBookmark> = new Map(),
  resources: Pick<DocxRenderOptions, 'images' | 'formulaOmml' | 'formulaWidths'> = { images: {}, formulaOmml: {} },
  allocateRelId: () => string = () => { throw new Error('DOCX 图片关系 ID 分配器尚未配置') },
): RenderContext {
  let mediaIndex = 0
  const paragraphBreaks: boolean[] = []
  return {
    labels, numbering: createNumberingAllocator(), warnings: [], numbered: [], bookmarksByNodeId,
    resources, relatedParts: [], pageFlow: createPageFlow(),
    allocateImage() { return { relationshipId: allocateRelId(), mediaIndex: ++mediaIndex } },
    deferParagraphBreak() {
      const index = paragraphBreaks.push(false) - 1
      return { marker: `<!--ses-page-break:${index}-->`, force: () => { paragraphBreaks[index] = true } }
    },
    resolveParagraphBreaks(xml) {
      return xml.replace(/<!--ses-page-break:(\d+)-->/g, (_, index: string) =>
        paragraphBreaks[Number(index)] ? '<w:pageBreakBefore/>' : '')
    },
  }
}

export function warn(ctx: RenderContext, code: string, message: string, nodeId?: NodeId): void {
  ctx.warnings.push(nodeId !== undefined ? { code, nodeId, message } : { code, message })
}

export interface EmitParagraphOptions {
  /** 段落级 numPr（§4.1：无标题条、术语条目编号、按需实例列项……都用这个） */
  numPr?: { numId: number; ilvl: number }
  /** 覆盖编号定义的缩进，例如独立的二级数字列项。 */
  indent?: { left: number; hanging: number }
  /** 首段余量不足时显式另起页；续段仍从新页起排。 */
  pageBreakBefore?: boolean
  /** 封面定位图文框（页面坐标，mm；见 §6.1）。 */
  framePr?: { xMm: number; yMm: number; widthMm: number }
  /** 段落内容（一串 `<w:r>…</w:r>`），省略/空串 = 空段落（只有编号的段） */
  runsXml?: string
  /** 这段是否为「有效编号段落」（§4.7）：写了 numPr，或样式是属主样式时必须提供 */
  numbered?: { nodeId: NodeId; kind: NumberedParagraphTrace['kind'] }
  /** 无编号但仍需作为目次目标的段落（前言、引言、参考文献标题） */
  bookmark?: DocxBookmark
}

function framePrXml(frame: NonNullable<EmitParagraphOptions['framePr']>): string {
  if (![frame.xMm, frame.yMm, frame.widthMm].every(Number.isFinite) || frame.widthMm <= 0) {
    throw new Error('emitParagraph: framePr 坐标和宽度必须为有限数，且宽度须为正数')
  }
  return '<w:framePr w:hAnchor="page" w:vAnchor="page" w:wrap="around" w:hSpace="0" w:vSpace="0" ' +
    `w:x="${mmToTwips(frame.xMm)}" w:y="${mmToTwips(frame.yMm)}" w:w="${mmToTwips(frame.widthMm)}"/>`
}

/**
 * 全部段落经这一个函数输出（§4.7）：`<w:p><w:pPr><w:pStyle/>[numPr]</w:pPr>[runs]</w:p>`。
 * 段落写了 `opts.numPr`，或 `styleId` 是属主样式（§4.1，OWNER_STYLE_IDS）时，`opts.numbered`
 * 必须提供，否则抛错；提供时记入 `ctx.numbered`。
 */
export function emitParagraph(ctx: RenderContext, styleId: string, opts: EmitParagraphOptions = {}): string {
  const isOwnerStyle = OWNER_STYLE_IDS.has(styleId)
  if ((opts.numPr !== undefined || isOwnerStyle) && !opts.numbered) {
    const reason = opts.numPr !== undefined ? '写了段落级 numPr' : '样式是属主样式'
    throw new Error(`emitParagraph: 样式 "${styleId}" 的段落${reason}，但没有传入 numbered（nodeId/kind），违反 §4.7 追踪要求`)
  }
  if (opts.numbered) ctx.numbered.push(opts.numbered)

  const deferredBreak = styles.get(styleId)?.keepNext && !opts.pageBreakBefore && !ctx.pageFlow.isSuspended
    ? ctx.deferParagraphBreak() : undefined
  const numbering = opts.numPr ?? styles.get(styleId)?.numPr
  const pending = ctx.pageFlow.recordParagraph(styleId, opts.runsXml ?? '', numbering !== undefined, {
    numberingIndent: numbering ? ctx.numbering.getIndent(numbering.numId, numbering.ilvl) : undefined,
    indent: opts.indent, pageBreakBefore: opts.pageBreakBefore, forcePageBreakBefore: deferredBreak?.force,
  })

  const pprChildren: XmlChild[] = [['pStyle', `<w:pStyle w:val="${styleId}"/>`]]
  if (opts.pageBreakBefore) pprChildren.push(['pageBreakBefore', '<w:pageBreakBefore/>'])
  else if (pending && deferredBreak) pprChildren.push(['pageBreakBefore', deferredBreak.marker])
  if (opts.framePr) pprChildren.push(['framePr', framePrXml(opts.framePr)])
  if (opts.numPr) pprChildren.push(['numPr', numPrXml([
    ['ilvl', `<w:ilvl w:val="${opts.numPr.ilvl}"/>`],
    ['numId', `<w:numId w:val="${opts.numPr.numId}"/>`],
  ])])
  if (opts.indent) pprChildren.push(['ind', `<w:ind w:left="${opts.indent.left}" w:hanging="${opts.indent.hanging}"/>`])
  const bookmark = opts.bookmark ?? (opts.numbered ? ctx.bookmarksByNodeId.get(opts.numbered.nodeId) : undefined)
  const start = bookmark
    ? `<w:bookmarkStart w:id="${bookmark.id}" w:name="${escapeXmlAttr(bookmark.name)}"/>`
    : ''
  const end = bookmark ? `<w:bookmarkEnd w:id="${bookmark.id}"/>` : ''
  return `<w:p>${pPr(pprChildren)}${start}${opts.runsXml ?? ''}${end}</w:p>`
}
