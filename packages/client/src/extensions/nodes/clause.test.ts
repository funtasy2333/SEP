// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import {
  caretIn, clause, destroyEditors, editor, irOf, nodeById, p, pressKey, snapshot, text, untitled,
} from '../../utils/__fixtures__/structureEditor'

afterEach(destroyEditors)

/** 一个带交叉引用的段落（用来让目标被引用）。 */
const reference = (targetId: string, refType: string): JSONContent => ({
  type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [text('见'), text('引用', [{ type: 'crossRef', attrs: { targetId, refType } }])],
})
const danglingRefs = (e: ReturnType<typeof editor>) =>
  irOf(e).problems.filter(item => ['dangling-xref', 'dangling-typed-ref'].includes(item.code))
/** 只有空 clauseTitle、没有正文块的无题条：光标会停在编号块（空 clauseTitle）里。 */
const untitledTitleOnly = (id: string): JSONContent => ({ type: 'clause', attrs: { nodeId: id, level: 1, hasTitle: false }, content: [{ type: 'clauseTitle', attrs: { level: 1 } }] })
const caretInTitle = (e: ReturnType<typeof editor>, clauseId: string) => e.commands.setTextSelection(nodeById(e, clauseId).pos + 2)

describe('被引用的空无题条：正文段起点 Backspace 不能直接删除（否则留下悬空类型化引用）', () => {
  it('复现：指向条 nodeId 的引用——按键被吞掉，文档与选区都不变，导出无悬空引用', () => {
    const e = editor([untitled('u', 'up', ''), reference('u', 'clause')])
    caretIn(e, 'up', 0)
    const original = snapshot(e)
    const selection = e.state.selection.toJSON()
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.state.selection.toJSON()).toEqual(selection)
    expect(danglingRefs(e)).toEqual([])
  })

  it('复现：只引用空正文段（paragraph 型）同样不删除——删除段落会让该引用失去目标', () => {
    const e = editor([untitled('u', 'up', ''), reference('up', 'paragraph')])
    caretIn(e, 'up', 0)
    const original = snapshot(e)
    const selection = e.state.selection.toJSON()
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(snapshot(e)).toEqual(original)
    expect(e.state.selection.toJSON()).toEqual(selection)
    expect(danglingRefs(e)).toEqual([])
  })

  it('未被引用的空无题条照常删除，且一次撤销还原', () => {
    const e = editor([p('before', '前文'), untitled('empty', 'empty-p', '')])
    const original = snapshot(e)
    caretIn(e, 'empty-p', 0)
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(e.state.doc.child(0).childCount).toBe(2)
    expect(e.state.doc.child(0).lastChild?.attrs.nodeId).toBe('before')
    expect(e.commands.undo()).toBe(true)
    expect(snapshot(e)).toEqual(original)
  })

  it('被引用时仍可正常编辑：引用不影响非空无题条解除编号（走 setParagraphFormat 自身的检查）', () => {
    const e = editor([untitled('u', 'up', '有字'), reference('up', 'paragraph')])
    caretIn(e, 'up', 0)
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(nodeById(e, 'up').parent?.type.name).toBe('chapter')
    expect(danglingRefs(e)).toEqual([])
  })
})

describe('被引用的空条：clauseTitle 内 Backspace / Delete 不能删除整条', () => {
  const cases: Array<{ name: string; body: () => JSONContent[]; caret: (e: ReturnType<typeof editor>) => void }> = [
    { name: '有题空条被引用（条 nodeId）', body: () => [clause('t', '', [p('tp')]), reference('t', 'clause')], caret: e => caretInTitle(e, 't') },
    { name: '有题空条无正文块被引用', body: () => [clause('t', ''), reference('t', 'clause')], caret: e => caretInTitle(e, 't') },
    { name: '有题空条的空正文段被引用（paragraph 型）', body: () => [clause('t', '', [p('tp')]), reference('tp', 'paragraph')], caret: e => caretInTitle(e, 't') },
    { name: '有题空条内嵌套的空子条被引用', body: () => [clause('t', '', [clause('n', '', [], 2)]), reference('n', 'clause')], caret: e => caretInTitle(e, 't') },
    { name: '仅有空编号块的无题条被引用', body: () => [untitledTitleOnly('u'), reference('u', 'clause')], caret: e => caretInTitle(e, 'u') },
  ]
  for (const key of ['Backspace', 'Delete']) {
    it.each(cases)(`${key}：$name——按键被吞掉，文档与选区不变，导出无悬空引用`, ({ body, caret }) => {
      const e = editor(body())
      caret(e)
      expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
      const original = snapshot(e)
      const selection = e.state.selection.toJSON()
      expect(pressKey(e, key)).toBe(true)
      expect(snapshot(e)).toEqual(original)
      expect(e.state.selection.toJSON()).toEqual(selection)
      expect(danglingRefs(e)).toEqual([])
    })
  }

  for (const key of ['Backspace', 'Delete']) {
    it(`${key}：未被引用的空条照常整条删除，且一次撤销还原`, () => {
      const e = editor([p('before', '前文'), clause('t', '', [p('tp')])])
      const original = snapshot(e)
      caretInTitle(e, 't')
      expect(pressKey(e, key)).toBe(true)
      expect(e.state.doc.child(0).childCount).toBe(2)
      expect(e.commands.undo()).toBe(true)
      expect(snapshot(e)).toEqual(original)
    })
  }

  it('只引用其它条的 nodeId 不阻止删除（判定只看被删除子树）', () => {
    const e = editor([clause('keep', '保留条'), clause('t', ''), reference('keep', 'clause')])
    caretInTitle(e, 't')
    expect(pressKey(e, 'Backspace')).toBe(true)
    expect(() => nodeById(e, 't')).toThrow()
    expect(nodeById(e, 'keep').node.type.name).toBe('clause')
    expect(danglingRefs(e)).toEqual([])
  })
})
