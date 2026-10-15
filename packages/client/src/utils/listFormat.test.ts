// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { setClauseFormat, setListFormat } from './structureEditing'
import {
  caretIn, destroyEditors, editor, irOf, item, list, nodeById, note, p, select, snapshot, text,
} from './__fixtures__/structureEditor'

afterEach(destroyEditors)

const dash = (): JSONContent => list('l', 'dash', [item('i1', '甲'), item('i2', '乙'), item('i3', '丙')])
const listsOf = (e: ReturnType<typeof editor>) => {
  const result: Array<{ type: string; level: number; ids: string[]; texts: string[]; id: string | null }> = []
  e.state.doc.descendants(node => {
    if (node.type.name !== 'stdList') return
    const ids: string[] = [], texts: string[] = []
    node.forEach(child => { ids.push(child.attrs.nodeId); texts.push(child.textContent) })
    result.push({ type: node.attrs.listType, level: node.attrs.level, ids, texts, id: node.attrs.nodeId })
  })
  return result
}

describe('列项改为格式命令：选中的列项变成目标类型，文字不丢', () => {
  it('复现：选中一级列项文字后点「二级列项」（insertStdList），列项文字不再消失', () => {
    const e = editor([dash()])
    select(e, '乙', 0, 1)
    expect(e.chain().focus().insertStdList({ listType: 'numeric' }).run()).toBe(true)
    expect(e.state.doc.textContent).toContain('乙')
    const lists = listsOf(e)
    expect(lists.map(item => [item.type, item.level, item.texts])).toEqual([
      ['dash', 1, ['甲']], ['numeric', 2, ['乙']], ['dash', 1, ['丙']],
    ])
    expect(lists[1]!.ids).toEqual(['i2'])
  })

  it('单项：前后部分保留原类型，新列表不复制原稳定锚点，所有 nodeId 唯一', () => {
    const e = editor([dash()])
    caretIn(e, 'i2', 1)
    expect(setListFormat(e, 'alpha')).toEqual({ ok: true })
    const lists = listsOf(e)
    expect(lists.map(item => [item.type, item.texts])).toEqual([['dash', ['甲']], ['alpha', ['乙']], ['dash', ['丙']]])
    expect(lists[0]!.id).toBe('l')
    const ids = lists.map(item => item.id)
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(3)
    expect(e.state.selection.$from.parent.type.name).toBe('stdListItem')
    expect(e.state.selection.$from.parent.attrs.nodeId).toBe('i2')
    expect(e.state.selection.$from.parentOffset).toBe(1)
    expect(e.commands.undo()).toBe(true)
    expect(listsOf(e)).toHaveLength(1)
  })

  it('跨同一列表的多项：选中项合为一个新列表；起始项即首项时沿用原稳定锚点', () => {
    const e = editor([dash()])
    select(e, '甲', 0, 1)
    const from = e.state.selection.from
    select(e, '乙', 1, 0)
    e.commands.setTextSelection({ from, to: e.state.selection.to })
    expect(setListFormat(e, 'numeric')).toEqual({ ok: true })
    const lists = listsOf(e)
    expect(lists.map(item => [item.type, item.level, item.texts])).toEqual([['numeric', 2, ['甲', '乙']], ['dash', 1, ['丙']]])
    expect(lists[0]!.id).toBe('l')
    expect(lists[1]!.id).not.toBe('l')
    expect(lists[1]!.id).toEqual(expect.any(String))
  })

  it('整个列表被选中时只改类型与级别，不拆分，保持 nodeId', () => {
    const e = editor([dash()])
    select(e, '甲', 0, 1)
    const from = e.state.selection.from
    select(e, '丙', 1, 0)
    e.commands.setTextSelection({ from, to: e.state.selection.to })
    expect(setListFormat(e, 'dot')).toEqual({ ok: true })
    expect(listsOf(e)).toEqual([{ type: 'dot', level: 2, id: 'l', ids: ['i1', 'i2', 'i3'], texts: ['甲', '乙', '丙'] }])
    expect(setListFormat(e, 'dot')).toEqual({ ok: true })
    expect(listsOf(e)).toHaveLength(1)
  })

  it('列项文字的 inline marks 与交叉引用锚点保持', () => {
    const e = editor([
      list('l', 'dash', [item('i1', '加粗', [{ type: 'bold' }])]),
      { type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [text('见'), text('列项', [{ type: 'crossRef', attrs: { targetId: 'i1.p0', refType: 'paragraph' } }])] },
    ])
    select(e, '加粗', 1, 1)
    expect(setListFormat(e, 'alpha')).toEqual({ ok: true })
    expect(nodeById(e, 'i1').node.firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold'])
    expect(listsOf(e)[0]!.type).toBe('alpha')
    expect(irOf(e).problems.filter(item => ['dangling-xref', 'dangling-typed-ref'].includes(item.code))).toEqual([])
  })

  it('选区是正文段落：整段转为目标类型列项，保留 nodeId 与 marks，引用改指向列项正文', () => {
    const e = editor([
      { type: 'stdParagraph', attrs: { nodeId: 'x' }, content: [text('甲乙', [{ type: 'bold' }])] },
      { type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [text('见'), text('该段', [{ type: 'crossRef', attrs: { targetId: 'x', refType: 'paragraph' } }])] },
    ])
    select(e, '甲乙', 1, 1)
    expect(setListFormat(e, 'dash')).toEqual({ ok: true })
    const lists = listsOf(e)
    expect(lists.map(item => [item.type, item.ids, item.texts])).toEqual([['dash', ['x'], ['甲乙']]])
    expect(nodeById(e, 'x').node.firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold'])
    expect(e.state.selection.$from.parent.attrs.nodeId).toBe('x')
    expect(e.state.selection.$from.parentOffset).toBe(1)
    let reference: Record<string, unknown> | undefined
    e.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'crossRef') reference = mark.attrs })
    expect(reference).toMatchObject({ targetId: 'x.p0', refType: 'paragraph' })
    expect(irOf(e).problems.filter(item => ['dangling-xref', 'dangling-typed-ref'].includes(item.code))).toEqual([])
  })

  it('跨多个相邻正文段落：合并为同一个列表的多个列项', () => {
    const e = editor([p('a', '段一'), p('b', '段二'), p('c', '段三')])
    select(e, '段一', 0, 1)
    const from = e.state.selection.from
    select(e, '段二', 1, 0)
    e.commands.setTextSelection({ from, to: e.state.selection.to })
    expect(setListFormat(e, 'alpha')).toEqual({ ok: true })
    expect(listsOf(e).map(item => [item.type, item.ids, item.texts])).toEqual([['alpha', ['a', 'b'], ['段一', '段二']]])
    expect(e.state.doc.child(0).lastChild?.attrs.nodeId).toBe('c')
  })

  it('空段落中保持原插入行为；无法转换的位置给出原因而不吞文字', () => {
    const e = editor([p('empty')])
    caretIn(e, 'empty')
    expect(setListFormat(e, 'dash')).toEqual({ ok: true })
    expect(listsOf(e).map(item => [item.type, item.texts])).toEqual([['dash', ['']]])

    const title = editor([{ type: 'clause', attrs: { nodeId: 'c', level: 1 }, content: [{ type: 'clauseTitle', attrs: { level: 1 }, content: [text('条标题')] }, p('b', '正文')] }])
    select(title, '条标题', 0, 2)
    const before = snapshot(title)
    expect(setListFormat(title, 'dash')).toEqual({ ok: false, reason: 'invalid-selection' })
    expect(title.chain().focus().insertStdList({ listType: 'dash' }).run()).toBe(false)
    expect(snapshot(title)).toEqual(before)
  })

  it('注/示例可转为列项；被交叉引用的注不转换且文档不变', () => {
    const e = editor([note('n1', '注文字')])
    select(e, '注文字', 0, 1)
    expect(setListFormat(e, 'dash')).toEqual({ ok: true })
    expect(listsOf(e).map(entry => [entry.type, entry.texts])).toEqual([['dash', ['注文字']]])

    const referenced = editor([note('n2', '被引用的注'), { type: 'stdParagraph', attrs: { nodeId: 'r' }, content: [text('见', []), text('注', [{ type: 'crossRef', attrs: { targetId: 'n2', refType: 'note' } }])] }])
    select(referenced, '被引用的注')
    const original = snapshot(referenced)
    expect(setListFormat(referenced, 'dash')).toEqual({ ok: false, reason: 'referenced-block' })
    expect(snapshot(referenced)).toEqual(original)
  })
})

describe('列项/注/示例一步转为条或无题条', () => {
  it('列项首项一步转为有题条：文字与 marks 不丢，其余列项成为条的正文，原稳定锚点保留', () => {
    const e = editor([list('l', 'dash', [item('i1', '甲条', [{ type: 'bold' }]), item('i2', '乙'), item('i3', '丙')])])
    select(e, '甲条', 1, 1)
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    const converted = nodeById(e, 'i1').node
    expect(converted.type.name).toBe('clause')
    expect(converted.attrs).toMatchObject({ level: 1, hasTitle: true })
    expect(converted.firstChild!.textContent).toBe('甲条')
    expect(converted.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold'])
    expect(converted.childCount).toBe(2)
    expect(converted.child(1).type.name).toBe('stdList')
    expect(listsOf(e).map(entry => [entry.type, entry.ids, entry.texts, entry.id])).toEqual([['dash', ['i2', 'i3'], ['乙', '丙'], 'l']])
    expect(e.state.selection.$from.parent).toBe(converted.firstChild)
    expect(e.state.selection.$from.parentOffset).toBe(1)
    expect(irOf(e).problems.filter(entry => ['heading-skip', 'hanging-paragraph', 'dangling-xref'].includes(entry.code))).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(listsOf(e)).toHaveLength(1)
    expect(listsOf(e)[0]!.ids).toEqual(['i1', 'i2', 'i3'])
  })

  it('列项首项一步转为无题条：条文成为首个 stdParagraph，clauseTitle 为空', () => {
    const e = editor([list('l', 'alpha', [item('i1', '甲条文', [{ type: 'bold' }]), item('i2', '乙')])])
    select(e, '甲条文', 2, 0)
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    const converted = e.state.doc.child(0).child(1)
    expect(converted.type.name).toBe('clause')
    expect(converted.attrs.hasTitle).toBe(false)
    expect(converted.firstChild!.content.size).toBe(0)
    expect(converted.child(1).type.name).toBe('stdParagraph')
    expect(converted.child(1).attrs.nodeId).toBe('i1')
    expect(converted.child(1).textContent).toBe('甲条文')
    expect(converted.child(1).firstChild!.marks.map(mark => mark.type.name)).toEqual(['bold'])
    expect(converted.child(2).type.name).toBe('stdList')
    expect(listsOf(e)[0]!.texts).toEqual(['乙'])
    expect(e.state.selection.$from.parent).toBe(converted.child(1))
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
  })

  it('列项中间项转条会让前面的列项悬置：拒绝并保持文档不变', () => {
    const e = editor([list('l', 'dash', [item('i1', '甲'), item('i2', '乙'), item('i3', '丙')])])
    select(e, '乙')
    const original = snapshot(e)
    expect(setClauseFormat(e, 1)).toEqual({ ok: false, reason: 'hanging-paragraph' })
    expect(snapshot(e)).toEqual(original)
  })

  it('指向列项正文/注的引用随转换改指向条（有题）或首段（无题），不产生悬空引用', () => {
    const refParagraph = (marks: Array<Record<string, unknown>>): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: 'ref' }, content: [
      text('见'), ...marks.map(attrs => text('引用', [{ type: 'crossRef', attrs }])),
    ] })
    const crossRefs = (e: ReturnType<typeof editor>) => {
      const found: Array<Record<string, unknown>> = []
      e.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'crossRef') found.push(mark.attrs) })
      return found
    }
    const noDangling = (e: ReturnType<typeof editor>) =>
      irOf(e).problems.filter(entry => ['dangling-xref', 'dangling-typed-ref'].includes(entry.code))

    const titled = editor([list('l', 'dash', [item('i1', '甲条'), item('i2', '乙')]), refParagraph([{ targetId: 'i1.p0', refType: 'paragraph' }])])
    select(titled, '甲条')
    expect(setClauseFormat(titled, 1)).toEqual({ ok: true })
    expect(crossRefs(titled)).toEqual([expect.objectContaining({ targetId: 'i1', refType: 'clause' })])
    expect(noDangling(titled)).toEqual([])

    const plain = editor([list('l', 'dash', [item('i1', '甲条'), item('i2', '乙')]), refParagraph([{ targetId: 'i1.p0', refType: 'paragraph' }])])
    select(plain, '甲条')
    expect(setClauseFormat(plain, 1, false)).toEqual({ ok: true })
    expect(crossRefs(plain)).toEqual([expect.objectContaining({ targetId: 'i1', refType: 'paragraph' })])
    expect(noDangling(plain)).toEqual([])

    const noted = editor([note('n1', '注转条'), refParagraph([{ targetId: 'n1', refType: 'note' }])])
    select(noted, '注转条')
    expect(setClauseFormat(noted, 1)).toEqual({ ok: true })
    expect(crossRefs(noted)).toEqual([expect.objectContaining({ targetId: 'n1', refType: 'clause' })])
    expect(noDangling(noted)).toEqual([])
  })

  it('注、示例可直接转为条', () => {
    const e = editor([note('n1', '注转条'), p('after', '后续')])
    select(e, '注转条')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(nodeById(e, 'n1').node.type.name).toBe('clause')
    expect(nodeById(e, 'n1').node.firstChild!.textContent).toBe('注转条')
    expect(nodeById(e, 'n1').node.lastChild?.attrs.nodeId).toBe('after')

    const example = editor([{ type: 'example', attrs: { nodeId: 'e1' }, content: [text('示例转无题条')] }])
    select(example, '示例转无题条')
    expect(setClauseFormat(example, 1, false)).toEqual({ ok: true })
    const converted = example.state.doc.child(0).child(1)
    expect(converted.attrs.hasTitle).toBe(false)
    expect(converted.child(1).textContent).toBe('示例转无题条')
    expect(irOf(example).doc.unsupportedContent ?? []).toEqual([])
  })
})
