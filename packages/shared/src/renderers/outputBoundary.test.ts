import { describe, expect, it } from 'vitest'
import { renderHtml } from './html'
import { renderDocx } from './docx'
import { getOutputSupportProblems, UnsupportedOutputError } from './outputBoundary'
import { resolve } from '../ir/resolve'
import type { IRDoc } from '../ir/types'

const base = (): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' },
  front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'chapter', secType: 'scope', title: [{ text: '范围' }], children: [{ kind: 'paragraph', id: 'p1', content: [{ text: '原正文' }] }] }],
  appendices: [], bibliography: [],
})
const options = { images: {}, formulaOmml: {}, stage: 'working_draft' as const, createdAt: '2026-10-05T00:00:00.000Z' }

describe('新增语义的实际输出边界', () => {
  it('旧文档照常输出，新MathML不得被静默丢弃', () => {
    const doc = base()
    expect(renderHtml(doc, resolve(doc).labels)).toContain('原正文')
    expect(renderDocx(doc, resolve(doc).labels, options).parts['word/document.xml']).toContain('原正文')
    doc.body[0]!.children.push({ kind: 'formula', id: 'math', latex: '', numbered: true, whereList: [], mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>' } as IRDoc['body'][number]['children'][number])
    const before = JSON.stringify(doc)
    expect(() => renderHtml(doc, resolve(doc).labels)).toThrow(UnsupportedOutputError)
    expect(() => renderDocx(doc, resolve(doc).labels, options)).toThrow(/mathml/)
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual(expect.arrayContaining([expect.objectContaining({ nodeId: 'math', path: 'doc.body[0].children[1].mathml' })]))
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('图组、TBX、完整样式、索引的遗漏都带定位阻断', () => {
    const doc = base() as IRDoc & Record<string, unknown>
    doc.index = { id: 'index1', groups: [{ id: 'index-group1', entries: [{ id: 'entry1', term: [{ text: '正文' }], targets: ['p1'], seeAlso: [] }] }] }
    Object.assign(doc.body[0]!.children[0]!, { content: [{ text: '文字', style: { color: '#ff0000' } }] })
    doc.body[0]!.children.push({ kind: 'termEntry', id: 'term1', term: [{ text: '术语' }], definition: [], notes: [], examples: [], languageSets: [{ id: 'lang-fr', language: 'fr', groups: [{ id: 'tig-fr', terms: [{ id: 'variant-fr', content: [{ text: 'terme' }], descriptors: [] }] }] }] } as never)
    doc.body[0]!.children.push({ kind: 'figure', id: 'fig1', caption: [], orientation: 'portrait', src: '', notes: [], groups: [{ id: 'group1', descriptions: [], resourceRefs: [] }] } as never)
    const issues = getOutputSupportProblems(doc, 'DOCX')
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['doc.index', 'doc.body[0].children[0].content[0].style', 'doc.body[0].children[1].languageSets', 'doc.body[0].children[2].groups']))
    expect(() => renderHtml(doc, resolve(doc).labels)).toThrow(/请保留 JSON 文档/)
  })
})
