// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { setClauseFormat, setParagraphFormat, structureFailureMessage } from './structureEditing'
import { caretIn, clause, destroyEditors, editor, irOf, nodeById, note, p, snapshot, text, untitled } from './__fixtures__/structureEditor'

afterEach(destroyEditors)

type TestEditor = ReturnType<typeof editor>

const example = (id: string, value: string): JSONContent => ({ type: 'example', attrs: { nodeId: id }, content: [text(value)] })
const refParagraph = (id: string, marks: NonNullable<JSONContent['marks']>): JSONContent => ({
  type: 'stdParagraph', attrs: { nodeId: id }, content: [text('见'), text('引用', marks)],
})
const ref = (id: string, attrs: Record<string, unknown>) => refParagraph(id, [{ type: 'crossRef', attrs }])
/** 引用写在一个有题条里（有正文，不制造悬置段与空条）。 */
const host = (...refs: JSONContent[]): JSONContent => clause('host', '引用所在条', refs)
const problems = (e: TestEditor) => irOf(e).problems.map(item => `${item.code}|${item.nodeId}`)
const dangling = (e: TestEditor) => irOf(e).problems.filter(item => item.code.startsWith('dangling'))
const crossRefs = (e: TestEditor) => {
  const found: Array<Record<string, unknown>> = []
  e.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'crossRef') found.push(mark.attrs) })
  return found
}

/** 被拒绝：返回 referenced-block，文档、选区与 resolve 的问题清单都和转换前完全一样（没有新增 dangling）。 */
function expectRefused(e: TestEditor, run: () => unknown) {
  const original = snapshot(e)
  const selection = e.state.selection.toJSON()
  const before = problems(e)
  expect(run()).toEqual({ ok: false, reason: 'referenced-block' })
  expect(snapshot(e)).toEqual(original)
  expect(e.state.selection.toJSON()).toEqual(selection)
  expect(problems(e)).toEqual(before)
}

describe('有题条→段落：指向该条的无类型引用（及类型不再成立的有类型引用）会失去目标，拒绝转换', () => {
  const doc = (...refs: JSONContent[]) => [host(...refs), clause('c', '被引用条', [p('cb', '条正文')])]

  it.each([
    ['targetId 无类型（空串）', { targetId: 'c', refType: '' }],
    ['旧稿 refId 无类型', { refId: 'c', refType: '' }],
    ['类型与条不符（note）', { targetId: 'c', refType: 'note' }],
  ])('%s：拒绝，文档/选区不变，resolve 问题清单不变', (_name, attrs) => {
    const e = editor(doc(ref('r1', attrs)))
    e.commands.setTextSelection(nodeById(e, 'c').pos + 2)
    expectRefused(e, () => setParagraphFormat(e))
    expect(nodeById(e, 'c').node.type.name).toBe('clause')
  })

  it('无类型引用写在脚注负载里同样拒绝', () => {
    const e = editor(doc({
      type: 'stdParagraph', attrs: { nodeId: 'r1' }, content: [text('正文'), {
        type: 'footnoteRef', attrs: { nodeId: 'fn', content: [{ type: 'text', text: '脚注', marks: [{ type: 'crossRef', attrs: { targetId: 'c' } }] }] },
      }],
    }))
    e.commands.setTextSelection(nodeById(e, 'c').pos + 2)
    expect(problems(e)).toEqual([])
    expectRefused(e, () => setParagraphFormat(e))
  })

  it('拒绝前后 resolve 都没有 problem：无类型引用指向有编号的条，本来就成立', () => {
    const e = editor(doc(ref('r1', { targetId: 'c', refType: '' })))
    e.commands.setTextSelection(nodeById(e, 'c').pos + 2)
    expect(dangling(e)).toEqual([])
    expectRefused(e, () => setParagraphFormat(e))
    expect(dangling(e)).toEqual([])
  })

  it('不误拒：clause 类型引用改为 paragraph，指向条正文段的 paragraph 引用不受影响，转换后无 problem；撤销还原', () => {
    const e = editor(doc(ref('r1', { targetId: 'c', refType: 'clause' }), ref('r2', { targetId: 'cb', refType: 'paragraph' })))
    const original = snapshot(e)
    e.commands.setTextSelection(nodeById(e, 'c').pos + 2)
    expect(problems(e)).toEqual([])
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(nodeById(e, 'c').node.type.name).toBe('stdParagraph')
    expect(crossRefs(e)).toEqual([
      expect.objectContaining({ targetId: 'c', refType: 'paragraph' }),
      expect.objectContaining({ targetId: 'cb', refType: 'paragraph' }),
    ])
    expect(irOf(e).problems.filter(item => item.code.startsWith('dangling') || item.code === 'unsupported-content')).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it('没有任何引用时照常转换', () => {
    const e = editor(doc(p('r1', '无引用')))
    e.commands.setTextSelection(nodeById(e, 'c').pos + 2)
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(nodeById(e, 'c').node.type.name).toBe('stdParagraph')
  })
})

describe.each([
  ['注', 'note', (id: string, value: string) => note(id, value)],
  ['示例', 'example', example],
] as const)('%s→段落', (_label, kind, make) => {
  const doc = (...refs: JSONContent[]) => [host(...refs), clause('c', '条', [make('n', '被引用内容'), p('tail', '后文')])]

  it.each([
    ['无类型（空串）', { targetId: 'n', refType: '' }],
    ['旧稿 refId 无类型', { refId: 'n', refType: '' }],
    ['类型与目标不符（table）', { targetId: 'n', refType: 'table' }],
  ])('指向它的引用%s：setParagraphFormat 拒绝，文档/选区/problem 清单都不变', (_name, attrs) => {
    const e = editor(doc(ref('r1', attrs)))
    caretIn(e, 'n', 1)
    expectRefused(e, () => setParagraphFormat(e))
    expect(nodeById(e, 'n').node.type.name).toBe(kind)
  })

  it('无类型引用本来成立（目标有编号），拒绝前后都没有 dangling', () => {
    const e = editor(doc(ref('r1', { targetId: 'n', refType: '' })))
    caretIn(e, 'n', 1)
    expect(dangling(e)).toEqual([])
    expectRefused(e, () => setParagraphFormat(e))
    expect(dangling(e)).toEqual([])
  })

  it('不误拒：同类型引用改为 paragraph；指向内容段落 n.p0 的 paragraph 引用改指向 n；无 problem；撤销还原', () => {
    const e = editor(doc(ref('r1', { targetId: 'n', refType: kind }), ref('r2', { targetId: 'n.p0', refType: 'paragraph' })))
    const original = snapshot(e)
    caretIn(e, 'n', 1)
    expect(problems(e)).toEqual([])
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(nodeById(e, 'n').node.type.name).toBe('stdParagraph')
    expect(crossRefs(e)).toEqual([
      expect.objectContaining({ targetId: 'n', refType: 'paragraph' }),
      expect.objectContaining({ targetId: 'n', refType: 'paragraph' }),
    ])
    expect(problems(e)).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it(`${_label}→无题条（新条只带这个段落）：无类型引用拒绝，类型引用照常改为 paragraph`, () => {
    const refused = editor([host(ref('r1', { targetId: 'n', refType: '' })), clause('c', '条', [make('n', '被引用内容')])])
    caretIn(refused, 'n', 1)
    expectRefused(refused, () => setClauseFormat(refused, 2, false))

    const allowed = editor([host(ref('r1', { targetId: 'n', refType: kind })), clause('c', '条', [make('n', '被引用内容')])])
    caretIn(allowed, 'n', 1)
    expect(setClauseFormat(allowed, 2, false)).toEqual({ ok: true })
    expect(crossRefs(allowed)).toEqual([expect.objectContaining({ targetId: 'n', refType: 'paragraph' })])
    expect(problems(allowed)).toEqual([])
  })

  it(`${_label}→有题条：${kind} 自身成为条（有编号），无类型引用仍成立，不拒绝`, () => {
    const e = editor([host(ref('r1', { targetId: 'n', refType: '' })), clause('c', '条', [make('n', '被引用内容'), p('tail', '后文')])])
    caretIn(e, 'n', 1)
    expect(setClauseFormat(e, 2, true)).toEqual({ ok: true })
    expect(nodeById(e, 'n').node.type.name).toBe('clause')
    expect(crossRefs(e)).toEqual([expect.objectContaining({ targetId: 'n', refType: '' })])
    expect(problems(e)).toEqual([])
  })

  it(`无题条的首块是${_label}：只改级别（仍无题）也会把它转成段落，被无类型引用时拒绝；改成有题（吸收进标题）则不拒绝`, () => {
    const body = () => ({ type: 'clause', attrs: { nodeId: 'u', level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }, make('n', '被引用内容'), p('second', '第二段')] }) as JSONContent
    const refused = editor([host(ref('r1', { targetId: 'n', refType: '' })), body()])
    caretIn(refused, 'n', 1)
    expectRefused(refused, () => setClauseFormat(refused, 1, false))

    const allowed = editor([host(ref('r1', { targetId: 'n', refType: '' })), body()])
    caretIn(allowed, 'n', 1)
    expect(setClauseFormat(allowed, 1, true)).toEqual({ ok: true })
    expect(crossRefs(allowed)).toEqual([expect.objectContaining({ targetId: 'u', refType: '' })])
    expect(problems(allowed)).toEqual([])
  })
})

describe('其它转换不受影响', () => {
  it('注→示例：两者都有编号，无类型引用保持成立，不拒绝', () => {
    const e = editor([host(ref('r1', { targetId: 'n', refType: '' }), ref('r2', { targetId: 'n', refType: 'note' })), clause('c', '条', [note('n', '内容'), p('tail', '后文')])])
    caretIn(e, 'n', 1)
    expect(e.commands.insertExample()).toBe(true)
    expect(nodeById(e, 'n').node.type.name).toBe('example')
    expect(crossRefs(e)).toEqual([
      expect.objectContaining({ targetId: 'n', refType: '' }),
      expect.objectContaining({ targetId: 'n', refType: 'example' }),
    ])
    expect(problems(e)).toEqual([])
  })

  it('指向无题条首段的 paragraph 引用：解除无题条编号仍允许（条没被引用）', () => {
    const e = editor([host(ref('r1', { targetId: 'up', refType: 'paragraph' })), untitled('u', 'up', '无题条文')])
    caretIn(e, 'up', 1)
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(dangling(e)).toEqual([])
  })
})

describe('提示文案', () => {
  it('段落/条的 referenced-block 文案点明条、注、示例被引用，并给出处理办法', () => {
    const message = structureFailureMessage('referenced-block', 'paragraph')
    expect(message).toContain('条')
    expect(message).toContain('注')
    expect(message).toContain('示例')
    expect(message).toContain('被引用')
    expect(message).toContain('删除或改指引用')
    expect(structureFailureMessage('referenced-block')).toContain('引用')
  })
})
