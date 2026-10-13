// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { installRemoteDocument } from './editorDocument'

function documentJson(...texts: string[]) {
  return {
    type: 'doc',
    attrs: {},
    content: [{
      type: 'coverPage',
      attrs: { nodeId: 'stable-cover', standardType: 'national' },
      content: [{ type: 'paragraph', attrs: { nodeId: 'stable-cover-p' } }],
    }, {
      type: 'foreword',
      attrs: { nodeId: 'stable-foreword' },
      content: texts.map((text, index) => ({
        type: 'paragraph',
        attrs: { nodeId: `stable-p-${index}` },
        content: [{ type: 'text', text }],
      })),
    }],
  }
}

const editors: Editor[] = []
function createEditor(content: Record<string, unknown>, onUpdate = vi.fn()) {
  const editor = new Editor({ extensions: createEditorExtensions(), content, onUpdate })
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
})

describe('installRemoteDocument', () => {
  it('载入新内容但不触发更新事件、不进入撤销历史', () => {
    const onUpdate = vi.fn()
    const editor = createEditor(documentJson('旧内容'), onUpdate)
    onUpdate.mockClear()

    expect(installRemoteDocument(editor, documentJson('AI 写入的新内容'))).toBe(true)

    expect(editor.state.doc.textContent).toContain('AI 写入的新内容')
    expect(editor.state.doc.textContent).not.toContain('旧内容')
    expect(onUpdate).not.toHaveBeenCalled()
    expect(editor.can().undo()).toBe(false)
  })

  it('清空撤销历史：此前的撤销记录映射到新文档只会产生无法预期的改动，载入后撤销/重做都是空操作', () => {
    const onUpdate = vi.fn()
    const editor = createEditor(documentJson('第一段', '第二段'), onUpdate)
    editor.commands.insertContent('用户输入')
    expect(editor.can().undo()).toBe(true)
    onUpdate.mockClear()

    installRemoteDocument(editor, documentJson('AI 全新第一段', '第二段', '第三段'))
    const loaded = editor.getJSON()

    expect(editor.can().undo()).toBe(false)
    expect(editor.can().redo()).toBe(false)
    editor.commands.undo()
    editor.commands.redo()
    expect(editor.getJSON()).toEqual(loaded)
    expect(onUpdate).not.toHaveBeenCalled()

    // 载入之后的新输入有自己的历史，可以正常撤销
    editor.commands.insertContent('载入后的输入')
    expect(editor.state.doc.textContent).toContain('载入后的输入')
    expect(editor.can().undo()).toBe(true)
    editor.commands.undo()
    expect(editor.state.doc.textContent).not.toContain('载入后的输入')
    expect(editor.state.doc.textContent).toContain('AI 全新第一段')
  })

  it('光标留在原来的偏移位置，而不是被带到文档末尾', () => {
    const editor = createEditor(documentJson('第一段文字', '第二段文字'))
    // 把光标放在第一段文字中间
    let position = -1
    editor.state.doc.descendants((node, pos) => {
      if (position < 0 && node.isText && node.text === '第一段文字') position = pos + 2
    })
    editor.commands.setTextSelection(position)
    expect(editor.state.selection.from).toBe(position)

    installRemoteDocument(editor, documentJson('第一段文字', '第二段文字', 'AI 在末尾追加的一段'))

    expect(editor.state.selection.from).toBe(position)
    expect(editor.state.selection.empty).toBe(true)
  })

  it('原位置超出新文档范围时夹到文档末尾，不抛错', () => {
    const editor = createEditor(documentJson('第一段文字', '第二段文字', '第三段文字'))
    editor.commands.setTextSelection(editor.state.doc.content.size - 2)

    expect(() => installRemoteDocument(editor, documentJson('只剩一段'))).not.toThrow()
    expect(editor.state.selection.from).toBeLessThanOrEqual(editor.state.doc.content.size)
    expect(editor.state.doc.textContent).toContain('只剩一段')
  })

  it('内容不符合 schema 时抛错并保持原内容', () => {
    const editor = createEditor(documentJson('旧内容'))
    expect(() => installRemoteDocument(editor, { type: 'doc', content: [{ type: 'not-a-production-node' }] })).toThrow()
    expect(editor.state.doc.textContent).toContain('旧内容')
  })
})
