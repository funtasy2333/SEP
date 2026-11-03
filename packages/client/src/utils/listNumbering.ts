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

/**
 * 一个块节点在列项兄弟序列中的类型键（与 Resolver 的 IR 类型一致），不是列表时为 undefined。
 * 除 stdList 外，StarterKit 的 orderedList / bulletList 也是 IR 列表：含多段或嵌套列表的数字列项由 irToPm
 * 投影为 orderedList，pmToIr 再读回 IR `number`。Resolver 把它算作前一个数字列表，编辑器必须同样计入，
 * 否则其后设为继续编号的数字列项在编辑器里从 1）起，而导出接着它编号。它们自身没有继续编号设置。
 */
function sequenceKey(node: PMNode): string | undefined {
  if (node.type.name === 'stdList') return pmListTypeKey(node.attrs.listType)
  if (node.type.name === 'orderedList') return 'number'
  if (node.type.name === 'bulletList') return 'dash'
  return undefined
}

/** 文档中每个 stdList（按其位置）的编号起点。 */
export function computeEditorListNumbering(doc: PMNode): Map<number, ListNumbering<number>> {
  const result = new Map<number, ListNumbering<number>>()
  const visit = (parent: PMNode, parentPos: number): void => {
    let sequence: ListSequence<number> | undefined
    parent.forEach((child, offset) => {
      const pos = parentPos + offset
      const key = sequenceKey(child)
      if (key !== undefined) {
        sequence ??= new ListSequence<number>()
        const isStd = child.type.name === 'stdList'
        const info = sequence.next(key, isStd && child.attrs.continueNumbering === true, child.childCount, pos)
        // 只给 stdList 记录（装饰与命令只作用于它）；StarterKit 列表只参与序列计数。
        if (isStd) result.set(pos, info)
      }
      // 列表本身也要深入：块级列项（stdListBlockItem）里的嵌套列表各以所在列项为父节点，自成兄弟序列，
      // 与 Resolver 把每个 item.content 当作一个块数组相同。单段列项（stdListItem）是文本块，不会进入。
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
  // 光标所在的最内层列表：单段列项的文字直接在 stdListItem 里；块级列项（stdListBlockItem）的文字在其中的段落里。
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== 'stdList') continue
    const list = $from.node(depth)
    // 选区两端须在同一个列表内（同一列表的列项中），否则无法确定要设置哪一组。
    if ($to.depth < depth || $to.node(depth) !== list || $from.depth === depth || $to.depth === depth) return null
    return { node: list, pos: $from.before(depth) }
  }
  return null
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
      hasPrevious = sequenceKey(sibling) === key
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
