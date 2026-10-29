// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems, IRToPmError, irToPm, pmToIr, type IRDoc, type PMJsonNode } from '@ses/shared'
import { createEditorSchema } from './editorSchema'
import { DOMParser, DOMSerializer, Fragment, Slice } from '@tiptap/pm/model'
import { remapPastedSliceIds } from './plugins/ensureNodeId'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from './editorExtensions'

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

  it('经 HTML 复制后仍保留附加图和替代图属性', () => {
    const schema = createEditorSchema()
    const source = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'figure', attrs: { nodeId: 'f', primaryGraphic: { specificUse: 'size:T' },
        additionalGraphics: [{ nodeId: 'g', src: 'extra.png', resourceId: 'r' }] }, content: [
        { type: 'figureImage', attrs: { src: 'main.png' } }, { type: 'figureCaption' },
      ] }, { type: 'stdTable', attrs: { nodeId: 't', alternativeGraphic: { nodeId: 'alt', src: 'alt.png' } }, content: [
        { type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
      ] },
    ] }] })
    const host = document.createElement('div')
    host.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
    const result = DOMParser.fromSchema(schema).parse(host)
    expect(result.firstChild!.child(1).attrs.additionalGraphics).toEqual([{ nodeId: 'g', src: 'extra.png', resourceId: 'r' }])
    expect(result.firstChild!.child(1).attrs.primaryGraphic).toEqual({ specificUse: 'size:T' })
    expect(result.firstChild!.child(2).attrs.alternativeGraphic).toEqual({ nodeId: 'alt', src: 'alt.png' })
  })

  it('编辑视图展示全部附加图和所属表替代图', () => {
    const editor = new Editor({ extensions: createEditorExtensions(), content: { type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'figure', attrs: { nodeId: 'f', additionalGraphics: [{ nodeId: 'g', src: 'extra.png' }] }, content: [
        { type: 'figureImage', attrs: { src: 'main.png' } }, { type: 'figureCaption' },
      ] }, { type: 'stdTable', attrs: { nodeId: 't', alternativeGraphic: { nodeId: 'alt', src: 'alt.png' } }, content: [
        { type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
      ] },
    ] }] } })
    expect(editor.view.dom.querySelector('[data-graphic-id="g"]')?.getAttribute('src')).toBe('extra.png')
    expect(editor.view.dom.querySelector('[data-graphic-id="alt"]')?.getAttribute('src')).toBe('alt.png')
    editor.destroy()
  })

  it('HTML 粘贴保留公式组编号、数组列组和共享脚注关系', () => {
    const schema = createEditorSchema()
    const source = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'c' }, content: [
      { type: 'chapterTitle' }, { type: 'formulaGroup', attrs: { nodeId: 'fg', numbered: true }, content: [
        { type: 'formula', attrs: { nodeId: 'f', numbered: false }, content: [{ type: 'formulaContent' }] },
      ] }, { type: 'alignedArray', attrs: { nodeId: 'a', columns: [{}, {}], columnGroups: [{ start: 0, count: 2 }] }, content: [
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }, { type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
      ] }, { type: 'stdParagraph', attrs: { nodeId: 'p' }, content: [
        { type: 'sharedFootnoteRef', attrs: { targetId: 'fn', refText: '1' } },
        { type: 'sharedFootnoteDefinition', attrs: { nodeId: 'fn', content: [{ type: 'text', text: '脚注' }] } },
      ] },
    ] }] })
    const host = document.createElement('div')
    host.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(source.content))
    const result = DOMParser.fromSchema(schema).parse(host)
    const chapter = result.firstChild!
    expect(chapter.child(1).attrs.numbered).toBe(true)
    expect(chapter.child(2).attrs.columnGroups).toEqual([{ start: 0, count: 2 }])
    expect(chapter.child(3).child(0).attrs).toMatchObject({ targetId: 'fn', refText: '1' })
    expect(chapter.child(3).child(1).attrs).toMatchObject({ nodeId: 'fn', content: [{ type: 'text', text: '脚注' }] })
  })
})
