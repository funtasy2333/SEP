import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState } from '@tiptap/pm/state'
import type { IRInline } from '@ses/shared'
// 相对路径：服务端打包也会加载扩展文件，不认识 '@/' 别名（见 editorSchema.ts）
import { termToLatex } from '../../utils/inlineFormulaLatex'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineFormula: {
      /** 在光标处插入行内公式；只允许在正文类文本块内（{@link INLINE_FORMULA_PARENTS}）。 */
      insertInlineFormula: (options: { latex: string }) => ReturnType
      /** 把 from–to 的文字替换为行内公式；文字与请求时的快照不一致（期间被修改）时拒绝。 */
      replaceSelectionWithFormula: (options: { from: number; to: number; text: string; latex: string }) => ReturnType
      /** 替换 pos 处行内公式的 LaTeX，并清空不再一致的 MathML 与外部源；给出 nodeId 时先核对。 */
      updateFormulaInline: (options: { pos: number; latex: string; nodeId?: string }) => ReturnType
      /** 按当前选区发出插入或「选中文字转公式」请求；不在允许位置时返回 false。 */
      requestInlineFormula: () => ReturnType
    }
  }
}

/**
 * 可以放行内公式的文本块（docs/phase7-inline-formula.md）：正文段落（含单元格内段落）、列项、注、示例、
 * 术语定义、表注、表脚注、式中符号与释义、旧的自由文本式中。标题、图表题、术语名、参考文献等不在其中，
 * 与导出边界一致。公式注（formulaNote）现有出件整体不支持，暂不放开。
 */
export const INLINE_FORMULA_PARENTS: ReadonlySet<string> = new Set([
  'stdParagraph', 'paragraph', 'stdListItem', 'note', 'example', 'termDefinition',
  'tableFootnote', 'tableFootnoteEntry', 'whereTerm', 'whereDefinition', 'formulaDescription',
])

/**
 * 行内公式编辑请求（window 事件 `ses:edit-inline-formula`）：
 * - edit：编辑 pos 处已有的行内公式（nodeId 用于写回前核对）；
 * - insert：在 pos 处插入；
 * - replace：把 pos–to 的文字（快照 text）替换为公式，latex 为预填值；
 * - where：为 pos 处的公式（nodeId 为公式的 nodeId）新增一条式中，确认后才写入条目，取消时文档不变。
 */
export interface InlineFormulaRequest {
  mode: 'edit' | 'insert' | 'replace' | 'where'
  pos: number
  latex: string
  nodeId?: string
  to?: number
  text?: string
}

export const INLINE_FORMULA_EVENT = 'ses:edit-inline-formula'

export function dispatchInlineFormulaRequest(detail: InlineFormulaRequest): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<InlineFormulaRequest>(INLINE_FORMULA_EVENT, { detail }))
}

/**
 * 公式弹窗打开期间文档被替换（载入外部修订会整篇替换，无法用 Mapping 映射旧位置）后，
 * pos 是否仍指向同一处：树路径（各层序号与节点类型）、所在文本块（内容与属性）、块内偏移都不变才算。
 * 修改只发生在该位置之后时仍然放行；位置之前有增删时一律拒绝，避免公式被写到别处。
 */
export function sameInlineLocation(before: PMNode, after: PMNode, pos: number): boolean {
  if (before === after) return true
  if (pos < 0 || pos > before.content.size || pos > after.content.size) return false
  const $before = before.resolve(pos)
  const $after = after.resolve(pos)
  if ($before.depth !== $after.depth || $before.parentOffset !== $after.parentOffset) return false
  for (let depth = 0; depth < $before.depth; depth++) {
    if ($before.index(depth) !== $after.index(depth)) return false
    if ($before.node(depth + 1).type !== $after.node(depth + 1).type) return false
  }
  return $before.parent.eq($after.parent)
}

/** 选区是否落在同一个允许行内公式的文本块内。 */
export function canInsertInlineFormula(state: EditorState): boolean {
  const { $from, $to } = state.selection
  return $from.sameParent($to) && $from.parent.isTextblock && INLINE_FORMULA_PARENTS.has($from.parent.type.name)
}

const PM_TO_IR_MARK: Record<string, IRInline['marks'] extends (infer M)[] | undefined ? M : never> = {
  italic: { type: 'italic' }, subscript: { type: 'sub' }, superscript: { type: 'sup' }, bold: { type: 'bold' },
}

/** 选区内的文字转为 IR 片段；含公式、脚注等行内节点或未知标记时返回 null。 */
function selectionRuns(doc: PMNode, from: number, to: number): IRInline[] | null {
  const runs: IRInline[] = []
  let ok = true
  doc.nodesBetween(from, to, (node, pos) => {
    if (!ok || node.isBlock) return ok
    if (!node.isText) { ok = false; return false }
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + node.nodeSize)
    const marks = node.marks.map(mark => PM_TO_IR_MARK[mark.type.name])
    if (marks.some(mark => !mark)) { ok = false; return false }
    runs.push({ text: node.text!.slice(start - pos, end - pos), ...(marks.length ? { marks: marks as NonNullable<IRInline['marks']> } : {}) })
    return false
  })
  return ok ? runs : null
}

export const InlineFormulaEditing = Extension.create({
  name: 'inlineFormulaEditing',

  addCommands() {
    return {
      insertInlineFormula: ({ latex }) => ({ state, dispatch }) => {
        if (!canInsertInlineFormula(state) || !latex.trim()) return false
        if (dispatch) {
          const node = state.schema.nodes.formulaInline!.create({ latex })
          dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView())
        }
        return true
      },

      replaceSelectionWithFormula: ({ from, to, text, latex }) => ({ state, dispatch }) => {
        if (!latex.trim() || from >= to || to > state.doc.content.size) return false
        const $from = state.doc.resolve(from)
        const $to = state.doc.resolve(to)
        if (!$from.sameParent($to) || !INLINE_FORMULA_PARENTS.has($from.parent.type.name)) return false
        if (state.doc.textBetween(from, to) !== text) return false
        if (dispatch) {
          const node = state.schema.nodes.formulaInline!.create({ latex })
          dispatch(state.tr.replaceWith(from, to, node).scrollIntoView())
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

      requestInlineFormula: () => ({ state }) => {
        const { selection } = state
        if (selection instanceof NodeSelection && selection.node.type.name === 'formulaInline') {
          dispatchInlineFormulaRequest({
            mode: 'edit', pos: selection.from, latex: String(selection.node.attrs.latex ?? ''),
            ...(selection.node.attrs.nodeId ? { nodeId: String(selection.node.attrs.nodeId) } : {}),
          })
          return true
        }
        if (!canInsertInlineFormula(state)) return false
        if (selection.empty) {
          dispatchInlineFormulaRequest({ mode: 'insert', pos: selection.from, latex: '' })
          return true
        }
        const runs = selectionRuns(state.doc, selection.from, selection.to)
        if (!runs) return false
        const text = state.doc.textBetween(selection.from, selection.to)
        dispatchInlineFormulaRequest({
          mode: 'replace', pos: selection.from, to: selection.to, text, latex: termToLatex(runs) ?? text,
        })
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-m': ({ editor }) => editor.commands.requestInlineFormula(),
      Enter: ({ editor }) => {
        const { selection } = editor.state
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'formulaInline') return false
        return editor.commands.requestInlineFormula()
      },
    }
  },
})
