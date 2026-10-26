import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { formatTextBlock } from '../../utils/textBlockFormat'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    note: {
      insertNote: () => ReturnType
    }
    example: {
      insertExample: () => ReturnType
    }
  }
}

/**
 * 光标所在文本块是这些类型时，插入注/示例一律拒绝（返回 false）：在它们里面插入块会把所在容器劈开、让后面的项散落到容器之外。
 * 除原有的正文文本块外，WP8.M G3 加入式中 / 缩略语 / 图例共用的项单元格（whereTerm、whereDefinition）与图例标题。
 */
const NO_BLOCK_INSERT_PARENTS: ReadonlySet<string> = new Set([
  'stdListItem', 'stdParagraph', 'paragraph', 'note', 'example',
  'whereTerm', 'whereDefinition', 'figureLegendTitle',
])

/**
 * 注节点
 * 对应 "注：" 或 "注1：", "注2：" 等
 * 当同一层级有多个注时，自动编号
 */
export const Note = Node.create({
  name: 'note',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      /** 注的序号（同级多个注时使用），null 表示只有一个注 */
      index: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="note"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'note', class: 'std-note' }),
      0,
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      const marker = document.createElement('span')
      const contentDOM = document.createElement('span')
      dom.className = 'std-note std-note-editor'
      dom.dataset.type = 'note'
      marker.className = 'std-note-marker'
      marker.contentEditable = 'false'
      contentDOM.className = 'std-note-content'
      dom.contentEditable = 'true'
      dom.append(marker, contentDOM)

      const updateAttributes = (current: typeof node) => {
        const nodeId = current.attrs.nodeId ?? ''
        if (dom.dataset.nodeId !== nodeId) dom.dataset.nodeId = nodeId
      }
      updateAttributes(node)

      return {
        dom,
        contentDOM,
        update(current) {
          if (current.type !== node.type) return false
          updateAttributes(current)
          return true
        },
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false
          const target = mutation.target
          return target !== contentDOM && !contentDOM.contains(target)
        },
      }
    }
  },

  addCommands() {
    return {
      insertNote:
        () =>
        ({ state, tr, dispatch, chain }) => {
          if (formatTextBlock(state, dispatch ? tr : state.tr, 'note')) return true
          // Unsupported selections stay intact; empty cursors may still insert a new block.
          if (!state.selection.empty || NO_BLOCK_INSERT_PARENTS.has(state.selection.$from.parent.type.name)) return false
          return chain().insertContent({ type: 'note' }).run()
        },
    }
  },
})

/**
 * 示例节点
 * 对应 "示例：" 或 "示例1：", "示例2：" 等
 */
export const Example = Node.create({
  name: 'example',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      index: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="example"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'example', class: 'std-example' }),
      0,
    ]
  },

  addCommands() {
    return {
      insertExample:
        () =>
        ({ state, tr, dispatch, chain }) => {
          if (formatTextBlock(state, dispatch ? tr : state.tr, 'example')) return true
          // Unsupported selections stay intact; empty cursors may still insert a new block.
          if (!state.selection.empty || NO_BLOCK_INSERT_PARENTS.has(state.selection.$from.parent.type.name)) return false
          return chain().insertContent({ type: 'example' }).run()
        },
    }
  },
})
