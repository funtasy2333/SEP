import type { Node as PMNode } from '@tiptap/pm/model'
import type { ValidationIssue, ValidationSeverity } from '@ses/shared'

export type ValidationAnchorStatus = 'located' | 'unavailable' | 'ambiguous'

export interface ValidationIssueAnchor {
  issueId: string
  nodeId: string | null
  severity: ValidationSeverity
  status: ValidationAnchorStatus
  from?: number
  to?: number
  source?: 'issue' | 'evidence'
  evidenceIndex?: number
  reason?: string
}

interface LiveNodeAnchor {
  from: number
  to: number
  nodeType: string
}

function firstLocatableEvidence(issue: ValidationIssue): { index: number; nodeId: string } | undefined {
  const evidence = issue.evidence ?? []
  if (issue.ruleId === 'term.minimum-usage') {
    const occurrence = evidence.findIndex(item => item.nodeId
      && item.from !== undefined && item.to !== undefined && item.role !== 'term-name')
    if (occurrence >= 0) return { index: occurrence, nodeId: evidence[occurrence]!.nodeId! }
  }
  const candidate = evidence.findIndex(item => item.nodeId)
  return candidate >= 0 ? { index: candidate, nodeId: evidence[candidate]!.nodeId! } : undefined
}

function frontMatterPath(issue: ValidationIssue): boolean {
  return [issue.path, ...(issue.evidence ?? []).map(item => item.path)]
    .some(path => typeof path === 'string' && path.startsWith('front.foreword'))
}

/** Resolve semantic IR IDs only through actual PM node attrs; IR paths are display-only. */
export function resolveValidationIssueAnchors(doc: PMNode, issues: readonly ValidationIssue[]): ValidationIssueAnchor[] {
  const byNodeId = new Map<string, LiveNodeAnchor[]>()
  doc.descendants((node, pos) => {
    const nodeId = node.attrs.nodeId
    if (typeof nodeId !== 'string' || nodeId.length === 0) return
    const anchors = byNodeId.get(nodeId) ?? []
    anchors.push({ from: pos, to: pos + node.nodeSize, nodeType: node.type.name })
    byNodeId.set(nodeId, anchors)
  })

  return issues.map((issue) => {
    const evidence = firstLocatableEvidence(issue)
    const selectedNodeId = issue.ruleId === 'term.minimum-usage' && evidence
      ? evidence.nodeId
      : issue.nodeId ?? evidence?.nodeId ?? null
    const source = selectedNodeId !== null && selectedNodeId === issue.nodeId ? 'issue' : evidence ? 'evidence' : undefined
    const evidenceIndex = source === 'evidence' ? evidence?.index : undefined

    if (!selectedNodeId) {
      return {
        issueId: issue.id, nodeId: null, severity: issue.severity, status: 'unavailable',
        reason: frontMatterPath(issue)
          ? '该前言结果使用 IR 容器路径，没有唯一的编辑器节点 ID，无法安全定位。'
          : '检查结果未提供编辑器节点 ID，无法安全定位。',
      }
    }

    const matches = byNodeId.get(selectedNodeId) ?? []
    if (matches.length > 1) {
      return {
        issueId: issue.id, nodeId: selectedNodeId, severity: issue.severity, status: 'ambiguous', source, evidenceIndex,
        reason: `编辑器中存在 ${matches.length} 个相同节点 ID，无法确定唯一位置。`,
      }
    }
    const match = matches[0]
    if (!match) {
      return {
        issueId: issue.id, nodeId: selectedNodeId, severity: issue.severity, status: 'unavailable', source, evidenceIndex,
        reason: frontMatterPath(issue)
          ? '该前言结果使用 IR 容器路径，没有对应的编辑器节点 ID，无法安全定位。'
          : `编辑器中未找到节点 ID「${selectedNodeId}」，无法安全定位。`,
      }
    }
    return {
      issueId: issue.id, nodeId: selectedNodeId, severity: issue.severity, status: 'located',
      from: match.from, to: match.to, source, evidenceIndex,
    }
  })
}
