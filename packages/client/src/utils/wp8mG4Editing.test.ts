// @vitest-environment happy-dom
import type { JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { hasListItemReference, hasReferenceTo, hasReferenceWithin } from './textBlockFormat'
import { setClauseFormat, setListFormat, setParagraphFormat, structureFailureMessage } from './structureEditing'
import {
  caretIn, clause, destroyEditors, editor, irOf, item, list, makeEditor, nodeById, p, pressKey, snapshot, text,
} from './__fixtures__/structureEditor'
import { createWp8mG4EmptyClauseFixture } from '../extensions/__fixtures__/wp8m-g4'

afterEach(destroyEditors)

type TestEditor = ReturnType<typeof editor>

/** 引用段：整段只含一个 crossRef，目标与类型由参数给定 */
const ref = (id: string, targetId: string, refType: string): JSONContent => ({
  type: 'stdParagraph', attrs: { nodeId: id }, content: [text('见'), text('引用', [{ type: 'crossRef', attrs: { targetId, refType } }])],
})

/** 引用在 host 条，列项在 c 条：字母列表 l（i1 i2 i3）、破折号列表 l2（j1） */
function doc(...refs: JSONContent[]): TestEditor {
  return editor([
    clause('host', '引用所在条', refs.length ? refs : [p('host-p', '无引用')]),
    clause('c', '列项条', [
      list('l', 'alpha', [item('i1', '甲'), item('i2', '乙'), item('i3', '丙')]),
      list('l2', 'dash', [item('j1', '破折')]),
    ]),
  ])
}

const brokenOf = (e: TestEditor) => irOf(e).problems
  .filter(problem => ['dangling-xref', 'dangling-typed-ref', 'unsupported-content', 'duplicate-id'].includes(problem.code))
  .map(problem => `${problem.code}|${problem.nodeId}`)

function itemTypes(e: TestEditor, ...ids: string[]): string[] {
  return ids.map(id => nodeById(e, id).node.type.name)
}

/** 被拒绝：返回 referenced-block，文档、选区、问题清单都和命令前完全一样 */
function expectRefused(e: TestEditor, run: () => unknown) {
  const original = snapshot(e)
  const selection = e.state.selection.toJSON()
  const before = brokenOf(e)
  expect(run()).toEqual({ ok: false, reason: 'referenced-block' })
  expect(snapshot(e)).toEqual(original)
  expect(e.state.selection.toJSON()).toEqual(selection)
  expect(brokenOf(e)).toEqual(before)
}

describe('[M-10.1.5-02] 引用保护：按 nodeId 通用识别被引用的列项', () => {
  it('hasReferenceTo / hasReferenceWithin 识别 refType=listItem 的目标：列项、所在列表、所在条都算被引用', () => {
    const e = doc(ref('r1', 'i2', 'listItem'))
    expect(brokenOf(e)).toEqual([])
    const state = e.state.doc
    expect(hasReferenceTo(state, 'i2')).toBe(true)
    expect(hasReferenceTo(state, 'i1')).toBe(false)
    expect(hasReferenceWithin(state, nodeById(e, 'l').node)).toBe(true)
    expect(hasReferenceWithin(state, nodeById(e, 'l2').node)).toBe(false)
    expect(hasReferenceWithin(state, nodeById(e, 'c').node)).toBe(true)
  })

  it('旧稿 refId 与无类型引用同样识别', () => {
    const e = doc(ref('r1', 'i3', ''))
    expect(hasReferenceWithin(e.state.doc, nodeById(e, 'l').node)).toBe(true)
    const legacy = editor([
      clause('host', '宿主', [{ type: 'stdParagraph', attrs: { nodeId: 'r1' }, content: [text('见'), text('引用', [{ type: 'crossRef', attrs: { refId: 'i3', refType: 'listItem' } }])] }]),
      clause('c', '列项条', [list('l', 'alpha', [item('i3', '丙')])]),
    ])
    expect(hasReferenceTo(legacy.state.doc, 'i3')).toBe(true)
    expect(hasListItemReference(legacy.state.doc, 'i3')).toBe(true)
  })

  it('hasListItemReference 只认「把列项当列项」的引用：listItem 或无类型；指向 .p0 的 paragraph 引用不算', () => {
    const e = doc(ref('r1', 'i1', 'listItem'), ref('r2', 'i2', ''), ref('r3', 'i3.p0', 'paragraph'), ref('r4', 'j1', 'paragraph'))
    const state = e.state.doc
    expect(hasListItemReference(state, 'i1')).toBe(true)
    expect(hasListItemReference(state, 'i2')).toBe(true)
    expect(hasListItemReference(state, 'i3')).toBe(false)
    expect(hasListItemReference(state, 'i3.p0')).toBe(false)
    expect(hasListItemReference(state, 'j1')).toBe(false)
    expect(hasListItemReference(state, undefined)).toBe(false)
    expect(hasListItemReference(state, '')).toBe(false)
  })

  it('删除空条（真实 Backspace）：条内被引用的空列项挡住删除，文档不变；解除引用后可删除', () => {
    const blocked = makeEditor(createWp8mG4EmptyClauseFixture() as unknown as JSONContent)
    blocked.commands.setTextSelection(nodeById(blocked, 'e-empty').pos + 2)
    expect(blocked.state.selection.$from.parent.type.name).toBe('clauseTitle')
    const original = snapshot(blocked)
    pressKey(blocked, 'Backspace')
    expect(snapshot(blocked)).toEqual(original)
    expect(nodeById(blocked, 'e-empty').node.type.name).toBe('clause')

    const free = createWp8mG4EmptyClauseFixture() as unknown as JSONContent
    const hostRef = free.content![0]!.content![1]!.content![1]!
    hostRef.content = [text('无引用')]
    const released = makeEditor(free)
    released.commands.setTextSelection(nodeById(released, 'e-empty').pos + 2)
    pressKey(released, 'Backspace')
    expect(() => nodeById(released, 'e-empty')).toThrow()
  })
})

describe('[M-10.1.5-02] 列项转成段落/注/示例：被当作列项引用的拒绝（否则 dangling-typed-ref）', () => {
  it.each([
    ['listItem 类型', 'listItem'],
    ['无类型', ''],
  ])('%s的引用：setParagraphFormat 拒绝，文档/选区/问题清单不变', (_name, refType) => {
    const e = doc(ref('r1', 'i2', refType))
    caretIn(e, 'i2', 1)
    expectRefused(e, () => setParagraphFormat(e))
    expect(itemTypes(e, 'i2')).toEqual(['stdListItem'])
  })

  it('setClauseFormat（列项设为条）同样拒绝', () => {
    const e = doc(ref('r1', 'i2', 'listItem'))
    caretIn(e, 'i2', 1)
    expectRefused(e, () => setClauseFormat(e, 2, true))
  })

  it('选区跨多个列项，其中一个被引用：整体拒绝', () => {
    const e = doc(ref('r1', 'i3', 'listItem'))
    const from = nodeById(e, 'i2').pos + 1
    const to = nodeById(e, 'i3').pos + 2
    e.commands.setTextSelection({ from, to })
    expectRefused(e, () => setParagraphFormat(e))
  })

  it('未被引用的列项照常转换，引用不受影响，无新增问题；撤销还原', () => {
    const e = doc(ref('r1', 'i2', 'listItem'))
    const original = snapshot(e)
    caretIn(e, 'i1', 1)
    expect(brokenOf(e)).toEqual([])
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(itemTypes(e, 'i1', 'i2')).toEqual(['stdParagraph', 'stdListItem'])
    expect(brokenOf(e)).toEqual([])
    expect(irOf(e).labels['i2']).toMatchObject({ label: 'a)', refText: '1.2 a)' })
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it('既有行为不变：指向列项内段落（i1.p0，paragraph 类型）的引用随转换改指，不被拒绝', () => {
    const e = doc(ref('r1', 'i1.p0', 'paragraph'))
    caretIn(e, 'i1', 1)
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(itemTypes(e, 'i1')).toEqual(['stdParagraph'])
    expect(brokenOf(e)).toEqual([])
  })

  it('指向无序列项的引用本来就是 dangling-xref：拒绝转换并保持问题清单不变（先改指或删除引用）', () => {
    const e = doc(ref('r1', 'j1', 'listItem'))
    expect(brokenOf(e)).toEqual(['dangling-xref|r1'])
    caretIn(e, 'j1', 1)
    expectRefused(e, () => setParagraphFormat(e))
  })
})

describe('[M-10.1.5-02] 列项改成无序类型：被引用的有序列项拒绝（会失去编号）', () => {
  it.each(['dash', 'dot', 'boxedNumeric'])('部分选中被引用的列项改为 %s：拒绝，文档不变', (listType) => {
    const e = doc(ref('r1', 'i2', 'listItem'))
    caretIn(e, 'i2', 1)
    expectRefused(e, () => setListFormat(e, listType))
  })

  it('整个列表（含被引用项）改为无序类型同样拒绝', () => {
    const e = doc(ref('r1', 'i2', 'listItem'))
    e.commands.setTextSelection({ from: nodeById(e, 'i1').pos + 1, to: nodeById(e, 'i3').pos + 2 })
    expectRefused(e, () => setListFormat(e, 'dash'))
  })

  it('改为有序类型（numeric）不拒绝：引用仍然成立，标记随类型变为 2)', () => {
    const e = doc(ref('r1', 'i2', 'listItem'))
    e.commands.setTextSelection({ from: nodeById(e, 'i1').pos + 1, to: nodeById(e, 'i3').pos + 2 })
    expect(setListFormat(e, 'numeric')).toEqual({ ok: true })
    expect(brokenOf(e)).toEqual([])
    expect(irOf(e).labels['i2']).toMatchObject({ label: '2)', refText: '1.2 2)' })
  })

  it('未被引用的项可以改为无序类型；被引用项留在原有序列表，标签不变', () => {
    const e = doc(ref('r1', 'i2', 'listItem'))
    caretIn(e, 'i3', 1)
    expect(setListFormat(e, 'dash')).toEqual({ ok: true })
    expect(brokenOf(e)).toEqual([])
    expect(irOf(e).labels['i2']).toMatchObject({ label: 'b)', refText: '1.2 b)' })
  })
})

describe('[M-10.1.5-02] 失败提示文案点明列项', () => {
  it('转为段落与转为列项的 referenced-block 提示都提到列项被引用，并给出处理办法', () => {
    expect(structureFailureMessage('referenced-block', 'paragraph')).toContain('列项')
    expect(structureFailureMessage('referenced-block', 'paragraph')).toContain('删除或改指引用')
    expect(structureFailureMessage('referenced-block', 'list')).toContain('列项')
    expect(structureFailureMessage('referenced-block', 'list')).toContain('引用')
  })
})
