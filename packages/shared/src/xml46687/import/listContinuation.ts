/**
 * 由 `list-item/label` 恢复「继续前一列项编号」（issue #70 与 WP8.3 导入的衔接）。
 *
 * XML46687 导出把继续编号的列表写成接续后的标号（如 b)、c)），但 XML 没有表达“接续”的属性。
 * 导入若只按结构重算编号，这组列项会静默变回 a) 起编。这里在整篇映射完成后，按文档顺序检查每个有序列表
 * 首个列项的 label：
 * - 与从头编号的标号一致：保持重新编号（缺省）；
 * - 否则试设为继续编号，用 Resolver 的同一规则（同一父节点内前一个同类型列表）算出起始序号，
 *   与 label 一致才保留，否则还原——label 既不像从头编号也不像接续时，导入结果与以前相同。
 * 只看首个列项；没有 label、无序列表、渲染时没有标号的嵌套列表都不处理。
 */

import { computeListNumbering, computeOrderedListMarkers } from '../../ir/resolve'
import { isContinuableListType } from '../../ir/listNumbering'
import { listItem } from '../../ir/strategies'
import type { IRDoc, IRList } from '../../ir/types'

/** 映射时记下的首个列项 label 原文（键为映射出的 IR 列表对象）。 */
const firstLabels = new WeakMap<IRList, string>()

export function recordFirstListLabel(list: IRList, label: string | undefined): void {
  if (label !== undefined) firstLabels.set(list, label)
}

/** 全角/半角括号、首尾空白不影响比较（导出把“）”写成半角，D-X-07）。 */
function normalizeLabel(label: string): string {
  return label.replace(/）/g, ')').replace(/（/g, '(').trim()
}

/** 文档中的列表，按文档顺序（同一父节点内的兄弟按先后）。 */
function listsInOrder(value: unknown, out: IRList[] = []): IRList[] {
  if (Array.isArray(value)) {
    for (const item of value) listsInOrder(item, out)
  } else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (object.kind === 'list' && Array.isArray(object.items)) out.push(object as unknown as IRList)
    for (const key of Object.keys(object)) listsInOrder(object[key], out)
  }
  return out
}

export function inferListContinuation(doc: IRDoc): void {
  const freshMarkers = computeOrderedListMarkers(doc)
  for (const list of listsInOrder(doc)) {
    const label = firstLabels.get(list)
    const firstItem = list.items[0]
    if (label === undefined || !firstItem || list.continueNumbering || !isContinuableListType(list.listType)) continue
    const fresh = freshMarkers[firstItem.id]
    if (!fresh || normalizeLabel(fresh) === normalizeLabel(label)) continue
    list.continueNumbering = true
    const numbering = computeListNumbering(doc)[list.id]
    const expected = numbering?.continued ? listItem(list.listType, numbering.start) : undefined
    if (!expected || normalizeLabel(expected) !== normalizeLabel(label)) delete list.continueNumbering
  }
}
