// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, expect, it } from 'vitest'
import { pmToIr, renderHtml, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { replaceEditorDocument } from '../utils/editorDocument'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

function createEditor(entries: PMJsonNode[], referencedId?: string) {
  const content: PMJsonNode = { type: 'doc', content: [
      { type: 'chapter', content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
        { type: 'stdParagraph', content: referencedId ? [
          { type: 'text', text: '引用', marks: [{ type: 'crossRef', attrs: { targetId: referencedId, refType: 'bibEntry' } }] },
        ] : [] },
      ] },
      { type: 'bibliography', content: [{ type: 'bibliographyTitle' }, ...entries] },
    ] }
  const editor = new Editor({
    element: document.createElement('div'), extensions: createEditorExtensions(),
  })
  const source = structuredClone(content)
  replaceEditorDocument(editor, content as unknown as Record<string, unknown>)
  expect(content).toEqual(source)
  editors.push(editor)
  return editor
}

const entry = (id: string, text: string): PMJsonNode => ({
  type: 'bibEntry', attrs: { nodeId: id }, content: [{ type: 'text', text }],
})
const labels = (editor: Editor) => [...editor.view.dom.querySelectorAll<HTMLElement>('.std-bib-entry')]
  .map(element => element.dataset.resolvedLabel)

it('每条文献显示自动编号，增删条目后重新编号，不把编号写入正文', () => {
  const editor = createEditor([entry('b1', '文献甲'), entry('b2', '文献乙'), entry('b3', '文献丙')])
  expect(labels(editor)).toEqual(['[1]', '[2]', '[3]'])
  const before = editor.getJSON()
  let secondPos = 0
  let secondSize = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.nodeId === 'b2') { secondPos = pos; secondSize = node.nodeSize }
  })
  editor.commands.deleteRange({ from: secondPos, to: secondPos + secondSize })
  expect(labels(editor)).toEqual(['[1]', '[2]'])
  let insertAt = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'bibliography') insertAt = pos + node.nodeSize - 1
  })
  editor.commands.insertContentAt(insertAt, entry('b4', '文献丁'))
  expect(labels(editor)).toEqual(['[1]', '[2]', '[3]'])
  expect(JSON.stringify(before)).not.toContain('[1]')
  expect(JSON.stringify(editor.getJSON())).not.toContain('resolvedLabel')
})

it('旧文献正文中的编号只显示一次，并按引用顺序更新；导出不重复编号且保留正文格式', () => {
  const editor = createEditor([
    { type: 'bibEntry', attrs: { nodeId: 'b1' }, content: [
      { type: 'text', text: '[', marks: [{ type: 'bold' }] },
      { type: 'text', text: '1] ' },
      { type: 'text', text: '文献甲', marks: [{ type: 'italic' }] },
    ] },
    entry('b2', '文献乙'),
  ], 'b2')
  const before = editor.getJSON()
  expect(labels(editor)).toEqual(['[2]', '[1]'])
  expect(editor.view.dom.querySelector('.std-bib-entry')?.textContent).toBe('文献甲')
  const { doc } = pmToIr(before)
  expect(doc.bibliography[0]!.content).toEqual([{ text: '文献甲', marks: [{ type: 'italic' }] }])
  const html = renderHtml(doc, resolve(doc).labels)
  const root = document.createElement('div')
  root.innerHTML = html
  expect([...root.querySelectorAll('.ses-bib-entry')].map(el => el.textContent)).toEqual(['[1]　文献乙', '[2]　文献甲'])
  expect(editor.getJSON()).toEqual(before)
})

it.each(['backspace', 'insert-before'] as const)('编辑旧文献开头（%s）时移除旧编号，保留作者输入', action => {
  const editor = createEditor([entry('b1', '[1] 文献甲')])
  let start = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.nodeId === 'b1') start = pos + 1
  })
  expect(editor.view.dom.querySelector('.std-bib-entry')?.textContent).toBe('文献甲')
  if (action === 'backspace') editor.commands.deleteRange({ from: start, to: start + 1 })
  else editor.commands.insertContentAt(start, '新')
  const { doc } = pmToIr(editor.getJSON())
  expect(doc.bibliography[0]!.content.map(run => run.text).join('')).toBe(action === 'backspace' ? '献甲' : '新文献甲')
  expect(editor.view.dom.querySelector('.std-bib-entry')?.textContent).toBe(action === 'backspace' ? '献甲' : '新文献甲')
  expect(editor.view.dom.querySelector('.std-bibliography-title')?.textContent).toBe('')
  expect(labels(editor)).toEqual(['[1]'])
})
