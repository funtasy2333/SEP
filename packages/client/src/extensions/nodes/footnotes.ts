import { Node, mergeAttributes } from '@tiptap/core'
import { generateNodeId, type PMJsonNode } from '@ses/shared'
import { TextSelection } from '@tiptap/pm/state'
import type { Selection } from '@tiptap/pm/state'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnoteRef: (attrs: { nodeId?: string; content: PMJsonNode[] }) => ReturnType
      updateFootnoteRef: (attrs: { nodeId: string; content: PMJsonNode[] }) => ReturnType
      deleteFootnoteRef: (attrs: { nodeId: string }) => ReturnType
    }
  }
}

const FORBIDDEN_ANCESTORS = new Set([
  'coverPage',
  'chapterTitle', 'clauseTitle', 'appendixTitle',
  'termDef', 'termName', 'termNameEn', 'termDefinition',
  'stdTable', 'table', 'tableCaption', 'tableCaptionEn', 'tableNoteRow', 'tableFootnoteRow', 'tableFootnoteEntry', 'tableFootnote',
  'figure', 'figureCaption', 'figureCaptionEn', 'formula', 'formulaContent', 'formulaDescription',
  'footnoteRef',
])

/** 允许正文文本块中的脚注；标题、术语条目、表格、封面和嵌套脚注由入口共同拦截。 */
export function canInsertBodyFootnote(selection: Selection): boolean {
  const { $from, $to } = selection
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return false
  if (!['stdParagraph', 'paragraph', 'stdListItem', 'bibEntry', 'note', 'example'].includes($from.parent.type.name)) return false
  return !hasForbiddenAncestor($from) && !hasForbiddenAncestor($to)
}

function hasForbiddenAncestor($pos: ResolvedPos): boolean {
  for (let depth = 0; depth <= $pos.depth; depth += 1) {
    if (FORBIDDEN_ANCESTORS.has($pos.node(depth).type.name)) return true
  }
  return false
}

function findFootnote(doc: PMNode, nodeId: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteRef' && node.attrs.nodeId === nodeId) {
      found = { node, pos }
      return false
    }
  })
  return found
}

function dispatchFootnoteEdit(nodeId: string, table = false) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ses:edit-footnote', { detail: { nodeId, table } }))
}

/** 正文脚注引用。正文内容作为 attrs.content 保存，避免伪装成页底 block。 */
export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: [],
        parseHTML: (element) => {
          try { return JSON.parse(element.getAttribute('data-content') || '[]') } catch { return [] }
        },
        renderHTML: (attributes) => ({ 'data-content': JSON.stringify(attributes.content ?? []) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote-ref"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-type': 'footnote-ref', class: 'std-footnote-ref' }), '']
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('sup')
      const label = document.createElement('span')
      dom.className = 'std-footnote-ref'
      dom.dataset.type = 'footnote-ref'
      dom.contentEditable = 'false'
      label.className = 'std-footnote-label'
      dom.append(label)

      const updateAttributes = (current: typeof node) => {
        dom.dataset.nodeId = current.attrs.nodeId ?? ''
        dom.dataset.content = JSON.stringify(current.attrs.content ?? [])
      }
      updateAttributes(node)
      dom.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const id = dom.dataset.nodeId
        if (id) dispatchFootnoteEdit(id)
      })

      return {
        dom,
        update(current) {
          if (current.type !== node.type) return false
          updateAttributes(current)
          return true
        },
      }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-f': () => {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('ses:request-footnote-dialog'))
        return true
      },
    }
  },

  addCommands() {
    return {
      insertFootnoteRef:
        ({ nodeId, content }) =>
        ({ state, dispatch }) => {
          if (!canInsertBodyFootnote(state.selection)) return false
          const pos = state.selection.to
          const ref = state.schema.nodes.footnoteRef.create({ nodeId: nodeId || generateNodeId(), content })
          if (dispatch) {
            const tr = state.tr.insert(pos, ref)
            tr.setSelection(TextSelection.create(tr.doc, pos + ref.nodeSize))
            dispatch(tr)
          }
          return true
        },
      updateFootnoteRef:
        ({ nodeId, content }) =>
        ({ state, dispatch }) => {
          const found = findFootnote(state.doc, nodeId)
          if (!found) return false
          if (dispatch) dispatch(state.tr.setNodeAttribute(found.pos, 'content', content))
          return true
        },
      deleteFootnoteRef:
        ({ nodeId }) =>
        ({ state, dispatch }) => {
          const found = findFootnote(state.doc, nodeId)
          if (!found) return false
          if (dispatch) dispatch(state.tr.delete(found.pos, found.pos + found.node.nodeSize))
          return true
        },
    }
  },
})

/** 表内脚注上标只存目标 entry 的稳定 ID，编号由 shared resolver 统一派生。 */
export const TableFootnoteRef = Node.create({
  name: 'tableFootnoteRef',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      targetId: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="table-footnote-ref"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-type': 'table-footnote-ref', class: 'std-table-footnote-ref' }), '']
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('sup')
      const label = document.createElement('span')
      dom.className = 'std-table-footnote-ref'
      dom.dataset.type = 'table-footnote-ref'
      dom.contentEditable = 'false'
      label.className = 'std-table-footnote-label'
      dom.append(label)

      const updateAttributes = (current: typeof node) => {
        dom.dataset.nodeId = current.attrs.nodeId ?? ''
        dom.dataset.targetId = current.attrs.targetId ?? ''
      }
      updateAttributes(node)
      dom.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const targetId = dom.dataset.targetId
        if (targetId) dispatchFootnoteEdit(targetId, true)
      })

      return {
        dom,
        update(current) {
          if (current.type !== node.type) return false
          updateAttributes(current)
          return true
        },
      }
    }
  },
})
