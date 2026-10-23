import type { ContentIndex, IndexedMention, IndexedObject } from '../contentIndex'
import { evidence, makeIssue } from '../issues'
import { introductionBasis, type IntroductionAnalysis } from './introductions'
import type { ValidationIssue } from '../types'

const appendixBasis = { kind: 'standard' as const, reference: 'GB/T 1.1—2020 9.6.1.2', text: '附录应在正文中提及。' }

function inMainBody(mention: IndexedMention): boolean {
  return mention.area === 'body' || mention.area === 'terms' || mention.area === 'normativeReferences'
}

function isRelevantObjectMention(object: IndexedObject, mention: IndexedMention): boolean {
  if (object.kind === 'appendix') return inMainBody(mention)
  if (object.area === 'appendix') return mention.area === 'appendix' && object.appendixId === mention.appendixId
  return inMainBody(mention)
}

function mentionEvidence(mention: IndexedMention): ReturnType<typeof evidence> {
  return evidence(mention.nodeId, mention.text, { from: mention.from, to: mention.to, path: mention.path, role: mention.source })
}

function objectIntroductionAndMentionIssues(index: ContentIndex, introductions: IntroductionAnalysis): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const object of index.objects) {
    if (object.kind !== 'figure' && object.kind !== 'table') continue
    const label = object.label ?? (object.kind === 'figure' ? '图表' : '表格')
    const mentions = (index.mentionsByTarget.get(object.nodeId) ?? []).filter(mention =>
      isRelevantObjectMention(object, mention) && mention.containerId !== object.nodeId,
    )
    const isMentioned = mentions.length > 0
    const introduction = introductions.objectIntroductions.get(object.nodeId)
    const missing: string[] = []
    if (!introduction?.found) missing.push(`缺少${object.kind === 'figure' ? '图' : '表'}前引出语`)
    if (!isMentioned) missing.push(`正文未提及${label}`)
    if (missing.length === 0) continue
    const issueEvidence = [
      ...(introduction?.evidence ? [introduction.evidence] : []),
      ...mentions.map(mentionEvidence),
      ...(introduction?.found || isMentioned ? [] : [evidence(object.nodeId, label, { path: object.path, role: object.kind })]),
    ]
    issues.push(makeIssue({
      ruleId: 'object.introduction-and-mention', severity: 'warning', category: 'mentions', nodeId: object.nodeId, path: object.path,
      message: `${label}${missing.join('；')}。`,
      suggestion: `在${object.kind === 'figure' ? '图' : '表'}前补充明确引出语，并在相应正文中指向${label}。`,
      basis: introductionBasis,
      evidence: issueEvidence,
    }))
  }
  return issues
}

function appendixMentionIssues(index: ContentIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const object of index.objects) {
    if (object.kind !== 'appendix') continue
    const isMentioned = (index.mentionsByTarget.get(object.nodeId) ?? []).some(mention => isRelevantObjectMention(object, mention))
    if (isMentioned) continue
    const label = object.label ?? '附录'
    issues.push(makeIssue({
      ruleId: 'appendix.body-mention', severity: 'warning', category: 'mentions', nodeId: object.nodeId, path: object.path,
      message: `${label}未在正文中提及。`, suggestion: `在正文适当位置添加对${label}的明确提及。`, basis: appendixBasis,
      evidence: [evidence(object.nodeId, label, { path: object.path, role: 'appendix-title' })],
    }))
  }
  return issues
}

export function validateMentions(index: ContentIndex, introductions: IntroductionAnalysis): ValidationIssue[] {
  return [...objectIntroductionAndMentionIssues(index, introductions), ...appendixMentionIssues(index)]
}

