import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, IRToPmError, irToPm, pmToIr, resolve, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from './editorSchema'

describe('WP8.3 组节点保存', () => {
  it('保留组级编号与成员公式的顺序和身份', () => {
    const group = { kind: 'formulaGroup', id: 'group', numbered: true, formulas: [
      { kind: 'formula', id: 'one', latex: 'x', mathml: '<math><mi>x</mi></math>', numbered: false, whereList: [] },
      { kind: 'formula', id: 'two', latex: 'y', mathml: '<math><mi>y</mi></math>', numbered: false, whereList: [] },
    ] }
    const source = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [group] }], appendices: [], bibliography: [] } as unknown as IRDoc
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(source))
    first.check()
    const restored = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    restored.check()
    const result = pmToIr(restored.toJSON() as PMJsonNode)
    expect(result.doc.unsupportedContent ?? []).toEqual([])
    expect(result.doc.body[0]!.children[0]).toMatchObject(group)
    expect(schema.nodeFromJSON(irToPm(result.doc)).toJSON()).toEqual(first.toJSON())
    for (const format of ['HTML', 'DOCX', 'XML', 'XML46687'] as const) {
      expect(getOutputSupportProblems(result.doc, format).some(problem => problem.path.includes('children[0]'))).toBe(true)
    }
  })

  it('公式组只占一个编号，成员不改变之后公式的编号', () => {
    const formula = (id: string) => ({ kind: 'formula' as const, id, latex: 'x', numbered: true, whereList: [] })
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [
        { kind: 'formulaGroup', id: 'group', numbered: true, formulas: [formula('one'), formula('two')] }, formula('after'),
      ] }], appendices: [], bibliography: [] }
    const { labels } = resolve(doc)
    expect(labels.group?.xmlId).toBe('formula_1')
    expect(labels.after?.xmlId).toBe('formula_2')
    expect(labels.one).toBeUndefined()
    expect(labels.two).toBeUndefined()
  })

  it('尚未支持的共享脚注投影明确报错', () => {
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [
        { kind: 'paragraph', id: 'p', content: [{ text: '', footnoteRef: { targetId: 'fn', refText: '1' } }] },
      ] }], appendices: [], bibliography: [] }
    expect(() => irToPm(doc)).toThrow(IRToPmError)
  })

  it('图组保留组图例和各分图的顺序', () => {
    const group = { kind: 'figureSet' as const, id: 'set', legend: { id: 'legend', items: [
      { id: 'item', term: [{ text: 'a' }], definition: [{ text: '说明' }] },
    ] }, figures: [
      { kind: 'figure' as const, id: 'f1', caption: [{ text: '一' }], orientation: 'portrait' as const, src: 'a.png', notes: [] },
      { kind: 'figure' as const, id: 'f2', caption: [{ text: '二' }], orientation: 'portrait' as const, src: 'b.png', notes: [] },
    ] }
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [group] }], appendices: [], bibliography: [] }
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(doc))
    first.check()
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    reopened.check()
    const result = pmToIr(reopened.toJSON() as PMJsonNode)
    expect(result.doc.body[0]!.children[0]).toMatchObject(group)
    expect(result.doc.unsupportedContent ?? []).toEqual([])
    expect(resolve(result.doc).labels.f1?.xmlId).toBe('fig_1')
    expect(resolve(result.doc).labels.f2?.xmlId).toBe('fig_2')
    expect(schema.nodeFromJSON(irToPm(result.doc)).toJSON()).toEqual(first.toJSON())
  })

  it('无编号数组保留列组、列属性和网格，后续表编号不受影响', () => {
    const cell = (id: string, value: string) => ({ id, colspan: 1, rowspan: 1, header: false,
      content: [{ kind: 'paragraph' as const, id: `${id}-p`, content: [{ text: value }] }] })
    const array = { kind: 'array' as const, id: 'array', columns: [{ textAlign: 'center' }, {}], columnGroups: [{ start: 0, count: 2 }],
      rows: [{ id: 'row1', cells: [cell('a', '1'), cell('b', '2')] }, { id: 'row2', cells: [cell('c', '3'), cell('d', '4')] }] }
    const table = { kind: 'table' as const, id: 'table', caption: [], orientation: 'portrait' as const, headerRowCount: 0, notes: [],
      rows: [{ id: 'tr', cells: [cell('tc', '表')] }] }
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [array, table] }], appendices: [], bibliography: [] }
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(doc))
    first.check()
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    reopened.check()
    const result = pmToIr(reopened.toJSON() as PMJsonNode)
    expect(result.doc.body[0]!.children[0]).toMatchObject(array)
    expect(result.doc.unsupportedContent ?? []).toEqual([])
    expect(resolve(result.doc).labels.table?.xmlId).toBe('tab_1')
    expect(schema.nodeFromJSON(irToPm(result.doc)).toJSON()).toEqual(first.toJSON())
  })
})
