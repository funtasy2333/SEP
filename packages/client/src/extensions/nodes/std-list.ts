import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { formatStdList } from '../../utils/textBlockFormat'

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
  | 'roman'          // 罗马数字（小写）编号列项 i）ii）iii）（GB/T 46687.2 5.7.2 roman-lower，WP8.M G7）
  | 'dot'            // 间隔号列项 ·
  | 'boxedNumeric'   // 方框数字 ① ② ③

/**
 * 归一化列项类型。小写罗马 `roman` 自 WP8.M G7 起是受支持的类型（原先降级为数字，该契约已撤销）；
 * 大写罗马 `romanUpper` 在 GB/T 46687.2 没有对应取值，仍降级为数字编号列项。
 */
export function normalizeStdListType(value: unknown): StdListType {
  if (value === 'romanUpper') return 'numeric'
  if (value === 'alpha' || value === 'numeric' || value === 'boxedNumeric' || value === 'dot' || value === 'roman') return value
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
            level: ['numeric', 'dot'].includes(el.getAttribute('data-list-type') || '') ? 2 : 1,
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const listType = normalizeStdListType(node.attrs.listType)
    const level = listType === 'numeric' || listType === 'dot' ? 2 : 1
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'std-list',
        'data-list-type': listType,
        'data-level': level,
        class: `std-list std-list-${listType}`,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      insertStdList:
        (attrs) =>
        ({ state, tr, dispatch, chain }) => {
          // 选中列项或正文块时是「格式命令」：转换所选内容，而不是用新列表替换选区（会吞掉文字）。
          const failure = formatStdList(state, dispatch ? tr : state.tr, attrs?.listType || 'dash')
          if (failure === null) return true
          // 只有空段落（'nothing-to-convert'）才插入新列表。被引用的块和一切不支持的位置/选区
          // （不论空光标还是选区：条标题、章标题、术语名、表格单元格…）都失败，文档与选区保持原样：
          // 在那里插入会拆开 defining 的条/章/术语条目，把后半截文字移进新生成的节点。
          if (failure !== 'nothing-to-convert') return false
          return chain()
            .insertContent({
              type: 'stdList',
              attrs: {
                listType: attrs?.listType || 'dash',
                level: attrs?.listType === 'numeric' || attrs?.listType === 'dot' ? 2 : 1,
              },
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
