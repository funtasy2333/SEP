import type { IRBibEntry, IRBlock, IRIndex, IRInline, IRMark, IRNormRef } from '../../ir/types'
import { urlProblem } from '../../renderers/xml46687Parts/inline'
import { isXmlElement, xmlTextContent, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import type { ImportContext } from './context'
import { readInlineChildren } from './inline'

const TBX = 'urn:iso:std:iso:30042:ed-1'
const els = (e: XmlElement) => e.children.filter(isXmlElement)
const named = (e: XmlElement, n: string) => els(e).filter(c => c.name.ns === null && c.name.local === n)
function issue(e: XmlElement, ctx: ImportContext, message: string, warning = false) {
  ctx.report({ code: warning ? 'xml-normalized' : 'xml-unsupported', severity: warning ? 'warning' : 'error', message, xml: ctx.location(e) })
}
function structural(e: XmlElement, ctx: ImportContext) {
  if (e.children.some(c => c.type === 'text' && c.value.trim())) issue(e, ctx, '结构元素包含无法映射的文本')
}
function id(e: XmlElement, ctx: ImportContext): string { return ctx.elementId(e) ?? '' }
function mark(runs: IRInline[], m: IRMark): IRInline[] { return runs.map(r => ({ ...r, marks: [m, ...(r.marks ?? [])] })) }
function adjacent(ref: XmlElement, fn: XmlElement, ctx: ImportContext): boolean {
  const p = ctx.index.parent.get(ref)
  if (!p || p !== ctx.index.parent.get(fn)) return false
  const i = p.children.indexOf(ref)
  return p.children[i + 1] === fn
}
function footnote(fn: XmlElement, ctx: ImportContext) {
  structural(fn, ctx)
  const children = els(fn)
  const paragraphs = named(fn, 'p')
  if (paragraphs.length !== 1 || children.some(c => c.name.ns !== null || !['label', 'p'].includes(c.name.local))) issue(fn, ctx, '脚注必须包含一个段落且不含未知结构')
  const content = paragraphs[0] ? readInlineChildren(paragraphs[0], ctx) : []
  if (content.some(r => r.footnote || r.footnoteRef || r.footnoteDefinition)) issue(fn, ctx, '脚注不能嵌套脚注')
  return { id: id(fn, ctx), content }
}
function tableOwner(e: XmlElement, ctx: ImportContext): XmlElement | undefined {
  let current: XmlElement | undefined = e
  while (current) {
    if (current.name.ns === null && current.name.local === 'table-wrap') return current
    current = ctx.index.parent.get(current)
  }
  return undefined
}
// 索引为只读，每个文档最多扫描一次，避免大量表脚注引用造成平方复杂度。
const tableFootnoteLabels = new WeakMap<ImportContext['index'], WeakMap<XmlElement, string>>()
function tableFootnoteLabel(e: XmlElement, ctx: ImportContext): string {
  let labels = tableFootnoteLabels.get(ctx.index)
  if (!labels) {
    labels = new WeakMap<XmlElement, string>()
    const tables = new Map<XmlElement, Map<string, number>>()
    for (const candidate of ctx.index.parent.keys()) {
      if (candidate.name.ns !== null || candidate.name.local !== 'xref' || ctx.attr(candidate, null, 'ref-type') !== 'table-fn') continue
      const owner = tableOwner(candidate, ctx)
      const rid = ctx.attr(candidate, null, 'rid')
      if (!owner || !rid) continue
      let targets = tables.get(owner)
      if (!targets) { targets = new Map<string, number>(); tables.set(owner, targets) }
      const key = ctx.xmlTargetID(rid) ?? rid
      if (!targets.has(key)) targets.set(key, targets.size + 1)
      let n = targets.get(key)!, label = ''
      while (n > 0) { n -= 1; label = String.fromCharCode(97 + n % 26) + label; n = Math.floor(n / 26) }
      labels.set(candidate, label)
    }
    tableFootnoteLabels.set(ctx.index, labels)
  }
  return labels.get(e) ?? ''
}
function isSingle(ref: XmlElement, fn: XmlElement, rid: string, ctx: ImportContext): boolean {
  return ctx.index.footnoteReferenceCounts.get(rid) === 1 && adjacent(ref, fn, ctx)
}
export function mapReferenceInline(e: XmlElement, ctx: ImportContext): IRInline[] | undefined {
  const n = e.name.local
  if (e.name.ns === TBX && n === 'entailedTerm') {
    const target = ctx.attr(e, null, 'target') ?? ''
    const item = ctx.index.byXmlId.get(target)
    if (!item || item.element.name.ns !== TBX || item.element.name.local !== 'termEntry') { issue(e, ctx, '术语关联必须指向术语条目'); return [] }
    return mark(readInlineChildren(e, ctx), { type: 'termRef', targetId: item.nodeId })
  }
  if (e.name.ns !== null) return undefined
  if (n === 'ext-link') {
    const href = ctx.attr(e, XLINK_NS, 'href')
    const linkType = ctx.attr(e, null, 'ext-link-type')
    const xlinkType = ctx.attr(e, XLINK_NS, 'type')
    if (e.attrs.some(a => !((a.name.ns === XLINK_NS && ['href', 'type'].includes(a.name.local)) || (a.name.ns === null && a.name.local === 'ext-link-type'))) || (xlinkType !== undefined && xlinkType !== 'simple')) {
      issue(e, ctx, '外部链接包含无法保留的属性')
      return []
    }
    if (!href?.trim() || urlProblem(href)) {
      issue(e, ctx, '外部链接地址为空或使用了不安全的协议')
      return []
    }
    if (linkType !== undefined && linkType !== 'uri') issue(e, ctx, '外部链接类型已归一化为 uri', true)
    const runs = readInlineChildren(e, ctx)
    if (!runs.length || runs.some(run => run.image || run.formula || run.footnote || run.footnoteRef || run.footnoteDefinition)) {
      issue(e, ctx, '外部链接包含无法保留的行内内容')
      return []
    }
    return mark(runs, { type: 'externalLink', href })
  }
  if (n === 'std') {
    structural(e, ctx)
    const result: IRInline[] = []
    for (const c of els(e)) {
      if (c.name.ns !== null || !['std-ref', 'title'].includes(c.name.local)) issue(c, ctx, '标准引用包含未知结构')
      else { if (c.name.local === 'title') issue(c, ctx, '标准引用标题并入正文', true); result.push(...readInlineChildren(c, ctx)) }
    }
    return mark(result, { type: 'stdRef' })
  }
  if (n === 'mixed-citation') return mark(readInlineChildren(e, ctx), { type: 'mixedCitation' })
  if (n === 'uri') {
    issue(e, ctx, '此处的 URI 无法保留来源形式')
    return readInlineChildren(e, ctx)
  }
  if (n === 'fn') {
    const rid = ctx.attr(e, null, 'id') ?? ctx.attr(e, 'http://www.w3.org/XML/1998/namespace', 'id') ?? ''
    const parent = ctx.index.parent.get(e)
    const preceding = parent?.children[parent.children.indexOf(e) - 1]
    if (preceding?.type === 'element' && ctx.attr(preceding, null, 'rid') === rid && isSingle(preceding, e, rid, ctx)) return []
    return [{ text: '', footnoteDefinition: footnote(e, ctx) }]
  }
  if (n !== 'xref') return undefined
  const rid = ctx.attr(e, null, 'rid')?.trim() ?? ''
  const item = ctx.index.byXmlId.get(rid)
  if (!rid || /\s/.test(rid) || !item) { issue(e, ctx, '引用目标不存在或不是单一目标'); return [] }
  const list = ctx.index.parent.get(item.element)
  if (item.element.name.local === 'ref' && list?.name.local === 'ref-list' && ['norm-refs', 'norm_refs'].includes(ctx.attr(list, null, 'content-type') ?? '')) { issue(e, ctx, '规范性引用条目目前无法作为交叉引用目标'); return [] }
  const type = ctx.attr(e, null, 'ref-type')
  if (type === 'fn') {
    const fn = ctx.index.footnoteDefinitions.get(rid)
    if (!fn || item.kind !== 'footnote') { issue(e, ctx, '脚注目标类型不匹配'); return [] }
    if (isSingle(e, fn, rid, ctx)) return [{ text: '', footnote: footnote(fn, ctx) }]
    return [{ text: '', footnoteRef: { targetId: item.nodeId, refText: xmlTextContent(e) } }]
  }
  if (type === 'custom' && ctx.attr(e, null, 'custom-type') === 'term-entry' && (item.element.name.ns !== TBX || item.element.name.local !== 'termEntry')) { issue(e, ctx, '术语引用必须指向 TBX 术语条目'); return [] }
  if (type === 'table-fn') {
    const owner = tableOwner(e, ctx)
    if (item.kind !== 'tableFootnote' || !owner || tableOwner(item.element, ctx) !== owner) { issue(e, ctx, '表脚注引用必须指向当前表内的脚注'); return [] }
    if (els(e).length) { issue(e, ctx, '表脚注引用的格式无法保留'); return [] }
    if (xmlTextContent(e) !== tableFootnoteLabel(e, ctx)) issue(e, ctx, '表脚注引用文字将按当前表内首次引用顺序重新编号', true)
    const refId = ctx.elementId(e)
    if (!refId) { issue(e, ctx, '表脚注引用缺少节点 ID'); return [] }
    return [{ text: '', marks: [{ type: 'tableFootnoteRef', targetId: item.nodeId, id: refId }] }]
  }
  let m: IRMark
  if (type === 'bibr') m = { type: 'bibRef', targetId: item.nodeId }
  else if (type === 'custom' && ctx.attr(e, null, 'custom-type') === 'term-entry') m = { type: 'termRef', targetId: item.nodeId }
  else {
    if (type === 'other' || type === 'chem') issue(e, ctx, '引用类型已按目标归一化', true)
    if (item.kind === 'footnote' || item.kind === 'tableFootnote') { issue(e, ctx, '引用目标类型不匹配'); return [] }
    m = { type: 'crossRef', targetId: item.nodeId, ...(type === 'chem' ? {} : { targetKind: item.kind }) }
  }
  return mark(readInlineChildren(e, ctx), m)
}
export function mapReferenceBlock(e: XmlElement, ctx: ImportContext): IRBlock[] | undefined {
  if (e.name.ns !== null) return undefined
  if (e.name.local === 'ref-list' && ['norm-refs', 'norm_refs'].includes(ctx.attr(e, null, 'content-type') ?? '')) {
    structural(e, ctx)
    const entries: IRNormRef[] = []
    for (const ref of els(e)) {
      if (ref.name.local !== 'ref' || ref.name.ns !== null) { issue(ref, ctx, '规范引用清单包含未知结构'); continue }
      structural(ref, ctx)
      const body = els(ref).filter(c => c.name.local !== 'label')
      if (body.length !== 1) { issue(ref, ctx, '规范引用条目需要一个文献内容'); continue }
      const b = body[0]!
      if (b.name.local === 'std') {
        structural(b, ctx)
        const refs = named(b, 'std-ref'), titles = named(b, 'title')
        if (refs.length !== 1 || titles.length !== 1 || els(b).length !== 2) { issue(b, ctx, '标准引用需要编号和标题'); continue }
        entries.push({ kind: 'normRef', id: id(ref, ctx), entryType: 'std', ref: readInlineChildren(refs[0]!, ctx), title: readInlineChildren(titles[0]!, ctx) })
      } else if (b.name.local === 'mixed-citation') entries.push({ kind: 'normRef', id: id(ref, ctx), entryType: 'mixed', content: readInlineChildren(b, ctx) })
      else issue(b, ctx, '未知规范引用类型')
    }
    return [{ kind: 'normRefList', id: id(e, ctx), entries }]
  }
  if (e.name.local !== 'def-list' || ![undefined, 'abbreviation'].includes(ctx.attr(e, null, 'list-content'))) return undefined
  structural(e, ctx)
  const items = named(e, 'def-item').map(item => {
    structural(item, ctx)
    const term = named(item, 'term')[0], def = named(item, 'def')[0]
    if (!term || !def || els(item).length !== 2) issue(item, ctx, '定义项必须包含术语和释义')
    if (def) structural(def, ctx)
    const ps = def ? named(def, 'p') : []
    if (def && ps.length !== els(def).length) issue(def, ctx, '定义包含未知结构')
    if (ps.length > 1) issue(def!, ctx, '多段释义以换行合并', true)
    return { id: id(item, ctx), term: term ? readInlineChildren(term, ctx) : [], definition: ps.flatMap((p, i) => [...(i ? [{ text: '\n' }] : []), ...readInlineChildren(p, ctx)]) }
  })
  if (items.length !== els(e).length) issue(e, ctx, '定义列表包含未知结构')
  return [{ kind: 'defList', id: id(e, ctx), items }]
}
export function mapBibliography(e: XmlElement, ctx: ImportContext): IRBibEntry[] | undefined {
  if (e.name.ns !== null || e.name.local !== 'ref-list' || !['bibl', 'bibr'].includes(ctx.attr(e, null, 'content-type') ?? '')) return undefined
  structural(e, ctx)
  const result: IRBibEntry[] = []
  for (const ref of els(e)) {
    if (ref.name.local === 'title') continue
    if (ref.name.local !== 'ref') { issue(ref, ctx, '参考文献包含未知结构'); continue }
    structural(ref, ctx)
    const bodies = els(ref).filter(c => c.name.local !== 'label')
    if (bodies.length !== 1) { issue(ref, ctx, '参考文献需要一个内容'); continue }
    const b = bodies[0]!
    if (b.name.local === 'std') {
      structural(b, ctx)
      const parts = els(b)
      if (parts.length !== 2 || parts[0]?.name.local !== 'std-ref' || parts[1]?.name.local !== 'title') { issue(b, ctx, '标准文献需要编号和标题'); continue }
      const fields = parts.map(part => ({ id: id(part, ctx), name: part.name.local, value: readInlineChildren(part, ctx) }))
      result.push({ kind: 'bibEntry', id: id(ref, ctx), content: fields.flatMap(f => f.value), entryType: 'standard', fields })
    } else if (b.name.local === 'mixed-citation') {
      const uris = named(b, 'uri')
      const uri = uris[0]
      if (uris.length && (uris.length !== 1 || b.children[b.children.length - 1] !== uri || els(uri!).length || uri!.attrs.length)) {
        issue(b, ctx, '文献 URI 必须是单个无样式的末尾链接')
        result.push({ kind: 'bibEntry', id: id(ref, ctx), content: readInlineChildren(b, ctx) })
      } else if (uri) {
        const content: IRInline[] = []
        for (const c of b.children) {
          if (c === uri) continue
          if (c.type === 'text') content.push({ text: c.value })
          else if (c.type === 'element') content.push(...(ctx.dispatchInline(c) ?? []))
        }
        const href = xmlTextContent(uri)
        result.push({ kind: 'bibEntry', id: id(ref, ctx), content, externalLink: { href, displayText: href } })
      } else result.push({ kind: 'bibEntry', id: id(ref, ctx), content: readInlineChildren(b, ctx) })
    } else issue(b, ctx, '未知文献类型')
  }
  return result
}
export function mapIndex(e: XmlElement, ctx: ImportContext): IRIndex | undefined {
  if (e.name.ns !== null || e.name.local !== 'index') return undefined
  structural(e, ctx)
  const titleGroup = named(e, 'index-title-group')[0]
  const title = titleGroup && named(titleGroup, 'title')[0]
  const groups = named(e, 'index-div').map(group => {
    structural(group, ctx)
    const tg = named(group, 'index-title-group')[0], label = tg && named(tg, 'title')[0]
    const entries = named(group, 'index-entry').map(entry => {
      structural(entry, ctx)
      const term = named(entry, 'term')[0]
      const targets: string[] = [], seeAlso: string[] = []
      const sourceReferences: Array<{ type: 'see' | 'seeAlso'; content: IRInline[] }> = []
      for (const c of els(entry)) {
        if (c === term) continue
        if (c.name.local !== 'see-entry' && c.name.local !== 'see-also' && c.name.local !== 'see-also-entry') { issue(c, ctx, '未知索引内容'); continue }
        const refs = named(c, 'xref')
        if (!refs.length) {
          sourceReferences.push({ type: c.name.local === 'see-entry' ? 'see' : 'seeAlso', content: readInlineChildren(c, ctx) })
          issue(c, ctx, '索引来源只有显示文字，编号变化时不会自动更新', true)
          continue
        }
        if (refs.length !== els(c).length || c.children.some(n => n.type === 'text' && n.value.trim())) { issue(c, ctx, '索引目标混合引用与其他内容'); continue }
        for (const ref of refs) {
          const rid = ctx.attr(ref, null, 'rid') ?? ''
          const element = ctx.index.elementsByXmlId.get(rid)
          const target = ctx.xmlTargetID(rid) ?? (element?.name.ns === null && element.name.local === 'index-entry' ? ctx.elementId(element) : undefined)
          if (target) (c.name.local === 'see-entry' ? targets : seeAlso).push(target)
          else issue(ref, ctx, '索引引用目标不存在')
        }
      }
      if (!term) issue(entry, ctx, '索引项缺少术语')
      if (sourceReferences.length && (targets.length || seeAlso.length)) issue(entry, ctx, '混合索引目标无法保留原始顺序')
      return { id: id(entry, ctx), term: term ? readInlineChildren(term, ctx) : [], targets, seeAlso, ...(sourceReferences.length ? { sourceReferences } : {}) }
    })
    if (els(group).some(c => c !== tg && c.name.local !== 'index-entry')) issue(group, ctx, '索引组包含未知结构')
    return { id: id(group, ctx), ...(label ? { label: readInlineChildren(label, ctx) } : {}), entries }
  })
  if (els(e).some(c => c !== titleGroup && c.name.local !== 'index-div')) issue(e, ctx, '索引包含未知结构')
  return { id: id(e, ctx), ...(title ? { title: readInlineChildren(title, ctx) } : {}), groups }
}
