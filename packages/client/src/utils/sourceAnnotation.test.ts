// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { findSourceAnnotation, saveSourceAnnotation } from './sourceAnnotation'
import { exportSemanticHtml } from '../serializer/htmlExporter'
import { serializeToXml } from '../serializer/xmlSerializer'
import { parseXmlToEditorJson } from '../serializer/xmlParser'
import { buildDocx } from '@ses/io'
import JSZip from 'jszip'
import { NodeSelection } from '@tiptap/pm/state'

let editor: Editor
afterEach(() => editor?.destroy())
const text = (value: string) => [{ type: 'text', text: value }]
export function sourceFixture(): PMJsonNode {
  return { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c1' }, content: [
    { type: 'chapterTitle', content: text('来源测试') },
    { type: 'stdParagraph', attrs: { nodeId: 'p1' }, content: text('正文原文') },
    { type: 'figure', attrs: { nodeId: 'f1' }, content: [
      { type: 'figureImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' } },
      { type: 'figureCaption', content: text('图题原文') },
    ] },
    { type: 'stdTable', attrs: { nodeId: 'table1' }, content: [
      { type: 'tableCaption', content: text('表题原文') },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: text('单元格原文') }] },
      ] }] },
    ] },
    { type: 'termDef', attrs: { nodeId: 't1' }, content: [
      { type: 'termName', content: text('术语') },
      { type: 'termDefinition', content: text('定义原文') },
      { type: 'note', content: text('注原文') },
      { type: 'termDef', attrs: { nodeId: 't2', level: 2 }, content: [
        { type: 'termName', content: text('子术语') },
        { type: 'termDefinition', content: text('子定义原文') },
      ] },
    ] },
  ] }] }
}
function selectText(value: string) {
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === value) editor.commands.setTextSelection(pos + 1)
  })
}
function setup(flat = false) {
  const fixture = sourceFixture()
  if (flat) {
    const term = fixture.content![0]!.content!.find(node => node.type === 'termDef')!
    term.content = term.content!.filter(node => node.type !== 'termDef')
  }
  editor = new Editor({ extensions: createEditorExtensions(), content: fixture })
}

it.each([
  ['正文原文', 'paragraph'], ['图题原文', 'figure'], ['单元格原文', 'table'], ['定义原文', 'term'], ['子定义原文', 'term'],
])('inserts, edits and deletes the source for %s without touching the original', (value, kind) => {
  setup()
  selectText(value)
  const before = editor.getJSON()
  const location = findSourceAnnotation(editor)!
  expect(location?.kind).toBe(kind)
  expect(saveSourceAnnotation(editor, location, 'GB/T 123—2026，5.1')).toBe(true)
  editor.state.doc.check()
  selectText(value)
  const existing = findSourceAnnotation(editor)!
  expect(existing.existing).toBe(true)
  expect(existing.text).toBe('GB/T 123—2026，5.1')
  expect(saveSourceAnnotation(editor, existing, '修改后的来源')).toBe(true)
  selectText(value)
  expect(saveSourceAnnotation(editor, findSourceAnnotation(editor)!, null)).toBe(true)
  expect(editor.getJSON()).toEqual(before)
})

it('keeps figure/table sources outside the object and term sources before notes and child terms', () => {
  setup()
  for (const value of ['图题原文', '单元格原文', '定义原文', '子定义原文']) {
    selectText(value)
    expect(saveSourceAnnotation(editor, findSourceAnnotation(editor)!, value + '的来源')).toBe(true)
  }
  const children = (editor.getJSON() as PMJsonNode).content![0]!.content!
  const figure = children.findIndex(node => node.type === 'figure')
  const table = children.findIndex(node => node.type === 'stdTable')
  expect(children[figure + 1]).toMatchObject({ type: 'stdParagraph', content: text('[来源：图题原文的来源]') })
  expect(children[table + 1]).toMatchObject({ type: 'stdParagraph', content: text('[来源：单元格原文的来源]') })
  const term = children.find(node => node.type === 'termDef')!
  expect(term.content!.map(node => node.type)).toEqual(['termName', 'termDefinition', 'termSource', 'note', 'termDef'])
  expect(JSON.stringify(pmToIr(editor.getJSON()).doc)).toContain('子定义原文的来源')
})

it('reopens a source paragraph itself for editing rather than adding another source', () => {
  setup(); selectText('正文原文')
  expect(saveSourceAnnotation(editor, findSourceAnnotation(editor)!, '甲')).toBe(true)
  selectText('[来源：甲]')
  expect(findSourceAnnotation(editor)?.text).toBe('甲')
  expect(saveSourceAnnotation(editor, findSourceAnnotation(editor)!, '乙')).toBe(true)
  expect(editor.state.doc.textContent).toContain('[来源：乙]')
  expect(editor.state.doc.textContent).not.toContain('[来源：甲]')
})

it('refuses stale locations and blank values; cancel/read does not change content', () => {
  setup(); selectText('正文原文')
  const before = editor.getJSON()
  const location = findSourceAnnotation(editor)!
  expect(editor.getJSON()).toEqual(before)
  expect(saveSourceAnnotation(editor, location, '  ')).toBe(false)
  editor.commands.insertContent('新')
  const changed = editor.getJSON()
  expect(saveSourceAnnotation(editor, location, '来源')).toBe(false)
  expect(editor.getJSON()).toEqual(changed)
})

it('preserves sources after JSON reload and undo restores the insertion', () => {
  setup(); selectText('定义原文')
  const before = editor.getJSON()
  expect(saveSourceAnnotation(editor, findSourceAnnotation(editor)!, '标准甲')).toBe(true)
  const reopened = new Editor({ extensions: createEditorExtensions(), content: JSON.parse(JSON.stringify(editor.getJSON())) })
  try { expect(JSON.stringify(pmToIr(reopened.getJSON()).doc)).toContain('标准甲') } finally { reopened.destroy() }
  editor.commands.undo()
  expect(editor.getJSON()).toEqual(before)
})

it('exports four kinds of source to HTML and DOCX with one visible source label', async () => {
  setup(true)
  for (const [value, source] of [['正文原文', '正文资料'], ['图题原文', '图资料'], ['单元格原文', '表资料'], ['定义原文', '术语资料']]) {
    selectText(value!)
    expect(saveSourceAnnotation(editor, findSourceAnnotation(editor)!, source!)).toBe(true)
  }
  const html = exportSemanticHtml(editor.state.doc)
  expect(html).toContain('[来源：正文资料]')
  expect(html).toContain('[来源：图资料]')
  expect(html).toContain('[来源：表资料]')
  expect(html).toContain('class="ses-term-source">[来源：术语资料]</p>')
  const { bytes } = await buildDocx({ pmDoc: editor.getJSON(), documentMeta: { standardType: 'national', titleCn: '来源测试' } })
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('word/document.xml')!.async('string')
  const plain = new DOMParser().parseFromString(xml, 'application/xml').documentElement.textContent!
  for (const source of ['正文资料', '图资料', '表资料', '术语资料']) expect(plain).toContain(`[来源：${source}]`)
})

it('retains typed term sources in the existing XML export/import path', () => {
  setup(true); selectText('定义原文')
  expect(saveSourceAnnotation(editor, findSourceAnnotation(editor)!, 'GB/T 123—2026，5.1')).toBe(true)
  const xml = serializeToXml(editor.state.doc)
  expect(xml).toContain('GB/T 123—2026，5.1')
  const reopened = parseXmlToEditorJson(xml, editor.schema.topNodeType.name)
  expect(JSON.stringify(pmToIr(reopened).doc)).toContain('GB/T 123—2026，5.1')
})

it.each(['figure', 'figureImage', 'stdTable'])('accepts clicking/selecting the %s object before inserting a source', type => {
  setup()
  let pos = 0
  editor.state.doc.descendants((node, at) => { if (node.type.name === type) pos = at })
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
  expect(findSourceAnnotation(editor)?.kind).toBe(type === 'stdTable' ? 'table' : 'figure')
})
