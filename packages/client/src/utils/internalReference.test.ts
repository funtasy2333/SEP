// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { collectInternalReferences, insertInternalReference } from './internalReference'
import { closeHistory } from '@tiptap/pm/history'

let editor: Editor
afterEach(() => editor?.destroy())
function setup() {
  editor = new Editor({ extensions: createEditorExtensions(), content: { type: 'doc', content: [
    { type: 'chapter', attrs: { nodeId: 'c1' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '目标章节' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: '参见此处。' }] },
      { type: 'termDef', attrs: { nodeId: 't1' }, content: [
        { type: 'termName', content: [{ type: 'text', text: '术语甲' }] },
        { type: 'termDefinition', content: [{ type: 'text', text: '定义' }] },
      ] },
    ] },
  ] } })
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.nodeId === 'p1') editor.commands.setTextSelection(pos + 3)
  })
}

it('lists numbered targets with their title without mutating the document', () => {
  setup()
  const before = editor.getJSON()
  expect(collectInternalReferences(editor)).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'c1', type: 'chapter', text: '第1章', title: '目标章节' }),
    expect.objectContaining({ id: 't1', type: 'term', text: '1.1', title: '术语甲' }),
  ]))
  expect(collectInternalReferences(editor).some(target => target.id === 'p1')).toBe(false)
  expect(editor.getJSON()).toEqual(before)
})

it('inserts a stable target at the saved cursor and supports undo and JSON reopen', () => {
  setup()
  const before = editor.getJSON()
  const selection = editor.state.selection
  expect(insertInternalReference(editor, 'c1', editor.state.doc, selection.getBookmark())).toBe(true)
  expect(editor.state.doc.textContent).toContain('参见第1章此处。')
  const saved = editor.getJSON()
  const reopened = new Editor({ extensions: createEditorExtensions(), content: saved })
  try { expect(reopened.getHTML()).toContain('href="#c1"') } finally { reopened.destroy() }
  editor.commands.undo()
  expect(editor.getJSON()).toEqual(before)
})

it('rejects stale positions and nonexistent targets while preserving all text', () => {
  setup()
  const doc = editor.state.doc
  const bookmark = editor.state.selection.getBookmark()
  editor.commands.insertContent('新')
  const before = editor.getJSON()
  expect(insertInternalReference(editor, 'c1', doc, bookmark)).toBe(false)
  expect(insertInternalReference(editor, 'missing', editor.state.doc, editor.state.selection.getBookmark())).toBe(false)
  expect(editor.getJSON()).toEqual(before)
})

it('keeps generated reference text aligned with the target after renumbering and undo', () => {
  setup()
  expect(insertInternalReference(editor, 'c1', editor.state.doc, editor.state.selection.getBookmark())).toBe(true)
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.commands.insertContentAt(0, { type: 'chapter', content: [
    { type: 'chapterTitle', content: [{ type: 'text', text: '新增章' }] }, { type: 'stdParagraph' },
  ] })
  expect(editor.view.dom.querySelector('a.std-cross-ref')?.textContent).toBe('第2章')
  expect(editor.getHTML()).toContain('href="#c1"')
  editor.commands.undo()
  expect(editor.view.dom.querySelector('a.std-cross-ref')?.textContent).toBe('第1章')
})

it('rejects code blocks that cannot retain a reference mark, without inserting plain numbering', () => {
  setup()
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] })
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'codeBlock') editor.commands.setTextSelection(pos + 1) })
  expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock')
  const before = editor.getJSON()
  expect(insertInternalReference(editor, 'c1', editor.state.doc, editor.state.selection.getBookmark())).toBe(false)
  expect(editor.getJSON()).toEqual(before)
})

it.each([false, true])('renumbers partially formatted and adjacent generated references (adjacent=%s)', adjacent => {
  setup()
  expect(insertInternalReference(editor, 'c1', editor.state.doc, editor.state.selection.getBookmark())).toBe(true)
  if (adjacent) expect(insertInternalReference(editor, 'c1', editor.state.doc, editor.state.selection.getBookmark())).toBe(true)
  else {
    let start = 0
    editor.state.doc.descendants((node, pos) => { if (node.marks.some(mark => mark.type.name === 'crossRef')) start = pos })
    editor.commands.setTextSelection({ from: start + 1, to: start + 2 })
    editor.commands.toggleBold()
  }
  editor.commands.insertContentAt(0, { type: 'chapter', content: [{ type: 'chapterTitle' }, { type: 'stdParagraph' }] })
  expect(editor.view.dom.querySelector('a.std-cross-ref')?.textContent).toBe(adjacent ? '第2章第2章' : '第2章')
  if (!adjacent) expect(editor.view.dom.querySelector('a.std-cross-ref strong')?.textContent).toBe('2')
})
