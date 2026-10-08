import { expect, it } from 'vitest'
import { IRToPmError, irToPm } from '../irToPm'
import type { IRDoc } from '../types'

function baseDoc(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '正文' }],
      children: [{ kind: 'paragraph', id: 'paragraph-owner', content: [{ text: '正文' }] }],
    }],
    appendices: [],
    bibliography: [],
  }
}

it('rejects native crossRef text with embedded newlines at its source text path', () => {
  const doc = baseDoc()
  doc.body[0]!.children[0] = {
    kind: 'paragraph', id: 'paragraph-owner',
    content: [{ text: '第一行\n第二行', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] }],
  }
  const before = JSON.stringify(doc)

  let thrown: unknown
  try { irToPm(doc) } catch (error) { thrown = error }
  expect(thrown).toBeInstanceOf(IRToPmError)
  expect((thrown as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({
    path: 'doc.body[0].children[0].content[0].text',
    nodeId: 'paragraph-owner',
    reason: expect.stringContaining('crossRef 文本包含换行'),
  }))
  expect(JSON.stringify(doc)).toBe(before)
})

it('continues to project ordinary marked newlines and single-line crossRefs', () => {
  const doc = baseDoc()
  doc.body[0]!.children[0] = {
    kind: 'paragraph', id: 'paragraph-owner',
    content: [
      { text: '加粗\n续行', marks: [{ type: 'bold' }] },
      { text: '引用', marks: [{ type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' }] },
    ],
  }

  expect(() => irToPm(doc)).not.toThrow()
})

it('retains the existing IR→PM duplicate crossRef type guard', () => {
  const doc = baseDoc()
  doc.body[0]!.children[0] = {
    kind: 'paragraph', id: 'paragraph-owner',
    content: [{ text: '两个目标', marks: [
      { type: 'crossRef', targetId: 'chapter', targetKind: 'chapter' },
      { type: 'crossRef', targetId: 'figure', targetKind: 'figure' },
    ] }],
  }

  let thrown: unknown
  try { irToPm(doc) } catch (error) { thrown = error }
  expect(thrown).toBeInstanceOf(IRToPmError)
  expect((thrown as IRToPmError).diagnostics).toContainEqual(expect.objectContaining({
    path: 'doc.body[0].children[0].content[0].marks[1]', nodeId: 'paragraph-owner',
  }))
})
