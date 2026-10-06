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
  it('collects bibliography references from extended inline fields in document order', () => {
    const ref = (text: string, targetId: string) => ({ text, marks: [{ type: 'bibRef' as const, targetId }] })
    const doc = fixture()
    doc.meta.titleParts![0]!.content = [ref('题名引用', 'bib-meta')]
    doc.body[0]!.children = [
      {
        kind: 'formula', id: 'formula-first', latex: 'x=1', numbered: true, whereList: [],
        notes: [{ id: 'formula-note-first', content: [{ text: '公式注引用', marks: [
          { type: 'bibRef', targetId: 'bib-b' }, { type: 'crossRef', targetId: 'missing-in-formula-note' },
        ] }] }],
      },
      {
        kind: 'figure', id: 'figure-next', src: '', caption: [], orientation: 'portrait', notes: [],
        descriptions: [{ id: 'figure-description', content: [ref('图说明引用', 'bib-c')] }],
        groups: [{ id: 'figure-group-order', descriptions: [{ id: 'group-description', content: [ref('图组说明引用', 'bib-h')] }], resourceRefs: [] }],
      },
      {
        ...term('tbx-term'),
        languageSets: [{ id: 'lang-set-order', language: 'zh', groups: [{ id: 'tig-order', terms: [{
          id: 'variant-order', content: [ref('TBX词项引用', 'bib-d')], descriptors: [
            { id: 'descriptor-order', kind: 'subjectField', value: [ref('TBX描述符引用', 'bib-e')] },
          ],
        }] }] }],
      },
      { kind: 'paragraph', id: 'paragraph-last', content: [ref('正文后续引用', 'bib-a')] },
    ]
    doc.appendices = [{
      kind: 'appendix', id: 'appendix-order', normative: true, title: [],
      children: [{ kind: 'paragraph', id: 'appendix-paragraph', content: [
        ref('附录首次引用', 'bib-i'), ref('附录重复引用', 'bib-b'),
      ] }],
    }]
    doc.bibliography = ['g', 'f', 'index-title', 'index-group', 'index-term', 'meta', 'a', 'b', 'c', 'd', 'e', 'h', 'i'].map(id => ({
      kind: 'bibEntry' as const,
      id: 'bib-' + id,
      content: [{ text: '文献' + id }],
      ...(id === 'f' ? { fields: [{ id: 'bib-field-order', name: 'title', value: [{ text: '文献结构字段引用', marks: [
        { type: 'bibRef', targetId: 'bib-f' }, { type: 'crossRef', targetId: 'missing-in-bib-field' },
      ] }, { text: '', formula: { id: 'bib-inline-formula', latex: 'x=1' } }] }] } : {}),
    }))
    // Index title/group labels are plain-text PM attrs; marked IR values are rejected by irToPm.
    doc.index!.title = [ref('索引标题引用', 'bib-index-title')]
    doc.index!.groups[0]!.label = [ref('索引组标签引用', 'bib-index-group')]
    doc.index!.groups[0]!.entries[0]!.term = [ref('索引词条引用', 'bib-index-term')]
    doc.index!.groups[0]!.entries[0]!.targets = ['bib-inline-formula']

    const result = resolve(doc)
    const expectedOrder = [
      'bib-meta', 'bib-b', 'bib-c', 'bib-h', 'bib-d', 'bib-e', 'bib-a', 'bib-i',
      'bib-g', 'bib-f', 'bib-index-title', 'bib-index-group', 'bib-index-term',
    ]
    expect(result.bibliographyOrder).toEqual(expectedOrder)
    expect(result.problems.filter(problem => problem.code === 'dangling-xref').map(problem => problem.nodeId))
      .toEqual(['formula-note-first', 'bib-field-order'])
    expect(result.problems).not.toContainEqual(expect.objectContaining({ code: 'dangling-index-target', nodeId: 'index-entry' }))
    expect(result.problems).not.toContainEqual(expect.objectContaining({ code: 'duplicate-id', nodeId: 'bib-inline-formula' }))
    expect(result.labels['formula-first']?.label).toBe('(1)')
    expect(result.labels['figure-next']?.label).toBe('图1')
    expect(result.labels['tbx-term']?.label).toBe('1.1')

    const reorderedKeys: IRDoc = {
      index: doc.index,
      resources: doc.resources,
      bibliography: doc.bibliography,
      appendices: doc.appendices,
      body: doc.body,
      front: doc.front,
      meta: doc.meta,
      extensionVersion: doc.extensionVersion,
      schemaVersion: doc.schemaVersion,
    }
    expect(resolve(reorderedKeys).bibliographyOrder).toEqual(expectedOrder)
  })
  it('preserves body-footnote restrictions in formula, figure and TBX extension inline content', () => {
    const bodyFootnote = (id: string) => ({ text: '带脚注内容', footnote: { id, content: [{ text: '脚注内容' }] } })
    const doc = fixture()
    doc.body[0]!.children = [
      { kind: 'formula', id: 'formula-footnote', latex: 'x=1', numbered: true, whereList: [], notes: [{ id: 'formula-note-footnote', content: [bodyFootnote('formula-inline-footnote')] }] },
      { kind: 'figure', id: 'figure-footnote', src: '', caption: [], orientation: 'portrait', notes: [], descriptions: [{ id: 'figure-description-footnote', content: [bodyFootnote('figure-inline-footnote')] }] },
      {
        ...term('term-footnote'),
        languageSets: [{ id: 'lang-set-footnote', language: 'zh', groups: [{ id: 'tig-footnote', terms: [{
          id: 'variant-footnote', content: [bodyFootnote('term-inline-footnote')], descriptors: [],
        }] }] }],
      },
    ]

    const issues = resolve(doc).problems.filter(problem => problem.code === 'invalid-footnote')
    expect(issues.map(problem => problem.nodeId)).toEqual(['formula-note-footnote', 'figure-description-footnote', 'variant-footnote'])
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
