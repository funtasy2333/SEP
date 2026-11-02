import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { listOrdinalLabel, listTypeLabel, pmListTypeKey } from '@ses/shared'
import { formatStdList } from '../../utils/textBlockFormat'
import { computeEditorListNumbering, setListNumbering, type ListNumberingMode } from '../../utils/listNumbering'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    stdList: {
      insertStdList: (attrs?: { listType?: string }) => ReturnType
      /** 选区所在列表设为继续前一列项编号（'continue'）或重新编号（'restart'），issue #70 */
      setStdListNumbering: (mode: ListNumberingMode) => ReturnType
    }
  }
}

/** 各有序列项类型在 standard-nodes.css 中使用的 CSS 计数器名。 */
const COUNTER_BY_TYPE: Record<string, string> = { alpha: 'alpha-counter', number: 'numeric-counter', roman: 'roman-counter' }

export const stdListNumberingKey = new PluginKey<DecorationSet>('stdListNumbering')

/**
 * 继续编号的显示（issue #70）：CSS 计数器默认每个列表从头计数；设为继续编号且找到接续目标的列表，
 * 用节点装饰把计数器起点改为「首项序号 − 1」；找不到接续目标的列表标出提示（仍按重新编号显示）。
 * 起点由 computeEditorListNumbering 计算，与 Resolver 同一规则，编辑器所见即导出所得。
 */
function numberingDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  for (const [pos, info] of computeEditorListNumbering(doc)) {
    const node = doc.nodeAt(pos)
    if (!node) continue
    const key = pmListTypeKey(node.attrs.listType)
    if (info.continued) {
      const counter = COUNTER_BY_TYPE[key]
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {
        ...(counter ? { style: `counter-reset: ${counter} ${info.start - 1}` } : {}),
        'data-numbering': 'continue',
        title: `继续前一${listTypeLabel(key)}编号：本组从 ${listOrdinalLabel(key, info.start)} 起`,
      }))
    } else if (info.orphan) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {
        class: 'std-list-continue-orphan',
        'data-numbering': 'orphan',
        title: `设为继续编号，但前面没有同类型的${listTypeLabel(key)}可以接续，已按重新编号显示`,
      }))
    }
  }
  return DecorationSet.create(doc, decorations)
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
      /**
       * 继续前一列项编号（issue #70）：true 时接续同一父节点内前面最近的同类型列表；false（缺省）为重新编号。
       * 只对字母、数字、罗马编号列项有意义。缺省值为 undefined 而不是 false：重新编号的列表在 getJSON()
       * 里不出现该属性，既有文档的 JSON（保存、版本、JSON 导出）保持不变。
       */
      continueNumbering: {
        default: undefined as boolean | undefined,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-continue-numbering') === 'true' ? true : undefined,
        renderHTML: (attributes: Record<string, unknown>) => attributes.continueNumbering === true ? { 'data-continue-numbering': 'true' } : {},
      },
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
            continueNumbering: el.getAttribute('data-continue-numbering') === 'true' ? true : undefined,
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
      setStdListNumbering:
        (mode) =>
        ({ state, tr, dispatch }) => setListNumbering(state, dispatch ? tr : state.tr, mode).ok,
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: stdListNumberingKey,
        state: {
          init: (_config, state) => numberingDecorations(state.doc),
          apply: (tr, previous) => tr.docChanged ? numberingDecorations(tr.doc) : previous,
        },
        props: {
          decorations: (state) => stdListNumberingKey.getState(state),
        },
      }),
    ]
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
