import {
  buildCoverDesignation, getCoverDesignationName, getCoverDesignationParts, pmToIr,
  type Document, type DocumentMeta, type PMJsonNode,
} from '@ses/shared'

/** Editable settings live in a form draft; optional fields stay strings so blank means clear. */
export interface DocumentSettingsDraft {
  standardType: string
  stage: string
  titleCn: string
  titleEn: string
  standardNo: string
  icsCode: string
  ccsCode: string
  issuer: string
  applicant: string
  proposer: string
  technicalCommittee: string
  replaces: string
  consistency: string
  publishDate: string
  implementDate: string
  filingNo: string
  industryName: string
  regionName: string
  coverDesignation: string
}

export const DOCUMENT_SETTINGS_FIELDS = [
  'standardType', 'stage', 'titleCn', 'titleEn', 'standardNo', 'icsCode', 'ccsCode',
  'issuer', 'applicant', 'proposer', 'technicalCommittee', 'replaces', 'consistency',
  'publishDate', 'implementDate', 'filingNo', 'industryName', 'regionName', 'coverDesignation',
] as const satisfies ReadonlyArray<keyof DocumentSettingsDraft>

/** Cover values are the editor/XML source of truth; legacy root attributes remain synchronized when present. */
export const COVER_SETTINGS_KEYS = [
  'standardType', 'standardNo', 'titleCn', 'titleEn', 'icsCode', 'ccsCode', 'issuer', 'applicant', 'proposer', 'technicalCommittee',
  'publishDate', 'implementDate', 'replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation',
] as const satisfies ReadonlyArray<keyof DocumentMeta>

const IR_TO_DOCUMENT_TYPE = new Map<string, string>([
  ['gb', 'national'], ['industry', 'industry'], ['local', 'local'], ['group', 'group'], ['enterprise', 'enterprise'], ['guide', 'guidance'],
])

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function irField(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' ? value : undefined
}

function nonEmptyAttribute(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = attrs?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function effectiveRawType(content: Record<string, unknown>): string | undefined {
  const rootAttrs = content.attrs && typeof content.attrs === 'object'
    ? content.attrs as Record<string, unknown> : undefined
  const nodes = Array.isArray(content.content) ? content.content as PMJsonNode[] : []
  const coverAttrs = nodes.find((node) => node.type === 'coverPage')?.attrs
  return nonEmptyAttribute(rootAttrs, 'standardType') ?? nonEmptyAttribute(coverAttrs, 'standardType')
}

/**
 * Prefill from database metadata first, then from the effective cover/root metadata in old JSON.
 * A database empty string is intentional and therefore wins over a non-empty old cover value.
 */
export function documentSettingsDraftFromDocument(
  document: Pick<Document, 'title' | 'meta' | 'content'> & { stage: string },
): DocumentSettingsDraft {
  const meta = (document.meta ?? {}) as Partial<DocumentMeta> & Record<string, unknown>
  const content = (document.content ?? {}) as Record<string, unknown>
  let fallback: Record<string, unknown> = {}
  try {
    fallback = pmToIr(content as unknown as PMJsonNode).doc.meta as unknown as Record<string, unknown>
  } catch {
    // A malformed/very old content tree should not prevent access to the database metadata.
  }

  const value = (key: keyof DocumentSettingsDraft, irKey?: string, legacyValue?: unknown) => {
    if (key === 'stage') return asText(document.stage)
    if (Object.prototype.hasOwnProperty.call(meta, key) && meta[key] !== undefined && meta[key] !== null) {
      return asText(meta[key])
    }
    if (key === 'standardType') {
      const rawType = effectiveRawType(content)
      if (rawType !== undefined) return IR_TO_DOCUMENT_TYPE.get(rawType) ?? rawType
      const irType = irField(fallback, 'standardType')
      return IR_TO_DOCUMENT_TYPE.get(irType ?? '') ?? asText(legacyValue)
    }
    return irField(fallback, irKey ?? key) ?? asText(legacyValue)
  }

  return {
    standardType: value('standardType', undefined, 'national'),
    stage: value('stage'),
    titleCn: value('titleCn', 'title', document.title),
    titleEn: value('titleEn'),
    standardNo: value('standardNo', 'stdCode'),
    icsCode: value('icsCode'),
    ccsCode: value('ccsCode'),
    issuer: value('issuer'),
    applicant: value('applicant'),
    proposer: value('proposer'),
    technicalCommittee: value('technicalCommittee'),
    replaces: value('replaces'),
    consistency: value('consistency'),
    publishDate: value('publishDate'),
    implementDate: value('implementDate'),
    filingNo: value('filingNo'),
    industryName: value('industryName'),
    regionName: value('regionName'),
    coverDesignation: value('coverDesignation'),
  }
}

/**
 * Apply all editable metadata fields while retaining unknown database extensions and setting blanks
 * explicitly so they clear older values. `stage` is stored beside metadata by the caller.
 */
export function documentMetaFromSettingsDraft(
  currentMeta: DocumentMeta,
  draft: DocumentSettingsDraft,
): DocumentMeta {
  const coverDesignation = draft.coverDesignation.trim()
  const structuredDesignation = getCoverDesignationParts(draft.standardType) !== undefined
  const designationName = getCoverDesignationName({
    standardType: draft.standardType,
    coverDesignation,
    industryName: draft.industryName,
    regionName: draft.regionName,
  })
  const normalizedDesignation = structuredDesignation && coverDesignation
    ? buildCoverDesignation(draft.standardType, designationName)
    : coverDesignation

  return {
    ...currentMeta,
    standardType: draft.standardType as DocumentMeta['standardType'],
    titleCn: draft.titleCn.trim(),
    titleEn: draft.titleEn.trim(),
    standardNo: draft.standardNo.trim(),
    icsCode: draft.icsCode.trim(),
    ccsCode: draft.ccsCode.trim(),
    issuer: draft.issuer.trim(),
    applicant: draft.applicant.trim(),
    proposer: draft.proposer.trim(),
    technicalCommittee: draft.technicalCommittee.trim(),
    replaces: draft.replaces.trim(),
    consistency: draft.consistency.trim(),
    publishDate: draft.publishDate.trim(),
    implementDate: draft.implementDate.trim(),
    filingNo: draft.filingNo.trim(),
    industryName: structuredDesignation && coverDesignation && draft.standardType === 'industry'
      ? designationName : draft.industryName.trim(),
    regionName: structuredDesignation && coverDesignation && draft.standardType === 'local'
      ? designationName : draft.regionName.trim(),
    coverDesignation: normalizedDesignation,
  }
}

/** Make the cover and any legacy root attributes agree with the authoritative library metadata. */
export function synchronizeCoverMetadata(
  content: Record<string, unknown>,
  meta: DocumentMeta,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(content || { type: 'doc', content: [] })) as Record<string, unknown>
  const nodes = Array.isArray(cloned.content) ? cloned.content as PMJsonNode[] : []
  const cover = nodes.find((node) => node.type === 'coverPage')
  const rootAttrs = cloned.attrs && typeof cloned.attrs === 'object' && !Array.isArray(cloned.attrs)
    ? cloned.attrs as Record<string, unknown> : undefined
  const coverAttrs = cover?.attrs
  const coverFirst = new Set(['replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation'])
  const values: Record<string, string> = {}
  for (const key of COVER_SETTINGS_KEYS) {
    if (meta[key] !== undefined && meta[key] !== null) {
      values[key] = asText(meta[key])
      continue
    }
    const existing = coverFirst.has(key)
      ? nonEmptyAttribute(coverAttrs, key) ?? nonEmptyAttribute(rootAttrs, key)
      : nonEmptyAttribute(rootAttrs, key) ?? nonEmptyAttribute(coverAttrs, key)
    values[key] = existing ?? ''
  }

  if (cover) cover.attrs = { ...cover.attrs, ...values }
  else nodes.unshift({ type: 'coverPage', attrs: values, content: [{ type: 'paragraph' }] })
  cloned.content = nodes

  if (rootAttrs && typeof rootAttrs === 'object' && !Array.isArray(rootAttrs)) {
    const attrs = rootAttrs as Record<string, unknown>
    for (const key of COVER_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) attrs[key] = values[key]
    }
  }
  return cloned
}
