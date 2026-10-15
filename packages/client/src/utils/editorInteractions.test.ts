// @vitest-environment happy-dom
import { Editor, type JSONContent } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { setParagraphFormat } from './structureEditing'
import { createDefaultDocumentContent } from './newDocument'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'

const editors: Editor[] = []
const text = (value: string): JSONContent => ({ type: 'text', text: value, marks: [{ type: 'bold' }] })
const p = (value: string): JSONContent => ({ type: 'stdParagraph', content: [text(value)] })
const list = (): JSONContent => ({ type: 'stdList', attrs: { nodeId: 'list', listType: 'alpha', level: 1 }, content: ['甲项目', '乙项目', '丙项目'].map((value, i) => ({ type: 'stdListItem', attrs: { nodeId: `item-${i}` }, content: [text(value)] })) })
const table = (): JSONContent => ({ type: 'stdTable', attrs: { nodeId: 'std-table' }, content: [
  { type: 'tableCaption', content: [text('测试表')] },
  { type: 'table', content: Array.from({ length: 2 }, (_, r) => ({ type: 'tableRow', content: Array.from({ length: 2 }, (_, c) => ({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: [text(`格${r}${c}`)] }] })) })) },
  { type: 'tableNoteRow', content: [{ type: 'note', content: [text('表注原文')] }] },
] })
function editor(body: JSONContent[]) {
  const e = new Editor({ extensions: createEditorExtensions(), editorProps: { handleScrollToSelection: () => true }, content: { type: 'doc', content: [{ type: 'chapter', content: [{ type: 'chapterTitle', content: [text('测试章')] }, ...body] }] } })
  e.view.dispatch(e.state.tr.setMeta('addToHistory', false))
  editors.push(e); return e
}
function pos(e: Editor, value: string) {
  let position = -1
  e.state.doc.descendants((node, at) => { if (node.isText && node.text === value) position = at })
  expect(position).toBeGreaterThan(-1); return position
}
const body = (e: Editor) => e.state.doc.firstChild!.content.content.slice(1)
afterEach(() => editors.splice(0).forEach(e => e.destroy()))

describe('用户反馈：列项转换保留内容', () => {
  it.each([0, 1, 2])('第%s项转段落保留前后列项、格式、锚点和选中文字', index => {
    const e = editor([list()]); const before = e.state.doc.textContent
    const value = ['甲项目', '乙项目', '丙项目'][index]!
    e.commands.setTextSelection({ from: pos(e, value) + 1, to: pos(e, value) + 3 })
    expect(setParagraphFormat(e).ok).toBe(true)
    const nodes = body(e)
    expect(nodes.map(n => n.type.name)).toEqual(index === 0 ? ['stdParagraph', 'stdList'] : index === 1 ? ['stdList', 'stdParagraph', 'stdList'] : ['stdList', 'stdParagraph'])
    const paragraph = nodes.find(n => n.type.name === 'stdParagraph')!
    expect(paragraph.attrs.nodeId).toBe(`item-${index}`)
    expect(paragraph.firstChild!.marks[0]!.type.name).toBe('bold')
    expect(e.state.doc.textContent).toBe(before)
    expect(e.state.selection.$from.parentOffset).toBe(1)
    expect(e.state.selection.$to.parentOffset).toBe(3)
    e.state.doc.check()
    expect(e.commands.undo()).toBe(true)
    expect(body(e).map(n => n.type.name)).toEqual(['stdList'])
    expect(e.commands.redo()).toBe(true)
    expect(e.state.doc.textContent).toBe(before)
  })
  it('跨两项的选区转换为两个独立段落，未选中的项仍为列项', () => {
    const e = editor([list()]); e.commands.setTextSelection({ from: pos(e, '乙项目') + 1, to: pos(e, '丙项目') + 2 })
    expect(setParagraphFormat(e).ok).toBe(true)
    expect(body(e).map(n => [n.type.name, n.textContent])).toEqual([['stdList', '甲项目'], ['stdParagraph', '乙项目'], ['stdParagraph', '丙项目']])
    e.state.doc.check()
  })
  it.each(['stdListItem', 'stdParagraph'])('选择%s的一部分改为注时保留整段内容、marks和锚点', type => {
    const e = editor(type === 'stdListItem' ? [list()] : [p('乙项目')]); const before = e.state.doc.textContent
    e.commands.setTextSelection({ from: pos(e, '乙项目') + 1, to: pos(e, '乙项目') + 2 })
    expect(e.commands.insertNote()).toBe(true)
    const note = body(e).find(n => n.type.name === 'note')!
    expect(note?.textContent).toBe('乙项目')
    expect(note.firstChild!.marks[0]!.type.name).toBe('bold')
    expect(e.state.doc.textContent).toBe(before)
    e.state.doc.check()
    expect(e.commands.undo()).toBe(true)
    expect(e.state.doc.textContent).toBe(before)
  })
  it('不能转换的跨结构选区不删除任何原文', () => {
    const e = editor([p('前文'), list(), p('后文')]); const before = e.getJSON()
    e.commands.setTextSelection({ from: pos(e, '前文'), to: pos(e, '乙项目') + 2 })
    expect(e.commands.insertNote()).toBe(false)
    expect(e.getJSON()).toEqual(before)
  })
})

describe('用户反馈：完整删除标准表格', () => {
  it.each(['cell', 'caption', 'note', 'node', 'cells'])('从%s删除表格时删除网格、标题和表注，保留前后文并可撤销', where => {
    const e = editor([p('前文'), table(), p('后文')]); const original = e.getJSON()
    if (where === 'node') {
      let at = -1; e.state.doc.descendants((n, position) => { if (n.type.name === 'stdTable') at = position })
      e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, at)))
    } else if (where === 'cells') {
      const positions: number[] = []; e.state.doc.descendants((n, position) => { if (['tableCell','tableHeader'].includes(n.type.name)) positions.push(position) })
      e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, positions[0]!, positions[3]!)))
    } else e.commands.setTextSelection(pos(e, where === 'caption' ? '测试表' : where === 'note' ? '表注原文' : '格00'))
    expect(e.commands.deleteTable()).toBe(true)
    expect(body(e).map(n => n.textContent)).toEqual(['前文', '后文'])
    e.state.doc.check()
    expect(e.commands.undo()).toBe(true)
    expect(e.getJSON()).toEqual(original)
    expect(e.commands.redo()).toBe(true)
    expect(body(e).map(n => n.type.name)).toEqual(['stdParagraph','stdParagraph'])
  })
  it.each(['deleteRow', 'deleteColumn'] as const)('删除所有%s不留下自动补回的空表格', command => {
    const e = editor([table(), p('后文')]); const positions: number[] = []
    e.state.doc.descendants((n, at) => { if (['tableCell','tableHeader'].includes(n.type.name)) positions.push(at) })
    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, positions[0]!, positions[3]!)))
    expect(e.commands[command]()).toBe(true)
    expect(body(e).map(n => n.type.name)).toEqual(['stdParagraph'])
    expect(e.state.doc.textContent).toBe('测试章后文')
  })
})

it('新建前言默认带专利识别语句和可填写的主要起草人行', () => {
  const e = new Editor({ extensions: createEditorExtensions(), content: createDefaultDocumentContent() })
  editors.push(e)
  const foreword = e.state.doc.firstChild!
  expect(foreword.textContent).toContain('不承担识别这些专利的责任。')
  expect(foreword.lastChild!.textContent).toBe('本文件主要起草人：')
})


describe('格式转换保留已有交叉引用的语义目标', () => {
  it.each(['targetId', 'refId'])('段落改注保持%s的段落引用有效，撤销重做恢复引用', field => {
    const target = { ...p('被引用段落'), attrs: { nodeId: 'target' } }
    const reference = { type: 'stdParagraph', content: [{ type: 'text', text: '引用文字', marks: [{ type: 'crossRef', attrs: { [field]: 'target', refType: 'paragraph' } }] }] }
    const e = editor([target, reference])
    e.commands.setTextSelection(pos(e, '被引用段落') + 1)
    const before = e.getJSON()
    expect(resolve(pmToIr(before as PMJsonNode).doc).problems.filter(p => p.code.startsWith('dangling'))).toEqual([])
    expect(e.commands.insertNote()).toBe(true)
    expect(resolve(pmToIr(e.getJSON() as PMJsonNode).doc).problems.filter(p => p.code.startsWith('dangling'))).toEqual([])
    const mark = body(e)[1]!.firstChild!.marks[0]!
    expect(mark.attrs[field]).toBe('target.p0')
    expect(mark.attrs.refType).toBe('paragraph')
    expect(e.commands.undo()).toBe(true)
    expect(e.getJSON()).toEqual(before)
    expect(e.commands.redo()).toBe(true)
    expect(resolve(pmToIr(e.getJSON() as PMJsonNode).doc).problems.filter(p => p.code.startsWith('dangling'))).toEqual([])
  })
  it('列项转段落将正文派生锚点引用重定向到新段落', () => {
    const reference = { type: 'stdParagraph', content: [{ type: 'text', text: '引用列项正文', marks: [{ type: 'crossRef', attrs: { targetId: 'item-1.p0', refType: 'paragraph' } }] }] }
    const e = editor([list(), reference])
    e.commands.setTextSelection(pos(e, '乙项目'))
    expect(resolve(pmToIr(e.getJSON() as PMJsonNode).doc).problems.filter(p => p.code.startsWith('dangling'))).toEqual([])
    expect(setParagraphFormat(e).ok).toBe(true)
    expect(resolve(pmToIr(e.getJSON() as PMJsonNode).doc).problems.filter(p => p.code.startsWith('dangling'))).toEqual([])
    expect(body(e).at(-1)!.firstChild!.marks[0]!.attrs.targetId).toBe('item-1')
  })
})


it('格式转换同时维护脚注负载和元数据inline中的段落引用', () => {
  const target = { ...p('目标段落'), attrs: { nodeId: 'target' } }
  const e = editor([target, { type: 'stdParagraph', content: [text('正文'), {
    type: 'footnoteRef', attrs: { nodeId: 'footnote', content: [{ type: 'text', text: '脚注引用', marks: [{ type: 'crossRef', attrs: { targetId: 'target', refType: 'paragraph' } }] }] },
  }] }])
  e.view.dispatch(e.state.tr.setDocAttribute('titleParts', [{ id: 'title-part', role: 'main', content: [{ text: '元数据引用', marks: [{ type: 'crossRef', targetId: 'target', targetKind: 'paragraph' }] }] }]))
  e.commands.setTextSelection(pos(e, '目标段落'))
  const before = e.getJSON()
  expect(resolve(pmToIr(before as PMJsonNode).doc).problems.filter(p => p.code.startsWith('dangling'))).toEqual([])
  expect(e.commands.insertNote()).toBe(true)
  expect(resolve(pmToIr(e.getJSON() as PMJsonNode).doc).problems.filter(p => p.code.startsWith('dangling'))).toEqual([])
  expect(e.commands.undo()).toBe(true)
  expect(e.getJSON()).toEqual(before)
})

it('删除内嵌普通网格不会删除外层标准表格', () => {
  const outer = table(); const nested = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text('内嵌格')] }] }] }] }
  outer.content![1]!.content![1]!.content![1]!.content!.push(nested)
  const e = editor([outer, p('后文')])
  e.commands.setTextSelection(pos(e, '内嵌格'))
  expect(e.commands.deleteTable()).toBe(true)
  expect(body(e)[0]!.type.name).toBe('stdTable')
  expect(e.state.doc.textContent).toContain('测试表')
  expect(e.state.doc.textContent).not.toContain('内嵌格')
  e.state.doc.check()
})
