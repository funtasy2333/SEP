import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { generateNodeId } from '@ses/shared'

/**
 * 携带 nodeId 属性的生产节点类型清单。
 * 除块级实体外，也包括拥有稳定 IR ID 的行内 atom 和结构化文献实体；
 * 清单中未注册到 schema 的类型名会被 Tiptap 忽略，无副作用。
 */
export const NODE_ID_TYPES = [
  // 自定义块级节点
  'coverPage',
  'foreword',
  'introduction',
  'chapter',
  'clause',
  'stdParagraph',
  'termDef',
  // termDefinition itself maps to the first IR definition paragraph entity.
  'termDefinition',
  'stdTable',
  'tableFootnoteEntry',
  'figure',
  'figureSet',
  'alignedArray',
  'sharedFootnoteDefinition',
  'formula',
  'formulaGroup',
  'stdList',
  'note',
  'example',
  // WP8.M G7-b：块内容的注/示例（IR 的 IRNote/IRExample 实体 id）
  'noteBlock',
  'exampleBlock',
  'appendix',
  'bibliography',
  // Structured document metadata records (metadataBlock is a non-semantic container).
  'titlePart',
  'standardIdentifier',
  'identifierPart',
  'language',
  'publisher',
  'adoption',
  'replacedStandard',
  'copyright',
  // TBX language sets, term groups, variants and descriptors.
  'tbxLangSet',
  'tbxTig',
  'tbxTermVariant',
  'tbxTermDescriptor',
  // Formula semantic records (formulaInline is a referenceable inline atom).
  'formulaInline',
  'formulaNote',
  'whereItem',
  // 缩略语表（WP8.M G2）：容器带 nodeId；项复用 whereItem。
  'defList',
  // 图例（WP8.M G3）：容器带 nodeId（IRLegend.id）；项复用 whereItem，标题 figureLegendTitle 与行内图 inlineImage 无 id。
  'figureLegend',
  // Figure/resource and typed bibliography semantic records.
  'figureGroup',
  'figureDescription',
  'figureResource',
  'bibField',
  'bibIdentifier',
  // Index and prose-role blocks.
  'indexBlock',
  'indexGroup',
  'indexEntry',
  'warning',
  'quoteBlock',
  'codeBlock',
  // 块级容器内的可引用子节点（IR 类型中带 id，需稳定锚点供 WP3 pmToIr 使用）；
  // 表格行/单元格与公式 whereList 项的 ID 来源策略在 WP3 设计时确定
  'stdListItem',
  'stdListBlockItem',
  'bibEntry',
  // 规范性引用文件清单及其条目（IR 的 IRNormRefList / IRNormRef 带 id；子节点 normRefStdRef/normRefStdTitle 无 id）。
  'normRefList',
  'normRefStd',
  'normRefMixed',
  // Resolver assigns stable IDs to table rows/cells as well as their semantic table wrapper.
  'tableRow',
  'tableCell',
  'tableHeader',
  // StarterKit 中可出现在 block 内容里的节点
  // （table 不在列表中：其 NodeView 不渲染 data-node-id，且语义节点是外层 stdTable）
  'paragraph',
  'blockquote',
  'bulletList',
  'orderedList',
  'horizontalRule',
  'listItem',
  // Inline footnote references have document-wide stable identities for labels and XML round trips.
  'footnoteRef',
  'tableFootnoteRef',
]

export interface NodeIdFix {
  pos: number
  nodeId: string
}

interface GraphicIdFix { pos: number; field: 'additionalGraphics' | 'alternativeGraphic'; value: unknown }

/** Embedded graphic IDs are definitions too, although they are not ProseMirror nodes. */
function graphicIdFixes(doc: PMNode, repair: boolean): GraphicIdFix[] {
  const seen = new Set<string>()
  doc.descendants(node => {
    if (typeof node.attrs.nodeId === 'string' && node.attrs.nodeId) seen.add(node.attrs.nodeId)
  })
  const reserved = new Set(seen)
  doc.descendants(node => visitGraphicAttrs(node, id => { if (typeof id === 'string' && id) reserved.add(id) }, () => {}))
  const fixes: GraphicIdFix[] = []
  doc.descendants((node, pos) => {
    const field = node.type.name === 'figure' ? 'additionalGraphics' : node.type.name === 'stdTable' ? 'alternativeGraphic' : null
    if (!field) return
    const raw = node.attrs[field]
    const values = field === 'additionalGraphics' && Array.isArray(raw) ? raw : field === 'alternativeGraphic' && raw ? [raw] : []
    let changed = false
    const next = values.map((value: unknown) => {
      if (!isRecord(value)) return value
      const id = value.nodeId
      if (typeof id === 'string' && id && !seen.has(id)) { seen.add(id); return value }
      changed = true
      if (!repair) return value
      let replacement = generateNodeId()
      while (reserved.has(replacement)) replacement = generateNodeId()
      reserved.add(replacement)
      seen.add(replacement)
      return { ...value, nodeId: replacement }
    })
    if (changed) fixes.push({ pos, field, value: field === 'additionalGraphics' ? next : next[0] })
  })
  return fixes
}

/**
 * 扫描文档，找出缺失或重复的 nodeId，返回待修复列表（pos → 新 ID）。
 * 重复时按文档顺序保留首个出现的 ID，后续重复者重新生成（同文档内唯一是硬约束）。
 * 普通剪贴板粘贴在 transformPasted 阶段会先按 slice 范围重映射冲突 ID，
 * 避免把原件身份转移给副本；本函数仍作为其他事务（如程序化替换）的唯一性后备修复。
 * 纯函数，便于单测。
 */
export function findNodeIdFixes(doc: PMNode): NodeIdFix[] {
  const seen = new Set<string>()
  const fixes: NodeIdFix[] = []
  doc.descendants((node, pos) => {
    if (!('nodeId' in node.attrs)) return
    const id = node.attrs.nodeId
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id)
      return
    }
    let newId = generateNodeId()
    while (seen.has(newId)) newId = generateNodeId()
    seen.add(newId)
    fixes.push({ pos, nodeId: newId })
  })
  return fixes
}

/** Check whether a document needs ID repair without allocating throwaway IDs. */
export function hasNodeIdIssues(doc: PMNode): boolean {
  const seen = new Set<string>()
  let hasIssues = false
  doc.descendants((node) => {
    if (!('nodeId' in node.attrs)) return
    const id = node.attrs.nodeId
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id)
      return
    }
    hasIssues = true
  })
  return hasIssues || graphicIdFixes(doc, false).length > 0
}

/** Normalize a detached candidate with the same ID policy used by the live plugin. */
export function normalizeNodeIds(doc: PMNode): PMNode {
  const fixes = findNodeIdFixes(doc)
  const transaction = EditorState.create({ doc }).tr
  for (const { pos, nodeId } of fixes) transaction.setNodeAttribute(pos, 'nodeId', nodeId)
  const graphicFixes = graphicIdFixes(transaction.doc, true)
  for (const fix of graphicFixes) transaction.setNodeAttribute(fix.pos, fix.field, fix.value)
  if (fixes.length === 0 && graphicFixes.length === 0) return doc
  return transaction.doc
}

type JsonRecord = Record<string, unknown>
type PastedIdRemaps = {
  ids: ReadonlyMap<string, string>
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function remapId(id: unknown, remaps: PastedIdRemaps): unknown {
  if (typeof id !== 'string') return id
  return remaps.ids.get(id) ?? id
}

function remapReferenceMark(mark: unknown, remaps: PastedIdRemaps): unknown {
  if (!isRecord(mark) || typeof mark.type !== 'string') return mark
  const markType = mark.type
  if (!['crossRef', 'bibRef', 'termRef'].includes(markType)) return mark

  const attrs = isRecord(mark.attrs) ? mark.attrs : null
  const activeTarget = markType === 'crossRef'
    ? (attrs?.targetId ?? mark.targetId ?? attrs?.refId ?? mark.refId)
    : (attrs?.targetId ?? mark.targetId)
  const mappedTarget = remapId(activeTarget, remaps)
  if (mappedTarget === activeTarget) return mark
  if (attrs) {
    const nextAttrs = { ...attrs }
    if (markType === 'crossRef' && attrs.targetId == null && attrs.refId != null) nextAttrs.refId = mappedTarget
    else nextAttrs.targetId = mappedTarget
    return { ...mark, attrs: nextAttrs }
  }
  const nextMark = { ...mark }
  if (markType === 'crossRef' && mark.targetId == null && mark.refId != null) nextMark.refId = mappedTarget
  else nextMark.targetId = mappedTarget
  return nextMark
}

function remapTypedInlineMark(mark: unknown, remaps: PastedIdRemaps): unknown {
  const reference = remapReferenceMark(mark, remaps)
  if (reference !== mark) return reference
  if (!isRecord(mark) || mark.type !== 'tableFootnoteRef') return mark
  const attrs = isRecord(mark.attrs) ? mark.attrs : null
  const nextAttrs = attrs ? { ...attrs } : null
  const targetId = remapId(attrs?.targetId ?? mark.targetId, remaps)
  const refId = remapId(attrs?.id ?? mark.id, remaps)
  if (targetId === (attrs?.targetId ?? mark.targetId) && refId === (attrs?.id ?? mark.id)) return mark
  if (nextAttrs) {
    nextAttrs.targetId = targetId
    nextAttrs.id = refId
    return { ...mark, attrs: nextAttrs }
  }
  return { ...mark, targetId, id: refId }
}

/** Only visit the typed inline payload shape used by IR metadata and footnote content. */
function remapTypedInlinePayload(value: unknown, remaps: PastedIdRemaps): unknown {
  if (!Array.isArray(value)) return value
  let changed = false
  const next = value.map((item) => {
    if (!isRecord(item)) return item
    let itemChanged = false
    const copy: JsonRecord = { ...item }
    const originalMarks = item.marks
    if (Array.isArray(originalMarks)) {
      const marks = originalMarks.map((mark) => remapTypedInlineMark(mark, remaps))
      if (marks.some((mark, index) => mark !== originalMarks[index])) {
        copy.marks = marks
        itemChanged = true
      }
    }
    if (isRecord(item.footnote) && Array.isArray(item.footnote.content)) {
      const mappedId = remapId(item.footnote.id, remaps)
      const content = remapTypedInlinePayload(item.footnote.content, remaps)
      if (mappedId !== item.footnote.id) {
        copy.footnote = { ...item.footnote, id: mappedId, content }
        itemChanged = true
      }
      if (content !== item.footnote.content) {
        copy.footnote = { ...item.footnote, ...(mappedId !== item.footnote.id ? { id: mappedId } : {}), content }
        itemChanged = true
      }
    }
    if (isRecord(item.formula) && typeof item.formula.id === 'string') {
      const id = remapId(item.formula.id, remaps)
      if (id !== item.formula.id) {
        copy.formula = { ...item.formula, id }
        itemChanged = true
      }
    }
    if (typeof item.type === 'string' && Array.isArray(item.content)) {
      const content = remapTypedInlinePayload(item.content, remaps)
      if (content !== item.content) {
        copy.content = content
        itemChanged = true
      }
    }
    if (item.type === 'footnoteRef' && isRecord(item.attrs) && Array.isArray(item.attrs.content)) {
      const content = remapTypedInlinePayload(item.attrs.content, remaps)
      if (content !== item.attrs.content) {
        copy.attrs = { ...item.attrs, content }
        itemChanged = true
      }
    }
    if (itemChanged) {
      changed = true
      return copy
    }
    return item
  })
  return changed ? next : value
}

function visitTypedInlinePayload(
  value: unknown,
  visitDefinition: (id: unknown) => void,
  visitReference: (id: unknown) => void,
): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!isRecord(item)) continue
    if (isRecord(item.formula)) visitDefinition(item.formula.id)
    if (isRecord(item.footnote)) {
      visitDefinition(item.footnote.id)
      visitTypedInlinePayload(item.footnote.content, visitDefinition, visitReference)
    }
    if (Array.isArray(item.marks)) {
      for (const mark of item.marks) {
        const reference = referencedId(mark)
        if (reference) visitReference(reference)
        if (isRecord(mark) && mark.type === 'tableFootnoteRef') visitDefinition(isRecord(mark.attrs) ? mark.attrs.id : mark.id)
      }
    }
    if (typeof item.type === 'string' && Array.isArray(item.content)) {
      visitTypedInlinePayload(item.content, visitDefinition, visitReference)
    }
    if (item.type === 'footnoteRef' && isRecord(item.attrs)) {
      visitTypedInlinePayload(item.attrs.content, visitDefinition, visitReference)
    }
  }
}

const FALLBACK_METADATA_ARRAYS = [
  'titleParts', 'identifiers', 'languages', 'publishers', 'adoptions', 'replacedStandards', 'copyrights',
] as const

function visitMetadataFallback(
  attrs: JsonRecord,
  visitDefinition: (id: unknown) => void,
  visitReference: (id: unknown) => void,
): void {
  for (const field of FALLBACK_METADATA_ARRAYS) {
    const rows = attrs[field]
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!isRecord(row)) continue
      visitDefinition(row.id)
      if (field === 'titleParts') visitTypedInlinePayload(row.content, visitDefinition, visitReference)
      if (field === 'identifiers' && Array.isArray(row.parts)) {
        for (const part of row.parts) {
          if (!isRecord(part)) continue
          visitDefinition(part.id)
          visitTypedInlinePayload(part.content, visitDefinition, visitReference)
        }
      }
      if (field === 'publishers') visitTypedInlinePayload(row.name, visitDefinition, visitReference)
      if (field === 'copyrights') {
        visitTypedInlinePayload(row.holder, visitDefinition, visitReference)
        visitTypedInlinePayload(row.statement, visitDefinition, visitReference)
      }
    }
  }
}

function addIdCount(counts: Map<string, number>, id: unknown): void {
  if (typeof id === 'string' && id.length > 0) counts.set(id, (counts.get(id) ?? 0) + 1)
}

function visitGraphicAttrs(node: PMNode, definition: (id: unknown) => void, reference: (id: unknown) => void): void {
  const values = node.type.name === 'figure' && Array.isArray(node.attrs.additionalGraphics)
    ? node.attrs.additionalGraphics : node.type.name === 'stdTable' ? [node.attrs.alternativeGraphic] : []
  for (const value of values) if (isRecord(value)) {
    definition(value.nodeId)
    reference(value.resourceId)
  }
}

function collectSliceDefinitionCounts(slice: Slice): Map<string, number> {
  const counts = new Map<string, number>()
  slice.content.descendants((node) => {
    addIdCount(counts, node.attrs.nodeId)
    visitGraphicAttrs(node, id => addIdCount(counts, id), () => {})
    if (node.type.name === 'footnoteRef' || node.type.name === 'sharedFootnoteDefinition') {
      visitTypedInlinePayload(node.attrs.content, id => addIdCount(counts, id), () => {})
    }
    if (node.type.name === 'coverPage') {
      visitMetadataFallback(node.attrs, id => addIdCount(counts, id), () => {})
    }
  })
  return counts
}

function collectDocDefinitionIds(doc: PMNode): Set<string> {
  const ids = new Set<string>()
  const add = (id: unknown) => { if (typeof id === 'string' && id.length > 0) ids.add(id) }
  doc.descendants((node) => {
    add(node.attrs.nodeId)
    visitGraphicAttrs(node, add, () => {})
    if (node.type.name === 'footnoteRef' || node.type.name === 'sharedFootnoteDefinition') visitTypedInlinePayload(node.attrs.content, add, () => {})
    if (node.type.name === 'coverPage') visitMetadataFallback(node.attrs, add, () => {})
  })
  visitMetadataFallback(doc.attrs, add, () => {})
  return ids
}

function collectSliceReferenceIds(slice: Slice): Set<string> {
  const references = new Set<string>()
  const addReference = (id: unknown) => { if (typeof id === 'string' && id.length > 0) references.add(id) }
  slice.content.descendants((node) => {
    visitGraphicAttrs(node, () => {}, addReference)
    for (const mark of node.marks) addReference(referencedId({ type: mark.type.name, attrs: mark.attrs }))
    if (node.type.name === 'footnoteRef' || node.type.name === 'sharedFootnoteDefinition') visitTypedInlinePayload(node.attrs.content, () => {}, addReference)
    if (node.type.name === 'coverPage') visitMetadataFallback(node.attrs, () => {}, addReference)
    const targetFields: Record<string, string[]> = {
      tableFootnoteRef: ['targetId'],
      sharedFootnoteRef: ['targetId'],
      figureResourceRef: ['targetId'],
      indexTarget: ['targetId'],
      indexSeeAlso: ['targetId'],
      figureImage: ['resourceId'],
      inlineImage: ['resourceId'],
    }
    for (const field of targetFields[node.type.name] ?? []) addReference(node.attrs[field])
  })
  return references
}

function referencedId(mark: unknown): string | null {
  if (!isRecord(mark) || typeof mark.type !== 'string') return null
  const attrs = isRecord(mark.attrs) ? mark.attrs : null
  if (mark.type === 'tableFootnoteRef') {
    const targetId = attrs?.targetId ?? mark.targetId
    return typeof targetId === 'string' && targetId.length > 0 ? targetId : null
  }
  if (!['crossRef', 'bibRef', 'termRef'].includes(mark.type)) return null
  const target = mark.type === 'crossRef'
    ? (attrs?.targetId ?? mark.targetId ?? attrs?.refId ?? mark.refId)
    : (attrs?.targetId ?? mark.targetId)
  return typeof target === 'string' && target.length > 0 ? target : null
}

function getAmbiguousPastedReferencesMessage(slice: Slice, currentDoc: PMNode): string | null {
  const counts = collectSliceDefinitionCounts(slice)
  const references = collectSliceReferenceIds(slice)
  const existingIds = collectDocDefinitionIds(currentDoc)
  const ambiguousReferencedId = [...counts].some(([id, count]) => count > 1 && references.has(id))
  if (ambiguousReferencedId) return '粘贴内容含重复引用目标，无法确定关联，请先修正源内容'
  const conflictingId = [...counts].some(([id, count]) => count > 1 && existingIds.has(id))
  if (conflictingId) return '粘贴内容含重复节点 ID，与当前文档冲突，无法保留原件及引用关系；请先修正源内容'
  return null
}

/** Rewrite only documented typed metadata carrier fields on a copied cover page. */
function remapCoverMetadataFallback(attrs: JsonRecord, remaps: PastedIdRemaps): JsonRecord {
  let changed = false
  const next: JsonRecord = { ...attrs }
  const mapRows = (field: string, mapRow: (row: JsonRecord) => JsonRecord): void => {
    const rows = attrs[field]
    if (!Array.isArray(rows)) return
    let rowsChanged = false
    const mappedRows = rows.map((row) => {
      if (!isRecord(row)) return row
      const mapped = mapRow(row)
      if (mapped !== row) rowsChanged = true
      return mapped
    })
    if (rowsChanged) {
      next[field] = mappedRows
      changed = true
    }
  }
  const mapId = (row: JsonRecord): JsonRecord => {
    const id = remapId(row.id, remaps)
    return id === row.id ? row : { ...row, id }
  }
  const mapInlineField = (row: JsonRecord, field: string): JsonRecord => {
    const content = remapTypedInlinePayload(row[field], remaps)
    return content === row[field] ? row : { ...row, [field]: content }
  }

  mapRows('titleParts', (row) => mapInlineField(mapId(row), 'content'))
  mapRows('languages', mapId)
  mapRows('adoptions', mapId)
  mapRows('replacedStandards', mapId)
  mapRows('publishers', (row) => mapInlineField(mapId(row), 'name'))
  mapRows('copyrights', (row) => {
    let mapped = mapInlineField(mapId(row), 'holder')
    mapped = mapInlineField(mapped, 'statement')
    return mapped
  })
  mapRows('identifiers', (row) => {
    const mappedRow = mapId(row)
    if (!Array.isArray(row.parts)) return mappedRow
    let partsChanged = false
    const parts = row.parts.map((part) => {
      if (!isRecord(part)) return part
      const mapped = mapInlineField(mapId(part), 'content')
      if (mapped !== part) partsChanged = true
      return mapped
    })
    return partsChanged ? { ...mappedRow, parts } : mappedRow
  })
  return changed ? next : attrs
}

function remapPastedNode(node: PMNode, remaps: PastedIdRemaps): PMNode {
  const children = node.content.content.map((child) => remapPastedNode(child, remaps))
  let attrs: Record<string, unknown> | null = null
  const mappedNodeId = remapId(node.attrs.nodeId, remaps)
  if (mappedNodeId !== node.attrs.nodeId) attrs = { ...node.attrs, nodeId: mappedNodeId }

  const remapGraphic = (value: unknown): unknown => {
    if (!isRecord(value)) return value
    const id = remapId(value.nodeId, remaps)
    const resource = remapId(value.resourceId, remaps)
    return id === value.nodeId && resource === value.resourceId ? value : { ...value, nodeId: id, resourceId: resource }
  }
  if (node.type.name === 'figure' && Array.isArray(node.attrs.additionalGraphics)) {
    const next = node.attrs.additionalGraphics.map(remapGraphic)
    if (next.some((value: unknown, index: number) => value !== node.attrs.additionalGraphics[index])) attrs = { ...(attrs ?? node.attrs), additionalGraphics: next }
  }
  if (node.type.name === 'stdTable' && node.attrs.alternativeGraphic) {
    const next = remapGraphic(node.attrs.alternativeGraphic)
    if (next !== node.attrs.alternativeGraphic) attrs = { ...(attrs ?? node.attrs), alternativeGraphic: next }
  }

  const referenceFields: Record<string, string[]> = {
    tableFootnoteRef: ['targetId'],
    sharedFootnoteRef: ['targetId'],
    figureResourceRef: ['targetId'],
    indexTarget: ['targetId'],
    indexSeeAlso: ['targetId'],
    figureImage: ['resourceId'],
    inlineImage: ['resourceId'],
  }
  for (const field of referenceFields[node.type.name] ?? []) {
    const mapped = remapId(node.attrs[field], remaps)
    if (mapped !== node.attrs[field]) attrs = { ...(attrs ?? node.attrs), [field]: mapped }
  }
  if (node.type.name === 'footnoteRef' || node.type.name === 'sharedFootnoteDefinition') {
    const payload = remapTypedInlinePayload(node.attrs.content, remaps)
    if (payload !== node.attrs.content) attrs = { ...(attrs ?? node.attrs), content: payload }
  }
  if (node.type.name === 'coverPage') {
    const metadata = remapCoverMetadataFallback(node.attrs, remaps)
    if (metadata !== node.attrs) attrs = { ...(attrs ?? node.attrs), ...metadata }
  }
  // A metadata fallback carrier may copy stale IR IDs verbatim; the owning PM nodeId
  // remains the final source of identity for that cover container.
  if (mappedNodeId !== node.attrs.nodeId) attrs = { ...(attrs ?? node.attrs), nodeId: mappedNodeId }

  const marks = node.marks.map((mark) => {
    const mapped = remapReferenceMark({ type: mark.type.name, attrs: mark.attrs }, remaps)
    if (!isRecord(mapped) || !isRecord(mapped.attrs) || mapped.attrs === mark.attrs) return mark
    return mark.type.create(mapped.attrs)
  })
  const marksChanged = marks.some((mark, index) => mark !== node.marks[index])

  const contentChanged = children.some((child, index) => child !== node.child(index))
  if (!attrs && !contentChanged && !marksChanged) return node
  if (node.isText) return marksChanged ? node.mark(marks) : node
  return node.type.create(attrs ?? node.attrs, children, marks)
}

function buildPastedIdRemaps(slice: Slice, currentDoc: PMNode): Map<string, string> {
  const counts = collectSliceDefinitionCounts(slice)
  const existingIds = collectDocDefinitionIds(currentDoc)
  const reserved = new Set([...existingIds, ...counts.keys()])
  const remaps = new Map<string, string>()
  for (const [id, count] of counts) {
    if (count !== 1 || !existingIds.has(id)) continue
    let replacement = generateNodeId()
    while (reserved.has(replacement)) replacement = generateNodeId()
    reserved.add(replacement)
    remaps.set(id, replacement)
  }
  return remaps
}

function applyPastedIdRemaps(slice: Slice, ids: ReadonlyMap<string, string>): Slice {
  if (ids.size === 0) return slice
  const context: PastedIdRemaps = { ids }
  const content = slice.content.content.map((node) => remapPastedNode(node, context))
  return new Slice(Fragment.fromArray(content), slice.openStart, slice.openEnd)
}

/**
 * Remap colliding IDs only when the pasted slice defines that ID exactly once.
 * Duplicate definitions remain untouched here so references are never guessed.
 */
export function remapPastedSliceIds(slice: Slice, currentDoc: PMNode): Slice {
  return applyPastedIdRemaps(slice, buildPastedIdRemaps(slice, currentDoc))
}

function hasDroppedInternalPasteTarget(
  sourceSlice: Slice,
  candidateDoc: PMNode,
  idRemaps: ReadonlyMap<string, string>,
): boolean {
  const definitions = collectSliceDefinitionCounts(sourceSlice)
  const references = collectSliceReferenceIds(sourceSlice)
  const candidateIds = collectDocDefinitionIds(candidateDoc)
  for (const [id, count] of definitions) {
    if (count !== 1 || !references.has(id)) continue
    const expectedId = idRemaps.get(id) ?? id
    if (!candidateIds.has(expectedId)) return true
  }
  return false
}

/**
 * When ProseMirror pastes a complete table with table-footnote definitions, NodeId repairs the
 * copied entry IDs. Remap that table's copied references with them so each copied table remains
 * self-contained. A duplicate definition inside one table is ambiguous, so leave its references
 * untouched and let the shared resolver report the invalid/unreferenced IDs.
 */
function findCopiedTableFootnoteTargets(doc: PMNode, fixes: NodeIdFix[]): Array<{ pos: number; targetId: string }> {
  const fixPositions = new Set(fixes.map((fix) => fix.pos))
  const seen = new Set<string>()
  const remapsByTable = new Map<number, Map<string, string>>()

  doc.descendants((node, pos) => {
    if (!('nodeId' in node.attrs)) return
    const id = node.attrs.nodeId
    const duplicated = typeof id === 'string' && id.length > 0 && seen.has(id)
    if (typeof id === 'string' && id.length > 0) seen.add(id)
    if (node.type.name !== 'tableFootnoteEntry' || !duplicated || !fixPositions.has(pos)) return

    const $pos = doc.resolve(pos + 1)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name !== 'stdTable') continue
      const table = $pos.node(depth)
      const tablePos = $pos.before(depth)
      let matchingEntries = 0
      table.descendants((child) => {
        if (child.type.name === 'tableFootnoteEntry' && child.attrs.nodeId === id) matchingEntries += 1
      })
      if (matchingEntries !== 1) return
      const targetRemaps = remapsByTable.get(tablePos) ?? new Map<string, string>()
      targetRemaps.set(id, fixes.find((fix) => fix.pos === pos)!.nodeId)
      remapsByTable.set(tablePos, targetRemaps)
      return
    }
  })

  const targetFixes: Array<{ pos: number; targetId: string }> = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'tableFootnoteRef' || typeof node.attrs.targetId !== 'string') return
    const $pos = doc.resolve(pos + 1)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name !== 'stdTable') continue
      const targetId = remapsByTable.get($pos.before(depth))?.get(node.attrs.targetId)
      if (targetId) targetFixes.push({ pos, targetId })
      return
    }
  })
  return targetFixes
}

export const ensureNodeIdPluginKey = new PluginKey('ensureNodeId')

/**
 * 事务后扫描文档，给缺 nodeId 的块级节点补 ID，并重新生成重复 ID
 * （粘贴会复制 data-node-id，必须去重）。
 */
export function ensureNodeIdPlugin(): Plugin {
  return new Plugin({
    key: ensureNodeIdPluginKey,
    props: {
      handlePaste(view, _event, slice) {
        const ambiguousMessage = getAmbiguousPastedReferencesMessage(slice, view.state.doc)
        if (ambiguousMessage) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ses:paste-reference-error', {
              detail: { message: ambiguousMessage },
            }))
          }
          return true
        }
        const ids = buildPastedIdRemaps(slice, view.state.doc)
        const candidateSlice = applyPastedIdRemaps(slice, ids)
        // Match ProseMirror doPaste: a closed single-node slice uses replaceSelectionWith;
        // every other rich paste uses replaceSelection. This preview is detached and never dispatches.
        const preview = view.state.tr
        if (candidateSlice.openStart === 0 && candidateSlice.openEnd === 0 && candidateSlice.content.childCount === 1) {
          preview.replaceSelectionWith(candidateSlice.content.firstChild!, false)
        } else {
          preview.replaceSelection(candidateSlice)
        }
        if (hasDroppedInternalPasteTarget(slice, preview.doc, ids)) {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('ses:paste-reference-error', {
              detail: { message: '此粘贴位置会合并引用目标所在段落，无法保留内部引用关系；请在结构边界粘贴或调整选区' },
            }))
          }
          return true
        }
        return false
      },
      transformPasted(slice, view: EditorView) {
        return remapPastedSliceIds(slice, view.state.doc)
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const fixes = findNodeIdFixes(newState.doc)
      const targetFixes = findCopiedTableFootnoteTargets(newState.doc, fixes)
      const tr = newState.tr
      // 仅改属性不改文档结构，pos 在本事务内保持有效
      for (const { pos, nodeId } of fixes) {
        tr.setNodeAttribute(pos, 'nodeId', nodeId)
      }
      for (const { pos, targetId } of targetFixes) {
        tr.setNodeAttribute(pos, 'targetId', targetId)
      }
      const graphicFixes = graphicIdFixes(tr.doc, true)
      for (const fix of graphicFixes) tr.setNodeAttribute(fix.pos, fix.field, fix.value)
      if (fixes.length === 0 && targetFixes.length === 0 && graphicFixes.length === 0) return null
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
}

/**
 * NodeId 扩展：
 * - 给全部块级节点注册 `nodeId` 属性，renderHTML 写 `data-node-id`，parseHTML 读回；
 * - 拆分节点时新节点不继承 nodeId（keepOnSplit: false），由插件补新 ID；
 * - onCreate 时对初始文档补齐（旧文档打开自动补 ID）。
 */
export const NodeId = Extension.create({
  name: 'nodeId',

  addGlobalAttributes() {
    return [
      {
        types: NODE_ID_TYPES,
        attributes: {
          nodeId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute('data-node-id'),
            renderHTML: (attributes) =>
              attributes.nodeId ? { 'data-node-id': attributes.nodeId } : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [ensureNodeIdPlugin()]
  },

  onCreate() {
    const { state, view } = this.editor
    const fixes = findNodeIdFixes(state.doc)
    const tr = state.tr
    for (const { pos, nodeId } of fixes) {
      tr.setNodeAttribute(pos, 'nodeId', nodeId)
    }
    const graphicFixes = graphicIdFixes(tr.doc, true)
    for (const fix of graphicFixes) tr.setNodeAttribute(fix.pos, fix.field, fix.value)
    if (fixes.length === 0 && graphicFixes.length === 0) return
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  },
})
