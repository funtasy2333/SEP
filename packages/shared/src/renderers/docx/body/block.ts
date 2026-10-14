/**
 * 块级要素渲染（docs/wp7-docx-delivery.md §4.4、§5.6–§5.10）。
 *
 * `renderBlock`/`renderBlocks` 是通用块分发入口：段落、列项、图/表/公式、
 * 注、示例都从这里分发，互相递归（列表项内容可以是段落或嵌套列表；注/示例内容可以是任意块）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRBlock, IRExample, IRFigure, IRList, IRNote, IRParagraph, IRTable, NodeId } from '../../../ir/types'
import { ABSTRACT_NUM_ID, listAbstractNumId } from '../numbering'
import { emitParagraph, warn, type RenderContext } from './context'
import { plainRun, renderInlines, renderRun, superscriptRun, tabRun } from './inline'
import { renderFigureImage } from './figure'
import { renderTableGrid } from './table'
import { resolveTableColumnWidths } from './tableColumnWidths'
import { paginateTable } from './tablePagination'
import { renderFormula } from './formula'
import { orderTableFootnotes } from '../../footnotes'

/** render.ts 在完整块之间解析这两个内部标记，连续横排块由此共用一节。 */
export const LANDSCAPE_START = '<!--SES:landscape:start-->'
export const LANDSCAPE_END = '<!--SES:landscape:end-->'

/** 当前所处的附录（§4.4 附录图/表按需实例；无值表示正文/前言/引言） */
export interface AppendixContext {
  id: NodeId
  letter: string
}

export interface BlockCtx {
  /** 注/示例分组的作用域键（§5.7），随渲染的容器切换（章/条/附录/术语条目/图/表/注/示例自身……） */
  scopeKey: NodeId
  appendix?: AppendixContext
  /** 表格/图注等完整要素内部不得插入分节。 */
  suppressLandscape?: boolean
}

function withScope(bctx: BlockCtx, scopeKey: NodeId): BlockCtx {
  return { ...bctx, scopeKey }
}

// ---------------- 列表（§4.4、§5.6） ----------------

type ListItem = IRList['items'][number]

interface ListLevelPlan {
  firstStyleId: string
  firstNumPr?: { numId: number; ilvl: number }
  contStyleId: string
  firstIndent?: { left: number; hanging: number }
}

interface ParentListInfo {
  type: IRList['listType']
  /** dash 没有分配实例，此时为 undefined */
  numId?: number
}

function planForList(ctx: RenderContext, list: IRList, depth: number, parent: ParentListInfo | undefined): ListLevelPlan {
  if (depth >= 3) {
    warn(ctx, 'list-too-deep', `列表 "${list.id}" 嵌套超过两层（第 ${depth} 层，GB/T 1.1 7.5.2 细分不宜超过两个层次）`, list.id)
    return { firstStyleId: 'SesListDot', contStyleId: 'SesListCont2' }
  }

  if (depth === 1) {
    if (list.listType === 'dot') {
      return { firstStyleId: 'SesListDot', contStyleId: 'SesListCont2' }
    }
    if (list.listType === 'dash') {
      return { firstStyleId: 'SesListDash', contStyleId: 'SesListCont' }
    }
    if (list.listType === 'boxed') {
      warn(ctx, 'list-format-fallback', `列表 "${list.id}" 为方框编号（boxed），本系列按数字编号（A13）渲染`, list.id)
    }
    const numId = ctx.numbering.allocListInstance(listAbstractNumId(list.listType))
    const secondLevel = list.level === 2 || list.listType === 'number'
    return {
      firstStyleId: 'SesListItem',
      firstNumPr: { numId, ilvl: 0 },
      contStyleId: secondLevel ? 'SesListCont2' : 'SesListCont',
      firstIndent: secondLevel ? { left: 1260, hanging: 420 } : undefined,
    }
  }

  // depth === 2
  if (list.listType === 'number') {
    const numId = ctx.numbering.allocListInstance(ABSTRACT_NUM_ID.listNumber)
    return {
      firstStyleId: 'SesListItem',
      firstNumPr: { numId, ilvl: 0 },
      contStyleId: 'SesListCont2',
      firstIndent: { left: 1260, hanging: 420 },
    }
  }
  if (list.listType === 'dash' || list.listType === 'dot') {
    return { firstStyleId: 'SesListDot', contStyleId: 'SesListCont2' }
  }
  if (!parent) throw new Error('planForList: 第二层列表缺少父列表信息')
  if (parent.type === 'dash') {
    const numId = ctx.numbering.allocListInstance(ABSTRACT_NUM_ID.listAlpha) // §4.4：新建 A12 实例，用 ilvl1
    return { firstStyleId: 'SesListItem', firstNumPr: { numId, ilvl: 1 }, contStyleId: 'SesListCont2' }
  }
  if (parent.numId === undefined) throw new Error('planForList: 上层列表不是 dash 时必须有 numId')
  return { firstStyleId: 'SesListItem', firstNumPr: { numId: parent.numId, ilvl: 1 }, contStyleId: 'SesListCont2' }
}

function renderListItemRest(ctx: RenderContext, blocks: (IRParagraph | IRList)[], bctx: BlockCtx, depth: number, list: IRList, plan: ListLevelPlan): string {
  let out = ''
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      out += emitParagraph(ctx, plan.contStyleId, { runsXml: renderInlines(block.content, ctx.labels) })
    } else {
      out += renderListLevel(ctx, block, bctx, depth + 1, { type: list.listType, numId: plan.firstNumPr?.numId })
    }
  }
  return out
}

function renderListLevel(ctx: RenderContext, list: IRList, bctx: BlockCtx, depth: number, parent: ParentListInfo | undefined): string {
  const plan = planForList(ctx, list, depth, parent)
  let out = ''
  list.items.forEach((item: ListItem) => {
    const first = item.content[0]
    const firstIsParagraph = first !== undefined && first.kind === 'paragraph'

    const numbered = { nodeId: item.id, kind: 'listItem' as const }
    if (firstIsParagraph) {
      out += emitParagraph(ctx, plan.firstStyleId, {
        numPr: plan.firstNumPr,
        indent: plan.firstIndent,
        runsXml: renderInlines((first as IRParagraph).content, ctx.labels),
        numbered,
      })
      out += renderListItemRest(ctx, item.content.slice(1), bctx, depth, list, plan)
    } else {
      out += emitParagraph(ctx, plan.firstStyleId, { numPr: plan.firstNumPr, indent: plan.firstIndent, numbered })
      out += renderListItemRest(ctx, item.content, bctx, depth, list, plan)
    }
  })
  return out
}

function renderList(ctx: RenderContext, list: IRList, bctx: BlockCtx): string {
  return renderListLevel(ctx, list, bctx, 1, undefined)
}

// ---------------- 注 / 示例（§5.7） ----------------

function resolveGroupLabel(
  ctx: RenderContext,
  id: NodeId,
  word: '注' | '示例',
): { isSingle: boolean; ordinal?: number } {
  const label = ctx.labels[id]?.label
  if (label === undefined) {
    warn(ctx, 'label-missing', `${word === '注' ? '注' : '示例'} "${id}" 在 labels 中没有 label，按单条处理`, id)
    return { isSingle: true }
  }
  if (label === `${word}：`) return { isSingle: true }
  const m = new RegExp(`^${word}(\\d+)：$`).exec(label)
  if (!m) return { isSingle: true } // 防御性兜底：不应发生（Resolver 的 label 格式已固定）
  return { isSingle: false, ordinal: Number(m[1]) }
}

function renderContentBlocks(ctx: RenderContext, blocks: IRBlock[], bctx: BlockCtx, contStyleId: string): string {
  let out = ''
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      out += emitParagraph(ctx, contStyleId, { runsXml: renderInlines(block.content, ctx.labels) })
    } else {
      out += renderBlock(ctx, block, bctx)
    }
  }
  return out
}

function renderNote(ctx: RenderContext, note: IRNote, bctx: BlockCtx, inTable = false): string {
  const { isSingle, ordinal } = resolveGroupLabel(ctx, note.id, '注')
  const firstStyleId = inTable ? 'SesTableNote' : isSingle ? 'SesNote' : 'SesNoteN'
  const contStyleId = inTable ? 'SesTableNote' : isSingle ? 'SesNoteCont' : 'SesNoteNCont'
  const firstNumPr = inTable && isSingle
    ? { numId: ABSTRACT_NUM_ID.note, ilvl: 0 }
    : isSingle ? undefined : { numId: ctx.numbering.allocNoteInstance(bctx.scopeKey, ordinal!), ilvl: 0 }
  const numbered = { nodeId: note.id, kind: 'note' as const }
  const innerBctx = withScope(bctx, note.id) // §5.7：注内容中的块，作用域 = 该注的 id

  const [first, ...rest] = note.content
  if (first && first.kind === 'paragraph') {
    let out = emitParagraph(ctx, firstStyleId, { numPr: firstNumPr, runsXml: renderInlines(first.content, ctx.labels), numbered })
    out += renderContentBlocks(ctx, rest, innerBctx, contStyleId)
    return out
  }
  let out = emitParagraph(ctx, firstStyleId, { numPr: firstNumPr, numbered })
  out += renderContentBlocks(ctx, note.content, innerBctx, contStyleId)
  return out
}

function renderExample(ctx: RenderContext, example: IRExample, bctx: BlockCtx): string {
  const { isSingle, ordinal } = resolveGroupLabel(ctx, example.id, '示例')
  const firstStyleId = isSingle ? 'SesExLabel' : 'SesExLabelN'
  const firstNumPr = isSingle ? undefined : { numId: ctx.numbering.allocExampleInstance(bctx.scopeKey, ordinal!), ilvl: 0 }
  // 示例标识单独一段、段落内无文字（与注不同：注的首段可以和内容文字同段）
  let out = emitParagraph(ctx, firstStyleId, { numPr: firstNumPr, numbered: { nodeId: example.id, kind: 'example' } })
  out += renderContentBlocks(ctx, example.content, withScope(bctx, example.id), 'SesExText')
  return out
}

// ---------------- 图 / 表 / 公式（WP7.4） ----------------

function renderFigure(ctx: RenderContext, figure: IRFigure, bctx: BlockCtx): string {
  const image = ctx.resources.images[figure.id]
  const allocation = image ? ctx.allocateImage() : undefined
  const rendered = renderFigureImage(ctx, figure, image, allocation)
  if (rendered.relatedPart) ctx.relatedParts.push(rendered.relatedPart)
  let out = rendered.xml
  const noteBctx = { ...withScope(bctx, figure.id), suppressLandscape: true } // 图注与图同节
  for (const note of figure.notes) out += renderNote(ctx, note, noteBctx)

  const captionRuns = renderInlines(figure.caption, ctx.labels)
  const numbered = { nodeId: figure.id, kind: 'figure' as const }
  if (bctx.appendix) {
    const numId = ctx.numbering.allocAppendixFigureInstance(bctx.appendix.id, bctx.appendix.letter)
    out += emitParagraph(ctx, 'SesAppFigCap', { numPr: { numId, ilvl: 0 }, runsXml: captionRuns, numbered })
  } else {
    out += emitParagraph(ctx, 'SesFigCap', { runsXml: captionRuns, numbered })
  }
  return out
}

function renderTable(ctx: RenderContext, table: IRTable, bctx: BlockCtx): string {
  const nested = ctx.pageFlow.isSuspended
  return ctx.pageFlow.suspend(() => renderTableContent(ctx, table, bctx, nested))
}

function renderTableContent(ctx: RenderContext, table: IRTable, bctx: BlockCtx, nested: boolean): string {
  const captionRuns = renderInlines(table.caption, ctx.labels)
  const numbered = { nodeId: table.id, kind: 'table' as const }
  const flowOptions = nested ? {} : ctx.pageFlow.beforeTable()
  const pagination = paginateTable(table, flowOptions)
  if (!nested && flowOptions.forceStartOnNewPage) {
    warn(ctx, 'table-flow-estimate-unavailable',
      `表格 "${table.id}" 前的内容无法可靠确定页位置，首段改从新页排起，请在 Word 中复核表前余量`, table.id)
  }
  if (pagination.oversizedGroup) {
    warn(ctx, 'table-row-too-tall',
      `表格 "${table.id}" 存在超出单页高度预算的跨行合并组，续表分页可能需要人工调整`, table.id)
  }
  if (pagination.footerTooTall) {
    warn(ctx, 'table-footer-too-tall',
      `表格 "${table.id}" 的表题、重复表头与表尾组合超过单页高度预算，可能需要人工分页调整`, table.id)
  }
  if (pagination.finalSegmentOverflow) {
    warn(ctx, 'table-final-segment-too-tall',
      `表格 "${table.id}" 的末段余量不足以同时容纳最后数据组和表注/表脚注，可能需要人工分页调整`, table.id)
  }
  // An explicit break on the caption overrides the preceding keepNext chain in Word.
  // Single-line chains can relocate naturally. A chain containing a splittable
  // paragraph may instead start on the old page, so moving its first table segment
  // needs a real chain-start break too. Resolve it without splitting at the caption.
  const forcedChainBreak = !nested && pagination.startOnNewPage &&
    ctx.pageFlow.breakBeforePendingChain(!flowOptions.forceStartOnNewPage)
  const pageBreakBefore = pagination.startOnNewPage && !forcedChainBreak &&
    (flowOptions.forceStartOnNewPage || !((flowOptions.firstPageReservedMm ?? 0) > 0))
  let captionXml: string
  if (bctx.appendix) {
    const numId = ctx.numbering.allocAppendixTableInstance(bctx.appendix.id, bctx.appendix.letter)
    captionXml = emitParagraph(ctx, 'SesAppTblCap', {
      numPr: { numId, ilvl: 0 }, runsXml: captionRuns, numbered,
      pageBreakBefore,
    })
  } else {
    captionXml = emitParagraph(ctx, 'SesTblCap', {
      runsXml: captionRuns, numbered, pageBreakBefore,
    })
  }
  const tableBctx = { ...withScope(bctx, table.id), suppressLandscape: true }
  const headerRowCount = Math.max(0, Math.min(Math.floor(table.headerRowCount), table.rows.length))
  const headerRows = table.rows.slice(0, headerRowCount)
  // paginateTable already groups all header/body rowspan dependencies. Emit that exact
  // plan so segment heights, continuation captions/headers and the final footer agree.
  const bodySegments = pagination.bodySegments
  const continuationHeaderRows = headerRows.map((row, rowIndex) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const maxRepeatedRowspan = headerRowCount - rowIndex
      return cell.rowspan > maxRepeatedRowspan ? { ...cell, rowspan: maxRepeatedRowspan } : cell
    }),
  }))
  const columnLayout = resolveTableColumnWidths(table)
  const columnCount = columnLayout.widths.length
  const label = ctx.labels[table.id]?.label
  let out = ''
  bodySegments.forEach((bodyRows, index) => {
    const lastSegment = index === bodySegments.length - 1
    let segmentCaption = captionXml
    if (index > 0) {
      // 相邻 w:tbl 会被 Word 合并为同一张表；段落级换页同时隔开两个独立片段。
      out += emitParagraph(ctx, 'SesNormal', { runsXml: '<w:r><w:br w:type="page"/></w:r>' })
      if (!label) warn(ctx, 'label-missing', `续表 "${table.id}" 缺少表编号`, table.id)
      segmentCaption = emitParagraph(ctx,
        bctx.appendix ? 'SesAppTblCapCont' : 'SesTblCapCont', {
          runsXml: plainRun(label ? `${label}　` : '表　') + captionRuns + plainRun('（续）'),
        })
    }
    out += renderTableGrid(ctx, {
      ...table,
      rows: [...(index === 0 ? headerRows : continuationHeaderRows), ...bodyRows],
      notes: lastSegment ? table.notes : [],
    }, {
      captionXml: segmentCaption,
      keepTogether: true,
      columnCount,
      ...(columnLayout.custom ? { gridWidthsTwips: columnLayout.widths } : {}),
      notesXml: lastSegment
        ? () => table.notes.map((note) => renderNote(ctx, note, tableBctx, true)).join('')
        : undefined,
      footnotesXml: lastSegment
        ? () => orderTableFootnotes(table.footnotes ?? [], ctx.labels).map((footnote) => {
            const resolved = ctx.labels[footnote.id]
            if (!resolved) throw new Error(`renderTable: 表脚注 "${footnote.id}" 在 labels 中没有编号`)
            return emitParagraph(ctx, 'SesTableFootnote', {
              runsXml: superscriptRun(resolved.refText) + tabRun() + renderInlines(footnote.content, ctx.labels),
            })
          }).join('')
        : undefined,
      renderCell(cell, styleId) {
        if (cell.content.length === 0 || cell.content.every((block) => block.kind === 'paragraph' &&
          // Empty source text may still render a footnote or a resolved cross-reference.
          block.content.every((run) => renderRun({ ...run, text: run.text.trim() }, ctx.labels) === ''))) return ''
        return cell.content.map((block) => block.kind === 'paragraph'
          ? emitParagraph(ctx, styleId, { runsXml: renderInlines(block.content, ctx.labels) })
          : renderBlock(ctx, block, tableBctx)).join('')
      },
    })
  })
  if (!nested) ctx.pageFlow.placeTable(pagination.segmentHeightsMm, pagination.startOnNewPage)
  return out
}

// ---------------- 通用分发 ----------------

export function renderBlock(ctx: RenderContext, block: IRBlock, bctx: BlockCtx): string {
  if (bctx.suppressLandscape) return renderBlockContent(ctx, block, bctx)
  const landscape = (block.kind === 'figure' || block.kind === 'table') && block.orientation === 'landscape'
  return ctx.pageFlow.withElement(landscape, () => renderBlockContent(ctx, block, bctx))
}

function renderBlockContent(ctx: RenderContext, block: IRBlock, bctx: BlockCtx): string {
  if (!bctx.suppressLandscape && (block.kind === 'figure' || block.kind === 'table') && block.orientation === 'landscape') {
    const xml = block.kind === 'figure' ? renderFigure(ctx, block, bctx) : renderTable(ctx, block, bctx)
    return `${LANDSCAPE_START}${xml}${LANDSCAPE_END}`
  }
  switch (block.kind) {
    case 'paragraph':
      return emitParagraph(ctx, 'SesPara', { runsXml: renderInlines(block.content, ctx.labels) })
    case 'list':
      return renderList(ctx, block, bctx)
    case 'table':
      return renderTable(ctx, block, bctx)
    case 'figure':
      return renderFigure(ctx, block, bctx)
    case 'formula':
      return renderFormula(ctx, block, ctx.resources.formulaOmml[block.id])
    case 'note':
      return renderNote(ctx, block, bctx)
    case 'example':
      return renderExample(ctx, block, bctx)
    case 'warning':
    case 'quote':
    case 'code':
      throw new Error(`DOCX 尚未支持 ${block.kind}（节点 ${block.id}）`)
  }
}

export function renderBlocks(ctx: RenderContext, blocks: IRBlock[], bctx: BlockCtx): string {
  return blocks.map((b) => renderBlock(ctx, b, bctx)).join('')
}
