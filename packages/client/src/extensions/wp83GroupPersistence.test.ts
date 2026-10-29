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
})
