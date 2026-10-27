/**
 * WP8.M G8：表的列模型（`IRTable.columns`，M-6.1-03）与单元格分边边框样式（`IRCellStyle.border*Style`，M-6.3.3.1-01）
 * 的共用校验。pmToIr（读生产 PM）与 irToPm（写生产 PM）必须用同一套规则，否则会出现「一侧接受、另一侧拒绝」的往返裂缝。
 * 同构纯 TS，不依赖 DOM / Node。
 */

/** 6.3.3.2 的分边边框样式取值（p24 示例含 `none`，故一并接受）。 */
export const CELL_BORDER_STYLES = ['solid', 'dashed', 'dotted', 'none'] as const
export type CellBorderStyle = typeof CELL_BORDER_STYLES[number]

/** 6.3.2 的 `align` 取值（附录 D 另有 `char`：IR 无对应值，由导入侧映射最近值并告警）。 */
export const COLUMN_TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const
/** 6.3.2 的 `valign` 取值（`valign="center"` 不在取值内，导入侧当作 `middle` 并告警）。 */
export const COLUMN_VERTICAL_ALIGNS = ['top', 'middle', 'bottom', 'baseline'] as const

/** 单元格四边的样式键，顺序即 6.3.3.1 规定的「左、上、右、下」之外的内部顺序（上、右、下、左，与 IR 其余字段一致）。 */
export const CELL_BORDER_STYLE_KEYS = ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'] as const

export function isCellBorderStyle(value: unknown): value is CellBorderStyle {
  return typeof value === 'string' && (CELL_BORDER_STYLES as readonly string[]).includes(value)
}

/** 列宽单位：纯字母或 `%` 的短记号（`%`、`px`、`mm`…）。拒绝任何能在 CSS / XML 里夹带语法的字符。 */
const UNIT_TOKEN = /^[A-Za-z%]{1,8}$/

/** 校验一个 `{ value, unit }` 度量是否是可用的列宽：有限正数 + 记号式单位。返回原因，合法时返回 null。 */
export function columnWidthProblem(value: unknown, unit: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '宽度必须是有限正数'
  if (typeof unit !== 'string' || !UNIT_TOKEN.test(unit)) return '宽度必须带单位（如 %、px、mm）'
  return null
}

/** 校验列的对齐值；两者均可缺省（null / undefined）。合法时返回 null。 */
export function columnAlignProblem(textAlign: unknown, verticalAlign: unknown): string | null {
  if (textAlign !== undefined && textAlign !== null
    && !(typeof textAlign === 'string' && (COLUMN_TEXT_ALIGNS as readonly string[]).includes(textAlign))) {
    return `水平对齐「${String(textAlign)}」不在 ${COLUMN_TEXT_ALIGNS.join(' | ')} 之内`
  }
  if (verticalAlign !== undefined && verticalAlign !== null
    && !(typeof verticalAlign === 'string' && (COLUMN_VERTICAL_ALIGNS as readonly string[]).includes(verticalAlign))) {
    return `垂直对齐「${String(verticalAlign)}」不在 ${COLUMN_VERTICAL_ALIGNS.join(' | ')} 之内`
  }
  return null
}

interface GridCell { colspan: number; rowspan: number }

/** 跨度上限：防止异常输入（如 colspan=1e9）把占位网格撑到耗尽内存；超出按上限计，只影响「有几列」这一个答案。 */
const MAX_SPAN = 1000

/**
 * 表格的网格列数：按 colspan / rowspan 展开占位后的最大列数（与 prosemirror-tables 的 `TableMap.width` 同义）。
 * 不抛错：非法跨度（非正整数）按 1 处理、过大的跨度按 {@link MAX_SPAN} 计——跨度本身的合法性由其他检查负责，这里只回答「有几列」。
 */
export function tableGridWidth(rows: ReadonlyArray<{ cells: ReadonlyArray<GridCell> }>): number {
  const occupied: Array<Set<number>> = rows.map(() => new Set<number>())
  let width = 0
  rows.forEach((row, rowIndex) => {
    let column = 0
    for (const cell of row.cells) {
      const colspan = Number.isSafeInteger(cell.colspan) && cell.colspan >= 1 ? Math.min(cell.colspan, MAX_SPAN) : 1
      const rowspan = Number.isSafeInteger(cell.rowspan) && cell.rowspan >= 1 ? Math.min(cell.rowspan, MAX_SPAN) : 1
      while (occupied[rowIndex]!.has(column)) column += 1
      for (let r = rowIndex; r < Math.min(rows.length, rowIndex + rowspan); r += 1) {
        for (let c = column; c < column + colspan; c += 1) occupied[r]!.add(c)
      }
      column += colspan
      width = Math.max(width, column)
    }
  })
  return width
}
