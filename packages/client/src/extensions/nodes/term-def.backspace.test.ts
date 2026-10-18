// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { hasReferenceTo, hasReferenceWithin } from '../../utils/textBlockFormat'
import {
  destroyEditors, editor, irOf, nodeById, p, pressKey, snapshot, text,
} from '../../utils/__fixtures__/structureEditor'

afterEach(destroyEditors)

type TestEditor = ReturnType<typeof editor>

/** 空术语条目：中文术语与定义都为空（textContent 为空，Backspace 会整条删除）。 */
const emptyTerm = (id: string, level = 1, nested: JSONContent[] = []): JSONContent => ({
  type: 'termDef', attrs: { nodeId: id, level }, content: [
    { type: 'termName' }, { type: 'termDefinition', attrs: { nodeId: `${id}-def` } }, ...nested,
  ],
})
/** 带引用标记的段落：mark 为 termRef（术语引用）/bibRef/crossRef。 */
const referenceTo = (targetId: string, markType = 'termRef', attrs: Record<string, unknown> = {}, id = 'ref'): JSONContent => ({
  type: 'stdParagraph', attrs: { nodeId: id }, content: [text('见'), text('引用', [{ type: markType, attrs: { targetId, ...attrs } }])],
})
const danglingRefs = (e: TestEditor) =>
  irOf(e).problems.filter(item => ['dangling-xref', 'dangling-typed-ref'].includes(item.code))
/** 光标放进术语 id 的 termName 起点（termDef 开标签 + termName 开标签）。 */
const caretInTermName = (e: TestEditor, id: string) => e.commands.setTextSelection(nodeById(e, id).pos + 2)

describe('被引用的空术语条目：termName 起点 Backspace 不能整条删除（否则留下悬空引用）', () => {
  const cases: Array<{ name: string; body: () => JSONContent[]; checkExport: boolean }> = [
    { name: '术语引用（termRef）指向术语条目', body: () => [emptyTerm('t'), referenceTo('t')], checkExport: true },
    { name: '交叉引用（crossRef）指向术语条目', body: () => [emptyTerm('t'), referenceTo('t', 'crossRef', { refType: 'term' })], checkExport: false },
    { name: '引用指向术语的空定义段', body: () => [emptyTerm('t'), referenceTo('t-def', 'crossRef', { refType: 'paragraph' })], checkExport: false },
    { name: '嵌套的空子术语被引用', body: () => [emptyTerm('t', 1, [emptyTerm('n', 2)]), referenceTo('n')], checkExport: true },
  ]
  it.each(cases)('$name：按键被吞掉，文档与选区不变', ({ body, checkExport }) => {
    const e = editor(body())
    caretInTermName(e, 't')
    expect(e.state.selection.$from.parent.type.name).toBe('termName')
    const original = snapshot(e)
    const selection = e.state.selection.toJSON()
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.state.selection.toJSON()).toEqual(selection)
    if (checkExport) expect(danglingRefs(e)).toEqual([])
  })

  it('未被引用的空术语条目照常整条删除，且一次撤销还原', () => {
    const e = editor([p('before', '前文'), emptyTerm('t')])
    const original = snapshot(e)
    caretInTermName(e, 't')
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(() => nodeById(e, 't')).toThrow()
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it('只引用其它术语不阻止删除（判定只看被删除的子树）', () => {
    const e = editor([{ ...emptyTerm('keep'), content: [
      { type: 'termName', content: [text('保留术语')] }, { type: 'termDefinition', attrs: { nodeId: 'keep-def' }, content: [text('定义')] },
    ] }, emptyTerm('t'), referenceTo('keep')])
    caretInTermName(e, 't')
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(() => nodeById(e, 't')).toThrow()
    expect(nodeById(e, 'keep').node.type.name).toBe('termDef')
    expect(danglingRefs(e)).toEqual([])
  })
})

describe('引用判定识别术语引用与文献引用标记', () => {
  it('hasReferenceTo 把 termRef、bibRef 与 crossRef 一样视为引用；hasReferenceWithin 检查整棵子树', () => {
    const e = editor([emptyTerm('t'), emptyTerm('free'), referenceTo('t', 'termRef', {}, 'r1'), referenceTo('b', 'bibRef', {}, 'r2'), referenceTo('c', 'crossRef', { refType: 'clause' }, 'r3')])
    expect(hasReferenceTo(e.state.doc, 't')).toBe(true)
    expect(hasReferenceTo(e.state.doc, 'b')).toBe(true)
    expect(hasReferenceTo(e.state.doc, 'c')).toBe(true)
    expect(hasReferenceTo(e.state.doc, 'free')).toBe(false)
    expect(hasReferenceWithin(e.state.doc, nodeById(e, 't').node)).toBe(true)
    expect(hasReferenceWithin(e.state.doc, nodeById(e, 'free').node)).toBe(false)
  })
})
