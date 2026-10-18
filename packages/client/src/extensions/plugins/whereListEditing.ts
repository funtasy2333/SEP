import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    whereList: {
      /** 光标在公式内时追加一条式中；公式已有非空自由文本式中时返回 false（先走一键转换）。 */
      addWhereItem: () => ReturnType
      /** 在当前符号格的光标处插入式中符号（行内公式）；只允许在 whereTerm 内。 */
      insertWhereSymbol: (options: { latex: string }) => ReturnType
      /** 替换 pos 处行内公式的 LaTeX，并清空不再一致的 MathML 与外部源。 */
      updateFormulaInline: (options: { pos: number; latex: string; nodeId?: string }) => ReturnType
    }
  }
}

/**
 * 式中符号编辑请求（window 事件 `ses:edit-where-symbol`）：
 * - edit：编辑 pos 处已有的行内公式；
 * - insert：在 pos（符号格内的光标位置）插入新符号。
 */
export interface WhereSymbolRequest {
  mode: 'edit' | 'insert'
  pos: number
  latex: string
  /** edit 时被编辑符号的 nodeId；写回前核对，避免位置因远端修改而指向另一个符号。 */
  nodeId?: string
}

export const WHERE_SYMBOL_EVENT = 'ses:edit-where-symbol'

export function dispatchWhereSymbolRequest(detail: WhereSymbolRequest): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<WhereSymbolRequest>(WHERE_SYMBOL_EVENT, { detail }))
}

function ancestorDepth($pos: ResolvedPos, name: string): number {
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === name) return depth
  return -1
}

function emptyWhereItem(state: EditorState): PMNode {
  const { whereItem, whereTerm, whereDefinition } = state.schema.nodes
  return whereItem!.create(null, [whereTerm!.create(), whereDefinition!.create()])
}

/** 自由文本式中有内容时不能与结构化式中并存（pmToIr 会报 unsupported）。 */
export function formulaHasLegacyDescription(formula: PMNode): boolean {
  let legacy = false
  formula.forEach(child => { if (child.type.name === 'formulaDescription' && child.content.size > 0) legacy = true })
  return legacy
}

/** 当前选区所在的公式；不在公式内时返回 null。 */
export function selectedFormula(state: EditorState): { node: PMNode; pos: number } | null {
  const depth = ancestorDepth(state.selection.$from, 'formula')
  if (depth < 0) return null
  return { node: state.selection.$from.node(depth), pos: state.selection.$from.before(depth) }
}

/** 光标放进 itemPos 处 whereItem 的符号格（offset 0）或释义格（end）。 */
function cursorInItem(doc: PMNode, itemPos: number, cell: 'term' | 'definition'): TextSelection {
  const itemNode = doc.nodeAt(itemPos)!
  const termNode = itemNode.child(0)
  const pos = cell === 'term' ? itemPos + 2 : itemPos + 1 + termNode.nodeSize + 1 + itemNode.child(1).content.size
  return TextSelection.create(doc, pos)
}

function moveToCell(editor: Editor, cell: 'term' | 'definition'): boolean {
  const { $from } = editor.state.selection
  const itemDepth = ancestorDepth($from, 'whereItem')
  if (itemDepth < 0) return false
  const itemPos = $from.before(itemDepth)
  const tr = editor.state.tr.setSelection(cursorInItem(editor.state.doc, itemPos, cell))
  if (cell === 'term') {
    // 回到符号格时停在内容末尾，便于继续输入。
    const termEnd = itemPos + 1 + $from.node(itemDepth).child(0).nodeSize - 1
    tr.setSelection(TextSelection.create(tr.doc, termEnd))
  }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

function insertItemAfter(editor: Editor): boolean {
  const { $from } = editor.state.selection
  const itemDepth = ancestorDepth($from, 'whereItem')
  if (itemDepth < 0) return false
  const after = $from.after(itemDepth)
  const tr = editor.state.tr.insert(after, emptyWhereItem(editor.state))
  tr.setSelection(cursorInItem(tr.doc, after, 'term'))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

function deleteEmptyItem(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.parentOffset !== 0) return false
  const itemDepth = ancestorDepth($from, 'whereItem')
  if (itemDepth < 0) return false
  const itemNode = $from.node(itemDepth)
  if (itemNode.content.size !== 4) {
    // 条目非空：释义开头的 Backspace 只把光标移回符号格，避免默认行为把两格合并或越界删除。
    if ($from.parent.type.name === 'whereDefinition') return moveToCell(editor, 'term')
    return $from.parent.type.name === 'whereTerm'
  }
  const listDepth = itemDepth - 1
  const listNode = $from.node(listDepth)
  const itemPos = $from.before(itemDepth)
  const [from, to] = listNode.childCount === 1
    ? [$from.before(listDepth), $from.after(listDepth)]
    : [itemPos, itemPos + itemNode.nodeSize]
  const tr = editor.state.tr.delete(from, to)
  // 光标回到上一条释义末尾；没有上一条时回到公式源码末尾。
  const index = $from.index(listDepth)
  if (listNode.childCount > 1 && index > 0) {
    const prevPos = itemPos - listNode.child(index - 1).nodeSize
    tr.setSelection(cursorInItem(tr.doc, prevPos, 'definition'))
  } else {
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, from - 1)), -1))
  }
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

const emptyTermKey = new PluginKey('whereEmptyTerm')

/** 结构化式中的编辑行为：添加条目、符号格与释义格之间的 Enter/Tab/Backspace、空符号格占位与点击插入。 */
export const WhereListEditing = Extension.create({
  name: 'whereListEditing',

  addCommands() {
    return {
      addWhereItem: () => ({ state, dispatch }) => {
        const formula = selectedFormula(state)
        if (!formula || formulaHasLegacyDescription(formula.node)) return false
        if (!dispatch) return true
        const tr = state.tr
        let listPos = -1
        let descriptionPos = -1
        formula.node.forEach((child, offset) => {
          const pos = formula.pos + 1 + offset
          if (child.type.name === 'whereList') listPos = pos
          if (child.type.name === 'formulaDescription') descriptionPos = pos
        })
        let itemPos: number
        if (listPos >= 0) {
          const list = state.doc.nodeAt(listPos)!
          itemPos = listPos + list.nodeSize - 1
          tr.insert(itemPos, emptyWhereItem(state))
        } else {
          // whereList 是公式的最后一个子节点（formulaContent formulaDescription? formulaNote* whereList?）。
          const end = formula.pos + formula.node.nodeSize - 1
          tr.insert(end, state.schema.nodes.whereList!.create(null, emptyWhereItem(state)))
          itemPos = end + 1
        }
        if (descriptionPos >= 0) {
          const description = state.doc.nodeAt(descriptionPos)!
          tr.delete(descriptionPos, descriptionPos + description.nodeSize)
          itemPos -= description.nodeSize
        }
        tr.setSelection(cursorInItem(tr.doc, itemPos, 'term'))
        dispatch(tr.scrollIntoView())
        return true
      },

      insertWhereSymbol: ({ latex }) => ({ state, dispatch }) => {
        const { $from } = state.selection
        if ($from.parent.type.name !== 'whereTerm' || !state.selection.$to.sameParent($from) || !latex.trim()) return false
        if (dispatch) {
          const node = state.schema.nodes.formulaInline!.create({ latex })
          const tr = state.tr.replaceSelectionWith(node, false)
          dispatch(tr.scrollIntoView())
        }
        return true
      },

      updateFormulaInline: ({ pos, latex, nodeId }) => ({ state, dispatch }) => {
        const node = state.doc.nodeAt(pos)
        if (!node || node.type.name !== 'formulaInline' || !latex.trim()) return false
        if (nodeId !== undefined && node.attrs.nodeId !== nodeId) return false
        if (dispatch) dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex, mathml: null, source: null }))
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    const inCell = (editor: Editor, name: 'whereTerm' | 'whereDefinition') =>
      editor.state.selection.$from.parent.type.name === name
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (selection instanceof NodeSelection && selection.node.type.name === 'formulaInline') {
          dispatchWhereSymbolRequest({
            mode: 'edit', pos: selection.from, latex: String(selection.node.attrs.latex ?? ''),
            ...(selection.node.attrs.nodeId ? { nodeId: String(selection.node.attrs.nodeId) } : {}),
          })
          return true
        }
        if (inCell(editor, 'whereTerm')) return moveToCell(editor, 'definition')
        if (inCell(editor, 'whereDefinition')) return insertItemAfter(editor)
        return false
      },
      Tab: ({ editor }) => inCell(editor, 'whereTerm') ? moveToCell(editor, 'definition') : false,
      'Shift-Tab': ({ editor }) => inCell(editor, 'whereDefinition') ? moveToCell(editor, 'term') : false,
      Backspace: ({ editor }) => inCell(editor, 'whereTerm') || inCell(editor, 'whereDefinition') ? deleteEmptyItem(editor) : false,
    }
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: emptyTermKey,
      props: {
        decorations(state) {
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'whereTerm') {
              if (node.content.size === 0) decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'where-term-empty' }))
              return false
            }
            return true
          })
          return DecorationSet.create(state.doc, decorations)
        },
        handleClickOn(_view, _pos, node, nodePos, _event, direct) {
          if (!direct || node.type.name !== 'whereTerm' || node.content.size > 0) return false
          dispatchWhereSymbolRequest({ mode: 'insert', pos: nodePos + 1, latex: '' })
          return true
        },
      },
    })]
  },
})
