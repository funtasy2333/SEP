/**
 * 公式（WP8.2 设计 §2.8、§4.5）。
 *
 * - 块公式 `disp-formula`：有编号带 `id`（`formula_<n>`）与 `label`（半角 `(1)`、`(A.1)`，不用显示层的全角），无编号既不写 `id`
 *   也不写 `label`（X-21）；子元素次序 `label`、`mml:math[@display="block"]`、公式注、`legend`（“式中：”+ `def-list[@list-content="formula"]`）；
 * - 行内公式 `inline-formula > mml:math`（无 `display`）；容器是否允许公式已由 inline.ts 判定（纯文本容器报 `formula-in-text-only`）；
 * - MathML 取 IR 的 `mathml`（优先，**不用 latex 重算**），否则 `options.mathml[公式 NodeId]`，都没有 → error `mathml-missing`；
 *   解析与规范化见 `mathml.ts`，不合约定 → error `mathml-invalid`（带公式 NodeId 与字符位置）；去掉 TeX 注释 → info `mathml-annotation-removed`；
 *   根上的 `id` 一律由 P3 的 `assignMathIds` 按输出文档序重写，`display` 由本文件按块/行内重写（输入里的值被丢弃）；
 * - 公式注 `non-normative-note`：`label` 取 Resolver（R-10 起公式注与表注、图注同机制得到“注：/注n：”），`id` 仅被引用时写（`registerPendingId`）。
 *
 * 编号只来自 Resolver：本文件不拼接、不推算任何编号。
 */

import type { IRFormula, IRFormulaNote, IRInlineFormula } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, inlineHasContent, removeAttr, setAttr, sub, type RenderContext, type Site } from './context'
import { MathMlParseError, parseMathMlDetailed } from './mathml'

/**
 * 放行（设计 §1.3.2～§1.3.3）：块公式的 `mathml`、`notes`（`IRFormulaNote` 无 `kind`，须登记 shape）；行内公式的 `mathml`、`source`。
 * 行内公式自身（`inline.formula`）的放行由 T2.4a-1 登记（`XML46687_INLINE_BOUNDARY` 的 `.formula`）；旧 XML 对它整体阻断、
 * 不再下探，所以 `inlineFormula.mathml/source` 在“XML 与 XML46687 之差”里观察不到，不再单独登记差异项，只登记字段。
 * `formula.sourceInlines` 的“仅纯文本等价”检查保持不变（与 HTML/DOCX 同口径）。
 */
export const XML46687_FORMULAS_BOUNDARY: Xml46687BoundaryContribution = {
  fields: {
    formula: ['mathml', 'notes'],
    formulaNote: ['id', 'content'],
    inlineFormula: ['mathml', 'source'],
  },
  shapes: [
    { parent: 'formula', key: 'notes', shape: 'formulaNote' },
  ],
  declared: [
    { pathSuffix: '.mathml', kind: 'field', name: 'mathml', matrixIds: ['M-7.4-01', 'M-7.4-02', 'M-7.4-03'], task: 'T2.4b', reason: '块公式的原始 MathML 写成 disp-formula/mml:math（不由 latex 重算，7.4）；行内公式的 mathml/source 随行内公式整体放行，不单列' },
    { pathSuffix: '.notes', kind: 'field', name: 'notes', matrixIds: ['M-7.2-01', 'M-7.2-02'], task: 'T2.4b', reason: '公式注写成 disp-formula 内的 non-normative-note，label 取 Resolver（7.2）' },
  ],
}

// ---------------------------------------------------------------------------
// MathML 取值
// ---------------------------------------------------------------------------

/**
 * 取得并解析一个公式的 MathML，返回 `mml:math` 根；失败时已报告问题并返回 undefined。
 * `display`：块公式写 `block`，行内公式去掉（V-15）。
 */
function mathElementOf(formula: { id: string; mathml?: string }, at: Site, ctx: RenderContext, display: 'block' | 'inline'): XmlElement | undefined {
  const own = typeof formula.mathml === 'string' && formula.mathml.trim() !== '' ? formula.mathml : undefined
  const fromOptions = Object.prototype.hasOwnProperty.call(ctx.options.mathml, formula.id) ? ctx.options.mathml[formula.id] : undefined
  const source = own ?? (typeof fromOptions === 'string' && fromOptions.trim() !== '' ? fromOptions : undefined)
  if (source === undefined) {
    ctx.report('mathml-missing', 'error', `公式（${formula.id}）既没有 MathML 也没有 options.mathml 条目，不能导出（不用图片或空公式代替）；请先把 LaTeX 转换为 MathML。`, at)
    return undefined
  }
  let parsed
  try {
    parsed = parseMathMlDetailed(source)
  } catch (error) {
    if (!(error instanceof MathMlParseError)) throw error
    ctx.report('mathml-invalid', 'error', `公式（${formula.id}）的 MathML 不合约定：${error.message}。`, at)
    return undefined
  }
  if (parsed.removedAnnotations > 0) {
    ctx.report('mathml-annotation-removed', 'info', `公式（${formula.id}）的 MathML 中有 ${parsed.removedAnnotations} 处 TeX 注释，已去掉（导出不含 TeX 源码）。`, at)
  }
  const root = parsed.root
  if (display === 'block') setAttr(root, 'display', 'block')
  else removeAttr(root, 'display')
  return root
}

// ---------------------------------------------------------------------------
// 块公式
// ---------------------------------------------------------------------------

function renderFormulaNote(note: IRFormulaNote, at: Site, ctx: RenderContext): XmlElement {
  const label = ctx.labelOf(note.id)
  if (!label || label.label === '') {
    ctx.report('xml-label-missing', 'error', '公式注在 labels 中没有标签（Resolver 应给出“注：”或“注n：”）。', at)
  }
  const element = el('non-normative-note', undefined, [
    label && label.label !== '' ? el('label', undefined, [label.label]) : null,
    el('p', undefined, ctx.renderInlines(note.content, sub(at, '.content'), 'inline')),
  ])
  ctx.registerPendingId(note.id, element, at)
  return element
}

/** “式中”说明：`legend`（固定标题“式中：”）＞ `def-list[@list-content="formula"]` ＞ `def-item`（`term` 符号、`def/p` 含义），都不写 id。 */
function renderWhereList(block: IRFormula, at: Site, ctx: RenderContext): XmlElement {
  const items = block.whereList.map((item, index): XmlElement => {
    const itemSite = sub(at, `.whereList[${index}]`, item.id)
    const hasDefinition = inlineHasContent(item.definition)
    if (!hasDefinition) ctx.report('empty-content', 'warning', '“式中”项没有含义，已写出空的 p（def 至少需要一个 p）。', sub(itemSite, '.definition'))
    return el('def-item', undefined, [
      el('term', undefined, ctx.renderInlines(item.term, sub(itemSite, '.term'), 'term')),
      el('def', undefined, [el('p', undefined, ctx.renderInlines(item.definition, sub(itemSite, '.definition'), 'inline'))]),
    ])
  })
  return el('legend', undefined, [
    el('title', undefined, ['式中：']),
    el('def-list', { 'list-content': 'formula' }, items),
  ])
}

export function renderFormula(block: IRFormula, at: Site, ctx: RenderContext): XmlElement[] {
  let id: string | undefined
  let labelText: string | undefined
  if (block.numbered) {
    id = ctx.xmlIdOf(block.id, at, '有编号的公式')
    const label = ctx.labelOf(block.id)
    // labels 里完全没有该公式时 xmlIdOf 已报 xml-label-missing，这里只补“有标签但编号文本为空”的情形
    if (label && label.label !== '') labelText = label.label
    else if (label) ctx.report('xml-label-missing', 'error', '有编号的公式在 labels 中没有编号文本（Resolver 应给出“(1)”）。', at)
  }
  const math = mathElementOf(block, at, ctx, 'block')
  const children: Array<XmlElement | null> = [
    labelText !== undefined ? el('label', undefined, [labelText]) : null,
    math ?? null,
    ...(block.notes ?? []).map((note, index) => renderFormulaNote(note, sub(at, `.notes[${index}]`, note.id), ctx)),
    block.whereList.length > 0 ? renderWhereList(block, at, ctx) : null,
  ]
  return [el('disp-formula', { id }, children)]
}

// ---------------------------------------------------------------------------
// 行内公式
// ---------------------------------------------------------------------------

export function renderInlineFormula(formula: IRInlineFormula, at: Site, ctx: RenderContext): XmlElement {
  const math = mathElementOf(formula, at, ctx, 'inline')
  return el('inline-formula', undefined, [math ?? null])
}
