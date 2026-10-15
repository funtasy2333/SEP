import type { Editor } from '@tiptap/core'
import { EditorState, TextSelection } from '@tiptap/pm/state'

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

/**
 * 载入服务端的最新内容（不触发更新事件、不进入撤销历史），并把光标尽量留在原来的位置。
 * 整篇替换会让选区落到文档末尾；外部修改到达时用户可能正在阅读或定位，光标不应被带走。
 * 位置按原偏移量夹到新文档范围内，只是体验上的近似，不保证落在同一段文字上。
 *
 * 同时清空撤销历史：整篇被外部内容替换后，此前的撤销记录已无意义，映射到新文档上只会变成
 * 无法预期的小改动（并触发一次多余的自动保存）。
 */
export function installRemoteDocument(editor: Editor, content: Record<string, unknown>): boolean {
  const { from, to } = editor.state.selection
  const replaced = replaceEditorDocument(editor, content, false, false)
  try {
    // 用同一批插件重建编辑器状态：历史插件的状态随之重置，文档与选区保持不变。
    const { state, view } = editor
    view.updateState(EditorState.create({
      doc: state.doc,
      selection: state.selection,
      storedMarks: state.storedMarks,
      plugins: state.plugins,
    }))
  } catch {
    // 清空历史失败时保留原状态：撤销记录仍在，但内容已经载入。
  }
  try {
    const { doc, tr } = editor.state
    const limit = doc.content.size
    const selection = TextSelection.between(doc.resolve(Math.min(from, limit)), doc.resolve(Math.min(to, limit)))
    editor.view.dispatch(tr.setSelection(selection).setMeta('addToHistory', false).setMeta('preventUpdate', true))
  } catch {
    // 选区恢复只是体验优化，失败时保留替换后的默认选区。
  }
  return replaced
}
