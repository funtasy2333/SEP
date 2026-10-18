// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { setClauseFormat, setListFormat, setParagraphFormat, structureFailureMessage } from './structureEditing'
import {
  caretIn, clause, destroyEditors, editor, irOf, item, list, nodeById, note, p, select, snapshot, term, text, untitled,
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

describe('列项命令：不支持的位置一律拒绝（不论空光标还是选区），不改文档、不改选区', () => {
  const structuralCodes = ['unsupported-content', 'heading-skip', 'hanging-paragraph', 'dangling-xref', 'dangling-typed-ref']
  const cell = (content: JSONContent[]): JSONContent => ({ type: 'stdTable', attrs: { nodeId: 'tbl' }, content: [
    { type: 'tableCaption', content: [text('表题')] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content }] }] },
  ] })
  /** 把光标放进第一个满足条件的文本块（offset 为块内偏移）。 */
  const caretAt = (e: ReturnType<typeof editor>, match: (node: ReturnType<typeof nodeById>['node'], parent: ReturnType<typeof nodeById>['node'] | null) => boolean, offset = 0) => {
    let pos = -1
    e.state.doc.descendants((node, at, parent) => { if (pos < 0 && node.isTextblock && match(node, parent)) pos = at })
    if (pos < 0) throw new Error('找不到目标文本块')
    e.commands.setTextSelection(pos + 1 + offset)
  }
  const selectionOf = (e: ReturnType<typeof editor>) => [e.state.selection.from, e.state.selection.to]

  /** 列项命令（工具栏/斜杠命令走的 setListFormat 与 insertStdList 命令）都必须失败且什么都不动。 */
  function expectRejected(e: ReturnType<typeof editor>, listType = 'dash') {
    const before = snapshot(e), selection = selectionOf(e)
    const baseline = irOf(e).problems.map(problem => problem.code)
    expect(e.can().insertStdList({ listType })).toBe(false)
    expect(setListFormat(e, listType)).toEqual({ ok: false, reason: 'invalid-selection' })
    expect(snapshot(e)).toEqual(before)
    expect(selectionOf(e)).toEqual(selection)
    expect(e.chain().focus().insertStdList({ listType }).run()).toBe(false)
    expect(snapshot(e)).toEqual(before)
    expect(selectionOf(e)).toEqual(selection)
    const ir = irOf(e)
    expect(ir.doc.unsupportedContent ?? []).toEqual([])
    expect(ir.problems.map(problem => problem.code)).toEqual(baseline)
    expect(ir.problems.filter(problem => structuralCodes.includes(problem.code))).toEqual([])
    e.state.doc.check()
  }

  it('复现：光标在非空条标题中间点列项，不再把标题后半与正文拆进新生成的条', () => {
    const e = editor([clause('c', '条标题文字', [p('b', '条下正文')])])
    select(e, '条标题文字', 2)
    expectRejected(e)
    expect(listsOf(e)).toEqual([])
    expect(e.state.doc.child(0).childCount).toBe(2)
  })

  it('光标在章标题中间：拒绝，章不被拆成两章', () => {
    const e = editor([p('a', '正文')])
    select(e, '总体原则', 2)
    expectRejected(e)
    expect(e.state.doc.childCount).toBeLessThanOrEqual(2)
    expect(e.state.doc.child(0).firstChild!.textContent).toBe('总体原则')
  })

  it('光标在术语名中间、术语定义中间：拒绝，术语条目不被拆开', () => {
    const e = editor([term('t', 1, '术语名')])
    select(e, '术语名', 1)
    expectRejected(e)
    select(e, '术语名的定义', 2)
    expectRejected(e)
  })

  it('光标在术语条目内的非空正文段：该处放不下列表，拒绝而不是把术语条目拆成两个', () => {
    const e = editor([{ type: 'termDef', attrs: { nodeId: 't2', level: 1 }, content: [
      { type: 'termName', content: [text('术语')] }, { type: 'termDefinition', content: [text('定义')] }, p('tp', '术语内的段落'),
    ] }])
    select(e, '术语内的段落', 3)
    expectRejected(e)
    let termDefs = 0
    e.state.doc.descendants(node => { if (node.type.name === 'termDef') termDefs++ })
    expect(termDefs).toBe(1)
  })

  it('光标在表格单元格（有字/空段落）与表题里：拒绝，单元格不嵌入列表', () => {
    const filled = editor([cell([{ type: 'paragraph', content: [text('格子文字')] }])])
    select(filled, '格子文字', 2)
    expectRejected(filled)
    caretAt(filled, node => node.type.name === 'tableCaption', 1)
    expectRejected(filled)

    const empty = editor([cell([{ type: 'paragraph' }])])
    caretAt(empty, (node, parent) => node.type.name === 'paragraph' && parent?.type.name === 'tableCell')
    expectRejected(empty)
  })

  it('光标在附录标题、非空通用段落（粘贴来的 paragraph）与文档末尾的补位段落：拒绝', () => {
    const appendix = editor([])
    appendix.commands.setContent({ type: 'doc', content: [{ type: 'appendix', attrs: { nodeId: 'ap' }, content: [
      { type: 'appendixLabel', content: [text('（规范性）')] }, { type: 'appendixTitle', content: [text('附录标题')] }, p('apb', '附录正文'),
    ] }] })
    select(appendix, '附录标题', 2)
    expectRejected(appendix)

    const generic = editor([p('a', '前'), { type: 'paragraph', content: [text('通用段落')] }])
    select(generic, '通用段落', 2)
    expectRejected(generic)

    const trailing = editor([p('a', '前')])
    trailing.commands.setTextSelection(3)
    caretAt(trailing, (node, parent) => node.type.name === 'paragraph' && parent?.type.name === 'doc')
    expectRejected(trailing)
  })

  it('不认识的列项类型：拒绝，哪怕光标在可以插入的空段落里', () => {
    const e = editor([p('empty')])
    caretIn(e, 'empty')
    expectRejected(e, 'bogus')
    expect(listsOf(e)).toEqual([])
  })

  it('非空选区仍然拒绝，原因不变（跨标题与正文的选区）', () => {
    const e = editor([clause('c', '条标题', [p('b', '条下正文')])])
    select(e, '条标题', 0, 2)
    expectRejected(e)
    const from = nodeById(e, 'c').pos + 2
    e.commands.setTextSelection({ from, to: nodeById(e, 'b').pos + 3 })
    expectRejected(e)
  })

  it('空 stdParagraph 仍插入列表：夹在段落中间时邻居不动，光标进入新列项，IR 无异常', () => {
    const e = editor([p('a', '前一段'), p('empty'), p('b', '后一段')])
    caretIn(e, 'empty')
    expect(setListFormat(e, 'alpha')).toEqual({ ok: true })
    const body = e.state.doc.child(0)
    expect([...Array(body.childCount).keys()].slice(1).map(index => body.child(index).type.name)).toEqual(['stdParagraph', 'stdList', 'stdParagraph'])
    expect(listsOf(e).map(entry => [entry.type, entry.level, entry.texts])).toEqual([['alpha', 1, ['']]])
    expect(body.child(1).textContent).toBe('前一段')
    expect(body.child(3).textContent).toBe('后一段')
    expect(e.state.selection.empty).toBe(true)
    expect(e.state.selection.$from.parent.type.name).toBe('stdListItem')
    const ir = irOf(e)
    expect(ir.doc.unsupportedContent ?? []).toEqual([])
    expect(ir.problems.filter(problem => structuralCodes.includes(problem.code))).toEqual([])
    e.state.doc.check()
    expect(e.commands.undo()).toBe(true)
    expect(listsOf(e)).toEqual([])
  })

  it('空 stdParagraph 经 insertStdList 命令（斜杠命令同源）也插入列表；条下的空段落与无题条的空首段同样可以', () => {
    const e = editor([clause('c', '条标题', [p('empty')])])
    caretIn(e, 'empty')
    expect(e.chain().focus().insertStdList({ listType: 'numeric' }).run()).toBe(true)
    expect(listsOf(e).map(entry => [entry.type, entry.level])).toEqual([['numeric', 2]])
    expect(nodeById(e, 'c').node.lastChild!.type.name).toBe('stdList')
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])

    const bare = editor([untitled('u', 'up', '')])
    caretIn(bare, 'up')
    expect(setListFormat(bare, 'dash')).toEqual({ ok: true })
    expect(listsOf(bare)).toHaveLength(1)
    expect(irOf(bare).doc.unsupportedContent ?? []).toEqual([])
  })

  it('章（条）正文里的空通用 paragraph 同样算空段落：仍插入列表', () => {
    const e = editor([p('a', '前'), { type: 'paragraph' }])
    caretAt(e, (node, parent) => node.type.name === 'paragraph' && parent?.type.name === 'chapter')
    expect(setListFormat(e, 'dash')).toEqual({ ok: true })
    expect(listsOf(e).map(entry => [entry.type, entry.texts])).toEqual([['dash', ['']]])
    expect(e.state.doc.child(0).lastChild!.type.name).toBe('stdList')
    expect(e.state.selection.$from.parent.type.name).toBe('stdListItem')
    expect(irOf(e).doc.unsupportedContent ?? []).toEqual([])
    e.state.doc.check()
  })

  it('术语条目内的空段落放不下列表：拒绝，术语条目不被拆分或改动', () => {
    const e = editor([{ type: 'termDef', attrs: { nodeId: 't3', level: 1 }, content: [
      { type: 'termName', content: [text('术语')] }, { type: 'termDefinition', content: [text('定义')] }, p('mid'), note('tn', '术语注'),
    ] }])
    caretIn(e, 'mid')
    expectRejected(e)
  })

  it('列项失败提示点明哪些位置不支持，且不再套用「设置条」的文案', () => {
    const message = structureFailureMessage('invalid-selection', 'list')
    expect(message).toContain('列项')
    expect(message).toContain('标题')
    expect(message).toContain('表格')
    expect(message).toContain('空段落中会插入新列表')
    expect(message).not.toBe(structureFailureMessage('invalid-selection'))
  })

  it('已有内容的转换不受影响：光标在非空段落、注、列项里仍整块转换并保留光标', () => {
    const paragraph = editor([p('a', '中间文字')])
    caretIn(paragraph, 'a', 2)
    expect(setListFormat(paragraph, 'dash')).toEqual({ ok: true })
    expect(listsOf(paragraph).map(entry => [entry.type, entry.ids, entry.texts])).toEqual([['dash', ['a'], ['中间文字']]])
    expect(paragraph.state.selection.$from.parentOffset).toBe(2)

    const noted = editor([note('n', '注文字')])
    caretIn(noted, 'n', 1)
    expect(setListFormat(noted, 'alpha')).toEqual({ ok: true })
    expect(listsOf(noted).map(entry => [entry.type, entry.ids])).toEqual([['alpha', ['n']]])

    const items = editor([dash()])
    caretIn(items, 'i2', 1)
    expect(setListFormat(items, 'dot')).toEqual({ ok: true })
    expect(listsOf(items).map(entry => [entry.type, entry.texts])).toEqual([['dash', ['甲']], ['dot', ['乙']], ['dash', ['丙']]])
    expect(irOf(items).doc.unsupportedContent ?? []).toEqual([])
  })
})

describe('文本块格式转换对无类型引用的处理（审查 P2：只有 id 真的变了才改指）', () => {
  const ref = (id: string, attrs: Record<string, unknown>): JSONContent => ({
    type: 'stdParagraph', attrs: { nodeId: id }, content: [text('见'), text('引用', [{ type: 'crossRef', attrs }])],
  })
  const crossRefAttrs = (e: ReturnType<typeof editor>) => {
    const found: Array<Record<string, unknown>> = []
    e.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'crossRef') found.push(mark.attrs) })
    return found
  }
  const dangling = (e: ReturnType<typeof editor>) => irOf(e).problems.filter(entry => entry.code.startsWith('dangling'))

  it('段落改注：nodeId 不变，无类型引用留在原 id（注有编号，可作无类型目标；派生的 .p0 没有编号），paragraph 引用改指向 .p0', () => {
    const e = editor([p('x', '被引用段落'), ref('r1', { targetId: 'x', refType: '' }), ref('r2', { targetId: 'x', refType: 'paragraph' })])
    caretIn(e, 'x', 1)
    expect(e.commands.insertNote()).toBe(true)
    expect(nodeById(e, 'x').node.type.name).toBe('note')
    expect(crossRefAttrs(e)).toEqual([
      expect.objectContaining({ targetId: 'x', refType: '' }),
      expect.objectContaining({ targetId: 'x.p0', refType: 'paragraph' }),
    ])
    expect(dangling(e)).toEqual([])
    expect(e.commands.undo()).toBe(true)
    expect(crossRefAttrs(e)).toEqual([
      expect.objectContaining({ targetId: 'x', refType: '' }),
      expect.objectContaining({ targetId: 'x', refType: 'paragraph' }),
    ])
  })

  it('段落改列项：nodeId 不变，无类型引用不动，paragraph 引用改指向 .p0', () => {
    const e = editor([p('x', '被引用段落'), ref('r1', { targetId: 'x', refType: '' }), ref('r2', { refId: 'x', refType: 'paragraph' })])
    caretIn(e, 'x', 1)
    expect(setListFormat(e, 'dash')).toEqual({ ok: true })
    expect(crossRefAttrs(e)).toEqual([
      expect.objectContaining({ targetId: 'x', refType: '' }),
      expect.objectContaining({ refId: 'x.p0', refType: 'paragraph' }),
    ])
  })

  it('列项改段落：列项正文的派生锚点 .p0 消失，无类型引用（targetId 或旧稿 refId）与有类型引用一样改指向段落 id，保持各自的类型', () => {
    const e = editor([
      list('l', 'dash', [item('i1', '甲'), item('i2', '乙')]),
      ref('r1', { targetId: 'i1.p0', refType: '' }), ref('r2', { refId: 'i1.p0', refType: '' }), ref('r3', { targetId: 'i1.p0', refType: 'paragraph' }),
      ref('r4', { targetId: 'i2.p0', refType: '' }),
    ])
    caretIn(e, 'i1', 1)
    expect(setParagraphFormat(e)).toEqual({ ok: true })
    expect(nodeById(e, 'i1').node.type.name).toBe('stdParagraph')
    expect(crossRefAttrs(e)).toEqual([
      expect.objectContaining({ targetId: 'i1', refType: '' }),
      expect.objectContaining({ refId: 'i1', refType: '' }),
      expect.objectContaining({ targetId: 'i1', refType: 'paragraph' }),
      expect.objectContaining({ targetId: 'i2.p0', refType: '' }),
    ])
  })

  it('列项改注：.p0 仍是注正文的锚点，无类型与有类型引用都不动', () => {
    const e = editor([
      list('l', 'dash', [item('i1', '甲'), item('i2', '乙')]),
      ref('r1', { targetId: 'i1.p0', refType: '' }), ref('r2', { targetId: 'i1.p0', refType: 'paragraph' }),
    ])
    caretIn(e, 'i1', 1)
    expect(e.commands.insertNote()).toBe(true)
    expect(nodeById(e, 'i1').node.type.name).toBe('note')
    expect(crossRefAttrs(e)).toEqual([
      expect.objectContaining({ targetId: 'i1.p0', refType: '' }),
      expect.objectContaining({ targetId: 'i1.p0', refType: 'paragraph' }),
    ])
  })

  it('被无类型引用指向的注：改列项被拒绝（与有类型引用一致），文档不变', () => {
    const e = editor([note('n', '被引用的注'), ref('r1', { targetId: 'n', refType: '' })])
    caretIn(e, 'n', 1)
    const original = snapshot(e)
    expect(setListFormat(e, 'dash')).toEqual({ ok: false, reason: 'referenced-block' })
    expect(snapshot(e)).toEqual(original)
  })
})
