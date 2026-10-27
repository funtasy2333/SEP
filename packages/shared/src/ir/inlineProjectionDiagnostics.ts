import type { IRToPmDiagnostic } from './irToPm'

const EXISTING_EMPTY_REFERENCE_MARKS = new Set(['crossRef', 'bibRef', 'termRef'])
const ATOM_MARKS = new Set(['tableFootnoteRef'])

type UnknownRecord = Record<string, unknown>

export interface CrossRefRunProjectionIssue extends IRToPmDiagnostic {
  kind: 'multiple-crossrefs' | 'crossref-newline'
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasNonEmptyStyle(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0
}

function markType(value: unknown): string | undefined {
  return isRecord(value) && typeof value.type === 'string' ? value.type : undefined
}

/**
 * Diagnose IR inline combinations that the production ProseMirror mark model
 * cannot represent, or that would disappear because no text/formula carrier is
 * emitted. This deliberately has no ProseMirror/Tiptap runtime dependency.
 */
export function diagnoseInlineProjection(
  value: unknown,
  path: string,
  ownerId: string | undefined,
  errors: IRToPmDiagnostic[],
): void {
  visit(value, path, ownerId, errors)
}

/**
 * Find only the two crossRef run shapes that HTML/DOCX cannot render faithfully:
 * multiple destinations in one run and a destination attached across a hard break.
 * This stays narrower than the full PM projection validator because renderers accept
 * many native IR shapes that are not valid ProseMirror marks.
 */
export function findCrossRefRunProjectionIssues(
  value: unknown,
  path = 'doc',
  ownerId?: string,
): CrossRefRunProjectionIssue[] {
  const issues: CrossRefRunProjectionIssue[] = []
  visitCrossRefRuns(value, path, ownerId, issues)
  return issues
}

function visitCrossRefRuns(
  value: unknown,
  path: string,
  ownerId: string | undefined,
  issues: CrossRefRunProjectionIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => visitCrossRefRuns(child, `${path}[${index}]`, ownerId, issues))
    return
  }
  if (!isRecord(value)) return

  const currentOwnerId = typeof value.id === 'string' ? value.id : ownerId
  const marks = Array.isArray(value.marks) ? value.marks : []
  const crossRefIndexes = marks.flatMap((mark, index) => markType(mark) === 'crossRef' ? [index] : [])
  for (const index of crossRefIndexes.slice(1)) {
    issues.push({
      kind: 'multiple-crossrefs',
      path: `${path}.marks[${index}]`,
      nodeId: currentOwnerId,
      reason: '同一行内有多个 crossRef 标记，HTML/DOCX 当前只消费第一个引用目标',
    })
  }
  if (crossRefIndexes.length > 0 && typeof value.text === 'string' && value.text.includes('\n')) {
    issues.push({
      kind: 'crossref-newline',
      path: `${path}.text`,
      nodeId: currentOwnerId,
      reason: 'crossRef 文本包含换行；生产 schema 会拆分文本载体，无法保留原引用范围',
    })
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'id') continue
    visitCrossRefRuns(child, `${path}.${key}`, currentOwnerId, issues)
  }
}

function visit(
  value: unknown,
  path: string,
  ownerId: string | undefined,
  errors: IRToPmDiagnostic[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, `${path}[${index}]`, ownerId, errors))
    return
  }
  if (!isRecord(value)) return

  const currentOwnerId = typeof value.id === 'string' ? value.id : ownerId
  if (typeof value.text === 'string') {
    const marks = Array.isArray(value.marks) ? value.marks : []
    const types = marks.map(markType)

    const codeIndex = types.findIndex(type => type === 'code')
    const hasOtherTextMark = types.some(type => type !== undefined && type !== 'code' && !ATOM_MARKS.has(type))
    if (codeIndex >= 0 && (hasOtherTextMark || hasNonEmptyStyle(value.style))) {
      errors.push({
        path: `${path}.marks[${codeIndex}]`,
        nodeId: currentOwnerId,
        reason: '生产ProseMirror code标记排斥其他行内标记与textStyle，组合无法无损投影',
      })
    }

    // 生产 stdRef 与 mixedCitation 两个 mark 互相 excludes：同一 run 不能同时是标准化与非标准化文件引用
    const stdIndex = types.findIndex(type => type === 'stdRef')
    const mixedIndex = types.findIndex(type => type === 'mixedCitation')
    if (stdIndex >= 0 && mixedIndex >= 0) {
      errors.push({
        path: `${path}.marks[${Math.max(stdIndex, mixedIndex)}]`,
        nodeId: currentOwnerId,
        reason: '同一行内不能同时带 stdRef 与 mixedCitation：生产ProseMirror中两个标记互斥，无法同时保留',
      })
    }

    const firstIndexByType = new Map<string, number>()
    types.forEach((type, index) => {
      if (type === undefined || ATOM_MARKS.has(type)) return
      const firstIndex = firstIndexByType.get(type)
      if (firstIndex === undefined) {
        firstIndexByType.set(type, index)
        return
      }
      errors.push({
        path: `${path}.marks[${index}]`,
        nodeId: currentOwnerId,
        reason: `重复的${type}标记无法同时保留，生产ProseMirror不能表达该标记组合`,
      })
    })

    // 行内图（WP8.M G3，M-8.3-02）：生产 inlineImage 是无 marks、无 textStyle 的行内原子节点，
    // 且只承载图本身——同一 run 里的文字、公式、脚注、marks、style 无处共存，往返会改变 run 的拆分或丢失信息。
    if (isRecord(value.image)) {
      if (value.text.length > 0) {
        errors.push({ path: `${path}.text`, nodeId: currentOwnerId, reason: '行内图所在 run 的文字必须为空：生产 inlineImage 是独立的行内原子节点，文字无法与图共存于同一 run' })
      }
      if (isRecord(value.formula) || isRecord(value.footnote)) {
        errors.push({ path: `${path}.image`, nodeId: currentOwnerId, reason: '行内图不能与行内公式或脚注处于同一 run：它们各自是独立的行内原子节点' })
      }
      marks.forEach((mark, index) => {
        errors.push({
          path: `${path}.marks[${index}]`,
          nodeId: currentOwnerId,
          reason: `行内图不能带${markType(mark) ?? '格式'}标记：生产 inlineImage 不接受行内格式或引用，标记在投影中会丢失`,
        })
      })
      if (hasNonEmptyStyle(value.style)) {
        errors.push({ path: `${path}.style`, nodeId: currentOwnerId, reason: '行内图不能带 textStyle：生产 inlineImage 不接受行内样式，样式在投影中会丢失' })
      }
    }

    if (value.text.length === 0 && !value.formula && !value.image) {
      marks.forEach((mark, index) => {
        const type = markType(mark)
        if (type === undefined || ATOM_MARKS.has(type) || EXISTING_EMPTY_REFERENCE_MARKS.has(type)) return
        errors.push({
          path: `${path}.marks[${index}]`,
          nodeId: currentOwnerId,
          reason: `空文本且无公式载体，${type}标记在生产ProseMirror投影中会丢失`,
        })
      })
      if (hasNonEmptyStyle(value.style)) {
        errors.push({
          path: `${path}.style`,
          nodeId: currentOwnerId,
          reason: '空文本且无公式载体，textStyle在生产ProseMirror投影中会丢失',
        })
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'id') continue
    visit(child, `${path}.${key}`, currentOwnerId, errors)
  }
}
