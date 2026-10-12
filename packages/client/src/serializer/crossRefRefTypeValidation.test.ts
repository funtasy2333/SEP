// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import {
  UnsupportedOutputError,
  getOutputSupportProblems,
  pmToIr,
  resolve,
  type PMJsonNode,
} from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { buildDocxBlob } from './docxExporter'
import { exportSemanticHtml } from './htmlExporter'
import { exportSemanticJson } from './jsonExporter'
import { buildPdfExportRequest } from './pdfExporter'
import { serializeToXml } from './xmlSerializer'

function productionDoc(refType?: unknown, includeRefType = true) {
  const attrs: Record<string, unknown> = { targetId: 'chapter-target' }
  if (includeRefType) attrs.refType = refType
  const schema = getSchema(createEditorExtensions())
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{
      type: 'chapter',
      attrs: { nodeId: 'chapter-target' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
        {
          type: 'stdParagraph',
          attrs: { nodeId: 'reference-owner' },
          content: [{
            type: 'text', text: '见本章',
            marks: [{ type: 'crossRef', attrs }],
          }],
        },
      ],
    }],
  })
  doc.check()
  return doc
}

describe('production-schema crossRef refType validation', () => {
  it.each([
    ['null', null],
    ['number', 7],
    ['boolean', false],
  ])('blocks non-JSON output for explicit non-string refType (%s), while preserving JSON', async (_name, refType) => {
    const doc = productionDoc(refType)
    const sourceBefore = JSON.parse(JSON.stringify(doc.toJSON()))
    const converted = pmToIr(doc.toJSON() as PMJsonNode)
    const issue = converted.doc.unsupportedContent?.[0]

    expect(issue).toMatchObject({
      nodeId: 'reference-owner',
      path: 'doc.content[0].content[1].content[0]',
      nodeType: 'crossRef',
      reason: expect.stringContaining('字符串'),
    })
    expect(converted.warnings).toEqual(expect.arrayContaining([expect.stringContaining('crossRef.refType')]))
    expect(resolve(converted.doc).problems).toContainEqual(expect.objectContaining({
      code: 'unsupported-content', nodeId: 'reference-owner', severity: 'error',
    }))
    for (const format of ['HTML', 'DOCX', 'XML'] as const) {
      expect(getOutputSupportProblems(converted.doc, format)).toContainEqual(expect.objectContaining({
        code: 'unsupported-output', nodeId: 'reference-owner', path: issue!.path,
      }))
    }

    expect(() => exportSemanticHtml(doc)).toThrow(UnsupportedOutputError)
    await expect(buildDocxBlob({ pmDoc: doc, createdAt: '2026-10-08T00:00:00.000Z' }))
      .rejects.toBeInstanceOf(UnsupportedOutputError)
    expect(() => buildPdfExportRequest(doc, {})).toThrow(UnsupportedOutputError)
    expect(() => serializeToXml(doc)).toThrow(UnsupportedOutputError)

    const semanticJson = JSON.stringify(exportSemanticJson(doc))
    expect(semanticJson).toContain(`"refType":${JSON.stringify(refType)}`)
    expect(doc.toJSON()).toEqual(sourceBefore)
  })

  it('keeps absent schema attributes at the legacy chapter default and accepts the explicit empty-string carrier', () => {
    const legacyDoc = productionDoc(undefined, false)
    const legacyMark = (legacyDoc.toJSON() as PMJsonNode).content?.[0]?.content?.[1]?.content?.[0]?.marks?.[0]
    expect(legacyMark?.attrs?.refType).toBe('chapter')
    const legacyIr = pmToIr(legacyDoc.toJSON() as PMJsonNode)
    expect(legacyIr.doc.body[0]?.children[0]).toMatchObject({
      content: [{ marks: [{ type: 'crossRef', targetId: 'chapter-target', targetKind: 'chapter' }] }],
    })
    expect(legacyIr.doc.unsupportedContent ?? []).toEqual([])
    expect(getOutputSupportProblems(legacyIr.doc, 'HTML')).toEqual([])

    const untypedDoc = productionDoc('')
    const untypedIr = pmToIr(untypedDoc.toJSON() as PMJsonNode)
    expect(untypedIr.doc.body[0]?.children[0]).toMatchObject({
      content: [{ marks: [{ type: 'crossRef', targetId: 'chapter-target' }] }],
    })
    expect(untypedIr.doc.unsupportedContent ?? []).toEqual([])
    expect(getOutputSupportProblems(untypedIr.doc, 'HTML')).toEqual([])
  })
})
