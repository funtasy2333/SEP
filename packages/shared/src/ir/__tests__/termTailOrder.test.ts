import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems } from '../../renderers/outputBoundary'
import { hasSemanticExtensions } from '../extensions'
import { irToPm, IRToPmError } from '../irToPm'
import { resolve } from '../resolve'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import type { IRDoc, IRInline, IRTermEntry, IRTermTailOrderItem } from '../types'
import * as fx from './fixtures'

const paragraph = (id: string, content: IRInline[] = [{ text: id }]) => ({ kind: 'paragraph' as const, id, content })
const reference = (id: string): IRInline[] => [{ text: `引用${id}`, marks: [{ type: 'bibRef', targetId: id }] }]

function extendedTerm(): IRTermEntry {
  return {
    kind: 'termEntry', id: 'term-main', term: [{ text: '术语' }],
    definition: [paragraph('definition-main'), paragraph('definition-continuation')],
    source: [{ text: '来源' }],
    notes: [{ kind: 'note', id: 'term-note', content: [paragraph('term-note.p0')] }],
    examples: [{ kind: 'example', id: 'term-example', content: [paragraph('term-example.p0')] }],
    nestedEntries: [{
      kind: 'termEntry', id: 'term-nested', term: [{ text: '子术语' }],
      definition: [paragraph('term-nested.definition')], notes: [], examples: [],
    }],
    languageSets: [{
      id: 'lang-fr', language: 'fr', groups: [{
        id: 'tig-fr', terms: [{ id: 'variant-fr', content: [{ text: 'terme' }], descriptors: [] }],
      }],
    }],
  }
}

function docWithTerm(term: IRTermEntry): IRDoc {
  return {
    schemaVersion: 1, meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'terms', secType: 'terms', title: [], children: [term] }],
    appendices: [], bibliography: [],
  }
}

const completeOrder: IRTermTailOrderItem[] = [
  { kind: 'definition', index: 0 }, { kind: 'source', index: 0 },
  { kind: 'note', index: 0 }, { kind: 'example', index: 0 },
  { kind: 'nestedEntry', index: 0 }, { kind: 'languageSet', index: 0 },
]

const invalidOrders: Array<{ name: string; order: unknown }> = [
  { name: 'duplicate category/index', order: [...completeOrder, { kind: 'note', index: 0 }] },
  { name: 'missing item', order: completeOrder.slice(0, -1) },
  { name: 'out-of-range index', order: completeOrder.map(item => item.kind === 'languageSet' ? { ...item, index: 1 } : item) },
  { name: 'unknown kind', order: completeOrder.map((item, index) => index === 0 ? { kind: 'unknown', index: 0 } : item) },
  { name: 'extra own key', order: completeOrder.map((item, index) => index === 0 ? { ...item, extra: true } : item) },
  { name: 'null', order: null },
  { name: 'non-array', order: { kind: 'note', index: 0 } },
  { name: 'sparse array', order: new Array(completeOrder.length) },
]

describe('术语尾项显式顺序校验', () => {
  it.each(invalidOrders)('returns precise consumer diagnostics for $name', ({ order }) => {
    const term = extendedTerm()
    Object.assign(term, { tailOrder: order })
    const doc = docWithTerm(term)

    let caught: unknown
    try { irToPm(doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    expect((caught as IRToPmError).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'body[0][0].tailOrder', reason: expect.any(String) }),
    ]))
    expect(resolve(doc).problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsupported-content', nodeId: 'term-main', severity: 'error' }),
    ]))
    for (const format of ['DOCX', 'HTML', 'XML'] as const) {
      expect(getOutputSupportProblems(doc, format)).toContainEqual(expect.objectContaining({
        code: 'unsupported-output', nodeId: 'term-main', path: 'doc.body[0].children[0].tailOrder',
      }))
    }
  })

  it('counts tailOrder as a semantic extension', () => {
    expect(hasSemanticExtensions({ tailOrder: [{ kind: 'note', index: 0 }] })).toBe(true)
  })

  it('keeps explicit consumer-canonical order out of tailOrder diagnostics where fixed output preserves it', () => {
    const term = extendedTerm()
    term.tailOrder = [
      { kind: 'definition', index: 0 }, { kind: 'example', index: 0 }, { kind: 'note', index: 0 },
      { kind: 'source', index: 0 }, { kind: 'nestedEntry', index: 0 }, { kind: 'languageSet', index: 0 },
    ]
    const doc = docWithTerm(term)
    const docxProblems = getOutputSupportProblems(doc, 'DOCX')
    const htmlProblems = getOutputSupportProblems(doc, 'HTML')
    const xmlProblems = getOutputSupportProblems(doc, 'XML')
    expect(docxProblems.some(problem => problem.path.endsWith('.tailOrder'))).toBe(false)
    expect(htmlProblems).toContainEqual(expect.objectContaining({ nodeId: 'term-main', path: 'doc.body[0].children[0].tailOrder' }))
    expect(xmlProblems.some(problem => problem.path.endsWith('.tailOrder'))).toBe(false)
  })

  it('preserves legacy Resolver example→note→source citation labels for extended native IR without metadata', () => {
    const term: IRTermEntry = {
      kind: 'termEntry', id: 'legacy-extended-term', term: [{ text: '术语' }],
      definition: [paragraph('legacy-definition')],
      examples: [{ kind: 'example', id: 'legacy-example', content: [paragraph('legacy-example.p0', reference('bib-example'))] }],
      notes: [{ kind: 'note', id: 'legacy-note', content: [paragraph('legacy-note.p0', reference('bib-note'))] }],
      source: reference('bib-source'),
      nestedEntries: [{
        kind: 'termEntry', id: 'legacy-nested', term: [{ text: '子术语' }],
        definition: [paragraph('legacy-nested.definition', reference('bib-nested'))], notes: [], examples: [],
      }],
    }
    const doc = docWithTerm(term)
    doc.bibliography = ['bib-example', 'bib-note', 'bib-source', 'bib-nested'].map(id => ({
      kind: 'bibEntry' as const, id, content: [{ text: `文献${id}` }],
    }))
    const before = JSON.stringify(doc)
    const resolved = resolve(doc)
    expect(resolved.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(resolved.bibliographyOrder).toEqual(['bib-example', 'bib-note', 'bib-source', 'bib-nested'])
    expect(resolved.bibliographyOrder.map(id => [id, resolved.labels[id]?.label]))
      .toEqual(resolved.bibliographyOrder.map((id, index) => [id, `[${index + 1}]`]))
    expect(term.tailOrder).toBeUndefined()
    expect(JSON.stringify(doc)).toBe(before)
  })
})

function bibRefText(id: string): PMJsonNode {
  return { type: 'text', text: '引用-' + id, marks: [{ type: 'bibRef', attrs: { targetId: id } }] }
}

function pmSource(id: string): PMJsonNode {
  return { type: 'termSource', content: [bibRefText(id)] }
}

function pmNote(id: string): PMJsonNode {
  return { type: 'note', attrs: { nodeId: 'note-' + id }, content: [bibRefText(id)] }
}

function pmExample(id: string): PMJsonNode {
  return { type: 'example', attrs: { nodeId: 'example-' + id }, content: [bibRefText(id)] }
}

function pmTermWithNested(tail: PMJsonNode[], referenceIds: string[]): PMJsonNode {
  const bibliographyEntries: [string, string][] = referenceIds.map(id => [id, '文献-' + id])
  const term = fx.termDef('pm-tail-term', '术语', {
    definition: '定义',
    extra: [...tail, fx.termDef('pm-tail-nested', '子术语', { definition: '子定义' })],
  })
  return fx.standardDoc(
    {},
    fx.chapter('pm-tail-chapter', '术语和定义', term),
    fx.bibliography(...bibliographyEntries),
  )
}

const resolverDifferencePairs: Array<{
  name: string
  tail: PMJsonNode[]
  order: IRTermTailOrderItem[]
  referenceIds: string[]
}> = [
  {
    name: 'source→note',
    tail: [pmSource('bib-source-note-source'), pmNote('bib-source-note-note')],
    order: [{ kind: 'source', index: 0 }, { kind: 'note', index: 0 }],
    referenceIds: ['bib-source-note-source', 'bib-source-note-note'],
  },
  {
    name: 'note→example',
    tail: [pmNote('bib-note-example-note'), pmExample('bib-note-example-example')],
    order: [{ kind: 'note', index: 0 }, { kind: 'example', index: 0 }],
    referenceIds: ['bib-note-example-note', 'bib-note-example-example'],
  },
  {
    name: 'source→example',
    tail: [pmSource('bib-source-example-source'), pmExample('bib-source-example-example')],
    order: [{ kind: 'source', index: 0 }, { kind: 'example', index: 0 }],
    referenceIds: ['bib-source-example-source', 'bib-source-example-example'],
  },
]

const singleResolverCategories: Array<{ name: string; tail: PMJsonNode[]; referenceId: string }> = [
  { name: 'source', tail: [pmSource('bib-single-source')], referenceId: 'bib-single-source' },
  { name: 'note', tail: [pmNote('bib-single-note')], referenceId: 'bib-single-note' },
  { name: 'example', tail: [pmExample('bib-single-example')], referenceId: 'bib-single-example' },
]

describe('PM→IR canonical tail metadata for Resolver', () => {
  it.each(resolverDifferencePairs)('retains authored $name order for citations with nested entries', ({ tail, order, referenceIds }) => {
    const { doc } = pmToIr(pmTermWithNested(tail, referenceIds))
    const term = doc.body[0]?.children[0]
    if (!term || term.kind !== 'termEntry') throw new Error('Expected a term entry')

    expect(term.tailOrder).toEqual([...order, { kind: 'nestedEntry', index: 0 }])
    const resolved = resolve(doc)
    expect(resolved.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(resolved.bibliographyOrder).toEqual(referenceIds)
    expect(resolved.bibliographyOrder.map(id => [id, resolved.labels[id]?.label]))
      .toEqual(referenceIds.map((id, index) => [id, '[' + (index + 1) + ']']))
  })

  it.each(singleResolverCategories)('does not add tailOrder when only $name is present beside a nested entry', ({ tail, referenceId }) => {
    const { doc } = pmToIr(pmTermWithNested(tail, [referenceId]))
    const term = doc.body[0]?.children[0]
    if (!term || term.kind !== 'termEntry') throw new Error('Expected a term entry')

    expect(term.tailOrder).toBeUndefined()
    expect(resolve(doc).bibliographyOrder).toEqual([referenceId])
  })
})
