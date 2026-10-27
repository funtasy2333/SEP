/**
 * GB/T 46687.2—2026 XML 导出渲染器的公共契约（WP8.2 设计 §4.1～§4.4）。
 *
 * 本文件目前只有类型与入口占位（T2.4a-0）：问题类型与码、选项、结果、`XmlExportError`，以及
 * `exportXml46687`（不因内容问题抛错）与 `renderXml46687`（有 error 即抛）的签名。入口断言已就位，
 * 渲染管线（设计 §2.0.1 的 P1～P5）由 T2.4a-1 实现。
 *
 * 同构纯 TypeScript，不引用任何浏览器/Node API；渲染器内**不含编号逻辑**，id 一律取自 Resolver 的 `labels`。
 */

import type { IRDoc, NodeId, ResolvedLabel } from '../ir/types'
import type { ResourceManifest } from '../xml46687/resources'
import { assertFootnoteReferences } from './footnotes'
import { UnsupportedOutputError, assertOutputSupported } from './outputBoundary'

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
  | 'index-seealso-not-expressed'
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

/**
 * 导出为 GB/T 46687.2 XML，不因内容问题抛错：返回 XML（有 error 时为 null）与全部问题。
 * 入口断言（先脚注、后输出边界，与 `renderXml46687` 同序）失败时转为问题返回，不再继续。
 */
export function exportXml46687(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  _options: RenderXml46687Options,
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
  throw new Error('exportXml46687: not implemented (WP8.2 T2.4a-1)')
}

/**
 * 渲染为 GB/T 46687.2 XML 字符串，与 `renderHtml`/DOCX 渲染器对称：入口断言失败抛原错误
 * （脚注 `Error`、`UnsupportedOutputError`），内容有 error 抛 `XmlExportError`。
 */
export function renderXml46687(
  doc: IRDoc,
  labels: Record<NodeId, ResolvedLabel>,
  _options: RenderXml46687Options,
): string {
  assertFootnoteReferences(doc, labels)
  assertOutputSupported(doc, 'XML46687')
  throw new Error('renderXml46687: not implemented (WP8.2 T2.4a-1)')
}
