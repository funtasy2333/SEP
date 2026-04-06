import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

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

  addCommands() {
    return {
      insertNote:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'note',
            })
            .run()
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
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'example',
            })
            .run()
        },
    }
  },
})
