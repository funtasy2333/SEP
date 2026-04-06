import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    stdList: {
      insertStdList: (attrs?: { listType?: string }) => ReturnType
    }
  }
}

/**
 * 标准列表类型
 */
export type StdListType =
  | 'dash'           // 破折号列项 ——
  | 'alpha'          // 字母编号列项 a) b) c)
  | 'numeric'        // 数字编号列项 1) 2) 3)
  | 'roman'          // 小写罗马数字 i) ii) iii)
  | 'romanUpper'     // 大写罗马数字 I) II) III)
  | 'boxedNumeric'   // 方框数字 ① ② ③

/**
 * 标准列表节点
 * 支持 GB/T 1.1 中规定的多种列表格式
 */
export const StdList = Node.create({
  name: 'stdList',
  group: 'block',
  content: 'stdListItem+',
  defining: true,

  addAttributes() {
    return {
      /** 列表类型 */
      listType: { default: 'dash' as StdListType },
      /** 列表层级 (1 或 2) */
      level: { default: 1 },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="std-list"]',
        getAttrs(dom) {
          const el = dom as HTMLElement
          return {
            listType: el.getAttribute('data-list-type') || 'dash',
            level: parseInt(el.getAttribute('data-level') || '1', 10),
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'std-list',
        'data-list-type': node.attrs.listType,
        'data-level': node.attrs.level,
        class: `std-list std-list-${node.attrs.listType}`,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      insertStdList:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'stdList',
              attrs: { listType: attrs?.listType || 'dash' },
              content: [
                { type: 'stdListItem' },
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 标准列表项
 */
export const StdListItem = Node.create({
  name: 'stdListItem',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      /** 自动生成的编号/符号 */
      marker: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="std-list-item"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'std-list-item',
        class: 'std-list-item',
      }),
      0,
    ]
  },
})
