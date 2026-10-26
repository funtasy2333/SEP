import { makeIssue } from '../issues'
import type { ContentIndex, IndexedSequenceItem, IndexedText } from '../contentIndex'
import type { ValidationEvidence, ValidationIssue } from '../types'

export interface ObjectIntroduction {
  found: boolean
  evidence?: ValidationEvidence
}

export interface IntroductionAnalysis {
  issues: ValidationIssue[]
  objectIntroductions: Map<string, ObjectIntroduction>
}

const listBasis = { kind: 'standard' as const, reference: 'GB/T 1.1—2020 7.5.1', text: '列项应有能够引出后续列项的文字。' }
const objectBasis = { kind: 'standard' as const, reference: 'GB/T 1.1—2020 9.7.1.2、9.8.1.2', text: '图、表应由相应正文引出，并在相应正文中提及。' }

function isListIntroduction(value: string): boolean {
  const text = value.normalize('NFKC').trim()
  if (!text) return false
  if (/[：:]\s*$/.test(text)) return true
  if (/[。！？!?；;.]\s*$/.test(text)) return true
  return /(?:如下|下列|以下|包括|分别为|具备|分为|有以下|满足以下)/u.test(text)
}

function itemMaps(index: ContentIndex): { byPath: Map<string, { sequence: IndexedSequenceItem[]; index: number }> } {
  const byPath = new Map<string, { sequence: IndexedSequenceItem[]; index: number }>()
  for (const sequence of index.sequences.values()) sequence.forEach((item, itemIndex) => byPath.set(item.path, { sequence, index: itemIndex }))
  return { byPath }
}

function objectIsDescribed(candidate: IndexedText | undefined, targetId: string, index: ContentIndex): ValidationEvidence | undefined {
  if (!candidate) return undefined
  const mentions = (index.mentionsByTarget.get(targetId) ?? []).filter(mention => mention.nodeId === candidate.nodeId)
  for (const mention of mentions) {
    const from = mention.from ?? 0
    const to = mention.to ?? candidate.text.length
    const remainder = `${candidate.text.slice(0, from)} ${candidate.text.slice(to)}`
      .normalize('NFKC')
      .replace(/[\s\u3000，。！？；：、,.!?;:()[\]（）【】]/gu, '')
      .replace(/^(?:如|见|参见|详见|按|依据|根据)+/u, '')
      .replace(/(?:所示|如下|所列|执行|规定)$/u, '')
    if (remainder.length >= 2) return { nodeId: candidate.nodeId, path: candidate.path, role: candidate.role, text: candidate.text, from: mention.from, to: mention.to }
  }
  return undefined
}

export function analyzeIntroductions(index: ContentIndex): IntroductionAnalysis {
  const issues: ValidationIssue[] = []
  const objectIntroductions = new Map<string, ObjectIntroduction>()
  for (const sequence of index.sequences.values()) {
    sequence.forEach((item, itemIndex) => {
      if (item.kind !== 'list' || !item.nodeId) return
      const previous = sequence[itemIndex - 1]
      const candidate = previous?.kind === 'paragraph' ? previous.text : undefined
      const candidateText = candidate?.text ?? ''
      if (isListIntroduction(candidateText)) return
      const path = item.path
      issues.push(makeIssue({
        ruleId: 'list.introduction', severity: 'warning', category: 'introductions', nodeId: item.nodeId, path,
        message: '未识别到列项引出语，请核对。',
        suggestion: '在列项前补充说明本组内容的引出语。', basis: listBasis,
        evidence: [{ nodeId: candidate?.nodeId ?? item.nodeId, path: candidate?.path ?? path, role: candidate?.role ?? 'list', text: candidateText }],
      }))
    })
  }

  const { byPath } = itemMaps(index)
  for (const object of index.objects) {
    if ((object.kind !== 'figure' && object.kind !== 'table') || !object.nodeId) continue
    const position = byPath.get(object.path)
    let cursor = position?.index ?? -1
    const sequence = position?.sequence
    while (sequence && cursor > 0 && sequence[cursor - 1]?.objectKind) cursor -= 1
    const previous = sequence && cursor > 0 ? sequence[cursor - 1] : undefined
    const candidate = previous?.kind === 'paragraph' ? previous.text : undefined
    const evidence = objectIsDescribed(candidate, object.nodeId, index)
    objectIntroductions.set(object.nodeId, { found: Boolean(evidence), ...(evidence ? { evidence } : {}) })
  }
  return { issues, objectIntroductions }
}

export const introductionBasis = objectBasis
