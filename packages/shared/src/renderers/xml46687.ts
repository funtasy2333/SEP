/**
 * GB/T 46687.2—2026 XML 导出渲染器：公共契约（设计 §4.1～§4.4）与渲染管线 P0～P5（设计 §2.0.1）。
 *
 * - P0 入口断言：先脚注核对、后输出边界（沿用 HTML/DOCX 渲染器的口径）；再核对 `options` 的形状；
 * - P1 预扫描：目标种类表、有序列项标记、图片引用清单（`xml46687Parts/targets.ts`、`dispatch.ts`）；
 * - P2 构建：自顶向下按分派表（`xml46687Parts/dispatch.ts`）构建 `XmlElement` 树，问题写入 `ctx.problems`；
 * - P3 后置赋值：仅被引用时写的 id、`mml_m<k>`（`xml46687Parts/ids.ts`）；
 * - P4 收尾检查：id 合法/唯一、rid 可解析、无 `ext_` 泄漏、资源清单核对（`xml46687Parts/ids.ts`）；
 * - P5 写出：有 error 则 `renderXml46687` 抛 `XmlExportError`、`exportXml46687` 返回 `xml: null`；否则 `writeXml`。
 *
 * 同构纯 TypeScript，不引用任何浏览器/Node API；渲染器内**不含编号逻辑**，id 一律取自 Resolver 的 `labels`
 * （渲染器自己只做 `mml_m<k>`/`df_<k>` 计数与常量 id）。
 */

import type { IRDoc, NodeId, ResolvedLabel } from '../ir/types'
import type { ResourceManifest } from '../xml46687/resources'
import type { XmlDocument } from '../xml46687/tree'
import { XmlWriteError, writeXml } from '../xml46687/writer'
import { assertFootnoteReferences } from './footnotes'
import { UnsupportedOutputError, assertOutputSupported } from './outputBoundary'
import { XML46687_NAMESPACES, preserveSpace } from './xml46687Parts/context'
import { createRenderSession } from './xml46687Parts/dispatch'
import { assignMathIds, assignPendingIds, checkOutputTree } from './xml46687Parts/ids'
import { renderStandard } from './xml46687Parts/structure'

/** 设计 §4.4 问题目录的全部码。 */
export type Xml46687ProblemCode =
  // 结构、元数据、行内容器
  | 'xml-label-missing' | 'xml-body-empty' | 'meta-required-missing' | 'xml-date-invalid'
  | 'xml-block-after-subsec' | 'xml-mark-combination' | 'xml-link-protocol' | 'xml-footnote-position'
  | 'formula-in-text-only'
  // 列项、注/示例、摘录、表
  | 'xml-list-type-unsupported' | 'list-marker-missing' | 'xml-list-empty' | 'xml-note-content'
  | 'xml-quote-content' | 'xml-cell-content' | 'cell-unit-unsupported' | 'xml-table-empty'
  // 图、资源、公式
  | 'resource-missing' | 'resource-mismatch' | 'mathml-missing' | 'mathml-invalid'
  // 术语
  | 'xml-term-outside-terms' | 'term-language-missing' | 'xml-term-empty' | 'xml-term-no-definition'
  | 'xml-term-definition-block' | 'xml-descriptor-value' | 'xml-descriptor-duplicate' | 'term-subjectfield-conflict'
  // 规范性引用、引用目标
  | 'xml-normref-outside' | 'xml-normref-incomplete' | 'xml-xref-target-unsupported' | 'xml-xref-target-missing'
  // 收尾检查与写出
  | 'xml-id-invalid' | 'xml-id-duplicate' | 'xml-rid-unresolved' | 'xml-ext-id-leak' | 'xml-write-failed'
  // 准备层（T2.5）
  | 'mathml-empty-source' | 'mathml-conversion-failed' | 'resource-load-failed' | 'resource-name-conflict'
  | 'resource-media-type'
  // warning：IR 有数据而 XML 无表达、已规范化的输入
  | 'meta-not-expressed' | 'meta-date-order' | 'title-missing' | 'title-ignored'
  | 'mark-dropped-in-text-only' | 'link-attr-not-expressed' | 'variable-attr-not-expressed' | 'newline-flattened'
  | 'empty-content' | 'code-language-not-expressed' | 'caption-empty' | 'caption-en-not-expressed'
  | 'table-width-not-expressed' | 'table-style-not-expressed' | 'figure-attr-not-expressed'
  | 'term-subjectfield-duplicate' | 'term-subjectfield-promoted' | 'term-subjectfield-brackets'
  | 'term-descriptor-not-expressed' | 'term-descriptor-missing' | 'bib-std-incomplete' | 'bib-field-not-expressed'
  | 'index-seealso-not-expressed' | 'list-type-normalized' | 'normref-unstructured'
  // info
  | 'cell-attr-not-expressed' | 'px-width-ignored' | 'term-language-merged' | 'term-tail-order-normalized'
  | 'mathml-annotation-removed' | 'resource-unused'

/**
 * 入口断言（设计 §4.2）转成问题时使用的码，沿用既有断言自带的代码，不属于 §4.4 目录：
 * `unsupported-output` 来自输出边界（`OutputSupportProblem.code`），`invalid-footnote` 来自脚注核对（`IRProblem.code`）。
 */
export type Xml46687EntryProblemCode = 'unsupported-output' | 'invalid-footnote'

export type Xml46687Severity = 'error' | 'warning' | 'info'

/**
 * 导出问题。形状对齐 `OutputSupportProblem`（`code/nodeId/path/message`）并加 `severity`，
 * 使导出对话框的 `ExportGuardProblem` 可一对一映射；`message` 为面向最终用户的中文，`path` 与 `getOutputSupportProblems` 同写法。
 */
export interface Xml46687Problem {
  code: Xml46687ProblemCode | Xml46687EntryProblemCode
  severity: Xml46687Severity
  nodeId?: NodeId
  path: string
  message: string
}

export interface RenderXml46687Options {
  /** 公式 NodeId → 完整 MathML 元素字符串（设计 §4.5）；IR 自带 `mathml` 时以 IR 为准，此处只补缺。 */
  mathml: Record<NodeId, string>
  /** 图片资源清单（设计 §4.3）；`href` 由 `collectXml46687ImageRefs` 给出。 */
  resources: ResourceManifest
}

export interface Xml46687ExportResult {
  /** 有任何 error 时为 null；warning/info 总是随 `problems` 返回。 */
  xml: string | null
  problems: Xml46687Problem[]
}

/** `renderXml46687` 遇到 error 时抛出；`problems` 为全部问题（含 warning/info），不是第一个。 */
export class XmlExportError extends Error {
  readonly problems: Xml46687Problem[]
  constructor(problems: Xml46687Problem[]) {
    const errors = problems.filter((problem) => problem.severity === 'error')
    super((errors.length > 0 ? errors : problems).map((problem) => problem.message).join('\n'))
    this.name = 'XmlExportError'
    this.problems = problems
  }
}

/** `assertFootnoteReferences` 自身抛出的是朴素 `Error`（不是 TypeError 等子类），据此与意外异常区分。 */
function isFootnoteAssertionError(error: unknown): error is Error {
  return error instanceof Error && Object.getPrototypeOf(error) === Error.prototype
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** P0：核对 `options` 的形状（调用方契约，错了是编程错误，抛 `TypeError`）。 */
function assertOptions(options: RenderXml46687Options): void {
  if (!isPlainObject(options) || !isPlainObject(options.mathml)) {
    throw new TypeError('renderXml46687: options.mathml 必须是对象（公式 NodeId → MathML 字符串）')
  }
  for (const [key, value] of Object.entries(options.mathml)) {
    if (typeof value !== 'string') throw new TypeError(`renderXml46687: options.mathml["${key}"] 必须是字符串`)
  }
  const resources = options.resources as ResourceManifest | undefined
  if (!isPlainObject(resources) || !Array.isArray(resources.entries)) {
    throw new TypeError('renderXml46687: options.resources 必须是资源清单（{ version: 1, entries: [] }）')
  }
}

/**
 * P1～P4：构建输出树并做收尾检查，返回 `XmlDocument` 与全部问题（含 warning/info）。
 * 不做入口断言、不写出文本；`exportXml46687` 与 `renderXml46687` 共用，也供语义检查测试直接取树
 * （设计 §7.1⑤，“写出前的树”）。
 */
export function buildXml46687Document(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  options: RenderXml46687Options,
): { document: XmlDocument; problems: Xml46687Problem[] } {
  assertOptions(options)
  const session = createRenderSession(doc, labels, options)
  const { ctx } = session
  const root = renderStandard(ctx)
  session.flushMerged()
  assignPendingIds(ctx, session.ids)
  assignMathIds(root)
  checkOutputTree(ctx, root)
  return { document: { root }, problems: ctx.problems }
}

/** P5：写出 XML 文本；`XmlWriteError`（控制字符等）包装为 `xml-write-failed` 问题。 */
function writeDocument(document: XmlDocument, problems: Xml46687Problem[]): string | null {
  try {
    return writeXml(document, { namespaces: XML46687_NAMESPACES, indent: '  ', preserveSpace })
  } catch (error) {
    if (!(error instanceof XmlWriteError)) throw error
    problems.push({ code: 'xml-write-failed', severity: 'error', path: `xml:${error.path}`, message: error.message })
    return null
  }
}

function runPipeline(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  options: RenderXml46687Options,
): Xml46687ExportResult {
  const { document, problems } = buildXml46687Document(doc, labels, options)
  if (problems.some((problem) => problem.severity === 'error')) return { xml: null, problems }
  const xml = writeDocument(document, problems)
  return { xml, problems }
}

/**
 * 导出为 GB/T 46687.2 XML，不因内容问题抛错：返回 XML（有 error 时为 null）与全部问题。
 * 入口断言（先脚注、后输出边界，与 `renderXml46687` 同序）失败时转为问题返回，不再继续。
 */
export function exportXml46687(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  options: RenderXml46687Options,
): Xml46687ExportResult {
  try {
    assertFootnoteReferences(doc, labels)
  } catch (error) {
    if (!isFootnoteAssertionError(error)) throw error
    return {
      xml: null,
      problems: [{ code: 'invalid-footnote', severity: 'error', path: 'doc', message: error.message.replace(/^render: /, '') }],
    }
  }
  try {
    assertOutputSupported(doc, 'XML46687')
  } catch (error) {
    if (!(error instanceof UnsupportedOutputError)) throw error
    return {
      xml: null,
      problems: error.problems.map((problem): Xml46687Problem => ({
        code: problem.code,
        severity: 'error',
        ...(problem.nodeId === undefined ? {} : { nodeId: problem.nodeId }),
        path: problem.path,
        message: problem.message,
      })),
    }
  }
  return runPipeline(doc, labels, options)
}

/**
 * 渲染为 GB/T 46687.2 XML 字符串，与 `renderHtml`/DOCX 渲染器对称：入口断言失败抛原错误
 * （脚注 `Error`、`UnsupportedOutputError`），内容有 error 抛 `XmlExportError`（携带全部问题）。
 */
export function renderXml46687(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  options: RenderXml46687Options,
): string {
  assertFootnoteReferences(doc, labels)
  assertOutputSupported(doc, 'XML46687')
  const result = runPipeline(doc, labels, options)
  if (result.xml === null) throw new XmlExportError(result.problems)
  return result.xml
}
