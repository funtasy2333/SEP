// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { IRToPmError, irToPm, pmToIr, resolve, type IRDoc, type IRInline, type IRMark, type IRTable, type PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())

function docWithChildren(children: IRDoc['body'][number]['children']): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [
      { kind: 'chapter', id: 'source-chapter', secType: 'general', title: [], children },
      { kind: 'chapter', id: 'target-chapter', secType: 'general', title: [{ text: '目标章' }], children: [] },
    ],
    appendices: [],
    bibliography: [],
  }
}

function paragraph(content: IRInline[], id = 'source-paragraph') {
  return { kind: 'paragraph' as const, id, content }
}

function captureProjectionError(doc: IRDoc): IRToPmError {
  let thrown: unknown
  try { irToPm(doc) } catch (error) { thrown = error }
  expect(thrown).toBeInstanceOf(IRToPmError)
  return thrown as IRToPmError
}

const textMarkCases: Array<{ ir: Exclude<IRMark, { type: 'tableFootnoteRef' }>; pm: string }> = [
  { ir: { type: 'bold' }, pm: 'bold' },
  { ir: { type: 'italic' }, pm: 'italic' },
  { ir: { type: 'underline' }, pm: 'underline' },
  { ir: { type: 'sub' }, pm: 'subscript' },
  { ir: { type: 'sup' }, pm: 'superscript' },
  { ir: { type: 'strike' }, pm: 'strike' },
  { ir: { type: 'code' }, pm: 'code' },
  { ir: { type: 'variable', kind: 'symbol', name: 'x' }, pm: 'variable' },
  { ir: { type: 'externalLink', href: 'https://example.test' }, pm: 'externalLink' },
  { ir: { type: 'crossRef', targetId: 'target-chapter', targetKind: 'chapter' }, pm: 'crossRef' },
  { ir: { type: 'bibRef', targetId: 'bib-entry' }, pm: 'bibRef' },
  { ir: { type: 'termRef', targetId: 'term-entry' }, pm: 'termRef' },
]

function projectCarrier(marks: IRMark[], carrier: 'text' | 'formula', style?: { color: string }) {
  const inline: IRInline = carrier === 'text'
    ? { text: 'carrier', marks, ...(style ? { style } : {}) }
    : { text: '', formula: { id: 'matrix-formula', latex: 'x' }, marks, ...(style ? { style } : {}) }
  const projected = schema.nodeFromJSON(irToPm(docWithChildren([paragraph([inline])])) )
  projected.check()
  const found: string[][] = []
  projected.descendants(node => {
    if ((carrier === 'text' && node.isText && node.text === 'carrier')
      || (carrier === 'formula' && node.type.name === 'formulaInline' && node.attrs.nodeId === 'matrix-formula')) {
      found.push(node.marks.map(mark => mark.type.name))
    }
  })
  return found
}

describe('IR inline projection against the production editor schema', () => {
  it('registers every persisted IR text mark as a named production schema carrier', () => {
    for (const { ir, pm } of textMarkCases) {
      expect(schema.marks[pm], `${ir.type} → ${pm}`).toBeDefined()
      expect(projectCarrier([ir], 'text')).toEqual([[pm]])
      expect(projectCarrier([ir], 'formula')).toEqual([[pm]])
    }
    // tableFootnoteRef is deliberately a typed inline atom node, not a text mark.
    expect(schema.nodes.tableFootnoteRef).toBeDefined()
  })

  it('matches the production schema exclusion matrix for every text and formula mark pair', () => {
    const carriers = ['text', 'formula'] as const
    for (const carrier of carriers) {
      for (let leftIndex = 0; leftIndex < textMarkCases.length; leftIndex += 1) {
        for (let rightIndex = leftIndex; rightIndex < textMarkCases.length; rightIndex += 1) {
          const left = textMarkCases[leftIndex]!
          const right = textMarkCases[rightIndex]!
          const leftType = schema.marks[left.pm]!
          const rightType = schema.marks[right.pm]!
          const schemaExcludes = leftType.excludes(rightType) || rightType.excludes(leftType)
          const marks = [structuredClone(left.ir), structuredClone(right.ir)]
          const sourceInline: IRInline = carrier === 'text'
            ? { text: 'pair', marks }
            : { text: '', formula: { id: 'matrix-pair-formula', latex: 'x' }, marks }
          const source = docWithChildren([paragraph([sourceInline])])

          if (schemaExcludes) {
            expect(() => irToPm(source), `${carrier}: ${left.pm} + ${right.pm}`).toThrow(IRToPmError)
          } else {
            const projected = schema.nodeFromJSON(irToPm(source))
            projected.check()
            const carrierMarks: string[][] = []
            projected.descendants(node => {
              if ((carrier === 'text' && node.isText && node.text === 'pair')
                || (carrier === 'formula' && node.type.name === 'formulaInline' && node.attrs.nodeId === 'matrix-pair-formula')) {
                carrierMarks.push(node.marks.map(mark => mark.type.name).sort())
              }
            })
            expect(carrierMarks, `${carrier}: ${left.pm} + ${right.pm}`).toEqual([
              [left.pm, right.pm].sort(),
            ])
          }
        }
      }
    }
  })

  it('matches production textStyle exclusions without dropping a compatible mark', () => {
    const textStyle = schema.marks.textStyle!
    for (const { ir, pm } of textMarkCases) {
      const markType = schema.marks[pm]!
      const schemaExcludes = markType.excludes(textStyle) || textStyle.excludes(markType)
      const source = docWithChildren([paragraph([{ text: 'styled carrier', marks: [structuredClone(ir)], style: { color: 'red' } }])])

      if (schemaExcludes) {
        expect(() => irToPm(source), `${pm} + textStyle`).toThrow(IRToPmError)
      } else {
        expect(projectCarrier([ir], 'text', { color: 'red' }).map(marks => marks.sort())).toEqual([[pm, 'textStyle'].sort()])
      }
    }
  })

  it.each([
    {
      name: 'code with bold',
      content: [{ text: 'x', marks: [{ type: 'code' }, { type: 'bold' }] }],
      path: 'doc.body[0].children[0].content[0].marks[0]',
    },
    {
      name: 'code with style',
      content: [{ text: 'x', marks: [{ type: 'code' }], style: { color: 'red' } }],
      path: 'doc.body[0].children[0].content[0].marks[0]',
    },
    {
      name: 'same-type references with different targets',
      content: [{ text: 'two targets', marks: [
        { type: 'crossRef', targetId: 'source-chapter', targetKind: 'chapter' },
        { type: 'crossRef', targetId: 'target-chapter', targetKind: 'chapter' },
      ] }],
      path: 'doc.body[0].children[0].content[0].marks[1]',
    },
    {
      name: 'empty external link',
      content: [{ text: '', marks: [{ type: 'externalLink', href: 'https://example.test' }] }],
      path: 'doc.body[0].children[0].content[0].marks[0]',
    },
    {
      name: 'empty variable mark',
      content: [{ text: '', marks: [{ type: 'variable', kind: 'symbol', name: 'x' }] }],
      path: 'doc.body[0].children[0].content[0].marks[0]',
    },
    {
      name: 'empty decorative format mark',
      content: [{ text: '', marks: [{ type: 'bold' }] }],
      path: 'doc.body[0].children[0].content[0].marks[0]',
    },
    {
      name: 'empty text style',
      content: [{ text: '', style: { fontSize: '12pt' } }],
      path: 'doc.body[0].children[0].content[0].style',
    },
  ])('rejects $name before an invalid or lossy PM document is reopened', ({ content, path }) => {
    const source = docWithChildren([paragraph(content as IRInline[])])
    const original = structuredClone(source)
    const error = captureProjectionError(source)

    expect(error.diagnostics).toContainEqual(expect.objectContaining({
      nodeId: 'source-paragraph',
      path,
    }))
    expect(source).toEqual(original)
  })

  it.each([
    {
      name: 'code and bold',
      marks: [{ type: 'code' }, { type: 'bold' }],
    },
    {
      name: 'code and textStyle',
      marks: [{ type: 'code' }, { type: 'textStyle', attrs: { color: 'red' } }],
    },
    {
      name: 'two crossRefs',
      marks: [
        { type: 'crossRef', attrs: { targetId: 'source-chapter', refType: 'chapter' } },
        { type: 'crossRef', attrs: { targetId: 'target-chapter', refType: 'chapter' } },
      ],
    },
  ])('confirms production schema rejects $name mark sets', ({ marks }) => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'chapter', attrs: { nodeId: 'source-chapter' }, content: [
        { type: 'chapterTitle' },
        { type: 'stdParagraph', attrs: { nodeId: 'source-paragraph' }, content: [
          { type: 'text', text: 'x', marks },
        ] },
      ] }],
    })

    expect(() => doc.check()).toThrow(/Invalid collection of marks/)
  })

  it('keeps compatible marks and text, hard-break, formula, and table-footnote carriers through production-schema reopen', () => {
    const table: IRTable = {
      kind: 'table', id: 'table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [],
      rows: [{ id: 'row', cells: [{
        id: 'cell', colspan: 1, rowspan: 1, header: false,
        content: [paragraph([
          { text: '第一行\n第二行', marks: [
            { type: 'italic' },
            { type: 'tableFootnoteRef', id: 'table-ref-a', targetId: 'table-footnote-a' },
            { type: 'tableFootnoteRef', id: 'table-ref-b', targetId: 'table-footnote-b' },
          ] },
          { text: '', formula: { id: 'inline-formula', latex: 'x' }, marks: [
            { type: 'crossRef', targetId: 'target-chapter', targetKind: 'chapter' },
            { type: 'tableFootnoteRef', id: 'table-ref-c', targetId: 'table-footnote-a' },
          ] },
        ], 'table-cell-paragraph')],
      }] }],
      footnotes: [
        { id: 'table-footnote-a', content: [{ text: '脚注甲' }] },
        { id: 'table-footnote-b', content: [{ text: '脚注乙' }] },
      ],
    }
    const authored = docWithChildren([
      paragraph([
        { text: '单独代码', marks: [{ type: 'code' }] },
        { text: '粗斜体', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { text: '带外链文字', marks: [{ type: 'externalLink', href: 'https://example.test' }] },
        { text: '引用文字', marks: [{ type: 'crossRef', targetId: 'target-chapter', targetKind: 'chapter' }, { type: 'italic' }] },
      ]),
      table,
    ])

    const projected = schema.nodeFromJSON(irToPm(authored))
    projected.check()
    const reopened = pmToIr(projected.toJSON() as PMJsonNode).doc
    const reopenedProblems = resolve(reopened).problems
    const referenceIntegrityErrors = new Set<string>([
      'duplicate-id', 'missing-id', 'dangling-footnote', 'invalid-footnote', 'dangling-xref', 'dangling-typed-ref',
    ])
    expect(reopenedProblems.filter(problem => problem.severity === 'error' && referenceIntegrityErrors.has(problem.code))).toEqual([])

    const first = reopened.body[0]!.children[0]
    expect(first.kind).toBe('paragraph')
    if (first.kind !== 'paragraph') throw new Error('Expected paragraph')
    expect(first.content.find(run => run.marks?.some(mark => mark.type === 'code'))).toMatchObject({ text: '单独代码' })
    expect(first.content.find(run => run.text === '粗斜体')?.marks).toEqual([{ type: 'bold' }, { type: 'italic' }])
    expect(first.content.find(run => run.text === '带外链文字')?.marks).toEqual([{ type: 'externalLink', href: 'https://example.test' }])
    expect(first.content.find(run => run.marks?.some(mark => mark.type === 'crossRef'))?.marks).toEqual(expect.arrayContaining([
      { type: 'crossRef', targetId: 'target-chapter', targetKind: 'chapter' },
      { type: 'italic' },
    ]))

    const reopenedTable = reopened.body[0]!.children[1]
    expect(reopenedTable.kind).toBe('table')
    if (reopenedTable.kind !== 'table') throw new Error('Expected table')
    const cellParagraph = reopenedTable.rows[0]!.cells[0]!.content[0]
    expect(cellParagraph.kind).toBe('paragraph')
    if (cellParagraph.kind !== 'paragraph') throw new Error('Expected cell paragraph')
    expect(cellParagraph.content.filter(run => run.text).map(run => run.text).join('')).toBe('第一行\n第二行')
    expect(cellParagraph.content.find(run => run.formula)).toMatchObject({
      text: '', formula: { id: 'inline-formula', latex: 'x' },
      marks: [{ type: 'crossRef', targetId: 'target-chapter', targetKind: 'chapter' }],
    })
    expect(cellParagraph.content.flatMap(run => run.marks ?? []).filter(mark => mark.type === 'tableFootnoteRef')).toEqual([
      { type: 'tableFootnoteRef', id: 'table-ref-a', targetId: 'table-footnote-a' },
      { type: 'tableFootnoteRef', id: 'table-ref-b', targetId: 'table-footnote-b' },
      { type: 'tableFootnoteRef', id: 'table-ref-c', targetId: 'table-footnote-a' },
    ])
  })
})
