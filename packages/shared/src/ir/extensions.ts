/** Shared semantic-extension detector for WP6 PM↔IR compatibility versioning. */
const semanticKeys = new Set([
  'titleParts', 'identifiers', 'languages', 'publishers', 'adoptions', 'replacedStandards',
  'copyrights', 'languageSets', 'nestedEntries', 'tailOrder', 'mathml', 'formula', 'style', 'width',
  'columnWidths', 'cellType', 'unit', 'groups', 'descriptions', 'resourceId', 'resources',
  'index', 'fields', 'entryType', 'externalLink', 'proposer', 'technicalCommittee',
  'imageWidth', 'imageHeight', 'alt', 'targetKind', 'subjectField',
])
const semanticMarks = new Set(['strike', 'code', 'variable', 'externalLink', 'bibRef', 'termRef'])
const semanticKinds = new Set(['warning', 'quote', 'code'])

function present(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  return !Array.isArray(value) || value.length > 0
}

/** Detect actual new semantic content anywhere, while leaving old WP1 snapshots unversioned. */
export function hasSemanticExtensions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasSemanticExtensions)
  const row = value as Record<string, unknown>
  if (typeof row.kind === 'string' && semanticKinds.has(row.kind)) return true
  if (Array.isArray(row.marks) && row.marks.some(mark => !!mark && typeof mark === 'object' && semanticMarks.has(String((mark as { type?: unknown }).type)))) return true
  if (row.kind === 'formula' && Array.isArray(row.notes) && row.notes.length > 0) return true
  if (row.kind === 'figure' && ['title', 'unit', 'resourceId', 'imageWidth', 'imageHeight', 'alt', 'descriptions', 'groups'].some(key => present(row[key]))) return true
  if (row.kind === 'table' && ['width', 'style', 'unit'].some(key => present(row[key]))) return true
  for (const [key, child] of Object.entries(row)) {
    if (semanticKeys.has(key) && present(child)) return true
    if (hasSemanticExtensions(child)) return true
  }
  return false
}
