/**
 * 续表采用独立的 Word 表格片段。Word 的 tblHeader 只会逐页复制同一行，无法只在续页
 * 改写为“（续）”；因此按保守的单页高度预算切分，续段另起页并重放列标题。
 *
 * 这里的高度是布局估计，用户继续编辑单元格内容后可能需要重新导出或手调分段。
 */
import type { IRBlock, IRTable, IRTableRow } from '../../../ir/types'

export interface TablePagination {
  /** 每段仅列出数据行；表头由调用方在每段之前重放。 */
  bodySegments: IRTableRow[][]
  startOnNewPage: boolean
  oversizedGroup: boolean
}

function textUnits(value: string): number {
  return [...value].reduce((sum, character) => sum + (character.charCodeAt(0) < 128 ? 0.55 : 1), 0)
}

function blockLines(block: IRBlock, capacity: number): number {
  switch (block.kind) {
    case 'paragraph':
      return Math.max(1, Math.ceil(textUnits(block.content.map((run) => run.text).join('')) / capacity))
    case 'list':
      return block.items.reduce((sum, item) =>
        sum + Math.max(1, item.content.reduce((part, child) => part + blockLines(child, capacity), 0)), 0)
    case 'note':
    case 'example':
      return 1 + block.content.reduce((sum, child) => sum + blockLines(child, capacity), 0)
    case 'figure':
    case 'formula':
      return 6
    case 'table':
      return 12
  }
}

function rowHeightMm(row: IRTableRow, columnCount: number, landscape: boolean): number {
  const fullWidthUnits = landscape ? 73 : 48
  const lines = Math.max(1, ...row.cells.map((cell) => {
    const capacity = Math.max(4, fullWidthUnits * cell.colspan / columnCount)
    return Math.max(1, cell.content.reduce((sum, block) => sum + blockLines(block, capacity), 0))
  }))
  return Math.max(6, lines * 4 + 1.5)
}

function bodyGroups(rows: IRTableRow[], headerRowCount: number): IRTableRow[][] {
  const groups: IRTableRow[][] = []
  for (let start = headerRowCount; start < rows.length;) {
    let end = start + 1
    for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
      for (const cell of rows[rowIndex]!.cells) end = Math.max(end, rowIndex + cell.rowspan)
    }
    groups.push(rows.slice(start, Math.min(end, rows.length)))
    start = end
  }
  return groups
}

/** 切分时不穿过 rowspan，且每段以相同的表头行开头。 */
export function paginateTable(table: IRTable): TablePagination {
  const headerRowCount = Math.max(0, Math.min(Math.floor(table.headerRowCount), table.rows.length))
  const columnCount = Math.max(1, ...table.rows.map((row) =>
    row.cells.reduce((sum, cell) => sum + cell.colspan, 0)))
  const landscape = table.orientation === 'landscape'
  const headerHeight = table.rows.slice(0, headerRowCount)
    .reduce((sum, row) => sum + rowHeightMm(row, columnCount, landscape), 0)
  const noteHeight = table.notes.length > 0 ? 10 + table.notes.length * 6 : 0
  // 比实际版心高度留出余量，同时按 Word 样稿的 9 pt 表格文字估算行高。
  const pageBudget = landscape ? 135 : 210
  const dataBudget = Math.max(30, pageBudget - 8 - headerHeight - noteHeight - 10)
  const groups = bodyGroups(table.rows, headerRowCount)
  const groupHeights = groups.map((group) =>
    group.reduce((sum, row) => sum + rowHeightMm(row, columnCount, landscape), 0))
  const totalHeight = 8 + headerHeight + noteHeight + groupHeights.reduce((sum, height) => sum + height, 0)

  // 小表由 Word 的 keepNext 链保持整体；中长表从新页开始，使首段享有完整版心。
  if (totalHeight <= pageBudget) {
    return {
      bodySegments: [table.rows.slice(headerRowCount)],
      startOnNewPage: totalHeight > 50,
      oversizedGroup: false,
    }
  }

  const bodySegments: IRTableRow[][] = []
  let current: IRTableRow[] = []
  let used = 0
  let oversizedGroup = false
  groups.forEach((group, index) => {
    const height = groupHeights[index]!
    if (height > dataBudget) oversizedGroup = true
    if (current.length > 0 && used + height > dataBudget) {
      bodySegments.push(current)
      current = []
      used = 0
    }
    current.push(...group)
    used += height
  })
  if (current.length > 0) bodySegments.push(current)
  return { bodySegments, startOnNewPage: true, oversizedGroup }
}
