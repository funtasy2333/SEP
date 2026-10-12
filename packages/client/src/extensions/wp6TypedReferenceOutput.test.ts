// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import {
  UnsupportedOutputError,
  irToPm,
  pmToIr,
  resolve,
  type IRDoc,
  type IRMark,
  type PMJsonNode,
} from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { exportSemanticHtml } from '../serializer/htmlExporter'
import { buildPdfExportRequest } from '../serializer/pdfExporter'
import { buildDocxBlob } from '../serializer/docxExporter'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { serializeToXml } from '../serializer/xmlSerializer'

function authoredDocument(mark: IRMark): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: '错类型引用边界' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'scope', title: [{ text: '范围' }],
      children: [{ kind: 'paragraph', id: 'reference-owner', content: [{ text: '引用目标', marks: [mark] }] }],
    }],
    appendices: [],
    bibliography: [],
  }
}

function productionPmDoc(authored: IRDoc) {
  const schema = getSchema(createEditorExtensions())
  const doc = schema.nodeFromJSON(irToPm(authored))
  doc.check()
  return doc
}

const wrongFigureRef: Extract<IRMark, { type: 'crossRef' }> = {
  type: 'crossRef', targetId: 'chapter', targetKind: 'figure',
}

describe('typed-reference non-JSON export boundary through production adapters', () => {
  it('blocks actual HTML, DOCX, PDF request and legacy XML paths while retaining the Resolver owner/message', async () => {
    const pmDoc = productionPmDoc(authoredDocument(wrongFigureRef))
    const sourceBefore = JSON.stringify(pmDoc.toJSON())
    const { doc: irDoc } = pmToIr(pmDoc.toJSON() as PMJsonNode)
    const resolverProblem = resolve(irDoc).problems.find(problem => problem.code === 'dangling-typed-ref')
    expect(resolverProblem).toMatchObject({ nodeId: 'reference-owner', severity: 'error' })

    expect(() => exportSemanticHtml(pmDoc)).toThrow(UnsupportedOutputError)
    await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-07T00:00:00.000Z' }))
      .rejects.toBeInstanceOf(UnsupportedOutputError)
    expect(() => buildPdfExportRequest(pmDoc, {})).toThrow(UnsupportedOutputError)
    expect(() => serializeToXml(pmDoc)).toThrow(UnsupportedOutputError)
    expect(JSON.stringify(pmDoc.toJSON())).toBe(sourceBefore)
  })

  it('keeps semantic JSON and raw JSON available with the original typed mark and source document', () => {
    const pmDoc = productionPmDoc(authoredDocument(wrongFigureRef))
    const sourceBefore = pmDoc.toJSON()
    const semanticJson = JSON.stringify(exportSemanticJson(pmDoc))
    const rawJson = JSON.stringify(pmDoc.toJSON())

    expect(semanticJson).toContain('"type":"crossRef"')
    expect(semanticJson).toContain('"refType":"figure"')
    expect(semanticJson).toContain('"targetId":"chapter"')
    expect(JSON.parse(rawJson)).toEqual(sourceBefore)
    expect(pmDoc.toJSON()).toEqual(sourceBefore)
  })

  it('continues to export valid chapter references and legacy references without kind', async () => {
    for (const mark of [
      { type: 'crossRef' as const, targetId: 'chapter', targetKind: 'chapter' as const },
      { type: 'crossRef' as const, targetId: 'chapter' },
    ]) {
      const pmDoc = productionPmDoc(authoredDocument(mark))
      expect(() => exportSemanticHtml(pmDoc)).not.toThrow()
      await expect(buildDocxBlob({ pmDoc, createdAt: '2026-10-07T00:00:00.000Z' })).resolves.toMatchObject({ blob: expect.any(Blob) })
      expect(() => buildPdfExportRequest(pmDoc, {})).not.toThrow()
      expect(() => serializeToXml(pmDoc)).not.toThrow()
    }
  })
})
