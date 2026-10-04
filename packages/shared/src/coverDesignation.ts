/**
 * DOCX 封面和文件设置实时预览共用的标准称谓规则。
 * industry/local/group/enterprise 可由用户填写完整称谓；空值沿用既有默认生成规则。
 * 国家标准与指导性技术文件的称谓固定，不接受覆盖值。
 */
export interface CoverDesignationMeta {
  standardType: string
  coverDesignation?: string
  industryName?: string
  regionName?: string
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
