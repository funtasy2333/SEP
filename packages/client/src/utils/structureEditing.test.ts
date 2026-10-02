// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { setClauseFormat, setParagraphFormat } from './structureEditing'

const editors: Editor[] = []
const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (id: string, value = ''): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: value ? [text(value)] : [] })
const clause = (id: string, title: string, body: JSONContent[] = [], level = 1): JSONContent => ({ type: 'clause', attrs: { nodeId: id, level }, content: [
  { type: 'clauseTitle', attrs: { level }, content: title ? [text(title)] : [] }, ...body,
] })
function editor(body: JSONContent[]): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const e = new Editor({ element, extensions: createEditorExtensions(), editorProps: { handleScrollToSelection: () => true }, content: {
    type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [{ type: 'chapterTitle', content: [text('总体原则')] }, ...body] }],
  } })
  editors.push(e)
  return e
}
function select(e: Editor, value: string, offset = 0, length = 0) {
  let pos = -1
  e.state.doc.descendants((n, at) => { if (pos < 0 && n.isText && n.text === value) pos = at })
  expect(pos).toBeGreaterThan(-1)
  e.commands.setTextSelection({ from: pos + offset, to: pos + offset + length })
}
function clauseByTitle(e: Editor, title: string) {
  const nodes = [] as Array<{ node: typeof e.state.doc; parent: typeof e.state.doc | null }>
  e.state.doc.descendants((n, _pos, parent) => { if (n.type.name === 'clause' && n.firstChild?.textContent === title) nodes.push({ node: n, parent }) })
  expect(nodes).toHaveLength(1)
  return nodes[0]!
}
afterEach(() => { for (const e of editors.splice(0)) { const el = e.options.element; e.destroy(); if (el instanceof HTMLElement) el.remove() } })

describe('结构格式覆盖（生产Tiptap schema）', () => {
  it('部分选中文字也转换整个段落，保留inline标记、nodeId和相邻正文', () => {
    const source = p('target', '总体原则三')
    source.content = [text('总体原则三', [{ type: 'bold' }]), text('及引用', [{ type: 'crossRef', attrs: { targetNodeId: 'other', refType: 'section' } }])]
    const e = editor([source, p('following', '后续正文')])
    const original = e.state.doc.child(0).child(1)
    select(e, '总体原则三', 1, 2)
    expect(setClauseFormat(e, 1)).toBe(true)
    const converted = clauseByTitle(e, '总体原则三及引用')
    expect(converted.node.attrs.nodeId).toBe('target')
    expect(converted.node.firstChild!.content.eq(original.content)).toBe(true)
    expect(e.state.selection.$from.parentOffset).toBe(1)
    expect(e.state.selection.$to.parentOffset).toBe(3)
    expect(e.state.doc.child(0).child(2).textContent).toBe('后续正文')
    e.state.doc.check()
  })

  it('仅点击段落即可转换；反复设置同一级不会新增空条', () => {
    const e = editor([p('target', '总体原则三')])
    select(e, '总体原则三')
    expect(setClauseFormat(e, 1)).toBe(true)
    expect(setClauseFormat(e, 1)).toBe(true)
    expect(e.state.doc.child(0).childCount).toBe(2)
    clauseByTitle(e, '总体原则三')
  })

  it('位于已有一级条内部的段落转为一级条时提升为同级，前后内容及原空条保留', () => {
    const e = editor([clause('a', '总体原则一', [p('a-body', '第一条正文'), clause('b', '总体原则二', [
      p('target', '总体原则三'), p('new-body', '第三条正文'), clause('empty', ''), clause('d', '总体原则四', [p('d-body', '第四条正文')]),
    ])]), p('after', '章末正文')])
    const before = e.state.doc.textContent
    select(e, '总体原则三')
    expect(setClauseFormat(e, 1)).toBe(true)
    const converted = clauseByTitle(e, '总体原则三')
    expect(converted.parent?.type.name).toBe('chapter')
    expect(converted.node.child(1).textContent).toBe('第三条正文')
    expect(clauseByTitle(e, '总体原则四').parent?.type.name).toBe('chapter')
    expect(e.state.doc.textContent).toBe(before)
    expect(e.state.doc.child(0).lastChild?.textContent).toBe('章末正文')
    e.state.doc.check()
    const { doc: ir } = pmToIr(e.getJSON() as PMJsonNode)
    expect(ir.body[0]?.children.some(n => n.kind === 'clause' && n.id === 'target')).toBe(true)
  })

  it('二级条保留在所属一级条内，原段落不重复', () => {
    const e = editor([clause('a', '总体原则一', [p('target', '子条标题')])])
    select(e, '子条标题')
    expect(setClauseFormat(e, 2)).toBe(true)
    const target = clauseByTitle(e, '子条标题')
    expect(target.parent?.attrs.nodeId).toBe('a')
    expect(target.node.attrs.level).toBe(2)
    expect(target.node.firstChild?.attrs.level).toBe(2)
    e.state.doc.check()
  })

  it('已有条标题切换有题/无题格式，保留正文、子条与稳定锚点', () => {
    const e = editor([clause('a', '总体原则一', [p('body', '正文'), clause('nested', '子条', [], 2)])])
    const source = clauseByTitle(e, '总体原则一').node
    select(e, '总体原则一', 1, 2)
    expect(setClauseFormat(e, 1, false)).toBe(true)
    const target = clauseByTitle(e, '总体原则一').node
    expect(target.attrs).toMatchObject({ nodeId: 'a', hasTitle: false })
    expect(target.content.eq(source.content)).toBe(true)
    expect(setClauseFormat(e, 1, true)).toBe(true)
    expect(clauseByTitle(e, '总体原则一').node.attrs.hasTitle).toBe(true)
  })

  it('条转段落不拼接或丢弃正文/子条；已是段落时不新增空行', () => {
    const e = editor([clause('a', '总体原则一', [p('body', '正文'), clause('nested', '子条', [], 2)])])
    const before = e.state.doc.textContent
    const body = clauseByTitle(e, '总体原则一').node.child(1)
    const nested = clauseByTitle(e, '总体原则一').node.child(2)
    select(e, '总体原则一')
    expect(setParagraphFormat(e)).toBe(true)
    expect(e.state.doc.child(0).child(1).attrs.nodeId).toBe('a')
    expect(e.state.doc.child(0).child(2).eq(body)).toBe(true)
    expect(e.state.doc.child(0).child(3).eq(nested)).toBe(true)
    expect(e.state.doc.textContent).toBe(before)
    const json = e.getJSON()
    expect(setParagraphFormat(e)).toBe(true)
    expect(e.getJSON()).toEqual(json)
    e.state.doc.check()
  })

  it('一次格式转换可撤销和重做，不产生第二条或丢失文字', () => {
    const e = editor([p('target', '总体原则三')])
    select(e, '总体原则三')
    expect(setClauseFormat(e, 1)).toBe(true)
    expect(e.commands.undo()).toBe(true)
    expect(e.state.doc.child(0).child(1).type.name).toBe('stdParagraph')
    expect(e.state.doc.child(0).child(1).textContent).toBe('总体原则三')
    expect(e.commands.redo()).toBe(true)
    clauseByTitle(e, '总体原则三')
  })

  it('空段转为空条后可直接输入，不保留第二个空段', () => {
    const e = editor([p('empty')])
    e.commands.setTextSelection(e.state.doc.firstChild!.firstChild!.nodeSize + 2)
    expect(setClauseFormat(e, 1)).toBe(true)
    expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
    e.commands.insertContent('新条标题')
    expect(e.state.doc.firstChild?.childCount).toBe(2)
    expect(clauseByTitle(e, '新条标题').node.attrs.nodeId).toBe('empty')
    e.state.doc.check()
  })

  it('附录段落可以覆盖为条，表格单元格里的段落不误转为章条', () => {
    const e = editor([])
    e.commands.setContent({ type: 'doc', content: [{ type: 'appendix', attrs: { nodeId: 'appendix' }, content: [
      { type: 'appendixLabel', content: [text('（规范性）')] },
      { type: 'appendixTitle', content: [text('附录标题')] },
      p('ap', '附录段落'),
    ] }] })
    select(e, '附录段落')
    expect(setClauseFormat(e, 1)).toBe(true)
    expect(clauseByTitle(e, '附录段落').parent?.type.name).toBe('appendix')
    e.commands.setContent({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [text('表格章')] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell', '单元格正文')] }] }] },
    ] }] })
    select(e, '单元格正文')
    const json = e.getJSON()
    expect(setClauseFormat(e, 1)).toBe(false)
    expect(e.getJSON()).toEqual(json)
    e.state.doc.check()
  })

  it('跨段选区、章标题、术语定义或越界级别拒绝转换，不默默新增空条', () => {
    const e = editor([p('a', '第一段'), p('b', '第二段'), { type: 'termDef', attrs: { nodeId: 'term' }, content: [
      { type: 'termName', content: [text('术语')] }, { type: 'termDefinition', content: [text('定义')] },
    ] }])
    select(e, '第一段')
    const json = e.getJSON()
    expect(setClauseFormat(e, 0)).toBe(false)
    expect(setClauseFormat(e, 6)).toBe(false)
    const from = e.state.selection.from
    select(e, '第二段', 2)
    e.commands.setTextSelection({ from, to: e.state.selection.to })
    expect(setClauseFormat(e, 1)).toBe(false)
    select(e, '总体原则')
    expect(setClauseFormat(e, 1)).toBe(false)
    select(e, '定义')
    expect(setClauseFormat(e, 1)).toBe(false)
    expect(e.getJSON()).toEqual(json)
  })
})
