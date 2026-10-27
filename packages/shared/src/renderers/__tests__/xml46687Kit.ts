/**
 * XML46687 渲染器测试的共用构造器（T2.4a-1；T2.4b/T2.4c 的域测试沿用）。
 *
 * 只含纯 TS（不用 Node API）：手写最小 IR、`resolve` 后调用 `exportXml46687`，返回 XML 与问题。
 * 外部校验（python3）的辅助在 `xml46687PythonValidation.ts`。
 */

import { resolve } from '../../ir/resolve'
import { writeXml } from '../../xml46687/writer'
import { XML46687_NAMESPACES, el, site, type InlineContainer, type RenderContext } from '../xml46687Parts/context'
import { createRenderSession } from '../xml46687Parts/dispatch'
import type {
  IRAppendix, IRBlock, IRChapter, IRClause, IRClauseChild, IRDoc, IRDocMeta, IRInline, IRMark, IRParagraph, NodeId, ResolvedLabel,
} from '../../ir/types'
import { exportXml46687, type RenderXml46687Options, type Xml46687ExportResult, type Xml46687Problem } from '../xml46687'

export const EMPTY_OPTIONS: RenderXml46687Options = { mathml: {}, resources: { version: 1, entries: [] } }

/** SES 必填元数据齐全（发布机构、语言、发布/实施日期）的最小元数据：不产生 `meta-required-missing`。 */
export function completeMeta(overrides: Partial<IRDocMeta> = {}): IRDocMeta {
  return {
    standardType: 'gb',
    title: '测试标准',
    issuer: '测试发布机构',
    languages: [{ id: 'lang-zh', tag: 'zh' }],
    publishDate: '2026-04-30',
    implementDate: '2026-11-01',
    ...overrides,
  }
}

export function run(text: string, ...marks: IRMark[]): IRInline {
  return marks.length > 0 ? { text, marks } : { text }
}

export function para(id: NodeId, ...content: Array<string | IRInline>): IRParagraph {
  return { kind: 'paragraph', id, content: content.map((entry) => (typeof entry === 'string' ? { text: entry } : entry)) }
}

export function chapter(id: NodeId, title: string, children: IRClauseChild[], secType: IRChapter['secType'] = 'general'): IRChapter {
  return { kind: 'chapter', id, secType, title: [{ text: title }], children }
}

export function clause(id: NodeId, level: IRClause['level'], title: string | null, children: IRClauseChild[]): IRClause {
  return { kind: 'clause', id, level, titled: title !== null, title: title === null ? [] : [{ text: title }], children }
}

export function appendix(id: NodeId, normative: boolean, title: string, children: IRClauseChild[]): IRAppendix {
  return { kind: 'appendix', id, normative, title: [{ text: title }], children }
}

export function makeDoc(body: IRChapter[], rest: Partial<IRDoc> = {}): IRDoc {
  return {
    schemaVersion: 1,
    meta: completeMeta(),
    front: { foreword: [], introduction: [] },
    body,
    appendices: [],
    bibliography: [],
    ...rest,
  }
}

/** 只含一个章一个段落的最小文档。 */
export function minimalDoc(...content: Array<string | IRInline>): IRDoc {
  return makeDoc([chapter('ch1', '范围', [para('p1', ...content)], 'scope')])
}

export function labelsOf(doc: IRDoc) {
  return resolve(doc).labels
}

/** 调用 `exportXml46687`（labels 来自 Resolver）。 */
export function exportDoc(doc: IRDoc, options: RenderXml46687Options = EMPTY_OPTIONS): Xml46687ExportResult {
  return exportXml46687(doc, labelsOf(doc), options)
}

/** 导出并要求成功（`xml` 非空且没有 error）；返回 XML 与问题。 */
export function renderOk(doc: IRDoc, options: RenderXml46687Options = EMPTY_OPTIONS): { xml: string; problems: Xml46687Problem[] } {
  const result = exportDoc(doc, options)
  const errors = result.problems.filter((problem) => problem.severity === 'error')
  if (result.xml === null || errors.length > 0) {
    throw new Error(`期望导出成功，但有 error：\n${errors.map((problem) => `${problem.code} ${problem.path}: ${problem.message}`).join('\n')}`)
  }
  return { xml: result.xml, problems: result.problems }
}

/** 取 `<body>` 与 `</body>` 之间的片段，便于断言。 */
export function bodyOf(xml: string): string {
  const start = xml.indexOf('<body>')
  const end = xml.indexOf('</body>')
  if (start < 0 || end < 0) throw new Error('XML 中没有 body')
  return xml.slice(start + '<body>'.length, end)
}

/** 取第一个 `<tag ...>...</tag>` 的整段文本（不处理嵌套同名元素，仅供测试断言用）。 */
export function elementText(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</${tag}>)`).exec(xml)
  return match?.[0]
}

export function codesOf(problems: readonly Xml46687Problem[], severity?: Xml46687Problem['severity']): string[] {
  return problems.filter((problem) => severity === undefined || problem.severity === severity).map((problem) => problem.code)
}

export function find(problems: readonly Xml46687Problem[], code: string): Xml46687Problem[] {
  return problems.filter((problem) => problem.code === code)
}

/**
 * 直接用渲染上下文渲染一段行内数组（不经过块渲染）：目标对象（表、图、公式、术语、文献……）只需存在于 `doc` 里，
 * 不必真的被渲染——这样 T2.4a 的 xref 映射能对 T2.4b/T2.4c 才实现的目标种类做测试。
 * 返回 `p` 内容的 XML 片段（相邻文本不缩进）与渲染期间收集的问题（含聚合问题）。
 */
export function renderRuns(
  doc: IRDoc,
  runs: IRInline[],
  container: InlineContainer = 'p',
  options: RenderXml46687Options = EMPTY_OPTIONS,
  labels: Record<NodeId, ResolvedLabel> = labelsOf(doc),
): { xml: string; problems: Xml46687Problem[]; ctx: RenderContext } {
  const session = createRenderSession(doc, labels, options)
  const nodes = session.ctx.renderInlines(runs, site('doc.test.content', 'test-owner'), container)
  session.flushMerged()
  const text = writeXml({ root: el('r', undefined, nodes) }, { namespaces: XML46687_NAMESPACES, indent: null })
  const xml = text.replace(/^[\s\S]*?<r[^>]*?(?:\/>|>)/, '').replace(/<\/r>\n?$/, '')
  return { xml, problems: session.ctx.problems, ctx: session.ctx }
}

/** 递归冻结（7.3：不修改输入）。 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export type { IRBlock }
