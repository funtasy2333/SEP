/**
 * 封面元数据同步（平台无关纯函数）：让文档 JSON 的封面节点和旧版根属性与文档库元数据一致。
 *
 * 原先位于 client 的 utils/documentSettings.ts；抽出后服务端写入文档时可共用同一逻辑，
 * client 的 documentSettings.ts 重新导出这里的名字，现有调用方不变。
 */

import { metadataLines, type DocumentMeta, type PMJsonNode } from '@ses/shared'

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
  edited: { standardNo?: boolean; issuer?: boolean } = {},
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(content || { type: 'doc', content: [] })) as Record<string, unknown>
  const nodes = Array.isArray(cloned.content) ? cloned.content as PMJsonNode[] : []
  const cover = nodes.find((node) => node.type === 'coverPage')
  const rootAttrs = cloned.attrs && typeof cloned.attrs === 'object' && !Array.isArray(cloned.attrs)
    ? cloned.attrs as Record<string, unknown> : undefined
  const coverAttrs = cover?.attrs
  const counts = (values: string[]): Map<string, number> => {
    const result = new Map<string, number>()
    for (const value of values) result.set(value, (result.get(value) ?? 0) + 1)
    return result
  }
  const consume = (remaining: Map<string, number>, value: string): boolean => {
    const count = remaining.get(value) ?? 0
    if (!count) return false
    remaining.set(value, count - 1)
    return true
  }
  const retainIdentifier = (remaining: Map<string, number>, scheme: unknown, value: unknown, parts: unknown): boolean =>
    (scheme !== 'dated' && scheme !== null && scheme !== undefined && scheme !== '')
    || (Array.isArray(parts) && parts.length > 0)
    || (typeof value === 'string' && consume(remaining, value.trim()))
  const inlineText = (nodes: unknown): string => Array.isArray(nodes)
    ? nodes.map((node) => node && typeof node === 'object'
      ? typeof node.text === 'string' ? node.text : inlineText(node.content)
      : '').join('')
    : ''

  // Structured metadata is reconciled only for fields explicitly changed in settings.
  // Automatic saves and export synchronization must not modify imported metadata.
  if (edited.standardNo || edited.issuer) {
    for (const attrs of [rootAttrs, coverAttrs]) {
      if (!attrs) continue
      if (edited.standardNo && Array.isArray(attrs.identifiers)) {
        const remaining = counts(metadataLines(meta.standardNo))
        attrs.identifiers = attrs.identifiers.filter((row: Record<string, unknown>) =>
          !row || typeof row !== 'object' || retainIdentifier(remaining, row.scheme, row.value, row.parts))
      }
      if (edited.issuer && Array.isArray(attrs.publishers)) {
        const remaining = counts(metadataLines(meta.issuer))
        attrs.publishers = attrs.publishers.filter((row: Record<string, unknown>) =>
          !row || typeof row !== 'object' || consume(remaining, inlineText(row.name).trim()))
      }
    }
    const block = nodes.find((node) => node.type === 'metadataBlock')
    if (block && Array.isArray(block.content)) {
      const codes = counts(metadataLines(meta.standardNo))
      const issuers = counts(metadataLines(meta.issuer))
      block.content = block.content.filter((node) => {
        if (edited.standardNo && node.type === 'standardIdentifier') {
          return retainIdentifier(codes, node.attrs?.scheme, node.attrs?.value, node.content)
        }
        if (edited.issuer && node.type === 'publisher') return consume(issuers, inlineText(node.content).trim())
        return true
      })
    }
  }
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
