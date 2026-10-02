import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const paragraphs = new Set(['stdParagraph', 'paragraph'])

function children(node: PMNode): PMNode[] {
  const result: PMNode[] = []
  node.forEach(child => result.push(child))
  return result
}

/** Leave the preceding content in its original clauses, lifting the suffix in order. */
function splitBeforeTarget(node: PMNode, path: number[]): { before: PMNode; after: PMNode[] } {
  const index = path[0]!
  const nodes = children(node)
  if (path.length === 1) {
    return { before: node.copy(Fragment.fromArray(nodes.slice(0, index))), after: nodes.slice(index + 1) }
  }
  const split = splitBeforeTarget(nodes[index]!, path.slice(1))
  return {
    before: node.copy(Fragment.fromArray([...nodes.slice(0, index), split.before])),
    after: [...split.after, ...nodes.slice(index + 1)],
  }
}

/**
 * Format the current paragraph (including a partial text selection) as a clause.
 * Existing clause titles change their own attributes instead of inserting another clause.
 * Inline marks/anchors and all following content survive; a peer clause is not nested in a peer.
 */
export function setClauseFormat(editor: Editor, level: number, hasTitle = true): boolean {
  if (!Number.isInteger(level) || level < 1 || level > 5) return false
  const { state } = editor
  const { $from, $to } = state.selection
  if (!$from.sameParent($to)) return false
  const leaf = $from.parent
  let targetDepth: number
  let clause: PMNode
  if (paragraphs.has(leaf.type.name)) {
    targetDepth = $from.depth
    clause = state.schema.nodes.clause.create(
      { nodeId: leaf.attrs.nodeId, level, hasTitle },
      [state.schema.nodes.clauseTitle.create({ level }, leaf.content)],
    )
  } else if (leaf.type.name === 'clauseTitle' && $from.node($from.depth - 1).type.name === 'clause') {
    targetDepth = $from.depth - 1
    const target = $from.node(targetDepth)
    clause = target.type.create({ ...target.attrs, level, hasTitle }, [
      leaf.type.create({ ...leaf.attrs, level }, leaf.content, leaf.marks),
      ...children(target).slice(1),
    ], target.marks)
  } else {
    return false
  }

  let hostDepth = targetDepth - 1
  for (; hostDepth > 0; hostDepth -= 1) {
    const host = $from.node(hostDepth)
    if (host.type.name === 'chapter' || host.type.name === 'appendix') break
    if (host.type.name !== 'clause') return false
    if (host.attrs.level < level) break
  }
  // Clauses belong to a chapter/appendix, never to a table, term, foreword or the root.
  if (hostDepth === 0) return false

  const tr = state.tr
  let clausePos: number
  if (hostDepth === targetDepth - 1) {
    clausePos = $from.before(targetDepth)
    tr.replaceWith(clausePos, $from.after(targetDepth), clause)
  } else {
    const ancestorDepth = hostDepth + 1
    const ancestor = $from.node(ancestorDepth)
    const path = Array.from({ length: targetDepth - ancestorDepth }, (_, i) => $from.index(ancestorDepth + i))
    const split = splitBeforeTarget(ancestor, path)
    // Paragraphs/subclauses after a new heading remain its body until the next peer heading.
    const peerIndex = split.after.findIndex(node => node.type.name === 'clause' && node.attrs.level <= level)
    const bodyEnd = peerIndex < 0 ? split.after.length : peerIndex
    clause = clause.copy(clause.content.append(Fragment.fromArray(split.after.slice(0, bodyEnd))))
    const start = $from.before(ancestorDepth)
    tr.replaceWith(start, $from.after(ancestorDepth), [split.before, clause, ...split.after.slice(bodyEnd)])
    clausePos = start + split.before.nodeSize
  }
  tr.setSelection(TextSelection.create(tr.doc, clausePos + 2 + $from.parentOffset, clausePos + 2 + $to.parentOffset))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}

/** Turn a title back into a paragraph without flattening or deleting its body. */
export function setParagraphFormat(editor: Editor): boolean {
  const { state } = editor
  const { $from, $to } = state.selection
  if (!$from.sameParent($to)) return false
  const leaf = $from.parent
  const tr = state.tr
  let paragraphPos: number
  if (leaf.type.name === 'stdParagraph') {
    editor.view.focus()
    return true
  }
  if (leaf.type.name === 'clauseTitle' && $from.node($from.depth - 1).type.name === 'clause') {
    const depth = $from.depth - 1
    const clause = $from.node(depth)
    paragraphPos = $from.before(depth)
    tr.replaceWith(paragraphPos, $from.after(depth), [
      state.schema.nodes.stdParagraph.create({ nodeId: clause.attrs.nodeId }, leaf.content),
      ...children(clause).slice(1),
    ])
  } else if (['paragraph', 'note', 'example'].includes(leaf.type.name)) {
    paragraphPos = $from.before($from.depth)
    tr.replaceWith(paragraphPos, $from.after($from.depth), state.schema.nodes.stdParagraph.create(
      { nodeId: leaf.attrs.nodeId }, leaf.content, leaf.marks,
    ))
  } else {
    return false
  }
  tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1 + $from.parentOffset, paragraphPos + 1 + $to.parentOffset))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}
