/**
 * 行内内容：run 模型、mark 嵌套序与合并、容器内容模型、xref/fn/ext-link（WP8.2 设计 §2.3、§2.11）。
 *
 * 一个 `IRInline` 不是“一个标记一个元素”：它可同时带正文、marks，以及不受 marks 影响的**原子**（行内公式、条文脚注、
 * 表脚注上标、行内图）。顺序与 HTML 渲染器、`irToPm` 一致：**正文在前，随后依次是公式、条文脚注、各表脚注上标、行内图；
 * 原子不被正文的 marks 包裹**（§2.3.1）。
 *
 * marks 按固定的嵌套全序构建（rank 小者在外，§2.3.2，由 `validate.py --profile export` 对 31 个组合实测得出）：
 * mixedCitation(0) → 链接类 externalLink/crossRef/bibRef/termRef(1) → variable(2) → bold(3) italic(4) underline(5)
 * strike(6) sup(7) sub(8) → code(9) → stdRef(10)。相邻 run 按最长公共前缀共享外层元素，所以合并是纯函数。
 *
 * 容器（§2.3.3）决定哪些 mark/原子能写出：纯文本容器（`subsup`、`text`）里的 mark 被丢弃并给 warning
 * `mark-dropped-in-text-only`，公式/行内图是 error `formula-in-text-only`；其他容器里不允许的 mark 是 error
 * `xml-mark-combination`。换行：`inline/citation/tbx` 里写 `<break/>`（格式元素与链接元素内部不含 `break`，所以先收起它们），
 * 其余容器改为空格并给 warning `newline-flattened`；`code` mark 的文本原样保留换行。
 */

import type { IRInline, IRMark, NodeId } from '../../ir/types'
import { xmlText, type XmlElement, type XmlNode } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { appendNode, el, sub, type InlineContainer, type RenderContext, type Site } from './context'
import { renderInlineImage } from './figures'
import { renderInlineFormula } from './formulas'
import { TARGET_DESCRIPTION, resolverKindOf, xrefTypeOf, xrefUsesRunText } from './targets'

/**
 * 放行（设计 §1.3.3）：mark 类型 strike/code/variable/externalLink/bibRef/termRef/stdRef/mixedCitation；mark 字段
 * `href/title/target/rel`（externalLink）与 `kind/name`（variable）；行内公式（`:237` 的提前拦截对 XML46687 取消，
 * 纯文本容器里的公式由渲染器报 `formula-in-text-only`）。行内 `style`（颜色、字号……）仍阻断（D-S-06）。
 */
export const XML46687_INLINE_BOUNDARY: Xml46687BoundaryContribution = {
  marks: ['strike', 'code', 'variable', 'externalLink', 'bibRef', 'termRef', 'stdRef', 'mixedCitation'],
  fields: { mark: ['href', 'title', 'target', 'rel', 'kind', 'name'] },
  declared: [
    { pathSuffix: 'marks.type', kind: 'markType', name: 'strike', matrixIds: ['M-5.1-04'], task: 'T2.4a', reason: '删除线写成 strike（5.1）' },
    { pathSuffix: 'marks.type', kind: 'markType', name: 'code', matrixIds: ['M-5.10-02'], task: 'T2.4a', reason: '行内代码写成 inline-code（5.10）' },
    { pathSuffix: 'marks.type', kind: 'markType', name: 'variable', matrixIds: ['M-5.5-01', 'M-5.5-02'], task: 'T2.4a', reason: '变量符号写成 named-content[@content-type="variable"]（5.5）' },
    { pathSuffix: 'marks.type', kind: 'markType', name: 'externalLink', matrixIds: ['M-10.1.9-01', 'M-10.1.9-02'], task: 'T2.4a', reason: '外部链接写成 ext-link（10.1.9）' },
    { pathSuffix: 'marks.type', kind: 'markType', name: 'bibRef', matrixIds: ['M-10.1.6-01'], task: 'T2.4a', reason: '参考文献引用写成 xref[@ref-type="bibr"]（10.1.6）' },
    { pathSuffix: 'marks.type', kind: 'markType', name: 'termRef', matrixIds: ['M-9.2.6-01', 'M-9.2.6-02'], task: 'T2.4a', reason: '术语引用写成 xref 或 tbx:entailedTerm（9.2.6）' },
    { pathSuffix: 'marks.type', kind: 'markType', name: 'stdRef', matrixIds: ['M-10.2-01', 'M-10.2-02'], task: 'T2.4a', reason: '正文标准引用写成 std/std-ref（10.2）' },
    { pathSuffix: 'marks.type', kind: 'markType', name: 'mixedCitation', matrixIds: ['M-10.1.7-01'], task: 'T2.4a', reason: '正文非标准化文件引用写成 mixed-citation（10.1.7）' },
    { pathSuffix: 'marks.href', kind: 'field', name: 'href', matrixIds: ['M-10.1.9-01'], task: 'T2.4a', reason: 'ext-link/@xlink:href（V-11 协议白名单由渲染器预检）' },
    { pathSuffix: 'marks.title', kind: 'field', name: 'title', matrixIds: ['M-10.1.9-02'], task: 'T2.4a', reason: '无对应 STS 属性：放行并报 link-attr-not-expressed（D-X-04）' },
    { pathSuffix: 'marks.target', kind: 'field', name: 'target', matrixIds: ['M-10.1.9-02'], task: 'T2.4a', reason: '无对应 STS 属性：放行并报 link-attr-not-expressed（D-X-04）' },
    { pathSuffix: 'marks.rel', kind: 'field', name: 'rel', matrixIds: ['M-10.1.9-02'], task: 'T2.4a', reason: '无对应 STS 属性：放行并报 link-attr-not-expressed（D-X-04）' },
    { pathSuffix: 'marks.kind', kind: 'field', name: 'kind', matrixIds: ['M-5.5-02'], task: 'T2.4a', reason: '变量 kind 无对应属性：放行并报 variable-attr-not-expressed（D-X-04）' },
    { pathSuffix: 'marks.name', kind: 'field', name: 'name', matrixIds: ['M-5.5-02'], task: 'T2.4a', reason: '变量 name 无对应属性：放行并报 variable-attr-not-expressed（D-X-04）' },
    { pathSuffix: '.formula', kind: 'field', name: 'formula', matrixIds: ['M-7.1-04', 'M-7.1-05'], task: 'T2.4a', reason: '行内公式不再被提前拦截（outputBoundary.ts :237）；文本型容器内的公式由渲染器报 formula-in-text-only' },
  ],
}

// ---------------------------------------------------------------------------
// 容器能力
// ---------------------------------------------------------------------------

interface Capabilities {
  /** `true`：全部格式 mark；`'subsup'`：仅 sup/sub。 */
  format: boolean | 'subsup'
  variable: boolean
  code: boolean
  stdRef: boolean
  mixedCitation: boolean
  externalLink: boolean
  /** `xref`（crossRef/bibRef/termRef/tableFootnoteRef）。 */
  xref: boolean
  formula: boolean
  footnote: boolean
  image: boolean
  break: boolean
  /** 纯文本容器：不允许的 mark 丢弃并告警，而不是报错。 */
  textOnly: boolean
  /** 可用 `tbx:entailedTerm`。 */
  entailed: boolean
}

const INLINE_CAPS: Capabilities = {
  format: true, variable: true, code: true, stdRef: true, mixedCitation: true, externalLink: true, xref: true,
  formula: true, footnote: false, image: true, break: true, textOnly: false, entailed: false,
}
const NONE_CAPS: Capabilities = {
  format: false, variable: false, code: false, stdRef: false, mixedCitation: false, externalLink: false, xref: false,
  formula: false, footnote: false, image: false, break: false, textOnly: false, entailed: false,
}
/** 设计 §2.3.3 的表。 */
const CAPABILITIES: Record<InlineContainer, Capabilities> = {
  p: { ...INLINE_CAPS, footnote: true },
  inline: INLINE_CAPS,
  tbx: { ...INLINE_CAPS, entailed: true },
  term: { ...NONE_CAPS, format: true, variable: true, code: true, externalLink: true, xref: true, formula: true, image: true },
  phrase: { ...NONE_CAPS, format: true, variable: true, code: true, image: true },
  label: { ...NONE_CAPS, format: true, variable: true, code: true, xref: true, formula: true, image: true },
  citation: { ...INLINE_CAPS, mixedCitation: false },
  subsup: { ...NONE_CAPS, format: 'subsup', textOnly: true },
  text: { ...NONE_CAPS, textOnly: true },
}

// ---------------------------------------------------------------------------
// 包装器（mark → 元素）
// ---------------------------------------------------------------------------

const FORMAT_MARKS = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub'] as const
type FormatMark = typeof FORMAT_MARKS[number]
/** 嵌套全序（设计 §2.3.2）。 */
const RANK = { mixedCitation: 0, link: 1, variable: 2, bold: 3, italic: 4, underline: 5, strike: 6, sup: 7, sub: 8, code: 9, stdRef: 10 } as const

interface Wrapper {
  rank: number
  /** 前缀判等的键：元素名相同且属性相同（§2.3.2 合并规则）。 */
  key: string
  /** 创建元素；`outer` 接在父级下，子内容写入 `inner`（`std/std-ref` 两层，其余同一个）。 */
  open(): { outer: XmlElement; inner: XmlElement }
}

function simpleWrapper(rank: number, key: string, make: () => XmlElement): Wrapper {
  return { rank, key, open: () => { const element = make(); return { outer: element, inner: element } } }
}

const ALLOWED_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'ftp'])
// eslint-disable-next-line no-control-regex
const C0_CONTROL = /[\u0000-\u001f\u007f]/
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/

/** 与 `validate.py` 的 `url_value_problem`（V-11）同口径：控制字符一律拒绝；有协议时须在白名单内，相对地址不限。 */
export function urlProblem(href: string): string | undefined {
  const control = C0_CONTROL.exec(href)
  if (control) return `含控制字符 U+${control[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}（浏览器会删掉 tab、换行等控制字符，从而绕过协议白名单）`
  const scheme = SCHEME.exec(href.trim())
  if (scheme && !ALLOWED_LINK_SCHEMES.has(scheme[1]!.toLowerCase())) {
    return `使用了不允许的协议「${scheme[1]}」（只接受 ${[...ALLOWED_LINK_SCHEMES].sort().join('、')}）`
  }
  return undefined
}

type LinkMark = Extract<IRMark, { type: 'externalLink' | 'crossRef' | 'bibRef' | 'termRef' }>
function isLinkMark(mark: IRMark): mark is LinkMark {
  return mark.type === 'externalLink' || mark.type === 'crossRef' || mark.type === 'bibRef' || mark.type === 'termRef'
}

interface LinkPlan {
  wrapper: Wrapper
  /** 引用内容取代 run 文本（Resolver 的 `refText`）；缺省时用 run 自己的文本。 */
  replaceText?: string
}

/** 把链接类 mark 解析为包装器；失败时已报告问题并返回 undefined（该 run 按无链接输出）。 */
function planLink(ctx: RenderContext, mark: LinkMark, at: Site, caps: Capabilities): LinkPlan | undefined {
  if (mark.type === 'externalLink') {
    const href = typeof mark.href === 'string' ? mark.href.trim() : ''
    const problem = href === '' ? '地址为空' : urlProblem(mark.href)
    if (problem) {
      ctx.report('xml-link-protocol', 'error', `外部链接「${mark.href ?? ''}」不能导出：${problem}。`, at)
      return undefined
    }
    for (const attribute of ['title', 'target', 'rel'] as const) {
      const value = mark[attribute]
      if (typeof value === 'string' && value !== '') {
        ctx.report('link-attr-not-expressed', 'warning', `外部链接的 ${attribute}「${value}」在 GB/T 46687.2 中没有对应属性，未导出。`, at)
      }
    }
    return { wrapper: simpleWrapper(RANK.link, `ext-link|${href}`, () => el('ext-link', { 'ext-link-type': 'uri', 'xlink:href': href })) }
  }

  const targetId: NodeId = mark.targetId
  const info = ctx.targets.get(targetId)
  const label = ctx.labelOf(targetId)
  const kindName = mark.type === 'bibRef' ? '参考文献引用' : mark.type === 'termRef' ? '术语引用' : '交叉引用'
  if (!info) {
    if (label) ctx.report('xml-xref-target-unsupported', 'error', `${kindName}的目标「${targetId}」是没有 id 方案的对象，不能写成 xref。`, at)
    else ctx.report('xml-xref-target-missing', 'error', `${kindName}的目标「${targetId}」在文档中不存在。`, at)
    return undefined
  }
  const described = TARGET_DESCRIPTION[info.kind]
  if (mark.type === 'bibRef' && info.kind !== 'bibEntry') {
    ctx.report('xml-xref-target-unsupported', 'error', `参考文献引用的目标「${targetId}」是${described}，不是参考文献条目。`, at)
    return undefined
  }
  if (mark.type === 'termRef' && info.kind !== 'termEntry') {
    ctx.report('xml-xref-target-unsupported', 'error', `术语引用的目标「${targetId}」是${described}，不是术语条目。`, at)
    return undefined
  }
  if (mark.type === 'crossRef' && mark.targetKind !== undefined && mark.targetKind !== resolverKindOf(info)) {
    ctx.report('xml-xref-target-unsupported', 'error', `交叉引用声明目标为「${mark.targetKind}」，实际是${described}（${targetId}）。`, at)
    return undefined
  }
  const type = xrefTypeOf(info)
  if (!type) {
    ctx.report('xml-xref-target-unsupported', 'error', `${kindName}的目标「${targetId}」是${described}${info.kind === 'formula' ? '（无编号公式没有 id）' : ''}，GB/T 46687.2 没有对应的 ref-type，不能写成 xref。`, at)
    return undefined
  }

  let rid: string | undefined
  if (info.kind === 'index') rid = 'sec_index'
  else if (info.kind === 'termEntry') rid = label?.termEntryXmlId
  else rid = label?.xmlId
  if (rid === undefined || rid === '') {
    if (info.kind === 'listItem') ctx.report('xml-xref-target-unsupported', 'error', `引用的列项「${targetId}」没有标识（无序列项、大写罗马列项或嵌套层次没有标记的列项不能被引用）。`, at)
    else ctx.report('xml-xref-target-missing', 'error', `${kindName}的目标「${targetId}」在 labels 中没有 id，无法写出 rid。`, at)
    return undefined
  }

  const replaceText = xrefUsesRunText(info) ? undefined : (label?.refText || undefined)
  if (info.kind === 'termEntry' && caps.entailed) {
    const entailedRid = rid
    return {
      wrapper: simpleWrapper(RANK.link, `entailed|${entailedRid}`, () => {
        ctx.emitRef(targetId)
        return el('tbx:entailedTerm', { target: entailedRid })
      }),
      ...(replaceText === undefined ? {} : { replaceText }),
    }
  }
  const xrefRid = rid
  return {
    wrapper: simpleWrapper(RANK.link, `xref|${type.refType}|${type.customType ?? ''}|${xrefRid}`, () => {
      ctx.emitRef(targetId)
      return el('xref', { 'ref-type': type.refType, 'custom-type': type.customType, rid: xrefRid })
    }),
    ...(replaceText === undefined ? {} : { replaceText }),
  }
}

// ---------------------------------------------------------------------------
// run 处理
// ---------------------------------------------------------------------------

interface OpenWrapper { key: string; outer: XmlElement; inner: XmlElement }

interface RunResult {
  wrappers: Wrapper[]
  /** 正文（交叉引用时已换成 `refText`）。 */
  text: string
  /** 正文里的 `\n` 原样保留（`code` mark）。 */
  verbatim: boolean
  /** 本 run 正文被引用文本取代，键 = 链接包装器的键（用于相邻同目标 run 只写一次）。 */
  replacedBy: string | undefined
  atoms: XmlNode[]
}

function uniqueFormats(marks: readonly IRMark[]): FormatMark[] {
  const present = new Set(marks.map((mark) => mark.type))
  return FORMAT_MARKS.filter((name) => present.has(name))
}

function processRun(ctx: RenderContext, run: IRInline, at: Site, container: InlineContainer): RunResult {
  const caps = CAPABILITIES[container]
  const marks = run.marks ?? []
  const dropped: string[] = []
  const combination = (message: string): void => ctx.report('xml-mark-combination', 'error', message, at)
  /** 容器不允许某类 mark：纯文本容器丢弃并告警，其余报错；返回是否可用。 */
  const permit = (ok: boolean, name: string): boolean => {
    if (ok) return true
    if (caps.textOnly) dropped.push(name)
    else combination(`行内容器「${container}」不允许此处的 ${name} 标记（设计 §2.3.3）。`)
    return false
  }

  let links = marks.filter(isLinkMark)
  if (links.length > 1) {
    combination(`同一行内文本上有 ${links.length} 个链接类标记（${links.map((mark) => mark.type).join('、')}），XML 中 xref 与 ext-link 互不包含，无法同时表达。`)
    links = links.slice(0, 1)
  }
  let variable = marks.find((mark): mark is Extract<IRMark, { type: 'variable' }> => mark.type === 'variable')
  let code = marks.some((mark) => mark.type === 'code')
  let mixed = marks.some((mark) => mark.type === 'mixedCitation')
  let std = marks.some((mark) => mark.type === 'stdRef')
  if (std && (mixed || links.length > 0 || variable !== undefined || code)) {
    combination('正文标准引用（stdRef）不能与非标准化文件引用、链接、变量符号或代码标记同时出现：std/std-ref 只能含文本，且与 xref/ext-link 互不包含。')
    std = false
  }

  const wrappers: Wrapper[] = []
  let replaceText: string | undefined
  let replacedBy: string | undefined

  if (mixed && !permit(caps.mixedCitation, 'mixedCitation')) mixed = false
  if (mixed) wrappers.push(simpleWrapper(RANK.mixedCitation, 'mixed-citation', () => el('mixed-citation')))

  for (const link of links) {
    const allowed = link.type === 'externalLink' ? caps.externalLink : caps.xref
    if (!permit(allowed, link.type)) continue
    const plan = planLink(ctx, link, at, caps)
    if (!plan) continue
    wrappers.push(plan.wrapper)
    if (plan.replaceText !== undefined) { replaceText = plan.replaceText; replacedBy = plan.wrapper.key }
  }
  // 纯文本容器丢弃了交叉引用时，仍保留 Resolver 的引用文本（与 HTML 渲染器同口径）
  if (caps.textOnly && replaceText === undefined) {
    const dropLink = links.find((link): link is Extract<LinkMark, { targetId: NodeId }> => link.type !== 'externalLink')
    if (dropLink) {
      const info = ctx.targets.get(dropLink.targetId)
      const refText = ctx.labelOf(dropLink.targetId)?.refText
      if (info && !xrefUsesRunText(info) && refText) replaceText = refText
    }
  }

  if (variable && !permit(caps.variable, 'variable')) variable = undefined
  if (variable) {
    const current = variable
    if ((typeof current.kind === 'string' && current.kind !== '') || (typeof current.name === 'string' && current.name !== '')) {
      ctx.report('variable-attr-not-expressed', 'warning', '变量符号的 kind/name 在 GB/T 46687.2 中没有对应属性，未导出（named-content 只有 content-type="variable"）。', at)
    }
    wrappers.push(simpleWrapper(RANK.variable, `variable|${current.kind ?? ''}|${current.name ?? ''}`, () => el('named-content', { 'content-type': 'variable' })))
  }

  for (const name of uniqueFormats(marks)) {
    const ok = caps.format === true || (caps.format === 'subsup' && (name === 'sup' || name === 'sub'))
    if (!permit(ok, name)) continue
    wrappers.push(simpleWrapper(RANK[name], name, () => el(name)))
  }

  if (code && !permit(caps.code, 'code')) code = false
  if (code) wrappers.push(simpleWrapper(RANK.code, 'inline-code', () => el('inline-code')))

  if (std && !permit(caps.stdRef, 'stdRef')) std = false
  if (std) {
    wrappers.push({
      rank: RANK.stdRef, key: 'std',
      open: () => { const inner = el('std-ref'); return { outer: el('std', undefined, [inner]), inner } },
    })
  }
  wrappers.sort((a, b) => a.rank - b.rank)

  // 原子：公式 → 条文脚注 → 各表脚注上标 → 行内图
  const atoms: XmlNode[] = []
  if (run.formula) {
    if (caps.formula) atoms.push(renderInlineFormula(run.formula, sub(at, '.formula', run.formula.id), ctx))
    else if (caps.textOnly) ctx.report('formula-in-text-only', 'error', '此处只能容纳纯文本，行内公式的内容会丢失，不能导出。', sub(at, '.formula', run.formula.id))
    else combination(`行内容器「${container}」不允许行内公式（设计 §2.3.3）。`)
  }
  if (run.footnote) atoms.push(...renderFootnoteAtom(ctx, run, at, caps))
  for (const mark of marks) {
    if (mark.type !== 'tableFootnoteRef') continue
    if (!permit(caps.xref, 'tableFootnoteRef')) continue
    const label = ctx.labelOf(mark.targetId)
    if (!label || label.xmlId === '') {
      ctx.report('xml-label-missing', 'error', `表脚注上标的目标「${mark.targetId}」在 labels 中没有 xmlId。`, at)
      continue
    }
    ctx.emitRef(mark.targetId)
    atoms.push(el('xref', { 'ref-type': 'table-fn', rid: label.xmlId }, [label.refText]))
  }
  if (run.image) {
    if (caps.image) atoms.push(renderInlineImage(run.image, sub(at, '.image'), ctx))
    else if (caps.textOnly) ctx.report('formula-in-text-only', 'error', '此处只能容纳纯文本，行内图会丢失，不能导出。', sub(at, '.image'))
    else combination(`行内容器「${container}」不允许行内图（设计 §2.3.3）。`)
  }

  if (dropped.length > 0) {
    ctx.report('mark-dropped-in-text-only', 'warning', `此处只能容纳纯文本，已丢弃 ${[...new Set(dropped)].join('、')} 标记，文字保留。`, at)
  }
  return {
    wrappers,
    text: replaceText ?? run.text,
    verbatim: wrappers.some((wrapper) => wrapper.key === 'inline-code'),
    replacedBy,
    atoms,
  }
}

/** 条文脚注（§2.3.5）：`xref[@ref-type="fn"]` 紧随 `fn`，同一个 `p` 内（D-M-01）。 */
function renderFootnoteAtom(ctx: RenderContext, run: IRInline, at: Site, caps: Capabilities): XmlElement[] {
  const footnote = run.footnote!
  const here = sub(at, '.footnote', footnote.id)
  if (!caps.footnote) {
    ctx.report('xml-footnote-position', 'error', '条文脚注只能写在正文段落（p）内，此处（标题、单元格、术语、文献等）不能放脚注。', here)
    return []
  }
  const label = ctx.labelOf(footnote.id)
  if (!label || label.xmlId === '') {
    ctx.report('xml-label-missing', 'error', `条文脚注「${footnote.id}」在 labels 中没有 xmlId。`, here)
    return []
  }
  ctx.emitRef(footnote.id)
  return [
    el('xref', { 'ref-type': 'fn', rid: label.xmlId }, [label.refText]),
    el('fn', { id: label.xmlId }, [
      el('label', undefined, [el('sup', undefined, [label.refText])]),
      el('p', undefined, ctx.renderInlines(footnote.content, sub(here, '.content', footnote.id), 'inline')),
    ]),
  ]
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 把一个行内数组渲染为节点序列（设计 §2.3）。`at.path` 是数组的路径；问题的 `nodeId` 取 `at.nodeId`（所属块）。
 * 纯函数（对同一输入逐字节相同）；不修改入参。
 */
export function renderInlines(ctx: RenderContext, runs: readonly IRInline[], at: Site, container: InlineContainer): XmlNode[] {
  const caps = CAPABILITIES[container]
  const root: XmlNode[] = []
  const stack: OpenWrapper[] = []
  /** 上一个 run 写出了引用文本时的链接键；相邻且同目标的 run 只写一次 refText。 */
  let previousReplacedBy: string | undefined

  const parentChildren = (): XmlNode[] => (stack.length > 0 ? stack[stack.length - 1]!.inner.children : root)
  const writeText = (wrappers: Wrapper[], value: string): void => {
    let shared = 0
    while (shared < stack.length && shared < wrappers.length && stack[shared]!.key === wrappers[shared]!.key) shared += 1
    stack.length = shared
    for (let index = shared; index < wrappers.length; index += 1) {
      const wrapper = wrappers[index]!
      const opened = wrapper.open()
      appendNode(parentChildren(), opened.outer)
      stack.push({ key: wrapper.key, outer: opened.outer, inner: opened.inner })
    }
    appendNode(parentChildren(), xmlText(value))
  }
  /** `break` 不能在格式/链接元素内部（cm.mark/cm.phrase 不含 break）：先收起它们，只保留最外层的 mixed-citation。 */
  const writeBreak = (): void => {
    stack.length = stack.length > 0 && stack[0]!.key === 'mixed-citation' ? 1 : 0
    appendNode(parentChildren(), el('break'))
  }

  runs.forEach((run, index) => {
    const runSite = sub(at, `[${index}]`)
    const result = processRun(ctx, run, runSite, container)
    const skipText = result.replacedBy !== undefined && result.replacedBy === previousReplacedBy
    if (result.text !== '' && !skipText) {
      if (result.verbatim) {
        writeText(result.wrappers, result.text)
      } else if (result.replacedBy !== undefined) {
        // 引用文本是 Resolver 产生的整体，不含换行
        writeText(result.wrappers, result.text.replace(/\n/g, ' '))
      } else if (!result.text.includes('\n')) {
        writeText(result.wrappers, result.text)
      } else if (caps.break) {
        result.text.split('\n').forEach((part, position) => {
          if (position > 0) writeBreak()
          if (part !== '') writeText(result.wrappers, part)
        })
      } else {
        ctx.report('newline-flattened', 'warning', '此处不允许换行元素（break），文本中的换行已改为空格。', runSite)
        writeText(result.wrappers, result.text.replace(/\n/g, ' '))
      }
    }
    previousReplacedBy = result.replacedBy !== undefined ? result.replacedBy : undefined
    if (result.atoms.length > 0) {
      stack.length = 0
      for (const atom of result.atoms) appendNode(root, atom)
      previousReplacedBy = undefined
    }
  })
  return root
}
