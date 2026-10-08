import { describe, expect, it } from 'vitest'
import { diagnoseInlineProjection, findCrossRefRunProjectionIssues } from '../inlineProjectionDiagnostics'

type Diagnostic = { path: string; reason: string; nodeId?: string }

function inspect(value: unknown): Diagnostic[] {
  const errors: Diagnostic[] = []
  diagnoseInlineProjection(value, 'doc', undefined, errors)
  return errors
}

describe('IR inline projection diagnostics', () => {
  it('finds only duplicate or line-spanning crossRef runs for renderer output checks', () => {
    const issues = findCrossRefRunProjectionIssues({ id: 'paragraph', content: [
      { text: 'multiple', marks: [
        { type: 'crossRef', targetId: 'chapter-a' },
        { type: 'crossRef', targetId: 'figure-b' },
      ] },
      { text: 'first line\nsecond line', marks: [{ type: 'crossRef', targetId: 'chapter-a' }] },
      { text: 'bold line\nsecond line', marks: [{ type: 'bold' }] },
      { text: '', marks: [{ type: 'crossRef', targetId: 'chapter-a' }] },
    ] })

    expect(issues).toEqual([
      expect.objectContaining({
        kind: 'multiple-crossrefs', nodeId: 'paragraph', path: 'doc.content[0].marks[1]',
      }),
      expect.objectContaining({
        kind: 'crossref-newline', nodeId: 'paragraph', path: 'doc.content[1].text',
      }),
    ])
  })

  it('rejects code combined with any emitted text mark or non-empty style', () => {
    const errors = inspect({ id: 'paragraph', content: [
      { text: 'code and bold', marks: [{ type: 'code' }, { type: 'bold' }] },
      { text: 'code and style', marks: [{ type: 'code' }], style: { color: 'red' } },
    ] })

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'paragraph', path: 'doc.content[0].marks[0]', reason: expect.stringContaining('code') }),
      expect.objectContaining({ nodeId: 'paragraph', path: 'doc.content[1].marks[0]', reason: expect.stringContaining('code') }),
    ]))
  })

  it('rejects repeated reference marks even when their targets differ', () => {
    const errors = inspect({ id: 'paragraph', content: [{ text: 'two destinations', marks: [
      { type: 'crossRef', targetId: 'chapter-a', targetKind: 'chapter' },
      { type: 'crossRef', targetId: 'chapter-b', targetKind: 'chapter' },
    ] }] })

    expect(errors).toContainEqual(expect.objectContaining({
      nodeId: 'paragraph',
      path: 'doc.content[0].marks[1]',
      reason: expect.stringContaining('重复'),
    }))
  })

  it('rejects empty text marks and styles that have no production carrier', () => {
    const errors = inspect({ id: 'paragraph', content: [
      { text: '', marks: [{ type: 'externalLink', href: 'https://example.test' }] },
      { text: '', marks: [{ type: 'variable', kind: 'symbol', name: 'x' }] },
      { text: '', style: { fontSize: '12pt' } },
      { text: '', marks: [{ type: 'bold' }], footnote: { id: 'note', content: [{ text: '脚注' }] } },
    ] })

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'paragraph', path: 'doc.content[0].marks[0]' }),
      expect.objectContaining({ nodeId: 'paragraph', path: 'doc.content[1].marks[0]' }),
      expect.objectContaining({ nodeId: 'paragraph', path: 'doc.content[2].style' }),
      expect.objectContaining({ nodeId: 'paragraph', path: 'doc.content[3].marks[0]' }),
    ]))
  })

  it('leaves empty cross-reference carrier diagnostics to the existing precise validator', () => {
    const errors = inspect({ id: 'paragraph', content: [{ text: '', marks: [
      { type: 'crossRef', targetId: 'chapter-a' },
      { type: 'bibRef', targetId: 'bib-a' },
      { type: 'termRef', targetId: 'term-a' },
    ] }] })

    expect(errors).toEqual([])
  })

  it('allows distinct table-footnote atoms and keeps them outside text-mark conflicts', () => {
    const errors = inspect({ id: 'paragraph', content: [{ text: '', marks: [
      { type: 'tableFootnoteRef', id: 'ref-a', targetId: 'footnote-a' },
      { type: 'tableFootnoteRef', id: 'ref-b', targetId: 'footnote-b' },
    ] }] })

    expect(errors).toEqual([])
  })

  it('allows schema-compatible marks on text, hard-break, and formula carriers', () => {
    const errors = inspect({ id: 'paragraph', content: [
      { text: 'code', marks: [{ type: 'code' }] },
      { text: 'bold italic', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { text: 'reference', marks: [{ type: 'crossRef', targetId: 'chapter-a' }, { type: 'italic' }] },
      { text: 'line one\nline two', marks: [{ type: 'underline' }] },
      { text: '', formula: { id: 'formula-inline', latex: 'x' }, marks: [{ type: 'crossRef', targetId: 'chapter-a' }] },
    ] })

    expect(errors).toEqual([])
  })
})
