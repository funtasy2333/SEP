// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { irToPm, pmToIr, type IRDoc, type IRTable, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())

function roundtripHtml(json: object, passes = 2) {
  let current: object = json
  let html = ''
  let reopened = schema.nodeFromJSON(current)
  for (let pass = 0; pass < passes; pass += 1) {
    const source = schema.nodeFromJSON(current)
    source.check()
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
    html = container.innerHTML
    const input = document.createElement('div')
    input.innerHTML = html
    reopened = DOMParser.fromSchema(schema).parse(input)
    reopened.check()
    current = reopened.toJSON()
  }
  return { html, reopened }
}

function nodesOfType(doc: ReturnType<typeof schema.nodeFromJSON>, type: string) {
  const found: typeof doc[] = []
  doc.descendants(node => { if (node.type.name === type) found.push(node as typeof doc) })
  return found
}

function paragraph(text: string) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}

describe('WP6 production-schema lossless model audit', () => {
  it('retains all legal repeated foreword/introduction content and diagnoses lost container boundaries', () => {
    const source = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'foreword', attrs: { nodeId: 'foreword-1' }, content: [paragraph('前言一')] },
      { type: 'foreword', attrs: { nodeId: 'foreword-2' }, content: [paragraph('前言二')] },
      { type: 'introduction', attrs: { nodeId: 'introduction-1' }, content: [paragraph('引言一')] },
      { type: 'introduction', attrs: { nodeId: 'introduction-2' }, content: [paragraph('引言二')] },
      { type: 'chapter', content: [{ type: 'chapterTitle' }] },
    ] })
    expect(() => source.check()).not.toThrow()
    const converted = pmToIr(source.toJSON() as PMJsonNode).doc
    const textOf = (blocks: IRDoc['front']['foreword']) => blocks.flatMap(block => block.kind === 'paragraph' ? block.content.map(run => run.text) : [])
    expect(textOf(converted.front.foreword)).toEqual(['前言一', '前言二'])
    expect(textOf(converted.front.introduction)).toEqual(['引言一', '引言二'])
    expect(converted.unsupportedContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'foreword-2', nodeType: 'foreword' }),
      expect.objectContaining({ nodeId: 'introduction-2', nodeType: 'introduction' }),
    ]))
  })

  it('diagnoses extra legal cover pages instead of silently ignoring their metadata', () => {
    const source = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'coverPage', attrs: { nodeId: 'cover-1', titleCn: '首页' }, content: [paragraph('')] },
      { type: 'coverPage', attrs: { nodeId: 'cover-2', titleCn: '第二封面' }, content: [paragraph('')] },
      { type: 'chapter', content: [{ type: 'chapterTitle' }] },
    ] })
    expect(() => source.check()).not.toThrow()
    const converted = pmToIr(source.toJSON() as PMJsonNode).doc
    expect(converted.meta.title).toBe('首页')
    expect(converted.unsupportedContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'cover-2', nodeType: 'coverPage' }),
    ]))
  })

  it('keeps marks and text style on production hardBreak nodes through PM/IR/PM', () => {
    const format = [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'serif' } }]
    const source = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle' },
      { type: 'stdParagraph', attrs: { nodeId: 'paragraph' }, content: [
        { type: 'text', text: '甲', marks: format },
        { type: 'hardBreak', marks: format },
        { type: 'text', text: '乙', marks: format },
      ] },
    ] }] })
    source.check()
    const first = pmToIr(source.toJSON() as PMJsonNode).doc
    const projected = schema.nodeFromJSON(irToPm(first))
    projected.check()
    const converted = pmToIr(projected.toJSON() as PMJsonNode).doc
    const paragraphBlock = converted.body[0].children[0]
    if (paragraphBlock.kind !== 'paragraph') throw new Error('Expected paragraph')
    expect(paragraphBlock.content).toEqual([
      { text: '甲', marks: [{ type: 'bold' }], style: { fontFamily: 'serif' } },
      { text: '\n', marks: [{ type: 'bold' }], style: { fontFamily: 'serif' } },
      { text: '乙', marks: [{ type: 'bold' }], style: { fontFamily: 'serif' } },
    ])
  })

  it('preserves string-valued formula, cover, bibliography, chapter, and TBX attrs over two HTML parses', () => {
    const source = {
      type: 'doc', content: [
        { type: 'coverPage', attrs: { nodeId: 'cover', standardNo: 'true', titleCn: '007', issuer: 'false', applicant: '007' }, content: [paragraph('')] },
        { type: 'bibliography', content: [
          { type: 'bibliographyTitle', content: [{ type: 'text', text: '参考文献' }] },
          { type: 'bibEntry', attrs: { nodeId: 'bib', entryType: 'true', index: 7 }, content: [{ type: 'text', text: '条目' }] },
        ] },
        { type: 'chapter', attrs: { nodeId: 'chapter', secType: 'true' }, content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '章' }] },
          { type: 'formula', attrs: { nodeId: 'formula', latex: '007', mathml: 'true', numbered: false }, content: [
            { type: 'formulaContent', content: [{ type: 'text', text: '007' }] },
          ] },
          { type: 'termDef', attrs: { nodeId: 'term' }, content: [
            { type: 'termName', content: [{ type: 'text', text: '术语' }] },
            { type: 'termDefinition', content: [{ type: 'text', text: '术语定义' }] },
            { type: 'tbxLangSet', attrs: { nodeId: 'language-set', lang: 'zh' }, content: [
              { type: 'tbxTig', attrs: { nodeId: 'tig' }, content: [
                { type: 'tbxTermVariant', attrs: { nodeId: 'variant' }, content: [
                  { type: 'tbxTerm', content: [{ type: 'text', text: '术语' }] },
                  { type: 'tbxTermDescriptor', attrs: { nodeId: 'descriptor', type: 'false' }, content: [{ type: 'text', text: 'descriptor value' }] },
                ] },
              ] },
            ] },
          ] },
        ] },
      ],
    }
    const { reopened } = roundtripHtml(source)
    const cover = nodesOfType(reopened, 'coverPage')[0]!
    const formula = nodesOfType(reopened, 'formula')[0]!
    const descriptor = nodesOfType(reopened, 'tbxTermDescriptor')[0]!
    const entry = nodesOfType(reopened, 'bibEntry')[0]!
    const chapter = nodesOfType(reopened, 'chapter')[0]!
    expect(cover.attrs).toMatchObject({ standardNo: 'true', titleCn: '007', issuer: 'false', applicant: '007' })
    expect(formula.attrs).toMatchObject({ latex: '007', mathml: 'true', numbered: false })
    expect(descriptor.attrs.type).toBe('false')
    expect(entry.attrs).toMatchObject({ entryType: 'true', index: 7 })
    expect(chapter.attrs.secType).toBe('true')
    const converted = pmToIr(reopened.toJSON() as PMJsonNode).doc
    expect(converted.meta).toMatchObject({ stdCode: 'true', title: '007', issuer: 'false', applicant: '007' })
    expect(converted.body[0].secType).toBe('general')
    expect(converted.unsupportedContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'chapter', nodeType: 'chapter', reason: expect.stringContaining('secType') }),
    ]))
    expect(converted.bibliography[0]?.entryType).toBe('true')
    expect(converted.body[0].children.some(child => child.kind === 'formula' && child.mathml === 'true')).toBe(true)
    const term = converted.body[0].children.find(child => child.kind === 'termEntry')
    expect(term).toMatchObject({
      kind: 'termEntry',
      languageSets: [{ groups: [{ terms: [{ descriptors: [{ kind: 'false', value: [{ text: 'descriptor value' }] }] }] }] }],
    })
  })

  it('retains explicit empty string attrs through two HTML parses without mutating the source JSON', () => {
    const source = {
      type: 'doc', content: [
        { type: 'coverPage', attrs: { nodeId: 'empty-cover', standardType: '', titleEn: '', applicant: '' }, content: [paragraph('')] },
        { type: 'bibliography', content: [
          { type: 'bibliographyTitle' },
          { type: 'bibEntry', attrs: { nodeId: 'empty-bib', entryType: '' } },
        ] },
        { type: 'chapter', attrs: { nodeId: 'empty-chapter', secType: '' }, content: [
          { type: 'chapterTitle' },
          { type: 'formula', attrs: { nodeId: 'empty-formula', latex: '', mathml: '' }, content: [{ type: 'formulaContent' }] },
          { type: 'clause', content: [{ type: 'clauseTitle' }, {
            type: 'stdTable', attrs: {
              unit: '', widthUnit: '', layout: '', borderModel: '', textAlign: '', verticalAlign: '', borderColor: '',
              borderWidthUnit: '', backgroundColor: '', cellPaddingUnit: '',
            }, content: [
              { type: 'tableCaption' },
              { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('值')] }] }] },
            ],
          }, {
            type: 'figure', attrs: { nodeId: 'empty-figure', unit: '' }, content: [
              { type: 'figureImage', attrs: { src: '', alt: '', resourceId: '', widthUnit: '', heightUnit: '', title: '' } },
              { type: 'figureCaption' },
            ],
          }] },
        ] },
      ],
    }
    const original = structuredClone(source)
    const { reopened } = roundtripHtml(source)
    expect(source).toEqual(original)
    expect(nodesOfType(reopened, 'coverPage')[0]!.attrs).toMatchObject({ standardType: '', titleEn: '', applicant: '' })
    expect(nodesOfType(reopened, 'formula')[0]!.attrs).toMatchObject({ latex: '', mathml: '' })
    expect(nodesOfType(reopened, 'bibEntry')[0]!.attrs.entryType).toBe('')
    expect(nodesOfType(reopened, 'chapter')[0]!.attrs.secType).toBe('')
    expect(nodesOfType(reopened, 'stdTable')[0]!.attrs).toMatchObject({
      unit: '', widthUnit: '', layout: '', borderModel: '', textAlign: '', verticalAlign: '', borderColor: '',
      borderWidthUnit: '', backgroundColor: '', cellPaddingUnit: '',
    })
    expect(nodesOfType(reopened, 'figure')[0]!.attrs.unit).toBe('')
    expect(nodesOfType(reopened, 'figureImage')[0]!.attrs).toMatchObject({
      src: '', alt: '', resourceId: '', widthUnit: '', heightUnit: '', title: '',
    })
  })

  it('keeps table textual attrs exact without changing numeric measures', () => {
    const source = { type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle' },
      { type: 'clause', content: [
        { type: 'clauseTitle' },
        { type: 'stdTable', attrs: {
          nodeId: 'table', unit: 'false', width: 25, widthUnit: 'true', layout: '007', borderModel: 'false',
          textAlign: 'true', verticalAlign: '007', borderColor: 'false', borderWidth: 0.5,
          borderWidthUnit: 'true', backgroundColor: '007', cellPadding: 2, cellPaddingUnit: 'false', headerRowCount: 1,
        }, content: [
          { type: 'tableCaption', content: [{ type: 'text', text: '表' }] },
          { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('值')] }] }] },
        ] },
      ] },
    ] }] }
    const { reopened } = roundtripHtml(source)
    const table = nodesOfType(reopened, 'stdTable')[0]!
    expect(table.attrs).toMatchObject({
      unit: 'false', width: 25, widthUnit: 'true', layout: '007', borderModel: 'false',
      textAlign: 'true', verticalAlign: '007', borderColor: 'false', borderWidth: 0.5,
      borderWidthUnit: 'true', backgroundColor: '007', cellPadding: 2, cellPaddingUnit: 'false', headerRowCount: 1,
    })
    const converted = pmToIr(reopened.toJSON() as PMJsonNode).doc
    const tableIR = converted.body[0].children[0]
    if (tableIR.kind !== 'clause') throw new Error('Expected clause')
    const nestedTable = tableIR.children[0] as IRTable
    expect(nestedTable).toMatchObject({
      kind: 'table', unit: 'false', width: { value: 25, unit: 'true' },
      style: {
        layout: '007', borderModel: 'false', textAlign: 'true', verticalAlign: '007', borderColor: 'false',
        borderWidth: { value: 0.5, unit: 'true' }, backgroundColor: '007', cellPadding: { value: 2, unit: 'false' },
      },
    })
    expect(converted.unsupportedContent ?? []).toEqual([])
  })

  it('parses a figure image as one FigureImage node and retains string attrs and numeric dimensions', () => {
    const source = { type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle' },
      { type: 'clause', content: [{ type: 'clauseTitle' }, {
        type: 'figure', attrs: { nodeId: 'figure', unit: 'false' }, content: [
          { type: 'figureImage', attrs: { src: '007', alt: 'false', resourceId: 'true', width: 12, height: 14, widthUnit: '007', heightUnit: 'true', title: 'false' } },
          { type: 'figureCaption', content: [{ type: 'text', text: '图题' }] },
        ],
      }] },
    ] }] }
    const { reopened } = roundtripHtml(source)
    const images = nodesOfType(reopened, 'figureImage')
    expect(images).toHaveLength(1)
    expect(nodesOfType(reopened, 'image')).toHaveLength(0)
    expect(images[0]!.attrs).toMatchObject({
      src: '007', alt: 'false', resourceId: 'true', width: 12, height: 14,
      widthUnit: '007', heightUnit: 'true', title: 'false',
    })
    const converted = pmToIr(reopened.toJSON() as PMJsonNode).doc
    const clause = converted.body[0].children[0]
    if (clause.kind !== 'clause') throw new Error('Expected clause')
    expect(clause.children[0]).toMatchObject({
      kind: 'figure', src: '007', alt: 'false', resourceId: 'true', unit: 'false', title: 'false',
      imageWidth: { value: 12, unit: '007' }, imageHeight: { value: 14, unit: 'true' },
    })
    expect(converted.unsupportedContent ?? []).toEqual([])
  })
})
