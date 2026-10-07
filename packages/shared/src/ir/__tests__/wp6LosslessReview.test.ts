import { describe, expect, it } from 'vitest'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import type { IRDoc, IRInline } from '../types'

function base(): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [] }],
    appendices: [],
    bibliography: [],
  }
}

describe('WP6 converter lossless review regressions', () => {
  it('roundtrips marks and text styles on hard breaks', () => {
    const inline = (text: string): PMJsonNode => ({
      type: 'text',
      text,
      marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'serif' } }],
    })
    const source: PMJsonNode = {
      type: 'doc',
      content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
        { type: 'chapterTitle' },
        { type: 'stdParagraph', attrs: { nodeId: 'paragraph' }, content: [
          inline('甲'),
          { type: 'hardBreak', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'serif' } }] },
          inline('乙'),
        ] },
      ] }],
    }

    const first = pmToIr(source).doc
    const roundtripped = pmToIr(irToPm(first)).doc
    const paragraph = roundtripped.body[0].children[0]
    expect(paragraph).toMatchObject({ kind: 'paragraph', id: 'paragraph' })
    if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph')
    expect(paragraph.content).toEqual([
      { text: '甲', marks: [{ type: 'bold' }], style: { fontFamily: 'serif' } },
      { text: '\n', marks: [{ type: 'bold' }], style: { fontFamily: 'serif' } },
      { text: '乙', marks: [{ type: 'bold' }], style: { fontFamily: 'serif' } },
    ])
  })

  it('also diagnoses typed refs carried only by a footnote atom and leaves the IR source unchanged', () => {
    const authored = base()
    authored.body[0].children = [{ kind: 'paragraph', id: 'footnote-owner', content: [{
      text: '',
      footnote: { id: 'footnote', content: [{ text: '脚注文字' }] },
      marks: [{ type: 'bibRef', targetId: 'bibliography-target' }],
    }] }]
    const original = structuredClone(authored)
    let caught: unknown
    try { irToPm(authored) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    expect((caught as IRToPmError).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'footnote-owner', path: expect.stringContaining('content[0]') }),
    ]))
    expect(authored).toEqual(original)
  })

  it('allows text and formula atoms to carry typed refs and keeps the dedicated table-footnote atom', () => {
    const authored = base()
    authored.body[0].children = [{ kind: 'paragraph', id: 'carrier-owner', content: [
      { text: '有意义的交叉引用文本', marks: [{ type: 'crossRef', targetId: 'text-target', targetKind: 'chapter' }] },
      { text: '', formula: { id: 'inline-formula', latex: 'x' }, marks: [{ type: 'crossRef', targetId: 'figure-target', targetKind: 'figure' }] },
      { text: '', marks: [{ type: 'tableFootnoteRef', id: 'table-ref', targetId: 'table-footnote' }] },
    ] }]
    expect(() => irToPm(authored)).not.toThrow()
  })

  it('keeps the existing unsupported diagnostic for marked hard breaks inside footnotes', () => {
    const source: PMJsonNode = {
      type: 'doc',
      content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
        { type: 'chapterTitle' },
        { type: 'stdParagraph', attrs: { nodeId: 'paragraph' }, content: [
          { type: 'footnoteRef', attrs: { nodeId: 'footnote', content: [
            { type: 'hardBreak', marks: [{ type: 'bold' }] },
          ] } },
        ] },
      ] }],
    }
    const converted = pmToIr(source).doc
    expect(converted.unmappedFootnotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'footnote', reason: '换行格式标记' }),
    ]))
  })

  it('diagnoses an untitled source clause that contains a hidden title and does not mutate the source', () => {
    const source: PMJsonNode = {
      type: 'doc',
      content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
        { type: 'chapterTitle' },
        { type: 'clause', attrs: { nodeId: 'untitled', hasTitle: false }, content: [
          { type: 'clauseTitle', content: [{ type: 'text', text: '隐藏标题' }] },
        ] },
      ] }],
    }
    const original = structuredClone(source)
    const converted = pmToIr(source).doc
    expect(converted.unsupportedContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'untitled', nodeType: 'clause', path: expect.any(String) }),
    ]))
    expect(source).toEqual(original)

    const authored = base()
    authored.body[0].children = [{
      kind: 'clause', id: 'untitled-ir', level: 1, titled: false,
      title: [{ text: '不兼容标题' }], children: [],
    }]
    const raw = structuredClone(authored)
    try {
      irToPm(authored)
      throw new Error('Expected IRToPmError')
    } catch (error) {
      expect(error).toBeInstanceOf(IRToPmError)
      expect((error as IRToPmError).diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ nodeId: 'untitled-ir', path: expect.stringContaining('title') }),
      ]))
    }
    expect(authored).toEqual(raw)

    const blank = base()
    blank.body[0].children = [{ kind: 'clause', id: 'blank-untitled', level: 1, titled: false, title: [], children: [] }]
    expect(() => irToPm(blank)).not.toThrow()
    expect(pmToIr(irToPm(blank)).doc.body[0].children[0]).toMatchObject({ id: 'blank-untitled', titled: false, title: [] })
  })

  it.each([
    { type: 'crossRef', targetId: 'target', targetKind: 'chapter' },
    { type: 'bibRef', targetId: 'target' },
    { type: 'termRef', targetId: 'target' },
  ] as const)('rejects a semantic reference without a ProseMirror text carrier: $type', mark => {
    const authored = base()
    authored.body[0].children = [{ kind: 'paragraph', id: 'source', content: [{ text: '', marks: [mark] as IRInline['marks'] }] }]
    const raw = structuredClone(authored)
    try {
      irToPm(authored)
      throw new Error('Expected IRToPmError')
    } catch (error) {
      expect(error).toBeInstanceOf(IRToPmError)
      expect((error as IRToPmError).diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ nodeId: 'source', path: expect.stringContaining('content[0]') }),
      ]))
    }
    expect(authored).toEqual(raw)
  })
})
