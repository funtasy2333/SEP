import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import {
  ListSequence, isContinuablePmListType, listOrdinalLabel, listTypeLabel, pmListTypeKey, type ListNumbering,
} from '@ses/shared'

/**
 * 编辑器里的列项「继续前一列项编号／重新编号」（issue #70）。
 *
 * 接续规则与 Resolver（shared/ir/listNumbering.ts 的 ListSequence）同一实现：每个父节点的直接子节点是一个兄弟序列，
 * 设为继续编号的 stdList 接续其前最近的同类型 stdList；所以编辑器显示、内部引用文字和各出口的编号相同。
 */

/** 文档中每个 stdList（按其位置）的编号起点。 */
export function computeEditorListNumbering(doc: PMNode): Map<number, ListNumbering<number>> {
  const result = new Map<number, ListNumbering<number>>()
  const visit = (parent: PMNode, parentPos: number): void => {
    let sequence: ListSequence<number> | undefined
    parent.forEach((child, offset) => {
      const pos = parentPos + offset
      if (child.type.name === 'stdList') {
        sequence ??= new ListSequence<number>()
        result.set(pos, sequence.next(pmListTypeKey(child.attrs.listType), child.attrs.continueNumbering === true, child.childCount, pos))
        return
      }
      if (!child.isTextblock && !child.isLeaf && child.childCount > 0) visit(child, pos + 1)
    })
  }
  visit(doc, 0)
  return result
}

export type ListNumberingMode = 'continue' | 'restart'

export type ListNumberingFailure =
  /** 光标不在列项内（或选区跨越多个列表） */
  | 'not-in-list'
  /** 破折号、间隔号等没有序号的列项 */
  | 'unordered'
  /** 同一位置前面没有同类型列项可以接续 */
  | 'no-previous'

export type ListNumberingResult =
  | { ok: true; changed: boolean; start: number; listType: string }
  | { ok: false; reason: ListNumberingFailure; listType?: string }

/** 选区所在的单个 stdList（选区必须落在同一个列表的列项里）。 */
export function selectedStdList(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from, $to } = state.selection
  if ($from.parent.type.name !== 'stdListItem' || $to.parent.type.name !== 'stdListItem') return null
  const depth = $from.depth - 1
  const list = $from.node(depth)
  if (list.type.name !== 'stdList' || $to.depth !== $from.depth || $to.node(depth) !== list) return null
  return { node: list, pos: $from.before(depth) }
}

/** 列表首项序号在当前文档中的值（未在文档中时为 1）。 */
function startAt(doc: PMNode, pos: number): number {
  return computeEditorListNumbering(doc).get(pos)?.start ?? 1
}

/**
 * 把选区所在列表设为继续前一列项编号或重新编号。只改该列表的 `continueNumbering` 属性（可撤销、随文档保存）。
 * 继续编号要求同一父节点内前面有同类型列表；没有时拒绝并说明，避免误接其他组。
 */
export function setListNumbering(state: EditorState, tr: Transaction, mode: ListNumberingMode): ListNumberingResult {
  const target = selectedStdList(state)
  if (!target) return { ok: false, reason: 'not-in-list' }
  const { node, pos } = target
  const listType = String(node.attrs.listType ?? 'dash')
  if (!isContinuablePmListType(listType)) return { ok: false, reason: 'unordered', listType }
  const continueNumbering = mode === 'continue'
  if (continueNumbering) {
    const $pos = state.doc.resolve(pos)
    const parent = $pos.parent
    const key = pmListTypeKey(listType)
    let hasPrevious = false
    for (let index = $pos.index() - 1; index >= 0 && !hasPrevious; index -= 1) {
      const sibling = parent.child(index)
      hasPrevious = sibling.type.name === 'stdList' && pmListTypeKey(sibling.attrs.listType) === key
    }
    if (!hasPrevious) return { ok: false, reason: 'no-previous', listType }
  }
  const changed = (node.attrs.continueNumbering === true) !== continueNumbering
  // 重新编号写回缺省值（undefined），getJSON() 不出现该属性，与从未设置过的列表完全相同。
  if (changed) tr.setNodeMarkup(pos, undefined, { ...node.attrs, continueNumbering: continueNumbering ? true : undefined }, node.marks)
  return { ok: true, changed, start: startAt(changed ? tr.doc : state.doc, pos), listType }
}

/** 操作结果的中文提示。 */
export function listNumberingMessage(result: ListNumberingResult, mode: ListNumberingMode): string {
  if (!result.ok) {
    const what = listTypeLabel(result.listType)
    switch (result.reason) {
      case 'not-in-list': return '请先把光标放在要设置的列项内（选区不能跨越多个列表）'
      case 'unordered': return `${what}没有序号，不需要设置继续或重新编号`
      case 'no-previous': return `本条（或同一注、单元格）中这组列项前面没有同类型的${what}，无法继续编号；已保持重新编号`
    }
  }
  const first = listOrdinalLabel(result.listType, result.start)
  if (mode === 'continue') return result.changed ? `已继续前一列项编号，本组从 ${first} 起` : `本组已是继续编号（从 ${first} 起）`
  return result.changed ? `已重新编号，本组从 ${first} 起` : `本组已是重新编号（从 ${first} 起）`
}
