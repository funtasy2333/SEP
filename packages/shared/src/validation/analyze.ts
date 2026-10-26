import type { IRDoc } from '../ir/types'
import { resolve } from '../ir/resolve'
import { buildContentIndex } from './contentIndex'
import { sortIssues } from './issues'
import { mapResolverIssues } from './resolverIssues'
import { analyzeIntroductions } from './rules/introductions'
import { validateMentions } from './rules/mentions'
import { validateNormativeReferences } from './rules/normativeReferences'
import { validateStructure } from './rules/structure'
import { validateTermUsage } from './rules/termUsage'
import type { DocumentAnalysis, ValidationCoverageGroup, ValidationIssue, ValidationReport } from './types'

const coverageReasons: Record<Exclude<ValidationCoverageGroup, 'normativeReferences'>, { status: ValidationReport['coverage'][ValidationCoverageGroup]['status']; reason: string }> = {
  structure: { status: 'checked', reason: '已检查当前 IR 支持的章、条、标题和空结构规则；无法识别的内容由 Resolver 单独报告。' },
  hangingParagraphs: { status: 'checked', reason: '已按项目约定检查章、条和附录容器中的直接普通段落；仅术语章及其内部容器豁免。' },
  listIntroductions: { status: 'partial', reason: '依据相邻段落位置、冒号、句末和常见引导词识别；未能识别的自然语言表达需要人工核对。' },
  objectIntroductions: { status: 'partial', reason: '依据相邻段落和已解析图表标签识别明确引出语；本地规则不理解所有自然语言指代。' },
  objectMentions: { status: 'partial', reason: '检查结构化引用及已解析标签的常见字面编号、枚举和范围；外部文献语境、未知编号及歧义表达不作内部目标结论。' },
  appendixMentions: { status: 'partial', reason: '检查结构化附录引用和可解析的“附录字母”字面提及；不推断语义性指代。' },
  termUsage: { status: 'partial', reason: '仅对可读取的术语名进行规范化字面匹配；不推断同义词、缩略语、词形变体或语义使用。' },
  internalReferences: { status: 'checked', reason: '检查 Resolver 已识别的结构化引用目标存在性和声明类型；不进行自然语言引用语义审核。' },
  standardDatabase: { status: 'deferred', reason: '未接入标准数据库；不查验编号、名称、现行状态和内容准确性。' },
  termAuthority: { status: 'deferred', reason: '未接入术语权威来源；不判断术语是否推荐、规范或定义准确。' },
  bibliographyReminder: { status: 'excluded', reason: '本期取消参考文献未引用提醒。' },
  footnotes: { status: 'excluded', reason: '本期不纳入条文脚注质量检查。' },
  tableFootnotes: { status: 'excluded', reason: '本期不纳入表脚注质量检查。' },
  listStyleConsistency: { status: 'excluded', reason: '本期不检查列项类型、层级、样式、编号和标点一致性。' },
  objectFormatting: { status: 'excluded', reason: '本期不新增图表题注、版式、跨页或格式检查。' },
}

function summarize(issues: ValidationIssue[]): ValidationReport['summary'] {
  const summary = { total: issues.length, error: 0, warning: 0, suggestion: 0 }
  for (const issue of issues) summary[issue.severity] += 1
  return summary
}

function stableIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const unique = new Map<string, ValidationIssue>()
  for (const issue of issues) if (!unique.has(issue.id)) unique.set(issue.id, issue)
  return sortIssues([...unique.values()])
}

/** Analyze one IR snapshot without changing it or consulting host state. */
export function analyzeDocument(doc: IRDoc): DocumentAnalysis {
  const resolution = resolve(doc)
  const index = buildContentIndex(doc, resolution)
  const introductions = analyzeIntroductions(index)
  const normative = validateNormativeReferences(doc)
  const issues = stableIssues([
    ...mapResolverIssues(resolution, index),
    ...validateStructure(doc),
    ...introductions.issues,
    ...validateMentions(index, introductions),
    ...validateTermUsage(index),
    ...normative.issues,
  ])
  const coverage: ValidationReport['coverage'] = {
    ...coverageReasons,
    normativeReferences: normative.coverage,
  }
  const validation: ValidationReport = {
    profile: 'ses-phase6-manual-v2',
    rulesVersion: '2026-10-22',
    issues,
    summary: summarize(issues),
    coverage,
  }
  return { resolution, validation }
}
