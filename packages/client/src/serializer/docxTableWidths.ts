import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import type { PMJsonNode } from '@ses/shared'

/** Capture auto-layout columns for this export, without saving layout into the source. */
export function snapshotDocxTableWidths(pmDoc: PMJsonNode, view: EditorView): PMJsonNode {
  const snapshot = structuredClone(pmDoc)
  const tables = new Map<string, { grid: PMNode; widths: number[]; map: TableMap }>()
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'stdTable' || !node.attrs.nodeId) return
    let grid = null as typeof node | null
    node.forEach(child => { if (child.type.name === 'table') grid = child })
    if (!grid) return
    const tableGrid = grid as typeof node
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return
    const table = dom.querySelector<HTMLTableElement>('table')
    if (!table) return
    const widths = Array.from(table.querySelectorAll(':scope > colgroup > col'), col => col.getBoundingClientRect().width)
    const map = TableMap.get(tableGrid)
    if (widths.length !== map.width || widths.some(width => !Number.isFinite(width) || width <= 0)) return
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
