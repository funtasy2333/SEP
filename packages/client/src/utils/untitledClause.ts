import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { generateNodeId } from '@ses/shared'

/**
 * 无题条的 IR 模型：hasTitle=false 时 clauseTitle 必须为空，条文在首个 stdParagraph。
 * 旧版编辑器把条文放进 clauseTitle，pmToIr 会把这种条记为 unsupportedContent 并阻断导出。
 * 这里提供检测与规范化：把 clauseTitle 的内容移入正文段。
 */

/** 无题（hasTitle=false）但 clauseTitle 非空的条：旧稿，或用户在无题条的编号位置输入了文字。 */
export function isLegacyUntitledClause(node: PMNode): boolean {
  const title = node.firstChild
  return node.type.name === 'clause' && node.attrs.hasTitle === false && title?.type.name === 'clauseTitle' && title.content.size > 0
}

function legacyClausePositions(doc: PMNode): number[] {
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false
    if (isLegacyUntitledClause(node)) positions.push(pos)
    return true
  })
  return positions
}

export function countLegacyUntitledClauses(doc: PMNode): number {
  return legacyClausePositions(doc).length
}

/**
 * 在事务上规范化全部旧式无题条，返回处理的条数（0 表示事务未改动）。
 * - 首块是空的 stdParagraph：标题文字移入其中（保留该段 nodeId）；
 * - 否则（无正文块、首块非段落、首段已有文字）：在首块之前新建 stdParagraph 承载标题文字，
 *   不与既有段落拼接，避免把两个段落的文字并成一段。
 * 位于标题内的选区随文字移入正文段，偏移不变。
 */
export function normalizeUntitledClauses(tr: Transaction): number {
  const positions = legacyClausePositions(tr.doc)
  if (positions.length === 0) return 0
  const paragraphType = tr.doc.type.schema.nodes.stdParagraph
  if (!paragraphType) return 0
  const selection = tr.selection
  let anchor: { steps: number; from: number; to: number } | null = null
  // 由后向前处理：先改后面的条，前面的位置不受影响。
  for (const pos of positions.slice().reverse()) {
    const clause = tr.doc.nodeAt(pos)
    if (!clause || !isLegacyUntitledClause(clause)) continue
    const title = clause.firstChild!
    const content = title.content
    const first = clause.childCount > 1 ? clause.child(1) : null
    const bodyStart = pos + 1 + title.nodeSize
    let textStart: number
    if (first && first.type === paragraphType && first.content.size === 0) {
      textStart = bodyStart + 1
      tr.insert(textStart, content)
    } else {
      textStart = bodyStart + 1
      tr.insert(bodyStart, paragraphType.create({ nodeId: generateNodeId() }, content))
    }
    const steps = tr.steps.length
    const titleStart = pos + 2
    tr.delete(titleStart, titleStart + content.size)
    if (selection.from >= titleStart && selection.to <= titleStart + content.size) {
      anchor = { steps, from: textStart + (selection.from - titleStart), to: textStart + (selection.to - titleStart) }
    }
  }
  if (anchor) {
    const map = tr.mapping.slice(anchor.steps)
    tr.setSelection(TextSelection.create(tr.doc, map.map(anchor.from), map.map(anchor.to)))
  }
  return positions.length
}
