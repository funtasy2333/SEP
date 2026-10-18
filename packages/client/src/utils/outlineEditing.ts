import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { generateNodeId } from '@ses/shared'
import { hasReferenceTo, retargetReference } from './textBlockFormat'

/**
 * 大纲式（Word 大纲视图式）条结构编辑核心。
 *
 * 在目标所在的章/附录内把「条」树平铺成有序序列：
 *   - 标题项：保留原 clause 节点（attrs、nodeId、marks）、clauseTitle 及其 inline 内容与 level；
 *   - 正文项：其余块，按原顺序。
 * 改变一个标题项的 level（或插入/删除一个标题项）后，再按 level 重建树：每个标题项的正文是其后到下一个标题项之间
 * 的块，子条是其后 level 更深的标题项。因此「只改这一条的级别，正文顺序不变」，且操作可逆。
 *
 * 正文项记录了所属标题项（owner）：未被本次编辑触及的块始终回到原所属条（含既有的悬置段），所以无关内容不会被重排；
 * 被删除的标题项留下的块、新建标题项吞下的块按大纲语义重新归属。
 * 术语条目（termDef）子树作为原子正文块整体搬运，level 随所属条的 level 差值平移（超过 5 则拒绝，下限夹到 1）。
 *
 * 校验以「本次编辑新引入的问题」为准：编辑前就存在的结构问题（既有悬置段、既有跳级等）不阻断无关操作。
 */

export type OutlineFailureReason =
  | 'missing-parent' // 第一个条不是一级 / 需要的上级不存在
  | 'level-skip' // 某标题级别超过前一标题级别 + 1
  | 'hanging-paragraph' // 有子条的条（章/附录）同时还有直属正文
  | 'untitled-with-children' // 无题条不得再分条（GB/T 1.1 7.3.4）
  | 'invalid-location' // 不在章/附录的条与正文中（表格、术语、前言……）
  | 'out-of-range' // 条级别须为 1~5；术语条目平移后也须在 1~5
  | 'referenced-block' // 无题条解除编号会让指向该条的引用失去目标

export const MIN_CLAUSE_LEVEL = 1
export const MAX_CLAUSE_LEVEL = 5

const HEAD_TYPES = new Set(['chapterTitle', 'appendixLabel', 'appendixTitle'])
const ROOT = -1

interface TitleItem {
  kind: 'title'
  key: number
  node: PMNode
  title: PMNode
  level: number
  hasTitle: boolean
  /** level / hasTitle 被编辑改动：重建时才改写 clause 属性，其余条原样保留。 */
  touched: boolean
  path: string
}
interface BodyItem {
  kind: 'body'
  node: PMNode
  /** 所属标题项；null = 按大纲语义归入最近的上一个标题项。 */
  owner: number | null
  /** 原所属条的 level（章/附录为 0），用于计算术语条目的平移量。 */
  ownerLevel: number
  path: string
}
type Item = TitleItem | BodyItem

interface Frame {
  key: number
  level: number
  item: TitleItem | null
  children: PMNode[]
  clauseChildren: number
  directBlocks: number
}
interface Violation { code: OutlineFailureReason; key: string }
interface Built {
  children: PMNode[]
  violations: Violation[]
  clauses: Map<number, PMNode>
}

const levelOf = (node: PMNode): number => (typeof node.attrs.level === 'number' && Number.isFinite(node.attrs.level) ? node.attrs.level : 1)
const childrenOf = (node: PMNode): PMNode[] => node.content.content.slice()

function flatten(container: PMNode): { head: PMNode[]; items: Item[] } {
  const all = childrenOf(container)
  let headCount = 0
  while (headCount < all.length && HEAD_TYPES.has(all[headCount]!.type.name)) headCount += 1
  const items: Item[] = []
  let nextKey = 0
  const visit = (node: PMNode, ownerKey: number, ownerLevel: number, prefix: number[], from: number) => {
    for (let index = from; index < node.childCount; index += 1) {
      const child = node.child(index)
      const path = [...prefix, index]
      if (child.type.name === 'clause') {
        const key = nextKey
        nextKey += 1
        const level = levelOf(child)
        items.push({ kind: 'title', key, node: child, title: child.firstChild!, level, hasTitle: child.attrs.hasTitle !== false, touched: false, path: path.join('.') })
        visit(child, key, level, path, 1)
      } else {
        items.push({ kind: 'body', node: child, owner: ownerKey, ownerLevel, path: path.join('.') })
      }
    }
  }
  visit(container, ROOT, 0, [], headCount)
  return { head: all.slice(0, headCount), items }
}

/** 术语条目子树的 level 整体平移 delta；超过 5 返回 null（下限夹到 1，仅为显示层级）。 */
function shiftTermLevels(node: PMNode, delta: number): PMNode | null {
  const old = typeof node.attrs.level === 'number' ? node.attrs.level : 1
  const level = old + delta
  if (level > MAX_CLAUSE_LEVEL) return null
  const clamped = Math.max(MIN_CLAUSE_LEVEL, level)
  let changed = clamped !== old
  const content: PMNode[] = []
  for (const child of childrenOf(node)) {
    if (child.type.name !== 'termDef') { content.push(child); continue }
    const shifted = shiftTermLevels(child, delta)
    if (!shifted) return null
    if (shifted !== child) changed = true
    content.push(shifted)
  }
  return changed ? node.type.create({ ...node.attrs, level: clamped }, Fragment.fromArray(content), node.marks) : node
}

/** 按 level 与 owner 把平铺序列重建为章/附录的子节点，同时收集结构问题。 */
function rebuild(items: Item[]): Built {
  const violations: Violation[] = []
  const root: Frame = { key: ROOT, level: 0, item: null, children: [], clauseChildren: 0, directBlocks: 0 }
  const frames: Frame[] = [root]
  const open = new Map<number, Frame>([[ROOT, root]])
  const clauses = new Map<number, PMNode>()

  const check = (frame: Frame) => {
    if (frame.clauseChildren > 0 && frame.directBlocks > 0) violations.push({ code: 'hanging-paragraph', key: String(frame.key) })
    if (frame.item && !frame.item.hasTitle && frame.clauseChildren > 0) violations.push({ code: 'untitled-with-children', key: String(frame.key) })
  }
  const close = () => {
    const frame = frames.pop()!
    const item = frame.item!
    open.delete(frame.key)
    const attrs = item.touched ? { ...item.node.attrs, level: item.level, hasTitle: item.hasTitle } : item.node.attrs
    const node = item.node.type.create(attrs, [item.title, ...frame.children], item.node.marks)
    clauses.set(item.key, node)
    check(frame)
    const parent = frames[frames.length - 1]!
    parent.children.push(node)
    parent.clauseChildren += 1
  }

  for (const item of items) {
    if (item.kind === 'title') {
      if (!Number.isInteger(item.level) || item.level < MIN_CLAUSE_LEVEL || item.level > MAX_CLAUSE_LEVEL) {
        violations.push({ code: 'out-of-range', key: String(item.key) })
      }
      while (frames.length > 1 && frames[frames.length - 1]!.level >= item.level) close()
      const parent = frames[frames.length - 1]!
      if (item.level > parent.level + 1) violations.push({ code: parent.key === ROOT ? 'missing-parent' : 'level-skip', key: String(item.key) })
      const frame: Frame = { key: item.key, level: item.level, item, children: [], clauseChildren: 0, directBlocks: 0 }
      frames.push(frame)
      open.set(item.key, frame)
      continue
    }
    let frame = frames[frames.length - 1]!
    const owner = item.owner === null ? undefined : open.get(item.owner)
    if (owner) {
      while (frames[frames.length - 1] !== owner) close()
      frame = owner
    }
    let node = item.node
    if (node.type.name === 'termDef') {
      const delta = frame.level - item.ownerLevel
      if (delta !== 0) {
        const shifted = shiftTermLevels(node, delta)
        if (shifted) node = shifted
        else violations.push({ code: 'out-of-range', key: `term:${item.path}` })
      }
    } else {
      frame.directBlocks += 1
    }
    frame.children.push(node)
  }
  while (frames.length > 1) close()
  check(root)
  return { children: root.children, violations, clauses }
}

const PRIORITY: OutlineFailureReason[] = ['out-of-range', 'missing-parent', 'level-skip', 'untitled-with-children', 'hanging-paragraph']

/** 编辑后新出现（编辑前不存在）的最高优先级问题。 */
function newViolation(baseline: Violation[], edited: Violation[]): OutlineFailureReason | null {
  const known = new Set(baseline.map(violation => `${violation.code}|${violation.key}`))
  const fresh = edited.filter(violation => !known.has(`${violation.code}|${violation.key}`))
  for (const code of PRIORITY) if (fresh.some(violation => violation.code === code)) return code
  return null
}

// ---------- 定位 ----------

export interface OutlineLocation {
  container: PMNode
  /** 章/附录节点之前的文档位置。 */
  containerPos: number
  /** 目标节点（条或正文块）相对于章/附录的子节点下标路径。 */
  path: number[]
}

/**
 * 定位 $pos 所在节点（nodeDepth 处的条或正文块）所属的章/附录。
 * 祖先只能是条；经过表格、术语、前言等其他容器一律视为位置不合法。
 */
export function locateOutline($pos: ResolvedPos, nodeDepth: number): OutlineLocation | null {
  for (let depth = nodeDepth - 1; depth >= 1; depth -= 1) {
    const ancestor = $pos.node(depth)
    const name = ancestor.type.name
    if (name === 'clause') continue
    if (name !== 'chapter' && name !== 'appendix') return null
    const path: number[] = []
    for (let d = depth; d < nodeDepth; d += 1) path.push($pos.index(d))
    return { container: ancestor, containerPos: $pos.before(depth), path }
  }
  return null
}

// ---------- 编辑 ----------

export type OutlineEdit =
  /** 改已有条的级别与（或）有题/无题。 */
  | { kind: 'set-clause'; level: number; hasTitle: boolean }
  /** 把正文段落变成条。 */
  | { kind: 'make-clause'; level: number; hasTitle: boolean }
  /** 把条变成正文段落。 */
  | { kind: 'make-paragraph' }

/** 光标原先所在的文本块：条标题，或无题条的首个正文段，或普通段落。 */
export type OutlineLeaf = 'title' | 'first-paragraph' | 'paragraph'

export type OutlineOutcome = { ok: true } | { ok: false; reason: OutlineFailureReason }

const fail = (reason: OutlineFailureReason): OutlineOutcome => ({ ok: false, reason })

/** 编辑后光标应落的位置：某个正文块，或某条的标题/首个正文块。 */
type Focus =
  | { kind: 'block'; node: PMNode; offsets: [number, number] }
  | { kind: 'title' | 'first-block'; item: TitleItem; offsets: [number, number] }
  | null

function sizeOf(nodes: PMNode[], end: number): number {
  let size = 0
  for (let index = 0; index < end; index += 1) size += nodes[index]!.nodeSize
  return size
}

/**
 * 在事务上执行一次大纲编辑：不通过时事务不变并返回原因码。
 * offsets 是原光标在文本块内的偏移；通过后选区落在对应的新位置。
 */
export function applyOutlineEdit(
  tr: Transaction,
  location: OutlineLocation,
  edit: OutlineEdit,
  leaf: OutlineLeaf,
  offsets: [number, number],
): OutlineOutcome {
  const { container, containerPos } = location
  const { head, items: baseItems } = flatten(container)
  const targetPath = location.path.join('.')
  const index = baseItems.findIndex(item => item.path === targetPath)
  if (index < 0) return fail('invalid-location')
  const target = baseItems[index]!
  const { clause: clauseType, clauseTitle: titleType, stdParagraph: paragraphType } = tr.doc.type.schema.nodes
  if (!clauseType || !titleType || !paragraphType) return fail('invalid-location')

  const items: Item[] = baseItems.map(item => ({ ...item }))
  let focus: Focus = null
  /** 引用类型随块改变；toId 给出时引用同时改指向另一个节点（目标块被并入别处），此时无类型引用也跟着改指向（仍无类型）。 */
  let reference: { id: unknown; from: string; to: string; toId?: unknown } | null = null
  const withLevel = (title: PMNode, level: number): PMNode =>
    (title.attrs.level === level ? title : title.type.create({ ...title.attrs, level }, title.content, title.marks))

  if (edit.kind === 'set-clause') {
    if (target.kind !== 'title') return fail('invalid-location')
    const item = items[index] as TitleItem
    const { level, hasTitle } = edit
    if (item.level === level && item.hasTitle === hasTitle) return { ok: true }
    const text = item.title.content
    item.touched = true
    item.level = level
    item.hasTitle = hasTitle
    item.title = withLevel(item.title, level)
    // 无题 → 有题（有题 → 无题的逆操作，与「段落 → 条」一致）：条文变成标题。首个直属块是 stdParagraph 且内容放得进
    // clauseTitle 时，其行内内容（marks、行内节点）整体移入标题，该段删除；放不进（首块是列项/注、无正文块、schema 不容许）
    // 则保持原行为，只切换属性。指向该段的引用改指向条；段落被引用而条没有 nodeId 可指时也不搬移。
    const first = items[index + 1]
    const absorbed = hasTitle && !target.hasTitle && text.size === 0 && first?.kind === 'body' && first.owner === item.key
      && first.node.type === paragraphType && item.title.canReplace(0, item.title.childCount, first.node.content)
      && (typeof item.node.attrs.nodeId === 'string' && item.node.attrs.nodeId !== '' || !hasReferenceTo(tr.doc, first.node.attrs.nodeId))
    if (!hasTitle && target.hasTitle && text.size > 0) {
      // 有题 → 无题：原标题文字移为新建的首段（新 nodeId），clauseTitle 清空。
      const moved = paragraphType.create({ nodeId: generateNodeId() }, text)
      item.title = item.title.type.create(item.title.attrs, null, item.title.marks)
      items.splice(index + 1, 0, { kind: 'body', node: moved, owner: item.key, ownerLevel: target.level, path: `new:${item.key}` })
      focus = { kind: 'block', node: moved, offsets }
    } else if (absorbed && first?.kind === 'body') {
      item.title = item.title.type.create(item.title.attrs, first.node.content, item.title.marks)
      items.splice(index + 1, 1)
      reference = { id: first.node.attrs.nodeId, from: 'paragraph', to: 'clause', toId: item.node.attrs.nodeId }
      focus = { kind: 'title', item, offsets: leaf === 'first-paragraph' ? offsets : [0, 0] }
    } else if (hasTitle) {
      focus = { kind: 'title', item, offsets: leaf === 'title' ? offsets : [0, 0] }
    } else {
      focus = { kind: 'first-block', item, offsets: leaf === 'first-paragraph' ? offsets : [0, 0] }
    }
  } else if (edit.kind === 'make-clause') {
    if (target.kind !== 'body' || target.node.type !== paragraphType) return fail('invalid-location')
    const { level, hasTitle } = edit
    const source = target.node
    const key = items.reduce((max, item) => (item.kind === 'title' ? Math.max(max, item.key) : max), ROOT) + 1
    // 有题条取走段落的 nodeId 与文字（指向该段落的引用改指向条）；无题条保留原段落（含 nodeId）作首个正文段，新条取新 nodeId。
    const title = titleType.create({ level }, hasTitle ? source.content : null)
    const created = clauseType.create({ nodeId: hasTitle ? source.attrs.nodeId : generateNodeId(), level, hasTitle }, title)
    const titleItem: TitleItem = { kind: 'title', key, node: created, title, level, hasTitle, touched: false, path: `new:${key}` }
    const replacement: Item[] = [titleItem]
    if (!hasTitle) replacement.push({ kind: 'body', node: source, owner: key, ownerLevel: target.ownerLevel, path: target.path })
    items.splice(index, 1, ...replacement)
    // 新条吞下其后与段落同属一个所属条的正文，直到下一个级别不深于它的条。
    for (let at = index + replacement.length; at < items.length; at += 1) {
      const next = items[at]!
      if (next.kind === 'title') {
        if (next.level <= level) break
      } else if (next.owner === target.owner) {
        next.owner = key
      }
    }
    if (hasTitle) {
      reference = { id: source.attrs.nodeId, from: 'paragraph', to: 'clause' }
      focus = { kind: 'title', item: titleItem, offsets }
    } else {
      focus = { kind: 'block', node: source, offsets }
    }
  } else {
    if (target.kind !== 'title') return fail('invalid-location')
    const item = items[index] as TitleItem
    if (item.hasTitle || item.title.content.size > 0) {
      // 标题项变为正文段落：取走条的 nodeId 与标题文字，随后按大纲语义归入最近的上一个标题项。
      const paragraph = paragraphType.create({ nodeId: item.node.attrs.nodeId }, item.title.content)
      items.splice(index, 1, { kind: 'body', node: paragraph, owner: null, ownerLevel: 0, path: `new:${item.key}` })
      reference = { id: item.node.attrs.nodeId, from: 'clause', to: 'paragraph' }
      focus = { kind: 'block', node: paragraph, offsets: leaf === 'title' ? offsets : [0, 0] }
    } else {
      // 规范的无题条：clauseTitle 为空、条文已在首个正文段，去掉标题项即解除编号。
      // 条本身（nodeId）随之消失，指向它的引用会失去目标：被引用时拒绝，由用户先删除或改指引用。
      if (hasReferenceTo(tr.doc, item.node.attrs.nodeId)) return fail('referenced-block')
      items.splice(index, 1)
      const next = items[index]
      focus = next && next.kind === 'body' ? { kind: 'block', node: next.node, offsets: leaf === 'first-paragraph' ? offsets : [0, 0] } : null
    }
  }

  const baseline = rebuild(baseItems)
  const edited = rebuild(items)
  const reason = newViolation(baseline.violations, edited.violations)
  if (reason) return fail(reason)

  // 只替换发生变化的章内子节点，前后未受影响的节点保持不变。
  const oldChildren = childrenOf(container)
  const newChildren = [...head, ...edited.children]
  // 防御：重建结果必须满足章/附录的内容表达式，否则当作位置不合法，不去触发 ReplaceStep 的 RangeError。
  if (!container.type.validContent(Fragment.fromArray(newChildren))) return fail('invalid-location')
  let start = 0
  while (start < oldChildren.length && start < newChildren.length && oldChildren[start]!.eq(newChildren[start]!)) start += 1
  let oldEnd = oldChildren.length, newEnd = newChildren.length
  while (oldEnd > start && newEnd > start && oldChildren[oldEnd - 1]!.eq(newChildren[newEnd - 1]!)) { oldEnd -= 1; newEnd -= 1 }
  const contentStart = containerPos + 1
  if (start < oldEnd || start < newEnd) {
    const from = contentStart + sizeOf(oldChildren, start)
    const to = contentStart + sizeOf(oldChildren, oldEnd)
    if (start < newEnd) tr.replaceWith(from, to, newChildren.slice(start, newEnd))
    else tr.delete(from, to)
  }
  if (reference) retargetReference(tr, reference.id, reference.toId ?? reference.id, reference.from, reference.to)
  if (focus) placeSelection(tr, containerPos, edited, focus)
  return { ok: true }
}

/** 选区落在对应文本块的相同偏移处；找不到目标（理论上不会发生）时保持事务映射后的选区。 */
function placeSelection(tr: Transaction, containerPos: number, built: Built, focus: NonNullable<Focus>) {
  const container = tr.doc.resolve(containerPos).nodeAfter
  if (!container) return
  const find = (match: (node: PMNode) => boolean): { node: PMNode; pos: number } | null => {
    let found: { node: PMNode; pos: number } | null = null
    container.descendants((node, pos) => {
      if (found) return false
      if (match(node)) { found = { node, pos: containerPos + 1 + pos }; return false }
      return undefined
    })
    return found
  }
  const select = (block: PMNode, pos: number, offsets: [number, number]) => {
    if (!block.isTextblock) return
    const size = block.content.size
    const clamp = (value: number) => Math.max(0, Math.min(value, size))
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + clamp(offsets[0]), pos + 1 + clamp(offsets[1])))
  }
  if (focus.kind === 'block') {
    // 先按节点身份，再按 nodeId（引用改写可能换过节点对象）。
    const id = focus.node.attrs.nodeId
    const hit = find(node => node === focus.node) ?? (typeof id === 'string' && id ? find(node => node.type === focus.node.type && node.attrs.nodeId === id) : null)
    if (hit) select(hit.node, hit.pos, focus.offsets)
    return
  }
  const built_ = built.clauses.get(focus.item.key)
  if (!built_) return
  const id = built_.attrs.nodeId
  const clause = find(node => node === built_) ?? (typeof id === 'string' && id ? find(node => node.type === built_.type && node.attrs.nodeId === id) : null)
  if (!clause) return
  const title = clause.node.firstChild!
  if (focus.kind === 'title') {
    select(title, clause.pos + 1, focus.offsets)
  } else if (clause.node.childCount > 1) {
    select(clause.node.child(1), clause.pos + 1 + title.nodeSize, focus.offsets)
  } else {
    select(title, clause.pos + 1, [0, 0])
  }
}
