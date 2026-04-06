import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    termDef: {
      insertTermDef: (attrs?: { level?: number; termCn?: string; termEn?: string }) => ReturnType
    }
  }
}

/**
 * 术语定义节点
 * 对应 GB/T 37967 中的 <term> 元素
 * 结构：术语名（标题） + 英文名 + 定义 + 注(可选) + 示例(可选)
 * 支持 1~5 级，与"条"一致
 */
export const TermDef = Node.create({
  name: 'termDef',
  group: 'block',
  content: 'termName termNameEn? termDefinition (stdParagraph | note | example | termDef)*',
  defining: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 术语编号，如 "3.1" */
      number: { default: null },
      /** 术语条层级 1-5 */
      level: { default: 1 },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="term-def"]',
      getAttrs(dom) {
        const el = dom as HTMLElement
        return {
          level: parseInt(el.getAttribute('data-level') || '1', 10),
        }
      },
    }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'term-def',
        'data-level': node.attrs.level,
        class: `std-term-def std-term-def-level-${node.attrs.level}`,
      }),
      0,
    ]
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection
        // 光标在 termName 开头时，删除整个 termDef
        if ($from.parent.type.name === 'termName' && $from.parentOffset === 0) {
          // 找到 termDef 祖先
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'termDef') {
              // 仅在内容全部为空时删除
              if (node.textContent.trim() === '') {
                const pos = $from.before(d)
                editor.chain()
                  .deleteRange({ from: pos, to: pos + node.nodeSize })
                  .run()
                return true
              }
              break
            }
          }
        }
        return false
      },
    }
  },

  addCommands() {
    return {
      insertTermDef:
        (attrs) =>
        ({ chain }) => {
          const level = attrs?.level ?? 1
          return chain()
            .insertContent({
              type: 'termDef',
              attrs: { level },
              content: [
                {
                  type: 'termName',
                  content: attrs?.termCn ? [{ type: 'text', text: attrs.termCn }] : [],
                },
                {
                  type: 'termNameEn',
                  content: attrs?.termEn ? [{ type: 'text', text: attrs.termEn }] : [],
                },
                {
                  type: 'termDefinition',
                },
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 术语中文名（标题）
 */
export const TermName = Node.create({
  name: 'termName',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="term-name"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'term-name', class: 'std-term-name' }),
      0,
    ]
  },
})

/**
 * 术语英文名
 */
export const TermNameEn = Node.create({
  name: 'termNameEn',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="term-name-en"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'term-name-en',
        class: 'std-term-name-en',
        lang: 'en',
      }),
      0,
    ]
  },
})

/**
 * 术语定义
 */
export const TermDefinition = Node.create({
  name: 'termDefinition',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="term-definition"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'term-definition',
        class: 'std-term-definition',
      }),
      0,
    ]
  },
})
