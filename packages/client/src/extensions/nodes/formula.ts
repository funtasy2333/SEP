import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import type { DOMOutputSpec, Node as PMNode, NodeType } from '@tiptap/pm/model'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import katex from 'katex'
import { renderNativeMathMl } from '../../utils/nativeMathMlPreview'

type FormulaInsertion = { pos: number; triggerPos?: number }
type FormulaInput = { triggerPos?: number; pos?: never; latex?: never } | (FormulaInsertion & { latex: string })

export type BlockFormulaRequest =
  | ({ mode: 'block-insert'; latex: string } & FormulaInsertion)
  | { mode: 'block-edit'; pos: number; latex: string }

export const BLOCK_FORMULA_EVENT = 'ses:block-formula'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: {
      insertFormula: (options?: FormulaInput) => ReturnType
      updateBlockFormula: (options: { pos: number; latex: string }) => ReturnType
    }
  }
}

const formulaContainers = new Set(['chapter', 'clause', 'foreword', 'introduction', 'appendix'])

function formulaInsertionPosition(state: EditorState, formula: NodeType): number {
  const { $from, to } = state.selection
  if (state.selection instanceof NodeSelection && canInsertFormula(state.doc, to, formula)) return to
  for (let depth = $from.depth; depth > 0; depth--) {
    if (formulaContainers.has($from.node(depth).type.name)) return $from.after(Math.min(depth + 1, $from.depth))
  }
  return $from.depth ? $from.after($from.depth) : to
}

function canInsertFormula(doc: PMNode, pos: number, formula: NodeType): boolean {
  if (pos < 0 || pos > doc.content.size) return false
  const $pos = doc.resolve(pos)
  return !$pos.textOffset && $pos.parent.canReplaceWith($pos.index(), $pos.index(), formula)
}

function requestBlockFormulaDialog(editor: Editor, detail: BlockFormulaRequest): void {
  editor.view.dom.dispatchEvent(new CustomEvent<BlockFormulaRequest>(BLOCK_FORMULA_EVENT, { detail, bubbles: true }))
}

function requestBlockFormulaEdit(editor: Editor, contentPos: number): boolean {
  const content = editor.state.doc.nodeAt(contentPos)
  if (!editor.isEditable || content?.type.name !== 'formulaContent') return false
  editor.commands.setNodeSelection(contentPos)
  requestBlockFormulaDialog(editor, { mode: 'block-edit', pos: contentPos - 1, latex: content.textContent })
  return true
}

/** 替换 LaTeX 的变更区间，同时保留旧文档中的行内节点和未改动的文本格式。 */
function replaceFormulaSource(source: PMNode, latex: string): PMNode {
  const previous = source.textContent
  let start = 0
  while (start < previous.length && start < latex.length && previous[start] === latex[start]) start++
  let oldEnd = previous.length
  let newEnd = latex.length
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === latex[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const replacement = latex.slice(start, newEnd)
  const content: PMNode[] = []
  let offset = 0
  let inserted = false
  source.forEach(child => {
    if (!child.isText) {
      content.push(child)
      return
    }
    const text = child.text!
    const end = offset + text.length
    if (end < start || offset >= oldEnd && inserted) {
      content.push(child)
    } else {
      const prefix = text.slice(0, Math.max(0, start - offset))
      const suffix = text.slice(Math.max(0, oldEnd - offset))
      const updated = prefix + (inserted ? '' : replacement) + suffix
      if (updated) content.push(child.type.schema.text(updated, child.marks))
      inserted = true
    }
    offset = end
  })
  if (!inserted && replacement) content.push(source.type.schema.text(replacement))
  return source.type.create(source.attrs, content)
}

export const FormulaGroup = Node.create({
  name: 'formulaGroup', group: 'block', content: 'formula+', defining: true,
  addAttributes() { return { numbered: { default: false, validate: (value: unknown) => { if (typeof value !== 'boolean') throw new RangeError('公式组编号属性必须是布尔值') }, parseHTML: (element: HTMLElement) => element.getAttribute('data-numbered') === 'true',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-numbered': String(attrs.numbered) }) } } },
  parseHTML() { return [{ tag: 'div[data-type="formula-group"]' }] },
  renderHTML({ HTMLAttributes }): DOMOutputSpec { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'formula-group' }), 0] },
})

/**
 * 公式节点
 * 包含公式内容和编号
 */
export const Formula = Node.create({
  name: 'formula',
  group: 'block',
  content: 'formulaContent formulaDescription? formulaNote* whereList?',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null },
      number: { default: null },
      /** 未编号公式也必须在生产JSON中保留，避免重开时改变后续编号。 */
      numbered: { default: null },
      /** 原生 MathML 原文，作为不经 LaTeX 反译的权威表示保留。 */
      mathml: { default: null, parseHTML: (element) => element.getAttribute('mathml') },
      /** 可用的 LaTeX 编辑源；不要求从 MathML 反向推导。 */
      latex: { default: null, parseHTML: (element) => element.getAttribute('latex') },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="formula"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'formula', class: 'std-formula' }),
      0,
    ]
  },

  addCommands() {
    return {
      insertFormula: ({ pos: requestedPos, triggerPos, latex } = {}) => ({ editor, state, tr, dispatch }) => {
        const pos = requestedPos ?? formulaInsertionPosition(state, this.type)
        if (!editor.isEditable || !canInsertFormula(state.doc, pos, this.type)) return false
        if (triggerPos !== undefined && (triggerPos < 0 || triggerPos >= pos || state.doc.textBetween(triggerPos, triggerPos + 1) !== '/')) return false
        if (latex === undefined) {
          if (dispatch) requestBlockFormulaDialog(editor, { mode: 'block-insert', pos, triggerPos, latex: '' })
          return true
        }
        if (!latex.trim()) return false
        if (dispatch) {
          const content = state.schema.nodes.formulaContent!.create(null, state.schema.text(latex))
          if (triggerPos !== undefined) tr.delete(triggerPos, triggerPos + 1)
          const mappedPos = tr.mapping.map(pos)
          tr.insert(mappedPos, this.type.create({ latex }, content))
          tr.setSelection(NodeSelection.create(tr.doc, mappedPos + 1)).scrollIntoView()
        }
        return true
      },
      updateBlockFormula: ({ pos, latex }) => ({ state, tr, dispatch }) => {
        const formula = state.doc.nodeAt(pos)
        const source = formula?.firstChild
        if (formula?.type !== this.type || !source || !latex.trim()) return false
        if (dispatch && source.textContent.trim() !== latex) {
          tr.replaceWith(pos + 1, pos + 1 + source.nodeSize, replaceFormulaSource(source, latex))
          tr.setNodeMarkup(pos, undefined, { ...formula.attrs, latex, mathml: null })
          tr.setSelection(NodeSelection.create(tr.doc, pos + 1)).scrollIntoView()
        }
        return true
      },
    }
  },
})

/**
 * 公式内容保留在文档节点中，编辑器只显示渲染结果。
 */
export const FormulaContent = Node.create({
  name: 'formulaContent',
  content: 'inline*',
  defining: true,
  atom: true,

  parseHTML() {
    return [{ tag: 'div[data-type="formula-content"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'formula-content',
        class: 'std-formula-content',
      }),
      0,
    ]
  },

  addNodeView() {
    return ({ editor, node, getPos, view }) => {
      const dom = document.createElement('div')
      dom.className = 'std-formula-content'
      dom.dataset.type = 'formula-content'
      dom.contentEditable = 'false'
      const preview = document.createElement('button')
      preview.type = 'button'
      preview.className = 'std-formula-preview'
      preview.title = '点击编辑公式'
      dom.append(preview)

      function render(content: PMNode): void {
        const latex = content.textContent.trim()
        const pos = getPos()
        const mathml = typeof pos === 'number' ? view.state.doc.nodeAt(pos - 1)?.attrs.mathml : null
        if (latex) {
          try {
            preview.innerHTML = katex.renderToString(latex, { displayMode: true, throwOnError: true, strict: 'ignore' })
            return
          } catch {
            // Imported documents can contain source KaTeX cannot parse.
          }
        }
        const nativeMath = typeof mathml === 'string' ? renderNativeMathMl(mathml) : null
        if (nativeMath) preview.replaceChildren(nativeMath)
        else preview.textContent = latex || mathml ? '公式无法渲染' : '空公式'
      }

      render(node)
      preview.addEventListener('click', () => {
        const pos = getPos()
        if (typeof pos === 'number') requestBlockFormulaEdit(editor, pos)
      })
      return {
        dom,
        stopEvent: event => event.type === 'mousedown' || event.type === 'click' || event.type === 'keydown',
        ignoreMutation: () => true,
        update(content) {
          if (content.type !== node.type) return false
          render(content)
          return true
        },
      }
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state
        return selection instanceof NodeSelection && selection.node.type === this.type
          && requestBlockFormulaEdit(editor, selection.from)
      },
    }
  },
})

/**
 * 公式说明（式中...）
 */
export const FormulaDescription = Node.create({
  name: 'formulaDescription',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="formula-description"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'formula-description',
        class: 'std-formula-description',
      }),
      0,
    ]
  },
})
