import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Selection, type Transaction } from '@tiptap/pm/state'
import { generateNodeId } from '@ses/shared'
import { hasReferenceTo } from './textBlockFormat'

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
 * 选区端点落在无题条的编号块（空 clauseTitle）内、且该条首块是 stdParagraph 时，返回把该端点移到首段起点的新选区；
 * 不适用返回 null。无题条的条文在首段，编号块只用来显示编号，光标不应停在其中（点击编号、方向键进入都一样），
 * 否则输入的文字要靠兜底在首段前另建段落。首块不是 stdParagraph（列项、无正文块）时无处可移，保持原样。
 */
export function redirectUntitledNumberSelection(doc: PMNode, selection: Selection): Selection | null {
  if (!(selection instanceof TextSelection)) return null
  let changed = false
  const move = (pos: number): number => {
    const $pos = doc.resolve(pos)
    if ($pos.parent.type.name !== 'clauseTitle' || $pos.parent.content.size > 0 || $pos.depth < 1) return pos
    const clause = $pos.node($pos.depth - 1)
    if (clause.type.name !== 'clause' || clause.attrs.hasTitle !== false || clause.childCount < 2 || clause.child(1).type.name !== 'stdParagraph') return pos
    changed = true
    return $pos.after($pos.depth) + 1
  }
  const anchor = move(selection.anchor)
  const head = move(selection.head)
  return changed ? TextSelection.create(doc, anchor, head) : null
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

/**
 * 无题条正文里按 Enter 的处理结果：
 * - Transaction：已规划好的单一事务，调用方派发即可（一步撤销）；
 * - 'swallow'：该位置的默认 Enter 会制造悬置段或空壳无题条，吞掉按键、文档不变；
 * - null：不适用，交给默认行为（拆段、Shift+Enter 换行等）。
 */
export type UntitledClauseEnter = Transaction | 'swallow' | null

/**
 * 无题条的 Enter，类似编号列表。仅在空选区、光标位于「无题条最后一个直属块且该块是 stdParagraph」时接管：
 * 1. 段落非空、光标在段中或段末：在当前条之后插入同级无题条（空 clauseTitle + 一个 stdParagraph），光标之后的内容
 *    （marks、行内节点与其 nodeId 原样搬走，不丢字）移入新段，光标进入新段开头。新条的 nodeId 由 NodeId 插件补齐。
 * 2. 段落非空、光标在首个正文段的段首：在当前条之前插入同级空无题条，原条、文字与 nodeId 都不动，光标留在原条正文开头
 *    （像编号列表在条目开头按 Enter）。当前条总有标题块等在前，插入位置合法；容器不允许时不接管。
 *    多段条文中非首段的段首不接管，交给默认拆段（在条内该段前留一个空段）。
 * 3. 空段、整条为空（clauseTitle 空且唯一正文段为空）：若紧邻前一个同级条是无题条，删除这个空条，
 *    在前一条末尾追加空段并把光标放进去（退出连续编号，在上一条里另起一段，用于多段条文）；
 *    否则默认的 Enter 会把空段抬出条外成为悬置段、留下无正文的空壳条，所以吞掉按键。
 *    被交叉引用的空条删除会让引用失去目标，同样吞掉。
 * 4. 空段、条内还有别的块（多段条文的空尾段）：删除这个空尾段，在当前条之后新建同级无题条，光标进入新条
 *    （与 3 互逆，连续编号里来回切换；默认的 liftEmptyBlock 会把空段抬出条外成为悬置段）。空尾段被引用时吞掉。
 * 条的最后一个直属块不是段落（列项、注等）、非最后的正文段、有选区范围时都不接管。
 * 只在条的前后插入同级条或在上一条追加段落，从不制造子条（无题条不能有子条，GB/T 7.3.4）。
 */
export function untitledClauseEnter(state: EditorState): UntitledClauseEnter {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const { $from } = selection
  const paragraph = $from.parent
  if (paragraph.type.name !== 'stdParagraph' || $from.depth < 2) return null
  const clauseDepth = $from.depth - 1
  const clause = $from.node(clauseDepth)
  if (clause.type.name !== 'clause' || clause.attrs.hasTitle !== false) return null
  if ($from.index(clauseDepth) !== clause.childCount - 1) return null

  const { nodes } = state.schema
  const clauseTitleType = nodes.clauseTitle
  const paragraphType = nodes.stdParagraph
  if (!clauseTitleType || !paragraphType) return null
  const level = clause.attrs.level
  const title = clauseTitleType.create({ level })
  const siblings = $from.node(clauseDepth - 1)
  const index = $from.index(clauseDepth - 1)
  const newClause = (content: Fragment) => clause.type.create({ level, hasTitle: false }, [title, paragraphType.create(null, content)])
  /** 新条正文段内的光标位置（新条位于 clausePos）。 */
  const insideNew = (clausePos: number) => clausePos + 1 + title.nodeSize + 1

  if (paragraph.content.size > 0) {
    if ($from.parentOffset === 0) {
      // 段首：只有首个正文段才在条前插入空条；多段条文里非首段的段首交给默认拆段。
      if ($from.index(clauseDepth) !== 1 || !siblings.canReplaceWith(index, index, clause.type)) return null
      const clausePos = $from.before(clauseDepth)
      const created = newClause(Fragment.empty)
      const tr = state.tr.insert(clausePos, created)
      tr.setSelection(TextSelection.create(tr.doc, $from.pos + created.nodeSize))
      return tr
    }
    const tail = paragraph.content.cut($from.parentOffset)
    const tr = state.tr
    tr.delete($from.pos, $from.end())
    const insertPos = $from.after(clauseDepth) - tail.size
    tr.insert(insertPos, newClause(tail))
    tr.setSelection(TextSelection.create(tr.doc, insideNew(insertPos)))
    return tr
  }

  if (clause.childCount > 2) {
    // 多段条文的空尾段：删除它，在当前条之后新建同级无题条（与下面「空条合回上一条」互逆）。
    if (hasReferenceTo(state.doc, paragraph.attrs.nodeId)) return 'swallow'
    const tr = state.tr
    tr.delete($from.before($from.depth), $from.after($from.depth))
    const insertPos = $from.after(clauseDepth) - paragraph.nodeSize
    tr.insert(insertPos, newClause(Fragment.empty))
    tr.setSelection(TextSelection.create(tr.doc, insideNew(insertPos)))
    return tr
  }

  if (clause.firstChild!.content.size > 0) return null
  const previous = index > 0 ? siblings.child(index - 1) : null
  const mergeable = previous !== null
    && previous.type === clause.type && previous.attrs.hasTitle === false && previous.attrs.level === level
    && previous.lastChild?.type !== clause.type
  if (!mergeable || hasReferenceTo(state.doc, clause.attrs.nodeId) || hasReferenceTo(state.doc, paragraph.attrs.nodeId)) return 'swallow'
  const clausePos = $from.before(clauseDepth)
  const tr = state.tr
  tr.delete(clausePos, clausePos + clause.nodeSize)
  tr.insert(clausePos - 1, paragraphType.create())
  tr.setSelection(TextSelection.create(tr.doc, clausePos))
  return tr
}
