import { expect, it } from 'vitest'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr } from '../pmToIr'
import type { IRDoc, IRInline, IRTable } from '../types'

function baseDoc(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '正文' }],
      children: [{ kind: 'paragraph', id: 'body-paragraph', content: [{ text: '正文' }] }],
    }],
    appendices: [],
    bibliography: [],
  }
}

function inlineFootnoteDoc(content: IRInline[]): IRDoc {
  const doc = baseDoc()
  doc.body[0]!.children[0] = {
    kind: 'paragraph', id: 'body-paragraph',
    content: [{ text: '脚注宿主', footnote: { id: 'inline-footnote', content } }],
  }
  return doc
}

function tableFootnoteDoc(content: IRInline[]): IRDoc {
  const doc = baseDoc()
  const table: IRTable = {
    kind: 'table', id: 'table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [],
    rows: [{ id: 'row', cells: [{
      id: 'cell', colspan: 1, rowspan: 1, header: false,
      content: [{ kind: 'paragraph', id: 'cell-paragraph', content: [{ text: '数据' }] }],
    }] }],
    footnotes: [{ id: 'table-footnote', content }],
  }
  doc.body[0]!.children = [table]
  return doc
}

function errorFor(doc: IRDoc): IRToPmError {
  let thrown: unknown
  try {
    irToPm(doc)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(IRToPmError)
  return thrown as IRToPmError
}

const unsupportedContent: { name: string; content: IRInline[]; pathSuffix?: string }[] = [
  { name: 'strike', content: [{ text: 'x', marks: [{ type: 'strike' }] }] },
  { name: 'code', content: [{ text: 'x', marks: [{ type: 'code' }] }] },
  { name: 'variable', content: [{ text: 'x', marks: [{ type: 'variable', name: 'n' }] }] },
  { name: 'externalLink', content: [{ text: 'x', marks: [{ type: 'externalLink', href: 'https://example.test' }] }] },
  { name: 'bibRef', content: [{ text: 'x', marks: [{ type: 'bibRef', targetId: 'bib' }] }] },
  { name: 'termRef', content: [{ text: 'x', marks: [{ type: 'termRef', targetId: 'term' }] }] },
  { name: 'tableFootnoteRef', content: [{ text: 'x', marks: [{ type: 'tableFootnoteRef', targetId: 'table-note' }] }] },
  { name: 'text style', content: [{ text: 'x', style: { color: '#123456' } }] },
  { name: 'formula atom', content: [{ text: '', formula: { id: 'formula-inline', latex: 'x' } }] },
  { name: 'marked newline', content: [{ text: 'before\nafter', marks: [{ type: 'bold' }] }] },
  { name: 'empty text with bold mark', content: [{ text: '', marks: [{ type: 'bold' }] }], pathSuffix: '[0].marks[0]' },
  { name: 'empty text with style', content: [{ text: '', style: { fontSize: '12pt' } }], pathSuffix: '[0].style' },
]

it('accepts only the canonical inline footnote payloads that pmToIr can reread', () => {
  const content: IRInline[] = [
    { text: 'plain' },
    { text: 'bold', marks: [{ type: 'bold' }] },
    { text: 'italic', marks: [{ type: 'italic' }] },
    { text: 'underline', marks: [{ type: 'underline' }] },
    { text: 'sub', marks: [{ type: 'sub' }] },
    { text: 'sup', marks: [{ type: 'sup' }] },
    { text: 'reference', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] },
    { text: 'plain\nnewline' },
    { text: '' },
  ]
  const docs = [inlineFootnoteDoc(content), tableFootnoteDoc(content)]

  for (const source of docs) {
    const before = JSON.stringify(source)
    const reopened = pmToIr(irToPm(source)).doc
    expect((reopened.unmappedFootnotes ?? []).filter(item => item.container === 'unsupportedFootnotePayload')).toEqual([])
    expect(JSON.stringify(source)).toBe(before)
  }
})

it.each(unsupportedContent)('rejects non-canonical inline footnote payload: $name', ({ content, pathSuffix = '' }) => {
  const doc = inlineFootnoteDoc(content)
  const before = JSON.stringify(doc)
  const error = errorFor(doc)

  expect(error.diagnostics).toContainEqual(expect.objectContaining({
    path: `doc.body[0].children[0].content[0].footnote.content${pathSuffix}`,
    nodeId: 'inline-footnote',
    reason: expect.any(String),
  }))
  expect(JSON.stringify(doc)).toBe(before)
})

it.each(unsupportedContent)('rejects non-canonical table footnote payload: $name', ({ content, pathSuffix = '' }) => {
  const doc = tableFootnoteDoc(content)
  const before = JSON.stringify(doc)
  const error = errorFor(doc)

  expect(error.diagnostics).toContainEqual(expect.objectContaining({
    path: `doc.body[0].children[0].footnotes[0].content${pathSuffix}`,
    nodeId: 'table-footnote',
    reason: expect.any(String),
  }))
  expect(JSON.stringify(doc)).toBe(before)
})

it.each([
  ['meta', 'doc.meta.titleParts[0].content[0].footnote.content'],
  ['front matter', 'doc.front.foreword[0].content[0].footnote.content'],
  ['appendix', 'doc.appendices[0].children[0].content[0].footnote.content'],
] as const)('reports the source path and owner ID for a footnote in %s', (_location, expectedPath) => {
  const invalid: IRInline[] = [{ text: 'line1\nline2', marks: [{ type: 'bold' }] }]
  const doc = baseDoc()
  const run = { text: 'host', footnote: { id: `${_location}-footnote`, content: invalid } }
  if (_location === 'meta') doc.meta.titleParts = [{ id: 'title-part', content: [run] }]
  else if (_location === 'front matter') doc.front.foreword = [{ kind: 'paragraph', id: 'front-p', content: [run] }]
  else doc.appendices = [{ kind: 'appendix', id: 'appendix', normative: false, title: [{ text: '附录' }], children: [{ kind: 'paragraph', id: 'appendix-p', content: [run] }] }]

  const error = errorFor(doc)
  expect(error.diagnostics).toContainEqual(expect.objectContaining({
    path: expectedPath,
    nodeId: `${_location}-footnote`,
  }))
})

it('retains the existing precise diagnostic for an empty-text crossRef inside an inline footnote', () => {
  const doc = inlineFootnoteDoc([{ text: '', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] }])
  const error = errorFor(doc)

  expect(error.diagnostics).toContainEqual(expect.objectContaining({
    path: 'doc.body[0].children[0].content[0].footnote.content[0].marks[0]',
    nodeId: 'inline-footnote',
  }))
})

it.each([
  ['inline footnote', inlineFootnoteDoc([{ text: 'before\nafter', marks: [{ type: 'bold' }] }]), 'inline-footnote', 'doc.body[0].children[0].content[0].footnote.content'],
  ['table footnote', tableFootnoteDoc([{ text: 'before\nafter', marks: [{ type: 'bold' }] }]), 'table-footnote', 'doc.body[0].children[0].footnotes[0].content'],
] as const)('rejects the reproduced marked-newline mismatch for a $0', (_location, doc, id, path) => {
  const error = errorFor(doc)
  expect(error.diagnostics).toContainEqual(expect.objectContaining({
    path,
    nodeId: id,
    reason: expect.stringContaining('换行格式标记'),
  }))
})
