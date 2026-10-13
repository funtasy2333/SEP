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

/** Keep text references on paragraphs, and container references on the converted block. */
function retargetReferences(tr: Transaction, converted: ConvertedTarget[], targetName: string) {
  const targets = new Map(converted.filter(item => item.id).map(item => [item.id, item.source]))
  const targetKind = targetName === 'stdParagraph' ? 'paragraph' : targetName
  const rewriteAttrs = (attrs: JsonRecord, kindField: 'refType' | 'targetKind'): JsonRecord => {
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
  }
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

/** Change whole text blocks; a partial selection must never erase unselected text. */
export function formatTextBlock(state: EditorState, tr: Transaction, targetName: 'stdParagraph' | 'note' | 'example'): boolean {
  const { $from, $to } = state.selection
  const target = state.schema.nodes[targetName]!
  if ($from.parent.type.name === 'stdListItem' && $to.parent.type.name === 'stdListItem') {
    const depth = $from.depth - 1
    const list = $from.node(depth)
    if (list.type.name !== 'stdList' || $to.depth !== $from.depth || $to.node(depth) !== list) return false
    const listNodes = children(list)
    const start = $from.index(depth), end = $to.index(depth) + 1
    const before = listNodes.slice(0, start), after = listNodes.slice(end)
    if (!before.length && !after.length && hasReferenceTo(state.doc, list.attrs.nodeId)) return false
    const selected = listNodes.slice(start, end)
    const converted = selected.map(item => target.create({ nodeId: item.attrs.nodeId }, item.content, item.marks))
    const replacement: PMNode[] = []
    if (before.length) replacement.push(list.type.create(list.attrs, before, list.marks))
    replacement.push(...converted)
    // The second fragment is a new list; never duplicate the original stable anchor.
    if (after.length) replacement.push(list.type.create({ ...list.attrs, ...(before.length ? { nodeId: null } : {}) }, after, list.marks))
    const parent = $from.node(depth - 1), index = $from.index(depth - 1)
    if (!parent.canReplace(index, index + 1, Fragment.fromArray(replacement))) return false
    const pos = $from.before(depth)
    tr.replaceWith(pos, $from.after(depth), replacement)
    retargetReferences(tr, selected.map(item => ({ id: item.attrs.nodeId, source: 'stdListItem' })), targetName)
    const firstPos = pos + (replacement[0]?.type.name === 'stdList' ? replacement[0].nodeSize : 0)
    const lastPos = firstPos + converted.slice(0, -1).reduce((size, node) => size + node.nodeSize, 0)
    tr.setSelection(TextSelection.create(tr.doc, firstPos + 1 + $from.parentOffset, lastPos + 1 + $to.parentOffset))
    return true
  }
  if (!$from.sameParent($to) || !textBlocks.has($from.parent.type.name)) return false
  const parent = $from.node($from.depth - 1), index = $from.index($from.depth - 1)
  if (!parent.canReplaceWith(index, index + 1, target)) return false
  const leaf = $from.parent, pos = $from.before($from.depth)
  tr.replaceWith(pos, $from.after($from.depth), target.create({ nodeId: leaf.attrs.nodeId }, leaf.content, leaf.marks))
  retargetReferences(tr, [{ id: leaf.attrs.nodeId, source: leaf.type.name }], targetName)
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + $from.parentOffset, pos + 1 + $to.parentOffset))
  return true
}
