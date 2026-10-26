/**
 * DOCX 表格网格渲染（docs/wp7-docx-delivery.md §5.9）。
 *
 * 本模块负责 Word 表格结构、网格宽度、合并单元格、重复表头和表注行。调用方负责递归渲染
 * IR 单元格内容及表注，以便注/示例继续使用 block.ts 的既有编号和追踪路径。
 * 表题/续表题是表外的独立段落，由调用方（block.ts）在 w:tbl 之前输出，本模块不再生成表题行。
 */

import type { IRTable, IRTableRow } from '../../../ir/types'
import { emitParagraph, type RenderContext } from './context'
import { plainRun } from './inline'
import { buildTableGrid, type GridCell } from './tableGrid'
import { resolveTableColumnWidths } from './tableColumnWidths'
export { tableGridColumnCount } from './tableGrid'
import { tcBorders, tcPr, tbl, tblBorders, tblPr, tr, trPr, type XmlChild } from '../xml'

export type IRTableCell = IRTableRow['cells'][number]
export type TableCellParagraphStyle = 'SesTableText' | 'SesTableCenter' | 'SesTableHeader'

export interface TableCellRenderMeta {
  rowIndex: number
  columnIndex: number
  /** 来自表格头部行数或 IR cell.header。 */
  header: boolean
}

export interface TableGridRenderOptions {
  /** 小表/每个分段按整段保留；放不下时 Word 将整段移至下一页。 */
  keepTogether?: boolean
  /**
   * Word 自然分页的长表：只保护表头不与首个数据行分离、跨行合并组不被拆开、
   * 末个数据行不与表注/表脚注分离，其余行可在任意行边界跨页（表头行逐页重复）。
   */
  keepEdges?: boolean
  /** 首行（表头第 1 行）单元格显式写粗上边框，使跨页重复的表头保留外框；表题在表外，表格首行即首个表头行。 */
  strongTopBorder?: boolean
  /** 分段续表沿用原表的完整列数，避免不同片段列宽变化。 */
  columnCount?: number
  /** 完整原表的列宽，所有续段沿用；单位为twips。 */
  gridWidthsTwips?: readonly number[]
  /** 单元格内容由块分发器递归渲染，paragraphStyle 是其中普通段落的默认样式。 */
  renderCell: (cell: IRTableCell, paragraphStyle: TableCellParagraphStyle, meta: TableCellRenderMeta) => string
  /** 已按 SesTableNote 与 §5.7 编号输出的表注段落；独立合并行为表尾第一行。 */
  notesXml?: string | (() => string)
  /** 已按 SesTableFootnote 输出的表脚注；独立合并行为表尾末行。 */
  footnotesXml?: string | (() => string)
}

const NUMERIC_CELL_TEXT = /^[\d\s.,±%~—-]+$/

/**
 * Table cell text is deliberately narrow: composite content is left aligned unless the cell is a
 * header. It mirrors the exact numeric pattern in §5.9 and avoids treating arbitrary lists as data.
 */
export function tableCellParagraphStyle(cell: IRTableCell, header = cell.header): TableCellParagraphStyle {
  if (header) return 'SesTableHeader'
  if (cell.content.length === 0) return 'SesTableCenter'
  if (!cell.content.every((block) => block.kind === 'paragraph')) return 'SesTableText'
  const text = cell.content.flatMap((block) => block.kind === 'paragraph' ? block.content.map((run) => run.text) : []).join('')
  if (text.trim() === '' || NUMERIC_CELL_TEXT.test(text)) return 'SesTableCenter'
  return 'SesTableText'
}

function borderXml(size: number): string {
  const border = (side: string, thickness: number): XmlChild => [
    side,
    `<w:${side} w:val="single" w:sz="${thickness}" w:space="0" w:color="auto"/>`,
  ]
  return tblBorders([
    border('top', size), border('left', size), border('bottom', size), border('right', size),
    border('insideH', 2), border('insideV', 2),
  ])
}

function cellBorderXml(sides: Array<'top' | 'bottom'>, size: number): string {
  return tcBorders(sides.map((side) => [side, `<w:${side} w:val="single" w:sz="${size}" w:space="0" w:color="auto"/>`]))
}

function cellWidth(widths: number[], columnIndex: number, colspan: number): number {
  let total = 0
  for (let i = columnIndex; i < columnIndex + colspan; i += 1) total += widths[i] ?? 0
  return total
}

function cellXml(
  ctx: RenderContext,
  gridCell: GridCell,
  widths: number[],
  rowIndex: number,
  headerRowCount: number,
  options: TableGridRenderOptions,
): string {
  const width = cellWidth(widths, gridCell.columnIndex, gridCell.colspan)
  const tcPrChildren: XmlChild[] = [['tcW', `<w:tcW w:w="${width}" w:type="dxa"/>`]]
  if (gridCell.colspan > 1) tcPrChildren.push(['gridSpan', `<w:gridSpan w:val="${gridCell.colspan}"/>`])

  if (gridCell.kind === 'continuation') tcPrChildren.push(['vMerge', '<w:vMerge/>'])
  else if (gridCell.kind === 'origin' && gridCell.origin!.rowspan > 1) tcPrChildren.push(['vMerge', '<w:vMerge w:val="restart"/>'])

  const strongBorders: Array<'top' | 'bottom'> = []
  if (options.strongTopBorder && rowIndex === 0) strongBorders.push('top')
  if (headerRowCount > 0 && rowIndex === headerRowCount - 1) strongBorders.push('bottom')
  if (strongBorders.length > 0) tcPrChildren.push(['tcBorders', cellBorderXml(strongBorders, 6)])

  let contentXml: string
  if (gridCell.kind === 'continuation') {
    contentXml = '<w:p/>'
  } else if (gridCell.kind === 'filler') {
    contentXml = emitParagraph(ctx, rowIndex < headerRowCount ? 'SesTableHeader' : 'SesTableCenter', { runsXml: plainRun('—') })
  } else {
    const origin = gridCell.origin!
    const isHeader = origin.cell.header || rowIndex < headerRowCount
    contentXml = options.renderCell(origin.cell, tableCellParagraphStyle(origin.cell, isHeader), {
      rowIndex,
      columnIndex: origin.columnIndex,
      header: isHeader,
    })
    if (contentXml.trim() === '') {
      contentXml = emitParagraph(ctx, isHeader ? 'SesTableHeader' : 'SesTableCenter', { runsXml: plainRun('—') })
    } else if (!/<\/w:p>\s*$/.test(contentXml)) {
      // Word requires a final paragraph in a cell after nested tables and other block-level content.
      contentXml += '<w:p/>'
    }
  }

  return `<w:tc>${tcPr(tcPrChildren)}${contentXml}</w:tc>`
}

function noteRowXml(widths: number[], columnCount: number, notesXml: string, kind: 'notes' | 'footnotes', topBorderSize: 2 | 6): string {
  const width = widths.reduce((sum, value) => sum + value, 0)
  const tcPrXml = tcPr([
    ['tcW', `<w:tcW w:w="${width}" w:type="dxa"/>`],
    ...(columnCount > 1 ? [['gridSpan', `<w:gridSpan w:val="${columnCount}"/>`] as const] : []),
    ['tcBorders', cellBorderXml(['top'], topBorderSize)],
    // Word's default 100-twip cell inset shifts the footnote paragraph away from the table frame.
    // Zero only the footnote row's left inset so its 9pt fourth-character tab aligns to that frame.
    ...(kind === 'footnotes' ? [['tcMar', '<w:tcMar><w:left w:w="0" w:type="dxa"/></w:tcMar>'] as const] : []),
  ])
  return tr([
    ['trPr', trPr([['cantSplit', '<w:cantSplit/>']])],
    ['tc', `<w:tc>${tcPrXml}${notesXml}</w:tc>`],
  ])
}

function keepRowWithNext(rowXml: string): string {
  return rowXml.replace(/<w:p>([\s\S]*?)<\/w:p>|<w:p\/>/g, (paragraph) => {
    if (paragraph === '<w:p/>') return '<w:p><w:pPr><w:keepNext/></w:pPr></w:p>'
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(paragraph)?.[0]
    if (!pPr || pPr.includes('<w:keepNext')) return paragraph
    const styleEnd = pPr.indexOf('/>')
    const insertAt = styleEnd >= 0 && pPr.slice(0, styleEnd).includes('<w:pStyle')
      ? styleEnd + 2 : '<w:pPr>'.length
    const updated = pPr.slice(0, insertAt) + '<w:keepNext/>' + pPr.slice(insertAt)
    return paragraph.replace(pPr, updated)
  })
}

/** Build one complete w:tbl; caption paragraph (outside the table) and note numbering remain with the caller. */
export function renderTableGrid(ctx: RenderContext, table: IRTable, options: TableGridRenderOptions): string {
  const grid = buildTableGrid(table, options.columnCount)
  const resolvedWidths = resolveTableColumnWidths(table, grid.columnCount)
  const widths = options.gridWidthsTwips ? [...options.gridWidthsTwips] : resolvedWidths.widths
  if (widths.length !== grid.columnCount) throw new Error('续表列宽数量与网格列数不一致')
  const hasCustomWidths = !!options.gridWidthsTwips || resolvedWidths.custom
  const requestedHeaderRowCount = Number.isFinite(table.headerRowCount) ? Math.floor(table.headerRowCount) : 0
  const headerRowCount = Math.max(0, Math.min(requestedHeaderRowCount, table.rows.length))
  const rows = grid.rows.length > 0 ? grid.rows : [[{ kind: 'filler' as const, columnIndex: 0, colspan: 1 }]]
  const gridXml = `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`
  const tblPrXml = tblPr([
    ['tblW', hasCustomWidths
      ? `<w:tblW w:w="${widths.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/>`
      : '<w:tblW w:w="5000" w:type="pct"/>'],
    ['jc', '<w:jc w:val="center"/>'],
    ['tblBorders', borderXml(6)],
    ['tblLayout', '<w:tblLayout w:type="fixed"/>'],
  ])
  const rowsXml = rows.map((cells, rowIndex) => {
    const trPrXml = trPr([
      ['cantSplit', '<w:cantSplit/>'],
      ...(rowIndex < headerRowCount ? [['tblHeader', '<w:tblHeader/>'] as const] : []),
    ])
    const rowChildren = [] as Array<readonly [string, string]>
    rowChildren.push(['trPr', trPrXml])
    for (const cell of cells) rowChildren.push(['tc', cellXml(ctx, cell, widths, rowIndex, headerRowCount, options)])
    return tr(rowChildren)
  })
  const notes = (typeof options.notesXml === 'function' ? options.notesXml() : options.notesXml)?.trim() ?? ''
  const footnotes = (typeof options.footnotesXml === 'function' ? options.footnotesXml() : options.footnotesXml)?.trim() ?? ''
  const tableNotesRow = notes.length > 0 ? noteRowXml(widths, grid.columnCount, notes, 'notes', 6) : ''
  const tableFootnotesRow = footnotes.length > 0 ? noteRowXml(widths, grid.columnCount, footnotes, 'footnotes', tableNotesRow ? 2 : 6) : ''
  const allRows = [...rowsXml,
    ...(tableNotesRow ? [tableNotesRow] : []), ...(tableFootnotesRow ? [tableFootnotesRow] : [])]
  // keepEdges（自然分页）逐行决定是否与下一行同页：表头行、被合并单元格贯穿的行必须与下一行相连；
  // 数据末行与表注行、表注行与表脚注行相连。其余行不加 keepNext，让 Word 在任意行边界跨页。
  const keepFlags: boolean[] = options.keepEdges ? [
    ...rows.map((_cells, rowIndex) => rowIndex < headerRowCount ||
      (rows[rowIndex + 1]?.some((cell) => cell.kind === 'continuation') ?? false)),
    ...(tableNotesRow ? [tableFootnotesRow !== ''] : []),
    ...(tableFootnotesRow ? [false] : []),
  ] : []
  if (options.keepEdges && (tableNotesRow || tableFootnotesRow)) {
    keepFlags[rows.length - 1] = true
  }
  const renderedRows = allRows.map((row, index) => {
    const keep = options.keepTogether ? true : options.keepEdges ? keepFlags[index] === true : false
    return keep && index < allRows.length - 1 ? keepRowWithNext(row) : row
  })

  return tbl([
    ['tblPr', tblPrXml],
    ['tblGrid', gridXml],
    ...renderedRows.map((rowXml) => ['tr', rowXml] as const),
  ])
}
