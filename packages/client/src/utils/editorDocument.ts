import type { Editor } from '@tiptap/core'

/** Replace a validated document, including its root attributes, in one transaction.
 * Tiptap setContent replaces only the root's content and otherwise loses typed root metadata.
 * addToHistory=false keeps the replacement out of the undo stack, so undo cannot bring back replaced content.
 */
export function replaceEditorDocument(
  editor: Editor,
  content: Record<string, unknown>,
  emitUpdate = true,
  addToHistory = true,
): boolean {
  const next = editor.schema.nodeFromJSON(content)
  next.check()
  return editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) {
      tr.replaceWith(0, tr.doc.content.size, next.content)
      for (const [key, value] of Object.entries(next.attrs)) tr.setDocAttribute(key, value)
      tr.setMeta('preventUpdate', !emitUpdate)
      if (!addToHistory) tr.setMeta('addToHistory', false)
    }
    return true
  })
}
