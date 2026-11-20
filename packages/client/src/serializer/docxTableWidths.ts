import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import type { PMJsonNode } from '@ses/shared'
import {
  LANDSCAPE_PAGE_PX,
  getStdTableGridColwidths,
  isEffectiveLandscapeStdTable,
} from '../utils/landscapeTable'

interface MeasuredTable {
  grid: PMNode
  widths: number[]
  map: TableMap
}

function readLandscapeScale(table: HTMLTableElement): number {
  const tableWrapper = table.closest<HTMLElement>('.tableWrapper')
  const raw = tableWrapper?.getAttribute('data-landscape-scale')
  if (!raw) return 1
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 1
}

function normalizeWidthsToLandscapePage(widths: number[]): number[] {
  const sum = widths.reduce((total, w) => total + w, 0)
  if (sum <= 0 || sum >= LANDSCAPE_PAGE_PX - 1) return widths
  const factor = LANDSCAPE_PAGE_PX / sum
  return widths.map(w => w * factor)
}

/** Capture auto-layout columns for this export, without saving layout into the source. */
export function snapshotDocxTableWidths(pmDoc: PMJsonNode, view: EditorView): PMJsonNode {
  const snapshot = structuredClone(pmDoc)
  const tables = new Map<string, MeasuredTable>()
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'stdTable' || !node.attrs.nodeId) return
    let grid = null as typeof node | null
    node.forEach(child => { if (child.type.name === 'table') grid = child })
    if (!grid) return
    const tableGrid = grid as typeof node
    const map = TableMap.get(tableGrid)

    const colwidthInfo = getStdTableGridColwidths(node)
    const hasCompleteExplicitColwidths = Boolean(
      colwidthInfo
      && colwidthInfo.colCount === map.width
      && colwidthInfo.widths.every((w): w is number => typeof w === 'number' && w > 0),
    )

    if (hasCompleteExplicitColwidths && colwidthInfo) {
      // 已在 952px 弹窗或手动拖拽中明确设置全部列宽，保留作者写入的 colwidth，不被主编辑区缩放 DOM 覆盖。
      tables.set(String(node.attrs.nodeId), {
        grid: tableGrid,
        widths: colwidthInfo.widths as number[],
        map,
      })
      return false
    }

    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return
    const table = dom.querySelector<HTMLTableElement>('table')
    if (!table) return

    const scale = readLandscapeScale(table)
    let widths = Array.from(
      table.querySelectorAll(':scope > colgroup > col'),
      col => col.getBoundingClientRect().width / scale,
    )
    if (widths.length !== map.width || widths.some(width => !Number.isFinite(width) || width <= 0)) return

    if (isEffectiveLandscapeStdTable(view.state.doc, pos)) {
      // 无完整显式列宽的横向表（自动列宽或降级未缩放 DOM）：若测得总宽小于 252mm（~952.44px），按比例放大到横页版心宽度。
      widths = normalizeWidthsToLandscapePage(widths)
    }

    tables.set(String(node.attrs.nodeId), { grid: tableGrid, widths, map })
    return false
  })
  const visit = (node: PMJsonNode): void => {
    if (node.type === 'stdTable') {
      const measured = tables.get(String(node.attrs?.nodeId))
      const grid = node.content?.find(child => child.type === 'table')
      // Cover synchronization may replace the root; a changed grid must never
      // receive stale DOM measurements from a different document state.
      if (grid && measured && JSON.stringify(grid) === JSON.stringify(measured.grid.toJSON())) {
        measured.grid.forEach((row, rowOffset, rowIndex) => {
          row.forEach((_cell, cellOffset, cellIndex) => {
            const cell = grid.content![rowIndex]!.content![cellIndex]!
            const rect = measured.map.findCell(rowOffset + 1 + cellOffset)
            cell.attrs = { ...cell.attrs, colwidth: measured.widths.slice(rect.left, rect.right) }
          })
        })
      }
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(snapshot)
  return snapshot
}

