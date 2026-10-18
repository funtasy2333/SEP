// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { setClauseFormat, setParagraphFormat, structureFailureMessage, type StructureFailureReason } from './structureEditing'
import { retargetReference, retargetReferenceType } from './textBlockFormat'
import {
  caretIn, clause, clauseByTitle, destroyEditors, editor, irOf, makeEditor, nodeById, p, select, snapshot, structureProblems, term, text, untitled,
} from './__fixtures__/structureEditor'

afterEach(destroyEditors)

/** 章 5 下：5.1(L1) 含 5.1.1、5.1.2、5.1.3（二级）。5.1.1 无直属正文，5.1.2/5.1.3 为叶子条。 */
const outline = (): JSONContent[] => [clause('c51', '条五一', [
  clause('c511', '条五一一', [], 2),
  clause('c512', '条五一二', [p('b512', '五一二正文')], 2),
  clause('c513', '条五一三', [p('b513', '五一三正文')], 2),
])]

describe('大纲式改级：只改这一条的级别，正文顺序不变', () => {
  it('复现：条改级后可逆——5.1.1 升为一级再降回二级，文档与原稿深比较相等（含 nodeId）', () => {
    const e = editor(outline())
    const original = snapshot(e)
    select(e, '条五一一')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    // 5.1.1 被提出成为 5.2，并以大纲方式吞下其后的 L2 条作为子条
    const labels = irOf(e).labels
    expect(labels.c51?.label).toBe('1.1')
    expect(labels.c511?.label).toBe('1.2')
    expect(labels.c512?.label).toBe('1.2.1')
    expect(labels.c513?.label).toBe('1.2.2')
    expect(clauseByTitle(e, '条五一二').parent?.attrs.nodeId).toBe('c511')
    expect(structureProblems(e)).toEqual([])
    expect(setClauseFormat(e, 2)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
    expect(structureProblems(e)).toEqual([])
  })

  it('三级与一级互改往返后与原稿深比较相等', () => {
    const e = editor([clause('one', '一级条', [clause('two', '二级条', [clause('three', '三级条', [p('body', '三级正文')], 3)], 2)])])
    const original = snapshot(e)
    select(e, '三级条')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(clauseByTitle(e, '三级条').parent?.type.name).toBe('chapter')
    expect(clauseByTitle(e, '三级条').node.child(1).attrs.nodeId).toBe('body')
    expect(structureProblems(e)).toEqual([])
    expect(setClauseFormat(e, 3)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
  })

  it('条→段落→条往返：nodeId、标题 marks 与正文顺序不变', () => {
    const e = editor([clause('a', '前条', [p('a-body', '前条正文')]), {
      type: 'clause', attrs: { nodeId: 'b', level: 1 }, content: [
        { type: 'clauseTitle', attrs: { level: 1 }, content: [text('转', [{ type: 'bold' }]), text('段标题')] }, p('b-body', 'b 正文'),
      ],
    }])
    const original = snapshot(e)
    select(e, '段标题')
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(nodeById(e, 'b').node.type.name).toBe('stdParagraph')
    expect(nodeById(e, 'a').node.lastChild?.attrs.nodeId).toBe('b-body')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
  })

  it('段落→条→段落往返：与原稿深比较相等，选区偏移保持', () => {
    const e = editor([p('x', '甲乙丙丁'), p('y', '后续正文')])
    const original = snapshot(e)
    select(e, '甲乙丙丁', 1, 2)
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
    expect([e.state.selection.$from.parentOffset, e.state.selection.$to.parentOffset]).toEqual([1, 3])
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
    expect([e.state.selection.$from.parentOffset, e.state.selection.$to.parentOffset]).toEqual([1, 3])
  })

  it('一次改级只产生一个事务，撤销与重做完整还原', () => {
    const e = editor(outline())
    const original = snapshot(e)
    select(e, '条五一一')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    const changed = snapshot(e)
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.commands.redo()).toBe(true)
    expect(snapshot(e)).toEqual(changed)
  })

  it('保留标题 inline marks、交叉引用锚点与选区偏移', () => {
    const marked: JSONContent = {
      type: 'clause', attrs: { nodeId: 'c511', level: 2 }, content: [{ type: 'clauseTitle', attrs: { level: 2 }, content: [
        text('加粗', [{ type: 'bold' }]), text('引用', [{ type: 'crossRef', attrs: { targetId: 'c512', refType: 'clause' } }]),
      ] }],
    }
    const e = editor([clause('c51', '条五一', [marked, clause('c512', '条五一二', [], 2)])])
    select(e, '加粗', 1, 0)
    const titleBefore = nodeById(e, 'c511').node.firstChild!
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    const title = nodeById(e, 'c511').node.firstChild!
    expect(title.attrs.level).toBe(1)
    expect(title.content.eq(titleBefore.content)).toBe(true)
    expect(e.state.selection.$from.parent).toBe(title)
    expect(e.state.selection.$from.parentOffset).toBe(1)
    expect(irOf(e).problems.filter(item => item.code === 'dangling-xref')).toEqual([])
  })
})

describe('附录、多章与引用', () => {
  it('附录内同样可逆：保留 appendixLabel/appendixTitle，其余章不被触碰', () => {
    const e = makeEditor({ type: 'doc', content: [
      { type: 'chapter', attrs: { nodeId: 'other' }, content: [{ type: 'chapterTitle', content: [text('另一章')] }, clause('o1', '另一章的条', [p('o1p', '正文')])] },
      { type: 'appendix', attrs: { nodeId: 'app' }, content: [
        { type: 'appendixLabel', content: [text('（规范性）')] }, { type: 'appendixTitle', content: [text('附录标题')] },
        clause('a1', '附录条一', [clause('a11', '附录条一一', [], 2), clause('a12', '附录条一二', [p('a12p', '一二正文')], 2)]),
      ] },
    ] })
    const original = snapshot(e)
    const other = nodeById(e, 'other').node
    select(e, '附录条一一')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(irOf(e).labels.a11?.label).toBe('A.2')
    expect(irOf(e).labels.a12?.label).toBe('A.2.1')
    expect(nodeById(e, 'other').node).toBe(other)
    expect(setClauseFormat(e, 2)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
  })

  it('段落转有题条时指向该段落的引用改为条类型，转回段落时改回，不产生悬空类型引用', () => {
    const reference = (id: string, refType: string): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [text('见'), text('目标', [{ type: 'crossRef', attrs: { targetId: id, refType } }])] })
    const e = editor([p('target', '目标段落'), reference('target', 'paragraph')])
    const marks = () => {
      const found: Array<Record<string, unknown>> = []
      e.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'crossRef') found.push(mark.attrs) })
      return found
    }
    select(e, '目标段落')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    // 引用所在段落被新条吞入正文：悬置检查通过（章内只有该条）
    expect(marks()).toEqual([expect.objectContaining({ targetId: 'target', refType: 'clause' })])
    expect(irOf(e).problems.filter(item => ['dangling-xref', 'dangling-typed-ref'].includes(item.code))).toEqual([])
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(marks()).toEqual([expect.objectContaining({ targetId: 'target', refType: 'paragraph' })])
    expect(irOf(e).problems.filter(item => ['dangling-xref', 'dangling-typed-ref'].includes(item.code))).toEqual([])
  })

  describe('无类型引用（审查 P2）：段落↔有题条只换实体类型、nodeId 不变，无类型引用保持不动', () => {
    const reference = (id: string, attrs: Record<string, unknown>): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [text('见'), text('目标', [{ type: 'crossRef', attrs }])] })
    const marksOf = (e: ReturnType<typeof editor>) => {
      const found: Array<Record<string, unknown>> = []
      e.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'crossRef') found.push(mark.attrs) })
      return found
    }

    it('段落→有题条→段落：无类型引用始终指向原 nodeId 且仍无类型，有类型引用来回换类型；条有编号，转换后无悬空引用', () => {
      const e = editor([p('target', '目标段落'), reference('r1', { targetId: 'target', refType: '' }), reference('r2', { targetId: 'target', refType: 'paragraph' })])
      select(e, '目标段落')
      expect(setClauseFormat(e, 1)).toEqual({ ok: true })
      expect(marksOf(e)).toEqual([
        expect.objectContaining({ targetId: 'target', refType: '' }),
        expect.objectContaining({ targetId: 'target', refType: 'clause' }),
      ])
      expect(irOf(e).problems.filter(item => item.code.startsWith('dangling'))).toEqual([])
      // 已知限制：转回段落后，无类型引用所指的段落没有编号，无法再作无类型目标；nodeId 没变，没有可改指的地方，引用保持不动。
      expect(setParagraphFormat(e)).toEqual({ ok: true })
      expect(marksOf(e)).toEqual([
        expect.objectContaining({ targetId: 'target', refType: '' }),
        expect.objectContaining({ targetId: 'target', refType: 'paragraph' }),
      ])
    })

    it('retargetReferenceType / retargetReference 在 id 不变时不碰无类型引用；id 变化时才带着无类型引用走', () => {
      const e = editor([
        p('x', '甲'), reference('r1', { targetId: 'x', refType: '' }), reference('r2', { targetId: 'x', refType: 'paragraph' }),
        reference('r3', { refId: 'x', refType: '' }), reference('r4', { targetId: 'other', refType: '' }),
      ])
      const typeOnly = e.state.tr
      retargetReferenceType(typeOnly, 'x', 'paragraph', 'clause')
      e.view.dispatch(typeOnly)
      expect(marksOf(e).map(attrs => [attrs.targetId ?? attrs.refId, attrs.refType])).toEqual([['x', ''], ['x', 'clause'], ['x', ''], ['other', '']])
      const moved = e.state.tr
      retargetReference(moved, 'x', 'y', 'clause', 'paragraph')
      e.view.dispatch(moved)
      expect(marksOf(e).map(attrs => [attrs.targetId ?? attrs.refId, attrs.refType])).toEqual([['y', ''], ['y', 'paragraph'], ['y', ''], ['other', '']])
      expect(marksOf(e)[2]).toMatchObject({ refId: 'y', targetId: null })
    })

    it('空无题条→段落：条的 nodeId 随之消失，被无类型引用（含脚注负载里的存储标记）指向时同样拒绝，文档不变', () => {
      const withUntyped = editor([
        untitled('u', 'up', '无题条文'),
        { type: 'clause', attrs: { nodeId: 'host', level: 1 }, content: [{ type: 'clauseTitle', attrs: { level: 1 }, content: [text('引用所在条')] }, reference('r1', { targetId: 'u', refType: '' })] },
      ])
      caretIn(withUntyped, 'up', 1)
      const original = snapshot(withUntyped)
      expect(setParagraphFormat(withUntyped)).toEqual({ ok: false, reason: 'referenced-block' })
      expect(snapshot(withUntyped)).toEqual(original)

      const inFootnote = editor([
        untitled('u', 'up', '无题条文'),
        { type: 'clause', attrs: { nodeId: 'host', level: 1 }, content: [{ type: 'clauseTitle', attrs: { level: 1 }, content: [text('引用所在条')] }, {
          type: 'stdParagraph', attrs: { nodeId: 'r1' }, content: [text('正文'), {
            type: 'footnoteRef', attrs: { nodeId: 'fn', content: [{ type: 'text', text: '脚注', marks: [{ type: 'crossRef', attrs: { targetId: 'u' } }] }] },
          }],
        }] },
      ])
      caretIn(inFootnote, 'up', 1)
      const footnoteOriginal = snapshot(inFootnote)
      expect(setParagraphFormat(inFootnote)).toEqual({ ok: false, reason: 'referenced-block' })
      expect(snapshot(inFootnote)).toEqual(footnoteOriginal)
    })
  })

  it('一次改级只派发一个事务', () => {
    const e = editor(outline())
    const events: number[] = []
    e.on('transaction', ({ transaction }) => { if (transaction.docChanged) events.push(transaction.steps.length) })
    select(e, '条五一一')
    setClauseFormat(e, 1)
    expect(events).toHaveLength(1)
  })

  it('未改级的条保留原有属性（含与条级别不一致的 clauseTitle.level），只改目标条的 clause 与标题级别', () => {
    const inconsistent: JSONContent = { type: 'clause', attrs: { nodeId: 'b', level: 2 }, content: [{ type: 'clauseTitle', content: [text('旧稿标题级别缺省')] }] }
    const e = editor([clause('a', '一级条', [inconsistent, clause('c', '待改条', [], 2)])])
    select(e, '待改条')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(nodeById(e, 'b').node.firstChild!.attrs.level).toBe(1)
    expect(nodeById(e, 'b').node.attrs.level).toBe(2)
    expect(nodeById(e, 'c').node.firstChild!.attrs.level).toBe(1)
  })
})

describe('术语条目子树当作原子正文块整体搬运，level 随新父级平移', () => {
  it('章末的术语条目（所属章）不被前一个条吞入，改级前后位置与层级都不变', () => {
    const e = editor([clause('a', '一级条', [clause('a1', '二级条', [], 2)]), term('tail', 1, '章末术语')])
    const original = snapshot(e)
    select(e, '二级条')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(nodeById(e, 'tail').parent?.type.name).toBe('chapter')
    expect(nodeById(e, 'tail').node.attrs.level).toBe(1)
    expect(setClauseFormat(e, 2)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
  })

  it('段落转条会吞下其后的术语条目并把其层级平移到新条之下，转回后复原', () => {
    const e = editor([p('lead', '引导语'), term('t1', 1, '术语一')])
    const original = snapshot(e)
    select(e, '引导语')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(nodeById(e, 't1').parent?.attrs.nodeId).toBe('lead')
    expect(nodeById(e, 't1').node.attrs.level).toBe(2)
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
  })

  it('升降往返后术语子树（含嵌套术语）与原稿深比较相等', () => {
    const e = editor([clause('one', '一级条', [
      clause('two', '二级条', [term('t1', 3, '术语一', [term('t1-1', 4, '子术语')])], 2),
    ])])
    const original = snapshot(e)
    select(e, '二级条')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(nodeById(e, 't1').node.attrs.level).toBe(2)
    expect(nodeById(e, 't1-1').node.attrs.level).toBe(3)
    expect(setClauseFormat(e, 2)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
  })

  it('新父级使术语层级超过五级时拒绝，文档不变', () => {
    const e = editor([clause('l1', 'L1', [clause('l2', 'L2', [clause('l3', 'L3', [
      clause('l4', 'L4', [], 4), clause('t', 'T4', [term('t5', 5, '术语五')], 4),
    ], 3)], 2)])])
    const original = snapshot(e)
    select(e, 'T4')
    expect(setClauseFormat(e, 5)).toEqual({ ok: false, reason: 'out-of-range' })
    expect(snapshot(e)).toEqual(original)
  })
})

describe('失败原因码：不改文档、不改选区', () => {
  const cases: Array<{ name: string; reason: StructureFailureReason; body: () => JSONContent[]; pick: string; run: (e: ReturnType<typeof editor>) => ReturnType<typeof setClauseFormat> }> = [
    { name: '第一个条不是一级', reason: 'missing-parent', body: () => [p('direct', '章下段落'), clause('first', '已有一级条')], pick: '章下段落', run: e => setClauseFormat(e, 2) },
    { name: '已有第一个条被改成非一级', reason: 'missing-parent', body: () => [clause('first', '已有一级条')], pick: '已有一级条', run: e => setClauseFormat(e, 4) },
    { name: '跳级', reason: 'level-skip', body: () => [clause('a', '一级条', [p('n', '条内段落')])], pick: '条内段落', run: e => setClauseFormat(e, 3) },
    { name: '升级会让后续深层条跳级', reason: 'level-skip', body: () => [clause('a', '一级条', [clause('b', '二级条', [clause('c', '三级条', [], 3)], 2)])], pick: '二级条', run: e => setClauseFormat(e, 1) },
    { name: '前文段落悬置', reason: 'hanging-paragraph', body: () => [p('pre', '前文'), p('target', '目标段')], pick: '目标段', run: e => setClauseFormat(e, 1) },
    { name: '升级后吞下同级后续条而自身有正文', reason: 'hanging-paragraph', body: () => [clause('one', '原一级条', [clause('target', '有正文的二级条', [p('body', '本条正文')], 2), clause('peer', '后续二级条', [], 2)])], pick: '有正文的二级条', run: e => setClauseFormat(e, 1) },
    { name: '含子条的条转无题', reason: 'untitled-with-children', body: () => [clause('a', '有子条', [clause('b', '子条', [], 2)])], pick: '有子条', run: e => setClauseFormat(e, 1, false) },
    { name: '表格单元格中的段落', reason: 'invalid-location', body: () => [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell', '单元格正文')] }] }] }], pick: '单元格正文', run: e => setClauseFormat(e, 1) },
    { name: '术语定义', reason: 'invalid-location', body: () => [term('term', 1, '术语')], pick: '术语的定义', run: e => setClauseFormat(e, 1) },
    { name: '级别越界', reason: 'out-of-range', body: () => [p('target', '目标段')], pick: '目标段', run: e => setClauseFormat(e, 6) },
    { name: '级别为零', reason: 'out-of-range', body: () => [p('target', '目标段')], pick: '目标段', run: e => setClauseFormat(e, 0) },
  ]
  it.each(cases)('$name → $reason', ({ reason, body, pick, run }) => {
    const e = editor(body())
    select(e, pick)
    const original = snapshot(e)
    const selection = e.state.selection.toJSON()
    expect(run(e)).toEqual({ ok: false, reason })
    expect(snapshot(e)).toEqual(original)
    expect(e.state.selection.toJSON()).toEqual(selection)
  })

  it('解除含子条的条、或无前条可接收正文时分别给出原因码', () => {
    const e = editor([clause('a', '有子条', [clause('nested', '子条', [p('body', '子条正文')], 2)])])
    select(e, '有子条')
    expect(setParagraphFormat(e)).toEqual({ ok: false, reason: 'missing-parent' })
    const sibling = editor([clause('first', '第一条'), clause('second', '第二条')])
    select(sibling, '第一条')
    expect(setParagraphFormat(sibling)).toEqual({ ok: false, reason: 'hanging-paragraph' })
  })

  it('每个原因码都有各不相同的中文提示', () => {
    const reasons: StructureFailureReason[] = ['missing-parent', 'level-skip', 'hanging-paragraph', 'untitled-with-children', 'invalid-location', 'out-of-range', 'invalid-selection', 'referenced-block']
    const messages = reasons.map(reason => structureFailureMessage(reason))
    expect(new Set(messages).size).toBe(reasons.length)
    for (const reason of reasons) expect(structureFailureMessage(reason, 'paragraph')).toMatch(/[一-龥]/)
    expect(structureFailureMessage('missing-parent')).toContain('上级')
    expect(structureFailureMessage('level-skip')).toContain('跳级')
    expect(structureFailureMessage('hanging-paragraph')).toContain('悬置')
    expect(structureFailureMessage('untitled-with-children')).toContain('无题条')
    expect(structureFailureMessage('invalid-location')).toContain('不允许')
  })
})

describe('大纲语义：既有结构问题不阻断无关操作', () => {
  it('章下已有悬置段时，改另一条的级别仍可进行', () => {
    const e = editor([clause('a', '条甲', [p('a-body', '甲正文')]), clause('b', '条乙', [clause('c', '条丙', [], 2)]), p('tail', '章末悬置段')])
    select(e, '条丙')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(clauseByTitle(e, '条丙').parent?.type.name).toBe('chapter')
    expect(nodeById(e, 'tail').parent?.type.name).toBe('chapter')
  })

  it('相同级别重复设置不改文档也不重排既有结构', () => {
    const e = editor([clause('a', '条甲', [clause('b', '同级误嵌套', [], 1)])])
    select(e, '同级误嵌套')
    const original = snapshot(e)
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(snapshot(e)).toEqual(original)
  })

  it('只替换章内发生变化的子节点：未受影响的前序条保持同一节点对象', () => {
    const e = editor([clause('a', '条甲', [p('a1', '甲一')]), clause('b', '条乙', [p('b1', '乙一')])])
    const untouched = nodeById(e, 'a').node
    caretIn(e, 'b1')
    expect(setClauseFormat(e, 3)).toEqual({ ok: false, reason: 'level-skip' })
    expect(setClauseFormat(e, 2)).toEqual({ ok: true })
    expect(nodeById(e, 'a').node).toBe(untouched)
    expect(clauseByTitle(e, '乙一').parent?.attrs.nodeId).toBe('b')
  })
})
