import type { IRDoc } from '../ir/types'
import { resolve } from '../ir/resolve'

export interface OutputSupportProblem {
  code: 'unsupported-output'
  nodeId?: string
  path: string
  message: string
}

/** Current print renderers' explicit consumption contract. New authoring fields must not vanish silently. */
const FIELDS: Record<string, ReadonlySet<string>> = Object.fromEntries(Object.entries({
  doc: ['schemaVersion', 'extensionVersion', 'meta', 'front', 'body', 'appendices', 'bibliography', 'unsupportedContent', 'unmappedFootnotes'],
  // applicant is an editor-maintained legacy field: XML front does not carry it, and XML import
  // deliberately retains the current editor metadata. Keep that established XML export contract.
  meta: ['title', 'titleEn', 'stdCode', 'icsCode', 'ccsCode', 'standardType', 'issuer', 'applicant', 'publishDate', 'implementDate', 'replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation'],
  front: ['foreword', 'introduction'],
  chapter: ['kind', 'id', 'secType', 'title', 'children'],
  clause: ['kind', 'id', 'level', 'titled', 'title', 'children'],
  appendix: ['kind', 'id', 'normative', 'title', 'children'],
  paragraph: ['kind', 'id', 'content'],
  list: ['kind', 'id', 'listType', 'level', 'items'],
  item: ['id', 'content'],
  table: ['kind', 'id', 'caption', 'captionEn', 'orientation', 'headerRowCount', 'rows', 'notes', 'footnotes'],
  row: ['id', 'cells'],
  cell: ['id', 'colspan', 'rowspan', 'header', 'content'],
  figure: ['kind', 'id', 'caption', 'captionEn', 'orientation', 'src', 'notes'],
  formula: ['kind', 'id', 'latex', 'sourceInlines', 'numbered', 'whereList'],
  where: ['id', 'term', 'definition'],
  note: ['kind', 'id', 'content'],
  example: ['kind', 'id', 'content'],
  termEntry: ['kind', 'id', 'level', 'term', 'termEn', 'definition', 'source', 'notes', 'examples'],
  bibEntry: ['kind', 'id', 'content'],
  inline: ['text', 'marks', 'footnote'],
  footnote: ['id', 'content'],
  mark: ['type', 'id', 'targetId', 'targetKind'],
  unmappedFootnote: ['container', 'nodeId', 'content', 'reason'],
}).map(([key, values]) => [key, new Set(values)]))
const PRINT_META_FIELDS = new Set(['proposer', 'technicalCommittee'])
const MARKS = new Set(['bold', 'italic', 'underline', 'sub', 'sup', 'crossRef', 'tableFootnoteRef'])

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
    && (!Array.isArray(value) || value.length > 0)
    && (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 0)
}

function inferredLegacyHeaderRowCount(rows: unknown): number {
  if (!Array.isArray(rows)) return 0
  let count = 0
  for (const row of rows) {
    const cells = row && typeof row === 'object' && Array.isArray((row as Record<string, unknown>).cells)
      ? (row as Record<string, unknown>).cells as unknown[] : []
    if (cells.length === 0 || !cells.every(cell => cell && typeof cell === 'object' && (cell as Record<string, unknown>).header === true)) break
    count += 1
  }
  return count
}

/** Formula renderers consume LaTeX, so only the plain-text equivalent may pass. */
function formulaSourceHasUnrenderedData(source: unknown, latex: unknown): boolean {
  if (!Array.isArray(source)) return false
  const runs = source as Array<Record<string, unknown>>
  if (runs.some(run => !run || typeof run !== 'object'
    || present(run.marks) || present(run.style) || present(run.formula) || present(run.footnote))) return true
  const text = runs.map(run => typeof run.text === 'string' ? run.text : '').join('').trim()
  return typeof latex !== 'string' || text !== latex.trim()
}

export function getOutputSupportProblems(doc: IRDoc, format: 'DOCX' | 'HTML' | 'XML'): OutputSupportProblem[] {
  const problems: OutputSupportProblem[] = (doc.unsupportedContent ?? []).map(issue => ({
    code: 'unsupported-output', nodeId: issue.nodeId ?? undefined, path: issue.path,
    message: `${format} 不能输出 ${issue.path}（${issue.nodeType}）：${issue.reason}。请保留 JSON 文档。`,
  }))
  const visit = (value: unknown, shape: string, path: string, parentId?: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const object = value as Record<string, unknown>
    const id = typeof object.id === 'string' ? object.id : parentId
    const kind = typeof object.kind === 'string' ? object.kind : shape
    const allowed = Object.prototype.hasOwnProperty.call(FIELDS, kind) ? FIELDS[kind] : undefined
    const report = (field: string) => problems.push({
      code: 'unsupported-output', nodeId: id, path: `${path}.${field}`,
      message: `${format} 暂未支持此信息：${path}.${field}${id ? `（节点 ${id}）` : ''}。请保留 JSON 文档。`,
    })
    if (!allowed) { report('kind'); return }
    for (const [key, child] of Object.entries(object)) {
      if (kind === 'table' && key === 'headerRowCount' && format === 'XML'
        && typeof child === 'number' && child !== inferredLegacyHeaderRowCount(object.rows)) {
        report(key)
        continue
      }
      if (kind === 'formula' && key === 'sourceInlines' && formulaSourceHasUnrenderedData(child, object.latex)) {
        report(key)
        continue
      }
      if (!allowed.has(key) && !(kind === 'meta' && format !== 'XML' && PRINT_META_FIELDS.has(key))) {
        if (present(child)) report(key)
        continue
      }
      if (kind === 'mark' && key === 'type' && !MARKS.has(String(child))) { report(key); continue }
      if (key === 'unsupportedContent') continue
      const childShape = key === 'meta' ? 'meta' : key === 'front' ? 'front'
        : key === 'marks' ? 'mark' : key === 'footnote' || key === 'footnotes' ? 'footnote'
        : key === 'rows' ? 'row' : key === 'cells' ? 'cell' : key === 'items' ? 'item'
        : key === 'whereList' ? 'where' : key === 'unmappedFootnotes' ? 'unmappedFootnote'
        : 'inline'
      if (Array.isArray(child)) child.forEach((entry, index) => visit(entry, childShape, `${path}.${key}[${index}]`, id))
      else if (child && typeof child === 'object') visit(child, childShape, `${path}.${key}`, id)
    }
  }
  visit(doc, 'doc', 'doc')

  // Resolver typed-reference errors are a narrow non-JSON export boundary. Do not
  // block unrelated Resolver diagnostics: warnings and other error codes retain
  // their existing export policy. IRProblem has no source-field path, so identify
  // the diagnostic source explicitly rather than fabricating an inline mark path.
  for (const issue of resolve(doc).problems) {
    if (issue.code !== 'dangling-typed-ref' || issue.severity !== 'error') continue
    problems.push({
      code: 'unsupported-output',
      ...(issue.nodeId !== null ? { nodeId: issue.nodeId } : {}),
      path: 'resolver.problems[dangling-typed-ref]',
      message: `${format} 不能输出类型错误的引用：${issue.message}。请修正引用目标；如需保留原稿，请导出 JSON。`,
    })
  }
  return problems
}

export class UnsupportedOutputError extends Error {
  readonly problems: OutputSupportProblem[]
  constructor(problems: OutputSupportProblem[]) {
    super(problems.map(problem => problem.message).join('\n'))
    this.name = 'UnsupportedOutputError'
    this.problems = problems
  }
}

export function assertOutputSupported(doc: IRDoc, format: 'DOCX' | 'HTML' | 'XML'): void {
  const problems = getOutputSupportProblems(doc, format)
  if (problems.length) throw new UnsupportedOutputError(problems)
}
