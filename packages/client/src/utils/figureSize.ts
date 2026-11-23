import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export type FigureSizePreset = 'half' | 'full' | 'reset'

/** Logical page width in CSS pixels; landscape figures and appendices use 252 mm. */
export function figurePageWidthPx(doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const ancestor = $pos.node(depth)
    if ((ancestor.type.name === 'figure' || ancestor.type.name === 'appendix') && ancestor.attrs.orientation === 'landscape') return 252 * 96 / 25.4
  }
  return 165 * 96 / 25.4
}

/** One undo step per size change; keep the selected image selected across the update. */
export function setFigureWidth(view: EditorView, pos: number, width: number | null): boolean {
  if (!view.editable || pos < 0 || pos >= view.state.doc.content.size) return false
  const current = view.state.doc.nodeAt(pos)
  if (!current || current.type.name !== 'figureImage' || !current.attrs.src) return false
  if (width !== null && (!Number.isFinite(width) || width <= 0 || width > figurePageWidthPx(view.state.doc, pos) + 0.01)) return false
  const selected = view.state.selection instanceof NodeSelection && view.state.selection.from === pos
  const tr = closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, width, widthUnit: width === null ? null : 'px', height: null, heightUnit: null })
  if (selected) tr.setSelection(NodeSelection.create(tr.doc, pos))
  view.dispatch(tr)
  return true
}

export function setFigureSizePreset(view: EditorView, pos: number, preset: FigureSizePreset): boolean {
  const factor = preset === 'half' ? 0.5 : preset === 'full' ? 1 : 0
  const width = factor ? Math.round(figurePageWidthPx(view.state.doc, pos) * factor * 100) / 100 : null
  return setFigureWidth(view, pos, width)
}
