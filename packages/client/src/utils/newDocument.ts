import type { DocumentMeta, DocumentStage, StandardType, PMJsonNode } from '@ses/shared'
import { buildCoverDesignation, getCoverDesignationName, getCoverDesignationParts } from '@ses/shared'
import { TYPE_DEFS } from '../constants/standards'

export interface NewDocForm {
  type: StandardType
  stage: DocumentStage
  stdPrefix: string
  stdNo: string
  titleCn: string
  titleEn: string
  icsCode: string
  ccsCode: string
  issuer: string
  applicant: string
  proposer: string
  technicalCommittee: string
  replaces: string
  consistency: string
  industryName?: string
  regionName?: string
  coverDesignation?: string
}

export const STANDARD_NO_PLACEHOLDER = 'XXXXX—XXXX'

/** 预览和创建共用，空编号也保存可见占位符；不推定未分配的年份。 */
export function newDocumentStandardNo(form: Pick<NewDocForm, 'type' | 'stdPrefix' | 'stdNo'>): string {
  const prefix = form.stdPrefix.trim() || TYPE_DEFS.find((type) => type.id === form.type)!.prefix
  return `${prefix} ${form.stdNo.trim() || STANDARD_NO_PLACEHOLDER}`
}

const textParagraph = (text: string): PMJsonNode => ({
  type: 'paragraph', content: [{ type: 'text', text }],
})

/** 新建文档和手动添加前言使用同一默认文本。 */
export function createDefaultForeword(meta?: DocumentMeta): PMJsonNode {
  const foreword = [
    textParagraph('本文件按照GB/T 1.1-2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草。'),
    textParagraph('请注意本文件的某些内容可能涉及专利。本文件的发布机构不承担识别这些专利的责任。'),
  ]
  const proposer = meta?.proposer?.trim()
  const committee = meta?.technicalCommittee?.trim()
  const drafters = meta?.applicant?.trim()
  if (proposer) foreword.push(textParagraph(`本文件由${proposer}提出。`))
  if (committee) foreword.push(textParagraph(`本文件由${committee}归口。`))
  if (drafters) foreword.push(textParagraph(`本文件起草单位：${drafters}。`))

  foreword.push(textParagraph('本文件主要起草人：'))
  return { type: 'foreword', content: foreword }
}

/** 仅用于新建/空内容初始化；正文已有内容时不重新套用模板。 */
export function createDefaultDocumentContent(meta?: DocumentMeta): PMJsonNode & Record<string, unknown> {
  const content: PMJsonNode[] = []
  if (meta) {
    // 保存到生产schema支持的封面属性，让XML/JSON和DOCX都能使用创建时的值。
    const attrs: Record<string, unknown> = {}
    for (const key of ['standardType', 'standardNo', 'titleCn', 'titleEn', 'icsCode', 'ccsCode', 'issuer', 'applicant', 'proposer', 'technicalCommittee',
      'publishDate', 'implementDate', 'replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation'] as const) {
      if (meta[key] !== undefined) attrs[key] = meta[key]
    }
    content.push({ type: 'coverPage', attrs, content: [{ type: 'paragraph' }] })
  }
  content.push(createDefaultForeword(meta))
  for (const [index, title] of ['范围', '规范性引用文件', '术语和定义'].entries()) {
    content.push({ type: 'chapter', attrs: { number: String(index + 1) }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: title }] },
      { type: 'stdParagraph' },
    ] })
  }
  return { type: 'doc', content }
}

/** 一次创建即保存元数据和初始化正文，避免重新打开前文档只有空content。 */
export function createNewDocument(form: NewDocForm) {
  const optional = (value: string) => value.trim() || undefined
  const designationName = getCoverDesignationName({
    standardType: form.type,
    coverDesignation: form.coverDesignation,
    industryName: form.industryName,
    regionName: form.regionName,
  })
  const hasCustomParts = getCoverDesignationParts(form.type) !== undefined
  const coverDesignation = hasCustomParts
    ? optional(designationName ? buildCoverDesignation(form.type, designationName) : '')
    : optional(form.coverDesignation ?? '')
  const meta: DocumentMeta = {
    titleCn: form.titleCn.trim(),
    titleEn: optional(form.titleEn),
    standardNo: newDocumentStandardNo(form),
    standardType: form.type,
    icsCode: optional(form.icsCode),
    ccsCode: optional(form.ccsCode),
    issuer: optional(form.issuer),
    applicant: optional(form.applicant),
    proposer: optional(form.proposer),
    technicalCommittee: optional(form.technicalCommittee),
    replaces: optional(form.replaces),
    consistency: optional(form.consistency),
    industryName: form.type === 'industry' ? optional(designationName) : optional(form.industryName ?? ''),
    regionName: form.type === 'local' ? optional(designationName) : optional(form.regionName ?? ''),
    coverDesignation,
  }
  return { title: meta.titleCn, stage: form.stage, meta, content: createDefaultDocumentContent(meta) }
}
