import { Extension } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state'

interface FootnoteRowReorder {
  pos: number
  oldRow: PMNode
  newRow: PMNode
}

type EntrySelectionAnchor =
  | { kind: 'node'; nodeId: string }
  | { kind: 'text'; nodeId: string; fromOffset: number; toOffset: number }

function tableReferenceOrder(table: PMNode): string[] {
  const targets: string[] = []
  const seen = new Set<string>()
  const visit = (node: PMNode) => {
    if (node.type.name === 'tableFootnoteRow' || node.type.name === 'stdTable') return
    if (node.type.name === 'tableFootnoteRef') {
      const targetId = node.attrs.targetId
      if (typeof targetId === 'string' && targetId && !seen.has(targetId)) {
        seen.add(targetId)
        targets.push(targetId)
      }
      return
    }
    node.forEach(visit)
  }
  // Match resolver order across caption, grid, note row, and legacy tableFootnote content.
  // A nested stdTable owns its references and must not affect this table's definitions.
  table.forEach(visit)
  return targets
}

function footnoteRowReorders(doc: PMNode): FootnoteRowReorder[] {
  const reorders: FootnoteRowReorder[] = []
  doc.descendants((table, tablePos) => {
    if (table.type.name !== 'stdTable') return
    const references = new Map(tableReferenceOrder(table).map((id, index) => [id, index]))
    let offset = 0
    for (let index = 0; index < table.childCount; index += 1) {
      const child = table.child(index)
      if (child.type.name === 'tableFootnoteRow') {
        const entries: PMNode[] = []
        child.forEach((entry) => entries.push(entry))
        const sorted = entries
          .map((entry, index) => ({ entry, index, targetIndex: references.get(String(entry.attrs.nodeId)) }))
          .sort((left, right) => {
            if (left.targetIndex === undefined) return right.targetIndex === undefined ? left.index - right.index : 1
            if (right.targetIndex === undefined) return -1
            return left.targetIndex - right.targetIndex || left.index - right.index
          })
          .map(({ entry }) => entry)
        if (sorted.some((entry, entryIndex) => !entry.eq(entries[entryIndex]))) {
          reorders.push({
            pos: tablePos + 1 + offset,
            oldRow: child,
            newRow: child.copy(Fragment.from(sorted)),
          })
        }
      }
      offset += child.nodeSize
    }
    return false
  })
  return reorders
}

function entryAtPosition(doc: PMNode, pos: number): { node: PMNode; pos: number; offset: number } | null {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'tableFootnoteEntry') {
      const entryPos = $pos.before(depth)
      return { node, pos: entryPos, offset: Math.max(0, pos - entryPos - 1) }
    }
  }
  return null
}

function captureEntrySelection(state: import('@tiptap/pm/state').EditorState): EntrySelectionAnchor | null {
  const selection = state.selection
  if (selection instanceof NodeSelection && selection.node.type.name === 'tableFootnoteEntry') {
    const nodeId = selection.node.attrs.nodeId
    return typeof nodeId === 'string' && nodeId ? { kind: 'node', nodeId } : null
  }
  const from = entryAtPosition(state.doc, selection.from)
  const to = entryAtPosition(state.doc, selection.to)
  if (!from || !to || from.node.attrs.nodeId !== to.node.attrs.nodeId) return null
  const nodeId = from.node.attrs.nodeId
  if (typeof nodeId !== 'string' || !nodeId) return null
  return {
    kind: 'text',
    nodeId,
    fromOffset: from.offset,
    toOffset: to.offset,
  }
}

function findEntry(doc: PMNode, nodeId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (node.type.name === 'tableFootnoteEntry' && node.attrs.nodeId === nodeId) {
      found = { node, pos }
      return false
    }
  })
  return found
}

/** Keep table-footnote definitions in the order their targets are first cited. */
export const TableFootnoteOrder = Extension.create({
  name: 'tableFootnoteOrder',

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null
        const reorders = footnoteRowReorders(newState.doc)
        if (reorders.length === 0) return null

        // History can map a cursor from a moved entry to the beginning/end of the replaced row;
        // if the post-undo selection no longer points into an entry, retain the pre-transaction
        // stable entry anchor and restore it after sorting.
        const selectionAnchor = captureEntrySelection(newState) ?? captureEntrySelection(oldState)
        const transaction = newState.tr
        for (const reorder of reorders.sort((left, right) => right.pos - left.pos)) {
          transaction.replaceWith(reorder.pos, reorder.pos + reorder.oldRow.nodeSize, reorder.newRow)
        }

        if (selectionAnchor?.kind === 'node') {
          const entry = findEntry(transaction.doc, selectionAnchor.nodeId)
          if (entry) transaction.setSelection(NodeSelection.create(transaction.doc, entry.pos))
        } else if (selectionAnchor?.kind === 'text') {
          const entry = findEntry(transaction.doc, selectionAnchor.nodeId)
          if (entry) {
            const maxOffset = entry.node.content.size
            const from = Math.min(selectionAnchor.fromOffset, maxOffset)
            const to = Math.min(selectionAnchor.toOffset, maxOffset)
            transaction.setSelection(TextSelection.create(transaction.doc, entry.pos + 1 + from, entry.pos + 1 + to))
          }
        }

        // Ordering follows reference edits automatically but is not a separate undo step. The
        // source transaction remains undoable; undo/redo invokes this plugin again to re-sort.
        transaction.setMeta('addToHistory', false)
        return transaction
      },
    })]
  },
})
