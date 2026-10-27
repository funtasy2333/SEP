/**
 * 块级要素渲染（docs/wp7-docx-delivery.md §4.4、§5.6–§5.10）。
 *
 * `renderBlock`/`renderBlocks` 是通用块分发入口：段落、列项、图/表/公式、
 * 注、示例都从这里分发，互相递归（列表项内容可以是段落或嵌套列表；注/示例内容可以是任意块）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRBlock, IRDefList, IRExample, IRFigure, IRList, IRNote, IRParagraph, IRTable, NodeId } from '../../../ir/types'
import { ABSTRACT_NUM_ID, listAbstractNumId } from '../numbering'
import { emitParagraph, formulaSink, warn, type RenderContext } from './context'
import { plainRun, renderInlines, renderRun, superscriptRun, tabRun } from './inline'
import { renderFigureImage } from './figure'
import { renderTableGrid, type TableGridRenderOptions } from './table'
import { resolveTableColumnWidths } from './tableColumnWidths'
import type { TableFlowBudget } from './pageFlow'
import { paginateTable, SMALL_TABLE_MM } from './tablePagination'
import { renderFormula } from './formula'
import { renderNormRefList } from './normRef'
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
  /** 当前位于引言中的条内（WP8.M G6）：条与术语条目编号改用 A17（0.1…）的按需实例，而不是章条的 A1 */
  introduction?: boolean
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
      out += emitParagraph(ctx, plan.contStyleId, { runsXml: renderInlines(block.content, ctx.labels, formulaSink(ctx)) })
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
        runsXml: renderInlines((first as IRParagraph).content, ctx.labels, formulaSink(ctx)),
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

// ---------------- 缩略语表（WP8.M G2，设计 7.1 本阶段排版） ----------------

/**
 * 缩略语表（M-10.1.4-01/-03/-04/-05）：每项一个段落，缩略语在前、释义在后，中间是全角冒号“：”、不加空格
 * （GB/T 46687.2—2026 印刷页 2 的 3.2 缩略语实排；冒号只在渲染时添加，IR 与 PM 中不存；与 HTML 一致）。沿用 SesPara（首行空两个汉字起排、回行顶格，GB/T 1.1-2020 条文段落式排版），
 * 不新增样式、不进入任何编号（缩略语项没有序号；其 abb_<k> 只用于 crossRef 的目标）。
 */
function renderDefList(ctx: RenderContext, list: IRDefList): string {
  let out = ''
  for (const item of list.items) {
    const runs = renderInlines(item.term, ctx.labels, formulaSink(ctx)) + plainRun('：')
      + renderInlines(item.definition, ctx.labels, formulaSink(ctx))
    out += emitParagraph(ctx, 'SesPara', { runsXml: runs })
  }
  return out
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
      out += emitParagraph(ctx, contStyleId, { runsXml: renderInlines(block.content, ctx.labels, formulaSink(ctx)) })
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
    let out = emitParagraph(ctx, firstStyleId, { numPr: firstNumPr, runsXml: renderInlines(first.content, ctx.labels, formulaSink(ctx)), numbered })
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

/** 警告里的表称谓：编号只取自 Resolver labels，缺失时退回节点 id，绝不自行编号。 */
function tableRef(ctx: RenderContext, table: IRTable): string {
  return ctx.labels[table.id]?.label ?? `表格 "${table.id}"`
}

/** 表题段落（§4.7 编号追踪、附录实例）。split/natural 一律作为 w:tbl 之前的独立段落，不进表格。 */
function emitTableCaption(ctx: RenderContext, table: IRTable, bctx: BlockCtx, captionRuns: string): string {
  const numbered = { nodeId: table.id, kind: 'table' as const }
  if (bctx.appendix) {
    const numId = ctx.numbering.allocAppendixTableInstance(bctx.appendix.id, bctx.appendix.letter)
    return emitParagraph(ctx, 'SesAppTblCap', { numPr: { numId, ilvl: 0 }, runsXml: captionRuns, numbered })
  }
  return emitParagraph(ctx, 'SesTblCap', { runsXml: captionRuns, numbered })
}

type TableGridContent = Pick<TableGridRenderOptions,
  'columnCount' | 'gridWidthsTwips' | 'notesXml' | 'footnotesXml' | 'renderCell'>

/** split 与 natural 共用：列宽、单元格内容、表注与表脚注。 */
function tableGridContent(
  ctx: RenderContext, table: IRTable, tableBctx: BlockCtx, columnLayout: ReturnType<typeof resolveTableColumnWidths>,
): TableGridContent {
  return {
    columnCount: columnLayout.widths.length,
    ...(columnLayout.custom ? { gridWidthsTwips: columnLayout.widths } : {}),
    notesXml: () => table.notes.map((note) => renderNote(ctx, note, tableBctx, true)).join(''),
    footnotesXml: () => orderTableFootnotes(table.footnotes ?? [], ctx.labels).map((footnote) => {
      const resolved = ctx.labels[footnote.id]
      if (!resolved) throw new Error(`renderTable: 表脚注 "${footnote.id}" 在 labels 中没有编号`)
      return emitParagraph(ctx, 'SesTableFootnote', {
        runsXml: superscriptRun(resolved.refText) + tabRun() + renderInlines(footnote.content, ctx.labels, formulaSink(ctx)),
      })
    }).join(''),
    renderCell(cell, styleId, meta) {
      if (cell.content.length === 0 || cell.content.every((block) => block.kind === 'paragraph' &&
        // Empty source text may still render a footnote or a resolved cross-reference.
        block.content.every((run) => !run.formula && renderRun({ ...run, text: run.text.trim() }, ctx.labels) === ''))) return ''
      return cell.content.map((block) => {
        if (block.kind !== 'paragraph') return renderBlock(ctx, block, tableBctx)
        // 表头统一使用常规字重；源稿导入的直接粗体也要清除，但不能改写编辑器/IR 数据。
        const content = meta.header ? block.content.map(run => ({
          ...run, marks: run.marks?.filter(mark => mark.type !== 'bold'),
        })) : block.content
        return emitParagraph(ctx, styleId, { runsXml: renderInlines(content, ctx.labels, formulaSink(ctx)) })
      }).join('')
    },
  }
}

function renderTableContent(ctx: RenderContext, table: IRTable, bctx: BlockCtx, nested: boolean): string {
  // 嵌套表不参与外层页流，不查询页余量，整表按自然排法输出。
  if (nested) return renderNaturalTable(ctx, table, bctx, 'nested')
  const budget = ctx.pageFlow.beforeTable()
  // 页位置无法可靠估算时不再猜测、也不写强制分页：整表退回 Word 自然分页。
  if (budget.positionUnknown) return renderNaturalTable(ctx, table, bctx, 'unknown-position')
  return renderSplitTable(ctx, table, bctx, budget)
}

/**
 * 页位置已知：按估算拆成多个 Word 表段。表题是首段之前的独立段落（SesTblCap/SesAppTblCap，keepNext）；
 * 每个续段前是一个独立的续表题段「表X　表题（续）」（SesTblCapCont/SesAppTblCapCont），自带 `pageBreakBefore`
 * 另起一页，紧接续段表格（首行为重复的表头行）。不再输出含 `w:br page` 的空分隔段：续表题段本身就隔开了
 * 相邻的两个 w:tbl，在 Word 里合并续表只需删除续表题段和重复的表头行。
 * 首段是否落在新页只用于页流记账：首段之前不写任何 pageBreakBefore，整段 keepNext 让 Word 自然推移。
 */
function renderSplitTable(ctx: RenderContext, table: IRTable, bctx: BlockCtx, budget: TableFlowBudget): string {
  const captionRuns = renderInlines(table.caption, ctx.labels)
  const pagination = paginateTable(table, budget)
  const label = ctx.labels[table.id]?.label
  const ref = tableRef(ctx, table)
  if (pagination.oversizedGroup) {
    warn(ctx, 'table-row-too-tall',
      `${ref} 存在超出单页高度预算的跨行合并组，续表分页可能需要人工调整`, table.id, label)
  }
  if (pagination.footerTooTall) {
    warn(ctx, 'table-footer-too-tall',
      `${ref} 的表题、重复表头与表尾组合超过单页高度预算，可能需要人工分页调整`, table.id, label)
  }
  if (pagination.finalSegmentOverflow) {
    warn(ctx, 'table-final-segment-too-tall',
      `${ref} 的末段余量不足以同时容纳最后数据组和表注/表脚注，可能需要人工分页调整`, table.id, label)
  }
  const captionXml = emitTableCaption(ctx, table, bctx, captionRuns)
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
  const content = tableGridContent(ctx, table, tableBctx, columnLayout)
  let out = captionXml
  bodySegments.forEach((bodyRows, index) => {
    const lastSegment = index === bodySegments.length - 1
    if (index > 0) {
      // 续表题段独立于表格：段前分页另起一页，同时隔开相邻的两个 w:tbl（否则 Word 会把它们合并为一张表）。
      if (!label) warn(ctx, 'label-missing', `续表 "${table.id}" 缺少表编号`, table.id)
      out += emitParagraph(ctx, bctx.appendix ? 'SesAppTblCapCont' : 'SesTblCapCont', {
        pageBreakBefore: true,
        runsXml: plainRun(label ? `${label}　` : '表　') + captionRuns + plainRun('（续）'),
      })
    }
    out += renderTableGrid(ctx, {
      ...table,
      rows: [...(index === 0 ? headerRows : continuationHeaderRows), ...bodyRows],
      notes: lastSegment ? table.notes : [],
    }, {
      ...content,
      strongTopBorder: true,
      keepTogether: true,
      notesXml: lastSegment ? content.notesXml : undefined,
      footnotesXml: lastSegment ? content.footnotesXml : undefined,
    })
  })
  ctx.pageFlow.placeTable(pagination.segmentHeightsMm, pagination.startOnNewPage)
  return out
}

type NaturalReason = 'unknown-position' | 'nested'

/**
 * Word 自然分页：整张表一个 w:tbl，不拆分、不写 w:br/pageBreakBefore。
 * 仅用于页位置未知时的兜底与嵌套表；页位置已知的顶层表走 renderSplitTable。
 * 表题与 split 一样是表外 keepNext 的独立段落，表头行从第 1 行起连续设 tblHeader 并逐页重复。
 * 跨页时续页只有重复的列标题，没有「表X（续）」。
 */
function renderNaturalTable(ctx: RenderContext, table: IRTable, bctx: BlockCtx, reason: NaturalReason): string {
  // 只借用估算：判断是否可能跨页、有没有超高合并组；不使用其分段。
  const plan = paginateTable(table)
  const label = ctx.labels[table.id]?.label
  const ref = tableRef(ctx, table)
  const continuationName = label ? `「${label}（续）」表题` : '续表表题'
  // 小表整体保留（keepNext），不会跨页，与拆分排法没有区别，也不必提醒。
  const mayBreak = plan.totalHeightMm > SMALL_TABLE_MM
  if (mayBreak && reason === 'unknown-position') {
    warn(ctx, 'table-flow-natural-fallback',
      `${ref} 之前的页位置无法可靠估算（公式高度、可拆分标题链或前面的自然分页表等），` +
      `已改为 Word 自然分页：整表输出、表头逐页重复，续页没有${continuationName}，请在 Word 中复核分页并按需补写`,
      table.id, label)
  }
  if (plan.oversizedGroup) {
    warn(ctx, 'table-row-too-tall',
      `${ref} 存在超出单页高度预算的跨行合并组，分页可能需要人工调整`, table.id, label)
  }
  const headerRowCount = Math.max(0, Math.min(Math.floor(table.headerRowCount), table.rows.length))
  if (mayBreak && table.rows.slice(0, headerRowCount).some((row, rowIndex) =>
      row.cells.some((cell) => cell.rowspan > headerRowCount - rowIndex))) {
    warn(ctx, 'table-header-rowspan-pagination',
      `${ref} 的表头单元格合并跨入数据行；自然分页时续页只重复前 ${headerRowCount} 个表头行，被合并的单元格会被截断，请在 Word 中核对`,
      table.id, label)
  }
  const captionXml = emitTableCaption(ctx, table, bctx, renderInlines(table.caption, ctx.labels))
  const tableBctx = { ...withScope(bctx, table.id), suppressLandscape: true }
  const content = tableGridContent(ctx, table, tableBctx, resolveTableColumnWidths(table))
  const out = captionXml + renderTableGrid(ctx, table, {
    ...content,
    keepTogether: !mayBreak,
    keepEdges: mayBreak,
    strongTopBorder: true,
  })
  if (reason !== 'nested') ctx.pageFlow.placeNaturalTable()
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
      return emitParagraph(ctx, 'SesPara', { runsXml: renderInlines(block.content, ctx.labels, formulaSink(ctx)) })
    case 'list':
      return renderList(ctx, block, bctx)
    case 'table':
      return renderTable(ctx, block, bctx)
    case 'figure':
      return renderFigure(ctx, block, bctx)
    case 'formula':
      return renderFormula(ctx, block, ctx.resources.formulaOmml[block.id])
    case 'defList':
      return renderDefList(ctx, block)
    case 'note':
      return renderNote(ctx, block, bctx)
    case 'example':
      return renderExample(ctx, block, bctx)
    case 'normRefList':
      return renderNormRefList(ctx, block)
    case 'warning':
    case 'quote':
    case 'code':
      throw new Error(`DOCX 尚未支持 ${block.kind}（节点 ${block.id}）`)
  }
}

export function renderBlocks(ctx: RenderContext, blocks: IRBlock[], bctx: BlockCtx): string {
  return blocks.map((b) => renderBlock(ctx, b, bctx)).join('')
}
