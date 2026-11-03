// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { computeOrderedListMarkers, pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { computeEditorListNumbering, listNumberingMessage, setListNumbering, type ListNumberingMode } from './listNumbering'
import { setListFormat, setParagraphFormat } from './structureEditing'
import {
  caretIn, chapterDoc, clause, destroyEditors, editor, irOf, item, list, makeEditor, nodeById, p, snapshot,
} from './__fixtures__/structureEditor'

afterEach(destroyEditors)

/** issue #70 的典型场景：一级字母列项「内部因素」「外部因素」，各自下面是二级数字列项。 */
const riskBody = (): JSONContent[] => [clause('c1', '识别要求', [
  p('lead', '开展风险识别时，分析以下内部因素和外部因素。'),
  list('L-in', 'alpha', [item('a-in', '内部因素，包括但不限于：')]),
  list('N-in', 'numeric', [item('n-in-1', '组织架构；'), item('n-in-2', '管理制度；'), item('n-in-3', '人员能力。')]),
  list('L-out', 'alpha', [item('a-out', '外部因素，包括但不限于：')]),
  list('N-out', 'numeric', [item('n-out-1', '市场环境；'), item('n-out-2', '监管要求；'), item('n-out-3', '外部相关方情况。')]),
])]
const ITEMS = ['a-in', 'n-in-1', 'n-in-2', 'n-in-3', 'a-out', 'n-out-1', 'n-out-2', 'n-out-3']

const apply = (e: Editor, mode: ListNumberingMode) => {
  const tr = e.state.tr
  const result = setListNumbering(e.state, tr, mode)
  if (result.ok && result.changed) e.view.dispatch(tr)
  return result
}
/** Resolver 给出的列项标记（内部引用与各出口共用）。 */
const markers = (e: Editor, ids = ITEMS) => {
  const all = computeOrderedListMarkers(pmToIr(e.getJSON() as PMJsonNode).doc)
  return ids.map(id => all[id] ?? '')
}
/** 编辑器 DOM 上列表的编号装饰。 */
const listDom = (e: Editor, nodeId: string) => e.view.dom.querySelector(`[data-type="std-list"][data-node-id="${nodeId}"]`) as HTMLElement
const attrOf = (e: Editor, nodeId: string) => nodeById(e, nodeId).node.attrs.continueNumbering

describe('继续前一列项编号／重新编号：编辑器命令', () => {
  it('典型场景：外部因素设为继续编号后为 b），两组二级数字列项都从 1）开始，编辑器显示与 Resolver 一致', () => {
    const e = editor(riskBody())
    expect(markers(e)).toEqual(['a）', '1）', '2）', '3）', 'a）', '1）', '2）', '3）'])
    caretIn(e, 'a-out', 1)
    const result = apply(e, 'continue')
    expect(result).toEqual({ ok: true, changed: true, start: 2, listType: 'alpha' })
    expect(listNumberingMessage(result, 'continue')).toBe('已继续前一列项编号，本组从 b） 起')
    expect(attrOf(e, 'L-out')).toBe(true)
    expect(markers(e)).toEqual(['a）', '1）', '2）', '3）', 'b）', '1）', '2）', '3）'])
    // 编辑器的 CSS 计数器从 1 起，首项显示 b）；二级数字列项没有装饰，各自从 1）开始
    expect(listDom(e, 'L-out').style.counterReset).toBe('alpha-counter 1')
    expect(listDom(e, 'L-out').getAttribute('data-numbering')).toBe('continue')
    expect(listDom(e, 'N-out').getAttribute('style')).toBeNull()
    expect(listDom(e, 'L-out').getAttribute('data-continue-numbering')).toBe('true')
  })

  it('重新编号写回缺省值：getJSON 不再出现该属性，与从未设置过相同', () => {
    const e = editor(riskBody())
    const original = snapshot(e)
    caretIn(e, 'a-out')
    apply(e, 'continue')
    const result = apply(e, 'restart')
    expect(result).toMatchObject({ ok: true, changed: true, start: 1 })
    expect(listNumberingMessage(result, 'restart')).toBe('已重新编号，本组从 a） 起')
    expect(snapshot(e)).toEqual(original)
    expect(JSON.stringify(e.getJSON())).not.toContain('continueNumbering')
    expect(listDom(e, 'L-out').getAttribute('data-numbering')).toBeNull()
  })

  it('前面没有同类型列项时拒绝继续编号，文档不变；无序列项与不在列项内也拒绝', () => {
    const e = editor(riskBody())
    const before = snapshot(e)
    caretIn(e, 'a-in')
    const noPrevious = apply(e, 'continue')
    expect(noPrevious).toEqual({ ok: false, reason: 'no-previous', listType: 'alpha' })
    expect(listNumberingMessage(noPrevious, 'continue')).toContain('无法继续编号')
    // 二级数字列项前面虽有字母列项，但没有同类型（数字）列项
    caretIn(e, 'n-in-1')
    expect(apply(e, 'continue')).toMatchObject({ ok: false, reason: 'no-previous', listType: 'numeric' })
    caretIn(e, 'lead')
    expect(apply(e, 'continue')).toEqual({ ok: false, reason: 'not-in-list' })
    expect(snapshot(e)).toEqual(before)

    const dash = editor([list('D1', 'dash', [item('d1', '甲')]), list('D2', 'dash', [item('d2', '乙')])])
    caretIn(dash, 'd2')
    expect(apply(dash, 'continue')).toEqual({ ok: false, reason: 'unordered', listType: 'dash' })
  })

  it('二级数字列项也可以继续前一组数字列项', () => {
    const e = editor(riskBody())
    caretIn(e, 'n-out-2')
    expect(apply(e, 'continue')).toMatchObject({ ok: true, start: 4 })
    expect(markers(e, ['n-out-1', 'n-out-3'])).toEqual(['4）', '6）'])
    expect(listDom(e, 'N-out').style.counterReset).toBe('numeric-counter 3')
  })

  it('Tiptap 命令 setStdListNumbering 与撤销、重做', () => {
    const e = editor(riskBody())
    caretIn(e, 'a-out')
    expect(e.commands.setStdListNumbering('continue')).toBe(true)
    expect(markers(e, ['a-out'])).toEqual(['b）'])
    expect(e.commands.undo()).toBe(true)
    expect(attrOf(e, 'L-out')).toBeUndefined()
    expect(markers(e, ['a-out'])).toEqual(['a）'])
    expect(listDom(e, 'L-out').getAttribute('data-numbering')).toBeNull()
    expect(e.commands.redo()).toBe(true)
    expect(markers(e, ['a-out'])).toEqual(['b）'])
    expect(listDom(e, 'L-out').style.counterReset).toBe('alpha-counter 1')
  })
})

describe('编辑后编号仍按设置计算', () => {
  const continued = () => {
    const e = editor(riskBody())
    caretIn(e, 'a-out')
    apply(e, 'continue')
    return e
  }

  it('中间插入说明段落：继续关系保持', () => {
    const e = continued()
    const { pos, node } = nodeById(e, 'N-in')
    e.view.dispatch(e.state.tr.insert(pos + node.nodeSize, e.schema.nodes.stdParagraph!.create({ nodeId: 'mid' }, e.schema.text('说明段落。'))))
    expect(markers(e, ['a-in', 'a-out', 'n-out-1'])).toEqual(['a）', 'b）', '1）'])
    expect(listDom(e, 'L-out').style.counterReset).toBe('alpha-counter 1')
  })

  it('在前一组插入、删除列项：接续的序号随之变化', () => {
    const e = continued()
    caretIn(e, 'a-in', '内部因素，包括但不限于：'.length)
    e.commands.splitBlock()
    e.commands.insertContent('补充因素')
    expect(markers(e, ['a-out'])).toEqual(['c）'])
    expect(listDom(e, 'L-out').style.counterReset).toBe('alpha-counter 2')
    expect(e.commands.undo()).toBe(true)
    while (nodeById(e, 'L-in').node.childCount > 1) e.commands.undo()
    expect(markers(e, ['a-out'])).toEqual(['b）'])
  })

  it('移动：接续的列表移到最前面后没有可接续的目标，按重新编号显示并标出提示', () => {
    const e = continued()
    const { pos, node } = nodeById(e, 'L-out')
    const lead = nodeById(e, 'lead')
    const tr = e.state.tr.delete(pos, pos + node.nodeSize)
    tr.insert(lead.pos, node)
    e.view.dispatch(tr)
    expect(markers(e, ['a-out', 'a-in'])).toEqual(['a）', 'a）'])
    expect(listDom(e, 'L-out').classList.contains('std-list-continue-orphan')).toBe(true)
    expect(irOf(e).problems.filter(problem => problem.code === 'list-continue-orphan').map(problem => problem.nodeId)).toEqual(['L-out'])
  })

  it('把列项中间一项改为段落：后半截继续前半截的编号，不从 a）重来', () => {
    const e = editor([list('L', 'alpha', [item('x1', '甲'), item('x2', '乙'), item('x3', '丙'), item('x4', '丁')])])
    caretIn(e, 'x2', 1)
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(markers(e, ['x1', 'x3', 'x4'])).toEqual(['a）', 'b）', 'c）'])
  })

  it('把列项中间一项改为二级数字列项：后半截继续字母编号，新的数字列项从 1）开始', () => {
    const e = editor([list('L', 'alpha', [item('x1', '甲'), item('x2', '乙'), item('x3', '丙')])])
    caretIn(e, 'x2', 1)
    expect(setListFormat(e, 'numeric')).toEqual({ ok: true })
    expect(markers(e, ['x1', 'x2', 'x3'])).toEqual(['a）', '1）', 'b）'])
  })

  it('整组改成另一种有序类型时不再接续原类型的序列', () => {
    const e = continued()
    caretIn(e, 'a-out')
    expect(setListFormat(e, 'numeric')).toEqual({ ok: true })
    expect(nodeById(e, 'L-out').node.attrs.continueNumbering).toBeUndefined()
    expect(markers(e, ['a-out'])).toEqual(['1）'])
  })
})

describe('保存与重新打开', () => {
  it('getJSON → 新编辑器、getHTML → 新编辑器后继续关系都不丢失', () => {
    const e = editor(riskBody())
    caretIn(e, 'a-out')
    apply(e, 'continue')
    const fromJson = makeEditor(JSON.parse(JSON.stringify(e.getJSON())) as JSONContent)
    expect(markers(fromJson, ['a-out'])).toEqual(['b）'])
    expect(listDom(fromJson, 'L-out').style.counterReset).toBe('alpha-counter 1')
    const element = document.createElement('div')
    document.body.append(element)
    const fromHtml = new Editor({ element, extensions: createEditorExtensions(), content: e.getHTML() })
    try {
      expect(markers(fromHtml, ['a-out'])).toEqual(['b）'])
    } finally {
      fromHtml.destroy()
      element.remove()
    }
  })

  it('编辑器的编号起点与 Resolver 逐个列表相同（含不跨条接续）', () => {
    const e = makeEditor(chapterDoc([
      clause('c1', '甲', [list('A', 'alpha', [item('a1', '一'), item('a2', '二')])]),
      clause('c2', '乙', [
        { ...list('B', 'alpha', [item('b1', '三')]), attrs: { nodeId: 'B', listType: 'alpha', level: 1, continueNumbering: true } },
        p('mid', '说明。'),
        { ...list('C', 'alpha', [item('c1-1', '四')]), attrs: { nodeId: 'C', listType: 'alpha', level: 1, continueNumbering: true } },
      ]),
    ]))
    const editorStarts = [...computeEditorListNumbering(e.state.doc).entries()].map(([pos, info]) => [e.state.doc.nodeAt(pos)!.attrs.nodeId, info.start, info.orphan])
    expect(editorStarts).toEqual([['A', 1, false], ['B', 1, true], ['C', 2, false]])
    expect(markers(e, ['a1', 'a2', 'b1', 'c1-1'])).toEqual(['a）', 'b）', 'a）', 'b）'])
    expect(listDom(e, 'B').classList.contains('std-list-continue-orphan')).toBe(true)
  })
})

describe('块级列项（stdListBlockItem）内的嵌套列表', () => {
  /** 一级字母列项「因素」的列项里有两组二级数字列项，中间隔一段说明。 */
  const nestedDoc = (secondContinues = false): JSONContent[] => [{
    type: 'stdList', attrs: { nodeId: 'O', listType: 'alpha', level: 1 }, content: [{
      type: 'stdListBlockItem', attrs: { nodeId: 'O-i' }, content: [
        { type: 'paragraph', attrs: { nodeId: 'O-p' }, content: [{ type: 'text', text: '因素，包括：' }] },
        list('N1', 'numeric', [item('n1', '组织架构；'), item('n2', '管理制度；')]),
        { type: 'paragraph', attrs: { nodeId: 'O-p2' }, content: [{ type: 'text', text: '以及：' }] },
        { ...list('N2', 'numeric', [item('n3', '人员能力。')]), ...(secondContinues ? { attrs: { nodeId: 'N2', listType: 'numeric', level: 2, continueNumbering: true } } : {}) },
      ],
    }],
  }]

  it('后一组设为继续编号：编辑器装饰与 Resolver 都从 3）起', () => {
    const e = editor(nestedDoc(true))
    expect(markers(e, ['n1', 'n2', 'n3'])).toEqual(['1）', '2）', '3）'])
    expect(listDom(e, 'N2').style.counterReset).toBe('numeric-counter 2')
    expect(listDom(e, 'N2').getAttribute('data-numbering')).toBe('continue')
  })

  it('光标在嵌套列表的列项里：命令作用于该嵌套列表；在外层块级列项的段落里：作用于外层列表', () => {
    const e = editor(nestedDoc())
    caretIn(e, 'n3', 1)
    expect(apply(e, 'continue')).toMatchObject({ ok: true, changed: true, start: 3, listType: 'numeric' })
    expect(attrOf(e, 'N2')).toBe(true)
    expect(listDom(e, 'N2').style.counterReset).toBe('numeric-counter 2')

    caretIn(e, 'O-p', 1)
    // 外层字母列表前面没有同类型列表：拒绝，而不是误判为不在列项内
    expect(apply(e, 'continue')).toEqual({ ok: false, reason: 'no-previous', listType: 'alpha' })
  })
})

describe('StarterKit 有序列表（orderedList）作为前一组数字列项', () => {
  /** irToPm 把含多段内容的数字列项投影为 orderedList；其后的数字 stdList 设为继续编号时应接着它编号。 */
  const starterDoc = (continues: boolean): JSONContent[] => [
    { type: 'orderedList', attrs: { nodeId: 'OL' }, content: [
      { type: 'listItem', attrs: { nodeId: 'ol1' }, content: [
        { type: 'paragraph', attrs: { nodeId: 'ol1-p1' }, content: [{ type: 'text', text: '第一段' }] },
        { type: 'paragraph', attrs: { nodeId: 'ol1-p2' }, content: [{ type: 'text', text: '第二段' }] },
      ] },
    ] },
    p('mid', '说明。'),
    { ...list('N', 'numeric', [item('n1', '后一组')]), ...(continues ? { attrs: { nodeId: 'N', listType: 'numeric', level: 2, continueNumbering: true } } : {}) },
  ]

  it('编辑器装饰与 Resolver 一致：从 2）起，不标为找不到目标', () => {
    const e = editor(starterDoc(true))
    expect(markers(e, ['ol1', 'n1'])).toEqual(['1）', '2）'])
    expect(listDom(e, 'N').style.counterReset).toBe('numeric-counter 1')
    expect(listDom(e, 'N').classList.contains('std-list-continue-orphan')).toBe(false)
  })

  it('命令：前面只有 orderedList 时也允许继续编号', () => {
    const e = editor(starterDoc(false))
    caretIn(e, 'n1', 1)
    expect(apply(e, 'continue')).toMatchObject({ ok: true, changed: true, start: 2, listType: 'numeric' })
  })
})
