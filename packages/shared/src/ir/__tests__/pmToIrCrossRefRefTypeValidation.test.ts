import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '../pmToIr'

function pmDocWithRefType(refType?: unknown, includeRefType = true): PMJsonNode {
  const attrs: Record<string, unknown> = { targetId: 'chapter-target' }
  if (includeRefType) attrs.refType = refType
  return {
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
  }
}

describe('pmToIr crossRef refType validation', () => {
  it.each([
    ['null', null],
    ['number', 7],
    ['boolean', false],
  ])('preserves a diagnostic for an explicitly non-string refType (%s)', (_name, refType) => {
    const source = pmDocWithRefType(refType)
    const before = JSON.stringify(source)
    const converted = pmToIr(source)

    expect(converted.doc.body[0]?.children[0]).toMatchObject({
      kind: 'paragraph',
      id: 'reference-owner',
      content: [{ text: '见本章', marks: [{ type: 'crossRef', targetId: 'chapter-target' }] }],
    })
    expect(converted.doc.unsupportedContent).toEqual([expect.objectContaining({
      nodeId: 'reference-owner',
      path: 'doc.content[0].content[1].content[0]',
      nodeType: 'crossRef',
      reason: expect.stringContaining('字符串'),
    })])
    expect(converted.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('crossRef.refType'),
    ]))
    expect(JSON.stringify(source)).toBe(before)
  })

  it.each([
    ['attribute omitted', pmDocWithRefType(undefined, false)],
    ['empty string carrier', pmDocWithRefType('')],
  ])('keeps legacy untyped crossRefs compatible when %s', (_name, source) => {
    const converted = pmToIr(source)
    const paragraph = converted.doc.body[0]?.children[0]

    expect(paragraph).toMatchObject({ content: [{ marks: [{ type: 'crossRef', targetId: 'chapter-target' }] }] })
    expect(converted.doc.unsupportedContent ?? []).toEqual([])
    expect(converted.warnings).toEqual([])
  })

  it('retains mapped kinds and the existing diagnostic for unknown string kinds', () => {
    const known = pmToIr(pmDocWithRefType('chapter')).doc.body[0]?.children[0]
    expect(known).toMatchObject({ content: [{ marks: [{ type: 'crossRef', targetId: 'chapter-target', targetKind: 'chapter' }] }] })

    const unknown = pmToIr(pmDocWithRefType('future-kind'))
    expect(unknown.doc.unsupportedContent).toEqual([expect.objectContaining({
      nodeType: 'crossRef',
      reason: '引用类型「future-kind」没有映射到IR目标类型',
    })])
    expect(unknown.warnings).toContain('交叉引用类型「future-kind」没有IR映射')
  })
})
