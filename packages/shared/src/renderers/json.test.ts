import { describe, expect, it } from 'vitest'
import type { IRDoc, ResolvedLabel } from '../ir/types'
import { renderJson, renderSemanticJson } from './json'

const chapterLabel: ResolvedLabel = { label: '5', xmlId: 'sec_5', refText: '第5章' }

function minimalDoc(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter',
      id: 'chapter-5',
      secType: 'scope',
      title: [{ text: '范围' }],
      children: [],
    }],
    appendices: [],
    bibliography: [],
  }
}

describe('shared semantic JSON renderer', () => {
  it('renders an IRDoc through irToPm and consumes its resolved chapter label', () => {
    const rendered = renderJson(minimalDoc(), { 'chapter-5': chapterLabel })

    expect(rendered.type).toBe('doc')
    expect(rendered.content?.[0]).toMatchObject({
      type: 'chapter',
      attrs: { nodeId: 'chapter-5' },
      number: '5',
      path: '5',
    })
  })

  it('propagates IR-to-PM diagnostics instead of returning partial JSON', () => {
    const doc = minimalDoc()
    doc.unsupportedContent = [{
      nodeId: 'future-node',
      path: 'body[0].children[0]',
      nodeType: 'futureNode',
      reason: 'not representable',
    }]

    expect(() => renderJson(doc, {})).toThrow(/cannot be represented in ProseMirror JSON/)
  })

  it('keeps the PM JSON compatibility projection available', () => {
    const rendered = renderSemanticJson({
      type: 'chapter',
      attrs: { nodeId: 'chapter-5' },
    }, { 'chapter-5': chapterLabel })

    expect(rendered).toMatchObject({ type: 'chapter', number: '5', path: '5' })
  })
})
