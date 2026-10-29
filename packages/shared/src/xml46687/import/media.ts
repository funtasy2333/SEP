import type { IRBlock, IRDefItem, IRFigure, IRFormula, IRGraphic, IRInline, IRLegend } from '../../ir/types'
import { MATHML_NS, type XmlElement } from '../tree'
import type { ImportContext } from './context'
import { readInlineChildren } from './inline'
import { readMathMl } from './mathml'
import { mapTable } from './table'

function error(el: XmlElement, ctx: ImportContext, message: string): void { ctx.report({ code: 'xml-unsupported', severity: 'error', message, xml: ctx.location(el) }) }
function graphic(el: XmlElement, ctx: ImportContext): IRGraphic | undefined {
  const id = ctx.elementId(el), resource = ctx.requiredResource(el)
  if (!id || !resource) return undefined
  const contentType = ctx.attr(el, null, 'content-type'), use = ctx.attr(el, null, 'specific-use')
  if (use && !['size:T', 'size:S', 'size:M', 'size:L'].includes(use)) error(el, ctx, '未知图片尺寸')
  return { id, src: resource.src, ...(resource.resourceId ? { resourceId: resource.resourceId } : {}), ...(contentType ? { contentType } : {}), ...(['size:T', 'size:S', 'size:M', 'size:L'].includes(use ?? '') ? { specificUse: use as IRGraphic['specificUse'] } : {}) }
}
function flattened(el: XmlElement, ctx: ImportContext): IRInline[] {
  const blocks = el.children.filter((c): c is XmlElement => c.type === 'element' && c.name.ns === null && (c.name.local === 'p' || c.name.local === 'list'))
  if (!blocks.length) return readInlineChildren(el, ctx)
  for (const child of el.children) if (child.type === 'element' && !blocks.includes(child) && !(child.name.ns === null && child.name.local === 'label')) error(child, ctx, '说明包含无法保留的内容')
  const parts: IRInline[][] = []
  const collect = (node: XmlElement) => {
    if (node.name.local === 'p') parts.push(readInlineChildren(node, ctx))
    else { if (node.name.local === 'list-item' && ctx.attr(node,null,'id')) error(node,ctx,'无法保留说明列表项的引用身份'); for (const child of node.children) if (child.type === 'element') collect(child) }

  }
  blocks.forEach(collect)
  if (parts.length > 1) ctx.report({ code: 'xml-normalized', severity: 'warning', message: '多段内容以换行合并', xml: ctx.location(el) })
  return parts.flatMap((part, i) => i ? [{ text: '\n' }, ...part] : part)
}
function items(legend: XmlElement, ctx: ImportContext): IRDefItem[] {
  const list = ctx.child(legend, null, 'def-list')
  if (!list) { error(legend, ctx, '图例缺少定义列表'); return [] }
  return ctx.children(list, null, 'def-item').flatMap(item => {
    const id = ctx.elementId(item), term = ctx.child(item, null, 'term'), def = ctx.child(item, null, 'def')
    if (!id || !term || !def) { error(item, ctx, '定义项缺少词项或说明'); return [] }
    return [{ id, term: readInlineChildren(term, ctx), definition: flattened(def, ctx) }]
  })
}
function legend(el: XmlElement, ctx: ImportContext): IRLegend | undefined {
  const id = ctx.elementId(el), title = ctx.child(el, null, 'title')
  if (!id) return undefined
  return { id, ...(title ? { title: readInlineChildren(title, ctx) } : {}), items: items(el, ctx) }
}
function note(el: XmlElement, ctx: ImportContext, kind: 'note' | 'example') {
  const id = ctx.elementId(el), pid = ctx.singleParagraphId(el)
  if (!id || !pid) return undefined
  return { kind, id, content: [{ kind: 'paragraph' as const, id: pid, content: flattened(el, ctx) }] }
}
function formula(el: XmlElement, ctx: ImportContext): IRFormula | undefined {
  const id = ctx.elementId(el), maths = ctx.children(el, MATHML_NS, 'math')
  if (!id || maths.length !== 1) { error(el, ctx, '行间公式必须有一个 MathML'); return undefined }
  const mathml = readMathMl(maths[0]!, ctx)
  if (!mathml) return undefined
  const legends = ctx.children(el, null, 'legend')
  if (legends.length > 1) error(el, ctx, '公式含多个图例')
  const title = legends[0] && ctx.child(legends[0], null, 'title')
  if (title) { const runs = readInlineChildren(title,ctx); if (runs.some(run => run.marks || run.style || run.formula || run.image || run.footnoteRef) || runs.map(run => run.text).join('') !== '式中：') error(title,ctx,'公式图例标题无法保留') }
  const notes = ctx.children(el, null, 'non-normative-note').flatMap(n => { const nid = ctx.elementId(n); return nid ? [{id: nid, content: flattened(n, ctx)}] : [] })
  for (const c of el.children) if (c.type === 'element' && !(c.name.ns === MATHML_NS && c.name.local === 'math') && !(c.name.ns === null && ['label','legend','non-normative-note'].includes(c.name.local))) error(c, ctx, '公式包含无法保留的内容')
  return { kind: 'formula', id, latex: '', mathml, numbered: !!ctx.child(el, null, 'label'), whereList: legends[0] ? items(legends[0], ctx) : [], ...(notes.length ? { notes } : {}) }
}
function figure(el: XmlElement, ctx: ImportContext): IRFigure | undefined {
  const id = ctx.elementId(el), graphics = ctx.children(el, null, 'graphic').map(g => graphic(g, ctx))
  if (!id || !graphics[0]) { if (!graphics.length) error(el, ctx, '图缺少 graphic'); return undefined }
  const first = graphics[0], caption = ctx.child(el, null, 'caption'), title = caption && ctx.child(caption, null, 'title')
  const dimensions = caption ? ctx.children(caption, null, 'p') : []
  const units = dimensions.map(d => { const runs = readInlineChildren(d,ctx); if (ctx.attr(d,null,'content-type') !== 'dimension' || runs.some(r => r.marks || r.style || r.formula || r.image || r.footnoteRef || r.footnote)) error(d,ctx,'单位说明包含无法保留的内容'); return runs.map(r => r.text).join('') })
  if (units.length > 1) ctx.report({code:'xml-normalized',severity:'warning',message:'多段单位说明以换行合并',xml:ctx.location(caption!)})
  if (caption) for (const c of caption.children) if (c.type === 'element' && (c.name.ns !== null || !['title','p'].includes(c.name.local))) error(c,ctx,'图题包含无法保留的内容')
  const extra = graphics.slice(1).filter((g): g is IRGraphic => !!g)
  const lg = ctx.child(el, null, 'legend')
  const descriptions = ctx.children(el, null, 'p').flatMap(p => { const pid = ctx.elementId(p); return pid ? [{ id: pid, content: readInlineChildren(p, ctx) }] : [] })
  const notes = ctx.children(el, null, 'non-normative-note').flatMap(n => { const result = note(n, ctx, 'note'); return result && result.kind === 'note' ? [{ ...result, kind: 'note' as const }] : [] })
  const examples = ctx.children(el, null, 'non-normative-example').flatMap(n => { const result = note(n, ctx, 'example'); return result && result.kind === 'example' ? [{ ...result, kind: 'example' as const }] : [] })
  let sawExample = false
  for (const c of el.children) if (c.type === 'element') {
    if (c.name.ns !== null || !['label','caption','legend','p','graphic','non-normative-note','non-normative-example'].includes(c.name.local)) error(c, ctx, '图包含无法保留的内容')
    if (c.name.local === 'non-normative-example') sawExample = true
    if (c.name.local === 'non-normative-note' && sawExample) ctx.report({code: 'xml-normalized', severity: 'warning', message: '图注与示例顺序已规范化', xml: ctx.location(c)})
  }
  return { kind: 'figure', id, caption: title ? readInlineChildren(title, ctx) : [], orientation: ctx.attr(el, null, 'orientation') === 'landscape' ? 'landscape' : 'portrait', src: first.src, ...(first.resourceId ? { resourceId: first.resourceId } : {}), ...((first.contentType || first.specificUse) ? { primaryGraphic: { ...(first.contentType ? { contentType: first.contentType } : {}), ...(first.specificUse ? { specificUse: first.specificUse } : {}) } } : {}), ...(extra.length ? { additionalGraphics: extra } : {}), ...(units.length ? { unit: units.join('\n') } : {}), notes, ...(examples.length ? {examples} : {}), ...(descriptions.length ? {descriptions} : {}), ...(lg ? {legend: legend(lg, ctx)} : {}) }
}
export function mapMediaBlock(element: XmlElement, ctx: ImportContext): IRBlock[] | undefined {
  if (element.name.ns !== null) return undefined
  if (element.name.local === 'table-wrap' || element.name.local === 'array') { const value = mapTable(element, ctx, graphic); return value ? [value] : [] }
  if (element.name.local === 'fig') { const result = figure(element, ctx); return result ? [result] : [] }
  if (element.name.local === 'fig-group') {
    const id = ctx.elementId(element), lg = ctx.child(element, null, 'legend')
    if (!id) return []
    for (const c of element.children) if (c.type === 'element' && (c.name.ns !== null || !['fig','legend'].includes(c.name.local))) error(c, ctx, '组合图包含无法保留的内容')
    return [{kind: 'figureSet', id, figures: ctx.children(element, null, 'fig').flatMap(f => { const value = figure(f, ctx); return value ? [value] : [] }), ...(lg ? {legend: legend(lg, ctx)} : {})}]
  }
  if (element.name.local === 'disp-formula') { const value = formula(element, ctx); return value ? [value] : [] }
  if (element.name.local === 'disp-formula-group') {
    const id = ctx.elementId(element)
    if (!id) return []
    for (const c of element.children) if (c.type === 'element' && (c.name.ns !== null || !['label','disp-formula'].includes(c.name.local))) error(c, ctx, '公式组包含无法保留的内容')
    return [{kind: 'formulaGroup', id, numbered: !!ctx.child(element, null, 'label'), formulas: ctx.children(element, null, 'disp-formula').flatMap(f => { const value = formula(f, ctx); return value ? [value] : [] })}]
  }
  return undefined
}
export function mapMediaInline(element: XmlElement, ctx: ImportContext): IRInline[] | undefined {
  if (element.name.ns !== null) return undefined
  if (element.name.local === 'inline-formula') {
    const id = ctx.elementId(element), maths = ctx.children(element, MATHML_NS, 'math')
    const others = element.children.filter(c => c.type === 'element' && !(c.name.ns === MATHML_NS && c.name.local === 'math'))
    if (!id || maths.length !== 1 || others.length) { error(element, ctx, '行内公式必须恰有一个 MathML'); return [] }
    const math = maths[0]!
    const mathml = readMathMl(math, ctx)
    return mathml ? [{ text: '', formula: { id, mathml, latex: '' } }] : []
  }
  if (element.name.local === 'inline-graphic') {
    const resource = ctx.requiredResource(element), use = ctx.attr(element, null, 'specific-use')
    if (!resource) return []
    if (use === 'size:T') ctx.report({ code: 'xml-normalized', severity: 'warning', message: '行内图忽略 size:T', xml: ctx.location(element) })
    else if (use && !['size:S', 'size:M', 'size:L'].includes(use)) error(element, ctx, '未知行内图尺寸')
    const size = use?.slice(5)
    return [{ text: '', image: { src: resource.src, ...(resource.resourceId ? { resourceId: resource.resourceId } : {}), ...(['S', 'M', 'L'].includes(size ?? '') ? { size: size as 'S' | 'M' | 'L' } : {}) } }]
  }
  return undefined
}
