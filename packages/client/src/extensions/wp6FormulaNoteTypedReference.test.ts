// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  getOutputSupportProblems,
  renderDocx,
  renderHtml,
  irToPm,
  pmToIr,
  renderJson,
  resolve,
  type IRDoc,
  type IRParagraph,
  type PMJsonNode,
  type SemanticJsonNode,
} from '@ses/shared'
import { expect, it } from 'vitest'
import { exportSemanticJson } from '../serializer/jsonExporter'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())

function document(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '正文' }],
      children: [
        { kind: 'paragraph', id: 'reference', content: [{
          text: '引用公式注', marks: [{ type: 'crossRef', targetId: 'formula-note', targetKind: 'note' }],
        }] },
        { kind: 'formula', id: 'formula', latex: 'x = 1', numbered: true, whereList: [], notes: [{
          id: 'formula-note', content: [{
            text: '公式注引用章节', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }],
          }],
        }] },
      ],
    }],
    appendices: [],
    bibliography: [],
  }
}

function findNode(node: SemanticJsonNode | PMJsonNode, type: string): SemanticJsonNode | PMJsonNode | undefined {
  if (node.type === type) return node
  for (const child of node.content ?? []) {
    const found = findNode(child, type)
    if (found) return found
  }
  return undefined
}

function findText(node: SemanticJsonNode | PMJsonNode, text: string): SemanticJsonNode | PMJsonNode | undefined {
  if (node.type === 'text' && node.text === text) return node
  for (const child of node.content ?? []) {
    const found = findText(child, text)
    if (found) return found
  }
  return undefined
}

it('round-trips formula-note typed refs through the production schema while JSON remains available and print stays unsupported', () => {
  const ir = document()
  const sourceBefore = JSON.stringify(ir)
  const initialResolution = resolve(ir)
  const projected = irToPm(ir)
  const loaded = schema.nodeFromJSON(projected)
  loaded.check()

  const raw = loaded.toJSON() as PMJsonNode
  const rawReloaded = schema.nodeFromJSON(JSON.parse(JSON.stringify(raw)))
  rawReloaded.check()
  const reloadedPm = rawReloaded.toJSON() as PMJsonNode
  const returned = pmToIr(reloadedPm).doc
  const finalResolution = resolve(returned)

  expect(initialResolution.problems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([])
  expect(finalResolution.problems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([])
  expect(finalResolution.labels['formula-note']).toEqual(initialResolution.labels['formula-note'])
  // R-10（C-T-23、M-7.2-02）：公式注由 Resolver 按作用域编号，不再是 label:'' + ext_ 占位
  expect(finalResolution.labels['formula-note']).toEqual({ label: '注：', xmlId: 'note_1', refText: '注' })
  expect(reloadedPm).toEqual(raw)
  expect((returned.body[0]!.children[1] as Extract<IRDoc['body'][number]['children'][number], { kind: 'formula' }>).notes)
    .toEqual((ir.body[0]!.children[1] as Extract<IRDoc['body'][number]['children'][number], { kind: 'formula' }>).notes)

  const noteRefRun = findText(raw, '引用公式注')
  expect(noteRefRun?.marks).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'crossRef', attrs: expect.objectContaining({ targetId: 'formula-note', refType: 'note' }) }),
  ]))
  expect(findNode(raw, 'formulaNote')).toMatchObject({
    type: 'formulaNote', attrs: { nodeId: 'formula-note' }, content: [{ type: 'text', text: '公式注引用章节' }],
  })

  const nativeJson = renderJson(ir, initialResolution.labels)
  const semanticJson = exportSemanticJson(loaded as PMNode)
  for (const rendered of [nativeJson, semanticJson]) {
    expect(findNode(rendered, 'formulaNote')).toMatchObject({
      type: 'formulaNote', attrs: { nodeId: 'formula-note' }, content: [{ type: 'text', text: '公式注引用章节' }],
    })
    expect(findText(rendered, '引用公式注')?.marks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'crossRef', attrs: expect.objectContaining({ targetId: 'formula-note', refType: 'note' }) }),
    ]))
  }

  for (const format of ['HTML', 'DOCX', 'XML'] as const) {
    expect(getOutputSupportProblems(returned, format)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'formula', path: expect.stringContaining('.notes') }),
    ]))
  }
  expect(JSON.stringify(ir)).toBe(sourceBefore)
})


it('preserves an untyped native cross-reference through the production schema and keeps a figure printable', () => {
  const ir: IRDoc = {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '正文' }],
      children: [
        { kind: 'paragraph', id: 'untyped-ref', content: [{
          text: '未声明类型引用', marks: [{ type: 'crossRef', targetId: 'target-figure' }],
        }] },
        { kind: 'paragraph', id: 'typed-ref', content: [{
          text: '显式图引用', marks: [{ type: 'crossRef', targetId: 'target-figure', targetKind: 'figure' }],
        }] },
        { kind: 'figure', id: 'target-figure', caption: [{ text: '目标图' }], orientation: 'portrait', src: '', notes: [] },
      ],
    }],
    appendices: [],
    bibliography: [],
  }
  const sourceBefore = JSON.stringify(ir)
  const initialResolution = resolve(ir)
  const loaded = schema.nodeFromJSON(irToPm(ir))
  loaded.check()
  const raw = loaded.toJSON() as PMJsonNode
  const untypedRaw = findText(raw, '未声明类型引用')?.marks?.find(mark => mark.type === 'crossRef')
  const typedRaw = findText(raw, '显式图引用')?.marks?.find(mark => mark.type === 'crossRef')
  expect(untypedRaw?.attrs).toMatchObject({ targetId: 'target-figure', refType: '' })
  expect(typedRaw?.attrs).toMatchObject({ targetId: 'target-figure', refType: 'figure' })

  const reloaded = schema.nodeFromJSON(JSON.parse(JSON.stringify(raw)))
  reloaded.check()
  const returned = pmToIr(reloaded.toJSON() as PMJsonNode).doc
  const finalResolution = resolve(returned)
  const returnedUntyped = (returned.body[0]!.children[0] as IRParagraph).content[0]!.marks?.[0]
  const returnedTyped = (returned.body[0]!.children[1] as IRParagraph).content[0]!.marks?.[0]
  expect(returnedUntyped).toEqual({ type: 'crossRef', targetId: 'target-figure' })
  expect(returnedTyped).toEqual({ type: 'crossRef', targetId: 'target-figure', targetKind: 'figure' })
  expect(initialResolution.problems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([])
  expect(finalResolution.problems.filter(problem => problem.code === 'dangling-typed-ref')).toEqual([])
  expect(finalResolution.labels['target-figure']).toEqual(initialResolution.labels['target-figure'])
  expect(getOutputSupportProblems(returned, 'HTML')).toEqual([])
  expect(getOutputSupportProblems(returned, 'DOCX')).toEqual([])

  const html = renderHtml(returned, finalResolution.labels, { variant: 'print' })
  const docx = renderDocx(returned, finalResolution.labels, {
    images: {}, formulaOmml: {}, stage: 'working_draft', createdAt: '2026-10-08T00:00:00.000Z',
  }).parts['word/document.xml']!
  const refText = finalResolution.labels['target-figure']!.refText
  expect(html).toContain(refText)
  expect(docx).toContain(refText)

  const nativeJson = renderJson(ir, initialResolution.labels)
  const nativeMark = findText(nativeJson, '未声明类型引用')?.marks?.find(mark => mark.type === 'crossRef')
  expect(nativeMark?.attrs).toMatchObject({ targetId: 'target-figure', refType: '' })
  const semanticJson = exportSemanticJson(reloaded as PMNode)
  const semanticMark = findText(semanticJson, '未声明类型引用')?.marks?.find(mark => mark.type === 'crossRef')
  expect(semanticMark?.attrs).toMatchObject({ targetId: 'target-figure', refType: '' })
  expect(JSON.stringify(ir)).toBe(sourceBefore)
})
