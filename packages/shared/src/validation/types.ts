import type { ResolveResult } from '../ir/types'

export type ValidationSeverity = 'error' | 'warning' | 'suggestion'
export type ValidationCoverageStatus = 'checked' | 'partial' | 'deferred' | 'excluded' | 'not-applicable'
export type ValidationBasisKind = 'standard' | 'project-convention' | 'system'

export interface ValidationEvidence {
  nodeId: string | null
  text: string
  /** Zero-based UTF-16 offsets into the source text when the source is contiguous. */
  from?: number
  to?: number
  path?: string
  role?: string
}

export interface ValidationBasis {
  kind: ValidationBasisKind
  reference?: string
  text: string
}

export interface ValidationIssue {
  /** Stable across runs for the same rule and document path; never contains time or randomness. */
  id: string
  ruleId: string
  severity: ValidationSeverity
  category: 'structure' | 'introductions' | 'mentions' | 'terms' | 'references' | 'coverage'
  nodeId: string | null
  path?: string
  message: string
  suggestion: string
  basis: ValidationBasis
  evidence?: ValidationEvidence[]
  count?: number
  threshold?: number
}

export interface ValidationCoverage {
  status: ValidationCoverageStatus
  reason: string
}

export interface ValidationSummary {
  total: number
  error: number
  warning: number
  suggestion: number
}

export interface ValidationReport {
  profile: 'ses-phase6-manual-v2'
  rulesVersion: string
  issues: ValidationIssue[]
  summary: ValidationSummary
  coverage: Record<ValidationCoverageGroup, ValidationCoverage>
}

export type ValidationCoverageGroup =
  | 'structure'
  | 'hangingParagraphs'
  | 'listIntroductions'
  | 'objectIntroductions'
  | 'objectMentions'
  | 'appendixMentions'
  | 'termUsage'
  | 'normativeReferences'
  | 'internalReferences'
  | 'standardDatabase'
  | 'termAuthority'
  | 'bibliographyReminder'
  | 'footnotes'
  | 'tableFootnotes'
  | 'listStyleConsistency'
  | 'objectFormatting'

export interface DocumentAnalysis {
  resolution: ResolveResult
  validation: ValidationReport
}
