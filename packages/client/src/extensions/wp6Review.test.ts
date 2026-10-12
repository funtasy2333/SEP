// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { irToPm, pmToIr, resolve, type IRDoc, type IRFormula, type IRTable, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())
const doc = (): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' },
  front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'ch', secType: 'general', title: [{ text: '正文' }], children: [] }],
  appendices: [], bibliography: [],
})
function reopen(authored: IRDoc): IRDoc {
  const loaded = schema.nodeFromJSON(irToPm(authored))
  loaded.check()
  return pmToIr(loaded.toJSON() as PMJsonNode).doc
}

describe('Codex review: native IR through production schema', () => {
  it.each(['scope', 'norm-refs', 'terms', 'general'] as const)('preserves explicit chapter type %s with a noncanonical title', secType => {
    const authored = doc()
    authored.body[0].secType = secType
    authored.body[0].title = [{ text: secType === 'general' ? '术语和定义' : 'Localized section title' }]
    expect(reopen(authored).body[0].secType).toBe(secType)
  })
  it('retains unnumbered formulas without shifting subsequent Resolver labels', () => {
    const authored = doc()
    authored.body[0].children = [
      { kind: 'formula', id: 'unnumbered', numbered: false, latex: 'x = 1', whereList: [] },
      { kind: 'formula', id: 'numbered', numbered: true, latex: 'y = 2', whereList: [] },
    ]
    const reopened = reopen(authored)
    expect((reopened.body[0].children[0] as IRFormula).numbered).toBe(false)
    expect(resolve(reopened).labels).toEqual(resolve(authored).labels)
  })
  it.each([0, 1, 2])('keeps an explicit header count %s independent of cell types', count => {
    const authored = doc()
    const table: IRTable = {
      kind: 'table', id: 'table', caption: [{ text: '数据表' }], orientation: 'portrait', headerRowCount: count, notes: [],
      rows: [true, false].map((header, i) => ({ id: `row-${i}`, cells: [{
        id: `cell-${i}`, header, colspan: 1, rowspan: 1,
        content: [{ kind: 'paragraph', id: `cell-p-${i}`, content: [{ text: '值' }] }],
      }] })),
    }
    authored.body[0].children = [table]
    const reopened = reopen(authored).body[0].children[0] as IRTable
    expect(reopened.headerRowCount).toBe(count)
    expect(reopened.rows).toEqual(table.rows)
  })
  it('accepts canonical targetId cross-references in footnotes after a schema roundtrip', () => {
    const authored = doc()
    authored.body[0].children = [
      { kind: 'paragraph', id: 'target', content: [{ text: '目标段落' }] },
      { kind: 'paragraph', id: 'source', content: [{ text: '', footnote: {
        id: 'fn', content: [{ text: '见目标', marks: [{ type: 'crossRef', targetId: 'target', targetKind: 'paragraph' }] }],
      } }] },
    ]
    const reopened = reopen(authored)
    expect(reopened.body[0].children).toEqual(authored.body[0].children)
    expect(reopened.unsupportedContent).toBeUndefined()
    expect(resolve(reopened).problems.filter(p => p.severity === 'error')).toEqual([])
  })
})

it('keeps legacy title/header inference and formula numbering defaults when attributes are absent', () => {
  const legacy: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'legacy-ch' }, content: [
    { type: 'chapterTitle', content: [{ type: 'text', text: '术语和定义' }] },
    { type: 'formula', attrs: { nodeId: 'legacy-f' }, content: [{ type: 'formulaContent', content: [{ type: 'text', text: 'x' }] }] },
    { type: 'stdTable', attrs: { nodeId: 'legacy-t' }, content: [
      { type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph' }] }] }] },
    ] },
  ] }] }
  const loaded = schema.nodeFromJSON(legacy)
  loaded.check()
  const reopened = pmToIr(loaded.toJSON() as PMJsonNode).doc
  expect(reopened.body[0].secType).toBe('terms')
  expect((reopened.body[0].children[0] as IRFormula).numbered).toBe(true)
  expect((reopened.body[0].children[1] as IRTable).headerRowCount).toBe(1)
})

it.each(['bad-role', 42])('reports invalid explicit chapter roles instead of silently accepting %s', secType => {
  const loaded = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'ch', secType }, content: [{ type: 'chapterTitle' }] }] })
  expect(pmToIr(loaded.toJSON() as PMJsonNode).doc.unsupportedContent).toContainEqual(expect.objectContaining({ nodeId: 'ch', reason: expect.stringContaining('secType') }))
})

it.each([-1, 1.5, 2, '1'])('reports invalid explicit header counts %s', headerRowCount => {
  const loaded = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'ch' }, content: [
    { type: 'chapterTitle' }, { type: 'stdTable', attrs: { nodeId: 'table', headerRowCount }, content: [
      { type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
    ] },
  ] }] })
  expect(pmToIr(loaded.toJSON() as PMJsonNode).doc.unsupportedContent).toContainEqual(expect.objectContaining({ nodeId: 'table', reason: expect.stringContaining('headerRowCount') }))
})

it.each(['dash', 'number', 'alpha', 'dot', 'boxed'] as const)('keeps supported %s list paragraphs addressable through the production schema', listType => {
  const authored = doc()
  authored.body[0].children = [
    { kind: 'list', id: 'list', listType, ...(listType === 'number' || listType === 'dot' ? { level: 2 as const } : {}), items: [{
      id: 'item', content: [{ kind: 'paragraph', id: 'item.p0', content: [{ text: '列项' }] }],
    }] },
    { kind: 'paragraph', id: 'ref', content: [{ text: '见列项', marks: [{ type: 'crossRef', targetId: 'item.p0', targetKind: 'paragraph' }] }] },
  ]
  const reopened = reopen(authored)
  expect(reopened.body[0].children).toEqual(authored.body[0].children)
  expect(resolve(reopened).problems.filter(p => p.severity === 'error')).toEqual([])
})
