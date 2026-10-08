import { describe, expect, it } from 'vitest'
import { renderSemanticJson } from './json'
import type { PMJsonNode } from '../ir/pmToIr'

describe('semantic JSON preserves explicitly invalid crossRef.refType null', () => {
  it('keeps only crossRef.refType null while retaining the existing null filtering rules elsewhere', () => {
    const source: PMJsonNode = {
      type: 'doc',
      attrs: { droppedRootNull: null, retainedRootValue: false },
      content: [{
        type: 'text', text: '引用',
        marks: [
          { type: 'crossRef', attrs: {
            targetId: 'target', refType: null, refId: null, refText: null,
            droppedOtherNull: null, retainedNumber: 7,
          } },
          { type: 'crossRef', attrs: { refType: null, refId: null, refText: null } },
          { type: 'bold', attrs: { droppedMarkNull: null, retainedBoolean: false } },
        ],
      }],
    }
    const before = JSON.stringify(source)

    const rendered = renderSemanticJson(source, {})

    expect(rendered.attrs).toEqual({ retainedRootValue: false })
    expect(rendered.content?.[0]?.marks).toEqual([
      { type: 'crossRef', attrs: { targetId: 'target', retainedNumber: 7, refType: null } },
      { type: 'crossRef', attrs: { refType: null } },
      { type: 'bold', attrs: { retainedBoolean: false } },
    ])
    expect(JSON.stringify(source)).toBe(before)
  })

  it('does not materialize omitted or undefined refType values', () => {
    const rendered = renderSemanticJson({
      type: 'doc',
      content: [{
        type: 'text', text: '引用',
        marks: [
          { type: 'crossRef', attrs: { targetId: 'omitted', refId: null, refText: null } },
          { type: 'crossRef', attrs: { targetId: 'undefined', refType: undefined } },
        ],
      }],
    }, {})

    expect(rendered.content?.[0]?.marks).toEqual([
      { type: 'crossRef', attrs: { targetId: 'omitted' } },
      { type: 'crossRef', attrs: { targetId: 'undefined' } },
    ])
    expect(Object.hasOwn(rendered.content?.[0]?.marks?.[1]?.attrs ?? {}, 'refType')).toBe(false)
  })
})
