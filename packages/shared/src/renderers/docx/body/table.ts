/**
 * DOCX 表格网格渲染（docs/wp7-docx-delivery.md §5.9）。
 *
 * 本模块负责 Word 表格结构、网格宽度、合并单元格、重复表头和表注行。调用方负责递归渲染
 * IR 单元格内容及表注，以便注/示例继续使用 block.ts 的既有编号和追踪路径。
 */

import type { IRTable, IRTableRow } from '../../../ir/types'
import { emitParagraph, type RenderContext } from './context'
import { plainRun } from './inline'
import { mmToTwips } from '../units'
import { tcBorders, tcPr, tbl, tblBorders, tblPr, tr, trPr, type XmlChild } from '../xml'

export type IRTableCell = IRTableRow['cells'][number]
export type TableCellParagraphStyle = 'SesTableText' | 'SesTableCenter'

export interface TableCellRenderMeta {
  rowIndex: number
  columnIndex: number
  /** 来自表格头部行数或 IR cell.header。 */
  header: boolean
}

export interface TableGridRenderOptions {
  /** 表题放在第一个重复标题行，Word 自动跨页时与列标题一起复现。 */
  captionXml?: string
  /** 小表/每个分段按整段保留；放不下时 Word 将整段移至下一页。 */
  keepTogether?: boolean
  /** 分段续表沿用原表的完整列数，避免不同片段列宽变化。 */
  columnCount?: number
  /** 单元格内容由块分发器递归渲染，paragraphStyle 是其中普通段落的默认样式。 */
  renderCell: (cell: IRTableCell, paragraphStyle: TableCellParagraphStyle, meta: TableCellRenderMeta) => string
  /** 已按 SesTableNote 与 §5.7 编号输出的表注段落；非空时作为表格最后一行。 */
  notesXml?: string | (() => string)
}

interface OriginCell {
  kind: 'origin'
  cell: IRTableCell
  rowIndex: number
  columnIndex: number
  colspan: number
  rowspan: number
}

interface GridCell {
  kind: 'origin' | 'continuation' | 'filler'
  origin?: OriginCell
  columnIndex: number
  colspan: number
}

interface TableGrid {
  columnCount: number
  rows: GridCell[][]
}

const NUMERIC_CELL_TEXT = /^[\d\s.,±%~—-]+$/

/**
 * Table cell text is deliberately narrow: composite content is left aligned unless the cell is a
 * header. It mirrors the exact numeric pattern in §5.9 and avoids treating arbitrary lists as data.
 */
export function tableCellParagraphStyle(cell: IRTableCell, header = cell.header): TableCellParagraphStyle {
  if (header) return 'SesTableCenter'
  if (cell.content.length === 0) return 'SesTableCenter'
  if (!cell.content.every((block) => block.kind === 'paragraph')) return 'SesTableText'
  const text = cell.content.flatMap((block) => block.kind === 'paragraph' ? block.content.map((run) => run.text) : []).join('')
  if (text.trim() === '' || NUMERIC_CELL_TEXT.test(text)) return 'SesTableCenter'
  return 'SesTableText'
}

function positiveSpan(value: number, axis: string, cellId: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`renderTableGrid: 单元格 "${cellId}" 的 ${axis} 必须为正整数，收到 ${String(value)}`)
  }
  return value
}

/** Expand the IR spans into an explicit, rectangular OOXML grid, including vertical merge cells. */
function buildTableGrid(table: IRTable, minimumColumnCount = 1): TableGrid {
  const rowCount = table.rows.length
  const occupied: Array<Array<OriginCell | undefined>> = Array.from({ length: rowCount }, () => [])
  let columnCount = 0

  table.rows.forEach((row, rowIndex) => {
    let cursor = 0
    for (const cell of row.cells) {
      const colspan = positiveSpan(cell.colspan, 'colspan', cell.id)
      const rowspan = positiveSpan(cell.rowspan, 'rowspan', cell.id)
      if (rowIndex + rowspan > rowCount) {
        throw new Error(`renderTableGrid: 单元格 "${cell.id}" 的 rowspan 超出表格末行`)
      }

      let columnIndex = cursor
      // A merged cell occupies every covered column in every later row. Find the next contiguous
      // region where this cell can fit; final row expansion inserts continuation and empty cells.
      while (true) {
        let overlaps = false
        for (let offset = 0; offset < colspan; offset += 1) {
          if (occupied[rowIndex][columnIndex + offset]) {
            overlaps = true
            break
          }
        }
        if (!overlaps) break
        columnIndex += 1
      }

      const origin: OriginCell = { kind: 'origin', cell, rowIndex, columnIndex, colspan, rowspan }
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
        for (let c = columnIndex; c < columnIndex + colspan; c += 1) {
          if (occupied[r][c]) throw new Error(`renderTableGrid: 单元格 "${cell.id}" 与已有合并区域重叠`)
          occupied[r][c] = origin
        }
      }
      columnCount = Math.max(columnCount, columnIndex + colspan)
      cursor = columnIndex + colspan
    }
  })

  // An empty table still needs one grid column to keep tblGrid and tblW structurally meaningful.
  columnCount = Math.max(1, minimumColumnCount, columnCount)
  const rows: GridCell[][] = table.rows.map((_row, rowIndex) => {
    const cells: GridCell[] = []
    let columnIndex = 0
    while (columnIndex < columnCount) {
      const origin = occupied[rowIndex][columnIndex]
      if (!origin) {
        cells.push({ kind: 'filler', columnIndex, colspan: 1 })
        columnIndex += 1
        continue
      }
      if (origin.rowIndex === rowIndex) {
        cells.push({ kind: 'origin', origin, columnIndex, colspan: origin.colspan })
      } else if (columnIndex === origin.columnIndex) {
        cells.push({ kind: 'continuation', origin, columnIndex, colspan: origin.colspan })
      } else {
        // This is the interior of a colspan already emitted at origin.columnIndex.
        columnIndex += 1
        continue
      }
      columnIndex += origin.colspan
    }
    return cells
  })
  return { columnCount, rows }
}

export function tableGridColumnCount(table: IRTable): number {
  return buildTableGrid(table).columnCount
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

function gridWidths(columnCount: number, table: IRTable): number[] {
  // §2.1 fixes the portrait text width at 9355 twips; 252 mm rounds to 14287 twips.
  const width = table.orientation === 'landscape' ? mmToTwips(252) : 9355
  const base = Math.floor(width / columnCount)
  const remainder = width - base * columnCount
  return Array.from({ length: columnCount }, (_unused, index) => base + (index < remainder ? 1 : 0))
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
  if (options.captionXml && rowIndex === 0) strongBorders.push('top')
  if (headerRowCount > 0 && rowIndex === headerRowCount - 1) strongBorders.push('bottom')
  if (strongBorders.length > 0) tcPrChildren.push(['tcBorders', cellBorderXml(strongBorders, 6)])

  let contentXml: string
  if (gridCell.kind === 'continuation') {
    contentXml = '<w:p/>'
  } else if (gridCell.kind === 'filler') {
    contentXml = emitParagraph(ctx, 'SesTableCenter', { runsXml: plainRun('—') })
  } else {
    const origin = gridCell.origin!
    const isHeader = origin.cell.header || rowIndex < headerRowCount
    contentXml = options.renderCell(origin.cell, tableCellParagraphStyle(origin.cell, isHeader), {
      rowIndex,
      columnIndex: origin.columnIndex,
      header: isHeader,
    })
    if (contentXml.trim() === '') {
      contentXml = emitParagraph(ctx, 'SesTableCenter', { runsXml: plainRun('—') })
    } else if (!/<\/w:p>\s*$/.test(contentXml)) {
      // Word requires a final paragraph in a cell after nested tables and other block-level content.
      contentXml += '<w:p/>'
    }
  }

  return `<w:tc>${tcPr(tcPrChildren)}${contentXml}</w:tc>`
}

function noteRowXml(widths: number[], columnCount: number, notesXml: string): string {
  const width = widths.reduce((sum, value) => sum + value, 0)
  const tcPrXml = tcPr([
    ['tcW', `<w:tcW w:w="${width}" w:type="dxa"/>`],
    ...(columnCount > 1 ? [['gridSpan', `<w:gridSpan w:val="${columnCount}"/>`] as const] : []),
    ['tcBorders', cellBorderXml(['top'], 6)],
  ])
  return tr([
    ['trPr', trPr([['cantSplit', '<w:cantSplit/>']])],
    ['tc', `<w:tc>${tcPrXml}${notesXml}</w:tc>`],
  ])
}

function captionRowXml(widths: number[], columnCount: number, captionXml: string): string {
  const width = widths.reduce((sum, value) => sum + value, 0)
  const nilBorder = (side: 'top' | 'left' | 'bottom' | 'right'): XmlChild =>
    [side, `<w:${side} w:val="nil"/>`]
  const captionCellPr = tcPr([
    ['tcW', `<w:tcW w:w="${width}" w:type="dxa"/>`],
    ...(columnCount > 1 ? [['gridSpan', `<w:gridSpan w:val="${columnCount}"/>`] as const] : []),
    ['tcBorders', tcBorders([
      nilBorder('top'), nilBorder('left'), nilBorder('bottom'), nilBorder('right'),
    ])],
  ])
  return tr([
    ['trPr', trPr([['cantSplit', '<w:cantSplit/>'], ['tblHeader', '<w:tblHeader/>']])],
    ['tc', `<w:tc>${captionCellPr}${captionXml}</w:tc>`],
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

/** Build one complete w:tbl; caption and note paragraph numbering remain with the caller. */
export function renderTableGrid(ctx: RenderContext, table: IRTable, options: TableGridRenderOptions): string {
  const grid = buildTableGrid(table, options.columnCount)
  const widths = gridWidths(grid.columnCount, table)
  const requestedHeaderRowCount = Number.isFinite(table.headerRowCount) ? Math.floor(table.headerRowCount) : 0
  const headerRowCount = Math.max(0, Math.min(requestedHeaderRowCount, table.rows.length))
  const rows = grid.rows.length > 0 ? grid.rows : [[{ kind: 'filler' as const, columnIndex: 0, colspan: 1 }]]
  const gridXml = `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`
  const tblPrXml = tblPr([
    ['tblW', '<w:tblW w:w="5000" w:type="pct"/>'],
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
  const tableNotesRow = notes.length > 0 ? noteRowXml(widths, grid.columnCount, notes) : ''
  const captionRow = options.captionXml ? captionRowXml(widths, grid.columnCount, options.captionXml) : ''
  const allRows = [...(captionRow ? [captionRow] : []), ...rowsXml, ...(tableNotesRow ? [tableNotesRow] : [])]
  const renderedRows = options.keepTogether
    ? allRows.map((row, index) => index < allRows.length - 1 ? keepRowWithNext(row) : row)
    : allRows

  return tbl([
    ['tblPr', tblPrXml],
    ['tblGrid', gridXml],
    ...renderedRows.map((rowXml) => ['tr', rowXml] as const),
  ])
}
