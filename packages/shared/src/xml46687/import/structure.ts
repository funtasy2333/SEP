import type { IRBlock, IRChapterChild, IRClause, IRClauseChild, IRDoc, IRInline, IRList } from '../../ir/types'
import { xmlTextContent } from '../tree'
import type { XmlDocument, XmlElement } from '../tree'
import type { ImportContext } from './context'
import { readInlineChildren } from './inline'
import { mapMetadata } from './metadata'

const elements = (el: XmlElement) => el.children.filter((c): c is XmlElement => c.type === 'element')
const is = (el: XmlElement, name: string) => el.name.ns === null && el.name.local === name
const report = (ctx: ImportContext, el: XmlElement, message: string, severity: 'error' | 'warning' = 'error') => ctx.report({ code: severity === 'error' ? 'xml-content-model' : 'xml-normalized', severity, message, xml: ctx.location(el) })
const id = (ctx: ImportContext, el: XmlElement) => ctx.elementId(el) ?? ''
const title = (ctx: ImportContext, el: XmlElement): IRInline[] => { const t = ctx.child(el, null, 'title'); return t ? readInlineChildren(t, ctx) : [] }

export function mapCoreBlock(element: XmlElement, ctx: ImportContext): IRBlock[] | undefined {
  if (element.name.ns !== null) return undefined
  const name = element.name.local
  if (name === 'p') return [{ kind: 'paragraph', id: id(ctx, element), content: readInlineChildren(element, ctx) }]
  if (name === 'list') {
    const listTypes: Record<string, IRList['listType']> = { 'alpha-lower': 'alpha', arabic: 'number', 'roman-lower': 'roman', dash: 'dash', bullet: 'dot' }
    const listType = listTypes[ctx.attr(element, null, 'list-type') ?? '']
    if (!listType) { report(ctx, element, '不支持的列项类型'); return [] }
    const items: IRList['items'] = []
    const listChildren = elements(element)
    const simpleList = listChildren.every(item => {
      const content = elements(item).filter(child => !is(child, 'label'))
      return is(item, 'list-item') && content.length === 1 && is(content[0]!, 'p')
    })
    for (const item of listChildren) {
      if (!is(item, 'list-item')) { ctx.dispatchBlock(item); continue }
      const kids = elements(item).filter(e => !is(e, 'label'))
      const content: IRList['items'][number]['content'] = []
      for (const child of kids) {
        if (is(child, 'p')) {
          const paragraphId = simpleList ? ctx.singleParagraphId(item) : ctx.elementId(child)
          content.push({ kind: 'paragraph', id: paragraphId ?? '', content: readInlineChildren(child, ctx) })
        } else if (is(child, 'list')) {
          const nested = ctx.dispatchBlock(child) ?? []
          for (const block of nested) if (block.kind === 'list') content.push(block); else report(ctx, child, '列项内仅允许段落和列表')
        } else { ctx.dispatchBlock(child); report(ctx, child, '列项内仅允许段落和列表') }
      }
      items.push({ id: id(ctx, item), content })
    }
    return [{ kind: 'list', id: id(ctx, element), listType, items }]
  }
  if (name === 'non-normative-note' || name === 'non-normative-example' || name === 'disp-quote' || name === 'warning') {
    const kind = name === 'disp-quote' ? 'quote' : name === 'warning' || ctx.attr(element, null, 'content-type') === 'warning' ? 'warning' : name === 'non-normative-example' ? 'example' : 'note'
    const children = elements(element).filter(e => !is(e, 'label'))
    const content: IRBlock[] = []
    for (const child of children) {
      if (kind === 'quote' && (is(child, 'attrib') || is(child, 'permissions'))) { report(ctx, child, '摘录来源或权限没有对应字段，已忽略', 'warning'); continue }
      if ((kind === 'note' || kind === 'example') && children.length === 1 && is(child, 'p')) {
        content.push({ kind: 'paragraph', id: ctx.singleParagraphId(element) ?? '', content: readInlineChildren(child, ctx) })
      } else content.push(...(ctx.dispatchBlock(child) ?? []))
    }
    return [{ kind, id: id(ctx, element), content }]
  }
  if (name === 'code' || name === 'preformat') {
    for (const child of elements(element)) report(ctx, child, '代码块内结构无法保真')
    return [{ kind: 'code', id: id(ctx, element), text: xmlTextContent(element), language: ctx.attr(element, null, 'language') }]
  }
  return undefined
}

function sectionChildren(element: XmlElement, ctx: ImportContext, level: number): IRClauseChild[] {
  const result: IRClauseChild[] = []
  let afterSection = false
  let afterTrailer = false
  for (const child of elements(element)) {
    if (is(child, 'label') || is(child, 'title') || is(child, 'annex-type')) continue
    if (is(child, 'sec') || is(child, 'term-sec')) {
      if (afterTrailer) report(ctx, child, '尾部注或示例之后不能出现条')
      afterSection = true
      if (is(child, 'sec')) { const c = clause(child, ctx, level); if (c) result.push(c) }
      else { const term = ctx.dispatchTerm(child); if (term) result.push(term) }
    } else {
      const blocks = ctx.dispatchBlock(child) ?? []
      if (afterSection && blocks.some(block => !['note', 'example', 'warning', 'normRefList'].includes(block.kind))) report(ctx, child, '子条之后的正文无法表示')
      if (afterSection && blocks.length > 0 && blocks.every(block => ['note', 'example', 'warning', 'normRefList'].includes(block.kind))) afterTrailer = true
      result.push(...blocks)
    }
  }
  return result
}
function clause(element: XmlElement, ctx: ImportContext, level: number): IRClause | undefined {
  if (level > 5) { report(ctx, element, '条的层级超过五级'); return undefined }
  const hasTitle = !!ctx.child(element, null, 'title')
  return { kind: 'clause', id: id(ctx, element), level: level as IRClause['level'], titled: hasTitle, title: title(ctx, element), children: sectionChildren(element, ctx, level + 1) }
}

export function mapStructure(tree: XmlDocument, ctx: ImportContext): IRDoc | undefined {
  const root = tree.root
  if (!is(root, 'standard')) return undefined
  for (const child of elements(root)) {
    if (!['processing-meta', 'front', 'body', 'back'].some(name => is(child, name))) report(ctx, child, '未知文档根级内容')
  }
  const front = ctx.child(root, null, 'front'), body = ctx.child(root, null, 'body')
  const metaElement = front && ctx.child(front, null, 'std-meta')
  if (!front || !body || !metaElement) { report(ctx, root, '缺少 front、std-meta 或 body'); return undefined }
  const meta = mapMetadata(metaElement, ctx)
  if (!meta) return undefined
  const doc: IRDoc = { schemaVersion: 1, meta, front: { foreword: [], introduction: [] }, body: [], appendices: [], bibliography: [] }
  for (const sec of elements(front)) {
    if (is(sec, 'std-meta')) continue
    if (!is(sec, 'sec')) { ctx.dispatchBlock(sec); continue }
    const type = ctx.attr(sec, null, 'sec-type')
    if (type !== 'foreword' && type !== 'intro') { report(ctx, sec, '未知前置节类型'); continue }
    const blocks = type === 'foreword' ? doc.front.foreword : doc.front.introduction
    let seenClause = false
    for (const child of elements(sec)) {
      if (is(child, 'title')) {
        const fixed = type === 'foreword' ? '前言' : '引言'
        if (xmlTextContent(child) !== fixed || elements(child).length > 0) report(ctx, child, '前言或引言标题无法保真')
        continue
      }
      if (is(child, 'label')) continue
      if (type === 'intro' && is(child, 'sec')) {
        seenClause = true
        const c = clause(child, ctx, 1)
        if (c) (doc.front.introductionClauses ??= []).push(c)
      } else {
        if (seenClause) report(ctx, child, '引言条之后的正文无法表示')
        blocks.push(...(ctx.dispatchBlock(child) ?? []))
      }
    }
  }
  for (const sec of elements(body)) {
    if (!is(sec, 'sec')) { ctx.dispatchBlock(sec); continue }
    const type = ctx.attr(sec, null, 'sec-type')
    let secType: 'scope' | 'norm-refs' | 'terms' | 'general' = 'general'
    if (type === 'scope' || type === 'terms' || type === 'norm-refs') secType = type
    else if (type === 'norm_refs') { secType = 'norm-refs'; report(ctx, sec, '规范性引用章类型已规范化', 'warning') }
    else if (type && type !== 'general') report(ctx, sec, '未知章类型按 general 处理', 'warning')
    doc.body.push({ kind: 'chapter', id: id(ctx, sec), secType, title: title(ctx, sec), children: sectionChildren(sec, ctx, 1) as IRChapterChild[] })
  }
  const back = ctx.child(root, null, 'back')
  if (back) for (const el of elements(back)) {
    if (is(el, 'app-group')) {
      for (const app of elements(el)) {
        if (!is(app, 'app')) { ctx.dispatchBlock(app); continue }
        const type = ctx.attr(app, null, 'content-type')
        if (!['normative', 'informative', 'inform-annex', 'inform_annex'].includes(type ?? '')) report(ctx, app, '未知附录类型')
        if (type === 'inform-annex' || type === 'inform_annex') report(ctx, app, '资料性附录类型已规范化', 'warning')
        doc.appendices.push({ kind: 'appendix', id: id(ctx, app), normative: type === 'normative', title: title(ctx, app), children: sectionChildren(app, ctx, 1) })
      }
    } else if (is(el, 'ref-list')) {
      doc.bibliography.push(...(ctx.dispatchReferences(el) ?? []))
      const t = ctx.child(el, null, 'title')
      if (t) {
        const content = readInlineChildren(t, ctx)
        const plainDefault = content.map(run => run.text).join('') === '参考文献' && content.every(run => Object.keys(run).every(key => key === 'text'))
        if (!plainDefault) doc.bibliographyTitle = content
      }
    } else if (is(el, 'index')) doc.index = ctx.dispatchIndex(el)
    else ctx.dispatchBlock(el)
  }
  return doc
}
