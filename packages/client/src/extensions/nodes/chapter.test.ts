// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../editorExtensions'

const editors: Editor[] = []
function createEditor(title = '') {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element, extensions: createEditorExtensions(),
    editorProps: { handleScrollToSelection: () => true },
    content: { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle', content: title ? [{ type: 'text', text: title, marks: [{ type: 'bold' }] }] : [] },
      { type: 'stdParagraph', attrs: { nodeId: 'body' }, content: [{ type: 'text', text: '原正文' }] },
    ] }] },
  })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element
    editor.destroy()
    if (element instanceof HTMLElement) element.remove()
  }
})

describe('章标题的编号与编辑内容边界', () => {
  it('空标题可输入、撤销和重做，编号不进入文稿也不新增章内空段', () => {
    const editor = createEditor()
    const label = editor.view.dom.querySelector('.std-chapter-number')!
    expect(label.getAttribute('contenteditable')).toBe('false')
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('总体原则')
    expect(editor.state.doc.firstChild?.firstChild?.textContent).toBe('总体原则')
    expect(editor.state.doc.firstChild?.childCount).toBe(2)
    expect(editor.view.dom.querySelector('.std-chapter-title-content')?.textContent).toBe('总体原则')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.firstChild?.firstChild?.textContent).toBe('')
    expect(editor.commands.redo()).toBe(true)
    expect(editor.state.doc.firstChild?.textContent).toBe('总体原则原正文')
    editor.state.doc.check()
  })

  it('编辑视图的编号/占位不污染HTML/JSON，标题标记可往返且正文保留', () => {
    const editor = createEditor('总体原则')
    const html = editor.getHTML()
    expect(html).not.toContain('std-chapter-number')
    expect(html).not.toContain('std-chapter-title-content')
    expect(html).not.toContain('请输入章标题')
    const original = editor.state.doc.firstChild!.toJSON()
    expect(editor.schema.nodeFromJSON(editor.getJSON()).toJSON()).toEqual(editor.getJSON())
    editor.commands.setContent(html)
    expect(editor.state.doc.firstChild!.firstChild!.toJSON()).toEqual(original.content[0])
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
    expect(editor.state.doc.firstChild?.lastChild?.textContent).toBe('原正文')
  })
})
