import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { SelectionBookmark } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import { pmToIr, resolve } from '@ses/shared'

export interface InternalReferenceTarget { id: string; type: string; text: string; title: string }
export const referenceTypes: Record<string, string> = {
  chapter: '章', clause: '条', term: '术语', table: '表', figure: '图', formula: '公式', appendix: '附录', bibliography: '参考文献',
}
const nodeKinds: Record<string, string> = { chapter: 'chapter', clause: 'clause', termDef: 'term', stdTable: 'table', figure: 'figure', formula: 'formula', appendix: 'appendix', bibEntry: 'bibliography' }
const titleNodes = new Set(['chapterTitle', 'clauseTitle', 'termName', 'tableCaption', 'figureCaption', 'appendixTitle'])

export function collectInternalReferences(editor: Editor): InternalReferenceTarget[] {
  const labels = resolve(pmToIr(editor.getJSON()).doc).labels
  const targets: InternalReferenceTarget[] = []
  editor.state.doc.descendants(node => {
    const type = nodeKinds[node.type.name]
    const id = node.attrs.nodeId
    const label = typeof id === 'string' ? labels[id] : undefined
    if (!type || !id || !label?.refText) return
    let title = ''
    node.forEach(child => { if (titleNodes.has(child.type.name)) title = child.textContent })
    if (!title && type === 'bibliography') title = node.textContent
    targets.push({ id, type, text: label.refText, title })
  })
  return targets
}

export function insertInternalReference(editor: Editor, id: string, doc: PMNode, bookmark: SelectionBookmark): boolean {
  if (editor.isDestroyed || !editor.isEditable || !editor.state.doc.eq(doc)) return false
  const target = collectInternalReferences(editor).find(item => item.id === id)
  if (!target) return false
  const selection = bookmark.resolve(editor.state.doc)
  if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to) || !selection.$from.parent.inlineContent) return false
  if (!selection.$from.parent.type.allowsMarkType(editor.schema.marks.crossRef!)) return false
  const mark = editor.schema.marks.crossRef!.create({ targetId: id, refType: target.type, refText: target.text })
  const marks = selection.$from.marks().filter(item => !['link', 'externalLink', 'crossRef', 'bibRef', 'termRef', 'stdRef', 'mixedCitation'].includes(item.type.name))
  const text = editor.schema.text(target.text, [...marks, mark])
  const tr = editor.state.tr.setSelection(selection).replaceSelectionWith(text, false)
  tr.setStoredMarks(null)
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}
