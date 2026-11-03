import { Extension } from '@tiptap/core'
import { enclosingTable, insertParagraphAfterTable } from '../../utils/structureEditing'

/**
 * 表格位于章末、条末或正文末尾时，表格之后没有可放光标的位置（编辑器不启用 gapcursor）。
 * 光标在表格内时 Mod-Enter 在表格之后插入正文段并移入光标（#73），之后可以继续书写或设为新条。
 *
 * StarterKit 的 HardBreak 也绑定了 Mod-Enter；本扩展优先级更高，只在表格内接管，其他位置仍交给换行处理
 * （表格内换行可用 Shift-Enter）。纯快捷键扩展，不新增节点。
 */
export const TableExit = Extension.create({
  name: 'tableExit',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': ({ editor }) => enclosingTable(editor.state) !== null && insertParagraphAfterTable(editor).ok,
    }
  },
})
