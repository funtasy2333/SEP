import { describe, expect, it } from 'vitest'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr } from '../pmToIr'
import type { IRDoc, IRList, IRTermEntry } from '../types'

function docWithList(list: IRList): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter-list', secType: 'general', title: [], children: [list] }],
    appendices: [],
    bibliography: [],
  }
}

function captureIrToPmError(doc: IRDoc): IRToPmError {
  let caught: unknown
  try {
    irToPm(doc)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(IRToPmError)
  return caught as IRToPmError
}

function simpleList(listType: IRList['listType'], level?: IRList['level']): IRList {
  return {
    kind: 'list',
    id: `list-${listType}`,
    listType,
    ...(level === undefined ? {} : { level }),
    items: [{
      id: `item-${listType}`,
      content: [{ kind: 'paragraph', id: `item-${listType}.p0`, content: [{ text: '项' }] }],
    }],
  }
}

describe('irToPm / native IR roundtrip', () => {
  it('preserves multiple term-definition paragraph IDs and an unprefixed typed source', () => {
    const term: IRTermEntry = {
      kind: 'termEntry',
      id: 'term-1',
      level: 1,
      term: [{ text: '术语' }],
      definition: [
        { kind: 'paragraph', id: 'definition-main', content: [{ text: '主定义' }] },
        { kind: 'paragraph', id: 'definition-continuation', content: [{ text: '续行定义' }] },
      ],
      source: [{ text: 'ISO vocabulary, 2026' }],
      notes: [],
      examples: [],
    }
    const authored: IRDoc = {
      schemaVersion: 1,
      extensionVersion: 1,
      meta: { standardType: 'gb' },
      front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter-1', secType: 'terms', title: [{ text: '术语和定义' }], children: [term] }],
      appendices: [],
      bibliography: [],
    }

    const pm = irToPm(authored)
    const termPm = pm.content?.[0]?.content?.[1]
    expect(termPm?.content?.filter(child => child.type === 'termDefinition' || child.type === 'stdParagraph' || child.type === 'termSource')).toEqual([
      { type: 'termDefinition', attrs: { nodeId: 'definition-main' }, content: [{ type: 'text', text: '主定义' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'definition-continuation' }, content: [{ type: 'text', text: '续行定义' }] },
      { type: 'termSource', content: [{ type: 'text', text: 'ISO vocabulary, 2026' }] },
    ])

    const reopened = pmToIr(pm).doc.body[0].children[0] as IRTermEntry
    expect(reopened).toEqual(term)
  })

  it('roundtrips a standard-list paragraph only when its ID matches the production-derived ID', () => {
    const list = simpleList('dash')
    const doc = docWithList(list)
    const pm = irToPm(doc)
    const stdList = pm.content?.[0]?.content?.[1]

    expect(stdList?.type).toBe('stdList')
    expect(pmToIr(pm).doc.body[0]?.children[0]).toEqual(list)

    const mismatched = simpleList('dash')
    mismatched.items[0]!.content[0]!.id = 'authored-paragraph-id'
    const error = captureIrToPmError(docWithList(mismatched))
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][0].items[0].content[0]',
      nodeId: 'authored-paragraph-id',
      reason: expect.stringContaining('无法保留'),
    }))
  })

  it('rejects roman list types instead of silently converting them to numeric', () => {
    for (const listType of ['roman', 'romanUpper'] as const) {
      const error = captureIrToPmError(docWithList(simpleList(listType)))
      expect(error.diagnostics).toContainEqual(expect.objectContaining({
        path: 'body[0][0].listType',
        nodeId: `list-${listType}`,
        reason: expect.stringContaining('不支持'),
      }))
    }
  })

  it('rejects explicit levels that conflict with production list levels', () => {
    const mismatches: Array<[IRList['listType'], NonNullable<IRList['level']>]> = [
      ['number', 1],
      ['dot', 1],
      ['dash', 2],
      ['alpha', 2],
      ['boxed', 2],
    ]

    for (const [listType, level] of mismatches) {
      const error = captureIrToPmError(docWithList(simpleList(listType, level)))
      expect(error.diagnostics).toContainEqual(expect.objectContaining({
        path: 'body[0][0].level',
        nodeId: `list-${listType}`,
        reason: expect.stringContaining('固定为'),
      }))
    }
  })

  it('checks level consistency inside the nested StarterList branch', () => {
    const nested: IRList = {
      kind: 'list',
      id: 'nested-number-list',
      listType: 'number',
      level: 1,
      items: [{
        id: 'nested-item',
        content: [
          { kind: 'paragraph', id: 'nested-paragraph-1', content: [{ text: '第一段' }] },
          { kind: 'paragraph', id: 'nested-paragraph-2', content: [{ text: '第二段' }] },
        ],
      }],
    }
    const outer: IRList = {
      kind: 'list',
      id: 'outer-dash-list',
      listType: 'dash',
      items: [{
        id: 'outer-item',
        content: [
          { kind: 'paragraph', id: 'outer-item.p0', content: [{ text: '外层' }] },
          nested,
        ],
      }],
    }

    const error = captureIrToPmError(docWithList(outer))
    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      path: 'body[0][0].outer-item[1].level',
      nodeId: 'nested-number-list',
      reason: expect.stringContaining('固定为 2 级'),
    }))
  })
})
