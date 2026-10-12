import { describe, expect, it } from 'vitest'
import type { IRClause, IRDoc, IRParagraph, IRTermEntry } from './types'
import { externalIdToNodeId, remapExternalIds } from './externalIds'

function definitionIds(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) definitionIds(item, found)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'id' && typeof item === 'string') found.push(item)
      definitionIds(item, found)
    }
  }
  return found
}

function fullIrTree(): IRDoc {
  return {
    schemaVersion: 1,
    extensionVersion: 1,
    meta: {
      standardType: 'gb',
      titleParts: [{ id: 'meta-title', lang: 'zh', role: 'main', content: [{ text: '标题' }] }],
      identifiers: [{ id: 'meta-identifier', scheme: 'standard', parts: [{ id: 'identifier-part', kind: 'series', content: [] }] }],
      languages: [{ id: 'meta-language', tag: 'zh-CN' }, { id: 'constructor', tag: 'en' }],
      publishers: [{ id: 'meta-publisher', name: [{ text: '发布机构' }] }],
      adoptions: [{ id: 'meta-adoption', reference: 'ISO 1' }],
      replacedStandards: [{ id: 'meta-replaced', reference: 'GB/T 1' }],
      copyrights: [{ id: 'meta-copyright', statement: [{ text: '版权声明' }] }],
    },
    front: {
      foreword: [{
        kind: 'paragraph',
        id: 'front-paragraph',
        content: [{ text: '前言', marks: [{ type: 'crossRef', targetId: '章节/🔥' }] }],
      }],
      introduction: [],
    },
    body: [{
      kind: 'chapter',
      id: '章节/🔥',
      secType: 'scope',
      title: [{ text: '范围' }],
      children: [{
        kind: 'clause',
        id: 'clause-1',
        level: 1,
        titled: true,
        title: [{ text: '范围' }],
        children: [
          {
            kind: 'paragraph',
            id: 'paragraph-1',
            content: [
              { text: 'self', marks: [{ type: 'crossRef', targetId: '章节/🔥' }] },
              { text: 'typed refs', marks: [{ type: 'bibRef', targetId: 'bib-entry' }, { type: 'termRef', targetId: 'duplicate-definition' }] },
              { text: 'empty and missing', marks: [{ type: 'crossRef', targetId: '' }, { type: 'crossRef', targetId: 'missing-target' }] },
              { text: 'formula', formula: { id: 'inline-formula', latex: 'x' } },
              { text: 'footnote', footnote: { id: 'inline-footnote', content: [{ text: '注' }] } },
              { text: 'table footnote', marks: [{ type: 'tableFootnoteRef', targetId: 'table-footnote', id: 'table-footnote-ref' }] },
            ],
          },
          {
            kind: 'figure',
            id: 'figure-1',
            caption: [],
            orientation: 'portrait',
            src: 'resource-a',
            notes: [{ kind: 'note', id: 'figure-note', content: [] }],
            resourceId: 'resource-a',
            groups: [{
              id: 'figure-group',
              descriptions: [{ id: 'figure-description', content: [{ text: '说明' }] }],
              resourceRefs: ['resource-b', 'missing-resource-group'],
            }],
          },
          {
            kind: 'figure',
            id: 'figure-missing-resource',
            caption: [],
            orientation: 'portrait',
            src: '',
            notes: [],
            resourceId: 'missing-resource',
          },
          {
            kind: 'list',
            id: 'list-1',
            listType: 'dash',
            items: [{ id: 'list-item', content: [{ kind: 'paragraph', id: 'list-paragraph', content: [{ text: '列项' }] }] }],
          },
          {
            kind: 'example',
            id: 'example-1',
            content: [{ kind: 'paragraph', id: 'example-paragraph', content: [{ text: '示例' }] }],
          },
          {
            kind: 'warning',
            id: 'warning-1',
            content: [{ kind: 'paragraph', id: 'warning-paragraph', content: [{ text: '警告' }] }],
          },
          {
            kind: 'quote',
            id: 'quote-1',
            content: [{ kind: 'paragraph', id: 'quote-paragraph', content: [{ text: '引文' }] }],
          },
          { kind: 'code', id: 'code-1', language: 'ts', text: 'const x = 1' },
          {
            kind: 'formula',
            id: 'formula-block',
            latex: 'x = 1',
            numbered: true,
            whereList: [{ id: 'formula-where', term: [{ text: 'x' }], definition: [{ text: '变量' }] }],
            notes: [{ id: 'duplicate-definition', content: [{ text: '重复定义 ID' }] }],
          },
          {
            kind: 'table',
            id: 'table-1',
            caption: [],
            orientation: 'portrait',
            headerRowCount: 1,
            rows: [{ id: 'table-row', cells: [{
              id: 'table-cell',
              colspan: 1,
              rowspan: 1,
              header: true,
              content: [{ kind: 'paragraph', id: 'cell-paragraph', content: [] }],
            }] }],
            notes: [],
            footnotes: [{ id: 'table-footnote', content: [{ text: '表注' }] }],
          },
          {
            kind: 'termEntry',
            id: 'duplicate-definition',
            term: [{ text: '术语' }],
            definition: [],
            notes: [{ kind: 'note', id: 'term-note', content: [{ kind: 'paragraph', id: 'term-note-paragraph', content: [] }] }],
            examples: [{ kind: 'example', id: 'term-example', content: [{ kind: 'paragraph', id: 'term-example-paragraph', content: [] }] }],
            languageSets: [{
              id: 'tbx-language-set',
              language: 'en',
              groups: [{
                id: 'tbx-tig',
                terms: [{
                  id: 'tbx-variant',
                  content: [{ text: 'term' }],
                  descriptors: [{ id: 'tbx-descriptor', kind: 'partOfSpeech', value: [{ text: 'noun' }] }],
                }],
              }],
            }],
            nestedEntries: [{
              kind: 'termEntry',
              id: 'nested-term',
              term: [{ text: '子术语' }],
              definition: [],
              notes: [],
              examples: [],
            }],
          },
        ],
      }],
    }],
    appendices: [{ kind: 'appendix', id: '', normative: false, title: [], children: [] }],
    bibliography: [{
      kind: 'bibEntry',
      id: 'bib-entry',
      content: [{ text: '文献' }],
      fields: [{ id: 'bib-field', name: 'title', value: [{ text: '来源' }] }],
      identifiers: [{ id: 'bib-identifier', scheme: 'doi', value: '10.0000/example' }],
      externalLink: { href: 'https://example.test', title: 'source' },
    }],
    resources: [
      { id: 'resource-a', encoding: 'text', data: 'A' },
      { id: 'resource-b', encoding: 'base64', data: 'Qg==' },
    ],
    index: {
      id: '__proto__',
      groups: [{
        id: 'index-group',
        entries: [{
          id: 'index-entry',
          term: [{ text: '术语' }],
          targets: ['章节/🔥', 'missing-index-target'],
          seeAlso: ['index-entry', 'missing-see-also'],
        }],
      }],
    },
    unsupportedContent: [{ nodeId: '__proto__', path: 'index', nodeType: 'futureNode', reason: '保留诊断' }],
    unmappedFootnotes: [{ container: 'paragraph-1', nodeId: 'paragraph-1', content: [{ text: '未映射脚注' }] }],
  }
}

describe('external ID mapping', () => {
  it('encodes the namespace and external ID as an unambiguous Unicode-safe pair', () => {
    const pairs: Array<[string, string]> = [
      ['a:b', 'c'],
      ['a', 'b:c'],
      ['', 'x:y'],
      ['x:', 'y'],
      ['__proto__', '🔥'],
      ['é', 'é'],
      ['e\u0301', 'e\u0301'],
      ['\uD800', ''],
    ]
    const mapped = pairs.map(([namespace, externalId]) => externalIdToNodeId(externalId, namespace))

    expect(externalIdToNodeId('c', 'a:b')).toBe(mapped[0])
    expect(new Set(mapped).size).toBe(pairs.length)
    expect(externalIdToNodeId('__proto__')).not.toBe(externalIdToNodeId('constructor'))
    expect(externalIdToNodeId('same', 'ns-a')).not.toBe(externalIdToNodeId('same', 'ns-b'))
  })

  it('remaps every typed definition and reference, reports duplicates and dangling targets, and leaves input untouched', () => {
    const source = fullIrTree()
    const before = structuredClone(source)
    const { doc, idMap, problems } = remapExternalIds(source, 'import:测试')
    const originalDefinitions = definitionIds(source)
    const remappedDefinitions = definitionIds(doc)
    const mapped = (externalId: string): string => idMap[externalId]!
    const chapterId = source.body[0]!.id
    const clause = doc.body[0]!.children[0] as IRClause
    const paragraph = clause.children[0] as IRParagraph
    const figure = clause.children[1]
    const missingResourceFigure = clause.children[2]
    const formula = clause.children.find(child => child.kind === 'formula')
    const table = clause.children.find(child => child.kind === 'table')
    const term = clause.children.find(child => child.kind === 'termEntry') as IRTermEntry
    const duplicateFormulaNote = formula
    const indexEntry = doc.index!.groups[0]!.entries[0]!

    expect(doc).not.toBe(source)
    expect(source).toEqual(before)
    expect(remappedDefinitions).toEqual(originalDefinitions.map(externalId => externalId ? mapped(externalId) : ''))
    expect(doc.body[0]!.id).toBe(mapped(chapterId))
    expect(doc.appendices[0]!.id).toBe('')
    expect(Object.prototype.hasOwnProperty.call(idMap, '')).toBe(false)
    expect(paragraph.content[0]!.marks?.[0]).toEqual({ type: 'crossRef', targetId: mapped(chapterId) })
    expect(paragraph.content[1]!.marks?.map(mark => mark.type === 'bibRef' || mark.type === 'termRef' ? mark.targetId : ''))
      .toEqual([mapped('bib-entry'), mapped('duplicate-definition')])
    expect(paragraph.content[2]!.marks?.filter(mark => mark.type === 'crossRef')
      .map(mark => mark.type === 'crossRef' ? mark.targetId : '')).toEqual(['', 'missing-target'])
    expect(paragraph.content[3]!.formula?.id).toBe(mapped('inline-formula'))
    expect(paragraph.content[4]!.footnote?.id).toBe(mapped('inline-footnote'))
    expect(paragraph.content[5]!.marks?.find(mark => mark.type === 'tableFootnoteRef'))
      .toMatchObject({ targetId: mapped('table-footnote'), id: mapped('table-footnote-ref') })
    expect(figure.kind === 'figure' && figure.resourceId).toBe(mapped('resource-a'))
    expect(figure.kind === 'figure' && figure.groups?.[0]?.resourceRefs).toEqual([mapped('resource-b'), 'missing-resource-group'])
    expect(missingResourceFigure.kind === 'figure' && missingResourceFigure.resourceId).toBe('missing-resource')
    expect(formula.kind === 'formula' && formula.whereList[0]?.id).toBe(mapped('formula-where'))
    expect(table.kind === 'table' && table.footnotes?.[0]?.id).toBe(mapped('table-footnote'))
    expect(term.languageSets?.[0]?.groups[0]?.terms[0]?.descriptors[0]?.id).toBe(mapped('tbx-descriptor'))
    expect(term.id).toBe(mapped('duplicate-definition'))
    expect(duplicateFormulaNote.kind === 'formula' && duplicateFormulaNote.notes?.[0]?.id).toBe(mapped('duplicate-definition'))
    expect(doc.bibliography[0]?.fields?.[0]?.id).toBe(mapped('bib-field'))
    expect(doc.resources?.map(resource => resource.id)).toEqual([mapped('resource-a'), mapped('resource-b')])
    expect(indexEntry.targets).toEqual([mapped(chapterId), 'missing-index-target'])
    expect(indexEntry.seeAlso).toEqual([mapped('index-entry'), 'missing-see-also'])
    expect(doc.unsupportedContent?.[0]?.nodeId).toBe(mapped('__proto__'))
    expect(doc.unmappedFootnotes?.[0]?.nodeId).toBe(mapped('paragraph-1'))

    expect(Object.prototype.hasOwnProperty.call(idMap, '__proto__')).toBe(true)
    expect(idMap['__proto__']).toBe(externalIdToNodeId('__proto__', 'import:测试'))
    expect(Object.prototype.hasOwnProperty.call(idMap, 'constructor')).toBe(true)
    expect(idMap.constructor).toBe(externalIdToNodeId('constructor', 'import:测试'))
    expect(Object.getPrototypeOf(idMap)).toBe(Object.prototype)
    expect(problems.filter(problem => problem.code === 'duplicate-id')).toHaveLength(1)
    expect(problems.find(problem => problem.code === 'duplicate-id')?.nodeId).toBe(mapped('duplicate-definition'))
    expect(problems.filter(problem => problem.code === 'missing-id')).toHaveLength(1)
    expect(problems.find(problem => problem.code === 'missing-id')?.nodeId).toBeNull()
    expect(problems.filter(problem => problem.code === 'dangling-typed-ref')).toHaveLength(2)
    expect(problems.filter(problem => problem.code === 'dangling-index-target')).toHaveLength(2)
    expect(problems.filter(problem => problem.code === 'dangling-resource')).toHaveLength(2)
    expect(problems.every(problem => problem.severity === 'error')).toBe(true)
  })
})
