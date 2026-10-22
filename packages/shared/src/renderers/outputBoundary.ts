import { tableColumnWidthIssues } from './docx/body/tableColumnWidths'
import type { IRTable } from '../ir/types'
import type { IRDoc } from '../ir/types'
import { resolve } from '../ir/resolve'
import { findCrossRefRunProjectionIssues } from '../ir/inlineProjectionDiagnostics'
import { canonicalTermTailOrder, orderedTermTail, sameTermTailOrder } from '../ir/termTailOrder'
import type { IRTermEntry, IRTermTailOrderItem } from '../ir/types'

export interface OutputSupportProblem {
  code: 'unsupported-output'
  nodeId?: string
  path: string
  message: string
}

/** 输出边界检查的目标格式。 */
export type OutputBoundaryFormat = 'DOCX' | 'HTML' | 'XML' | 'XML46687'

/** Shared field contract of every format. New authoring fields must not vanish silently. */
const BASE_FIELDS: Record<string, ReadonlySet<string>> = Object.fromEntries(Object.entries({
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
  termEntry: ['kind', 'id', 'level', 'term', 'termEn', 'definition', 'source', 'notes', 'examples', 'tailOrder'],
  bibEntry: ['kind', 'id', 'content'],
  inline: ['text', 'marks', 'footnote', 'formula'],
  // 式中符号行内公式：渲染器只消费 LaTeX（KaTeX / OMML），MathML 与外部源无法如实输出。
  inlineFormula: ['id', 'latex'],
  footnote: ['id', 'content'],
  mark: ['type', 'id', 'targetId', 'targetKind'],
  unmappedFootnote: ['container', 'nodeId', 'content', 'reason'],
}).map(([key, values]) => [key, new Set(values)]))
const PRINT_META_FIELDS = ['proposer', 'technicalCommittee']
const MARKS = new Set(['bold', 'italic', 'underline', 'sub', 'sup', 'crossRef', 'tableFootnoteRef'])
/**
 * 行内公式只开放给正文类位置（docs/phase7-inline-formula.md）：段落内容（注、示例、单元格、列项、术语定义
 * 里的段落都在此列）、式中符号与释义、条文脚注与表脚注内容。标题、图表题、术语名、参考文献会进入目次、
 * 书签和引用文字，暂不放开。值为「行内数组所属容器」：父对象的 kind（无 kind 时为 shape）与字段名。
 */
const INLINE_FORMULA_CONTAINERS = new Set(['paragraph.content', 'where.term', 'where.definition', 'footnote.content'])

/** Fields a format consumes in addition to BASE_FIELDS (kind -> extra fields). */
const NO_EXTRA_FIELDS: Readonly<Record<string, readonly string[]>> = {}
const EXTRA_FIELDS: Record<OutputBoundaryFormat, Readonly<Record<string, readonly string[]>>> = {
  // termEntry.subjectField（M-9.2.9-01）：WP8.M §7.1 本阶段排版，仅 HTML、DOCX 放行（定义前输出“〈领域〉”）；XML46687 留给 WP8.2。
  DOCX: { meta: PRINT_META_FIELDS, cell: ['columnWidths'], termEntry: ['subjectField'] },
  HTML: { meta: PRINT_META_FIELDS, termEntry: ['subjectField'] },
  XML: NO_EXTRA_FIELDS,
  // XML46687 的允许表、marks 与特殊检查目前与 XML 完全相同；WP8.1 支持矩阵确定后，在 WP8.2 再放开。
  XML46687: NO_EXTRA_FIELDS,
}

function buildFields(format: OutputBoundaryFormat): Record<string, ReadonlySet<string>> {
  const extra = EXTRA_FIELDS[format]
  return Object.fromEntries(Object.entries(BASE_FIELDS).map(([kind, base]) => [
    kind, Object.prototype.hasOwnProperty.call(extra, kind) ? new Set([...base, ...extra[kind]!]) : base,
  ]))
}
const FIELDS_BY_FORMAT: Record<OutputBoundaryFormat, Record<string, ReadonlySet<string>>> = {
  DOCX: buildFields('DOCX'), HTML: buildFields('HTML'), XML: buildFields('XML'), XML46687: buildFields('XML46687'),
}
const MARKS_BY_FORMAT: Record<OutputBoundaryFormat, ReadonlySet<string>> = { DOCX: MARKS, HTML: MARKS, XML: MARKS, XML46687: MARKS }

function fieldsFor(format: OutputBoundaryFormat): Record<string, ReadonlySet<string>> { return FIELDS_BY_FORMAT[format] }
function marksFor(format: OutputBoundaryFormat): ReadonlySet<string> { return MARKS_BY_FORMAT[format] }
/** XML-family formats share the legacy-XML header-row check. */
function isXmlFormat(format: OutputBoundaryFormat): boolean { return format === 'XML' || format === 'XML46687' }

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

export function getOutputSupportProblems(doc: IRDoc, format: OutputBoundaryFormat): OutputSupportProblem[] {
  const fields = fieldsFor(format)
  const marks = marksFor(format)
  const problems: OutputSupportProblem[] = (doc.unsupportedContent ?? []).map(issue => ({
    code: 'unsupported-output', nodeId: issue.nodeId ?? undefined, path: issue.path,
    message: `${format} 不能输出 ${issue.path}（${issue.nodeType}）：${issue.reason}。请保留 JSON 文档。`,
  }))
  const resolution = resolve(doc)
  const visit = (value: unknown, shape: string, path: string, parentId?: string, container?: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const object = value as Record<string, unknown>
    const id = typeof object.id === 'string' ? object.id : parentId
    const kind = typeof object.kind === 'string' ? object.kind : shape
    if (format === 'DOCX' && typeof object.text === 'string' && Array.isArray(object.marks)) {
      const marks = object.marks as Array<{ type?: unknown }>
      const subIndex = marks.findIndex(mark => mark?.type === 'sub')
      const supIndex = marks.findIndex(mark => mark?.type === 'sup')
      const crossRef = marks.find(mark => mark?.type === 'crossRef') as { targetId?: unknown } | undefined
      const refText = typeof crossRef?.targetId === 'string' ? resolution.labels[crossRef.targetId]?.refText : undefined
      const hasOutputText = object.text.length > 0 || (typeof refText === 'string' && refText.length > 0)
      if (hasOutputText && subIndex >= 0 && supIndex >= 0) {
        const conflictIndex = Math.max(subIndex, supIndex)
        problems.push({
          code: 'unsupported-output',
          ...(id === undefined ? {} : { nodeId: id }),
          path: `${path}.marks[${conflictIndex}]`,
          message: 'DOCX 不能在同一文本中同时保留下标和上标；行内格式只能保存一种垂直对齐。请保留 JSON 文档。',
        })
      }
    }
    const allowed = Object.prototype.hasOwnProperty.call(fields, kind) ? fields[kind] : undefined
    const report = (field: string) => problems.push({
      code: 'unsupported-output', nodeId: id, path: `${path}.${field}`,
      message: `${format} 暂未支持此信息：${path}.${field}${id ? `（节点 ${id}）` : ''}。请保留 JSON 文档。`,
    })
    if (kind === 'termEntry' && Object.prototype.hasOwnProperty.call(object, 'tailOrder') && object.tailOrder !== undefined) {
      const entry = object as unknown as IRTermEntry
      const tail = orderedTermTail(entry, format === 'HTML' ? 'html' : 'resolver')
      if (tail.issue) {
        problems.push({
          code: 'unsupported-output', ...(id === undefined ? {} : { nodeId: id }), path: `${path}.tailOrder`,
          message: `${format} 不能输出此术语尾项顺序：${tail.issue}。请保留 JSON 文档。`,
        })
      } else if (format === 'DOCX' || format === 'HTML') {
        const printable = (item: IRTermTailOrderItem) => ['definition', 'source', 'note', 'example'].includes(item.kind)
        const authoredOrder = tail.items.filter(printable).map(({ kind: itemKind, index }) => ({ kind: itemKind, index })) as IRTermTailOrderItem[]
        const expectedOrder = canonicalTermTailOrder(entry, format === 'HTML' ? 'html' : 'resolver').filter(printable)
        if (!sameTermTailOrder(authoredOrder, expectedOrder)) {
          problems.push({
            code: 'unsupported-output', ...(id === undefined ? {} : { nodeId: id }), path: `${path}.tailOrder`,
            message: `${format} 不能保留此术语尾项作者顺序；当前格式固定为${format === 'DOCX' ? '定义→示例→注→来源' : '定义→来源→注→示例'}。请保留 JSON 文档。`,
          })
        }
      }
    }
    if (format === 'DOCX' && kind === 'table' && (object.rows as IRTable['rows'] | undefined)?.some(row => row.cells.some(cell => present(cell.columnWidths)))) {
      try {
        for (const issue of tableColumnWidthIssues(object as unknown as IRTable)) problems.push({
          code: 'unsupported-output', nodeId: issue.nodeId,
          path: `${path}.rows[${issue.rowIndex}].cells[${issue.cellIndex}].columnWidths`,
          message: `DOCX 不能保留此列宽：${issue.reason}。请保留 JSON 文档。`,
        })
      } catch (error) {
        problems.push({code:'unsupported-output', nodeId:id, path:`${path}.columnWidths`,
          message:`DOCX 不能映射表格列宽：${error instanceof Error ? error.message : String(error)}。请保留 JSON 文档。`})
      }
    }
    if (!allowed) { report('kind'); return }
    for (const [key, child] of Object.entries(object)) {
      if (kind === 'table' && key === 'headerRowCount' && isXmlFormat(format)
        && typeof child === 'number' && child !== inferredLegacyHeaderRowCount(object.rows)) {
        report(key)
        continue
      }
      if (kind === 'formula' && key === 'sourceInlines' && formulaSourceHasUnrenderedData(child, object.latex)) {
        report(key)
        continue
      }
      if (!allowed.has(key)) {
        if (present(child)) report(key)
        continue
      }
      if (kind === 'mark' && key === 'type' && !marks.has(String(child))) { report(key); continue }
      if (shape === 'inline' && key === 'formula' && present(child)) {
        if (isXmlFormat(format)) { report(key); continue }
        if (container === undefined || !INLINE_FORMULA_CONTAINERS.has(container)) {
          problems.push({
            code: 'unsupported-output', nodeId: id, path: `${path}.${key}`,
            message: `${format} 暂未支持此位置的行内公式：${path}.${key}${id ? `（节点 ${id}）` : ''}；标题、图表题、术语名、参考文献中暂不支持行内公式。请保留 JSON 文档。`,
          })
          continue
        }
        if (present(object.marks)) report('marks')
        if (present(object.footnote)) report('footnote')
        const formula = child as Record<string, unknown>
        if (typeof formula.latex !== 'string' || formula.latex.trim() === '') report(`${key}.latex`)
      }
      if (key === 'unsupportedContent') continue
      if (key === 'tailOrder') continue
      const childShape = key === 'meta' ? 'meta' : key === 'front' ? 'front'
        : key === 'marks' ? 'mark' : key === 'footnote' || key === 'footnotes' ? 'footnote'
        : key === 'rows' ? 'row' : key === 'cells' ? 'cell' : key === 'items' ? 'item'
        : key === 'whereList' ? 'where' : key === 'unmappedFootnotes' ? 'unmappedFootnote'
        : key === 'formula' && shape === 'inline' ? 'inlineFormula'
        : 'inline'
      const childContainer = `${kind}.${key}`
      if (Array.isArray(child)) child.forEach((entry, index) => visit(entry, childShape, `${path}.${key}[${index}]`, id, childContainer))
      else if (child && typeof child === 'object') visit(child, childShape, `${path}.${key}`, id, childContainer)
    }
  }
  visit(doc, 'doc', 'doc')

  // HTML/DOCX replace a marked run's text with one refText. They cannot represent
  // multiple destinations in one run or one reference spanning a hard break.
  // Keep this print-only check narrow; XML and JSON retain their existing paths.
  if (format === 'HTML' || format === 'DOCX') {
    for (const issue of findCrossRefRunProjectionIssues(doc)) {
      problems.push({
        code: 'unsupported-output',
        ...(issue.nodeId === undefined ? {} : { nodeId: issue.nodeId }),
        path: issue.path,
        message: `${format} 暂不支持此引用范围：${issue.reason}。请保留 JSON 文档。`,
      })
    }
  }

  // Resolver typed-reference errors are a narrow non-JSON export boundary. Do not
  // block unrelated Resolver diagnostics: warnings and other error codes retain
  // their existing export policy. IRProblem has no source-field path, so identify
  // the diagnostic source explicitly rather than fabricating an inline mark path.
  for (const issue of resolution.problems) {
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

export function assertOutputSupported(doc: IRDoc, format: OutputBoundaryFormat): void {
  const problems = getOutputSupportProblems(doc, format)
  if (problems.length) throw new UnsupportedOutputError(problems)
}
