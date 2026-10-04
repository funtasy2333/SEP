/**
 * 将已通过编辑器 schema 校验的 XML 文档元数据转换为 DocumentMeta 更新。
 *
 * XML front 字段作为权威值；缺失的可选 front 字段显式置空，避免服务端保留旧元数据。
 * proposer、technicalCommittee、applicant 是编辑器维护字段，不属于 XML front，因此沿用当前值。
 */

import {
  pmToIr,
  toIrStandardType,
  type DocumentMeta,
  type IRDocMeta,
  type StandardType,
} from '@ses/shared'
import type { PMJsonNode } from './xmlParser'

const IR_TO_DOCUMENT_TYPE: Record<IRDocMeta['standardType'], StandardType> = {
  gb: 'national',
  industry: 'industry',
  local: 'local',
  group: 'group',
  enterprise: 'enterprise',
  guide: 'guidance',
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

/**
 * 根据生产编辑器 schema 的文档 JSON，生成一次 XML 导入所需的 title/meta 更新。
 * 缺少标准类型时沿用 pmToIr 的国家标准默认；非空但不支持的类型拒绝导入，避免静默改类。
 */
export function prepareXmlImportDocumentUpdate(
  pmDoc: PMJsonNode,
  currentMeta: DocumentMeta,
): { title: string; meta: DocumentMeta } {
  const coverPage = pmDoc.content?.find((node) => node.type === 'coverPage')
  const rawTypeValue = hasValue(pmDoc.attrs?.standardType)
    ? pmDoc.attrs?.standardType
    : hasValue(coverPage?.attrs?.standardType)
      ? coverPage?.attrs?.standardType
      : undefined
  const irType = rawTypeValue === undefined ? 'gb' : toIrStandardType(String(rawTypeValue))
  if (!irType) {
    throw new Error(`标准类型「${String(rawTypeValue)}」无法识别`)
  }

  const { doc } = pmToIr(pmDoc)
  const meta: DocumentMeta = {
    titleCn: doc.meta.title ?? '',
    titleEn: doc.meta.titleEn ?? '',
    standardNo: doc.meta.stdCode ?? '',
    icsCode: doc.meta.icsCode ?? '',
    ccsCode: doc.meta.ccsCode ?? '',
    publishDate: doc.meta.publishDate ?? '',
    implementDate: doc.meta.implementDate ?? '',
    standardType: IR_TO_DOCUMENT_TYPE[irType],
    issuer: doc.meta.issuer ?? '',
    replaces: doc.meta.replaces ?? '',
    consistency: doc.meta.consistency ?? '',
    filingNo: doc.meta.filingNo ?? '',
    industryName: doc.meta.industryName ?? '',
    regionName: doc.meta.regionName ?? '',
    coverDesignation: doc.meta.coverDesignation ?? '',
    applicant: currentMeta.applicant,
    proposer: currentMeta.proposer,
    technicalCommittee: currentMeta.technicalCommittee,
  }

  return {
    title: meta.titleCn || '标准文件',
    meta,
  }
}
