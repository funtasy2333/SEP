/**
 * 列项编号的「继续前一列项编号／重新编号」（issue #70）：编辑器、Resolver、各出口共用的唯一判定。
 *
 * 规则：
 * - 只有有序列项（IR `alpha` / `number` / `roman`，PM `alpha` / `numeric` / `roman`）有序号，才可以继续编号；
 *   其余类型（破折号、间隔号、方框数字……）忽略该设置。
 * - 列表缺省「重新编号」：首项从 1（a）、1）、i））起，与既有文档的行为相同，旧数据不会串号。
 * - 设为「继续编号」时，接续**同一父节点内、位于它之前、最近的同类型列表**：首项序号 = 该列表末项序号 + 1。
 *   同类型即同层级（字母、罗马为一级，数字为二级），中间隔着段落、注、其他类型的列表（例如二级数字列项）都不影响。
 *   被接续的列表本身也可以是继续编号的，序号因此逐级累加。
 * - 前面没有同类型列表时无法确定接续目标：按重新编号处理，并标为 orphan（编辑器、校验与导出据此提示），
 *   不去跨父节点（其他条、注、表格单元格）寻找，避免误接其他组。
 *
 * 纯函数，同构，不依赖浏览器或 Node 专有 API。
 */

import { listItem } from './strategies'
import type { IRList } from './types'

/** 可以继续编号的 IR 列项类型。 */
export const CONTINUABLE_LIST_TYPES = ['alpha', 'number', 'roman'] as const

/** PM（编辑器 stdList.attrs.listType）列项类型 → IR 列项类型中可继续编号者；其余返回 undefined。 */
const PM_CONTINUABLE: Record<string, string> = { alpha: 'alpha', numeric: 'number', roman: 'roman' }

/** IR 列项类型能否继续编号。 */
export function isContinuableListType(listType: unknown): boolean {
  return typeof listType === 'string' && (CONTINUABLE_LIST_TYPES as readonly string[]).includes(listType)
}

/** PM 列项类型能否继续编号（编辑器 `numeric` 对应 IR `number`）。 */
export function isContinuablePmListType(listType: unknown): boolean {
  return typeof listType === 'string' && Object.prototype.hasOwnProperty.call(PM_CONTINUABLE, listType)
}

/** 列项类型的中文名（提示用）。PM 与 IR 名称都接受。 */
export function listTypeLabel(listType: unknown): string {
  switch (listType) {
    case 'alpha': return '字母编号列项'
    case 'number': case 'numeric': return '数字编号列项'
    case 'roman': return '罗马数字编号列项'
    default: return '列项'
  }
}

/** 一个列表的编号结果。 */
export interface ListNumbering<K = unknown> {
  /** 首项序号（从 1 起）。 */
  start: number
  /** 是否按「继续编号」计算（设置了继续编号且找到了接续目标）。 */
  continued: boolean
  /** 设置了继续编号，但同一父节点内前面没有同类型列表：按重新编号处理。 */
  orphan: boolean
  /** 接续的目标列表（调用方给出的键，如 IR 列表 id 或 PM 位置）；未接续时省略。 */
  previous?: K
}

/**
 * 一个兄弟序列（同一父节点的直接子节点）中的列项编号状态。每个父节点各建一个，按文档顺序对其中的列表依次调用 `next`。
 * `listType` 用 IR 名称（PM 调用方先经 {@link pmListTypeKey} 归一）。
 */
export class ListSequence<K = unknown> {
  private readonly last = new Map<string, { end: number; key: K }>()

  next(listType: string, continueNumbering: boolean, itemCount: number, key: K): ListNumbering<K> {
    if (!isContinuableListType(listType)) return { start: 1, continued: false, orphan: false }
    const previous = this.last.get(listType)
    let result: ListNumbering<K>
    if (!continueNumbering) result = { start: 1, continued: false, orphan: false }
    else if (previous) result = { start: previous.end + 1, continued: true, orphan: false, previous: previous.key }
    else result = { start: 1, continued: false, orphan: true }
    this.last.set(listType, { end: result.start + Math.max(itemCount, 0) - 1, key })
    return result
  }
}

/** PM 列项类型 → 用于 {@link ListSequence} 的 IR 类型键；不可继续编号的类型原样返回。 */
export function pmListTypeKey(listType: unknown): string {
  return typeof listType === 'string' ? PM_CONTINUABLE[listType] ?? listType : 'dash'
}

/** 序号的展示文字（a）、1）、i）），供编辑器提示使用；与 Resolver 的列项标记（strategies.listItem）同一实现。 */
export function listOrdinalLabel(listType: string, ordinal: number): string {
  const key = pmListTypeKey(listType)
  return isContinuableListType(key) ? listItem(key as IRList['listType'], ordinal) : ''
}
