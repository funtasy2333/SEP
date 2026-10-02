import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const paragraphs = new Set(['stdParagraph', 'paragraph'])

function isHeading(node: PMNode): boolean {
  return node.type.name === 'clause' || node.type.name === 'termDef'
}

function children(node: PMNode): PMNode[] {
  const result: PMNode[] = []
  node.forEach(child => result.push(child))
  return result
}

/** Moving a suffix must not orphan deeper headings or introduce hanging blocks. */
function hasValidNewBody(clause: PMNode, level: number): boolean {
  const body = children(clause).slice(1)
  if (body.some(node => isHeading(node) && node.attrs.level !== level + 1)) return false
  return !(body.some(node => node.type.name === 'clause') && body.some(node => !isHeading(node)))
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
    if (level !== target.attrs.level && children(target).some(isHeading)) return false
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
  const host = $from.node(hostDepth)
  const expectedLevel = host.type.name === 'clause' ? host.attrs.level + 1 : 1
  // A lower ancestor alone is insufficient: missing intermediate levels yield
  // heading-skip warnings and incomplete numbering in the exported document.
  if (level !== expectedLevel) return false

  const tr = state.tr
  let clausePos: number
  if (hostDepth === targetDepth - 1) {
    clausePos = $from.before(targetDepth)
    let end = $from.after(targetDepth)
    if (paragraphs.has(leaf.type.name)) {
      const following = children(host).slice($from.index(hostDepth) + 1)
      const peerIndex = following.findIndex(node => isHeading(node) && node.attrs.level <= level)
      const body = following.slice(0, peerIndex < 0 ? following.length : peerIndex)
      clause = clause.copy(clause.content.append(Fragment.fromArray(body)))
      if (!hasValidNewBody(clause, level)) return false
      end += body.reduce((size, node) => size + node.nodeSize, 0)
    }
    tr.replaceWith(clausePos, end, clause)
  } else {
    const ancestorDepth = hostDepth + 1
    const ancestor = $from.node(ancestorDepth)
    const path = Array.from({ length: targetDepth - ancestorDepth }, (_, i) => $from.index(ancestorDepth + i))
    const split = splitBeforeTarget(ancestor, path)
    // Paragraphs/subclauses after a new heading remain its body until the next peer heading.
    const peerIndex = split.after.findIndex(node => isHeading(node) && node.attrs.level <= level)
    const bodyEnd = peerIndex < 0 ? split.after.length : peerIndex
    clause = clause.copy(clause.content.append(Fragment.fromArray(split.after.slice(0, bodyEnd))))
    if (!hasValidNewBody(clause, level)) return false
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
    // Removing a heading is safe only if it has no numbered descendants.
    // Keep their existing ancestry rather than silently promoting orphaned subclauses.
    if (children(clause).some(isHeading)) return false
    const parent = $from.node(depth - 1)
    const index = $from.index(depth - 1)
    const siblings = children(parent)
    paragraphPos = $from.before(depth)
    const body = [
      state.schema.nodes.stdParagraph.create({ nodeId: clause.attrs.nodeId }, leaf.content),
      ...children(clause).slice(1),
    ]
    if (siblings.some((node, i) => i !== index && node.type.name === 'clause')) {
      const previous = siblings[index - 1]
      // Following a leaf clause, the unnumbered text becomes that clause's body.
      // Otherwise a direct paragraph alongside clauses would become hanging text.
      if (!previous || previous.type.name !== 'clause' || children(previous).some(isHeading)) return false
      const previousPos = paragraphPos - previous.nodeSize
      paragraphPos -= 1 // The previous clause's closing token becomes the paragraph start.
      tr.replaceWith(previousPos, $from.after(depth), previous.copy(previous.content.append(Fragment.fromArray(body))))
    } else {
      tr.replaceWith(paragraphPos, $from.after(depth), body)
    }
  } else if (['paragraph', 'note', 'example'].includes(leaf.type.name)) {
    const parent = $from.node($from.depth - 1)
    const index = $from.index($from.depth - 1)
    // StarterKit list items require their first generic paragraph. Changing it
    // makes the replacement fitter invent an empty bullet before the real text.
    if (leaf.type.name === 'paragraph' && parent.type.name === 'listItem') {
      editor.view.focus()
      return true
    }
    if (!parent.canReplaceWith(index, index + 1, state.schema.nodes.stdParagraph)) return false
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
