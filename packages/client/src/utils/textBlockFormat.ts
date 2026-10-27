import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

const textBlocks = new Set(['paragraph', 'stdParagraph', 'note', 'example'])
const children = (node: PMNode): PMNode[] => node.content.content.slice()

interface ConvertedTarget { id: string; source: string }

type JsonRecord = Record<string, unknown>
const record = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)
type RewriteMark = (mark: JsonRecord) => JsonRecord

/** A cross reference without a type: `''` in the PM mark (IR round trip), a missing key in stored payloads (null is invalid input but still a reference). */
const untyped = (kind: unknown) => kind === undefined || kind === null || kind === ''

/** Marks that point at another node by id. Only crossRef is ever rewritten; term and bibliography references just have to be seen. */
const REFERENCE_MARKS = new Set(['crossRef', 'bibRef', 'termRef'])

function mapArray(value: unknown, map: (item: JsonRecord) => JsonRecord): unknown {
  if (!Array.isArray(value)) return value
  const mapped = value.map(item => record(item) ? map(item) : item)
  return mapped.some((item, index) => item !== value[index]) ? mapped : value
}

/** Typed PM/IR inline payloads, including footnotes saved outside the node tree. */
function mapInlines(value: unknown, rewrite: RewriteMark): unknown {
  return mapArray(value, item => {
    let next = item
    const set = (field: string, mapped: unknown) => {
      if (mapped !== item[field]) next = { ...next, [field]: mapped }
    }
    set('marks', mapArray(item.marks, mark => typeof mark.type === 'string' && REFERENCE_MARKS.has(mark.type) ? rewrite(mark) : mark))
    if (typeof item.type === 'string') set('content', mapInlines(item.content, rewrite))
    if (record(item.footnote)) {
      const content = mapInlines(item.footnote.content, rewrite)
      if (content !== item.footnote.content) set('footnote', { ...item.footnote, content })
    }
    if (item.type === 'footnoteRef' && record(item.attrs)) {
      const content = mapInlines(item.attrs.content, rewrite)
      if (content !== item.attrs.content) set('attrs', { ...item.attrs, content })
    }
    return next
  })
}

function mapStoredAttrs(node: PMNode, rewrite: RewriteMark): JsonRecord {
  const attrs = node.attrs as JsonRecord
  if (node.type.name === 'footnoteRef') {
    const content = mapInlines(attrs.content, rewrite)
    return content !== attrs.content ? { ...attrs, content } : attrs
  }
  if (node.type !== node.type.schema.topNodeType && node.type.name !== 'coverPage') return attrs
  let next = attrs
  for (const [field, inlineFields] of Object.entries({ titleParts: ['content'], publishers: ['name'], copyrights: ['holder', 'statement'], identifiers: [] })) {
    const rows = mapArray(attrs[field], row => {
      let result = row
      for (const key of inlineFields) {
        const content = mapInlines(row[key], rewrite)
        if (content !== row[key]) result = { ...result, [key]: content }
      }
      if (field === 'identifiers') {
        const parts = mapArray(row.parts, part => {
          const content = mapInlines(part.content, rewrite)
          return content !== part.content ? { ...part, content } : part
        })
        if (parts !== row.parts) result = { ...result, parts }
      }
      return result
    })
    if (rows !== attrs[field]) next = { ...next, [field]: rows }
  }
  return next
}

export function hasReferenceTo(doc: PMNode, id: unknown): boolean {
  if (typeof id !== 'string' || !id) return false
  let found = false
  const visit: RewriteMark = mark => {
    const attrs = record(mark.attrs) ? mark.attrs : mark
    if ((attrs.targetId ?? attrs.refId) === id) found = true
    return mark
  }
  mapStoredAttrs(doc, visit)
  doc.descendants(node => {
    for (const mark of node.marks) if (REFERENCE_MARKS.has(mark.type.name)) visit({ type: mark.type.name, attrs: mark.attrs })
    mapStoredAttrs(node, visit)
  })
  return found
}

/**
 * 有编号的块（条、注、示例）就地变成无编号的 stdParagraph 后，指向它（同一个 id）的交叉引用是否会失效。
 * 段落没有编号：无类型引用没有可引用的编号，会变成 dangling-xref；有类型引用里只有原类型 `from`（随转换改为 paragraph）
 * 和已经是 paragraph 的仍成立，其余类型与段落不再兼容。覆盖 targetId/旧稿 refId、脚注负载与元数据里的存储标记。
 */
export function hasReferenceLostAsParagraph(doc: PMNode, id: unknown, from: 'clause' | 'note' | 'example'): boolean {
  if (typeof id !== 'string' || !id) return false
  let lost = false
  const visit: RewriteMark = mark => {
    if (mark.type !== 'crossRef') return mark
    const typed = record(mark.attrs)
    const attrs = typed ? mark.attrs as JsonRecord : mark
    if ((attrs.targetId ?? attrs.refId) !== id) return mark
    const kind = attrs[typed ? 'refType' : 'targetKind']
    if (untyped(kind) || (kind !== from && kind !== 'paragraph')) lost = true
    return mark
  }
  mapStoredAttrs(doc, visit)
  doc.descendants(node => {
    for (const mark of node.marks) visit({ type: mark.type.name, attrs: mark.attrs })
    mapStoredAttrs(node, visit)
  })
  return lost
}

/**
 * 是否有交叉引用把这个列项本身当作「列项」来指（类型 listItem，或无类型）。
 * 列项的编号标记（`c)`）只在它位于 alpha/numeric 等有序列表里时才存在：列项转成段落/注/示例，
 * 或所在列表改为无序类型后，类型为 listItem 的引用会因目标类型不符而悬空，无类型引用会因没有编号而悬空。
 * 指向列项内段落（`<项 id>.p0`，类型 paragraph）的引用不受影响，由 retargetReferences 照常处理。
 */
export function hasListItemReference(doc: PMNode, id: unknown): boolean {
  if (typeof id !== 'string' || !id) return false
  let found = false
  const visit: RewriteMark = mark => {
    if (mark.type !== 'crossRef') return mark
    const typed = record(mark.attrs)
    const attrs = typed ? mark.attrs as JsonRecord : mark
    if ((attrs.targetId ?? attrs.refId) !== id) return mark
    const kind = attrs[typed ? 'refType' : 'targetKind']
    if (kind === 'listItem' || untyped(kind)) found = true
    return mark
  }
  mapStoredAttrs(doc, visit)
  doc.descendants(node => {
    for (const mark of node.marks) visit({ type: mark.type.name, attrs: mark.attrs })
    mapStoredAttrs(node, visit)
  })
  return found
}

/**
 * node 及其全部后代里是否有任何节点被交叉引用。整棵子树被删除时，这些引用会失去目标
 * （类型化引用悬空，导出校验失败），所以删除空条一类的操作要先问这个。
 */
export function hasReferenceWithin(doc: PMNode, node: PMNode): boolean {
  let found = hasReferenceTo(doc, node.attrs.nodeId)
  node.descendants(child => {
    if (found) return false
    found = hasReferenceTo(doc, child.attrs.nodeId)
    return !found
  })
  return found
}

type RewriteAttrs = (attrs: JsonRecord, kindField: 'refType' | 'targetKind') => JsonRecord

/** Apply an attribute rewrite to every typed reference payload and crossRef mark of the transaction document. */
function rewriteReferences(tr: Transaction, rewriteAttrs: RewriteAttrs) {
  const rewrite: RewriteMark = mark => {
    if (mark.type !== 'crossRef') return mark
    if (record(mark.attrs)) {
      const attrs = rewriteAttrs(mark.attrs, 'refType')
      return attrs !== mark.attrs ? { ...mark, attrs } : mark
    }
    return rewriteAttrs(mark, 'targetKind')
  }
  const snapshot = tr.doc
  const rootAttrs = mapStoredAttrs(snapshot, rewrite)
  for (const key of Object.keys(rootAttrs)) {
    if (rootAttrs[key] !== snapshot.attrs[key]) tr.setDocAttribute(key, rootAttrs[key])
  }
  snapshot.descendants((node, pos) => {
    const attrs = mapStoredAttrs(node, rewrite)
    if (attrs !== node.attrs) tr.setNodeMarkup(pos, undefined, attrs, node.marks)
    for (const mark of node.marks) {
      if (mark.type.name !== 'crossRef') continue
      const mapped = rewriteAttrs(mark.attrs, 'refType')
      if (mapped === mark.attrs) continue
      tr.removeMark(pos, pos + node.nodeSize, mark)
      tr.addMark(pos, pos + node.nodeSize, mark.type.create(mapped))
    }
  })
}

/** Keep text references on paragraphs, and container references on the converted block. */
function retargetReferences(tr: Transaction, converted: ConvertedTarget[], targetName: string) {
  const targets = new Map(converted.filter(item => item.id).map(item => [item.id, item.source]))
  const targetKind = targetName === 'stdParagraph' ? 'paragraph' : targetName
  rewriteReferences(tr, (attrs, kindField) => {
    const oldId = attrs.targetId ?? attrs.refId
    if (typeof oldId !== 'string') return attrs
    let newId = oldId, refType = attrs[kindField]
    const source = targets.get(oldId)
    if (source) {
      if (['paragraph', 'stdParagraph'].includes(source) && refType === 'paragraph') {
        newId = targetKind === 'paragraph' ? oldId : `${oldId}.p0`
      } else if (['note', 'example'].includes(source) && refType === source) {
        refType = targetKind
      }
    } else if (oldId.endsWith('.p0')) {
      const ownerId = oldId.slice(0, -3)
      const owner = targets.get(ownerId)
      if (owner && ['stdListItem', 'note', 'example'].includes(owner)) newId = targetKind === 'paragraph' ? ownerId : oldId
    }
    if (newId === oldId && refType === attrs[kindField]) return attrs
    const field = attrs.targetId !== null && attrs.targetId !== undefined ? 'targetId' : 'refId'
    return { ...attrs, [field]: newId, ...(refType !== attrs[kindField] ? { [kindField]: refType } : {}) }
  })
}

/**
 * One stable id changes entity kind when a paragraph becomes a clause title (or back): typed references
 * must follow it, otherwise the Resolver reports them as dangling typed references.
 * The id stays, so untyped references stay exactly where they are.
 */
export function retargetReferenceType(tr: Transaction, id: unknown, from: string, to: string) {
  retargetReference(tr, id, id, from, to)
}

/**
 * References of type `from` to `id` now point at `toId` as type `to`: the target block is gone and its content lives on in
 * another one (a paragraph whose text moved into a clause title is referenced as that clause). Both ids must be real ids.
 * Untyped references to `id` follow the move when the id really changes (`toId !== id`) and stay untyped: the old id no longer
 * exists, so they would dangle. When only the entity kind changes (`toId === id`) they are left alone.
 */
export function retargetReference(tr: Transaction, id: unknown, toId: unknown, from: string, to: string) {
  if (typeof id !== 'string' || !id || typeof toId !== 'string' || !toId) return
  rewriteReferences(tr, (attrs, kindField) => {
    if ((attrs.targetId ?? attrs.refId) !== id) return attrs
    const field = attrs.targetId !== null && attrs.targetId !== undefined ? 'targetId' : 'refId'
    if (attrs[kindField] === from) return { ...attrs, [field]: toId, [kindField]: to }
    return toId !== id && untyped(attrs[kindField]) ? { ...attrs, [field]: toId } : attrs
  })
}

/** Why a text-block conversion was refused (the document is left untouched either way). */
export type TextBlockFailure = 'referenced-block' | 'unsupported'

/** Change whole text blocks; a partial selection must never erase unselected text. Returns the refusal reason, or null on success. */
export function convertTextBlock(state: EditorState, tr: Transaction, targetName: 'stdParagraph' | 'note' | 'example'): TextBlockFailure | null {
  const { $from, $to } = state.selection
  const target = state.schema.nodes[targetName]!
  if ($from.parent.type.name === 'stdListItem' && $to.parent.type.name === 'stdListItem') {
    const depth = $from.depth - 1
    const list = $from.node(depth)
    if (list.type.name !== 'stdList' || $to.depth !== $from.depth || $to.node(depth) !== list) return 'unsupported'
    const listNodes = children(list)
    const start = $from.index(depth), end = $to.index(depth) + 1
    const before = listNodes.slice(0, start), after = listNodes.slice(end)
    if (!before.length && !after.length && hasReferenceTo(state.doc, list.attrs.nodeId)) return 'referenced-block'
    const selected = listNodes.slice(start, end)
    // 列项没有「段落/注/示例」形态的列项编号：被当作列项引用的项转换后引用会失去目标，拒绝（文档不动）。
    if (selected.some(item => hasListItemReference(state.doc, item.attrs.nodeId))) return 'referenced-block'
    const converted = selected.map(item => target.create({ nodeId: item.attrs.nodeId }, item.content, item.marks))
    const replacement: PMNode[] = []
    if (before.length) replacement.push(list.type.create(list.attrs, before, list.marks))
    replacement.push(...converted)
    // The second fragment is a new list; never duplicate the original stable anchor.
    if (after.length) replacement.push(list.type.create({ ...list.attrs, ...(before.length ? { nodeId: null } : {}) }, after, list.marks))
    const parent = $from.node(depth - 1), index = $from.index(depth - 1)
    if (!parent.canReplace(index, index + 1, Fragment.fromArray(replacement))) return 'unsupported'
    const pos = $from.before(depth)
    tr.replaceWith(pos, $from.after(depth), replacement)
    retargetReferences(tr, selected.map(item => ({ id: item.attrs.nodeId, source: 'stdListItem' })), targetName)
    const firstPos = pos + (replacement[0]?.type.name === 'stdList' ? replacement[0].nodeSize : 0)
    const lastPos = firstPos + converted.slice(0, -1).reduce((size, node) => size + node.nodeSize, 0)
    tr.setSelection(TextSelection.create(tr.doc, firstPos + 1 + $from.parentOffset, lastPos + 1 + $to.parentOffset))
    return null
  }
  if (!$from.sameParent($to) || !textBlocks.has($from.parent.type.name)) return 'unsupported'
  const parent = $from.node($from.depth - 1), index = $from.index($from.depth - 1)
  if (!parent.canReplaceWith(index, index + 1, target)) return 'unsupported'
  const leaf = $from.parent, pos = $from.before($from.depth)
  tr.replaceWith(pos, $from.after($from.depth), target.create({ nodeId: leaf.attrs.nodeId }, leaf.content, leaf.marks))
  retargetReferences(tr, [{ id: leaf.attrs.nodeId, source: leaf.type.name }], targetName)
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + $from.parentOffset, pos + 1 + $to.parentOffset))
  return null
}

/** Change whole text blocks; a partial selection must never erase unselected text. */
export function formatTextBlock(state: EditorState, tr: Transaction, targetName: 'stdParagraph' | 'note' | 'example'): boolean {
  return convertTextBlock(state, tr, targetName) === null
}

const listTypes = new Set(['dash', 'alpha', 'numeric', 'dot', 'boxedNumeric'])
/**
 * 列项在 Resolver 里有编号标记的 PM 列表类型（IR alpha / number / roman）；其余为无序类型。
 * 'roman' 自 WP8.M G7-a 起是生产 stdList 的受支持类型（导入的罗马列项可被引用）；格式命令本阶段不提供创建入口，
 * 但把有序列项改成无序类型时，罗马列项同样不得失去被引用的编号。
 */
const numberedListTypes = new Set(['alpha', 'numeric', 'roman'])
const listableBlocks = new Set(['stdParagraph', 'note', 'example'])
/** Body containers where an empty generic paragraph is as good as an empty stdParagraph: a list simply takes its place. */
const listBodyContainers = new Set(['chapter', 'clause', 'appendix', 'foreword', 'introduction'])

/**
 * Turn the selection into list items of `listType` (a format command, not an insertion):
 * - list items: the selected items of one list become a new list of the target type; the parts before and
 *   after keep their type. A fully selected list only changes type/level and keeps its stable anchor;
 * - paragraphs, notes and examples (a range of adjacent blocks is allowed): each becomes one item of a single list.
 * Item ids and inline content survive, and a new list never duplicates the original list's anchor.
 * A lone empty paragraph (an empty stdParagraph, or an empty generic paragraph in a body container) where a list may sit
 * answers 'nothing-to-convert': that is the only case where the caller inserts a fresh list in its place.
 * Every other selection, a caret in a title, term, table cell and so on included, answers 'unsupported' and must be
 * refused as invalid: inserting there would split the surrounding defining node. Blocks that are referenced by kind
 * answer 'referenced-block'. On any non-null answer the transaction has not been touched.
 */
export function formatStdList(state: EditorState, tr: Transaction, listType: string): TextBlockFailure | 'nothing-to-convert' | null {
  if (!listTypes.has(listType)) return 'unsupported'
  const level = listType === 'numeric' || listType === 'dot' ? 2 : 1
  const { $from, $to } = state.selection
  const { stdList, stdListItem } = state.schema.nodes
  if (!stdList || !stdListItem) return 'unsupported'

  if ($from.parent.type === stdListItem && $to.parent.type === stdListItem) {
    const depth = $from.depth - 1
    const list = $from.node(depth)
    if (list.type !== stdList || $to.depth !== $from.depth || $to.node(depth) !== list) return 'unsupported'
    const items = children(list)
    const start = $from.index(depth), end = $to.index(depth) + 1
    const pos = $from.before(depth)
    // 只有有序列表（Resolver 的 alpha/number/roman）的列项有编号；改成无序类型会让被引用的列项失去编号。
    if (!numberedListTypes.has(listType) && items.slice(start, end).some(item => hasListItemReference(state.doc, item.attrs.nodeId))) return 'referenced-block'
    if (start === 0 && end === items.length) {
      if (list.attrs.listType !== listType || list.attrs.level !== level) tr.setNodeMarkup(pos, undefined, { ...list.attrs, listType, level }, list.marks)
      return null
    }
    const before = items.slice(0, start), selected = items.slice(start, end), after = items.slice(end)
    const replacement: PMNode[] = []
    if (before.length) replacement.push(list.type.create(list.attrs, before, list.marks))
    // Only the first resulting list keeps the original stable anchor.
    replacement.push(list.type.create({ ...list.attrs, listType, level, ...(before.length ? { nodeId: null } : {}) }, selected, list.marks))
    if (after.length) replacement.push(list.type.create({ ...list.attrs, nodeId: null }, after, list.marks))
    const parent = $from.node(depth - 1), index = $from.index(depth - 1)
    if (!parent.canReplace(index, index + 1, Fragment.fromArray(replacement))) return 'unsupported'
    tr.replaceWith(pos, $from.after(depth), replacement)
    const firstPos = pos + (before.length ? replacement[0]!.nodeSize : 0) + 1
    const lastPos = firstPos + selected.slice(0, -1).reduce((size, node) => size + node.nodeSize, 0)
    tr.setSelection(TextSelection.create(tr.doc, firstPos + 1 + $from.parentOffset, lastPos + 1 + $to.parentOffset))
    return null
  }

  if ($from.depth !== $to.depth || $from.depth < 1 || $from.node($from.depth - 1) !== $to.node($to.depth - 1)) return 'unsupported'
  const parent = $from.node($from.depth - 1)
  const first = $from.index($from.depth - 1), last = $to.index($to.depth - 1)
  // A lone empty paragraph has nothing to convert: the caller inserts a fresh list in its place, but only where one may sit.
  if (first === last && $from.parent.isTextblock && $from.parent.content.size === 0 && (
    $from.parent.type.name === 'stdParagraph' || ($from.parent.type.name === 'paragraph' && listBodyContainers.has(parent.type.name))
  )) {
    const empty = stdList.create({ listType, level }, stdListItem.create())
    return parent.canReplace(first, last + 1, Fragment.from(empty)) ? 'nothing-to-convert' : 'unsupported'
  }
  if (!listableBlocks.has($from.parent.type.name) || !listableBlocks.has($to.parent.type.name)) return 'unsupported'
  const blocks = children(parent).slice(first, last + 1)
  if (!blocks.every(block => listableBlocks.has(block.type.name))) return 'unsupported'
  // Note/example references are typed by kind and have no list-item equivalent: refuse rather than dangle them.
  if (blocks.some(block => block.type.name !== 'stdParagraph' && hasReferenceTo(state.doc, block.attrs.nodeId))) return 'referenced-block'
  const items = blocks.map(block => stdListItem.create({ nodeId: block.attrs.nodeId }, block.content, block.marks))
  const list = stdList.create({ listType, level }, items)
  if (!parent.canReplace(first, last + 1, Fragment.from(list))) return 'unsupported'
  const from = $from.before($from.depth)
  tr.replaceWith(from, $to.after($to.depth), list)
  retargetReferences(tr, blocks.map(block => ({ id: block.attrs.nodeId, source: block.type.name })), 'stdListItem')
  const lastItemPos = from + 1 + items.slice(0, -1).reduce((size, node) => size + node.nodeSize, 0)
  tr.setSelection(TextSelection.create(tr.doc, from + 2 + $from.parentOffset, lastItemPos + 1 + $to.parentOffset))
  return null
}
