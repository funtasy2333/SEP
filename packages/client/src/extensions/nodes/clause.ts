import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model'
import { setParagraphFormat } from '../../utils/structureEditing'
import { hasReferenceWithin } from '../../utils/textBlockFormat'
import { normalizeUntitledClauses, redirectUntitledNumberSelection, untitledClauseEnter } from '../../utils/untitledClause'

const untitledClauseKey = new PluginKey('untitledClauseNormalize')

/**
 * 删除空条（Backspace / Delete 共用）。条或其子树里任何节点（条、正文段、子条……）被交叉引用时不删除——
 * 删除会让引用失去目标（悬空的类型化引用，导出校验失败）；与 setParagraphFormat、Enter 的检查一致，
 * 调用方吞掉按键，文档与选区不变。
 */
function deleteEmptyClause(editor: Editor, from: number, clause: PMNode) {
  if (hasReferenceWithin(editor.state.doc, clause)) return
  editor.chain().deleteRange({ from, to: from + clause.nodeSize }).run()
}

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
    /**
     * 无题条首段起点再往前（左/上）：光标跳到前一个块末尾。编号块不接收光标（见下方 appendTransaction 重定向），
     * 若交给浏览器默认处理，光标会先进编号块又被拉回首段起点，卡在原地。
     */
    const leaveUntitledClause = ({ editor }: { editor: Editor }) => {
      const { state } = editor
      const { $from, empty } = state.selection
      if (!empty || $from.parent.type.name !== 'stdParagraph' || $from.parentOffset !== 0 || $from.depth < 2) return false
      const owner = $from.node($from.depth - 1)
      if (owner.type.name !== 'clause' || owner.attrs.hasTitle !== false || $from.index($from.depth - 1) !== 1) return false
      const before = Selection.findFrom(state.doc.resolve($from.before($from.depth - 1)), -1, true)
      if (before) editor.view.dispatch(state.tr.setSelection(before).scrollIntoView())
      return true
    }
    return {
      ArrowLeft: leaveUntitledClause,
      ArrowUp: leaveUntitledClause,
      Enter: ({ editor }) => {
        // 无题条正文（规范模型下光标都在这里）：类似编号列表，新建同级无题条，或在空条上退回上一条另起一段
        const untitledEnter = untitledClauseEnter(editor.state)
        if (untitledEnter === 'swallow') return true
        if (untitledEnter) {
          editor.view.dispatch(untitledEnter.scrollIntoView())
          return true
        }
        const { $from } = editor.state.selection
        // 其余仅在无题条的 clauseTitle（无正文块的异常无题条）中按回车时触发
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
        // 在当前 clause 之后插入同级无题条。无题条采用 IR 模型：clauseTitle 为空，
        // 条文在首个 stdParagraph，所以新条带一个空段落，光标进入该正文段。
        const insertPos = $from.after(clauseDepth)
        const schema = editor.state.schema
        const { tr } = editor.state
        const title = schema.nodes.clauseTitle.create({ level }, [])
        const newClause = schema.nodes.clause.create(
          { level, hasTitle: false },
          [title, schema.nodes.stdParagraph.create()],
        )
        tr.insert(insertPos, newClause)
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1 + title.nodeSize + 1))
        editor.view.dispatch(tr)
        return true
      },
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        // 无题条首个正文段的起点退格：解除编号变为段落，而不是把正文并入（空的）编号标题。
        if (empty && $from.parent.type.name === 'stdParagraph' && $from.parentOffset === 0 && $from.depth >= 2) {
          const owner = $from.node($from.depth - 1)
          if (owner.type.name === 'clause' && owner.attrs.hasTitle === false && $from.index($from.depth - 1) === 1) {
            if (owner.textContent.trim() === '' && owner.childCount === 2) {
              deleteEmptyClause(editor, $from.before($from.depth - 1), owner)
            } else {
              setParagraphFormat(editor)
            }
            return true
          }
        }
        // 光标在 clauseTitle 开头时，检查整个 clause 是否为空
        if ($from.parent.type.name === 'clauseTitle' && $from.parentOffset === 0) {
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'clause') {
              // 仅在内容全部为空时删除整个 clause
              if (node.textContent.trim() === '') {
                deleteEmptyClause(editor, $from.before(d), node)
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
                deleteEmptyClause(editor, $from.before(d), node)
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

  addProseMirrorPlugins() {
    return [new Plugin({
      key: untitledClauseKey,
      // 兜底：任何事务（输入、粘贴、撤销、整篇载入）之后，无题条标题里的文字都移入正文段，
      // 保证 hasTitle=false 的条始终满足 IR 模型。追加事务不关闭撤销分组，撤销时与原事务一并还原。
      // 光标也不停在无题条的编号块（空 clauseTitle）里：点击编号、方向键进入时都重定向到首段起点。
      appendTransaction(transactions, _oldState, newState) {
        const docChanged = transactions.some(transaction => transaction.docChanged)
        if (!docChanged && !transactions.some(transaction => transaction.selectionSet)) return null
        const tr = newState.tr
        let changed = docChanged && normalizeUntitledClauses(tr) > 0
        const redirected = redirectUntitledNumberSelection(tr.doc, tr.selection)
        if (redirected) {
          tr.setSelection(redirected)
          changed = true
        }
        return changed ? tr : null
      },
    })]
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
