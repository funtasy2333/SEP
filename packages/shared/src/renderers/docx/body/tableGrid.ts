/** 将colspan/rowspan展开为Word表格矩形网格，不含渲染副作用。 */
import type { IRTable, IRTableRow } from '../../../ir/types'
type IRTableCell = IRTableRow['cells'][number]

export interface OriginCell {
  kind: 'origin'
  cell: IRTableCell
  rowIndex: number
  columnIndex: number
  colspan: number
  rowspan: number
}

export interface GridCell {
  kind: 'origin' | 'continuation' | 'filler'
  origin?: OriginCell
  columnIndex: number
  colspan: number
}

export interface TableGrid {
  columnCount: number
  rows: GridCell[][]
}

function positiveSpan(value: number, axis: string, cellId: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`renderTableGrid: 单元格 "${cellId}" 的 ${axis} 必须为正整数，收到 ${String(value)}`)
  }
  return value
}

/** Expand the IR spans into an explicit, rectangular OOXML grid, including vertical merge cells. */
export function buildTableGrid(table: IRTable, minimumColumnCount = 1): TableGrid {
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

