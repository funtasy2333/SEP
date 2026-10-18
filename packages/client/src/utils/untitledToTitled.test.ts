// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { setClauseFormat } from './structureEditing'
import {
  appendixDoc, caretIn, clause, destroyEditors, editor, irOf, item, list, makeEditor, nodeById, note, p, snapshot, text, untitled,
} from './__fixtures__/structureEditor'

afterEach(destroyEditors)

type TestEditor = ReturnType<typeof editor>

const crossRef = (targetId: string, refType = 'clause') => [{ type: 'crossRef', attrs: { targetId, refType } }]
const reference = (targetId: string, refType: string, id = 'ref'): JSONContent => ({
  type: 'stdParagraph', attrs: { nodeId: id }, content: [text('见'), text('引用', [{ type: 'crossRef', attrs: { targetId, refType } }])],
})
const danglingRefs = (e: TestEditor) =>
  irOf(e).problems.filter(problem => ['dangling-xref', 'dangling-typed-ref'].includes(problem.code))
const crossRefAttrs = (e: TestEditor) => {
  const found: Array<Record<string, unknown>> = []
  e.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'crossRef') found.push(mark.attrs) })
  return found
}
const richParagraph = (id: string): JSONContent => ({
  type: 'stdParagraph', attrs: { nodeId: id }, content: [
    text('前半'), text('加粗', [{ type: 'bold' }]), text('参照', crossRef('v')),
    { type: 'footnoteRef', attrs: { nodeId: 'fn-1', content: [text('脚注内容')] } },
  ],
})
const parts = (node: ReturnType<typeof nodeById>['node']) => {
  const found = [] as Array<{ text: string | null | undefined, marks: string[], type: string }>
  node.forEach(child => found.push({ text: child.text, marks: child.marks.map(mark => mark.type.name), type: child.type.name }))
  return found
}
/** 把光标放进条 clauseId 的标题（offset 为标题内偏移）。 */
const caretInTitle = (e: TestEditor, clauseId: string, offset = 0) => e.commands.setTextSelection(nodeById(e, clauseId).pos + 2 + offset)

describe('无题条→有题条：首个正文段变成标题（与「段落→条」一致，是「有题→无题」的逆操作）', () => {
  it('复现：条文进入标题，原段落删除，光标按原偏移落在标题中，条保留 nodeId 与后续正文', () => {
    const e = editor([untitled('u', 'up', '条文正文', [p('second', '第二段')])])
    caretIn(e, 'up', 2)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    const target = nodeById(e, 'u').node
    expect(target.attrs).toMatchObject({ nodeId: 'u', hasTitle: true, level: 1 })
    expect(target.firstChild!.textContent).toBe('条文正文')
    expect(target.childCount).toBe(2)
    expect(target.child(1).attrs.nodeId).toBe('second')
    expect(() => nodeById(e, 'up')).toThrow()
    expect(e.state.selection.$from.parent).toBe(target.firstChild)
    expect([e.state.selection.$from.parentOffset, e.state.selection.$to.parentOffset]).toEqual([2, 2])
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(irOf(e).labels.u?.label).toBe('1.1')
  })

  it('选区范围随文字移入标题；条里没有别的块时标题下不留空段', () => {
    const e = editor([untitled('u', 'up', '条文正文')])
    e.commands.setTextSelection({ from: nodeById(e, 'up').pos + 2, to: nodeById(e, 'up').pos + 4 })
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    const target = nodeById(e, 'u').node
    expect(e.state.selection.$from.parent).toBe(target.firstChild)
    expect([e.state.selection.$from.parentOffset, e.state.selection.$to.parentOffset]).toEqual([1, 3])
    expect(target.childCount).toBe(1)
  })

  it('含 marks、交叉引用、脚注引用的行内内容整体移入标题，脚注只有一个', () => {
    const e = editor([
      { type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }, richParagraph('up')] },
      untitled('v', 'vp', '被参照的条'),
    ])
    const before = e.state.doc.textContent
    const content = nodeById(e, 'up').node.content
    caretIn(e, 'up', 3)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    const title = nodeById(e, 'u').node.firstChild!
    expect(title.content.eq(content)).toBe(true)
    expect(parts(title)).toEqual([
      { text: '前半', marks: [], type: 'text' },
      { text: '加粗', marks: ['bold'], type: 'text' },
      { text: '参照', marks: ['crossRef'], type: 'text' },
      { text: undefined, marks: [], type: 'footnoteRef' },
    ])
    expect(title.lastChild!.attrs.nodeId).toBe('fn-1')
    expect(e.state.doc.textContent).toBe(before)
    let footnotes = 0
    e.state.doc.descendants(node => { if (node.type.name === 'footnoteRef') footnotes += 1 })
    expect(footnotes).toBe(1)
    expect(e.state.selection.$from.parentOffset).toBe(3)
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    expect(danglingRefs(e)).toEqual([])
  })

  it('指向被移走段落的引用改指向条（refType 改为 clause），指向条的引用不变，无悬空引用；撤销还原', () => {
    const e = editor([untitled('u', 'up', '条文正文'), reference('up', 'paragraph'), reference('u', 'clause', 'ref2')])
    const original = snapshot(e)
    caretIn(e, 'up', 1)
    expect(danglingRefs(e)).toEqual([])
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(crossRefAttrs(e)).toEqual([
      expect.objectContaining({ targetId: 'u', refType: 'clause' }),
      expect.objectContaining({ targetId: 'u', refType: 'clause' }),
    ])
    expect(danglingRefs(e)).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(danglingRefs(e)).toEqual([])
  })

  it('旧稿格式的引用（refId 字段）同样改指向条', () => {
    const legacyRef: JSONContent = {
      type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [text('见'), text('引用', [{ type: 'crossRef', attrs: { refId: 'up', refType: 'paragraph' } }])],
    }
    const e = editor([untitled('u', 'up', '条文正文'), legacyRef])
    caretIn(e, 'up', 0)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(crossRefAttrs(e)).toEqual([expect.objectContaining({ refId: 'u', refType: 'clause' })])
  })

  it('首块为空段：删除空段后标题为空、光标进标题，其余正文保留', () => {
    const e = editor([untitled('u', 'up', '', [p('second', '第二段')])])
    caretIn(e, 'up', 0)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    const target = nodeById(e, 'u').node
    expect(target.attrs.hasTitle).toBe(true)
    expect(target.firstChild!.content.size).toBe(0)
    expect(target.childCount).toBe(2)
    expect(target.child(1).attrs.nodeId).toBe('second')
    expect(e.state.selection.$from.parent).toBe(target.firstChild)
  })

  it('改级同时切换有题：二级无题条变一级有题条，标题取新级别并带条文', () => {
    const e = editor([clause('a', '一级条', [untitled('u', 'up', '二级条文', [], 2)])])
    caretIn(e, 'up', 1)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    const moved = nodeById(e, 'u')
    expect(moved.parent?.type.name).toBe('chapter')
    expect(moved.node.attrs).toMatchObject({ level: 1, hasTitle: true })
    expect(moved.node.firstChild!.attrs.level).toBe(1)
    expect(moved.node.firstChild!.textContent).toBe('二级条文')
    expect(moved.node.childCount).toBe(1)
  })

  it('附录内的无题条同样把条文变成标题', () => {
    const e = makeEditor(appendixDoc([untitled('u', 'up', '附录条文')]))
    caretIn(e, 'up', 2)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(nodeById(e, 'u').node.firstChild!.textContent).toBe('附录条文')
    expect(nodeById(e, 'u').parent?.type.name).toBe('appendix')
    expect(irOf(e).labels.u?.label).toBe('A.1')
  })

  it('一次事务；撤销还原为无题条，重做再次变成标题', () => {
    const e = editor([untitled('u', 'up', '条文正文'), reference('up', 'paragraph')])
    const original = snapshot(e)
    caretIn(e, 'up', 2)
    const events: number[] = []
    e.on('transaction', ({ transaction }) => { if (transaction.docChanged) events.push(transaction.steps.length) })
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(events).toHaveLength(1)
    const changed = snapshot(e)
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.commands.redo()).toBe(true)
    expect(snapshot(e)).toEqual(changed)
  })

  it('往返：有题→无题→有题，条与标题（含 marks、行内节点）、正文、引用完全复原，光标偏移保持', () => {
    const titled: JSONContent = {
      type: 'clause', attrs: { nodeId: 'a', level: 1 }, content: [
        { type: 'clauseTitle', attrs: { level: 1 }, content: [
          text('前半'), text('加粗', [{ type: 'bold' }]), text('参照', crossRef('v')),
          { type: 'footnoteRef', attrs: { nodeId: 'fn-1', content: [text('脚注内容')] } },
        ] },
        p('body', '原有正文'),
      ],
    }
    const e = editor([titled, clause('v', '被参照的条'), reference('a', 'clause')])
    const original = snapshot(e)
    caretInTitle(e, 'a', 3)
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    expect(nodeById(e, 'a').node.attrs.hasTitle).toBe(false)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
    expect(e.state.selection.$from.parent).toBe(nodeById(e, 'a').node.firstChild)
    expect(e.state.selection.$from.parentOffset).toBe(3)
    expect(danglingRefs(e)).toEqual([])
  })

  it('往返：只有标题没有正文的有题条，有题→无题→有题完全复原', () => {
    const e = editor([clause('a', '仅标题的条')])
    const original = snapshot(e)
    caretInTitle(e, 'a', 2)
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
    expect(e.state.selection.$from.parentOffset).toBe(2)
  })

  it('已知非对称：空标题的有题条在结构上与无题条相同，「无题→有题」会把其首个正文段变成标题', () => {
    const e = editor([clause('a', '', [p('body', '正文')])])
    caretInTitle(e, 'a')
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    expect(nodeById(e, 'a').node.child(1).attrs.nodeId).toBe('body')
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(nodeById(e, 'a').node.firstChild!.textContent).toBe('正文')
    expect(nodeById(e, 'a').node.childCount).toBe(1)
  })

  describe('不适用时保持现行为：只切换属性，标题留空，光标进标题', () => {
    const expectAttributeOnly = (e: TestEditor, id: string, bodyBefore: ReturnType<typeof nodeById>['node']) => {
      const target = nodeById(e, id).node
      expect(target.attrs.hasTitle).toBe(true)
      expect(target.firstChild!.content.size).toBe(0)
      expect(target.childCount).toBe(2)
      expect(target.child(1)).toBe(bodyBefore)
      expect(e.state.selection.$from.parent).toBe(target.firstChild)
    }
    const untitledWith = (block: JSONContent): JSONContent => ({
      type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }, block],
    })

    it('首块不是 stdParagraph（列项）', () => {
      const e = editor([untitledWith(list('l', 'dash', [item('i', '列项内容')]))])
      const body = nodeById(e, 'u').node.child(1)
      caretInTitle(e, 'u')
      expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
      expectAttributeOnly(e, 'u', body)
    })

    it('首块不是 stdParagraph（注）', () => {
      const e = editor([untitledWith(note('n', '注内容'))])
      const body = nodeById(e, 'u').node.child(1)
      caretInTitle(e, 'u')
      expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
      expectAttributeOnly(e, 'u', body)
    })

    it('无任何正文块（只有空编号块）：只切属性，不制造空段', () => {
      const e = editor([{ type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }] }])
      caretInTitle(e, 'u')
      expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
      const target = nodeById(e, 'u').node
      expect(target.attrs.hasTitle).toBe(true)
      expect(target.childCount).toBe(1)
      expect(target.firstChild!.content.size).toBe(0)
      expect(e.state.selection.$from.parent).toBe(target.firstChild)
    })

    it('段落内容放不进 clauseTitle（schema 判定 canReplace 为假）：不搬移，引用不改写', () => {
      const e = editor([untitledWith({ type: 'stdParagraph', attrs: { nodeId: 'up' }, content: [text('加粗条文', [{ type: 'bold' }])] }), reference('up', 'paragraph')])
      // 模拟标题不接受 bold 标记的 schema：段落内容无法安全搬入标题（现行 schema 的 clauseTitle 与 stdParagraph 同为 inline*）
      const titleType = e.schema.nodes.clauseTitle!
      const allows = titleType.allowsMarks.bind(titleType)
      titleType.allowsMarks = marks => marks.every(mark => mark.type.name !== 'bold') && allows(marks)
      try {
        const body = nodeById(e, 'u').node.child(1)
        caretIn(e, 'up', 1)
        expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
        expectAttributeOnly(e, 'u', body)
        expect(crossRefAttrs(e)).toEqual([expect.objectContaining({ targetId: 'up', refType: 'paragraph' })])
      } finally {
        titleType.allowsMarks = allows
      }
    })
  })
})

describe('无题条→有题条：无类型引用也随被吸收的段落改指向条（审查 P2）', () => {
  /** 引用写在一个有题条里（不制造悬置段），目标是无题条 u 的首段 up；u 另有第二段，改为有题后条下仍有正文。 */
  const target = () => untitled('u', 'up', '条文正文', [p('second', '第二段')])
  const host = (...refs: JSONContent[]): JSONContent => clause('host', '引用所在条', refs)
  const refParagraph = (id: string, marks: NonNullable<JSONContent['marks']>): JSONContent => ({
    type: 'stdParagraph', attrs: { nodeId: id }, content: [text('见'), text('引用', marks)],
  })
  const unsupported = (e: TestEditor) => irOf(e).doc.unsupportedContent ?? []
  const dangling = (e: TestEditor) => irOf(e).problems.filter(item => item.code.startsWith('dangling'))
  const footnotes = (e: TestEditor) => {
    const found: Array<Array<{ marks: Array<{ attrs: Record<string, unknown> }> }>> = []
    e.state.doc.descendants(node => { if (node.type.name === 'footnoteRef') found.push(node.attrs.content) })
    return found
  }

  it('无类型引用（refType 为空串）改指向条且保持无类型，paragraph 引用同时改为 clause；无 problem、无 unsupportedContent；撤销还原', () => {
    const e = editor([
      host(
        refParagraph('r1', [{ type: 'crossRef', attrs: { targetId: 'up', refType: '' } }]),
        refParagraph('r2', [{ type: 'crossRef', attrs: { targetId: 'up', refType: 'paragraph' } }]),
      ),
      target(),
    ])
    const original = snapshot(e)
    caretIn(e, 'up', 1)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(crossRefAttrs(e)).toEqual([
      expect.objectContaining({ targetId: 'u', refId: null, refType: '' }),
      expect.objectContaining({ targetId: 'u', refId: null, refType: 'clause' }),
    ])
    expect(() => nodeById(e, 'up')).toThrow()
    expect(irOf(e).problems).toEqual([])
    expect(unsupported(e)).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(crossRefAttrs(e)[0]).toMatchObject({ targetId: 'up', refType: '' })
  })

  it('旧稿 refId 字段的无类型引用同样改指向条，仍留在 refId、仍无类型', () => {
    const e = editor([
      host(refParagraph('r1', [{ type: 'crossRef', attrs: { refId: 'up', refType: '' } }])),
      target(),
    ])
    caretIn(e, 'up', 0)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(crossRefAttrs(e)).toEqual([expect.objectContaining({ refId: 'u', targetId: null, refType: '' })])
    expect(dangling(e)).toEqual([])
    expect(unsupported(e)).toEqual([])
  })

  it('脚注负载与元数据 inline 里的存储标记：无类型（不带 refType/targetKind 键）改指向条且不被补上类型，有类型的同时改类型；撤销还原', () => {
    const e = editor([
      host({
        type: 'stdParagraph', attrs: { nodeId: 'r1' }, content: [text('正文'), {
          type: 'footnoteRef', attrs: { nodeId: 'fn', content: [
            { type: 'text', text: '无类型', marks: [{ type: 'crossRef', attrs: { targetId: 'up' } }] },
            { type: 'text', text: '空串', marks: [{ type: 'crossRef', attrs: { refId: 'up', refType: '' } }] },
            { type: 'text', text: '有类型', marks: [{ type: 'crossRef', attrs: { targetId: 'up', refType: 'paragraph' } }] },
          ] },
        }],
      }),
      target(),
    ])
    e.view.dispatch(e.state.tr.setDocAttribute('titleParts', [{ id: 'title-part', role: 'main', content: [
      { text: '无类型', marks: [{ type: 'crossRef', targetId: 'up' }] },
      { text: '有类型', marks: [{ type: 'crossRef', targetId: 'up', targetKind: 'paragraph' }] },
    ] }]).setMeta('addToHistory', false))
    const original = snapshot(e)
    caretIn(e, 'up', 1)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    const [content] = footnotes(e)
    expect(content!.map(run => run.marks[0]!.attrs)).toEqual([{ targetId: 'u' }, { refId: 'u', refType: '' }, { targetId: 'u', refType: 'clause' }])
    expect((e.state.doc.attrs.titleParts as Array<{ content: unknown }>)[0]!.content).toEqual([
      { text: '无类型', marks: [{ type: 'crossRef', targetId: 'u' }] },
      { text: '有类型', marks: [{ type: 'crossRef', targetId: 'u', targetKind: 'clause' }] },
    ])
    expect(dangling(e)).toEqual([])
    expect(unsupported(e)).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it('指向条本身的无类型引用、指向其它节点的引用都不动', () => {
    const e = editor([
      host(
        refParagraph('r1', [{ type: 'crossRef', attrs: { targetId: 'u', refType: '' } }]),
        refParagraph('r2', [{ type: 'crossRef', attrs: { targetId: 'second', refType: '' } }]),
        refParagraph('r3', [{ type: 'crossRef', attrs: { targetId: 'host', refType: 'clause' } }]),
      ),
      target(),
    ])
    caretIn(e, 'up', 1)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(crossRefAttrs(e).map(attrs => [attrs.targetId, attrs.refType])).toEqual([['u', ''], ['second', ''], ['host', 'clause']])
  })

  it('经「注先转段落」进入同一路径：无题条首块是注时，指向注的无类型引用也改指向条', () => {
    const e = editor([
      host(refParagraph('r1', [{ type: 'crossRef', attrs: { targetId: 'n', refType: '' } }])),
      { type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }, note('n', '注内容'), p('second', '第二段')] },
    ])
    expect(dangling(e)).toEqual([])
    caretIn(e, 'n', 1)
    expect(setClauseFormat(e, 1, true)).toEqual({ ok: true })
    expect(nodeById(e, 'u').node.firstChild!.textContent).toBe('注内容')
    expect(crossRefAttrs(e)).toEqual([expect.objectContaining({ targetId: 'u', refType: '' })])
    expect(dangling(e)).toEqual([])
  })
})
