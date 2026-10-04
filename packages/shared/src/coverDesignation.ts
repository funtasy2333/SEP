/**
 * DOCX 封面、新建表单和文件设置共用的标准称谓规则。
 * coverDesignation 持久化完整称谓；表单把四类标准的名称片段与固定文字分开展示。
 * 空值仍沿用既有默认生成规则。
 * 国家标准与指导性技术文件的称谓固定，不接受覆盖值。
 */
export interface CoverDesignationMeta {
  standardType: string
  coverDesignation?: string
  industryName?: string
  regionName?: string
}

export interface CoverDesignationParts {
  prefix: string
  suffix: string
}

const CUSTOM_DESIGNATION_PARTS: Record<string, CoverDesignationParts> = {
  industry: { prefix: '中华人民共和国', suffix: '行业标准' },
  local: { prefix: '', suffix: '地方标准' },
  group: { prefix: '', suffix: '团体标准' },
  enterprise: { prefix: '', suffix: '企业标准' },
}

/** Fixed text surrounding the user-entered name for the four customizable standard types. */
export function getCoverDesignationParts(standardType: string): CoverDesignationParts | undefined {
  return Object.prototype.hasOwnProperty.call(CUSTOM_DESIGNATION_PARTS, standardType)
    ? CUSTOM_DESIGNATION_PARTS[standardType]
    : undefined
}

/** Extract the editable name from either a current or legacy complete cover designation. */
export function getCoverDesignationName(meta: CoverDesignationMeta): string {
  const full = meta.coverDesignation?.trim()
  if (full) {
    const parts = getCoverDesignationParts(meta.standardType)
    if (!parts) return full

    if (full.endsWith(parts.suffix)) {
      let name = full.slice(0, -parts.suffix.length)
      if (parts.prefix && name.startsWith(parts.prefix)) name = name.slice(parts.prefix.length)
      return name.trim()
    }

    // Unknown historical values remain editable as entered rather than being discarded.
    return full
  }

  if (meta.standardType === 'industry') return meta.industryName?.trim() ?? ''
  if (meta.standardType === 'local') return meta.regionName?.trim() ?? ''
  return ''
}

/** Build a canonical full designation from a name fragment and its fixed text. */
export function buildCoverDesignation(standardType: string, name: string): string {
  const parts = getCoverDesignationParts(standardType)
  if (!parts) return ''
  return `${parts.prefix}${name.trim()}${parts.suffix}`
}

export function getCoverDesignation(meta: CoverDesignationMeta): string {
  const custom = meta.coverDesignation?.trim()
  switch (meta.standardType) {
    case 'national':
    case 'gb':
      return '中华人民共和国国家标准'
    case 'guidance':
    case 'guide':
      return '中华人民共和国国家标准化指导性技术文件'
    case 'industry':
      return custom || `中华人民共和国${meta.industryName ?? ''}行业标准`
    case 'local':
      return custom || `${meta.regionName ?? ''}地方标准`
    case 'group':
      return custom || '团体标准'
    case 'enterprise':
      return custom || '企业标准'
    default:
      return ''
  }
}
