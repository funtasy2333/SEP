import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'

export interface SourceAnnotation {
  doc: PMNode; from: number; to: number; kind: 'term' | 'paragraph' | 'figure' | 'table'; text: string; existing: boolean
}
const sourcePattern = /^\s*[[［]来源\s*[:：]([\s\S]*)[\]］]\s*$/
const sourceText = (node: PMNode) => node.type.name === 'termSource' ? node.textContent : node.textContent.match(sourcePattern)?.[1] ?? ''
const isSource = (node: PMNode) => node.type.name === 'termSource' || (node.type.name === 'stdParagraph' && sourcePattern.test(node.textContent))

export function findSourceAnnotation(editor: Editor): SourceAnnotation | null {
  if (editor.isDestroyed || !editor.isEditable) return null
  const { doc, selection } = editor.state
  if (!(selection instanceof TextSelection || selection instanceof NodeSelection) || !selection.$from.sameParent(selection.$to)) return null
  const $from = selection instanceof NodeSelection && ['figure', 'stdTable', 'termDef'].includes(selection.node.type.name)
    ? doc.resolve(selection.from + 1) : selection.$from
  const result = (from: number, kind: SourceAnnotation['kind'], node?: PMNode): SourceAnnotation => ({
    doc, from, to: from + (node?.nodeSize ?? 0), kind, text: node ? sourceText(node) : '', existing: Boolean(node),
  })
  // The nearest term/object owns the annotation, including when the caret is in a table cell.
  for (let depth = $from.depth; depth > 0; depth--) {
    const owner = $from.node(depth)
    const name = owner.type.name
    if (name === 'termDef') {
      let existing: SourceAnnotation | null = null
      let insertAt = $from.end(depth)
      let foundTail = false
      owner.forEach((child, offset) => {
        const pos = $from.start(depth) + offset
        if (!existing && isSource(child)) existing = result(pos, 'term', child)
        if (!foundTail && ['note', 'example', 'termDef', 'tbxLangSet'].includes(child.type.name)) {
          insertAt = pos; foundTail = true
        }
      })
      return existing ?? result(insertAt, 'term')
    }
    if (name === 'figure' || name === 'stdTable') {
      const pos = $from.after(depth)
      const next = doc.nodeAt(pos)
      const kind = name === 'figure' ? 'figure' : 'table'
      return result(pos, kind, next && isSource(next) ? next : undefined)
    }
    if (['coverPage', 'metadataBlock', 'bibliography', 'indexBlock'].includes(name)) return null
  }
  const parent = $from.parent
  if (!['stdParagraph', 'paragraph'].includes(parent.type.name)) return null
  if (isSource(parent)) return result($from.before(), 'paragraph', parent)
  // Only insert where the parent can accept a standard paragraph (never split an object).
  const container = $from.node($from.depth - 1)
  const index = $from.index($from.depth - 1) + 1
  if (!container.canReplaceWith(index, index, editor.schema.nodes.stdParagraph!)) return null
  const pos = $from.after()
  const next = doc.nodeAt(pos)
  return result(pos, 'paragraph', next && isSource(next) ? next : undefined)
}

export function saveSourceAnnotation(editor: Editor, location: SourceAnnotation, text: string | null): boolean {
  if (editor.isDestroyed || !editor.isEditable || !editor.state.doc.eq(location.doc)) return false
  if (text !== null && !text.trim()) return false
  if (text === null && !location.existing) return false
  if (text !== null && location.existing && text === location.text) return true
  const old = location.existing ? editor.state.doc.nodeAt(location.from) : null
  if (location.existing && (!old || !isSource(old))) return false
  const tr = editor.state.tr
  if (text === null) tr.delete(location.from, location.to)
  else {
    const type = old?.type.name === 'stdParagraph' ? 'stdParagraph' : location.kind === 'term' ? 'termSource' : 'stdParagraph'
    const content = type === 'termSource' ? text : `[来源：${text}]`
    const node = editor.schema.nodes[type]!.create(old?.attrs, editor.schema.text(content))
    tr.replaceWith(location.from, location.to, node)
  }
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(location.from + (text === null ? 0 : 1), tr.doc.content.size))))
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}
