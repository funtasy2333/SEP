import type { IRArray, IRBlock, IRCellStyle, IRGraphic, IRInline, IRMeasure, IRNote, IRRowStyle, IRTable, IRTableColumn, IRTableRow, IRTableStyle } from '../../ir/types'
import type { XmlElement } from '../tree'
import type { ImportContext } from './context'
import { readInlineChildren } from './inline'

function issue(el: XmlElement, ctx: ImportContext, message: string, severity: 'error' | 'warning' = 'error') { ctx.report({code: severity === 'error' ? 'xml-unsupported' : 'xml-normalized', severity, message, xml: ctx.location(el)}) }
function checkAttrs(el: XmlElement, ctx: ImportContext, allowed: string[]) {
  for (const attr of el.attrs) {
    if (attr.name.ns === null && allowed.includes(attr.name.local)) continue
    if (attr.name.ns === 'http://www.w3.org/XML/1998/namespace' && attr.name.local === 'space') continue
    issue(el,ctx,`无法保留属性 ${attr.name.local}`)
  }
}
function measure(value: string | undefined, el: XmlElement, ctx: ImportContext): IRMeasure | undefined {
  if (value === undefined) return undefined
  const m = /^\s*(\d+(?:\.\d+)?)\s*(%|px|mm|cm|pt|em)\s*$/.exec(value)
  if (!m) { issue(el, ctx, '无法保留的宽度或长度'); return undefined }
  return { value: Number(m[1]), unit: m[2]! }
}
function align(el: XmlElement, ctx: ImportContext): {textAlign?: string; verticalAlign?: string} {
  let a = ctx.attr(el, null, 'align'), v = ctx.attr(el, null, 'valign')
  if (a === 'char') { issue(el, ctx, '字符对齐规范化为左对齐', 'warning'); a = 'left' }
  if (v === 'center' || v === 'baseline') { issue(el, ctx, '垂直对齐规范化为居中', 'warning'); v = 'middle' }
  if (a && !['left','center','right','justify'].includes(a)) issue(el, ctx, '未知水平对齐')
  if (v && !['top','middle','bottom'].includes(v)) issue(el, ctx, '未知垂直对齐')
  return {...(a ? {textAlign:a} : {}), ...(v ? {verticalAlign:v} : {})}
}
function styles(el: XmlElement, ctx: ImportContext): IRCellStyle | undefined {
  const result: IRCellStyle = align(el, ctx), style = ctx.attr(el, null, 'style')
  for (const declaration of style?.split(';') ?? []) {
    if (!declaration.trim()) continue
    const m = /^\s*([a-z-]+)\s*([:=])\s*(.*?)\s*$/.exec(declaration)
    if (!m) { issue(el, ctx, '未知表格样式'); continue }
    if (m[2] === '=') issue(el, ctx, '样式等号已规范化', 'warning')
    if (m[1] === 'background-color') { result.backgroundColor = m[3]; continue }
    const side = /^border-(top|right|bottom|left)$/.exec(m[1]!)
    if (!side) { issue(el, ctx, '未知表格样式'); continue }
    const border = /^(solid|dashed|dotted|none)(?:\s+(\d+(?:\.\d+)?(?:px|mm|pt)))?$/.exec(m[3]!)
    if (!border) { issue(el, ctx, '无法保留的边框样式'); continue }
    const key = `border${side[1]![0]!.toUpperCase()}${side[1]!.slice(1)}` as 'borderTop'|'borderRight'|'borderBottom'|'borderLeft'
    result[`${key}Style`] = border[1]!
    if (border[2]) result[key] = measure(border[2], el, ctx)
  }
  return Object.keys(result).length ? result : undefined
}
function containerStyle(el: XmlElement, ctx: ImportContext, kind: 'table' | 'row'): IRTableStyle | IRRowStyle | undefined {
  const result: Record<string, string | IRMeasure> = { ...align(el, ctx) }
  const strings: Record<string, string> = { 'background-color':'backgroundColor', 'border-color':'borderColor', 'table-layout':'layout', 'border-collapse':'borderModel' }
  const measures: Record<string, string> = { 'border-width':'borderWidth', 'cell-padding':'cellPadding', height:'height', 'border-top':'borderTop', 'border-right':'borderRight', 'border-bottom':'borderBottom', 'border-left':'borderLeft' }
  for (const decl of (ctx.attr(el,null,'style') ?? '').split(';')) {
    if (!decl.trim()) continue
    const match = /^\s*([a-z-]+)\s*([:=])\s*(.*?)\s*$/.exec(decl)
    if (!match) { issue(el,ctx,'未知表格样式'); continue }
    if (match[2] === '=') issue(el,ctx,'样式等号已规范化','warning')
    const key = match[1]!, value = match[3]!
    if (strings[key] && !(kind === 'row' && ['table-layout','border-collapse'].includes(key))) result[strings[key]!] = value
    else if (measures[key] && !(kind === 'table' && ['height','border-top','border-right','border-bottom','border-left'].includes(key)) && !(kind === 'row' && key === 'cell-padding')) { const m = measure(value,el,ctx); if (m) result[measures[key]!] = m }
    else issue(el,ctx,'无法保留的表格样式')
  }
  return Object.keys(result).length ? result : undefined
}
function paragraphs(el: XmlElement, ctx: ImportContext): IRInline[] {
  const parts: IRInline[][] = []
  const walk = (node: XmlElement) => {
    if (node.name.ns !== null) { issue(node,ctx,'未知说明内容'); return }
    if (node.name.local === 'p') { parts.push(readInlineChildren(node,ctx)); return }
    if (node.name.local === 'label') return
    if (!['list','list-item'].includes(node.name.local)) { issue(node,ctx,'未知说明内容'); return }
    if (node.name.local === 'list-item' && ctx.attr(node,null,'id')) issue(node,ctx,'无法保留说明列表项的引用身份')
    for (const child of node.children) if (child.type === 'element') walk(child)
  }
  for (const child of el.children) if (child.type === 'element') walk(child)
  if (!parts.length) { issue(el,ctx,'缺少内容段落'); return [] }
  if (parts.length > 1 || ctx.child(el,null,'list')) issue(el,ctx,'多段或列表内容以换行合并','warning')
  return parts.flatMap((part,i) => i ? [{text:'\n'},...part] : part)
}
function cellContent(el: XmlElement, ctx: ImportContext): IRBlock[] {
  const blocks = el.children.filter((c): c is XmlElement => c.type === 'element' && c.name.ns === null && ['p','list'].includes(c.name.local))
  if (blocks.length) {
    if (el.children.some(c => (c.type === 'text' && c.value.trim()) || (c.type === 'element' && !blocks.includes(c)))) issue(el, ctx, '单元格行内与块级内容混排')
    return blocks.flatMap(b => {
      if (b.name.local === 'p') { const id = ctx.elementId(b); return id ? [{kind:'paragraph' as const, id, content:readInlineChildren(b,ctx)}] : [] }
      return ctx.dispatchBlock(b) ?? []
    })
  }
  const id = ctx.singleParagraphId(el)
  return id ? [{kind:'paragraph', id, content:readInlineChildren(el,ctx)}] : []
}
function grid(table: XmlElement, ctx: ImportContext): {columns: IRTableColumn[]; rows: IRTableRow[]; groups: Array<{start:number;count:number}>; headerRowCount: number} {
  checkAttrs(table,ctx,['width','align','valign','style','border','frame','rules','cellpadding','cellspacing'])
  for (const name of ['border','frame','rules','cellspacing']) if (ctx.attr(table,null,name) !== undefined) issue(table,ctx,`表属性 ${name} 已规范化`, 'warning')
  const columns: IRTableColumn[] = [], groups: Array<{start:number;count:number}> = [], rows: IRTableRow[] = []
  const column = (el: XmlElement) => { checkAttrs(el,ctx,['width','align','valign','style']); const width = measure(ctx.attr(el,null,'width'),el,ctx); if (ctx.attr(el,null,'style')) issue(el,ctx,'列样式无法保留'); columns.push({ ...(width ? {width} : {}), ...align(el,ctx) }) }
  let headerRowCount = 0
  const occupied: number[] = [], rowOccupancy: boolean[][] = []
  for (const child of table.children) {
    if (child.type !== 'element') continue
    if (child.name.ns !== null) { issue(child,ctx,'未知表元素'); continue }
    if (child.name.local === 'col') { column(child); continue }
    if (child.name.local === 'colgroup') { checkAttrs(child,ctx,[]); const start = columns.length; ctx.children(child,null,'col').forEach(c => column(c)); groups.push({start,count:columns.length-start}); continue }
    if (!['thead','tbody'].includes(child.name.local)) { issue(child,ctx,'未知或不支持的表结构'); continue }
    const trs = ctx.children(child,null,'tr')
    if (child.name.local === 'thead') headerRowCount += trs.length
    for (const tr of trs) {
      checkAttrs(tr,ctx,['align','valign','style'])
      const id = ctx.elementId(tr); if (!id) continue
      let cursor = 0
      const cells: IRTableRow['cells'] = []
      for (const td of tr.children) {
        if (td.type !== 'element') continue
        if (td.name.ns !== null || !['th','td'].includes(td.name.local)) { issue(td,ctx,'未知表格单元'); continue }
        checkAttrs(td,ctx,['id','colspan','rowspan','align','valign','style','width','scope'])
        while ((occupied[cursor] ?? 0) > 0) cursor++
        const parseSpan = (name: string) => { const value = ctx.attr(td,null,name); if (value === undefined) return 1; if (!/^[1-9]\d*$/.test(value) || Number(value) > 10000) { issue(td,ctx,'单元格跨度无效'); return 1 }; return Number(value) }
        const colspan = parseSpan('colspan'), rowspan = parseSpan('rowspan')
        for (let j=cursor;j<cursor+colspan;j++) { if ((occupied[j] ?? 0) > 0) issue(td,ctx,'单元格跨度重叠'); occupied[j] = rowspan }
        cursor += colspan
        const cid = ctx.elementId(td), style = styles(td,ctx), width = measure(ctx.attr(td,null,'width'),td,ctx)
        if (ctx.attr(td,null,'scope')) issue(td,ctx,'单元格 scope 已忽略','warning')
        if (child.name.local === 'thead' && td.name.local === 'td') issue(td,ctx,'表头包含 td','warning')
        if (cid) cells.push({id:cid, colspan, rowspan, header:td.name.local === 'th', content:cellContent(td,ctx), ...(style ? {style} : {}), ...(width ? {width} : {})})
      }
      rowOccupancy.push(occupied.map(value => (value ?? 0) > 0))
      for (let j=0;j<occupied.length;j++) if (occupied[j]) occupied[j]!--
      const style = containerStyle(tr,ctx,'row') as IRRowStyle | undefined
      rows.push({id,cells,...(style ? {style} : {})})
    }
  }
  const width = Math.max(0, ...rowOccupancy.map(row => row.length))
  if (rowOccupancy.some(row => Array.from({length: width}, (_, i) => !!row[i]).some(used => !used)) || occupied.some(x => x > 0) || (columns.length && columns.length !== width)) issue(table,ctx,'表格网格列数或跨度不一致')
  while (columns.length < width) columns.push({})
  return { columns, rows, groups, headerRowCount }
}
export function mapTable(el: XmlElement, ctx: ImportContext, makeGraphic: (el: XmlElement, ctx: ImportContext) => IRGraphic | undefined): IRTable | IRArray | undefined {
  const id = ctx.elementId(el), table = ctx.child(el,null,'table')
  if (!id || !table) { issue(el,ctx,'缺少表主体'); return undefined }
  const mapped = grid(table,ctx)
  if (el.name.local === 'array') return {kind:'array',id,columns:mapped.columns,rows:mapped.rows,...(mapped.groups.length ? {columnGroups:mapped.groups} : {})}
  const caption = ctx.child(el,null,'caption'), title = caption && ctx.child(caption,null,'title'), foot = ctx.child(el,null,'table-wrap-foot')
  const notes: IRNote[] = [], footnotes: NonNullable<IRTable['footnotes']> = []
  let unit: string | undefined
  if (foot) for (const child of foot.children) if (child.type === 'element') {
    if (child.name.ns !== null) { issue(child,ctx,'未知表脚内容'); continue }
    if (child.name.local === 'p' && ctx.attr(child,null,'content-type') === 'dimension') { const content = readInlineChildren(child,ctx); if (content.some(x => x.marks || x.formula || x.image || x.footnoteRef)) issue(child,ctx,'单位说明包含无法保留的行内内容'); const text = content.map(x=>x.text).join(''); unit = unit === undefined ? text : `${unit}\n${text}`; continue }
    if (child.name.local === 'non-normative-note') { const nid = ctx.elementId(child), pid = ctx.singleParagraphId(child); if (nid && pid) notes.push({kind:'note',id:nid,content:[{kind:'paragraph',id:pid,content:paragraphs(child,ctx)}]}); continue }
    if (child.name.local === 'fn') { const nid = ctx.elementId(child); if (nid) footnotes.push({id:nid,content:paragraphs(child,ctx)}); continue }
    issue(child,ctx,'未知表脚内容')
  }
  const alternative = ctx.child(el,null,'graphic'), alternativeGraphic = alternative && makeGraphic(alternative,ctx), width = measure(ctx.attr(table,null,'width'),table,ctx)
  for (const c of el.children) if (c.type === 'element' && (c.name.ns !== null || !['label','caption','table','table-wrap-foot','graphic'].includes(c.name.local))) issue(c,ctx,'未知表容器内容')
  const tableStyle = (containerStyle(table,ctx,'table') ?? {}) as IRTableStyle
  const padding = measure(ctx.attr(table,null,'cellpadding'),table,ctx)
  if (padding) tableStyle.cellPadding = padding
  return {kind:'table',id,...(Object.keys(tableStyle).length ? {style:tableStyle} : {}),caption:title ? readInlineChildren(title,ctx) : [],orientation:ctx.attr(el,null,'orientation') === 'landscape' ? 'landscape' : 'portrait',headerRowCount:mapped.headerRowCount,rows:mapped.rows,columns:mapped.columns,notes,...(footnotes.length ? {footnotes} : {}),...(unit !== undefined ? {unit} : {}),...(alternativeGraphic ? {alternativeGraphic} : {}),...(width ? {width} : {})}
}
