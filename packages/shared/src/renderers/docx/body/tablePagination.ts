/**
 * 续表采用独立的 Word 表格片段。Word 的 tblHeader 只会逐页复制同一行，无法只在续页
 * 改写为“（续）”；因此按单页高度预算切分，优先填满前页，续段另起页并重放列标题。
 *
 * 这里的高度是布局估计，用户继续编辑单元格内容后可能需要重新导出或手调分段。
 */
import type { IRBlock, IRTable, IRTableRow } from '../../../ir/types'

export interface TablePagination {
  /** 每段仅列出数据行；表头由调用方在每段之前重放。 */
  bodySegments: IRTableRow[][]
  startOnNewPage: boolean
  oversizedGroup: boolean
  /** 表注和表脚注本身超过估算的单页版心高度。 */
  footerTooTall: boolean
}

function textUnits(value: string): number {
  return [...value].reduce((sum, character) => sum + (character.charCodeAt(0) < 128 ? 0.55 : 1), 0)
}

function textLines(value: string, capacity: number): number {
  return value.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(textUnits(line) / capacity)), 0)
}

function blockLines(block: IRBlock, capacity: number): number {
  switch (block.kind) {
    case 'paragraph':
      return textLines(block.content.map((run) => run.text).join(''), capacity)
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
  // Word 9 pt 表格单行约 4.2 mm、两行约 8.2 mm；保留少量边框/取整余量。
  // 不能继续把短记录的单行下限设为 6 mm，否则会平白增加续表页数。
  return lines * 4.2 + 0.2
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
  const footnoteCapacity = Math.max(8, (landscape ? 73 : 48) - 4)
  const tableFootnoteHeight = (table.footnotes ?? []).reduce((sum, footnote) => {
    const lines = textLines(footnote.content.map((run) => run.text).join(''), footnoteCapacity)
    // Leave space for the separate merged footnote row and its line spacing/border.
    return sum + 6 + lines * 4.2
  }, 0)
  const footerHeight = noteHeight + tableFootnoteHeight
  // A4 竖排样稿的可用版心约 234 mm，再预留 9 mm 给 Word 的布局浮动。
  const pageBudget = landscape ? 135 : 225
  // 表注与表脚注只在末段出现，前页不能逐页重复扣除这份空间。
  const dataBudget = Math.max(30, pageBudget - 8 - headerHeight - 10)
  const finalDataBudget = Math.max(30, dataBudget - footerHeight)
  const groups = bodyGroups(table.rows, headerRowCount)
  const groupHeights = groups.map((group) =>
    group.reduce((sum, row) => sum + rowHeightMm(row, columnCount, landscape), 0))
  const totalHeight = 8 + headerHeight + footerHeight + groupHeights.reduce((sum, height) => sum + height, 0)
  const footerTooTall = footerHeight > pageBudget - 8

  // 小表由 Word 的 keepNext 链保持整体；中长表从新页开始，使首段享有完整版心。
  if (totalHeight <= pageBudget) {
    return {
      bodySegments: [table.rows.slice(headerRowCount)],
      startOnNewPage: totalHeight > 50,
      oversizedGroup: false,
      footerTooTall,
    }
  }

  const oversizedGroup = groupHeights.some((height) => height > dataBudget) ||
    (groupHeights[groupHeights.length - 1] ?? 0) > finalDataBudget
  // 末页采用含脚注的预算；其余页采用完整数据预算。切点选最靠后的合法组，
  // 不再将各段均分，避免每页都留出本可以容纳后续记录的大块空白。
  const prefix = [0]
  for (const height of groupHeights) prefix.push(prefix[prefix.length - 1]! + height)
  const minPages = Array.from({ length: groups.length + 1 }, () => 0)
  for (let start = groups.length - 1; start >= 0; start -= 1) {
    if (prefix[groups.length]! - prefix[start]! <= finalDataBudget || start === groups.length - 1) {
      minPages[start] = 1
      continue
    }
    let end = start + 1
    // 末段必须保留至少一个数据组，不能单独生成只有表头和脚注的续页。
    while (end < groups.length - 1 && prefix[end + 1]! - prefix[start]! <= dataBudget) end += 1
    minPages[start] = 1 + minPages[end]!
  }

  const bodySegments: IRTableRow[][] = []
  let start = 0
  for (let pagesLeft = minPages[0]!; pagesLeft > 1; pagesLeft -= 1) {
    let bestEnd = start + 1
    for (let end = start + 1; end <= groups.length - pagesLeft + 1; end += 1) {
      const height = prefix[end]! - prefix[start]!
      if (end > start + 1 && height > dataBudget) break
      if (minPages[end]! > pagesLeft - 1) continue
      bestEnd = end
    }
    bodySegments.push(groups.slice(start, bestEnd).flat())
    start = bestEnd
  }
  // 只有表头而且表头/表注超预算时，也必须保留表格。
  bodySegments.push(groups.slice(start).flat())
  return { bodySegments, startOnNewPage: true, oversizedGroup, footerTooTall }
}
