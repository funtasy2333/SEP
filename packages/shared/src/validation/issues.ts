import type { ValidationBasis, ValidationCategory, ValidationEvidence, ValidationIssue, ValidationSeverity } from './types'

export interface IssueInput {
  ruleId: string
  severity: ValidationSeverity
  category: ValidationCategory
  nodeId?: string | null
  path?: string
  message: string
  suggestion: string
  basis: ValidationBasis
  evidence?: ValidationEvidence[]
  count?: number
  threshold?: number
  /** Optional stable disambiguator when one source node has multiple instances of the same rule. */
  identity?: string
}

export function makeIssue(input: IssueInput): ValidationIssue {
  const { identity, ...issue } = input
  const nodePart = input.nodeId ?? 'document'
  const pathPart = input.path ?? nodePart
  return {
    ...issue,
    nodeId: input.nodeId ?? null,
    id: `${input.ruleId}:${pathPart}${identity ? `:${identity}` : ''}`,
  }
}

export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const severityRank: Record<ValidationSeverity, number> = { error: 0, warning: 1, suggestion: 2 }
  const areaRank = (issue: ValidationIssue): number => {
    const path = issue.path ?? ''
    const areas = ['front.foreword', 'front.introduction', 'body', 'appendices', 'bibliography', 'index']
    const rank = areas.findIndex(area => path.startsWith(area))
    return rank < 0 ? areas.length : rank
  }
  return [...issues].sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
      || areaRank(left) - areaRank(right)
      || (left.path ?? left.nodeId ?? '').localeCompare(right.path ?? right.nodeId ?? '', 'en', { numeric: true })
      || left.ruleId.localeCompare(right.ruleId),
  )
}

export function evidence(nodeId: string | null, text: string, extras: Partial<Omit<ValidationEvidence, 'nodeId' | 'text'>> = {}): ValidationEvidence {
  return { nodeId, text, ...extras }
}
