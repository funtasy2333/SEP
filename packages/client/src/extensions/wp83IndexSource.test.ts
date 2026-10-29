import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, irToPm, pmToIr, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from './editorSchema'

describe('WP8.3 索引源文字', () => {
  it('按顺序保存 see 和 see-also 的富文本而不虚构目标', () => {
    const entry = { id: 'entry', term: [{ text: '索引词' }], targets: [], seeAlso: [], sourceReferences: [
      { type: 'see' as const, content: [{ text: '见词', marks: [{ type: 'bold' as const }] }] },
      { type: 'seeAlso' as const, content: [{ text: '另见词' }] },
    ] }
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [] }], appendices: [], bibliography: [],
      index: { id: 'index', groups: [{ id: 'group', entries: [entry] }] } }
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(doc))
    first.check()
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    reopened.check()
    const result = pmToIr(reopened.toJSON() as PMJsonNode).doc
    expect(result.index?.groups[0]?.entries[0]).toEqual(entry)
    expect(schema.nodeFromJSON(irToPm(result)).toJSON()).toEqual(first.toJSON())
    for (const format of ['XML', 'XML46687', 'HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(result, format).some(problem => problem.path.includes('index'))).toBe(true)
    }
  })
})
