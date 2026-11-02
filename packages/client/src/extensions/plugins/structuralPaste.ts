import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'

/**
 * 粘贴时的章条结构规则（issue #71）。
 *
 * 复制跨条（或跨章）的内容时，切片左侧带着“打开的”章、条外壳：复制起点所在的章、条，它们的标题并未被复制。
 * ProseMirror 的 `defining` 同时包含两层含义：
 * - definingAsContext：整段替换某容器的内容时保留该容器；
 * - definingForContent：粘贴内容左侧打开的此类容器要尽量保留。
 * 后者让光标在段落**开头**时把这些外壳整体插到目标段之前，生成标题为空、编号无法解析（显示“?”）的章/条；
 * 在段落中间或结尾粘贴时外壳会并入光标所在的章条。
 *
 * 规则：
 * 1. 章、条、附录、前言、引言只作为上下文 defining（{@link CONTEXT_ONLY_DEFINING}）：左侧打开的外壳（标题未被复制）
 *    不再重建，其内容并入光标所在的章条——段落开头、中间、结尾一致；
 * 2. 标题被复制的条（切片右侧打开或完整的条）仍是条，按 ProseMirror 常规方式与目标章条对齐；
 * 3. 粘贴结果会把章、附录、前言、引言或参考文献嵌进其他节点内部时（例如复制内容跨过了章标题、或粘贴整章到段落中），
 *    拒绝本次粘贴并提示：这种嵌套无法正确编号，也不能导出。文档已有的同类嵌套不影响无关的粘贴；
 * 4. 粘贴（或拖放）新建的条按落点重新确定层级：level 取其上级条的个数 + 1（超过 5 级时保持原值，由校验报告），
 *    与编号一致，不留下“编号是 x.y、样式是更深一级”的跳级条。只改本次新建的条，不动文档中其他条。
 */

/** 这些容器在 Node 定义中不再声明 `defining`，由本扩展的 extendNodeSchema 补上 `definingAsContext`。 */
export const CONTEXT_ONLY_DEFINING = new Set(['chapter', 'clause', 'appendix', 'foreword', 'introduction'])
/** 只能作为文档顶层子节点的结构，嵌入其他节点后无法编号与导出。 */
const TOP_LEVEL_ONLY = new Set(['chapter', 'appendix', 'foreword', 'introduction', 'bibliography'])

export const STRUCTURAL_PASTE_ERROR_MESSAGE =
  '粘贴内容含有章、附录等文档顶层结构（如复制时跨过了章标题），不能粘贴到章条内部；请只复制章内的条文后再粘贴'

function nestedTopLevelCount(doc: PMNode): number {
  let count = 0
  doc.descendants((node, _pos, parent) => {
    if (TOP_LEVEL_ONLY.has(node.type.name) && parent !== doc) count += 1
    return true
  })
  return count
}

const MAX_CLAUSE_LEVEL = 5

/** 本次粘贴/拖放事务在最终文档中插入的范围。 */
function insertedRanges(transactions: readonly Transaction[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  transactions.forEach((tr, index) => {
    const event = tr.getMeta('uiEvent')
    if (!tr.getMeta('paste') && event !== 'paste' && event !== 'drop') return
    tr.steps.forEach((step, stepIndex) => {
      step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        const rest = tr.mapping.slice(stepIndex + 1)
        let from = rest.map(newStart, 1)
        let to = rest.map(newEnd, -1)
        for (const later of transactions.slice(index + 1)) {
          from = later.mapping.map(from, 1)
          to = later.mapping.map(to, -1)
        }
        if (to > from) ranges.push([from, to])
      })
    })
  })
  return ranges
}

/** 规则 4：起点落在插入范围内的条（由本次粘贴新建；拆分后并入其中的原有正文不影响判断），level 与 clauseTitle.level 改为落点层级。 */
function alignPastedClauseLevels(transactions: readonly Transaction[], state: EditorState): Transaction | null {
  const ranges = insertedRanges(transactions)
  if (ranges.length === 0) return null
  const { doc } = state
  const tr = state.tr
  const seen = new Set<number>()
  for (const [from, to] of ranges) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'clause' || pos < from || pos >= to || seen.has(pos)) return true
      seen.add(pos)
      const $pos = doc.resolve(pos)
      let ancestors = 0
      for (let depth = 1; depth <= $pos.depth; depth += 1) if ($pos.node(depth).type.name === 'clause') ancestors += 1
      const level = ancestors + 1
      if (level > MAX_CLAUSE_LEVEL || node.attrs.level === level) return true
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, level })
      const title = node.firstChild
      if (title?.type.name === 'clauseTitle' && title.attrs.level !== level) {
        tr.setNodeMarkup(pos + 1, undefined, { ...title.attrs, level })
      }
      return true
    })
  }
  return tr.docChanged ? tr : null
}

export const structuralPastePluginKey = new PluginKey('structuralPaste')

export function structuralPastePlugin(): Plugin {
  return new Plugin({
    key: structuralPastePluginKey,
    props: {
      handlePaste(view, _event, slice) {
        // 与 ProseMirror doPaste 相同的落点计算；预览事务不派发（规则 3）。
        const preview = view.state.tr
        if (slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1) {
          preview.replaceSelectionWith(slice.content.firstChild!, false)
        } else {
          preview.replaceSelection(slice)
        }
        if (nestedTopLevelCount(preview.doc) <= nestedTopLevelCount(view.state.doc)) return false
        if (typeof window !== 'undefined') {
          // EditorView 对该事件统一显示错误提示（与粘贴引用冲突共用）。
          window.dispatchEvent(new CustomEvent('ses:paste-reference-error', {
            detail: { message: STRUCTURAL_PASTE_ERROR_MESSAGE },
          }))
        }
        return true
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      // 不关闭撤销分组：与粘贴本身一并撤销。
      return alignPastedClauseLevels(transactions, newState)
    },
  })
}

export const StructuralPaste = Extension.create({
  name: 'structuralPaste',
  // 规则 1：只给章条容器补 definingAsContext（不含 definingForContent）。Node 定义里的 defining 会覆盖这里的字段，
  // 所以这些 Node 不再声明 defining（由 structuralPaste.test.ts 守护）。
  extendNodeSchema(extension) {
    return CONTEXT_ONLY_DEFINING.has(extension.name) ? { definingAsContext: true } : {}
  },
  addProseMirrorPlugins() {
    return [structuralPastePlugin()]
  },
})
