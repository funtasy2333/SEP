import { assertOutputSupported } from './outputBoundary'
/**
 * HTML 渲染器（Phase 5.5 / WP4）。
 *
 * renderHtml(doc, labels, opts) → 语义 HTML 字符串。无状态纯函数：
 * 同样输入产出字节级相同输出。**不含任何编号逻辑**（全局不变式 2）——
 * 章/条/图/表/公式/注/附录/参考文献编号一律取自 labels 中的现成字符串。
 *
 * 两种变体（opts.variant）：
 * - 'screen'：用于编辑器预览与语义 HTML 导出；交叉引用为 <a> 内部链接，目次条目带链接。
 * - 'print'：用于 WP5 PDF 出件管线；**不含任何内部链接**（WP0 结论 1：内部链接与命名横排页互斥），
 *   交叉引用输出纯文本（labels.refText），目次页码列为定宽占位（WP5 两遍构建注入数字）。
 *
 * 公式不在此渲染 KaTeX（KaTeX 依赖 DOM 字体度量不可靠，WP0 结论 6）：
 * 输出 <span class="ses-formula" data-latex="..."> 占位，由消费端（client 预览 / WP5 管线）渲染。
 *
 * 同构纯 TypeScript：不引用任何浏览器/Node API。
 */

import type {
  IRAppendix,
  IRBibEntry,
  IRBlock,
  IRChapter,
  IRChapterChild,
  IRClause,
  IRClauseChild,
  IRDoc,
  IRDocMeta,
  IRFigure,
  IRFormula,
  IRInline,
  IRList,
  IRNote,
  IRExample,
  IRParagraph,
  IRTable,
  IRTableRow,
  IRTermEntry,
  NodeId,
  ResolvedLabel,
} from '../ir/types'
import { MISSING_ID_PREFIX } from '../ir/pmToIr'
import { printCss } from './printCss'
import { assertFootnoteReferences, orderTableFootnotes, tableColumnCount } from './footnotes'

export type HtmlVariant = 'screen' | 'print'

export interface RenderHtmlOptions {
  /** 渲染变体，默认 'screen' */
  variant?: HtmlVariant
}

type Labels = Record<NodeId, ResolvedLabel>

// ---------- 转义 ----------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

// ---------- 渲染上下文 ----------

class RenderCtx {
  out: string[] = []
  readonly labels: Labels
  readonly variant: HtmlVariant
  readonly anchorCounts: Map<string, number>
  readonly collectingAnchors: boolean
  constructor(
    labels: Labels,
    variant: HtmlVariant,
    anchorCounts: Map<string, number> = new Map(),
    collectingAnchors = false,
  ) {
    this.labels = labels
    this.variant = variant
    this.anchorCounts = anchorCounts
    this.collectingAnchors = collectingAnchors
  }

  push(line: string): void {
    if (!this.collectingAnchors) this.out.push(line)
  }

  label(id: NodeId): string {
    return this.labels[id]?.label ?? ''
  }

  xmlId(id: NodeId): string {
    return this.labels[id]?.xmlId ?? ''
  }

  anchorIdAttr(xmlId: string): string {
    if (!xmlId) return ''
    if (this.collectingAnchors) {
      this.anchorCounts.set(xmlId, (this.anchorCounts.get(xmlId) ?? 0) + 1)
      return ''
    }
    return this.hasUniqueAnchor(xmlId) ? ' id="' + escapeAttr(xmlId) + '"' : ''
  }

  hasUniqueAnchor(xmlId: string): boolean {
    return !!xmlId && !this.collectingAnchors && this.anchorCounts.get(xmlId) === 1
  }

  /** 临时切换输出缓冲，捕获 fn 的渲染结果为字符串（用于注/示例的行内内容拼接） */
  capture(fn: () => void): string {
    const prev = this.out
    this.out = []
    fn()
    const captured = this.out.join('')
    this.out = prev
    return captured
  }
}

/** data-node-id 属性；占位 ID（缺失节点）不输出 */
function idAttr(id: NodeId): string {
  if (!id || id.startsWith(MISSING_ID_PREFIX)) return ''
  return ` data-node-id="${escapeAttr(id)}"`
}

/** 锚点 id 属性（用于交叉引用目标），取 labels.xmlId */
function anchorAttr(ctx: RenderCtx, id: NodeId): string {
  return ctx.anchorIdAttr(ctx.xmlId(id))
}

// ---------- 行内 ----------

function applyTextMarks(text: string, marks: IRInline['marks']): string {
  let out = text
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = `<strong>${out}</strong>`
        break
      case 'italic':
        out = `<em>${out}</em>`
        break
      case 'underline':
        out = `<u>${out}</u>`
        break
      case 'sub':
        out = `<sub>${out}</sub>`
        break
      case 'sup':
        out = `<sup>${out}</sup>`
        break
    }
  }
  return out
}

function renderRun(run: IRInline, ctx: RenderCtx): string {
  const marks = run.marks ?? []

  // Keep the ordinary text/crossRef output on its existing path, then append
  // the separate atom nodes in the same order as irToPm: body footnote, then
  // each table-footnote reference. Atom marks never style the source text.
  const xref = marks.find((m) => m.type === 'crossRef')
  let body = ''
  if (xref && xref.type === 'crossRef') {
    const target = xref.targetId
    const resolved = ctx.labels[target]
    // 渲染文本取 Resolver 解析的 refText（不存死文本）；目标缺编号时回退作者原文，避免空白
    const refText = resolved ? resolved.refText : run.text
    const inner = applyTextMarks(
      escapeHtml(refText),
      marks.filter((m) => m.type !== 'crossRef' && m.type !== 'tableFootnoteRef'),
    )
    // print 变体不输出内部链接（WP0 结论 1）
    if (ctx.variant === 'screen' && resolved && ctx.hasUniqueAnchor(resolved.xmlId)) {
      body = '<a class="ses-xref" href="#' + escapeAttr(resolved.xmlId) + '" data-ref-target="' + escapeAttr(target) + '">' + inner + '</a>'
    } else {
      body = `<span class="ses-xref" data-ref-target="${escapeAttr(target)}">${inner}</span>`
    }
  } else if (run.text === '\n') {
    body = '<br />'
  } else {
    const bodyMarks = marks.filter((mark) => mark.type !== 'tableFootnoteRef')
    body = run.text.split('\n').map((part, index, parts) =>
      `${part ? applyTextMarks(escapeHtml(part), bodyMarks) : ''}${index < parts.length - 1 ? '<br />' : ''}`,
    ).join('')
  }

  let footnoteAtom = ''
  if (run.footnote) {
    const resolved = ctx.labels[run.footnote.id]
    if (!resolved || !/^fn_\d+$/.test(resolved.xmlId)) {
      throw new Error(`renderHtml: 条文脚注 "${run.footnote.id}" 缺少有效的 resolver 编号`)
    }
    const content = renderInlines(run.footnote.content, ctx)
    const attrs = 'role="doc-footnote"' + ctx.anchorIdAttr(resolved.xmlId) + ' data-label="' + escapeAttr(resolved.refText) + '"'
    if (ctx.variant === 'screen') {
      footnoteAtom = `<span class="ses-footnote" ${attrs}>${content}</span>`
    } else {
      footnoteAtom = `<span class="ses-footnote" ${attrs}><span class="ses-footnote-marker"><sup>${escapeHtml(resolved.refText)}</sup></span><span class="ses-footnote-text">${content}</span></span>`
    }
  }

  let tableFootnoteAtoms = ''
  for (const mark of marks) {
    if (mark.type !== 'tableFootnoteRef') continue
    const resolved = ctx.labels[mark.targetId]
    if (!resolved || !resolved.xmlId.startsWith('tabfn_')) {
      throw new Error(`renderHtml: 表脚注 "${mark.targetId}" 缺少有效的 resolver 编号`)
    }
    const marker = `<sup class="ses-table-footnote-call">${escapeHtml(resolved.refText)}</sup>`
    tableFootnoteAtoms += ctx.variant === 'screen' && ctx.hasUniqueAnchor(resolved.xmlId)
      ? `<a class="ses-table-footnote-ref" href="#${escapeAttr(resolved.xmlId)}">${marker}</a>`
      : marker
  }
  return `${body}${footnoteAtom}${tableFootnoteAtoms}`
}

function renderInlines(inlines: IRInline[], ctx: RenderCtx): string {
  return inlines.map((run) => renderRun(run, ctx)).join('')
}

/** 把若干块当作行内内容拼接：段落取其 inline，其余块按块渲染（注/示例/无题条首段用） */
function renderBlocksInline(blocks: IRBlock[], ctx: RenderCtx): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      const anchor = anchorAttr(ctx, block.id)
      const content = renderInlines(block.content, ctx)
      parts.push(anchor
        ? '<span class="ses-paragraph-inline"' + idAttr(block.id) + anchor + '>' + content + '</span>'
        : content)
    } else {
      parts.push(ctx.capture(() => renderBlock(block, ctx)))
    }
  }
  return parts.join('')
}

// ---------- 块级 ----------

function renderParagraph(p: IRParagraph, ctx: RenderCtx): void {
  ctx.push(`<p class="ses-paragraph" data-type="paragraph"${idAttr(p.id)}${anchorAttr(ctx, p.id)}>${renderInlines(p.content, ctx)}</p>`)
}

function renderList(list: IRList, ctx: RenderCtx): void {
  ctx.push(
    `<div class="ses-list ses-list-${list.listType}" data-type="list" data-list-type="${list.listType}"${list.level === 2 ? ' data-level="2"' : ''}${idAttr(list.id)}${anchorAttr(ctx, list.id)}>`,
  )
  for (const item of list.items) {
    ctx.push(`<div class="ses-list-item"${idAttr(item.id)}${anchorAttr(ctx, item.id)}>`)
    for (const child of item.content) {
      if (child.kind === 'paragraph') {
        ctx.push(`<span class="ses-list-item-text"${anchorAttr(ctx, child.id)}>${renderInlines(child.content, ctx)}</span>`)
      } else {
        renderList(child, ctx)
      }
    }
    ctx.push('</div>')
  }
  ctx.push('</div>')
}

function renderTableRows(rows: IRTableRow[], section: 'thead' | 'tbody', ctx: RenderCtx): void {
  for (const row of rows) {
    ctx.push('<tr' + anchorAttr(ctx, row.id) + '>')
    for (const cell of row.cells) {
      const tag = cell.header ? 'th' : 'td'
      const attrs: string[] = []
      if (cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`)
      if (cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`)
      // 表头单元格补 scope 提升可访问性：thead 内为列表头，tbody 内的表头单元格为行表头
      if (cell.header) attrs.push(`scope="${section === 'thead' ? 'col' : 'row'}"`)
      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''
      const content = renderBlocksInline(cell.content, ctx)
      ctx.push('<' + tag + attrStr + anchorAttr(ctx, cell.id) + '>' + content + '</' + tag + '>')
    }
    ctx.push('</tr>')
  }
}

function renderTable(table: IRTable, ctx: RenderCtx): void {
  const landscape = table.orientation === 'landscape'
  if (landscape) ctx.push('<div class="ses-landscape">')
  ctx.push(`<div class="ses-table-block" data-type="table" data-orientation="${table.orientation}"${idAttr(table.id)}>`)

  const captionLabel = ctx.label(table.id)
  const captionText = renderInlines(table.caption, ctx)
  ctx.push(
    `<div class="ses-table-caption">${escapeHtml(captionLabel)}${captionText ? '　' + captionText : ''}</div>`,
  )
  // 表题英文仅 screen 预览输出；print 表题只排中文（10.4.2、表 F.1 #36）
  if (table.captionEn && table.captionEn.length > 0 && ctx.variant === 'screen') {
    ctx.push(`<div class="ses-table-caption-en" lang="en">${renderInlines(table.captionEn, ctx)}</div>`)
  }

  ctx.push(`<table${anchorAttr(ctx, table.id)}>`)
  // 跨页重复表头（含「关于单位的陈述」若其作为表头行存在）：headerRowCount 行进 thead
  const headerCount = Math.min(Math.max(table.headerRowCount, 0), table.rows.length)
  if (headerCount > 0) {
    ctx.push('<thead>')
    renderTableRows(table.rows.slice(0, headerCount), 'thead', ctx)
    ctx.push('</thead>')
  }
  if (headerCount < table.rows.length) {
    ctx.push('<tbody>')
    renderTableRows(table.rows.slice(headerCount), 'tbody', ctx)
    ctx.push('</tbody>')
  }
  const sortedFootnotes = orderTableFootnotes(table.footnotes ?? [], ctx.labels)
  if (table.notes.length > 0 || sortedFootnotes.length > 0) {
    const colspan = tableColumnCount(table)
    ctx.push('<tfoot>')
    if (table.notes.length > 0) {
      const notes = table.notes.map((note) => ctx.capture(() => renderNote(note, ctx))).join('')
      ctx.push(`<tr class="ses-table-notes"><td colspan="${colspan}">${notes}</td></tr>`)
    }
    if (sortedFootnotes.length > 0) {
      const notes = sortedFootnotes.map((footnote) => {
        const resolved = ctx.labels[footnote.id]
        if (!resolved) throw new Error(`renderHtml: 表脚注 "${footnote.id}" 在 labels 中没有编号`)
        return `<div class="ses-table-footnote"${ctx.anchorIdAttr(resolved.xmlId)}><span class="ses-table-footnote-marker"><sup>${escapeHtml(resolved.refText)}</sup></span><span class="ses-table-footnote-text">${renderInlines(footnote.content, ctx)}</span></div>`
      }).join('')
      ctx.push(`<tr class="ses-table-footnotes"><td colspan="${colspan}">${notes}</td></tr>`)
    }
    ctx.push('</tfoot>')
  }
  ctx.push('</table>')
  ctx.push('</div>')
  if (landscape) ctx.push('</div>')
}

function renderFigure(fig: IRFigure, ctx: RenderCtx): void {
  const landscape = fig.orientation === 'landscape'
  if (landscape) ctx.push('<div class="ses-landscape">')
  ctx.push(
    `<figure class="ses-figure-block" data-type="figure" data-orientation="${fig.orientation}"${idAttr(fig.id)}${anchorAttr(ctx, fig.id)}>`,
  )
  const alt = escapeAttr(fig.caption.map((r) => r.text).join(''))
  ctx.push(`<img class="ses-figure-image" src="${escapeAttr(fig.src)}" alt="${alt}" />`)
  const captionLabel = ctx.label(fig.id)
  const captionText = renderInlines(fig.caption, ctx)
  ctx.push(
    `<figcaption class="ses-figure-caption">${escapeHtml(captionLabel)}${captionText ? '　' + captionText : ''}</figcaption>`,
  )
  // 图题英文仅 screen 预览输出；print 图题只排中文（10.4.2、表 F.1 #36）
  if (fig.captionEn && fig.captionEn.length > 0 && ctx.variant === 'screen') {
    ctx.push(`<figcaption class="ses-figure-caption-en" lang="en">${renderInlines(fig.captionEn, ctx)}</figcaption>`)
  }
  for (const note of fig.notes) renderNote(note, ctx)
  ctx.push('</figure>')
  if (landscape) ctx.push('</div>')
}

function renderFormula(formula: IRFormula, ctx: RenderCtx): void {
  const numbered = formula.numbered && !!ctx.labels[formula.id]
  ctx.push(
    `<div class="ses-formula-block" data-type="formula"${idAttr(formula.id)}${anchorAttr(ctx, formula.id)}>`,
  )
  // KaTeX 占位（消费端渲染）；data-latex 保留原文
  ctx.push(`<span class="ses-formula" data-latex="${escapeAttr(formula.latex)}"></span>`)
  if (numbered) {
    ctx.push(`<span class="ses-formula-num">${escapeHtml(ctx.label(formula.id))}</span>`)
  }
  ctx.push('</div>')

  if (formula.whereList.length > 0) {
    ctx.push('<div class="ses-where">')
    ctx.push('<p class="ses-where-intro">式中：</p>')
    ctx.push('<dl class="ses-where-list">')
    for (const item of formula.whereList) {
      ctx.push(
        `<dt${idAttr(item.id)}${anchorAttr(ctx, item.id)}>${renderInlines(item.term, ctx)}</dt><dd>${renderInlines(item.definition, ctx)}</dd>`,
      )
    }
    ctx.push('</dl>')
    ctx.push('</div>')
  }
}

function renderNote(note: IRNote, ctx: RenderCtx): void {
  const marker = ctx.label(note.id) || '注：'
  ctx.push(
    `<div class="ses-note" data-type="note"${idAttr(note.id)}${anchorAttr(ctx, note.id)}><span class="ses-note-marker">${escapeHtml(marker)}</span>${renderBlocksInline(note.content, ctx)}</div>`,
  )
}

function renderExample(example: IRExample, ctx: RenderCtx): void {
  const marker = ctx.label(example.id) || '示例：'
  ctx.push(
    `<div class="ses-example" data-type="example"${idAttr(example.id)}${anchorAttr(ctx, example.id)}><span class="ses-example-marker">${escapeHtml(marker)}</span>${renderBlocksInline(example.content, ctx)}</div>`,
  )
}

function renderBlock(block: IRBlock, ctx: RenderCtx): void {
  switch (block.kind) {
    case 'paragraph':
      renderParagraph(block, ctx)
      break
    case 'list':
      renderList(block, ctx)
      break
    case 'table':
      renderTable(block, ctx)
      break
    case 'figure':
      renderFigure(block, ctx)
      break
    case 'formula':
      renderFormula(block, ctx)
      break
    case 'note':
      renderNote(block, ctx)
      break
    case 'example':
      renderExample(block, ctx)
      break
  }
}

// ---------- 术语条目 ----------

function renderTermEntry(entry: IRTermEntry, ctx: RenderCtx): void {
  ctx.push(`<div class="ses-term-entry" data-type="term-entry"${idAttr(entry.id)}${anchorAttr(ctx, entry.id)}>`)
  // 三段式（10.3.5）：①编号独占一行、顶格
  ctx.push(`<p class="ses-term-num-line">${escapeHtml(ctx.label(entry.id))}</p>`)
  // ②术语 + 空一个汉字 + 英文对应词（同一行；英文行内、黑体五号，仅当存在时附 U+3000 接排）
  const termHtml = `<span class="ses-term-name">${renderInlines(entry.term, ctx)}</span>`
  const enHtml =
    entry.termEn && entry.termEn.length > 0
      ? `　<span class="ses-term-name-en" lang="en">${renderInlines(entry.termEn, ctx)}</span>`
      : ''
  ctx.push(`<p class="ses-term-head">${termHtml}${enHtml}</p>`)
  for (const block of entry.definition) {
    if (block.kind === 'paragraph') {
      ctx.push(`<p class="ses-term-def"${idAttr(block.id)}${anchorAttr(ctx, block.id)}>${renderInlines(block.content, ctx)}</p>`)
    } else {
      renderBlock(block, ctx)
    }
  }
  if (entry.source && entry.source.length > 0) {
    ctx.push(`<p class="ses-term-source">${renderInlines(entry.source, ctx)}</p>`)
  }
  for (const note of entry.notes) renderNote(note, ctx)
  for (const example of entry.examples) renderExample(example, ctx)
  ctx.push('</div>')
}

// ---------- 条 / 章 / 附录 ----------

function renderClauseChild(child: IRClauseChild, ctx: RenderCtx): void {
  if (child.kind === 'clause') renderClause(child, ctx)
  else if (child.kind === 'termEntry') renderTermEntry(child, ctx)
  else renderBlock(child, ctx)
}

function renderClause(clause: IRClause, ctx: RenderCtx): void {
  const hLevel = Math.min(clause.level + 2, 6)
  ctx.push(
    `<section class="ses-clause ses-clause-l${clause.level}" data-type="clause" data-level="${clause.level}" data-titled="${clause.titled}"${idAttr(clause.id)}${anchorAttr(ctx, clause.id)}>`,
  )
  if (clause.titled) {
    ctx.push(
      `<h${hLevel} class="ses-clause-title"><span class="ses-num">${escapeHtml(ctx.label(clause.id))}</span>${renderInlines(clause.title, ctx)}</h${hLevel}>`,
    )
    for (const child of clause.children) renderClauseChild(child, ctx)
  } else {
    // 无题条（GB/T 1.1 5.3.3.6）：仅有编号，无标题。编号与首段排在同一行。
    const numHtml = `<span class="ses-clause-num-only">${escapeHtml(ctx.label(clause.id))}</span>`
    const [first, ...rest] = clause.children
    if (first && first.kind === 'paragraph') {
      // 无题条首段：编号顶格起排、不缩进（.ses-clause-numbered-para text-indent:0），编号后空一字（num-only margin-right:1em）接条文
      ctx.push(`<p class="ses-clause-numbered-para" data-type="paragraph"${idAttr(first.id)}${anchorAttr(ctx, first.id)}>${numHtml}${renderInlines(first.content, ctx)}</p>`)
      for (const child of rest) renderClauseChild(child, ctx)
    } else {
      ctx.push(numHtml)
      for (const child of clause.children) renderClauseChild(child, ctx)
    }
  }
  ctx.push('</section>')
}

function renderChapterChild(child: IRChapterChild, ctx: RenderCtx): void {
  renderClauseChild(child, ctx)
}

function renderChapter(chapter: IRChapter, ctx: RenderCtx): void {
  ctx.push(
    `<section class="ses-chapter" data-type="chapter" data-sec-type="${chapter.secType}"${idAttr(chapter.id)}${anchorAttr(ctx, chapter.id)}>`,
  )
  ctx.push(
    `<h2 class="ses-chapter-title"><span class="ses-num">${escapeHtml(ctx.label(chapter.id))}</span>${renderInlines(chapter.title, ctx)}</h2>`,
  )
  for (const child of chapter.children) renderChapterChild(child, ctx)
  ctx.push('</section>')
}

function renderAppendix(appendix: IRAppendix, ctx: RenderCtx): void {
  ctx.push(
    `<section class="ses-appendix" data-type="appendix" data-normative="${appendix.normative}"${idAttr(appendix.id)}${anchorAttr(ctx, appendix.id)} role="doc-appendix">`,
  )
  ctx.push(`<div class="ses-appendix-label">${escapeHtml(ctx.label(appendix.id))}</div>`)
  ctx.push(`<div class="ses-appendix-kind">（${appendix.normative ? '规范性' : '资料性'}）</div>`)
  ctx.push(`<h2 class="ses-appendix-title">${renderInlines(appendix.title, ctx)}</h2>`)
  for (const child of appendix.children) renderClauseChild(child, ctx)
  ctx.push('</section>')
}

// ---------- 参考文献 ----------

/** bib_<n> → n，用于按引用顺序（bibliographyOrder）重排展示，无需额外传参 */
function bibSeq(ctx: RenderCtx, id: NodeId): number {
  const m = /(\d+)$/.exec(ctx.xmlId(id))
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

function renderBibliography(entries: IRBibEntry[], ctx: RenderCtx): void {
  if (entries.length === 0) return
  ctx.push('<section class="ses-bibliography" data-type="bibliography"' + ctx.anchorIdAttr('sec_bibliography') + ' role="doc-bibliography">')
  ctx.push('<h2 class="ses-bib-title">参考文献</h2>')
  const ordered = [...entries].sort((a, b) => bibSeq(ctx, a.id) - bibSeq(ctx, b.id))
  for (const entry of ordered) {
    ctx.push(
      `<div class="ses-bib-entry"${idAttr(entry.id)}${anchorAttr(ctx, entry.id)}>${escapeHtml(ctx.label(entry.id))}　${renderInlines(entry.content, ctx)}</div>`,
    )
  }
  ctx.push('</section>')
}

// ---------- 目次 ----------

interface TocEntry {
  level: 1 | 2 | 3
  text: string // 已转义的 HTML 文本（含编号）
  anchor: string // 目标锚点 id
}

function tocText(label: string, title: IRInline[]): string {
  const t = title.map((r) => r.text).join('')
  const labelHtml = escapeHtml(label)
  const titleHtml = escapeHtml(t)
  return label && t ? `${labelHtml}　${titleHtml}` : labelHtml || titleHtml
}

function collectToc(doc: IRDoc, ctx: RenderCtx): TocEntry[] {
  const entries: TocEntry[] = []
  if (doc.front.foreword.length > 0) entries.push({ level: 1, text: '前言', anchor: 'front_foreword' })
  if (doc.front.introduction.length > 0) entries.push({ level: 1, text: '引言', anchor: 'front_intro' })
  for (const chapter of doc.body) {
    entries.push({ level: 1, text: tocText(ctx.label(chapter.id), chapter.title), anchor: ctx.xmlId(chapter.id) })
    for (const child of chapter.children) {
      if (child.kind !== 'clause') continue
      entries.push({ level: 2, text: tocText(ctx.label(child.id), child.title), anchor: ctx.xmlId(child.id) })
      for (const grand of child.children) {
        if (grand.kind === 'clause' && grand.titled) {
          entries.push({ level: 3, text: tocText(ctx.label(grand.id), grand.title), anchor: ctx.xmlId(grand.id) })
        }
      }
    }
  }
  for (const appendix of doc.appendices) {
    const label = ctx.label(appendix.id)
    const kind = appendix.normative ? '（规范性）' : '（资料性）'
    const title = appendix.title.map((r) => r.text).join('')
    entries.push({
      level: 1,
      text: `${escapeHtml(label)}　${escapeHtml(kind)}${escapeHtml(title)}`,
      anchor: ctx.xmlId(appendix.id),
    })
  }
  if (doc.bibliography.length > 0) entries.push({ level: 1, text: '参考文献', anchor: 'sec_bibliography' })
  return entries
}

function renderToc(doc: IRDoc, ctx: RenderCtx): void {
  const entries = collectToc(doc, ctx)
  if (entries.length === 0) return
  ctx.push('<nav class="ses-toc" data-type="toc"' + ctx.anchorIdAttr('front_toc') + '>')
  // 前置标题两字间空一个全角字（图 E.8/E.9：目　次/前　言/引　言）；16pt 为字号非字距
  ctx.push('<h1 class="ses-front-heading">目　次</h1>')
  ctx.push('<ol class="ses-toc-list">')
  for (const entry of entries) {
    ctx.push(`<li class="ses-toc-item ses-toc-l${entry.level}">`)
    if (ctx.variant === 'screen' && ctx.hasUniqueAnchor(entry.anchor)) {
      ctx.push(`<a class="ses-toc-text" href="#${escapeAttr(entry.anchor)}">${entry.text}</a>`)
    } else if (ctx.variant === 'screen') {
      ctx.push(`<span class="ses-toc-text">${entry.text}</span>`)
    } else {
      ctx.push(`<span class="ses-toc-text">${entry.text}</span>`)
      // 定宽页码占位（WP5 两遍构建注入纯文本数字；定宽保证两遍分页不漂移）
      ctx.push(`<span class="ses-toc-page" data-target="${escapeAttr(entry.anchor)}">　</span>`)
    }
    ctx.push('</li>')
  }
  ctx.push('</ol>')
  ctx.push('</nav>')
}

// ---------- 前置部分 ----------

function renderFront(doc: IRDoc, ctx: RenderCtx): void {
  ctx.push('<div class="ses-front-matter">')
  renderToc(doc, ctx)
  if (doc.front.foreword.length > 0) {
    ctx.push('<section class="ses-foreword" data-type="foreword"' + ctx.anchorIdAttr('front_foreword') + ' role="doc-foreword">')
    ctx.push('<h1 class="ses-front-heading">前　言</h1>')
    for (const block of doc.front.foreword) renderBlock(block, ctx)
    ctx.push('</section>')
  }
  if (doc.front.introduction.length > 0) {
    ctx.push('<section class="ses-introduction" data-type="introduction"' + ctx.anchorIdAttr('front_intro') + ' role="doc-introduction">')
    ctx.push('<h1 class="ses-front-heading">引　言</h1>')
    for (const block of doc.front.introduction) renderBlock(block, ctx)
    ctx.push('</section>')
  }
  ctx.push('</div>')
}

// ---------- 正文部分 ----------

/** 取一组章/条/术语/块级子节点中「末个块级末裔」（用于判断文末要素朝向）。 */
function lastChildBlock(children: IRClauseChild[]): IRBlock | undefined {
  const last = children[children.length - 1]
  if (!last) return undefined
  if (last.kind === 'clause') return lastChildBlock(last.children)
  if (last.kind === 'termEntry') return undefined // 术语末裔为注/示例，非横排
  return last
}

/**
 * 文档最后一个要素是否为横排（landscape）表/图。
 * 渲染顺序：正文章 → 附录 → 参考文献；参考文献条目非块级、恒为竖排。
 * 终结线据此决定是否包入横排命名页上下文，避免回到竖排 body 页另起空白终结线页。
 */
function lastBlockIsLandscape(doc: IRDoc): boolean {
  if (doc.bibliography.length > 0) return false
  const container =
    doc.appendices.length > 0
      ? doc.appendices[doc.appendices.length - 1]
      : doc.body.length > 0
        ? doc.body[doc.body.length - 1]
        : undefined
  if (!container) return false
  const last = lastChildBlock(container.children)
  return (
    !!last &&
    (last.kind === 'table' || last.kind === 'figure') &&
    last.orientation === 'landscape'
  )
}

function renderBody(doc: IRDoc, ctx: RenderCtx): void {
  ctx.push('<div class="ses-body-content">')
  // 正文首页隐藏哨兵锚点（仅 print）：供 PDF 出件管线两遍构建稳健定位正文起始物理页，
  // 不受文件名称文本在前言/引言中复现的影响。CSS 使其透明、零高度，不影响版式但可被
  // pdftotext 提取。锚点文本须与服务端 packages/server/src/convert/pdf/toc.ts 的
  // BODY_START_SENTINEL 严格一致（跨包字符串契约，二者必须同步修改）。
  if (ctx.variant === 'print') {
    ctx.push('<span class="ses-body-anchor" aria-hidden="true">SESBODYSTARTANCHOR</span>')
  }
  // 正文首页文件名称（三号黑体居中）
  if (doc.meta.title) {
    ctx.push('<div class="ses-doc-title-block">')
    ctx.push(`<h1 class="ses-doc-title">${escapeHtml(doc.meta.title)}</h1>`)
    // 英文译名仅在封面（表 F.1 #09）；正文首页 print 不输出，screen 预览保留（IR 字段不删）
    if (doc.meta.titleEn && ctx.variant === 'screen') {
      ctx.push(`<h1 class="ses-doc-title ses-doc-title-en" lang="en">${escapeHtml(doc.meta.titleEn)}</h1>`)
    }
    ctx.push('</div>')
  }
  for (const chapter of doc.body) renderChapter(chapter, ctx)
  for (const appendix of doc.appendices) renderAppendix(appendix, ctx)
  renderBibliography(doc.bibliography, ctx)
  // 终结线（10.1.5）：文件最后一个要素之下，居中粗实线，与末要素同页（CSS break-before: avoid）。
  // 若末要素为横排表/图，终结线须留在同一横排命名页上下文，否则回到竖排 body 页会另起空白终结线页。
  const endMark = '<div class="ses-end-mark" role="presentation"></div>'
  if (lastBlockIsLandscape(doc)) {
    ctx.push('<div class="ses-landscape">')
    ctx.push(endMark)
    ctx.push('</div>')
  } else {
    ctx.push(endMark)
  }
  ctx.push('</div>')
}

// ---------- 文档元数据属性 ----------

function metaAttrs(meta: IRDocMeta): string {
  const attrs: string[] = []
  if (meta.stdCode) attrs.push(`data-standard-no="${escapeAttr(meta.stdCode)}"`)
  if (meta.icsCode) attrs.push(`data-ics="${escapeAttr(meta.icsCode)}"`)
  if (meta.ccsCode) attrs.push(`data-ccs="${escapeAttr(meta.ccsCode)}"`)
  if (meta.title) attrs.push(`data-title-cn="${escapeAttr(meta.title)}"`)
  if (meta.titleEn) attrs.push(`data-title-en="${escapeAttr(meta.titleEn)}"`)
  attrs.push(`data-standard-type="${escapeAttr(meta.standardType)}"`)
  return attrs.length > 0 ? ' ' + attrs.join(' ') : ''
}

// ---------- 屏幕预览样式 ----------

/** screen 变体内嵌样式：用于编辑器预览与独立浏览器查看（非打印版式） */
function screenStyles(): string {
  return `
    body { margin: 0; background: #f5f5f5; }
    .ses-standard {
      font-family: "Times New Roman", "SimSun", "宋体", "STSong", serif;
      font-size: 14px; line-height: 1.8; color: #000;
      max-width: 210mm; margin: 0 auto; padding: 20mm; background: #fff;
    }
    .ses-front-heading { font-family: "SimHei", "黑体", sans-serif; font-weight: bold; font-size: 20px; text-align: center; margin: 24px 0 16px; }
    .ses-doc-title-block { text-align: center; margin: 24px 0; }
    .ses-doc-title { font-family: "SimHei", "黑体", sans-serif; font-size: 22px; margin: 4px 0; }
    .ses-chapter-title { font-family: "SimHei", "黑体", sans-serif; font-size: 17px; margin: 20px 0 10px; }
    .ses-clause-title { font-family: "SimHei", "黑体", sans-serif; font-size: 15px; margin: 12px 0 6px; }
    .ses-chapter-title .ses-num, .ses-clause-title .ses-num, .ses-clause-num-only { margin-right: 0.6em; }
    .ses-paragraph { text-indent: 2em; margin: 6px 0; }
    .ses-term-entry { margin: 10px 0; }
    .ses-term-num-line { font-family: "SimHei", "黑体", sans-serif; font-weight: bold; margin: 0; }
    .ses-term-head { font-family: "SimHei", "黑体", sans-serif; margin: 0; }
    .ses-term-name-en { font-family: "SimHei", "黑体", sans-serif; }
    .ses-term-def, .ses-term-source { text-indent: 2em; margin: 2px 0; }
    .ses-toc-list { list-style: none; padding: 0; }
    .ses-toc-item { margin: 4px 0; }
    .ses-toc-l2 { padding-left: 2em; }
    .ses-toc-l3 { padding-left: 4em; }
    .ses-toc-text { color: #0066cc; text-decoration: none; }
    .ses-list { padding-left: 2em; margin: 8px 0; counter-reset: ses-li; }
    .ses-list[data-level="2"], .ses-list-number, .ses-list-dot { padding-left: 4em; }
    .ses-list .ses-list { padding-left: 0; }
    .ses-list-item { position: relative; padding-left: 2em; margin: 2px 0; }
    .ses-list-item::before { position: absolute; left: 0; counter-increment: ses-li; }
    .ses-list-dash > .ses-list-item::before { content: "——"; counter-increment: none; }
    .ses-list-dot > .ses-list-item::before { content: "·"; counter-increment: none; }
    .ses-list-number > .ses-list-item::before { content: counter(ses-li) "） "; }
    .ses-list-alpha > .ses-list-item::before { content: counter(ses-li, lower-alpha) "） "; }
    .ses-list-roman > .ses-list-item::before, .ses-list-romanUpper > .ses-list-item::before { content: counter(ses-li) "） "; }
    .ses-list .ses-list:not(.ses-list-number) > .ses-list-item::before { content: "·"; counter-increment: none; }
    .ses-table-block { margin: 16px 0; }
    .ses-table-caption { font-family: "SimHei", "黑体", sans-serif; font-weight: bold; text-align: center; margin: 8px 0 4px; }
    .ses-table-caption-en { text-align: center; font-style: italic; color: #555; }
    .ses-table-block table { border-collapse: collapse; width: 100%; }
    .ses-table-block th, .ses-table-block td { border: 1px solid #333; padding: 6px 8px; }
    .ses-table-block th { background: #f5f5f5; }
    .ses-figure-block { text-align: center; margin: 16px 0; }
    .ses-figure-image { max-width: 100%; }
    .ses-figure-caption { font-family: "SimHei", "黑体", sans-serif; font-weight: bold; margin-top: 8px; }
    .ses-figure-caption-en { font-style: italic; color: #555; }
    .ses-formula-block { display: flex; align-items: center; margin: 16px 0 6px; }
    .ses-formula { flex: 1; text-align: center; }
    .ses-formula-num { width: 5em; text-align: right; }
    .ses-where { margin: 0 0 12px 3em; }
    .ses-where-list { display: grid; grid-template-columns: min-content 1fr; column-gap: 0.8em; }
    .ses-where-list dt { font-style: italic; }
    .ses-where-list dd { margin: 0; }
    .ses-note, .ses-example { padding-left: 2em; font-size: 13px; color: #333; margin: 8px 0; }
    .ses-note-marker, .ses-example-marker { font-family: "SimHei", "黑体", sans-serif; }
    .ses-footnote { font-size: 0.85em; }
    .ses-footnote::before { content: attr(data-label); vertical-align: super; font-size: 0.75em; margin-right: 0.35em; }
    .ses-table-footnote { font-size: 13px; margin-left: calc(3em - 8px); text-indent: -1em; }
    .ses-table-footnote-marker { display: inline-block; width: 1em; text-indent: 0; }
    .ses-table-footnote-ref { color: inherit; text-decoration: none; }
    .ses-appendix-label, .ses-appendix-kind, .ses-appendix-title { font-family: "SimHei", "黑体", sans-serif; text-align: center; margin: 4px 0; }
    .ses-appendix-title { font-size: 17px; }
    .ses-bib-title { font-family: "SimHei", "黑体", sans-serif; text-align: center; font-size: 17px; margin: 20px 0 12px; }
    .ses-bib-entry { padding-left: 2em; text-indent: -2em; margin: 4px 0; }
    .ses-xref { color: #0066cc; }
  `
}

// ---------- 入口 ----------

/**
 * 渲染 IR 文档为语义 HTML 字符串。
 * @param doc    Authoring IR（来自 pmToIr）
 * @param labels Resolver 产出的编号/标签映射
 * @param opts.variant 'screen'（默认，带链接）| 'print'（无内部链接，配 printCss）
 */
export function renderHtml(doc: IRDoc, labels: Labels, opts: RenderHtmlOptions = {}): string {
  assertFootnoteReferences(doc, labels)
  assertOutputSupported(doc, 'HTML')
  const variant: HtmlVariant = opts.variant ?? 'screen'
  const anchorCollector = new RenderCtx(labels, variant, new Map(), true)
  renderFront(doc, anchorCollector)
  renderBody(doc, anchorCollector)
  const ctx = new RenderCtx(labels, variant, anchorCollector.anchorCounts)

  const css = variant === 'print' ? printCss({ standardNo: doc.meta.stdCode }) : screenStyles()
  const title = doc.meta.title ? escapeHtml(doc.meta.title) : '标准文件'

  ctx.push('<!DOCTYPE html>')
  ctx.push(`<html lang="zh-CN" data-variant="${variant}">`)
  ctx.push('<head>')
  ctx.push('<meta charset="UTF-8" />')
  ctx.push('<meta name="viewport" content="width=device-width, initial-scale=1.0" />')
  ctx.push(`<title>${title}</title>`)
  for (const field of ['applicant', 'proposer', 'technicalCommittee'] as const) {
    const value = doc.meta[field]
    if (value) ctx.push(`<meta name="ses-${field}" content="${escapeAttr(value).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')}" />`)
  }
  ctx.push(`<style>${css}</style>`)
  ctx.push('</head>')
  ctx.push('<body>')
  ctx.push(`<article class="ses-standard" data-type="standard-doc"${metaAttrs(doc.meta)}>`)

  renderFront(doc, ctx)
  renderBody(doc, ctx)

  ctx.push('</article>')
  ctx.push('</body>')
  ctx.push('</html>')

  return ctx.out.join('\n')
}
