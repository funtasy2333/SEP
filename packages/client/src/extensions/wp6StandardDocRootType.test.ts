// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { expect, it } from 'vitest'
import {
  irToPm, pmToIr, type IRDoc, type IRParagraph, type PMJsonNode,
} from '@ses/shared'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { createEditorExtensions } from './editorExtensions'
import { StandardDoc } from './nodes/standard-doc'

const standardDocExtensions = createEditorExtensions().map(extension => extension.name === 'starterKit'
  ? extension.configure({ document: false }) : extension)
const standardDocSchema = getSchema([...standardDocExtensions, StandardDoc])
const editorSchema = getSchema(createEditorExtensions())

const typeCases = [
  { ir: 'gb', pm: 'national' },
  { ir: 'industry', pm: 'industry' },
  { ir: 'local', pm: 'local' },
  { ir: 'group', pm: 'group' },
  { ir: 'enterprise', pm: 'enterprise' },
  { ir: 'guide', pm: 'guidance' },
] as const

function authored(standardType: IRDoc['meta']['standardType']): IRDoc {
  return {
    schemaVersion: 1,
    extensionVersion: 1,
    meta: {
      standardType, title: '根类型往返', titleEn: 'Root type roundtrip', stdCode: 'T/TYPE 1',
      icsCode: '01.010', ccsCode: 'A 00', issuer: '标准发布机构', applicant: '起草单位',
      proposer: '提出单位', technicalCommittee: '归口单位',
    },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '正文' }], children: [
        { kind: 'paragraph', id: 'reference', content: [{
          text: '引用本章', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }],
        }] },
      ],
    }],
    appendices: [],
    bibliography: [],
  }
}

function findNode(node: PMJsonNode, type: string): PMJsonNode | undefined {
  if (node.type === type) return node
  for (const child of node.content ?? []) {
    const found = findNode(child, type)
    if (found) return found
  }
  return undefined
}

function expectRoundTrip(doc: IRDoc, rootType: string, expectedPmType: string): void {
  expect(rootType).toBe('standardDoc')
  const projected = irToPm(doc, { rootType: 'standardDoc' })
  const loaded = standardDocSchema.nodeFromJSON(projected)
  loaded.check()
  const raw = loaded.toJSON() as PMJsonNode
  const cover = findNode(raw, 'coverPage')

  expect(raw.type).toBe('standardDoc')
  expect(raw.attrs?.standardType).toBe(expectedPmType)
  expect(cover?.attrs?.standardType).toBe(expectedPmType)
  expect(raw.attrs?.extensionVersion).toBe(1)
  expect(cover?.attrs).toMatchObject({
    standardNo: 'T/TYPE 1', titleCn: '根类型往返', titleEn: 'Root type roundtrip',
    icsCode: '01.010', ccsCode: 'A 00', issuer: '标准发布机构', applicant: '起草单位',
  })

  const reopened = standardDocSchema.nodeFromJSON(JSON.parse(JSON.stringify(raw)))
  reopened.check()
  const reopenedJson = reopened.toJSON() as PMJsonNode
  const rawIr = pmToIr(reopenedJson).doc
  expect(rawIr.meta).toMatchObject(doc.meta)
  expect(rawIr.extensionVersion).toBe(1)
  expect((rawIr.body[0]!.children[0] as IRParagraph).content[0]!.marks).toEqual([
    { type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' },
  ])

  const semantic = exportSemanticJson(loaded as PMNode)
  const semanticRoot = standardDocSchema.nodeFromJSON(JSON.parse(JSON.stringify(semantic)))
  semanticRoot.check()
  const semanticJson = semanticRoot.toJSON() as PMJsonNode
  expect(semanticJson.attrs?.standardType).toBe(expectedPmType)
  expect(findNode(semanticJson, 'coverPage')?.attrs?.standardType).toBe(expectedPmType)
  const semanticIr = pmToIr(semanticJson).doc
  expect(semanticIr.meta).toMatchObject(doc.meta)
  expect(semanticIr.extensionVersion).toBe(1)
  expect((semanticIr.body[0]!.children[0] as IRParagraph).content[0]!.marks).toEqual([
    { type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' },
  ])
}

it.each(typeCases)('round-trips IR standardType $ir through the production standardDoc root and semantic JSON', ({ ir, pm }) => {
  const doc = authored(ir)
  const before = JSON.stringify(doc)
  expectRoundTrip(doc, 'standardDoc', pm)
  expect(JSON.stringify(doc)).toBe(before)
})

it('keeps the default doc root metadata contract on coverPage', () => {
  const doc = authored('industry')
  const before = JSON.stringify(doc)
  const loaded = editorSchema.nodeFromJSON(irToPm(doc))
  loaded.check()
  const raw = loaded.toJSON() as PMJsonNode
  expect(raw.type).toBe('doc')
  expect(raw.attrs?.standardType).toBeUndefined()
  expect(findNode(raw, 'coverPage')?.attrs?.standardType).toBe('industry')
  expect(pmToIr(raw).doc.meta).toMatchObject(doc.meta)
  expect(JSON.stringify(doc)).toBe(before)
})
