// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  getOutputSupportProblems,
  irToPm,
  pmToIr,
  renderDocx,
  renderHtml,
  resolve,
  type IRDoc,
  type IRInline,
  type IRParagraph,
  type IRTable,
  type PMJsonNode,
  type SemanticJsonNode,
} from '@ses/shared'
import { expect, it } from 'vitest'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())

function canonicalPayload(): IRInline[] {
  return [
    { text: '粗体', marks: [{ type: 'bold' }] },
    { text: '斜体', marks: [{ type: 'italic' }] },
    { text: '下划线', marks: [{ type: 'underline' }] },
    { text: '下标', marks: [{ type: 'sub' }] },
    { text: '上标', marks: [{ type: 'sup' }] },
    { text: '\n' },
    { text: '章节引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] },
  ]
}

function sourceDoc(): IRDoc {
  const bodyFootnoteContent = canonicalPayload()
  const tableFootnoteContent = [
    { text: '表脚注粗体', marks: [{ type: 'bold' }] },
    { text: '\n' },
    { text: '表脚注章节引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] },
  ] satisfies IRInline[]
  const table: IRTable = {
    kind: 'table', id: 'table', caption: [{ text: '含表脚注的表' }], orientation: 'portrait', headerRowCount: 0,
    rows: [{ id: 'row', cells: [{
      id: 'cell', colspan: 1, rowspan: 1, header: false,
      content: [{ kind: 'paragraph', id: 'cell-paragraph', content: [{
        text: '表格引用', marks: [{ type: 'tableFootnoteRef', id: 'table-footnote-call', targetId: 'table-footnote' }],
      }] }],
    }] }],
    notes: [],
    footnotes: [{ id: 'table-footnote', content: tableFootnoteContent }],
  }

  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: '规范脚注负载' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '正文' }],
      children: [
        { kind: 'paragraph', id: 'body-paragraph', content: [{
          text: '正文脚注引用', footnote: { id: 'inline-footnote', content: bodyFootnoteContent },
        }] },
        table,
      ],
    }],
    appendices: [],
    bibliography: [],
  }
}

type Payload = { kind: 'inline' | 'table'; id: string; content: PMJsonNode[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function collectPayloads(value: unknown, found: Payload[] = []): Payload[] {
  if (Array.isArray(value)) {
    value.forEach(child => collectPayloads(child, found))
    return found
  }
  if (!isRecord(value)) return found

  if (value.type === 'footnoteRef' && isRecord(value.attrs)) {
    const id = value.attrs.nodeId
    const content = value.attrs.content
    if (typeof id === 'string' && Array.isArray(content)) found.push({ kind: 'inline', id, content: content as PMJsonNode[] })
  } else if (value.type === 'tableFootnoteEntry' && Array.isArray(value.content)) {
    const id = isRecord(value.attrs) ? value.attrs.nodeId : undefined
    if (typeof id === 'string') found.push({ kind: 'table', id, content: value.content as PMJsonNode[] })
  }

  Object.values(value).forEach(child => collectPayloads(child, found))
  return found
}

function inlineSignature(inlines: IRInline[]): { text: string; marks: unknown[]; style?: unknown }[] {
  const pieces: { text: string; marks: unknown[]; style?: unknown }[] = []
  for (const run of inlines) {
    if (!run.text) continue
    const marks = (run.marks ?? []).map(mark => mark.type === 'crossRef'
      ? { type: mark.type, targetId: mark.targetId, targetKind: mark.targetKind }
      : { type: mark.type })
    for (const character of run.text) {
      const last = pieces.at(-1)
      if (last && JSON.stringify(last.marks) === JSON.stringify(marks) && JSON.stringify(last.style) === JSON.stringify(run.style)) {
        last.text += character
      } else {
        pieces.push({ text: character, marks, ...(run.style ? { style: { ...run.style } } : {}) })
      }
    }
  }
  return pieces
}

function reopenedDoc(json: PMJsonNode | SemanticJsonNode) {
  const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(json)))
  reopened.check()
  return pmToIr(reopened.toJSON() as PMJsonNode).doc
}

function expectCanonicalPayloads(doc: IRDoc, expected: IRDoc): void {
  const paragraph = doc.body[0]!.children[0] as IRParagraph
  const expectedParagraph = expected.body[0]!.children[0] as IRParagraph
  const actualInline = paragraph.content.find(run => run.footnote)!.footnote!
  const expectedInline = expectedParagraph.content.find(run => run.footnote)!.footnote!
  expect(inlineSignature(actualInline.content)).toEqual(inlineSignature(expectedInline.content))

  const table = doc.body[0]!.children[1] as IRTable
  const expectedTable = expected.body[0]!.children[1] as IRTable
  expect(inlineSignature(table.footnotes![0]!.content)).toEqual(inlineSignature(expectedTable.footnotes![0]!.content))
}

it('round-trips canonical inline and table footnotes through production schema, both JSON exports, HTML and DOCX', () => {
  const ir = sourceDoc()
  const sourceBefore = JSON.stringify(ir)
  const expected = structuredClone(ir)
  const projected = irToPm(ir)
  const loaded = schema.nodeFromJSON(projected)
  loaded.check()

  const raw = loaded.toJSON() as PMJsonNode
  const semantic = exportSemanticJson(loaded as PMNode)
  const rawReturned = reopenedDoc(raw)
  const semanticReturned = reopenedDoc(semantic)
  for (const returned of [rawReturned, semanticReturned]) {
    expect((returned.unmappedFootnotes ?? []).filter(item => item.container === 'unsupportedFootnotePayload')).toEqual([])
    expectCanonicalPayloads(returned, expected)
  }

  const rawPayloads = collectPayloads(raw).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
  const semanticPayloads = collectPayloads(semantic).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
  const expectedPayloadIds = [
    'inline:inline-footnote', 'table:table-footnote',
  ]
  expect(rawPayloads.map(({ kind, id }) => `${kind}:${id}`)).toEqual(expectedPayloadIds)
  expect(semanticPayloads.map(({ kind, id }) => `${kind}:${id}`)).toEqual(expectedPayloadIds)
  expect(rawPayloads.every(payload => payload.content.length > 0)).toBe(true)
  expect(semanticPayloads.every(payload => payload.content.length > 0)).toBe(true)

  const { labels, problems } = resolve(rawReturned)
  expect(problems.filter(problem => problem.code.endsWith('footnote'))).toEqual([])
  expect(getOutputSupportProblems(rawReturned, 'HTML')).toEqual([])
  expect(getOutputSupportProblems(rawReturned, 'DOCX')).toEqual([])
  const html = renderHtml(rawReturned, labels, { variant: 'print' })
  expect(html).toContain('粗体')
  expect(html).toContain(labels.chapter!.refText)
  expect(html).toContain('表脚注粗体')

  const docx = renderDocx(rawReturned, labels, {
    images: {}, formulaOmml: {}, stage: 'working_draft', createdAt: '2026-10-08T00:00:00.000Z',
  }).parts
  expect(docx['word/footnotes.xml']).toContain('粗体')
  expect(docx['word/footnotes.xml']).toContain(labels.chapter!.refText)
  expect(docx['word/document.xml']).toContain('表脚注粗体')
  expect(JSON.stringify(ir)).toBe(sourceBefore)
})

it('keeps an unsupported existing PM footnote available to raw and semantic JSON correction flows', () => {
  const original = schema.nodeFromJSON({
    type: 'doc',
    content: [{
      type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '正文' }] },
        { type: 'stdParagraph', content: [
          { type: 'text', text: '引用' },
          { type: 'footnoteRef', attrs: { nodeId: 'legacy-footnote', content: [
            { type: 'text', text: '保留原格式', marks: [{ type: 'strike' }] },
          ] } },
        ] },
      ],
    }],
  })
  original.check()

  const raw = original.toJSON() as PMJsonNode
  const semantic = exportSemanticJson(original as PMNode)
  const rawPayload = collectPayloads(raw).find(payload => payload.id === 'legacy-footnote')!
  const semanticPayload = collectPayloads(semantic).find(payload => payload.id === 'legacy-footnote')!
  expect(rawPayload.content).toEqual(semanticPayload.content)
  expect(rawPayload.content).toContainEqual(expect.objectContaining({
    type: 'text', text: '保留原格式', marks: [{ type: 'strike' }],
  }))

  for (const json of [raw, semantic]) {
    const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(json)))
    reopened.check()
    const converted = pmToIr(reopened.toJSON() as PMJsonNode)
    expect(converted.doc.unmappedFootnotes).toContainEqual(expect.objectContaining({
      container: 'unsupportedFootnotePayload', nodeId: 'legacy-footnote', reason: '格式「strike」',
    }))
  }
})
