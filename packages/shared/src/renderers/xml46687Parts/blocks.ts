/**
 * 段落、列项、注、示例、警告、摘录、代码（WP8.2 设计 §2.2 `p`、§2.4、§2.5）。
 *
 * - `p` 不带任何属性（M-E-25，V-18）；列表是 `p` 的兄弟块；
 * - 列项：`list-item/label` 取 `computeOrderedListMarkers` 的标记并把末尾全角“）”转半角（D-X-07）；
 *   `list-item` 仅被引用时写 `id`（`li_<k>`，经 `registerPendingId`）；
 * - 注/示例：`non-normative-note|example`，`label` 取 Resolver（“注：”“示例1：”），`id` 仅被引用时写；
 *   内容只收 `paragraph`、`list`（D-X-12）；
 * - 警告 `non-normative-note[@content-type="warning"]`、摘录 `disp-quote`、代码块 `code` 不写 id（R-5：Resolver 的 `ext_` 占位不读）。
 */

import type { IRCodeBlock, IRExample, IRList, IRNote, IRParagraph, IRQuote, IRWarning, IRBlock } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, sub, type RenderContext, type Site } from './context'

/** 放行（设计 §1.3.3）：`warning/quote/code` 三个块 kind 仅对 XML46687 放行（HTML/DOCX/XML 保持原状）。 */
export const XML46687_BLOCKS_BOUNDARY: Xml46687BoundaryContribution = {
  fields: {
    warning: ['kind', 'id', 'content'],
    quote: ['kind', 'id', 'content'],
    code: ['kind', 'id', 'language', 'text'],
  },
  declared: [
    { pathSuffix: '.kind', kind: 'kind', name: 'warning', matrixIds: ['M-5.6-03'], task: 'T2.4a', reason: '警告块写成 non-normative-note[@content-type="warning"]（5.6）' },
    { pathSuffix: '.kind', kind: 'kind', name: 'quote', matrixIds: ['M-5.9-01', 'M-5.9-02'], task: 'T2.4a', reason: '摘录块写成 disp-quote/p（5.9）' },
    { pathSuffix: '.kind', kind: 'kind', name: 'code', matrixIds: ['M-5.10-01'], task: 'T2.4a', reason: '代码块写成 code（5.10）' },
    // 唯一在字段表之外有意的分叉（outputBoundary.ts）：旧 XML 序列化器把罗马列项降为阿拉伯数字而阻断，XML46687 有 roman-lower
    { pathSuffix: '.listType', kind: 'field', name: 'listType', matrixIds: ['M-5.7-04'], task: 'T2.4a', reason: '小写罗马列项（roman）：旧 XML 阻断，XML46687 写成 list-type="roman-lower"（5.7.2）' },
  ],
}

const LIST_TYPES: Readonly<Record<string, string>> = {
  alpha: 'alpha-lower', number: 'arabic', roman: 'roman-lower', dash: 'dash', dot: 'bullet',
}
const ORDERED_LIST_TYPES = new Set(['alpha', 'number', 'roman'])

/** 有序列项标记的全角右括号转半角（D-X-07）：`a）` → `a)`；其余字符不变。 */
export function halfWidthMarker(marker: string): string {
  return marker.replace(/）$/, ')')
}

export function renderParagraph(block: IRParagraph, at: Site, ctx: RenderContext): XmlElement[] {
  return [el('p', undefined, ctx.renderInlines(block.content, sub(at, '.content'), 'p'))]
}

export function renderList(list: IRList, at: Site, ctx: RenderContext): XmlElement[] {
  const listType = LIST_TYPES[list.listType]
  if (listType === undefined) {
    ctx.report('xml-list-type-unsupported', 'error', `列项类型「${list.listType}」在 GB/T 46687.2 5.7 中没有对应的 list-type（只有 alpha-lower、arabic、roman-lower、dash、bullet），不能导出。`, at)
    return []
  }
  if (list.items.length === 0) {
    ctx.report('xml-list-empty', 'error', '列表没有任何列项（list 至少需要一个 list-item）。', at)
    return []
  }
  const ordered = ORDERED_LIST_TYPES.has(list.listType)
  const items = list.items.map((item, index): XmlElement => {
    const itemSite = sub(at, `.items[${index}]`, item.id)
    const children: Array<XmlElement | null> = []
    if (ordered) {
      const marker = ctx.orderedMarkers[item.id]
      if (marker === undefined || marker === '') {
        ctx.report('list-marker-missing', 'error', '有序列项没有标记（该层级的列项在默认编号策略下无标识），list-item/label 不能省略。', itemSite)
      } else {
        children.push(el('label', undefined, [halfWidthMarker(marker)]))
      }
    }
    if (item.content.length === 0) {
      ctx.report('empty-content', 'warning', '列项没有内容，已写出空的 p。', itemSite)
      children.push(el('p'))
    }
    item.content.forEach((child, position) => {
      children.push(...ctx.renderBlock(child, sub(itemSite, `.content[${position}]`, child.id)))
    })
    const element = el('list-item', undefined, children)
    ctx.registerPendingId(item.id, element, itemSite)
    return element
  })
  return [el('list', { 'list-type': listType }, items)]
}

/** 注/示例/警告内容：只收段落与列项（D-X-12），其余块报 `xml-note-content`。 */
export function renderNoteContent(blocks: readonly IRBlock[], at: Site, ctx: RenderContext, what: string): XmlElement[] {
  const out: XmlElement[] = []
  blocks.forEach((block, index) => {
    const blockSite = sub(at, `[${index}]`, block.id)
    if (block.kind === 'paragraph' || block.kind === 'list') out.push(...ctx.renderBlock(block, blockSite))
    else ctx.report('xml-note-content', 'error', `${what}内容里只能放段落和列项，不能放「${block.kind}」（GB/T 1.1 5.6；公式编号等不能进入注内）。`, blockSite)
  })
  if (blocks.length === 0) {
    ctx.report('empty-content', 'warning', `${what}没有内容，已写出空的 p。`, at)
    out.push(el('p'))
  }
  return out
}

function renderNoteOrExample(block: IRNote | IRExample, at: Site, ctx: RenderContext): XmlElement[] {
  const isNote = block.kind === 'note'
  const what = isNote ? '注' : '示例'
  const label = ctx.labelOf(block.id)
  if (!label || label.label === '') {
    ctx.report('xml-label-missing', 'error', `${what}在 labels 中没有标签（Resolver 应给出“${isNote ? '注：' : '示例：'}”）。`, at)
  }
  const element = el(isNote ? 'non-normative-note' : 'non-normative-example', undefined, [
    label && label.label !== '' ? el('label', undefined, [label.label]) : null,
    ...renderNoteContent(block.content, sub(at, '.content'), ctx, what),
  ])
  ctx.registerPendingId(block.id, element, at)
  return [element]
}

export function renderNote(block: IRNote, at: Site, ctx: RenderContext): XmlElement[] {
  return renderNoteOrExample(block, at, ctx)
}

export function renderExample(block: IRExample, at: Site, ctx: RenderContext): XmlElement[] {
  return renderNoteOrExample(block, at, ctx)
}

export function renderWarning(block: IRWarning, at: Site, ctx: RenderContext): XmlElement[] {
  return [el('non-normative-note', { 'content-type': 'warning' }, [
    el('label', undefined, ['警告：']),
    ...renderNoteContent(block.content, sub(at, '.content'), ctx, '警告'),
  ])]
}

export function renderQuote(block: IRQuote, at: Site, ctx: RenderContext): XmlElement[] {
  const paragraphs: XmlElement[] = []
  block.content.forEach((child, index) => {
    const childSite = sub(at, `.content[${index}]`, child.id)
    if (child.kind === 'paragraph') paragraphs.push(...ctx.renderBlock(child, childSite))
    else ctx.report('xml-quote-content', 'error', `摘录里只能放段落，不能放「${child.kind}」（5.9）。`, childSite)
  })
  if (block.content.length === 0) {
    ctx.report('empty-content', 'warning', '摘录没有内容，已写出空的 p。', at)
    paragraphs.push(el('p'))
  }
  return [el('disp-quote', undefined, paragraphs)]
}

export function renderCode(block: IRCodeBlock, at: Site, ctx: RenderContext): XmlElement[] {
  if (typeof block.language === 'string' && block.language !== '') {
    ctx.report('code-language-not-expressed', 'warning', `代码块的语言「${block.language}」在 GB/T 46687.2 5.10 中没有对应属性，未导出。`, at)
  }
  return [el('code', undefined, [block.text])]
}
