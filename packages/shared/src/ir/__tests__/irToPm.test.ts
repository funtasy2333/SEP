import { describe, expect, it } from 'vitest'
import { irToPm } from '../irToPm'
import { pmToIr } from '../pmToIr'
import type { IRDoc, IRTermEntry } from '../types'

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
})
