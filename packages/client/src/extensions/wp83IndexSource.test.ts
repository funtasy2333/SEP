import { describe, expect, it } from 'vitest'
import { exportXml46687, getOutputSupportProblems, irToPm, pmToIr, resolve, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from './editorSchema'
import { completeMeta } from '../../../shared/src/renderers/__tests__/xml46687Kit'
import { stubOptions } from '../../../shared/src/renderers/__tests__/xml46687StubKit'

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
    for (const format of ['XML', 'HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(result, format).some(problem => problem.path.includes('index'))).toBe(true)
    }
    const outputDoc = { ...result, meta: completeMeta(), body: result.body.map(chapter => ({ ...chapter, secType: 'scope' as const, title: [{ text: '范围' }] })) }
    const unsupported = exportXml46687(outputDoc, resolve(outputDoc).labels, stubOptions(outputDoc))
    expect(unsupported.xml).toBeNull()
    expect(unsupported.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'xml-write-failed', severity: 'error', path: expect.stringContaining('sourceReferences[1]') }),
    ]))
    const supported = structuredClone(outputDoc)
    supported.index!.groups[0]!.entries[0]!.sourceReferences!.pop()
    const exported = exportXml46687(supported, resolve(supported).labels, stubOptions(supported))
    expect(exported.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(exported.xml!.replace(/>\s+</g, '><')).toContain('<term>索引词</term><see-entry><bold>见词</bold></see-entry>')
  })

  it('索引原文中的引用只检查一次', () => {
    const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [], children: [] }], appendices: [], bibliography: [],
      index: { id: 'index', groups: [{ id: 'group', entries: [{ id: 'entry', term: [{ text: '词' }], targets: [], seeAlso: [],
        sourceReferences: [{ type: 'see', content: [{ text: '指向', marks: [{ type: 'termRef', targetId: 'missing' }] }] }] }] }] } }
    expect(resolve(doc).problems.filter(problem => problem.code === 'dangling-typed-ref')).toHaveLength(1)
  })

  it('生产 Schema 拒绝未知的索引原文引用类型', () => {
    const schema = createEditorSchema()
    const input = { type: 'doc', content: [{ type: 'indexBlock', attrs: { nodeId: 'index' }, content: [
      { type: 'indexGroup', attrs: { nodeId: 'group' }, content: [{ type: 'indexEntry', attrs: { nodeId: 'entry' }, content: [
        { type: 'indexTerm' }, { type: 'indexSourceReference', attrs: { referenceType: 'unknown' }, content: [{ type: 'text', text: '原文' }] },
      ] }] },
    ] }] }
    expect(() => schema.nodeFromJSON(input).check()).toThrow()
  })
})
