import { getSchema, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { describe, expect, it } from 'vitest'
import { Figure, FigureCaption, FigureCaptionEn, FigureImage } from './figure'
import { StdTable, TableCaption, TableCaptionEn, TableFootnote, TableFootnoteEntry, TableFootnoteRow, TableNoteRow } from './std-table'
import { FootnoteRef, TableFootnoteRef } from './footnotes'
import { Note } from './note'
import { ChapterTitle } from './chapter'
import { serializeToXml } from '../../serializer/xmlSerializer'

const TestChapter = Node.create({
  name: 'chapter',
  group: 'block',
  content: 'chapterTitle (stdTable | figure)*',
})

function createSchema() {
  return getSchema([
    StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, horizontalRule: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    TestChapter,
    ChapterTitle,
    StdTable,
    TableCaption,
    TableCaptionEn,
    TableFootnote,
    TableNoteRow,
    TableFootnoteRow,
    TableFootnoteEntry,
    FootnoteRef,
    TableFootnoteRef,
    Note,
    Figure,
    FigureImage,
    FigureCaption,
    FigureCaptionEn,
  ])
}

describe('图表方向的 ProseMirror 保留', () => {
  it('figure 与 stdTable 节点 schema 可保存并序列化方向属性', () => {
    const schema = createSchema()
    const figure = schema.nodes.figure.create({ orientation: 'landscape' })
    const table = schema.nodes.stdTable.create({ orientation: 'landscape' })

    expect(schema.nodes.figure.spec.attrs?.orientation?.default).toBe('portrait')
    expect(schema.nodes.stdTable.spec.attrs?.orientation?.default).toBe('portrait')
    expect(figure.toJSON().attrs?.orientation).toBe('landscape')
    expect(table.toJSON().attrs?.orientation).toBe('landscape')
    expect(schema.nodeFromJSON(figure.toJSON()).attrs.orientation).toBe('landscape')
    expect(schema.nodeFromJSON(table.toJSON()).attrs.orientation).toBe('landscape')
  })

  it('渲染到编辑器 HTML 时保留 data-orientation', () => {
    const schema = createSchema()
    const figure = schema.nodes.figure.create({ orientation: 'landscape' })
    const table = schema.nodes.stdTable.create({ orientation: 'landscape' })

    for (const [node, tag] of [[figure, 'figure'], [table, 'div']] as const) {
      const output = node.type.spec.toDOM?.(node) as [string, Record<string, unknown>] | undefined
      expect(output?.[0]).toBe(tag)
      expect(output?.[1]['data-orientation']).toBe('landscape')
    }
  })

  it('XML 导出保留横排图表，竖排仍使用默认值', () => {
    const schema = createSchema()
    const paragraph = schema.nodes.paragraph.create()
    const table = schema.nodes.stdTable.create({ orientation: 'landscape' }, [
      schema.nodes.tableCaption.create(),
      schema.nodes.table.create(null, [
        schema.nodes.tableRow.create(null, [schema.nodes.tableCell.create(null, [paragraph])]),
      ]),
    ])
    const figure = schema.nodes.figure.create({ orientation: 'landscape' }, [
      schema.nodes.figureImage.create({ src: 'data:image/png;base64,AA==' }),
      schema.nodes.figureCaption.create(),
    ])
    const portraitFigure = schema.nodes.figure.create(null, [
      schema.nodes.figureImage.create(),
      schema.nodes.figureCaption.create(),
    ])
    const doc = schema.node('doc', null, [
      schema.nodes.chapter.create(null, [schema.nodes.chapterTitle.create(), table, figure, portraitFigure]),
    ])

    const xml = serializeToXml(schema.nodeFromJSON(doc.toJSON()))
    expect(xml).toContain('<table-wrap orientation="landscape">')
    expect(xml).toContain('<fig orientation="landscape">')
    expect(xml).toContain('<fig>')
  })
})
