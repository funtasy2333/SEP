// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from '../extensions/editorSchema'
import { installRemoteDocument, replaceEditorDocument } from './editorDocument'
import { setClauseFormat, setParagraphFormat } from './structureEditing'
import { countLegacyUntitledClauses } from './untitledClause'
import {
  appendixDoc, caretIn, chapterDoc, clause, destroyEditors, editor, irOf, item, list, makeEditor, nodeById, p, pressKey, select, snapshot, text, untitled,
} from './__fixtures__/structureEditor'

afterEach(destroyEditors)

/** 旧版编辑器的无题条：文字放在 clauseTitle，hasTitle=false。 */
const legacy = (id: string, title: JSONContent[], body: JSONContent[] = [], level = 1): JSONContent => ({
  type: 'clause', attrs: { nodeId: id, level, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level }, content: title }, ...body],
})

describe('无题条统一为 IR 模型：clauseTitle 为空，条文在首个 stdParagraph', () => {
  it('复现：段落转无题条后 clauseTitle 为空、条文成为首段，IR 无 unsupportedContent', () => {
    const e = editor([p('target', '条文正文'), p('next', '后续正文')])
    select(e, '条文正文', 1, 2)
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    const converted = e.state.doc.child(0).child(1)
    expect(converted.type.name).toBe('clause')
    expect(converted.attrs).toMatchObject({ hasTitle: false, level: 1 })
    expect(converted.firstChild!.type.name).toBe('clauseTitle')
    expect(converted.firstChild!.content.size).toBe(0)
    expect(converted.child(1).attrs.nodeId).toBe('target')
    expect(converted.child(1).textContent).toBe('条文正文')
    expect(converted.child(2).attrs.nodeId).toBe('next')
    // 原段落（可能被交叉引用的 paragraph）保留 nodeId，新条取新 nodeId
    expect(converted.attrs.nodeId).toEqual(expect.any(String))
    expect(converted.attrs.nodeId).not.toBe('target')
    expect(e.state.selection.$from.parent).toBe(converted.child(1))
    expect([e.state.selection.$from.parentOffset, e.state.selection.$to.parentOffset]).toEqual([1, 3])
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(irOf(e).labels[converted.attrs.nodeId as string]?.label).toBe('1.1')
  })

  it('有题→无题：原标题文字（含 marks）移为新建的首段，条保留 nodeId 与子内容', () => {
    const e = editor([{
      type: 'clause', attrs: { nodeId: 'a', level: 1 }, content: [
        { type: 'clauseTitle', attrs: { level: 1 }, content: [text('加粗', [{ type: 'bold' }]), text('普通')] },
        p('body', '原有正文'),
      ],
    }])
    select(e, '普通', 1, 0)
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    const target = nodeById(e, 'a').node
    expect(target.attrs.hasTitle).toBe(false)
    expect(target.firstChild!.content.size).toBe(0)
    const first = target.child(1)
    expect(first.type.name).toBe('stdParagraph')
    expect(first.textContent).toBe('加粗普通')
    expect(first.firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold'])
    expect(first.attrs.nodeId).toEqual(expect.any(String))
    expect(['a', 'body']).not.toContain(first.attrs.nodeId)
    expect(target.child(2).attrs.nodeId).toBe('body')
    expect(e.state.selection.$from.parent).toBe(first)
    expect(e.state.selection.$from.parentOffset).toBe(3)
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    // 再切回有题：只切换属性，标题保持为空，光标放到标题
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    const titled = nodeById(e, 'a').node
    expect(titled.attrs.hasTitle).toBe(true)
    expect(titled.firstChild!.content.size).toBe(0)
    expect(titled.child(1)).toBe(first)
    expect(e.state.selection.$from.parent).toBe(titled.firstChild)
  })

  it('有题无题切换对空标题只切属性，不制造空段', () => {
    const e = editor([clause('a', '', [p('body', '正文')])])
    e.commands.setTextSelection(nodeById(e, 'a').pos + 2)
    const childCount = nodeById(e, 'a').node.childCount
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    expect(nodeById(e, 'a').node.childCount).toBe(childCount)
    expect(nodeById(e, 'a').node.attrs.hasTitle).toBe(false)
  })

  it('光标在无题条首个正文段时，改级与有题无题切换作用于所在条，不嵌套新条', () => {
    const e = editor([clause('a', '一级条', [clause('b', '二级条', [], 2)]), untitled('u', 'up', '无题条文')])
    caretIn(e, 'up', 2)
    expect(setClauseFormat(e, 2, false)).toEqual({ ok: true })
    const moved = nodeById(e, 'u')
    expect(moved.parent?.attrs.nodeId).toBe('a')
    expect(moved.node.attrs).toMatchObject({ level: 2, hasTitle: false })
    expect(moved.node.firstChild!.attrs.level).toBe(2)
    expect(moved.node.childCount).toBe(2)
    expect(moved.node.child(1).attrs.nodeId).toBe('up')
    let clauses = 0
    e.state.doc.descendants(n => { if (n.type.name === 'clause') clauses += 1 })
    expect(clauses).toBe(3)
    expect([e.state.selection.$from.parent.attrs.nodeId, e.state.selection.$from.parentOffset]).toEqual(['up', 2])
    // 同一级同一格式重复设置不新增条
    expect(setClauseFormat(e, 2, false)).toEqual({ ok: true })
    clauses = 0
    e.state.doc.descendants(n => { if (n.type.name === 'clause') clauses += 1 })
    expect(clauses).toBe(3)
  })

  it('无题条的非首段仍按普通段落处理；无题条不得再分条', () => {
    const e = editor([untitled('u', 'up', '首段', [p('second', '第二段')])])
    caretIn(e, 'second')
    const original = snapshot(e)
    expect(setClauseFormat(e, 2)).toEqual({ ok: false, reason: 'untitled-with-children' })
    expect(snapshot(e)).toEqual(original)
  })

  it('光标在无题条首段时「段落」按钮解除编号：保留段落 nodeId 与文字', () => {
    const e = editor([untitled('u', 'up', '无题条文'), ])
    caretIn(e, 'up', 1)
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(e.state.doc.child(0).childCount).toBe(2)
    expect(e.state.doc.child(0).child(1).type.name).toBe('stdParagraph')
    expect(e.state.doc.child(0).child(1).attrs.nodeId).toBe('up')
    expect(e.state.selection.$from.parentOffset).toBe(1)
  })
})

describe('Enter / Backspace 快捷键', () => {
  it('在无题条的 clauseTitle 中回车：新建带空 clauseTitle 与空 stdParagraph 的同级无题条，光标进正文段', () => {
    const e = editor([clause('a', '一级条', [untitled('u', 'up', '无题条文', [], 2)])])
    e.commands.setTextSelection(nodeById(e, 'u').pos + 2)
    expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
    pressKey(e, 'Enter')
    const parent = nodeById(e, 'a').node
    expect(parent.childCount).toBe(3)
    const created = parent.child(2)
    expect(created.attrs).toMatchObject({ level: 2, hasTitle: false })
    expect(created.childCount).toBe(2)
    expect(created.firstChild!.type.name).toBe('clauseTitle')
    expect(created.firstChild!.content.size).toBe(0)
    expect(created.child(1).type.name).toBe('stdParagraph')
    expect(created.child(1).content.size).toBe(0)
    expect(e.state.selection.$from.parent).toBe(created.child(1))
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
  })

  it('无题条首段起点按退格：解除编号而不是把文字并入标题；整条为空时删除该条', () => {
    const e = editor([untitled('u', 'up', '无题条文')])
    caretIn(e, 'up', 0)
    pressKey(e, 'Backspace')
    expect(e.state.doc.child(0).child(1).type.name).toBe('stdParagraph')
    expect(e.state.doc.child(0).child(1).attrs.nodeId).toBe('up')
    expect(e.state.doc.child(0).childCount).toBe(2)

    const empty = editor([p('before', '前文'), untitled('empty', 'empty-p', '')])
    caretIn(empty, 'empty-p', 0)
    pressKey(empty, 'Backspace')
    expect(empty.state.doc.child(0).childCount).toBe(2)
    expect(empty.state.doc.child(0).lastChild?.attrs.nodeId).toBe('before')
  })
})

describe('appendTransaction 兜底：任何事务后无题条的 clauseTitle 内容移入正文段', () => {
  it('往无题条标题里输入文字：文字落入首个空段，光标随之移动，撤销一步还原', () => {
    const e = editor([untitled('u', 'up', '')])
    const original = snapshot(e)
    e.commands.setTextSelection(nodeById(e, 'u').pos + 2)
    e.view.dispatch(e.state.tr.insertText('误入'))
    const target = nodeById(e, 'u').node
    expect(target.firstChild!.content.size).toBe(0)
    expect(target.child(1).textContent).toBe('误入')
    expect(target.child(1).attrs.nodeId).toBe('up')
    expect(e.state.selection.$from.parent).toBe(target.child(1))
    expect(e.state.selection.$from.parentOffset).toBe(2)
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.commands.redo()).toBe(true)
    expect(nodeById(e, 'u').node.child(1).textContent).toBe('误入')
  })

  it('首段非空时新建段落承载标题文字，不与原有段落拼接', () => {
    const e = editor([untitled('u', 'up', '已有条文')])
    e.commands.setTextSelection(nodeById(e, 'u').pos + 2)
    e.view.dispatch(e.state.tr.insertText('新'))
    const target = nodeById(e, 'u').node
    expect(target.firstChild!.content.size).toBe(0)
    expect(target.childCount).toBe(3)
    expect(target.child(1).textContent).toBe('新')
    expect(target.child(1).attrs.nodeId).toEqual(expect.any(String))
    expect(target.child(2).textContent).toBe('已有条文')
    expect(target.child(2).attrs.nodeId).toBe('up')
    expect(e.state.selection.$from.parent).toBe(target.child(1))
  })

  it('无任何正文块或首块不是 stdParagraph 时新建 stdParagraph', () => {
    const noBody = makeEditor(chapterDoc([{ type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }] }]))
    noBody.commands.setTextSelection(nodeById(noBody, 'u').pos + 2)
    noBody.view.dispatch(noBody.state.tr.insertText('文字'))
    expect(nodeById(noBody, 'u').node.child(1).type.name).toBe('stdParagraph')
    expect(nodeById(noBody, 'u').node.child(1).textContent).toBe('文字')

    const withList = makeEditor(chapterDoc([{ type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [
      { type: 'clauseTitle', attrs: { level: 1 } }, list('l', 'dash', [item('i', '列项')]),
    ] }]))
    withList.commands.setTextSelection(nodeById(withList, 'u').pos + 2)
    withList.view.dispatch(withList.state.tr.insertText('先导'))
    const target = nodeById(withList, 'u').node
    expect(target.child(1).type.name).toBe('stdParagraph')
    expect(target.child(1).textContent).toBe('先导')
    expect(target.child(2).type.name).toBe('stdList')
  })

  it('有题条的标题不受影响', () => {
    const e = editor([clause('a', '有题条', [p('body', '正文')])])
    const original = snapshot(e)
    select(e, '有题条', 1, 0)
    e.view.dispatch(e.state.tr.insertText('X'))
    expect(nodeById(e, 'a').node.firstChild!.textContent).toBe('有X题条')
    expect(nodeById(e, 'a').node.attrs.hasTitle).toBe(true)
    e.commands.undo()
    expect(snapshot(e)).toEqual(original)
  })
})

describe('旧稿载入：无题条的条文移入正文段', () => {
  const content = (): JSONContent => chapterDoc([
    clause('one', '一级条', [
      legacy('l1', [text('旧稿条文', [{ type: 'bold' }]), text('甲')], [{ type: 'stdParagraph', attrs: { nodeId: 'l1-p' } }], 2),
      legacy('l2', [text('旧稿条文乙')], [p('l2-p', '已有段落')], 2),
    ]),
    legacy('l3', [text('孤立旧条')]),
  ])

  it('载入后规范化：IR 无 unsupportedContent，空段被填充，非空首段前新建段落', () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'chapter', content: [{ type: 'chapterTitle', content: [text('章')] }] }] })
    expect(countLegacyUntitledClauses(e.schema.nodeFromJSON(content()))).toBe(3)
    expect(pmToIr(content() as PMJsonNode).doc.unsupportedContent?.length).toBe(3)
    replaceEditorDocument(e, content() as Record<string, unknown>)
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(countLegacyUntitledClauses(e.state.doc)).toBe(0)
    const l1 = nodeById(e, 'l1').node
    expect(l1.firstChild!.content.size).toBe(0)
    expect(l1.childCount).toBe(2)
    expect(l1.child(1).attrs.nodeId).toBe('l1-p')
    expect(l1.child(1).textContent).toBe('旧稿条文甲')
    expect(l1.child(1).firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold'])
    const l2 = nodeById(e, 'l2').node
    expect(l2.childCount).toBe(3)
    expect(l2.child(1).textContent).toBe('旧稿条文乙')
    expect(l2.child(2).attrs.nodeId).toBe('l2-p')
    const l3 = nodeById(e, 'l3').node
    expect(l3.child(1).textContent).toBe('孤立旧条')
  })

  it('直接以旧稿内容创建编辑器时，规范化后的 JSON 同样导出无阻断', () => {
    const e = makeEditor(content())
    // 初始内容不经过事务；任何后续文档事务都会兜底规范化
    e.view.dispatch(e.state.tr.insertText('X', 2))
    expect(countLegacyUntitledClauses(e.state.doc)).toBe(0)
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
  })

  it('服务端外部修改载入（不进入撤销历史）时同样规范化，且撤销栈保持为空', () => {
    const e = makeEditor(chapterDoc([clause('a', '原有')]))
    expect(installRemoteDocument(e, content() as Record<string, unknown>)).toBe(true)
    expect(countLegacyUntitledClauses(e.state.doc)).toBe(0)
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(e.can().undo()).toBe(false)
  })

  it('附录内的无题条：段落转无题条、改级、切换有题，均满足 IR 模型', () => {
    const e = makeEditor(appendixDoc([p('lead', '附录条文'), clause('c', '后续条')]))
    select(e, '附录条文')
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    const created = e.state.doc.child(0).child(2)
    expect(created.attrs).toMatchObject({ hasTitle: false, level: 1 })
    expect(created.firstChild!.content.size).toBe(0)
    expect(created.child(1).attrs.nodeId).toBe('lead')
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(irOf(e).labels[created.attrs.nodeId as string]?.label).toBe('A.1')
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(e.state.doc.child(0).child(2).attrs.hasTitle).toBe(true)
  })

  it('无题条转换一次事务完成，撤销还原为转换前的段落', () => {
    const e = editor([p('target', '条文正文'), p('next', '后续')])
    const original = snapshot(e)
    select(e, '条文正文')
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it('countLegacyUntitledClauses 只统计 hasTitle=false 且 clauseTitle 非空的条', () => {
    const schema = createEditorSchema()
    expect(countLegacyUntitledClauses(schema.nodeFromJSON(chapterDoc([clause('a', '有题'), untitled('u', 'p', '规范无题'), legacy('l', [text('旧稿')])])))).toBe(1)
  })
})
