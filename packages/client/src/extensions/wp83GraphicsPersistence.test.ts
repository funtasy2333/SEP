import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, IRToPmError, irToPm, pmToIr, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from './editorSchema'
import { Fragment, Slice } from '@tiptap/pm/model'
import { remapPastedSliceIds } from './plugins/ensureNodeId'

describe('WP8.3 图像关系保存', () => {
  it('保存同一图的有序附加图及表格的替代图', () => {
    const source: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' },
      front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [
        { kind: 'figure', id: 'fig', caption: [], orientation: 'portrait', src: 'first.png', notes: [],
          primaryGraphic: { contentType: 'image/png', specificUse: 'size:T' },
          additionalGraphics: [{ id: 'graphic2', src: 'second.png', resourceId: 'resource2', contentType: 'image/png', specificUse: 'size:S' }] },
        { kind: 'table', id: 'table1', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [],
          rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [{ kind: 'paragraph', id: 'p', content: [{ text: '内容' }] }] }] }],
          alternativeGraphic: { id: 'alt', src: 'alt.png', resourceId: 'resource3', contentType: 'image/png' } },
      ] }], appendices: [], bibliography: [], resources: [
        { id: 'resource2', encoding: 'dataUrl', data: 'data:image/png;base64,AA==' },
        { id: 'resource3', encoding: 'dataUrl', data: 'data:image/png;base64,AA==' },
      ],
    }
    const schema = createEditorSchema()
    const first = schema.nodeFromJSON(irToPm(source))
    first.check()
    const figure = first.firstChild!.child(1)
    expect(figure.attrs.additionalGraphics[0]).toMatchObject({ nodeId: 'graphic2', src: 'second.png' })
    expect(first.firstChild!.child(2).attrs.alternativeGraphic).toMatchObject({ nodeId: 'alt', src: 'alt.png' })
    const restored = schema.nodeFromJSON(JSON.parse(JSON.stringify(first.toJSON())))
    restored.check()
    const result = pmToIr(restored.toJSON() as PMJsonNode)
    expect(result.doc.unsupportedContent ?? []).toEqual([])
    expect(result.doc.body[0]!.children[0]).toMatchObject(source.body[0]!.children[0]!)
    expect(result.doc.body[0]!.children[1]).toMatchObject(source.body[0]!.children[1]!)
    expect(schema.nodeFromJSON(irToPm(result.doc)).toJSON()).toEqual(first.toJSON())
    for (const format of ['HTML', 'DOCX', 'XML', 'XML46687'] as const) {
      expect(getOutputSupportProblems(result.doc, format).some(problem => problem.path.includes('additionalGraphics'))).toBe(true)
      expect(getOutputSupportProblems(result.doc, format).some(problem => problem.path.includes('alternativeGraphic'))).toBe(true)
    }
  })

  it('缺少附加图所需资源时阻止投影', () => {
    const source: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [
        { kind: 'figure', id: 'fig', caption: [], orientation: 'portrait', src: 'main.png', notes: [],
          additionalGraphics: [{ id: 'extra', src: 'extra.png', resourceId: 'missing' }] },
      ] }], appendices: [], bibliography: [] }
    expect(() => irToPm(source)).toThrow(IRToPmError)
  })

  it('拒绝损坏的附加图载荷而不静默接受', () => {
    const source: PMJsonNode = { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' },
      { type: 'figure', attrs: { nodeId: 'f', additionalGraphics: [{ id: 'g', src: 42 }] }, content: [
        { type: 'figureImage', attrs: { src: 'main.png' } }, { type: 'figureCaption' },
      ] },
    ] }] }
    expect(pmToIr(source).doc.unsupportedContent).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeType: 'figure', reason: expect.stringContaining('additionalGraphics') }),
    ]))
  })

  it('复制图和表时重映射属性里的图像 ID 并保留外部资源引用', () => {
    const schema = createEditorSchema()
    const source = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter' }, content: [
      { type: 'chapterTitle' },
      { type: 'figure', attrs: { nodeId: 'fig', additionalGraphics: [{ nodeId: 'extra', src: 'extra.png', resourceId: 'resource' }] }, content: [
        { type: 'figureImage', attrs: { src: 'main.png' } }, { type: 'figureCaption' },
      ] },
      { type: 'stdTable', attrs: { nodeId: 'tbl', alternativeGraphic: { nodeId: 'alt', src: 'alt.png', resourceId: 'resource' } }, content: [
        { type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', attrs: { nodeId: 'row' }, content: [
          { type: 'tableCell', attrs: { nodeId: 'cell' }, content: [{ type: 'paragraph' }] },
        ] }] },
      ] },
    ] }] })
    const slice = new Slice(Fragment.from(source.firstChild!), 0, 0)
    const copied = remapPastedSliceIds(slice, source).content.firstChild!
    expect(copied.child(1).attrs.additionalGraphics[0]).toMatchObject({ src: 'extra.png', resourceId: 'resource' })
    expect(copied.child(1).attrs.additionalGraphics[0].nodeId).not.toBe('extra')
    expect(copied.child(2).attrs.alternativeGraphic).toMatchObject({ src: 'alt.png', resourceId: 'resource' })
    expect(copied.child(2).attrs.alternativeGraphic.nodeId).not.toBe('alt')
  })
})
