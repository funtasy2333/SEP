/**
 * 续表采用独立的 Word 表格片段。Word 的 tblHeader 只会逐页复制同一行，无法只在续页
 * 改写为“（续）”；因此按单页高度预算切分，优先填满前页，续段另起页并重放列标题。
 *
 * 这里的高度是布局估计，用户继续编辑单元格内容后可能需要重新导出或手调分段。
 */
import type { IRBlock, IRTable, IRTableRow } from '../../../ir/types'
import { resolveTableColumnWidths, type TableColumnLayout } from './tableColumnWidths'

export interface TablePagination {
  /** 每段仅列出数据行；表头由调用方在每段之前重放。 */
  bodySegments: IRTableRow[][]
  /** 首段预计落在新页；只用于页流记账，输出不再写强制分页，由首段整段 keepNext 让 Word 自然推移。 */
  startOnNewPage: boolean
  /** 包含表题、表头和末段表尾的估算高度，用于后续正文/表格接排。 */
  segmentHeightsMm: number[]
  /** 整表（表题、表头、全部数据行、表尾）不拆分时的估算总高度。 */
  totalHeightMm: number
  oversizedGroup: boolean
  /** 固定表题/表头/表尾能放入一页，但末段余量容不下普通的最后数据组。 */
  finalSegmentOverflow: boolean
  /** 表题、重复表头与表尾合计超过估算的单页版心高度。 */
  footerTooTall: boolean
}

/** 不高于此估算高度的小表整体保留（不拆分、不跨页），其余表按余量切分或交给 Word 自然分页。 */
export const SMALL_TABLE_MM = 50

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
    case 'warning':
    case 'quote':
    case 'code':
      throw new Error(`DOCX 表格尚未支持 ${block.kind}（节点 ${block.id}）`)
  }
}

function rowHeightMm(row: IRTableRow, columnCount: number, landscape: boolean, layout: TableColumnLayout): number {
  const fullWidthUnits = landscape ? 73 : 48
  const lines = Math.max(1, ...row.cells.map((cell) => {
    const capacity = layout.custom
      ? Math.max(1, fullWidthUnits * Math.max(1, (layout.cellWidths.get(cell.id) ?? 0) - 200) / layout.pageWidthTwips)
      : Math.max(4, fullWidthUnits * cell.colspan / columnCount)
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
    if (start === headerRowCount) {
      rows.slice(0, headerRowCount).forEach((row, rowIndex) => {
        for (const cell of row.cells) end = Math.max(end, rowIndex + cell.rowspan)
      })
    }
    for (let rowIndex = start; rowIndex < Math.min(end, rows.length); rowIndex += 1) {
      for (const cell of rows[rowIndex]!.cells) end = Math.max(end, rowIndex + cell.rowspan)
    }
    groups.push(rows.slice(start, Math.min(end, rows.length)))
    start = end
  }
  return groups
}

export interface TablePaginationOptions {
  firstPageHeightMm?: number
  /** 表前待定同页链移到新页后，首段仍须预留的高度（含脚注）。 */
  firstPageReservedMm?: number
}

/** 切分时不穿过 rowspan，且每段以相同的表头行开头。 */
export function paginateTable(table: IRTable, options: TablePaginationOptions = {}): TablePagination {
  const headerRowCount = Math.max(0, Math.min(Math.floor(table.headerRowCount), table.rows.length))
  const layout = resolveTableColumnWidths(table)
  // 未编辑列宽的历史文档保持既有分页估算；自定义列宽按实际合并网格测量。
  const columnCount = layout.custom ? layout.widths.length : Math.max(1, ...table.rows.map(row =>
    row.cells.reduce((sum, cell) => sum + cell.colspan, 0)))
  const widthScale = layout.custom ? layout.widths.reduce((sum, value) => sum + value, 0) / layout.pageWidthTwips : 1
  const landscape = table.orientation === 'landscape'
  const headerHeight = table.rows.slice(0, headerRowCount)
    .reduce((sum, row) => sum + rowHeightMm(row, columnCount, landscape, layout), 0)
  const noteCapacity = Math.max(layout.custom ? 1 : 8, (landscape ? 73 : 48) * widthScale - 4)
  const noteHeight = table.notes.length > 0 ? 1.2 + table.notes.reduce((sum, note) => sum +
    note.content.reduce((height, block) => height + blockLines(block, noteCapacity) *
      (block.kind === 'paragraph' ? 4.2 : 5.5), 0), 0) : 0
  const footnoteCapacity = Math.max(layout.custom ? 1 : 8, (landscape ? 73 : 48) * widthScale - 4)
  const tableFootnoteHeight = (table.footnotes ?? []).reduce((sum, footnote) => {
    const lines = textLines(footnote.content.map((run) => run.text).join(''), footnoteCapacity)
    return sum + lines * 4.2
  }, 0)
  // 表注/脚注分别占一个合并单元格；边框余量按行框预留，不逐条额外加6mm。
  const footerHeight = noteHeight + tableFootnoteHeight + ((table.footnotes?.length ?? 0) > 0 ? 1.2 : 0)
  const captionCapacity = Math.max(1, (landscape ? 68 : 44) * widthScale)
  const captionLines = textLines(table.caption.map(run => run.text).join('') + '表XX（续）', captionCapacity)
  const captionHeight = 8 + Math.max(0, captionLines - 1) * 5.5
  // A4 竖排样稿的可用版心约 234 mm，再预留 9 mm 给 Word 的布局浮动。
  const pageBudget = landscape ? 135 : 225
  // 表注与表脚注只在末段出现，前页不能逐页重复扣除这份空间。
  // 不为高表头/表尾虚构最低数据空间；不足以容纳一个行组时仍保留内容并标记风险。
  const dataBudget = Math.max(0, pageBudget - captionHeight - headerHeight)
  const finalDataBudget = Math.max(0, dataBudget - footerHeight)
  const groups = bodyGroups(table.rows, headerRowCount)
  const groupHeights = groups.map((group) =>
    group.reduce((sum, row) => sum + rowHeightMm(row, columnCount, landscape, layout), 0))
  const totalHeight = captionHeight + headerHeight + footerHeight + groupHeights.reduce((sum, height) => sum + height, 0)
  const footerTooTall = captionHeight + headerHeight + footerHeight > pageBudget
  const oversizedGroup = groupHeights.some(height => height > dataBudget)
  const lastGroupHeight = groupHeights[groupHeights.length - 1] ?? 0
  const finalSegmentOverflow = groups.length > 0 && !footerTooTall &&
    lastGroupHeight > finalDataBudget && lastGroupHeight <= dataBudget


  let firstPageHeight = Number.isFinite(options.firstPageHeightMm)
    ? Math.max(0, Math.min(pageBudget, options.firstPageHeightMm!)) : undefined
  const reserved = Math.max(0, options.firstPageReservedMm ?? 0)
  const freshFirstPageHeight = Math.max(0, pageBudget - reserved)
  let firstStartsOnNewPage = firstPageHeight === undefined
  const result = (bodySegments: IRTableRow[][], startOnNewPage: boolean, oversizedGroup: boolean): TablePagination => ({
    bodySegments, startOnNewPage, totalHeightMm: totalHeight, oversizedGroup, finalSegmentOverflow, footerTooTall,
    segmentHeightsMm: bodySegments.map((rows, index) => captionHeight + headerHeight +
      rows.reduce((sum, row) => sum + rowHeightMm(row, columnCount, landscape, layout), 0) +
      (index === bodySegments.length - 1 ? footerHeight : 0)),
  })
  // A complete table that fits needs no first-group safety allowance. Preserve the
  // old-page position before considering a fresh-page budget for a split table.
  if (firstPageHeight !== undefined && totalHeight <= firstPageHeight) {
    return result([table.rows.slice(headerRowCount)], false, false)
  }
  // If the chain cannot start the table on the old page, carry it to the new page
  // and size that first segment with the chain still reserved. Continuations use full budgets.
  if (reserved > 0 && (firstPageHeight === undefined ||
      firstPageHeight < captionHeight + headerHeight + (groupHeights[0] ?? footerHeight) + 10)) {
    firstPageHeight = freshFirstPageHeight
    firstStartsOnNewPage = true
  }
  if (reserved > 0 && totalHeight <= pageBudget) {
    if (firstPageHeight !== undefined && totalHeight <= firstPageHeight) {
      return result([table.rows.slice(headerRowCount)], firstStartsOnNewPage, false)
    }
    if (totalHeight <= SMALL_TABLE_MM && totalHeight <= freshFirstPageHeight) {
      return result([table.rows.slice(headerRowCount)], true, false)
    }
  }
  // 小表仍整体保留，由 Word 在余量不足时自然移到下一页。其余表按首段余量切分。
  if (reserved === 0 && totalHeight <= pageBudget && (totalHeight <= SMALL_TABLE_MM || firstPageHeight === undefined || totalHeight <= firstPageHeight)) {
    return result([table.rows.slice(headerRowCount)], firstPageHeight === undefined && totalHeight > SMALL_TABLE_MM, false)
  }

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

  let tailStart = groups.length
  let tailRows = 0
  while (tailStart > 0 && tailRows < 3) tailRows += groups[--tailStart]!.length
  const maxEndBeforeLast = tailRows >= 3 && prefix[groups.length]! - prefix[tailStart]! <= finalDataBudget
    ? tailStart : Math.max(1, groups.length - 1)
  const bodySegments: IRTableRow[][] = []
  let start = 0
  let startOnNewPage = true
  if (firstPageHeight !== undefined) {
    const firstDataBudget = firstPageHeight - captionHeight - headerHeight - 10
    // 第一组必须完整放入；表头跨到数据行的合并也已包含在同一组内。
    if (groups.length > 1 && groupHeights[0]! <= firstDataBudget) {
      let end = 1
      while (end < Math.max(1, maxEndBeforeLast) && prefix[end + 1]! <= firstDataBudget) end += 1
      bodySegments.push(groups.slice(0, end).flat())
      start = end
      startOnNewPage = firstStartsOnNewPage
    }
  }
  for (let pagesLeft = minPages[start]!; pagesLeft > 1; pagesLeft -= 1) {
    let bestEnd = start + 1
    for (let end = start + 1; end <= Math.min(groups.length - pagesLeft + 1, pagesLeft === 2 ? Math.max(start + 1, maxEndBeforeLast) : groups.length); end += 1) {
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
  return result(bodySegments, startOnNewPage, oversizedGroup)

}
