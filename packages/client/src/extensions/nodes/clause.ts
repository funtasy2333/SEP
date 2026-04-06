import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { DOMOutputSpec } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    clause: {
      insertClause: (attrs?: { level?: number; title?: string; hasTitle?: boolean }) => ReturnType
    }
  }
}

/**
 * 条款节点
 * 对应 GB/T 1.1 中的"条"，支持1~5级
 * 编号格式：3.1, 3.1.1, 3.1.1.1, ...
 */
export const Clause = Node.create({
  name: 'clause',
  group: 'block',
  content: 'clauseTitle (clause | stdParagraph | stdTable | figure | formula | stdList | note | example | block)*',
  defining: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 条款层级 1-5 */
      level: { default: 1 },
      /** 自动编号字符串，如 "3.1.2" */
      number: { default: null },
      /** 是否有标题（有的条款无标题，仅有编号） */
      hasTitle: { default: true },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'section[data-type="clause"]',
        getAttrs(dom) {
          const el = dom as HTMLElement
          return {
            level: parseInt(el.getAttribute('data-level') || '1', 10),
            hasTitle: el.getAttribute('data-has-title') !== 'false',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'clause',
        'data-level': node.attrs.level,
        'data-has-title': node.attrs.hasTitle,
        class: `std-clause std-clause-level-${node.attrs.level}`,
      }),
      0,
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection
        // 仅在无题条的 clauseTitle 中按回车时触发
        if ($from.parent.type.name !== 'clauseTitle') return false
        // 找到所属的 clause 节点
        let clauseDepth = -1
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'clause') {
            clauseDepth = d
            break
          }
        }
        if (clauseDepth < 0) return false
        const clauseNode = $from.node(clauseDepth)
        // 仅对无题条生效
        if (clauseNode.attrs.hasTitle !== false) return false
        const level = clauseNode.attrs.level
        // 在当前 clause 之后插入同级无题条
        const insertPos = $from.after(clauseDepth)
        const schema = editor.state.schema
        const { tr } = editor.state
        const newClause = schema.nodes.clause.create(
          { level, hasTitle: false },
          [schema.nodes.clauseTitle.create({ level }, [])],
        )
        tr.insert(insertPos, newClause)
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 2))
        editor.view.dispatch(tr)
        return true
      },
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection
        // 光标在 clauseTitle 开头时，检查整个 clause 是否为空
        if ($from.parent.type.name === 'clauseTitle' && $from.parentOffset === 0) {
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'clause') {
              // 仅在内容全部为空时删除整个 clause
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
      Delete: ({ editor }) => {
        const { $from } = editor.state.selection
        if ($from.parent.type.name === 'clauseTitle' && $from.parentOffset === 0) {
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'clause') {
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
      insertClause:
        (attrs) =>
        ({ chain }) => {
          const level = attrs?.level ?? 1
          const hasTitle = attrs?.hasTitle !== false
          return chain()
            .insertContent({
              type: 'clause',
              attrs: { level, hasTitle },
              content: [
                {
                  type: 'clauseTitle',
                  attrs: { level },
                  content: (hasTitle && attrs?.title) ? [{ type: 'text', text: attrs.title }] : [],
                },
                {
                  type: 'stdParagraph',
                },
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 条标题节点
 * 根据 level 渲染为 h3~h6
 */
export const ClauseTitle = Node.create({
  name: 'clauseTitle',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      level: { default: 1 },
    }
  },

  parseHTML() {
    return [
      { tag: 'h3[data-type="clause-title"]', attrs: { level: 1 } },
      { tag: 'h4[data-type="clause-title"]', attrs: { level: 2 } },
      { tag: 'h5[data-type="clause-title"]', attrs: { level: 3 } },
      { tag: 'h6[data-type="clause-title"]', attrs: { level: 4 } },
    ]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const tagLevel = Math.min(node.attrs.level + 2, 6)
    const tag = `h${tagLevel}` as 'h3' | 'h4' | 'h5' | 'h6'
    return [
      tag,
      mergeAttributes(HTMLAttributes, {
        'data-type': 'clause-title',
        'data-level': node.attrs.level,
        class: `std-clause-title std-clause-title-${node.attrs.level}`,
      }),
      0,
    ]
  },
})
