import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

const textBlocks = new Set(['paragraph', 'stdParagraph', 'note', 'example'])
const children = (node: PMNode): PMNode[] => node.content.content.slice()

interface ConvertedTarget { id: string; source: string }

type JsonRecord = Record<string, unknown>
const record = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)
type RewriteMark = (mark: JsonRecord) => JsonRecord

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
    set('marks', mapArray(item.marks, mark => mark.type === 'crossRef' ? rewrite(mark) : mark))
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

function hasReferenceTo(doc: PMNode, id: unknown): boolean {
  if (typeof id !== 'string' || !id) return false
  let found = false
  const visit: RewriteMark = mark => {
    const attrs = record(mark.attrs) ? mark.attrs : mark
    if ((attrs.targetId ?? attrs.refId) === id) found = true
    return mark
  }
  mapStoredAttrs(doc, visit)
  doc.descendants(node => {
    for (const mark of node.marks) if (mark.type.name === 'crossRef') visit({ type: 'crossRef', attrs: mark.attrs })
    mapStoredAttrs(node, visit)
  })
  return found
}

type RewriteAttrs = (attrs: JsonRecord, kindField: 'refType' | 'targetKind') => JsonRecord

/** Apply an attribute rewrite to every typed reference payload and crossRef mark of the transaction document. */
function rewriteReferences(tr: Transaction, rewriteAttrs: RewriteAttrs) {
  const rewrite: RewriteMark = mark => {
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
 */
export function retargetReferenceType(tr: Transaction, id: unknown, from: string, to: string) {
  if (typeof id !== 'string' || !id) return
  rewriteReferences(tr, (attrs, kindField) => {
    if ((attrs.targetId ?? attrs.refId) !== id || attrs[kindField] !== from) return attrs
    return { ...attrs, [kindField]: to }
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
const listableBlocks = new Set(['stdParagraph', 'note', 'example'])

/**
 * Turn the selection into list items of `listType` (a format command, not an insertion):
 * - list items: the selected items of one list become a new list of the target type; the parts before and
 *   after keep their type. A fully selected list only changes type/level and keeps its stable anchor;
 * - paragraphs, notes and examples (a range of adjacent blocks is allowed): each becomes one item of a single list.
 * Item ids and inline content survive, and a new list never duplicates the original list's anchor.
 * An empty paragraph answers 'nothing-to-convert' and any other selection 'unsupported', so the caller keeps
 * the plain insertion behaviour there; blocks that are referenced by kind answer 'referenced-block'.
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
  if (!listableBlocks.has($from.parent.type.name) || !listableBlocks.has($to.parent.type.name)) return 'unsupported'
  const parent = $from.node($from.depth - 1)
  const first = $from.index($from.depth - 1), last = $to.index($to.depth - 1)
  const blocks = children(parent).slice(first, last + 1)
  if (!blocks.every(block => listableBlocks.has(block.type.name))) return 'unsupported'
  // A lone empty paragraph has nothing to convert: the toolbar inserts a fresh list there instead.
  if (blocks.length === 1 && blocks[0]!.type.name === 'stdParagraph' && blocks[0]!.content.size === 0) return 'nothing-to-convert'
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
