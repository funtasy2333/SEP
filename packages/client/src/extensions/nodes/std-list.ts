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
  | 'alpha'          // 字母编号列项 a）b）c）
  | 'numeric'        // 数字编号列项 1）2）3）
  | 'boxedNumeric'   // 方框数字 ① ② ③

/** 将旧文档中的罗马列表类型降级为仍受支持的数字编号列项。 */
export function normalizeStdListType(value: unknown): StdListType {
  if (value === 'roman' || value === 'romanUpper') return 'numeric'
  if (value === 'alpha' || value === 'numeric' || value === 'boxedNumeric') return value
  return 'dash'
}

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
            listType: normalizeStdListType(el.getAttribute('data-list-type')),
            level: parseInt(el.getAttribute('data-level') || '1', 10),
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const listType = normalizeStdListType(node.attrs.listType)
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'std-list',
        'data-list-type': listType,
        'data-level': node.attrs.level,
        class: `std-list std-list-${listType}`,
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
