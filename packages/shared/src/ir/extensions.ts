/** Shared semantic-extension detector for WP6 PM↔IR compatibility versioning. */
const semanticKeys = new Set([
  'titleParts', 'identifiers', 'languages', 'publishers', 'adoptions', 'replacedStandards',
  'copyrights', 'languageSets', 'nestedEntries', 'tailOrder', 'mathml', 'formula', 'style', 'width',
  'columnWidths', 'cellType', 'unit', 'groups', 'descriptions', 'resourceId', 'resources',
  'index', 'fields', 'entryType', 'externalLink', 'proposer', 'technicalCommittee',
  'imageWidth', 'imageHeight', 'alt', 'targetKind', 'subjectField', 'introductionClauses', 'bibliographyTitle', 'columns',
])
const semanticMarks = new Set(['strike', 'code', 'variable', 'externalLink', 'bibRef', 'termRef', 'stdRef', 'mixedCitation'])
const semanticKinds = new Set(['warning', 'quote', 'code', 'defList', 'normRefList'])

function present(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  return !Array.isArray(value) || value.length > 0
}

/**
 * 块位置注/示例的 canonical 判定（WP8.M G7-b）：content 恰为一个 id 等于 `${ownerId}.p0` 的段落时，
 * 生产模型用旧的行内 `note`/`example`；其余（多块、含列项、或段落 id 不是派生值）用 `noteBlock`/`exampleBlock`。
 * irToPm 与 hasSemanticExtensions 共用，保证两处判定一致。
 */
export function isInlineNoteContent(ownerId: string, content: ReadonlyArray<{ kind?: unknown; id?: unknown }>): boolean {
  return content.length === 1 && content[0]!.kind === 'paragraph' && content[0]!.id === `${ownerId}.p0`
}

/** Detect actual new semantic content anywhere, while leaving old WP1 snapshots unversioned. */
export function hasSemanticExtensions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasSemanticExtensions)
  const row = value as Record<string, unknown>
  if (typeof row.kind === 'string' && semanticKinds.has(row.kind)) return true
  if (Array.isArray(row.marks) && row.marks.some(mark => !!mark && typeof mark === 'object' && semanticMarks.has(String((mark as { type?: unknown }).type)))) return true
  // WP8.M G7：小写罗马列项（roman-lower）只有生产 stdList 的 roman 类型承载；listType 是旧字段，不能走通用键扫描。
  if (row.kind === 'list' && row.listType === 'roman') return true
  // WP8.M G7-b：多块/含列项/段落 id 非派生的注与示例由 noteBlock/exampleBlock 承载；content 是旧字段，不能走通用键扫描。
  if ((row.kind === 'note' || row.kind === 'example') && typeof row.id === 'string' && Array.isArray(row.content)
    && row.content.length > 0 && !isInlineNoteContent(row.id, row.content)) return true
  if (row.kind === 'formula' && Array.isArray(row.notes) && row.notes.length > 0) return true
  if (row.kind === 'figure' && ['title', 'unit', 'resourceId', 'imageWidth', 'imageHeight', 'alt', 'descriptions', 'groups'].some(key => present(row[key]))) return true
  if (row.kind === 'table' && ['width', 'style', 'unit'].some(key => present(row[key]))) return true
  for (const [key, child] of Object.entries(row)) {
    if (semanticKeys.has(key) && present(child)) return true
    if (hasSemanticExtensions(child)) return true
  }
  return false
}
