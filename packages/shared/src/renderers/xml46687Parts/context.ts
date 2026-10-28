/**
 * XML46687 渲染上下文与构造辅助（WP8.2 设计 §2.0、§3、§4.2；T2.4a-1）。
 *
 * 本文件是各领域模块（structure/inline/blocks/meta 与 T2.4b/T2.4c 的 tables/figures/formulas/terms/refs）
 * 共同依赖的**唯一**公共面：
 * - `RenderContext`：渲染期间的只读输入（`doc/labels/options`）、P1 预扫描结果、问题收集（`report`/`reportMerged`）、
 *   “仅被引用时写 id”的登记（`registerPendingId`/`emitRef`，§3.2）、以及由 `dispatch.ts` 装配的渲染入口
 *   （`renderInlines`/`renderBlocks`/`renderBlock`/`renderSectionContent`），领域模块只通过 ctx 调用彼此，不互相 import；
 * - `Site`：问题定位（IR 路径 + 所属节点），路径写法与 `getOutputSupportProblems` 相同；
 * - 元素构造 `el`：属性按设计 §2.0.2-3 的固定次序写出，文本相邻合并、空串不生成节点。
 *
 * 同构纯 TypeScript，无 DOM/Node API；本文件对 `../xml46687` 只做类型引用（避免与管线入口循环依赖）。
 */

import type {
  IRAppendix, IRBlock, IRChapter, IRClauseChild, IRDoc, IRInline, NodeId, ResolvedLabel,
} from '../../ir/types'
import type { Xml46687ImageRef } from '../../xml46687/resources'
import {
  MATHML_NS, XLINK_NS, qname, xmlAttr, xmlElement, xmlText,
  type XmlAttr, type XmlElement, type XmlName, type XmlNode,
} from '../../xml46687/tree'
import type { RenderXml46687Options, Xml46687Problem, Xml46687ProblemCode, Xml46687Severity } from '../xml46687'

export const TBX_NS = 'urn:iso:std:iso:30042:ed-1'
export const XML_NS = 'http://www.w3.org/XML/1998/namespace'
/** `writeXml` 的命名空间声明：写在根上，前缀字典序（设计 §2.0.2-1）。 */
export const XML46687_NAMESPACES: Readonly<Record<string, string>> = { mml: MATHML_NS, tbx: TBX_NS, xlink: XLINK_NS }

// ---------------------------------------------------------------------------
// 定位与问题
// ---------------------------------------------------------------------------

/** 问题的定位：IR 路径（与输出边界同写法，如 `doc.body[0].children[2].content[1]`）+ 所属节点 id。 */
export interface Site {
  path: string
  nodeId?: NodeId
}

export function site(path: string, nodeId?: NodeId): Site {
  return nodeId === undefined ? { path } : { path, nodeId }
}

/** 在 `base` 的路径后追加片段（`.children`、`[3]`、`.content[1]`……）；`nodeId` 缺省沿用 `base` 的。 */
export function sub(base: Site, suffix: string, nodeId?: NodeId): Site {
  const id = nodeId ?? base.nodeId
  return id === undefined ? { path: base.path + suffix } : { path: base.path + suffix, nodeId: id }
}

// ---------------------------------------------------------------------------
// 行内容器、P1 目标表
// ---------------------------------------------------------------------------

/**
 * 行内容器（设计 §2.3.3）：决定一个 run 里哪些 mark/原子可以写出。
 * `p` 是 `inline` 内容模型且允许条文脚注；`citation`（`mixed-citation` 内，含规范性引用与参考文献条目）同样允许条文脚注
 * （D-M-01，主导决定 2026-10-27）——脚注只写在这两种容器的最外层；`tbx` 是 `inline` 另加 `tbx:entailedTerm`。
 */
export type InlineContainer = 'p' | 'inline' | 'tbx' | 'term' | 'phrase' | 'label' | 'citation' | 'subsup' | 'text'

/** 目标对象的真实种类（P1 预扫描，设计 §2.11）。 */
export type TargetKind =
  | 'chapter' | 'clause' | 'appendix'
  | 'table' | 'figure' | 'formula' | 'inlineFormula'
  | 'note' | 'example' | 'termNote' | 'termExample'
  | 'listItem' | 'abbreviation' | 'termEntry' | 'bibEntry' | 'index'
  | 'paragraph' | 'code' | 'warning' | 'quote' | 'normRef' | 'legendItem' | 'whereItem' | 'indexEntry'

export interface TargetInfo {
  kind: TargetKind
  /** 块公式是否有编号（无编号公式没有 id，不可引用）。 */
  numbered?: boolean
  /** 列项是否为有序列项（只有有序项有标记与 `li_<k>`）。 */
  ordered?: boolean
}

/** 当前正在渲染的结构位置，供领域模块判断“术语条是否在术语章内”等。 */
export interface RenderScope {
  chapter?: IRChapter
  appendix?: IRAppendix
  /** 正在渲染引言（含引言条）。 */
  introduction: boolean
}

// ---------------------------------------------------------------------------
// 渲染上下文
// ---------------------------------------------------------------------------

export interface RenderContext {
  readonly doc: IRDoc
  readonly labels: Readonly<Record<NodeId, ResolvedLabel>>
  readonly options: RenderXml46687Options
  /** P1：每个可被引用对象的真实种类。 */
  readonly targets: ReadonlyMap<NodeId, TargetInfo>
  /** P1：有序列项标记（`computeOrderedListMarkers` 默认策略；全角括号，写入前由 blocks.ts 转半角）。 */
  readonly orderedMarkers: Readonly<Record<NodeId, string>>
  /** P1：`collectXml46687ImageRefs` 的结果（块图与行内图的 `href`）。 */
  readonly imageRefs: readonly Xml46687ImageRef[]
  readonly problems: Xml46687Problem[]
  readonly scope: RenderScope

  /** 记录一个问题；`at.path` 是 IR 路径，不是 XML 路径。 */
  report(code: Xml46687ProblemCode, severity: Xml46687Severity, message: string, at: Site): void
  /**
   * 记录“聚合”问题（设计 §4.4）：同一文档内同一 `code` 合并为一条，消息列出个数与前 3 处，在 P2 结束时统一写入。
   * `title` 取第一次调用的值；`detail` 是本处的简短说明。
   */
  reportMerged(code: Xml46687ProblemCode, severity: Xml46687Severity, title: string, detail: string, at: Site): void

  /** 只读取标签：`labels[id]`（自有属性），不存在返回 undefined。 */
  labelOf(id: NodeId): ResolvedLabel | undefined
  /** 取 `labels[id].xmlId`；缺失或为空时报 `xml-label-missing` 并返回 undefined。 */
  xmlIdOf(id: NodeId, at: Site, what: string): string | undefined

  /**
   * 登记“仅被引用时写 id”的元素（设计 §3.2）：P3 时若 `emitRef(nodeId)` 被调用过，则给 `element` 补写
   * `id=labels[nodeId].xmlId`（置于第一个属性）。注、示例、被引用的有序列项、缩略语项、术语注都走这里。
   */
  registerPendingId(nodeId: NodeId, element: XmlElement, at?: Site): void
  /** 登记一次实际写出的引用（`xref`/`tbx:entailedTerm`）。 */
  emitRef(nodeId: NodeId): void
  /** 全文计数器（`df_<k>` 等渲染器自有序号），每次调用加一并返回；从 1 起。 */
  nextCount(name: string): number

  /** 把一个行内数组渲染为节点序列；`at.path` 是该数组的路径，第 i 个 run 的路径为 `${path}[i]`。 */
  renderInlines(runs: readonly IRInline[], at: Site, container: InlineContainer): XmlNode[]
  /** 渲染一个块；`at.path` 是该块自身的路径。 */
  renderBlock(block: IRBlock, at: Site): XmlElement[]
  /** 渲染块序列；`at.path` 是该数组的路径。 */
  renderBlocks(blocks: readonly IRBlock[], at: Site): XmlElement[]
  /**
   * 渲染 `sec`/`app` 的内容（设计 §2.2）：块、子条/术语条、尾部的注/示例/规范性引用清单，三态处理。
   * `at.path` 是 `children` 数组的路径。
   */
  renderSectionContent(children: readonly IRClauseChild[], at: Site): XmlElement[]
}

/** 领域桩尚未实现时抛出（T2.4b/T2.4c 替换函数体后不再出现）。 */
export function notImplemented(what: string, task: 'T2.4b' | 'T2.4c'): never {
  throw new Error(`${what} not implemented (${task})`)
}

// ---------------------------------------------------------------------------
// 元素构造
// ---------------------------------------------------------------------------

export type AttrValue = string | number | undefined | null | false
export type AttrMap = Readonly<Record<string, AttrValue>>
export type Child = XmlNode | string | null | undefined | false | readonly Child[]

/**
 * 属性次序（设计 §2.0.2-3）：`id` → `sec-type`/`content-type`/`list-type`/`ref-type`（及其他 *-type）→ `rid` → `orientation`
 * → `list-content` → `colspan` → `rowspan` → `align` → `valign` → `style` → `xlink:href` → `specific-use`；
 * 表中没有的属性排在最后，保持传入次序。
 */
const ATTR_ORDER: readonly string[] = [
  'id', 'sec-type', 'content-type', 'list-type', 'ref-type', 'ext-link-type', 'custom-type', 'type', 'date-type',
  'std-org-role', 'xml:lang', 'target', 'value', 'rid', 'orientation', 'list-content', 'colspan', 'rowspan',
  'align', 'valign', 'style', 'xlink:href', 'specific-use',
]
const ATTR_RANK = new Map(ATTR_ORDER.map((name, index) => [name, index]))

function attrName(key: string): XmlName {
  if (key.startsWith('xlink:')) return qname(XLINK_NS, key.slice(6), 'xlink')
  if (key.startsWith('xml:')) return qname(XML_NS, key.slice(4), 'xml')
  return { ns: null, local: key }
}

function attrKeyOf(attr: XmlAttr): string {
  if (attr.name.ns === XLINK_NS) return `xlink:${attr.name.local}`
  if (attr.name.ns === XML_NS) return `xml:${attr.name.local}`
  return attr.name.local
}

/** 按固定次序生成属性列表；`undefined/null/false/空串` 的属性不输出。 */
export function orderedAttrs(attrs: AttrMap | undefined): XmlAttr[] {
  if (!attrs) return []
  const entries = Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null && entry[1] !== false && entry[1] !== '')
    .map(([key, value], index) => ({ key, value: String(value), rank: ATTR_RANK.get(key) ?? 1000 + index }))
  entries.sort((a, b) => a.rank - b.rank)
  return entries.map(({ key, value }) => xmlAttr(attrName(key), value))
}

function elementName(name: string): XmlName {
  if (name.startsWith('tbx:')) return qname(TBX_NS, name.slice(4), 'tbx')
  if (name.startsWith('mml:')) return qname(MATHML_NS, name.slice(4), 'mml')
  return { ns: null, local: name }
}

/** 追加一个节点：空文本丢弃，与前一个文本节点合并。 */
export function appendNode(children: XmlNode[], node: XmlNode): void {
  if (node.type === 'text') {
    if (node.value === '') return
    const last = children[children.length - 1]
    if (last && last.type === 'text') { children[children.length - 1] = xmlText(last.value + node.value); return }
  }
  children.push(node)
}

/** 展开子节点：忽略 null/undefined/false，数组摊平，字符串变文本，相邻文本合并，空文本丢弃。 */
export function flattenChildren(children: readonly Child[] | undefined): XmlNode[] {
  const out: XmlNode[] = []
  const push = (child: Child): void => {
    if (child === null || child === undefined || child === false) return
    if (Array.isArray(child)) { for (const entry of child as readonly Child[]) push(entry); return }
    appendNode(out, typeof child === 'string' ? xmlText(child) : child as XmlNode)
  }
  push(children ?? [])
  return out
}

/**
 * 构造元素。`name` 可带前缀：`tbx:term`、`mml:math`；属性按固定次序输出（见 `ATTR_ORDER`），
 * `xlink:href`、`xml:lang` 自动带上命名空间。
 */
export function el(name: string, attrs?: AttrMap, children?: readonly Child[]): XmlElement {
  return xmlElement(elementName(name), orderedAttrs(attrs), flattenChildren(children))
}

/** 给元素补写属性：已有同名属性被覆盖；位置按固定次序（`id` 总是第一个）。 */
export function setAttr(element: XmlElement, key: string, value: string): void {
  const name = attrName(key)
  const existing = element.attrs.findIndex((attr) => attr.name.ns === name.ns && attr.name.local === name.local)
  if (existing >= 0) element.attrs.splice(existing, 1)
  const rank = ATTR_RANK.get(key) ?? 1000
  let at = element.attrs.length
  for (let index = 0; index < element.attrs.length; index += 1) {
    if ((ATTR_RANK.get(attrKeyOf(element.attrs[index]!)) ?? 1000) > rank) { at = index; break }
  }
  element.attrs.splice(at, 0, xmlAttr(name, value))
}

export function getAttr(element: XmlElement, key: string): string | undefined {
  const name = attrName(key)
  return element.attrs.find((attr) => attr.name.ns === name.ns && attr.name.local === name.local)?.value
}

export function removeAttr(element: XmlElement, key: string): void {
  const name = attrName(key)
  const index = element.attrs.findIndex((attr) => attr.name.ns === name.ns && attr.name.local === name.local)
  if (index >= 0) element.attrs.splice(index, 1)
}

/** 元素的“限定名”（用于消息与树遍历）：STS 元素原名，tbx/mml 带前缀。 */
export function qualifiedName(element: XmlElement): string {
  if (element.name.ns === TBX_NS) return `tbx:${element.name.local}`
  if (element.name.ns === MATHML_NS) return `mml:${element.name.local}`
  return element.name.local
}

// ---------------------------------------------------------------------------
// preserveSpace（设计 §2.0.2-5）
// ---------------------------------------------------------------------------

/** 行内元素集：含这些子元素的元素按混合内容逐字写出（不缩进）。 */
const INLINE_ELEMENTS = new Set([
  'bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'named-content', 'inline-code', 'inline-graphic', 'break',
  'xref', 'ext-link', 'fn', 'std', 'mixed-citation', 'inline-formula', 'uri', 'tbx:entailedTerm',
])
/** 子元素是 `std`/`mixed-citation`/`fn` 等“块位置的行内元素”的容器，不因此被当成混合内容。 */
const STRUCTURAL_PARENTS = new Set(['ref', 'table-wrap-foot'])
/** 总是逐字写出的元素（内容是文本或行内元素，不得被缩进空白污染）。 */
const VERBATIM_ELEMENTS = new Set([
  'std', 'p', 'title', 'label', 'code',
  'tbx:term', 'tbx:definition', 'tbx:example', 'tbx:note', 'tbx:source', 'tbx:subjectField',
])

/** `writeXml` 的 `preserveSpace`：判定看树结构，不依赖 IR（设计 §2.0.2-5）。 */
export function preserveSpace(element: XmlElement): boolean {
  const name = qualifiedName(element)
  if (VERBATIM_ELEMENTS.has(name)) return true
  if (STRUCTURAL_PARENTS.has(name)) return false
  return element.children.some((child) => child.type === 'text'
    ? child.value !== ''
    : child.type === 'element' && INLINE_ELEMENTS.has(qualifiedName(child)))
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 行内数组的纯文本（不含脚注与公式），供消息与判空使用。 */
export function inlinePlainText(runs: readonly IRInline[]): string {
  return runs.map((run) => run.text).join('')
}

/** 行内数组里是否有可输出的内容（文本、公式、脚注、行内图）。 */
export function inlineHasContent(runs: readonly IRInline[]): boolean {
  return runs.some((run) => run.text !== '' || run.formula !== undefined || run.footnote !== undefined || run.image !== undefined)
}
