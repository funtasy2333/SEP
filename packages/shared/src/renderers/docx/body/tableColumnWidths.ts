/** 编辑器列宽以CSS像素保存；Word网格使用twips（96dpi下1px=15twips）。 */
import type { IRTable } from '../../../ir/types'
import { mmToTwips } from '../units'
import { buildTableGrid, type TableGrid } from './tableGrid'

export interface TableColumnWidthIssue {
  nodeId: string
  rowIndex: number
  cellIndex: number
  reason: string
}

function collect(table: IRTable, grid: TableGrid): { pixels: Array<number | undefined>; issues: TableColumnWidthIssue[] } {
  const pixels: Array<number | undefined> = Array(grid.columnCount).fill(undefined)
  const issues: TableColumnWidthIssue[] = []
  for (const row of grid.rows) for (const slot of row) {
    if (slot.kind !== 'origin') continue
    const origin = slot.origin!, values = origin.cell.columnWidths
    if (values === undefined || (Array.isArray(values) && values.length === 0)) continue
    const issue = (reason: string) => issues.push({ nodeId: origin.cell.id, rowIndex: origin.rowIndex,
      cellIndex: table.rows[origin.rowIndex]!.cells.indexOf(origin.cell), reason })
    if (!Array.isArray(values) || values.length !== origin.colspan || values.some(value =>
      typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isFinite(value * 15))) {
      issue('列宽须为与colspan一致的非负有限像素数组，0表示未指定')
      continue
    }
    for (let offset = 0; offset < values.length; offset += 1) {
      const value = values[offset]!
      if (value === 0) continue
      const column = origin.columnIndex + offset
      if (pixels[column] !== undefined && pixels[column] !== value) {
        issue(`第${column + 1}列在不同单元格中宽度不一致（${pixels[column]}px与${value}px）`)
      } else pixels[column] = value
    }
  }
  return { pixels, issues }
}

export function tableColumnWidthIssues(table: IRTable): TableColumnWidthIssue[] {
  return collect(table, buildTableGrid(table)).issues
}

/** 整数网格保持总宽，余数按小数部分分配；极小列至少保留1twip。 */
function proportionalWidths(weights: number[], total: number): number[] {
  const maximum = Math.max(...weights), scaled = weights.map(value => value / maximum)
  const sum = scaled.reduce((part, value) => part + value, 0)
  const exact = scaled.map(value => total * value / sum)
  const widths = exact.map(value => Math.max(1, Math.floor(value)))
  let remainder = total - widths.reduce((part, value) => part + value, 0)
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) widths[order[index % order.length]!.index]! += 1
  if (remainder < 0) for (const index of widths.map((_width, index) => index).sort((a, b) => widths[b]! - widths[a]!)) {
    const remove = Math.min(-remainder, widths[index]! - 1)
    widths[index]! -= remove
    remainder += remove
    if (remainder === 0) break
  }
  return widths
}

export interface TableColumnLayout {
  widths: number[]
  custom: boolean
  pageWidthTwips: number
  cellWidths: Map<string, number>
}

export function resolveTableColumnWidths(table: IRTable, minimumColumns = 1): TableColumnLayout {
  const grid = buildTableGrid(table, minimumColumns), { pixels, issues } = collect(table, grid)
  if (issues.length) throw new Error(issues.map(issue => `表格列宽无效（${issue.nodeId}）：${issue.reason}`).join('\n'))
  const pageWidthTwips = table.orientation === 'landscape' ? mmToTwips(252) : 9355
  const custom = pixels.some(value => value !== undefined)
  const missing = pixels.filter(value => value === undefined).length
  let widths: number[]
  if (!custom) {
    const base = Math.floor(pageWidthTwips / grid.columnCount), remainder = pageWidthTwips - base * grid.columnCount
    widths = pixels.map((_value, index) => base + (index < remainder ? 1 : 0))
  } else {
    const fixed = pixels.map(value => value === undefined ? 0 : Math.max(1, Math.round(value * 15)))
    const fixedTotal = fixed.reduce((sum, value) => sum + value, 0)
    if (missing > 0 && fixedTotal <= pageWidthTwips - missing) {
      const remaining = pageWidthTwips - fixedTotal, base = Math.floor(remaining / missing)
      let remainder = remaining - base * missing
      widths = pixels.map((value, index) => value !== undefined ? fixed[index]! : base + (remainder-- > 0 ? 1 : 0))
    } else {
      const weights = pixels.map(value => value ?? pageWidthTwips / grid.columnCount / 15)
      const authoredTotal = pixels.reduce<number>((sum, value) => sum + (value ?? 0) * 15, 0)
      const total = missing > 0 ? pageWidthTwips : Math.min(pageWidthTwips, Math.max(grid.columnCount, Math.round(authoredTotal)))
      widths = proportionalWidths(weights, total)
    }
  }
  const cellWidths = new Map<string, number>()
  for (const row of grid.rows) for (const slot of row) if (slot.kind === 'origin') {
    const origin = slot.origin!
    cellWidths.set(origin.cell.id, widths.slice(origin.columnIndex, origin.columnIndex + origin.colspan).reduce((sum, value) => sum + value, 0))
  }
  return { widths, custom, pageWidthTwips, cellWidths }
}
