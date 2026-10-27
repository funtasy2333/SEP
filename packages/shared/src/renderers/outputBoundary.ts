import { tableColumnWidthIssues } from './docx/body/tableColumnWidths'
import type { IRTable } from '../ir/types'
import type { IRDoc } from '../ir/types'
import { resolve, termTailOrderProblemMessage, unsupportedContentProblemMessage } from '../ir/resolve'
import { findCrossRefRunProjectionIssues } from '../ir/inlineProjectionDiagnostics'
import { canonicalTermTailOrder, orderedTermTail, sameTermTailOrder } from '../ir/termTailOrder'
import type { IRTermEntry, IRTermTailOrderItem } from '../ir/types'
import {
  XML46687_EXTRA_FIELDS, XML46687_EXTRA_MARKS, XML46687_PLAIN_KIND_SHAPES, XML46687_SHAPE_RULES,
} from './xml46687Boundary'

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

const DEF_LIST_FIELDS = ['kind', 'id', 'items'] as const

/** G1 新增的块 kind：整体登记（BASE_FIELDS 中没有它们，见 buildFields）。 */
const GROUP_G1: Readonly<Record<string, readonly string[]>> = {
  normRefList: ['kind', 'id', 'entries'],
  normRef: ['kind', 'id', 'entryType', 'ref', 'title', 'content'],
}

/*
 * WP8.M G3（设计 §7.1）：图例 figure.legend（M-8.5-01～06）、图中示例 figure.examples（M-8.4-03）、行内图 IRInline.image
 * （M-8.3-02）本阶段只做模型、Schema 与显示，不排版——它们既不在 BASE_FIELDS.figure / BASE_FIELDS.inline 里，也不进任何
 * EXTRA_FIELDS，因此 HTML、DOCX、XML、XML46687 四种格式都自动按 `report(field)` 报 unsupported-output（测试：wp8mG3Boundary.test.ts）。
 * figure.notes（M-8.2-11）是 BASE_FIELDS.figure 早有的字段，HTML 与 DOCX 渲染器早已逐条输出，随 PM 现可保存而首次到达渲染器，
 * 无需改动本表（回归：wp8mG3Render.test.ts）；旧 XML 序列化器不输出图中注，由其自身的 PM 层检查拒绝（xmlSerializer.ts）。
 */

/**
 * Fields a format consumes in addition to BASE_FIELDS (kind -> extra fields).
 * BASE_FIELDS 中不存在的 kind 视为该格式新放行的整个 kind（缺省不在表内的 kind 一律报 unsupported-output）。
 */
const NO_EXTRA_FIELDS: Readonly<Record<string, readonly string[]>> = {}
const EXTRA_FIELDS: Record<OutputBoundaryFormat, Readonly<Record<string, readonly string[]>>> = {
  // WP8.M §7.1 本阶段排版，仅 HTML、DOCX 放行；XML46687 留给 WP8.2：
  // - termEntry.subjectField（M-9.2.9-01，G5）：定义前输出“〈领域〉”；
  // - front.introductionClauses（M-4.3.4-02/03，G6）：引言中的条（0.1…）按条标题排版；
  // - defList（M-10.1.4-01/-03/-04/-05，G2）：缩略语表，缩略语在前、释义在后同一行，中间是全角冒号（渲染时添加，不入 IR）。
  //   项与公式“式中”项同形，沿用 where 形状（见 childShape）。
  // - 规范性引用文件清单（M-4.4.2.3-02/-03/-04，G1）：新 kind normRefList / normRef，按 10.3.4 排版；
  // - doc.bibliographyTitle（M-4.5.3-02，G1）：自定义参考文献标题替换默认标题。
  DOCX: { meta: PRINT_META_FIELDS, cell: ['columnWidths'], termEntry: ['subjectField'], front: ['introductionClauses'], defList: DEF_LIST_FIELDS, ...GROUP_G1, doc: ['bibliographyTitle'] },
  HTML: { meta: PRINT_META_FIELDS, termEntry: ['subjectField'], front: ['introductionClauses'], defList: DEF_LIST_FIELDS, ...GROUP_G1, doc: ['bibliographyTitle'] },
  XML: NO_EXTRA_FIELDS,
  // XML46687 比 XML 多放行的字段/kind/mark 由各领域文件登记（renderers/xml46687Parts/*.ts 的 XML46687_*_BOUNDARY），
  // 汇总在 xml46687Boundary.ts；XML46687_DECLARED_DIFFERENCES 逐项列出差异，outputBoundaryXml46687.test.ts 据此断言。
  XML46687: XML46687_EXTRA_FIELDS,
}

function buildFields(format: OutputBoundaryFormat): Record<string, ReadonlySet<string>> {
  const extra = EXTRA_FIELDS[format]
  const merged = Object.fromEntries(Object.entries(BASE_FIELDS).map(([kind, base]) => [
    kind, Object.prototype.hasOwnProperty.call(extra, kind) ? new Set([...base, ...extra[kind]!]) : base,
  ]))
  // 整个 kind 只对部分格式放行（如 defList）：不在 BASE_FIELDS 里，由该格式的 extra 单独引入，其余格式仍报 kind 不支持。
  for (const [kind, fields] of Object.entries(extra)) if (!Object.prototype.hasOwnProperty.call(merged, kind)) merged[kind] = new Set(fields)
  return merged
}
const FIELDS_BY_FORMAT: Record<OutputBoundaryFormat, Record<string, ReadonlySet<string>>> = {
  DOCX: buildFields('DOCX'), HTML: buildFields('HTML'), XML: buildFields('XML'), XML46687: buildFields('XML46687'),
}
// WP8.M §7.1 / D-M-07：正文标准引用 mark（stdRef、mixedCitation，M-10.2-01/-02、M-10.1.7-01）本阶段在 HTML、DOCX
// 按普通文本输出；旧 XML 不放行。XML46687 的 mark 集合 = MARKS 加 xml46687Boundary 汇总的 mark（WP8.2 §1.3.3）。
const PRINT_MARKS = new Set([...MARKS, 'stdRef', 'mixedCitation'])
const XML46687_MARKS = new Set([...MARKS, ...XML46687_EXTRA_MARKS])
const MARKS_BY_FORMAT: Record<OutputBoundaryFormat, ReadonlySet<string>> = { DOCX: PRINT_MARKS, HTML: PRINT_MARKS, XML: MARKS, XML46687: XML46687_MARKS }
/**
 * 对象的 `kind` 字段是数据而不是节点 kind 的 shape：mark（`variable` 的 `kind`）恒如此，其余由领域登记
 * （如 `IRIdentifierPart.kind`）。不排除它们，带 `kind` 的数据字段会被当成“kind 为某某的节点”而整体误报。
 */
const PLAIN_KIND_SHAPES: ReadonlySet<string> = new Set(['mark', ...XML46687_PLAIN_KIND_SHAPES])

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
    const kind = !PLAIN_KIND_SHAPES.has(shape) && typeof object.kind === 'string' ? object.kind : shape
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
    // 小写罗马列项（WP8.M G7，M-5.7-04）：只有旧 XML（format==='XML'）阻断——旧序列化器会把它降为阿拉伯数字（toXmlListType），
    // 导出后 i) 变成 1)，属静默降级。XML46687 放行（GB/T 46687.2 5.7.2 有 roman-lower，WP8.2 消费）；HTML/DOCX 已真排。
    // 这是 XML 与 XML46687 在字段表之外唯一有意的分叉，outputBoundaryXml46687.test.ts 把它列为已知例外。
    if (format === 'XML' && kind === 'list' && object.listType === 'roman') {
      problems.push({
        code: 'unsupported-output', nodeId: id, path: `${path}.listType`,
        message: `XML 不能输出罗马列项：旧 XML 序列化器会把它降为阿拉伯数字，改变列项编号：${path}.listType${id ? `（节点 ${id}）` : ''}。请保留 JSON 文档，或导出 HTML/DOCX。`,
      })
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
        // 旧 XML 一律阻断；XML46687 放行（WP8.2 §1.3.3）：纯文本型容器里的行内公式由渲染器报 formula-in-text-only，
        // 公式是否有可用的 MathML 也由渲染器核对（mathml-missing），所以这里既不查容器也不要求 latex。
        if (format === 'XML') { report(key); continue }
        if (format !== 'XML46687' && (container === undefined || !INLINE_FORMULA_CONTAINERS.has(container))) {
          problems.push({
            code: 'unsupported-output', nodeId: id, path: `${path}.${key}`,
            message: `${format} 暂未支持此位置的行内公式：${path}.${key}${id ? `（节点 ${id}）` : ''}；标题、图表题、术语名、参考文献中暂不支持行内公式。请保留 JSON 文档。`,
          })
          continue
        }
        if (present(object.marks)) report('marks')
        if (present(object.footnote)) report('footnote')
        const formula = child as Record<string, unknown>
        if (format !== 'XML46687' && (typeof formula.latex !== 'string' || formula.latex.trim() === '')) report(`${key}.latex`)
      }
      if (key === 'unsupportedContent') continue
      if (key === 'tailOrder') continue
      const defaultShape = key === 'meta' ? 'meta' : key === 'front' ? 'front'
        : key === 'marks' ? 'mark' : key === 'footnote' || key === 'footnotes' ? 'footnote'
        : key === 'rows' ? 'row' : key === 'cells' ? 'cell' : key === 'items' ? (kind === 'defList' ? 'where' : 'item')
        : key === 'whereList' ? 'where' : key === 'unmappedFootnotes' ? 'unmappedFootnote'
        : key === 'formula' && shape === 'inline' ? 'inlineFormula'
        : 'inline'
      // XML46687：领域登记的 childShape（没有 kind 的对象类型，如 titlePart/identifier）优先于上面的默认链
      const childShape = format === 'XML46687'
        ? XML46687_SHAPE_RULES.find(rule => rule.parent === kind && rule.key === key)?.shape ?? defaultShape
        : defaultShape
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

  // WP8.M M-Z-a（设计 §7.1，主导人 2026-10-26）：Resolver 产生的 `unsupported-content` error 一律阻断非 JSON 出口。
  // 它们表示文档里有模型能保存、但无法合法表达的结构（规范性引用清单位置/数量不合法、行内图位置不合法等）；
  // 之前只有脚注类与 dangling-typed-ref 被拦截，这类 error 会被静默带进 HTML/DOCX/XML。
  // 其余 error 代码（dangling-xref、duplicate-id……）与 warning 保持既有的导出口径，不在此处改变。
  // Resolver 还会把 doc.unsupportedContent（pmToIr 诊断）与术语 tailOrder 无效重述成同一代码：这两类上文已按各自路径
  // 阻断，此处按文案识别后跳过，避免同一问题报两次。
  const restated = new Set((doc.unsupportedContent ?? []).map(issue => `${issue.nodeId ?? ''}\u0000${unsupportedContentProblemMessage(issue)}`))
  const tailOrderPrefix = termTailOrderProblemMessage('')
  for (const issue of resolution.problems) {
    if (issue.code !== 'unsupported-content' || issue.severity !== 'error') continue
    if (restated.has(`${issue.nodeId ?? ''}\u0000${issue.message}`) || issue.message.startsWith(tailOrderPrefix)) continue
    problems.push({
      code: 'unsupported-output',
      ...(issue.nodeId !== null ? { nodeId: issue.nodeId } : {}),
      path: 'resolver.problems[unsupported-content]',
      message: `${format} 不能输出无法合法表达的内容：${issue.message}。请修正该内容；如需保留原稿，请导出 JSON。`,
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
