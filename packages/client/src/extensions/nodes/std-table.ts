import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { normalizePageOrientation, readPageOrientation } from '../../utils/orientation'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    stdTable: {
      insertStdTable: (attrs?: {
        rows?: number
        cols?: number
        captionCn?: string
      }) => ReturnType
    }
  }
}

/**
 * 标准表格节点
 * 包裹表格，添加中/英文表标题和表注
 * 编号格式：表1, 表2, ... 或附录中 表A.1, 表A.2, ...
 */
export const StdTable = Node.create({
  name: 'stdTable',
  group: 'block',
  content: 'tableCaption tableCaptionEn? table tableFootnote?',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 自动编号 */
      number: { default: null },
      orientation: {
        default: 'portrait',
        parseHTML: (element) => readPageOrientation(element),
        renderHTML: (attributes) => ({
          'data-orientation': normalizePageOrientation(attributes.orientation),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="std-table"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'std-table', class: 'std-table-wrapper' }),
      0,
    ]
  },

  addCommands() {
    return {
      insertStdTable:
        (attrs) =>
        ({ chain, editor }) => {
          const rows = attrs?.rows ?? 3
          const cols = attrs?.cols ?? 3

          // 构建表格单元格
          const headerCells = Array.from({ length: cols }, () => ({
            type: 'tableHeader',
            content: [{ type: 'paragraph' }],
          }))
          const bodyCells = Array.from({ length: cols }, () => ({
            type: 'tableCell',
            content: [{ type: 'paragraph' }],
          }))
          const tableRows = [
            { type: 'tableRow', content: headerCells },
            ...Array.from({ length: rows - 1 }, () => ({
              type: 'tableRow',
              content: bodyCells,
            })),
          ]

          // 检查 editor schema 中是否有 table 节点
          const hasTable = !!editor.schema.nodes.table

          return chain()
            .insertContent({
              type: 'stdTable',
              content: [
                {
                  type: 'tableCaption',
                  content: attrs?.captionCn
                    ? [{ type: 'text', text: attrs.captionCn }]
                    : [],
                },
                ...(hasTable
                  ? [{ type: 'table', content: tableRows }]
                  : []),
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 中文表标题
 */
export const TableCaption = Node.create({
  name: 'tableCaption',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-caption"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'table-caption',
        class: 'std-table-caption',
      }),
      0,
    ]
  },
})

/**
 * 英文表标题
 */
export const TableCaptionEn = Node.create({
  name: 'tableCaptionEn',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-caption-en"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'table-caption-en',
        class: 'std-table-caption-en',
        lang: 'en',
      }),
      0,
    ]
  },
})

/**
 * 表注
 */
export const TableFootnote = Node.create({
  name: 'tableFootnote',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-footnote"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'table-footnote',
        class: 'std-table-footnote',
      }),
      0,
    ]
  },
})
