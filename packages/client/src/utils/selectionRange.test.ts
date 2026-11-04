// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { visibleBlockRange } from './selectionRange'
import { destroyEditors, editor, item, list, makeEditor, nodeById, p, text } from './__fixtures__/structureEditor'

afterEach(destroyEditors)

const start = (e: ReturnType<typeof editor>, id: string) => nodeById(e, id).pos + 1
const end = (e: ReturnType<typeof editor>, id: string) => nodeById(e, id).pos + nodeById(e, id).node.nodeSize - 1
const table = (id: string): JSONContent => ({ type: 'stdTable', attrs: { nodeId: id }, content: [
  { type: 'tableCaption', content: [text('表')] },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text('格')] }] }] }] },
] })

describe('visibleBlockRange：去掉跨块选区两端看不见的块边界', () => {
  it('终点在下一段开头：收回到上一段末尾；起点在上一段末尾：推到下一段开头', () => {
    const e = editor([p('a', '甲'), p('b', '乙'), p('c', '丙')])
    expect(visibleBlockRange(e.state.doc, start(e, 'a'), start(e, 'b'))).toEqual({ from: start(e, 'a'), to: end(e, 'a') })
    expect(visibleBlockRange(e.state.doc, end(e, 'a'), end(e, 'b'))).toEqual({ from: start(e, 'b'), to: end(e, 'b') })
    expect(visibleBlockRange(e.state.doc, end(e, 'a'), start(e, 'c'))).toEqual({ from: start(e, 'b'), to: end(e, 'b') })
  })

  it('跨越嵌套层级（段落后接列表）同样只去掉边界', () => {
    const e = editor([p('a', '甲'), list('l', 'dash', [item('i1', '一'), item('i2', '二')])])
    expect(visibleBlockRange(e.state.doc, start(e, 'a'), start(e, 'i1'))).toEqual({ from: start(e, 'a'), to: end(e, 'a') })
    expect(visibleBlockRange(e.state.doc, start(e, 'i1'), start(e, 'i2'))).toEqual({ from: start(e, 'i1'), to: end(e, 'i1') })
  })

  it('不需要裁剪时原样返回：空选区、同一文本块、端点在文字中间', () => {
    const e = editor([p('a', '甲乙'), p('b', '丙丁')])
    const doc = e.state.doc
    expect(visibleBlockRange(doc, start(e, 'a'), start(e, 'a'))).toEqual({ from: start(e, 'a'), to: start(e, 'a') })
    expect(visibleBlockRange(doc, start(e, 'a'), end(e, 'a'))).toEqual({ from: start(e, 'a'), to: end(e, 'a') })
    expect(visibleBlockRange(doc, start(e, 'a') + 1, start(e, 'b') + 1)).toEqual({ from: start(e, 'a') + 1, to: start(e, 'b') + 1 })
  })

  it('与相邻文本块之间隔着表格等整块内容时不裁剪', () => {
    const e = editor([p('a', '甲'), table('t'), p('b', '乙')])
    expect(visibleBlockRange(e.state.doc, start(e, 'a'), start(e, 'b'))).toEqual({ from: start(e, 'a'), to: start(e, 'b') })
    expect(visibleBlockRange(e.state.doc, end(e, 'a'), end(e, 'b'))).toEqual({ from: end(e, 'a'), to: end(e, 'b') })
  })

  it('不进出章等 isolating 节点：选中上一章末段到下一章标题开头时保持原样', () => {
    const e = makeEditor({ type: 'doc', content: [
      { type: 'chapter', attrs: { nodeId: 'ch1' }, content: [{ type: 'chapterTitle', content: [text('一')] }, p('a', '甲')] },
      { type: 'chapter', attrs: { nodeId: 'ch2' }, content: [{ type: 'chapterTitle', attrs: { nodeId: 't2' }, content: [text('二')] }, p('b', '乙')] },
    ] })
    const title = nodeById(e, 'ch2').pos + 2
    expect(visibleBlockRange(e.state.doc, start(e, 'a'), title)).toEqual({ from: start(e, 'a'), to: title })
  })
})
