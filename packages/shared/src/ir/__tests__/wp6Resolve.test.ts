import { describe, expect, it } from 'vitest'
import type { IRDoc, IRTermEntry } from '../types'
import { resolve } from '../resolve'

const term = (id: string): IRTermEntry => ({ kind: 'termEntry', id, term: [{ text: '术语' }], definition: [], notes: [], examples: [] })
function fixture(): IRDoc {
  return {
    schemaVersion: 1, extensionVersion: 1,
    meta: { standardType: 'gb', titleParts: [{ id: 'title-zh', lang: 'zh', content: [{ text: '题名' }] }] },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter', secType: 'terms', title: [{ text: '测试要素' }], children: [
      { kind: 'paragraph', id: 'paragraph', content: [{ text: '引用', marks: [{ type: 'termRef', targetId: 'term' }] }, { text: '', formula: { id: 'inline-math', mathml: '<math><mi>x</mi></math>' } }] },
      { ...term('term'), nestedEntries: [term('nested-term')], languageSets: [{ id: 'lang-set', language: 'zh', groups: [{ id: 'tig', terms: [{ id: 'variant', content: [{ text: '词项', marks: [{ type: 'bibRef', targetId: 'bib-b' }] }], descriptors: [{ id: 'descriptor', kind: 'subjectField', value: [{ text: '标准化' }] }] }] }] }] },
      { kind: 'warning', id: 'warning', content: [{ kind: 'paragraph', id: 'warning-p', content: [{ text: '警告' }] }] },
      { kind: 'quote', id: 'quote', content: [{ kind: 'code', id: 'code', language: 'text', text: 'value = 1' }] },
      { kind: 'formula', id: 'formula', latex: 'x=1', numbered: true, whereList: [], notes: [{ id: 'formula-note', content: [{ text: '说明' }] }] },
      { kind: 'figure', id: 'figure', src: '', caption: [], orientation: 'portrait', notes: [], resourceId: 'resource', descriptions: [{ id: 'description', content: [{ text: '图说明' }] }], groups: [{ id: 'figure-group', descriptions: [], resourceRefs: ['resource'] }] },
    ] }],
    appendices: [], bibliography: [
      { kind: 'bibEntry', id: 'bib-a', content: [{ text: '文献A' }] },
      { kind: 'bibEntry', id: 'bib-b', content: [{ text: '文献B' }], fields: [{ id: 'bib-field', name: 'title', value: [{ text: '结构题名' }] }] },
    ],
    resources: [{ id: 'resource', encoding: 'text', mediaType: 'image/svg+xml', data: '<svg/>' }],
    index: { id: 'index', groups: [{ id: 'index-group', entries: [{ id: 'index-entry', term: [{ text: '术语' }], targets: ['term', 'paragraph'], seeAlso: ['bib-a'] }] }] },
  }
}

describe('WP6 Resolver typed entities and references', () => {
  it('registers all added entities, nested term numbering and TBX-only bibliography references', () => {
    const doc = fixture()
    const before = JSON.stringify(doc)
    const result = resolve(doc)
    expect(result.problems).toEqual([])
    expect(result.bibliographyOrder).toEqual(['bib-b', 'bib-a'])
    expect(result.labels['nested-term']?.label).toBe('1.1.1')
    for (const id of ['title-zh', 'inline-math', 'lang-set', 'tig', 'variant', 'descriptor', 'code', 'formula-note', 'description', 'figure-group', 'resource', 'index', 'index-group', 'index-entry', 'bib-field']) {
      expect(result.labels[id], id).toBeDefined()
    }
    expect(resolve(doc)).toEqual(result)
    expect(JSON.stringify(doc)).toBe(before)
  })
  it('reports dangling resources/index targets and typed target mismatches at the owner', () => {
    const doc = fixture()
    doc.index!.groups[0]!.entries[0]!.targets.push('missing-index-target')
    const figure = doc.body[0]!.children.find(child => child.kind === 'figure')!
    if (figure.kind === 'figure') figure.groups![0]!.resourceRefs.push('missing-resource')
    const paragraph = doc.body[0]!.children[0]!
    if (paragraph.kind === 'paragraph') paragraph.content.push({ text: '错误文献目标', marks: [{ type: 'bibRef', targetId: 'term' }, { type: 'termRef', targetId: 'missing-term' }] })
    expect(resolve(doc).problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'dangling-index-target', nodeId: 'index-entry' }),
      expect.objectContaining({ code: 'dangling-resource', nodeId: 'figure-group' }),
      expect.objectContaining({ code: 'dangling-typed-ref', nodeId: 'paragraph' }),
    ]))
  })
  it('detects duplicate/empty IDs in added metadata and preserves prototype-named labels', () => {
    const doc = fixture()
    doc.meta.titleParts!.push({ id: 'paragraph', content: [] }, { id: '', content: [] })
    doc.body[0]!.id = '__proto__'
    doc.unsupportedContent = [{ nodeId: 'warning', path: 'doc.content[1]', nodeType: 'future-node', reason: '未映射' }]
    const result = resolve(doc)
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-id', nodeId: 'paragraph' }),
      expect.objectContaining({ code: 'missing-id', nodeId: '' }),
      expect.objectContaining({ code: 'unsupported-content', nodeId: 'warning' }),
    ]))
    expect(Object.hasOwn(result.labels, '__proto__')).toBe(true)
    expect(JSON.parse(JSON.stringify(result.labels))['__proto__'].label).toBe('1')
  })
  it('can explicitly reference an unnumbered paragraph and validates references inside bibliography', () => {
    const doc = fixture()
    doc.bibliography[0]!.content.push({ text: '正文段落', marks: [{ type: 'crossRef', targetId: 'paragraph', targetKind: 'paragraph' }] })
    expect(resolve(doc).problems).toEqual([])
    expect(resolve(doc).labels['paragraph']?.refText).toContain('引用')
    doc.bibliography[0]!.content.push({ text: '错误术语引用', marks: [{ type: 'termRef', targetId: 'bib-b' }] })
    expect(resolve(doc).problems).toContainEqual(expect.objectContaining({ code: 'dangling-typed-ref', nodeId: 'bib-a' }))
  })
})
