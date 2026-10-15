// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { setClauseFormat, setParagraphFormat } from './structureEditing'
import { nodeById } from './__fixtures__/structureEditor'

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
function expectNoStructureWarnings(e: Editor) {
  const { doc } = pmToIr(e.getJSON() as PMJsonNode)
  expect(resolve(doc).problems.filter(p => ['heading-skip', 'hanging-paragraph'].includes(p.code))).toEqual([])
}
afterEach(() => { for (const e of editors.splice(0)) { const el = e.options.element; e.destroy(); if (el instanceof HTMLElement) el.remove() } })

describe('结构格式覆盖（生产Tiptap schema）', () => {
  it.each(['chapter', 'appendix', 'clause'])('%s 中拒绝将前文留成悬置段，完整保留文字和选区', hostType => {
    const body = [p('preceding', '前文段落'), p('target', '待转换段落'), p('following', '后续正文')]
    const e = editor(hostType === 'clause' ? [clause('parent', '上级条', body)] : body)
    if (hostType === 'appendix') e.commands.setContent({ type: 'doc', content: [{ type: 'appendix', attrs: { nodeId: 'appendix' }, content: [
      { type: 'appendixLabel', content: [text('（规范性）')] },
      { type: 'appendixTitle', content: [text('附录标题')] }, ...body,
    ] }] })
    select(e, '待转换段落', 1, 2)
    const original = e.getJSON()
    const selection = e.state.selection.toJSON()
    expectNoStructureWarnings(e)
    expect(setClauseFormat(e, hostType === 'clause' ? 2 : 1).ok).toBe(false)
    expect(e.getJSON()).toEqual(original)
    expect(e.state.selection.toJSON()).toEqual(selection)
    expectNoStructureWarnings(e)
    select(e, '前文段落')
    expect(setClauseFormat(e, hostType === 'clause' ? 2 : 1).ok).toBe(true)
    expect(clauseByTitle(e, '前文段落').node.childCount).toBe(3)
    expectNoStructureWarnings(e)
  })
  it.each(['bulletList', 'orderedList'])('%s 项的段落按钮不新增空项目符号，保留文字、marks 和续段', listType => {
    const e = editor([{ type: listType, content: [{ type: 'listItem', content: [
      { type: 'paragraph', attrs: { nodeId: 'list-p' }, content: [text('列表项正文', [{ type: 'bold' }])] },
      { type: 'paragraph', attrs: { nodeId: 'list-continuation' }, content: [text('列表项续段')] },
    ] }] }])
    select(e, '列表项正文', 1, 2)
    const json = e.getJSON()
    expect(setParagraphFormat(e).ok).toBe(true)
    expect(e.getJSON()).toEqual(json)
    select(e, '列表项续段')
    expect(setParagraphFormat(e).ok).toBe(true)
    expect(e.getJSON()).toEqual(json)
    expect(e.view.dom.querySelectorAll('li p')).toHaveLength(2)
    expect(e.view.dom.querySelector('li p')?.textContent).toBe('列表项正文')
    e.state.doc.check()
  })
  it('部分选中文字也转换整个段落，保留inline标记、nodeId和相邻正文', () => {
    const source = p('target', '总体原则三')
    source.content = [text('总体原则三', [{ type: 'bold' }]), text('及引用', [{ type: 'crossRef', attrs: { targetNodeId: 'other', refType: 'section' } }])]
    const e = editor([source, p('following', '后续正文')])
    const original = e.state.doc.child(0).child(1)
    select(e, '总体原则三', 1, 2)
    expect(setClauseFormat(e, 1).ok).toBe(true)
    const converted = clauseByTitle(e, '总体原则三及引用')
    expect(converted.node.attrs.nodeId).toBe('target')
    expect(converted.node.firstChild!.content.eq(original.content)).toBe(true)
    expect(e.state.selection.$from.parentOffset).toBe(1)
    expect(e.state.selection.$to.parentOffset).toBe(3)
    expect(converted.node.lastChild?.textContent).toBe('后续正文')
    e.state.doc.check()
  })

  it('仅点击段落即可转换；反复设置同一级不会新增空条', () => {
    const e = editor([p('target', '总体原则三')])
    select(e, '总体原则三')
    expect(setClauseFormat(e, 1).ok).toBe(true)
    expect(setClauseFormat(e, 1).ok).toBe(true)
    expect(e.state.doc.child(0).childCount).toBe(2)
    clauseByTitle(e, '总体原则三')
  })

  it('位于已有一级条内部的段落转为一级条时提升为同级，前后内容及原空条保留', () => {
    const e = editor([clause('a', '总体原则一', [p('a-body', '第一条正文'), clause('b', '总体原则二', [
      p('target', '总体原则三'), p('new-body', '第三条正文'), clause('empty', ''), clause('d', '总体原则四', [p('d-body', '第四条正文')]),
    ])]), p('after', '章末正文')])
    const before = e.state.doc.textContent
    select(e, '总体原则三')
    expect(setClauseFormat(e, 1).ok).toBe(true)
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
    expect(setClauseFormat(e, 2).ok).toBe(true)
    const target = clauseByTitle(e, '子条标题')
    expect(target.parent?.attrs.nodeId).toBe('a')
    expect(target.node.attrs.level).toBe(2)
    expect(target.node.firstChild?.attrs.level).toBe(2)
    e.state.doc.check()
  })

  it('深层提升不会把后续三级条挂到一级条下；安全的后续二级条可保留', () => {
    const e = editor([clause('one', '一级条', [clause('two', '二级条', [
      clause('three-a', '第一个三级条', [p('deep-body', '三级条正文')], 3),
      clause('three-b', '第二个三级条', [p('peer-body', '后续三级条正文')], 3),
    ], 2)])])
    select(e, '第一个三级条')
    const original = e.getJSON()
    expect(setClauseFormat(e, 1).ok).toBe(false)
    select(e, '三级条正文')
    expect(setClauseFormat(e, 1).ok).toBe(false)
    expect(e.getJSON()).toEqual(original)
    expectNoStructureWarnings(e)

    const safe = editor([clause('one', '原一级条', [
      clause('target', '待提升二级条', [], 2), clause('peer', '后续二级条', [p('body', '后续正文')], 2),
    ])])
    const textBefore = safe.state.doc.textContent
    select(safe, '待提升二级条')
    expect(setClauseFormat(safe, 1).ok).toBe(true)
    expect(clauseByTitle(safe, '后续二级条').parent?.attrs.nodeId).toBe('target')
    expect(safe.state.doc.textContent).toBe(textBefore)
    expectNoStructureWarnings(safe)

    const hanging = editor([clause('one', '原一级条', [
      clause('target', '有正文的二级条', [p('body', '本条正文')], 2), clause('peer', '后续二级条', [], 2),
    ])])
    select(hanging, '有正文的二级条')
    const json = hanging.getJSON()
    expect(setClauseFormat(hanging, 1).ok).toBe(false)
    expect(hanging.getJSON()).toEqual(json)
    expectNoStructureWarnings(hanging)
  })

  // 改动说明（WP76 A3）：无题条统一为 IR 模型（clauseTitle 为空、条文在首个正文段），且无题条不得再分条。
  // 原断言要求「含子条的条切换为无题后 content 与原来完全相同」——即标题文字留在 clauseTitle，与 IR 模型冲突
  // （导出被 unsupportedContent 阻断），且含子条的条转无题违反 GB/T 1.1 7.3.4，故改为：
  // 无子条的条切换时标题文字移为新建首段，含子条的条被拒绝（untitled-with-children）。
  it('已有条标题切换有题/无题格式，标题文字移入首段，保留正文与稳定锚点；含子条的条不能转无题', () => {
    const e = editor([clause('a', '总体原则一', [p('body', '正文')])])
    const source = clauseByTitle(e, '总体原则一').node
    select(e, '总体原则一', 1, 2)
    expect(setClauseFormat(e, 1, false).ok).toBe(true)
    const target = nodeById(e, 'a').node
    expect(target.attrs).toMatchObject({ nodeId: 'a', hasTitle: false })
    expect(target.firstChild!.content.size).toBe(0)
    expect(target.child(1).textContent).toBe('总体原则一')
    expect(target.child(1).content.eq(source.firstChild!.content)).toBe(true)
    expect(target.child(2).eq(source.child(1))).toBe(true)
    expect(setClauseFormat(e, 1, true).ok).toBe(true)
    expect(nodeById(e, 'a').node.attrs.hasTitle).toBe(true)

    const withChild = editor([clause('a', '总体原则一', [p('body', '正文'), clause('nested', '子条', [], 2)])])
    select(withChild, '总体原则一', 1, 2)
    const json = withChild.getJSON()
    expect(setClauseFormat(withChild, 1, false)).toEqual({ ok: false, reason: 'untitled-with-children' })
    expect(withChild.getJSON()).toEqual(json)
  })

  it('单个叶子条转段落不拼接或丢弃正文；已是段落时不新增空行', () => {
    const e = editor([clause('a', '总体原则一', [p('body', '正文')])])
    const before = e.state.doc.textContent
    const body = clauseByTitle(e, '总体原则一').node.child(1)
    select(e, '总体原则一')
    expect(setParagraphFormat(e).ok).toBe(true)
    expect(e.state.doc.child(0).child(1).attrs.nodeId).toBe('a')
    expect(e.state.doc.child(0).child(2).eq(body)).toBe(true)
    expect(e.state.doc.textContent).toBe(before)
    const json = e.getJSON()
    expect(setParagraphFormat(e).ok).toBe(true)
    expect(e.getJSON()).toEqual(json)
    e.state.doc.check()
    expectNoStructureWarnings(e)
  })

  it('新条接收后续正文直到同级条；章、附录及条内均无新增悬置段', () => {
    const e = editor([p('target', '新条'), p('a', '后续正文一'), p('b', '后续正文二'), clause('peer', '下一条', [p('peer-body', '下一条正文')])])
    const before = e.state.doc.textContent
    select(e, '新条')
    expect(setClauseFormat(e, 1).ok).toBe(true)
    expect(clauseByTitle(e, '新条').node.childCount).toBe(3)
    expect(clauseByTitle(e, '下一条').parent?.type.name).toBe('chapter')
    expect(e.state.doc.textContent).toBe(before)
    expectNoStructureWarnings(e)

    e.commands.setContent({ type: 'doc', content: [{ type: 'appendix', attrs: { nodeId: 'appendix' }, content: [
      { type: 'appendixLabel', content: [text('（规范性）')] },
      { type: 'appendixTitle', content: [text('附录标题')] },
      p('ap', '附录新条'), p('ap-body', '附录正文'), clause('ap-peer', '附录下一条'),
    ] }] })
    select(e, '附录新条')
    expect(setClauseFormat(e, 1).ok).toBe(true)
    expect(clauseByTitle(e, '附录新条').node.lastChild?.attrs.nodeId).toBe('ap-body')
    expectNoStructureWarnings(e)

    e.commands.setContent({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle', content: [text('章标题')] },
      clause('parent', '一级条', [p('nested', '新二级条'), p('nested-body', '二级条正文'), clause('peer2', '下一二级条', [], 2)]),
    ] }] })
    select(e, '新二级条')
    expect(setClauseFormat(e, 2).ok).toBe(true)
    expect(clauseByTitle(e, '新二级条').node.lastChild?.attrs.nodeId).toBe('nested-body')
    expectNoStructureWarnings(e)
  })

  it('有子条或无前条可接收正文时，拒绝解除条容器并保持原层级', () => {
    const e = editor([clause('a', '有子条', [clause('nested', '子条', [p('body', '子条正文')], 2)])])
    select(e, '有子条')
    const original = e.getJSON()
    expect(setParagraphFormat(e).ok).toBe(false)
    expect(e.getJSON()).toEqual(original)
    expectNoStructureWarnings(e)

    e.commands.setContent({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle', content: [text('章标题')] }, clause('first', '第一条'), clause('second', '第二条'),
    ] }] })
    select(e, '第一条')
    const siblings = e.getJSON()
    expect(setParagraphFormat(e).ok).toBe(false)
    expect(e.getJSON()).toEqual(siblings)
    expectNoStructureWarnings(e)

    e.commands.setContent({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle', content: [text('章标题')] },
      clause('outer', '一级条', [clause('child', '带子条的二级条', [clause('grandchild', '三级条', [p('body', '原正文')], 3)], 2)]),
    ] }] })
    select(e, '带子条的二级条')
    const ancestry = e.getJSON()
    expect(setClauseFormat(e, 1).ok).toBe(false)
    expect(e.getJSON()).toEqual(ancestry)
    // 改动说明（WP76 A3）：原断言期望含子条的条可转无题（true）；无题条不得再分条，现拒绝并保持原文档。
    expect(setClauseFormat(e, 2, false)).toEqual({ ok: false, reason: 'untitled-with-children' })
    expect(e.getJSON()).toEqual(ancestry)
    expect(setClauseFormat(e, 2, true).ok).toBe(true)
    expectNoStructureWarnings(e)
  })

  it('后续叶子条改段落时正文归入前条，保留顺序、marks、锚点及撤销重做', () => {
    const e = editor([clause('a', '前条', [p('before', '原前条正文')]), clause('b', '转段标题', [p('body', '转段正文')])])
    const before = e.state.doc.textContent
    select(e, '转段标题', 1, 2)
    e.commands.setMark('bold')
    const title = clauseByTitle(e, '转段标题').node.firstChild!
    expect(setParagraphFormat(e).ok).toBe(true)
    const target = clauseByTitle(e, '前条').node
    expect(e.state.doc.firstChild?.childCount).toBe(2)
    expect(target.child(2).attrs.nodeId).toBe('b')
    expect(target.child(2).content.eq(title.content)).toBe(true)
    expect(target.lastChild?.attrs.nodeId).toBe('body')
    expect(e.state.selection.$from.parentOffset).toBe(1)
    expect(e.state.doc.textContent).toBe(before)
    expectNoStructureWarnings(e)
    expect(e.commands.undo()).toBe(true)
    expect(clauseByTitle(e, '转段标题').node.attrs.nodeId).toBe('b')
    expect(e.commands.redo()).toBe(true)
    expectNoStructureWarnings(e)
  })

  it('一次格式转换可撤销和重做，不产生第二条或丢失文字', () => {
    const e = editor([p('target', '总体原则三')])
    select(e, '总体原则三')
    expect(setClauseFormat(e, 1).ok).toBe(true)
    expect(e.commands.undo()).toBe(true)
    expect(e.state.doc.child(0).child(1).type.name).toBe('stdParagraph')
    expect(e.state.doc.child(0).child(1).textContent).toBe('总体原则三')
    expect(e.commands.redo()).toBe(true)
    clauseByTitle(e, '总体原则三')
  })

  it('空段转为空条后可直接输入，不保留第二个空段', () => {
    const e = editor([p('empty')])
    e.commands.setTextSelection(e.state.doc.firstChild!.firstChild!.nodeSize + 2)
    expect(setClauseFormat(e, 1).ok).toBe(true)
    expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
    e.commands.insertContent('新条标题')
    expect(e.state.doc.firstChild?.childCount).toBe(2)
    expect(clauseByTitle(e, '新条标题').node.attrs.nodeId).toBe('empty')
    e.state.doc.check()
  })

  it('拒绝缺少上级条的层级跳跃，正文、已有标题与编号结构保持不变', () => {
    const e = editor([p('direct', '章下段落'), clause('first', '已有一级条', [p('nested', '条内段落')])])
    select(e, '章下段落')
    const original = e.getJSON()
    for (const level of [2, 3, 4, 5]) expect(setClauseFormat(e, level).ok).toBe(false)
    select(e, '已有一级条')
    expect(setClauseFormat(e, 4).ok).toBe(false)
    select(e, '条内段落')
    for (const level of [3, 4, 5]) expect(setClauseFormat(e, level).ok).toBe(false)
    expect(e.getJSON()).toEqual(original)
    expect(setClauseFormat(e, 2).ok).toBe(true)
    expect(clauseByTitle(e, '条内段落').parent?.attrs.level).toBe(1)
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
    expect(setClauseFormat(e, 1).ok).toBe(true)
    expect(clauseByTitle(e, '附录段落').parent?.type.name).toBe('appendix')
    e.commands.setContent({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [text('表格章')] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell', '单元格正文')] }] }] },
    ] }] })
    select(e, '单元格正文')
    const json = e.getJSON()
    expect(setClauseFormat(e, 1).ok).toBe(false)
    expect(e.getJSON()).toEqual(json)
    e.state.doc.check()
  })

  it('跨段选区、章标题、术语定义或越界级别拒绝转换，不默默新增空条', () => {
    const e = editor([p('a', '第一段'), p('b', '第二段'), { type: 'termDef', attrs: { nodeId: 'term' }, content: [
      { type: 'termName', content: [text('术语')] }, { type: 'termDefinition', content: [text('定义')] },
    ] }])
    select(e, '第一段')
    const json = e.getJSON()
    expect(setClauseFormat(e, 0).ok).toBe(false)
    expect(setClauseFormat(e, 6).ok).toBe(false)
    const from = e.state.selection.from
    select(e, '第二段', 2)
    e.commands.setTextSelection({ from, to: e.state.selection.to })
    expect(setClauseFormat(e, 1).ok).toBe(false)
    select(e, '总体原则')
    expect(setClauseFormat(e, 1).ok).toBe(false)
    select(e, '定义')
    expect(setClauseFormat(e, 1).ok).toBe(false)
    expect(e.getJSON()).toEqual(json)
  })
})
