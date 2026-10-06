import type { IRDoc } from '../ir/types'

export interface OutputSupportProblem {
  code: 'unsupported-output'
  nodeId?: string
  path: string
  message: string
}

/** Current print renderers' explicit consumption contract. New authoring fields must not vanish silently. */
const FIELDS: Record<string, ReadonlySet<string>> = Object.fromEntries(Object.entries({
  doc: ['schemaVersion', 'extensionVersion', 'meta', 'front', 'body', 'appendices', 'bibliography', 'unsupportedContent', 'unmappedFootnotes'],
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
