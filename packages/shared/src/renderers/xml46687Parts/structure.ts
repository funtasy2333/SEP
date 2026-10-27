/**
 * 根、前置页、章、条、附录与后置页（WP8.2 设计 §2.1、§2.2）。
 *
 * - `standard`：processing-meta → front（std-meta、前言、引言）→ body → back（app-group、参考文献、索引）；
 * - 章/条/附录的 `id` 一律取 Resolver 的 `labels[...].xmlId`；前言/引言的 id 是渲染器常量（`sec_foreword`、
 *   `sec_intro` 或有引言条时的 `sec_0`，R-6）；
 * - `sec` 内容三态（M-4.4.2.1-04，schema `cm.sec-content`）：块在前，遇到第一个子条/术语条后只接受尾部的
 *   注、示例、规范性引用清单，其他块是 error `xml-block-after-subsec`；
 * - 无标题条写 `sec-type="numbered-paragraph"` 且不写 `title`（V-2、V-17）。
 */

import type { IRAppendix, IRChapter, IRClause, IRClauseChild, IRInline, ResolvedLabel } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, inlineHasContent, site, sub, type RenderContext, type Site } from './context'
import { renderStdMeta, renderProcessingMeta } from './meta'
import { renderBibliography, renderIndex } from './refs'
import { renderTermEntry } from './terms'

export const XML46687_STRUCTURE_BOUNDARY: Xml46687BoundaryContribution = {
  fields: { front: ['introductionClauses'] },
  declared: [
    { pathSuffix: 'front.introductionClauses', kind: 'field', name: 'introductionClauses', matrixIds: ['M-4.3.4-02', 'M-4.3.4-03'], task: 'T2.4a', reason: '引言中的条写成 sec_0.<n>（4.3.4）' },
  ],
}

/** 取标签并核对 `label`/`xmlId` 都非空；缺失时报 `xml-label-missing`。 */
function requireLabel(ctx: RenderContext, id: string, at: Site, what: string): ResolvedLabel | undefined {
  const label = ctx.labelOf(id)
  if (!label || label.xmlId === '' || label.label === '') {
    ctx.report('xml-label-missing', 'error', `${what}在 Resolver 的 labels 中缺少编号或 xmlId（节点 ${id}）。`, at)
    return undefined
  }
  return label
}

function titleElement(ctx: RenderContext, title: readonly IRInline[], at: Site, what: string): XmlElement {
  if (!inlineHasContent(title)) {
    ctx.report('title-missing', 'warning', `${what}没有标题，已写出空的 title。`, sub(at, '.title'))
    return el('title')
  }
  return el('title', undefined, ctx.renderInlines(title, sub(at, '.title'), 'inline'))
}

// ---------------------------------------------------------------------------
// 章、条、附录
// ---------------------------------------------------------------------------

export function renderClause(clause: IRClause, at: Site, ctx: RenderContext): XmlElement {
  const label = requireLabel(ctx, clause.id, at, '条')
  const children: Array<XmlElement | null> = [label ? el('label', undefined, [label.label]) : null]
  if (clause.titled) {
    children.push(titleElement(ctx, clause.title, at, '条'))
  } else if (inlineHasContent(clause.title)) {
    ctx.report('title-ignored', 'warning', '无标题条（titled 为 false）带有标题文字，标题未导出（numbered-paragraph 的 sec 不能含 title）。', sub(at, '.title'))
  }
  children.push(...ctx.renderSectionContent(clause.children, sub(at, '.children')))
  return el('sec', { id: label?.xmlId, 'sec-type': clause.titled ? undefined : 'numbered-paragraph' }, children)
}

function renderChapter(chapter: IRChapter, at: Site, ctx: RenderContext): XmlElement {
  const label = requireLabel(ctx, chapter.id, at, '章')
  const previous = ctx.scope.chapter
  ctx.scope.chapter = chapter
  const content = ctx.renderSectionContent(chapter.children, sub(at, '.children'))
  ctx.scope.chapter = previous
  return el('sec', { id: label?.xmlId, 'sec-type': chapter.secType === 'general' ? undefined : chapter.secType }, [
    label ? el('label', undefined, [label.label]) : null,
    titleElement(ctx, chapter.title, at, '章'),
    ...content,
  ])
}

/** “附录A” → “附录 A”（C-S-07：Resolver 的标签不带空格，导出的 `label` 在“附录”后插入半角空格）。 */
function appendixLabelText(ctx: RenderContext, label: string, at: Site): string {
  if (!label.startsWith('附录')) {
    ctx.report('xml-label-missing', 'error', `附录的标签「${label}」不以“附录”开头，Resolver 契约被破坏。`, at)
    return label
  }
  const rest = label.slice(2)
  return rest.startsWith(' ') ? label : `附录 ${rest}`
}

function renderAppendix(appendix: IRAppendix, at: Site, ctx: RenderContext): XmlElement {
  const label = requireLabel(ctx, appendix.id, at, '附录')
  const previous = ctx.scope.appendix
  ctx.scope.appendix = appendix
  const content = ctx.renderSectionContent(appendix.children, sub(at, '.children'))
  ctx.scope.appendix = previous
  return el('app', { id: label?.xmlId, 'content-type': appendix.normative ? 'normative' : 'informative' }, [
    label ? el('label', undefined, [appendixLabelText(ctx, label.label, at)]) : null,
    el('annex-type', undefined, [appendix.normative ? '（规范性）' : '（资料性）']),
    titleElement(ctx, appendix.title, at, '附录'),
    ...content,
  ])
}

/**
 * `sec`/`app` 的内容（设计 §2.2 “sec 内容次序”）：块在前，然后是子条/术语条，最后是尾部的注、示例、`ref-list`。
 * 子条之后出现其他块是 `xml-block-after-subsec`（`hanging-paragraph` 是 Resolver 已有的同类 warning，此处是 error）。
 */
export function renderSectionContent(ctx: RenderContext, children: readonly IRClauseChild[], at: Site): XmlElement[] {
  const out: XmlElement[] = []
  let afterSubsection = false
  children.forEach((child, index) => {
    const childSite = sub(at, `[${index}]`, child.id)
    if (child.kind === 'clause') {
      afterSubsection = true
      out.push(renderClause(child, childSite, ctx))
    } else if (child.kind === 'termEntry') {
      afterSubsection = true
      out.push(...renderTermEntry(child, childSite, ctx))
    } else if (afterSubsection && child.kind !== 'note' && child.kind !== 'example' && child.kind !== 'normRefList') {
      ctx.report('xml-block-after-subsec', 'error', `子条之后不能再出现「${child.kind}」块（sec 内容为：块、子条、尾部的注/示例/清单）。`, childSite)
    } else {
      out.push(...ctx.renderBlock(child, childSite))
    }
  })
  return out
}

// ---------------------------------------------------------------------------
// 根
// ---------------------------------------------------------------------------

function renderFront(ctx: RenderContext): XmlElement {
  const front = ctx.doc.front
  const children: XmlElement[] = [renderStdMeta(ctx)]
  if (front.foreword.length > 0) {
    children.push(el('sec', { id: 'sec_foreword', 'sec-type': 'foreword' }, [
      el('title', undefined, ['前言']),
      ...ctx.renderSectionContent(front.foreword, site('doc.front.foreword')),
    ]))
  }
  const clauses = front.introductionClauses ?? []
  if (front.introduction.length > 0 || clauses.length > 0) {
    ctx.scope.introduction = true
    const blocks = ctx.renderSectionContent(front.introduction, site('doc.front.introduction'))
    const subsections = clauses.map((clause, index) => renderClause(clause, site(`doc.front.introductionClauses[${index}]`, clause.id), ctx))
    ctx.scope.introduction = false
    children.push(el('sec', { id: clauses.length > 0 ? 'sec_0' : 'sec_intro', 'sec-type': 'intro' }, [
      el('title', undefined, ['引言']),
      ...blocks,
      ...subsections,
    ]))
  }
  return el('front', undefined, children)
}

function renderBody(ctx: RenderContext): XmlElement {
  if (ctx.doc.body.length === 0) {
    ctx.report('xml-body-empty', 'error', '文档没有任何章（body 至少需要一个 sec）。', site('doc.body'))
  }
  return el('body', undefined, ctx.doc.body.map((chapter, index) => renderChapter(chapter, site(`doc.body[${index}]`, chapter.id), ctx)))
}

function renderBack(ctx: RenderContext): XmlElement | null {
  const appendices = ctx.doc.appendices
  const children: Array<XmlElement | null> = [
    appendices.length > 0
      ? el('app-group', undefined, appendices.map((appendix, index) => renderAppendix(appendix, site(`doc.appendices[${index}]`, appendix.id), ctx)))
      : null,
    renderBibliography(ctx),
    renderIndex(ctx),
  ]
  return children.some((child) => child !== null) ? el('back', undefined, children) : null
}

/** 根元素 `standard`（设计 §2.1）；命名空间声明由写出器的 `namespaces` 选项写在根上。 */
export function renderStandard(ctx: RenderContext): XmlElement {
  return el('standard', undefined, [renderProcessingMeta(), renderFront(ctx), renderBody(ctx), renderBack(ctx)])
}
