/**
 * 封面元数据同步（平台无关纯函数）：让文档 JSON 的封面节点和旧版根属性与文档库元数据一致。
 *
 * 原先位于 client 的 utils/documentSettings.ts；抽出后服务端写入文档时可共用同一逻辑，
 * client 的 documentSettings.ts 重新导出这里的名字，现有调用方不变。
 */

import type { DocumentMeta, PMJsonNode } from '@ses/shared'

/** Cover values are the editor/XML source of truth; legacy root attributes remain synchronized when present. */
export const COVER_SETTINGS_KEYS = [
  'standardType', 'standardNo', 'titleCn', 'titleEn', 'icsCode', 'ccsCode', 'issuer', 'applicant', 'proposer', 'technicalCommittee',
  'publishDate', 'implementDate', 'replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation',
] as const satisfies ReadonlyArray<keyof DocumentMeta>

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function nonEmptyAttribute(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = attrs?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
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
