import type { IRProblem, ResolveResult } from '../ir/types'
import type { ContentIndex } from './contentIndex'
import { makeIssue } from './issues'
import type { ValidationIssue } from './types'

const structureBasis = { kind: 'standard' as const, reference: 'GB/T 1.1—2020 7.3', text: '章条层级和必要内容应完整、一致。' }
const referenceBasis = { kind: 'system' as const, text: '文档内结构化引用目标由 Resolver 解析并核对存在性与类型。' }

const EXCLUDED_CODES = new Set<IRProblem['code']>([
  'hanging-paragraph',
  'dangling-footnote',
  'unreferenced-footnote',
  'invalid-footnote',
])

const ALLOWED_CODES = new Set<IRProblem['code']>([
  'heading-skip',
  'empty-section',
  'duplicate-id',
  'missing-id',
  'dangling-xref',
  'dangling-typed-ref',
  'dangling-index-target',
  'dangling-resource',
  'unsupported-content',
])

interface NodeLocations {
  objects: string[]
  texts: string[]
  references: string[]
}

function buildNodeLocations(index: ContentIndex): Map<string, NodeLocations> {
  const locations = new Map<string, NodeLocations>()
  const add = (nodeId: string | null, path: string, kind: keyof NodeLocations) => {
    if (nodeId === null) return
    const value = locations.get(nodeId) ?? { objects: [], texts: [], references: [] }
    if (!value[kind].includes(path)) value[kind].push(path)
    locations.set(nodeId, value)
  }
  for (const object of index.objects) add(object.nodeId, object.path, 'objects')
  for (const text of index.texts) add(text.nodeId, text.path, 'texts')
  for (const reference of index.references) add(reference.nodeId, reference.path, 'references')
  return locations
}

function isFootnoteSource(index: ContentIndex, nodeId: string | null): boolean {
  if (!nodeId) return false
  const areas = index.nodeAreas.get(nodeId) ?? []
  return areas.includes('footnote') || areas.includes('tableFootnote')
}

function issueFor(problem: IRProblem, result: ResolveResult, index: ContentIndex, locations: Map<string, NodeLocations>): ValidationIssue | undefined {
  if (EXCLUDED_CODES.has(problem.code) || !ALLOWED_CODES.has(problem.code)) return undefined
  if ((problem.code === 'dangling-xref' || problem.code === 'dangling-typed-ref') && isFootnoteSource(index, problem.nodeId)) return undefined

  const documentLevel = problem.code === 'duplicate-id' || problem.code === 'missing-id'
  const nodeLocations = problem.nodeId ? locations.get(problem.nodeId) : undefined
  const nodeCandidates = nodeLocations?.objects.length
    ? nodeLocations.objects
    : nodeLocations?.texts.length
      ? nodeLocations.texts
      : nodeLocations?.references ?? []
  const ambiguous = documentLevel || nodeCandidates.length > 1
  const path = ambiguous ? 'doc' : nodeCandidates[0] ?? 'doc'
  const nodeId = ambiguous ? null : problem.nodeId
  const category = problem.code === 'heading-skip' || problem.code === 'empty-section' || documentLevel || problem.code === 'unsupported-content'
    ? 'structure' as const
    : 'references' as const
  const ruleId = problem.code === 'heading-skip' ? 'structure.heading-skip'
    : problem.code === 'empty-section' ? 'structure.empty-section'
      : documentLevel ? 'structure.node-location'
        : problem.code === 'dangling-resource' ? 'reference.dangling-resource'
          : problem.code === 'unsupported-content' ? 'structure.unsupported-content'
            : 'reference.dangling'
  const severity = problem.severity
  const suggestion = problem.code === 'heading-skip' ? '调整条的层级，使条号层级连续。'
    : problem.code === 'empty-section' ? '补充必要内容或删除空章条。'
      : documentLevel ? '修复节点 ID 后再检查，避免定位到不唯一的位置。'
        : problem.code === 'unsupported-content' ? '核对提示的内容是否已完整转换并可被本期规则定位。'
          : '核对引用目标和目标类型，修正引用或恢复缺失的目标。'
  return makeIssue({
    ruleId, severity, category, nodeId, path,
    message: ambiguous ? `${problem.message}（定位不唯一，按文档级问题列出）` : problem.message,
    suggestion,
    basis: category === 'structure' ? structureBasis : referenceBasis,
    evidence: [{ nodeId, path, role: result.labels[problem.nodeId ?? ''] ? 'resolved-target' : 'source', text: problem.message }],
    identity: `${problem.code}:${problem.message}`,
  })
}

/** Strict whitelist bridge; legacy hanging-paragraph and footnote reports never enter quality. */
export function mapResolverIssues(result: ResolveResult, index: ContentIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const locations = buildNodeLocations(index)
  for (const problem of result.problems) {
    const issue = issueFor(problem, result, index, locations)
    if (issue) issues.push(issue)
  }
  return issues
}
