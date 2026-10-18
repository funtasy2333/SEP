// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { liftEmptyBlock } from '@tiptap/pm/commands'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from '../extensions/editorSchema'
import { hasNodeIdIssues } from '../extensions/plugins/ensureNodeId'
import { installRemoteDocument, replaceEditorDocument } from './editorDocument'
import { setClauseFormat, setParagraphFormat, structureFailureMessage } from './structureEditing'
import { countLegacyUntitledClauses } from './untitledClause'
import {
  appendixDoc, caretIn, chapterDoc, clause, destroyEditors, editor, irOf, item, list, makeEditor, nodeById, note, p, pressKey, select, snapshot, text, untitled,
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
    // 首块是 stdParagraph 时光标不会停在编号块；只有无正文块的无题条里光标才在 clauseTitle 内
    const titleOnly: JSONContent = { type: 'clause', attrs: { nodeId: 'u', level: 2, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 2 } }] }
    const e = editor([clause('a', '一级条', [titleOnly])])
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

describe('无题条正文的 Enter：类似编号列表', () => {
  const allClauses = (e: ReturnType<typeof editor>) => {
    const found: Array<ReturnType<typeof nodeById>['node']> = []
    e.state.doc.descendants(node => { if (node.type.name === 'clause') found.push(node) })
    return found
  }
  /** 结构合法：IR 无 unsupportedContent，resolve 无任何问题（悬置段、跳级、重复/缺失 ID、悬空引用都算），nodeId 唯一，无题条无子条。 */
  const expectValid = (e: ReturnType<typeof editor>) => {
    const ir = irOf(e)
    expect(ir.doc.unsupportedContent ?? []).toEqual([])
    expect(ir.problems).toEqual([])
    expect(hasNodeIdIssues(e.state.doc)).toBe(false)
    for (const node of allClauses(e)) {
      if (node.attrs.hasTitle === false) {
        expect(node.firstChild!.content.size).toBe(0)
        node.forEach(child => expect(child.type.name).not.toBe('clause'))
      }
    }
  }
  const crossRef = (targetId: string) => [{ type: 'crossRef', attrs: { targetId, refType: 'clause' } }]

  it('段末 Enter：在当前条之后新建同级无题条（空 clauseTitle + 空 stdParagraph），光标进入新段开头，nodeId 补齐', () => {
    const e = editor([untitled('u', 'up', '条文甲'), untitled('v', 'vp', '条文乙')])
    const original = snapshot(e)
    caretIn(e, 'up', 3)
    // Tiptap 在首个事务后补的末尾空 paragraph 已在撤销栈里，作为基线；Enter 只应再增加一步
    const undoableBefore = e.can().undo()
    expect(pressKey(e, 'Enter')).toBe(true)
    const chapter = e.state.doc.child(0)
    expect(chapter.childCount).toBe(4)
    expect(chapter.child(1).attrs.nodeId).toBe('u')
    expect(chapter.child(3).attrs.nodeId).toBe('v')
    const created = chapter.child(2)
    expect(created.attrs).toMatchObject({ level: 1, hasTitle: false })
    expect(created.attrs.nodeId).toEqual(expect.any(String))
    expect(['u', 'v']).not.toContain(created.attrs.nodeId)
    expect(created.childCount).toBe(2)
    expect(created.firstChild!.type.name).toBe('clauseTitle')
    expect(created.firstChild!.attrs.level).toBe(1)
    expect(created.firstChild!.content.size).toBe(0)
    expect(created.child(1).type.name).toBe('stdParagraph')
    expect(created.child(1).content.size).toBe(0)
    expect(created.child(1).attrs.nodeId).toEqual(expect.any(String))
    expect(['up', 'vp']).not.toContain(created.child(1).attrs.nodeId)
    // 原条保持不变（文字、nodeId）
    expect(chapter.child(1).child(1).textContent).toBe('条文甲')
    expect(chapter.child(1).child(1).attrs.nodeId).toBe('up')
    // 光标进入新条正文段开头
    expect(e.state.selection.empty).toBe(true)
    expect(e.state.selection.$from.parent).toBe(created.child(1))
    expect(e.state.selection.$from.parentOffset).toBe(0)
    expectValid(e)
    const { labels } = irOf(e)
    expect([labels.u?.label, labels[created.attrs.nodeId as string]?.label, labels.v?.label]).toEqual(['1.1', '1.2', '1.3'])
    // 单一事务：一次撤销还原，重做再现
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.can().undo()).toBe(undoableBefore)
    expect(e.commands.redo()).toBe(true)
    expect(e.state.doc.child(0).childCount).toBe(4)
  })

  it('段中 Enter：光标后的文字（含 marks、交叉引用、脚注引用）原样移入新条，不丢字；引用锚点随内容移动', () => {
    const rich: JSONContent = {
      type: 'stdParagraph', attrs: { nodeId: 'up' }, content: [
        text('前半'), text('加粗', [{ type: 'bold' }]), text('参照', crossRef('v')),
        { type: 'footnoteRef', attrs: { nodeId: 'fn-1', content: [text('脚注内容')] } },
      ],
    }
    const e = editor([
      { type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }, rich] },
      untitled('v', 'vp', '被参照的条'),
    ])
    const original = snapshot(e)
    const before = e.state.doc.textContent
    caretIn(e, 'up', 3) // 「前半加」之后，落在「加粗」两字之间
    expect(pressKey(e, 'Enter')).toBe(true)
    const first = nodeById(e, 'u').node
    expect(first.childCount).toBe(2)
    expect(first.child(1).attrs.nodeId).toBe('up')
    expect(first.child(1).textContent).toBe('前半加')
    expect(first.child(1).lastChild!.marks.map(mark => mark.type.name)).toEqual(['bold'])
    const created = e.state.doc.child(0).child(2)
    expect(created.attrs).toMatchObject({ hasTitle: false, level: 1 })
    expect(created.attrs.nodeId).not.toBe('v')
    const moved = created.child(1)
    expect(moved.textContent).toBe('粗参照')
    const parts = [] as Array<{ text: string | null | undefined, marks: string[], type: string }>
    moved.forEach(child => parts.push({ text: child.text, marks: child.marks.map(mark => mark.type.name), type: child.type.name }))
    expect(parts).toEqual([
      { text: '粗', marks: ['bold'], type: 'text' },
      { text: '参照', marks: ['crossRef'], type: 'text' },
      { text: undefined, marks: [], type: 'footnoteRef' },
    ])
    expect(moved.child(1).marks[0]!.attrs).toMatchObject({ targetId: 'v', refType: 'clause' })
    expect(moved.lastChild!.attrs.nodeId).toBe('fn-1')
    // 总文字不丢，且整篇只有一个该脚注
    expect(e.state.doc.textContent).toBe(before)
    let footnotes = 0
    e.state.doc.descendants(node => { if (node.type.name === 'footnoteRef') footnotes += 1 })
    expect(footnotes).toBe(1)
    expect(e.state.selection.$from.parent).toBe(moved)
    expect(e.state.selection.$from.parentOffset).toBe(0)
    expectValid(e)
    expect(irOf(e).problems.filter(item => item.code === 'dangling-xref')).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it('段首 Enter（非空段）：整段文字移入新条，原条留下空段并保留原 nodeId', () => {
    const e = editor([untitled('u', 'up', '全文')])
    caretIn(e, 'up', 0)
    expect(pressKey(e, 'Enter')).toBe(true)
    const first = nodeById(e, 'u').node
    expect(first.child(1).content.size).toBe(0)
    expect(first.child(1).attrs.nodeId).toBe('up')
    const created = e.state.doc.child(0).child(2)
    expect(created.child(1).textContent).toBe('全文')
    expect(e.state.selection.$from.parent).toBe(created.child(1))
    expect(e.state.selection.$from.parentOffset).toBe(0)
    expectValid(e)
  })

  it('附录内的无题条：Enter 新建同级无题条，编号接续 A.n', () => {
    const e = makeEditor(appendixDoc([untitled('au', 'aup', '附录条文甲'), untitled('av', 'avp', '附录条文乙')]))
    caretIn(e, 'aup', 5)
    expect(pressKey(e, 'Enter')).toBe(true)
    const appendix = e.state.doc.child(0)
    expect(appendix.type.name).toBe('appendix')
    expect(appendix.childCount).toBe(5)
    const created = appendix.child(3)
    expect(created.attrs).toMatchObject({ hasTitle: false, level: 1 })
    expect(created.child(1).content.size).toBe(0)
    expect(e.state.selection.$from.parent).toBe(created.child(1))
    const { labels } = irOf(e)
    expect([labels.au?.label, labels[created.attrs.nodeId as string]?.label, labels.av?.label]).toEqual(['A.1', 'A.2', 'A.3'])
    expectValid(e)
  })

  it('二级无题条：新条是同一父条下的同级（level 2），不成为子条', () => {
    const e = editor([clause('a', '一级条', [untitled('u', 'up', '二级无题条文', [], 2)])])
    caretIn(e, 'up', 6)
    expect(pressKey(e, 'Enter')).toBe(true)
    const parent = nodeById(e, 'a').node
    expect(parent.childCount).toBe(3)
    const created = parent.child(2)
    expect(created.attrs).toMatchObject({ hasTitle: false, level: 2 })
    expect(created.firstChild!.attrs.level).toBe(2)
    expect(nodeById(e, 'u').node.childCount).toBe(2)
    expect(e.state.selection.$from.parent).toBe(created.child(1))
    const { labels } = irOf(e)
    expect([labels.u?.label, labels[created.attrs.nodeId as string]?.label]).toEqual(['1.1.1', '1.1.2'])
    expectValid(e)
  })

  it('多段无题条：非最后段的 Enter 是普通拆段；最后一段的 Enter 才新建条，原条的前几段不动', () => {
    const e = editor([untitled('u', 'up', '首段', [p('second', '第二段')]), untitled('v', 'vp', '后条')])
    // 首段（不是最后一个直属块）：普通拆段，条数不变
    caretIn(e, 'up', 1)
    expect(pressKey(e, 'Enter')).toBe(true)
    const split = nodeById(e, 'u').node
    expect(allClauses(e).length).toBe(2)
    expect(split.childCount).toBe(4)
    expect([split.child(1).textContent, split.child(2).textContent, split.child(3).textContent]).toEqual(['首', '段', '第二段'])
    expect(e.state.doc.child(0).childCount).toBe(3)
    // 最后一段末尾：新建同级条，光标进入新条
    caretIn(e, 'second', 3)
    expect(pressKey(e, 'Enter')).toBe(true)
    expect(allClauses(e).length).toBe(3)
    const created = e.state.doc.child(0).child(2)
    expect(nodeById(e, 'u').node.childCount).toBe(4)
    expect(nodeById(e, 'u').node.lastChild!.textContent).toBe('第二段')
    expect(created.attrs.hasTitle).toBe(false)
    expect(created.child(1).content.size).toBe(0)
    expect(e.state.selection.$from.parent).toBe(created.child(1))
    expectValid(e)
  })

  it('最后一个直属块不是段落（列项、注）或光标不在条的直属段时保持默认行为，不新建条', () => {
    const withList = editor([untitled('u', 'up', '先导', [list('l', 'dash', [item('i', '列项')])])])
    caretIn(withList, 'up', 2)
    expect(pressKey(withList, 'Enter')).toBe(true)
    expect(allClauses(withList).length).toBe(1)
    expect(nodeById(withList, 'u').node.child(2).textContent).toBe('')
    expect(nodeById(withList, 'u').node.lastChild!.type.name).toBe('stdList')

    const withNote = editor([untitled('u', 'up', '正文', [note('n', '注文字')])])
    caretIn(withNote, 'up', 2)
    expect(pressKey(withNote, 'Enter')).toBe(true)
    expect(allClauses(withNote).length).toBe(1)
    expect(nodeById(withNote, 'u').node.lastChild!.type.name).toBe('note')

    // 光标在列项里的 Enter 不由无题条接管
    const inItem = editor([untitled('u', 'up', '先导', [list('l', 'dash', [item('i', '列项')])])])
    caretIn(inItem, 'i', 2)
    pressKey(inItem, 'Enter')
    expect(allClauses(inItem).length).toBe(1)
  })

  it('有选区范围的 Enter、有题条正文的 Enter 保持默认行为', () => {
    const e = editor([untitled('u', 'up', '甲乙丙丁')])
    caretIn(e, 'up', 1)
    const from = e.state.selection.from
    e.commands.setTextSelection({ from, to: from + 2 })
    expect(pressKey(e, 'Enter')).toBe(true)
    // 默认：删除选区后在条内拆段，不新建条
    expect(allClauses(e).length).toBe(1)
    const target = nodeById(e, 'u').node
    expect([target.child(1).textContent, target.child(2).textContent]).toEqual(['甲', '丁'])

    const titled = editor([clause('c', '有题条', [p('cp', '正文')])])
    caretIn(titled, 'cp', 2)
    expect(pressKey(titled, 'Enter')).toBe(true)
    expect(allClauses(titled).length).toBe(1)
    expect(nodeById(titled, 'c').node.childCount).toBe(3)
  })

  it('Shift+Enter 仍为换行：插入 hardBreak，不新建条', () => {
    const e = editor([untitled('u', 'up', '甲乙')])
    caretIn(e, 'up', 1)
    pressKey(e, 'Enter', { shiftKey: true })
    expect(allClauses(e).length).toBe(1)
    const target = nodeById(e, 'u').node
    expect(target.childCount).toBe(2)
    const names = [] as string[]
    target.child(1).forEach(child => names.push(child.type.name))
    expect(names).toEqual(['text', 'hardBreak', 'text'])
    expect(target.child(1).attrs.nodeId).toBe('up')
  })

  it('空无题条（前面紧邻同级无题条）Enter：删除空条，在前一条末尾追加空段并把光标放进去；撤销一步还原', () => {
    const e = editor([untitled('u', 'up', '条文甲'), untitled('w', 'wp', '')])
    const original = snapshot(e)
    caretIn(e, 'wp', 0)
    const undoableBefore = e.can().undo()
    expect(pressKey(e, 'Enter')).toBe(true)
    const chapter = e.state.doc.child(0)
    expect(chapter.childCount).toBe(2)
    const previous = chapter.child(1)
    expect(previous.attrs.nodeId).toBe('u')
    expect(previous.childCount).toBe(3)
    expect(previous.child(1).textContent).toBe('条文甲')
    expect(previous.child(2).type.name).toBe('stdParagraph')
    expect(previous.child(2).content.size).toBe(0)
    expect(previous.child(2).attrs.nodeId).toEqual(expect.any(String))
    expect(['up', 'wp']).not.toContain(previous.child(2).attrs.nodeId)
    expect(e.state.selection.empty).toBe(true)
    expect(e.state.selection.$from.parent).toBe(previous.child(2))
    expect(e.state.selection.$from.parentOffset).toBe(0)
    expectValid(e)
    expect(irOf(e).labels.u?.label).toBe('1.1')
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.can().undo()).toBe(undoableBefore)
  })

  it('连续编号写多段条文：段末 Enter 新建条 → 空条 Enter 退回上一条另起一段 → 输入 → 再 Enter 新建条', () => {
    const e = editor([untitled('u', 'up', '第一段')])
    caretIn(e, 'up', 3)
    pressKey(e, 'Enter')
    expect(allClauses(e).length).toBe(2)
    pressKey(e, 'Enter')
    expect(allClauses(e).length).toBe(1)
    e.view.dispatch(e.state.tr.insertText('第二段'))
    expect(pressKey(e, 'Enter')).toBe(true)
    const chapter = e.state.doc.child(0)
    expect(chapter.childCount).toBe(3)
    expect(chapter.child(1).childCount).toBe(3)
    expect([chapter.child(1).child(1).textContent, chapter.child(1).child(2).textContent]).toEqual(['第一段', '第二段'])
    expect(chapter.child(2).child(1).content.size).toBe(0)
    expect(e.state.selection.$from.parent).toBe(chapter.child(2).child(1))
    expectValid(e)
    expect([irOf(e).labels.u?.label, irOf(e).labels[chapter.child(2).attrs.nodeId as string]?.label]).toEqual(['1.1', '1.2'])
  })

  it('空无题条前面不是同级无题条（有题条、章标题、不同级）：Enter 吞掉按键，文档不变，不产生悬置段/空壳条', () => {
    // 对照：默认的 liftEmptyBlock 会把空段抬出条外，留下无正文的空壳无题条与悬置段
    const control = editor([clause('c', '有题条', [p('cp', '正文')]), untitled('w', 'wp', '')])
    caretIn(control, 'wp', 0)
    expect(liftEmptyBlock(control.state, transaction => control.view.dispatch(transaction))).toBe(true)
    expect(irOf(control).problems.map(item => item.code)).toContain('hanging-paragraph')

    const afterTitled = editor([clause('c', '有题条', [p('cp', '正文')]), untitled('w', 'wp', '')])
    const originalTitled = snapshot(afterTitled)
    caretIn(afterTitled, 'wp', 0)
    expect(pressKey(afterTitled, 'Enter')).toBe(true)
    expect(snapshot(afterTitled)).toEqual(originalTitled)
    expectValid(afterTitled)

    const first = editor([untitled('w', 'wp', ''), untitled('v', 'vp', '后条')])
    const originalFirst = snapshot(first)
    caretIn(first, 'wp', 0)
    expect(pressKey(first, 'Enter')).toBe(true)
    expect(snapshot(first)).toEqual(originalFirst)
    expectValid(first)

    const otherLevel = editor([clause('a', '一级条', [untitled('u', 'up', '二级无题条', [], 2)]), untitled('w', 'wp', '')])
    const originalLevel = snapshot(otherLevel)
    caretIn(otherLevel, 'wp', 0)
    expect(pressKey(otherLevel, 'Enter')).toBe(true)
    expect(snapshot(otherLevel)).toEqual(originalLevel)
  })

  it('被交叉引用的空无题条 Enter：不删除（否则引用失去目标），文档不变', () => {
    const referencing = (): JSONContent => ({
      type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [
        { type: 'clauseTitle', attrs: { level: 1 } },
        { type: 'stdParagraph', attrs: { nodeId: 'up' }, content: [text('见'), text('空条', crossRef('w'))] },
      ],
    })
    const e = editor([referencing(), untitled('w', 'wp', '')])
    const original = snapshot(e)
    caretIn(e, 'wp', 0)
    expect(pressKey(e, 'Enter')).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(irOf(e).problems.filter(item => item.code === 'dangling-xref')).toEqual([])
  })

  it('空段在非整条为空的无题条里（多段条文的空尾段）Enter 保持默认行为', () => {
    const e = editor([untitled('u', 'up', '首段', [p('tail', '')])])
    caretIn(e, 'tail', 0)
    expect(pressKey(e, 'Enter')).toBe(true)
    // 默认 liftEmptyBlock 的行为不由无题条接管：不新建条也不合并
    expect(allClauses(e).length).toBe(1)
    expect(nodeById(e, 'u').node.child(1).textContent).toBe('首段')
  })
})

describe('appendTransaction 兜底：任何事务后无题条的 clauseTitle 内容移入正文段', () => {
  // 光标不会停在编号块里（见上一组），这里用显式位置的事务把文字写进标题，模拟粘贴、外部写入等其他途径。
  it('文字被写进无题条标题：落入首个空段，撤销一步还原', () => {
    const e = editor([untitled('u', 'up', '')])
    const original = snapshot(e)
    e.view.dispatch(e.state.tr.insertText('误入', nodeById(e, 'u').pos + 2))
    const target = nodeById(e, 'u').node
    expect(target.firstChild!.content.size).toBe(0)
    expect(target.child(1).textContent).toBe('误入')
    expect(target.child(1).attrs.nodeId).toBe('up')
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.commands.redo()).toBe(true)
    expect(nodeById(e, 'u').node.child(1).textContent).toBe('误入')
  })

  it('首段非空时新建段落承载标题文字，不与原有段落拼接', () => {
    const e = editor([untitled('u', 'up', '已有条文')])
    e.view.dispatch(e.state.tr.insertText('新', nodeById(e, 'u').pos + 2))
    const target = nodeById(e, 'u').node
    expect(target.firstChild!.content.size).toBe(0)
    expect(target.childCount).toBe(3)
    expect(target.child(1).textContent).toBe('新')
    expect(target.child(1).attrs.nodeId).toEqual(expect.any(String))
    expect(target.child(2).textContent).toBe('已有条文')
    expect(target.child(2).attrs.nodeId).toBe('up')
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

describe('光标不落在无题条的编号块（空 clauseTitle）内', () => {
  const titlePos = (e: ReturnType<typeof editor>, id: string) => nodeById(e, id).pos + 2

  it('复现：点击编号（选区落入空 clauseTitle）后输入，文字进入首段起点，不在首段前新建段落', () => {
    const e = editor([untitled('u', 'up', '已有条文')])
    e.commands.setTextSelection(titlePos(e, 'u'))
    // 选区被重定向到首段起点
    expect(e.state.selection.$from.parent.type.name).toBe('stdParagraph')
    expect(e.state.selection.$from.parent.attrs.nodeId).toBe('up')
    expect(e.state.selection.$from.parentOffset).toBe(0)
    e.view.dispatch(e.state.tr.insertText('X'))
    const target = nodeById(e, 'u').node
    expect(target.childCount).toBe(2)
    expect(target.firstChild!.content.size).toBe(0)
    expect(target.child(1).textContent).toBe('X已有条文')
    expect(target.child(1).attrs.nodeId).toBe('up')
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
  })

  it('选区范围的一端落在编号块时，该端移到首段起点，另一端不变', () => {
    const e = editor([p('before', '前文'), untitled('u', 'up', '已有条文')])
    caretIn(e, 'before', 1)
    const from = e.state.selection.from
    e.commands.setTextSelection({ from, to: titlePos(e, 'u') })
    expect(e.state.selection.from).toBe(from)
    expect(e.state.selection.$to.parent.attrs.nodeId).toBe('up')
    expect(e.state.selection.$to.parentOffset).toBe(0)
  })

  it('首块不是 stdParagraph（列项、无正文块）时选区仍可落在编号块，输入由兜底移入新段落', () => {
    const e = makeEditor(chapterDoc([{ type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [
      { type: 'clauseTitle', attrs: { level: 1 } }, list('l', 'dash', [item('i', '列项')]),
    ] }]))
    e.commands.setTextSelection(titlePos(e, 'u'))
    expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
    e.view.dispatch(e.state.tr.insertText('先导'))
    expect(nodeById(e, 'u').node.child(1).textContent).toBe('先导')
    expect(e.state.selection.$from.parent).toBe(nodeById(e, 'u').node.child(1))
  })

  it('有题条的空标题不重定向', () => {
    const e = editor([clause('a', '', [p('body', '正文')])])
    e.commands.setTextSelection(titlePos(e, 'a'))
    expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
  })

  it.each(['ArrowLeft', 'ArrowUp'])('首段起点按 %s：跳到前一个块末尾，不卡在编号块', key => {
    const e = editor([p('before', '前文段落'), untitled('u', 'up', '已有条文')])
    caretIn(e, 'up', 0)
    expect(pressKey(e, key)).toBe(true)
    expect(e.state.selection.$from.parent.attrs.nodeId).toBe('before')
    expect(e.state.selection.$from.parentOffset).toBe(4)
    expect(e.state.selection.$from.parent.type.name).toBe('stdParagraph')
    // 再往左就是普通的逐字移动（不由本插件接管）
    expect(pressKey(e, key)).toBe(false)
  })

  it('首段起点按 ArrowLeft：前面没有正文块时跳到章标题末尾', () => {
    const e = editor([untitled('u', 'up', '已有条文')])
    caretIn(e, 'up', 0)
    expect(pressKey(e, 'ArrowLeft')).toBe(true)
    expect(e.state.selection.$from.parent.type.name).toBe('chapterTitle')
    expect(e.state.selection.$from.parentOffset).toBe(4)
  })

  it('首段内部（非起点）、有题条与带修饰键的方向键不被接管', () => {
    const e = editor([p('before', '前文段落'), untitled('u', 'up', '已有条文'), clause('c', '有题条', [p('cp', '正文')])])
    caretIn(e, 'up', 2)
    expect(pressKey(e, 'ArrowLeft')).toBe(false)
    expect(e.state.selection.$from.parentOffset).toBe(2)
    caretIn(e, 'cp', 0)
    expect(pressKey(e, 'ArrowLeft')).toBe(false)
    caretIn(e, 'up', 0)
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true })
    expect(e.view.someProp('handleKeyDown', handler => handler(e.view, event)) ?? false).toBe(false)
  })

  it('首段起点按退格的既有行为保持：解除编号；整条为空时删除该条', () => {
    const e = editor([p('before', '前文'), untitled('u', 'up', '已有条文')])
    caretIn(e, 'up', 0)
    pressKey(e, 'Backspace')
    expect(nodeById(e, 'up').parent?.type.name).toBe('chapter')
    expect(e.state.doc.child(0).childCount).toBe(3)
  })
})

describe('被引用的无题条不能解除编号', () => {
  const reference = (targetId: string, refType: string): JSONContent => ({
    type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [text('见'), text('引用', [{ type: 'crossRef', attrs: { targetId, refType } }])],
  })

  it('复现：存在指向该无题条 nodeId 的引用时，setParagraphFormat 拒绝并返回 referenced-block，文档与选区不变', () => {
    const e = editor([untitled('u', 'up', '被引用的无题条'), reference('u', 'clause')])
    caretIn(e, 'up', 2)
    const original = snapshot(e)
    const selection = e.state.selection.toJSON()
    expect(setParagraphFormat(e)).toEqual({ ok: false, reason: 'referenced-block' })
    expect(snapshot(e)).toEqual(original)
    expect(e.state.selection.toJSON()).toEqual(selection)
  })

  it('退格不会绕过：被引用的无题条首段起点按退格，文档保持不变', () => {
    const e = editor([untitled('u', 'up', '被引用的无题条'), reference('u', 'clause')])
    caretIn(e, 'up', 0)
    const original = snapshot(e)
    pressKey(e, 'Backspace')
    expect(snapshot(e)).toEqual(original)
  })

  it('无人引用的无题条照常解除；只引用首段（paragraph 型）不阻止', () => {
    const e = editor([untitled('u', 'up', '无引用的无题条')])
    caretIn(e, 'up', 1)
    expect(setParagraphFormat(e)).toEqual({ ok: true })

    const paragraphRef = editor([untitled('u', 'up', '仅段落被引用'), reference('up', 'paragraph')])
    caretIn(paragraphRef, 'up', 1)
    expect(setParagraphFormat(paragraphRef)).toEqual({ ok: true })
    expect(irOf(paragraphRef).problems.filter(item => ['dangling-xref', 'dangling-typed-ref'].includes(item.code))).toEqual([])
  })

  it('提示文案说明「该条被引用，请先删除或改指引用」', () => {
    const message = structureFailureMessage('referenced-block', 'paragraph')
    expect(message).toContain('被引用')
    expect(message).toContain('删除或改指引用')
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
