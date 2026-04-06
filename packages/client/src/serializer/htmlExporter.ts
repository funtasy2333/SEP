/**
 * HTML 语义化导出器
 * 将 ProseMirror 文档导出为带语义标签和 data-* 属性的 HTML
 *
 * 输出的 HTML 保留完整语义信息，可用于：
 * 1. 独立浏览器预览
 * 2. 作为 PDF 导出的中间格式
 * 3. 无障碍阅读
 */

import type { Node as PMNode } from '@tiptap/pm/model'

/** HTML 特殊字符转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 将 ProseMirror 文档导出为语义 HTML
 */
export function exportSemanticHtml(doc: PMNode): string {
  const lines: string[] = []
  lines.push('<!DOCTYPE html>')
  lines.push('<html lang="zh-CN">')
  lines.push('<head>')
  lines.push('  <meta charset="UTF-8">')
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">')

  // 添加文档标题
  const titleCn = doc.attrs.titleCn || '标准文件'
  lines.push(`  <title>${escapeHtml(titleCn)}</title>`)

  // 内嵌基础样式
  lines.push('  <style>')
  lines.push(getBaseStyles())
  lines.push('  </style>')
  lines.push('</head>')
  lines.push(`<body>`)
  lines.push(`<article class="standard-doc" data-type="standard-doc"`)
  // 写入文档元数据
  const metaAttrs: string[] = []
  if (doc.attrs.standardNo) metaAttrs.push(`data-standard-no="${escapeHtml(doc.attrs.standardNo)}"`)
  if (doc.attrs.icsCode) metaAttrs.push(`data-ics="${escapeHtml(doc.attrs.icsCode)}"`)
  if (doc.attrs.ccsCode) metaAttrs.push(`data-ccs="${escapeHtml(doc.attrs.ccsCode)}"`)
  if (doc.attrs.titleCn) metaAttrs.push(`data-title-cn="${escapeHtml(doc.attrs.titleCn)}"`)
  if (doc.attrs.titleEn) metaAttrs.push(`data-title-en="${escapeHtml(doc.attrs.titleEn)}"`)
  if (metaAttrs.length > 0) lines.push(`  ${metaAttrs.join(' ')}`)
  lines.push('>')

  // 编号上下文
  const ctx = {
    chapterCount: 0,
    appendixCount: 0,
    clauseCounters: [0, 0, 0, 0, 0],
    currentPrefix: '',
    currentAppendixLetter: '',
  }

  doc.forEach((child) => {
    renderNode(lines, child, ctx, 1)
  })

  lines.push('</article>')
  lines.push('</body>')
  lines.push('</html>')
  return lines.join('\n')
}

interface RenderContext {
  chapterCount: number
  appendixCount: number
  clauseCounters: number[]
  currentPrefix: string
  currentAppendixLetter: string
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}

/** 渲染节点为 HTML */
function renderNode(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  switch (node.type.name) {
    case 'foreword':
      renderForeword(lines, node, ctx, depth)
      break
    case 'introduction':
      renderIntroduction(lines, node, ctx, depth)
      break
    case 'chapter':
      renderChapter(lines, node, ctx, depth)
      break
    case 'clause':
      renderClause(lines, node, ctx, depth)
      break
    case 'termDef':
      renderTermDef(lines, node, ctx, depth)
      break
    case 'appendix':
      renderAppendix(lines, node, ctx, depth)
      break
    case 'bibliography':
      renderBibliography(lines, node, ctx, depth)
      break
    case 'coverPage':
      renderCoverPage(lines, node, depth)
      break
    default:
      renderBlockNode(lines, node, ctx, depth)
      break
  }
}

function renderForeword(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  lines.push(`${indent(depth)}<section data-type="foreword" class="std-foreword" role="doc-foreword">`)
  lines.push(`${indent(depth + 1)}<h2>前言</h2>`)
  node.forEach((child) => renderBlockNode(lines, child, ctx, depth + 1))
  lines.push(`${indent(depth)}</section>`)
}

function renderIntroduction(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  lines.push(`${indent(depth)}<section data-type="introduction" class="std-introduction" role="doc-introduction">`)
  lines.push(`${indent(depth + 1)}<h2>引言</h2>`)
  node.forEach((child) => renderBlockNode(lines, child, ctx, depth + 1))
  lines.push(`${indent(depth)}</section>`)
}

function renderChapter(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  ctx.chapterCount++
  ctx.clauseCounters.fill(0)
  ctx.currentPrefix = String(ctx.chapterCount)
  ctx.currentAppendixLetter = ''

  const id = node.attrs.id || `sec-${ctx.chapterCount}`
  lines.push(`${indent(depth)}<section data-type="chapter" id="${id}" class="std-chapter">`)

  node.forEach((child) => {
    if (child.type.name === 'chapterTitle') {
      lines.push(`${indent(depth + 1)}<h2 data-type="chapter-title" class="std-chapter-title">${ctx.chapterCount} ${renderInline(child)}</h2>`)
    } else {
      renderNode(lines, child, ctx, depth + 1)
    }
  })

  lines.push(`${indent(depth)}</section>`)
}

function renderClause(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  const level = (node.attrs.level as number) || 1
  ctx.clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) ctx.clauseCounters[i] = 0

  const numParts = [ctx.currentPrefix, ...ctx.clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const hasTitle = node.attrs.hasTitle !== false
  const id = node.attrs.id || `sec-${numStr}`
  const hLevel = Math.min(level + 2, 6)

  lines.push(`${indent(depth)}<section data-type="clause" data-level="${level}" data-has-title="${hasTitle}" id="${id}" class="std-clause std-clause-level-${level}">`)

  node.forEach((child) => {
    if (child.type.name === 'clauseTitle') {
      const titleText = renderInline(child)
      lines.push(`${indent(depth + 1)}<h${hLevel} data-type="clause-title" class="std-clause-title std-clause-title-${level}">${numStr} ${titleText}</h${hLevel}>`)
    } else {
      renderNode(lines, child, ctx, depth + 1)
    }
  })

  lines.push(`${indent(depth)}</section>`)
}

function renderTermDef(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  const level = (node.attrs.level as number) || 1
  ctx.clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) ctx.clauseCounters[i] = 0

  const numParts = [ctx.currentPrefix, ...ctx.clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = node.attrs.id || `term-${numStr}`

  lines.push(`${indent(depth)}<div data-type="term-def" data-level="${level}" id="${id}" class="std-term-def std-term-def-level-${level}">`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'termName':
        lines.push(`${indent(depth + 1)}<div data-type="term-name" class="std-term-name">${numStr} ${renderInline(child)}</div>`)
        break
      case 'termNameEn': {
        const text = renderInline(child)
        if (text.trim()) {
          lines.push(`${indent(depth + 1)}<div data-type="term-name-en" class="std-term-name-en" lang="en">${text}</div>`)
        }
        break
      }
      case 'termDefinition':
        lines.push(`${indent(depth + 1)}<div data-type="term-definition" class="std-term-definition">${renderInline(child)}</div>`)
        break
      case 'termDef':
        renderTermDef(lines, child, ctx, depth + 1)
        break
      default:
        renderBlockNode(lines, child, ctx, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</div>`)
}

function renderAppendix(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  ctx.appendixCount++
  ctx.clauseCounters.fill(0)
  const letter = String.fromCharCode(64 + ctx.appendixCount)
  ctx.currentPrefix = letter
  ctx.currentAppendixLetter = letter

  const normative = node.attrs.normative
  const id = node.attrs.id || `app-${letter}`
  lines.push(`${indent(depth)}<section data-type="appendix" data-normative="${normative}" id="${id}" class="std-appendix" role="doc-appendix">`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'appendixLabel':
        lines.push(`${indent(depth + 1)}<div data-type="appendix-label" class="std-appendix-label">附录${letter}</div>`)
        break
      case 'appendixTitle':
        lines.push(`${indent(depth + 1)}<h2 data-type="appendix-title" class="std-appendix-title">${renderInline(child)}</h2>`)
        break
      default:
        renderNode(lines, child, ctx, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</section>`)
}

function renderBibliography(lines: string[], node: PMNode, _ctx: RenderContext, depth: number) {
  lines.push(`${indent(depth)}<section data-type="bibliography" class="std-bibliography" role="doc-bibliography">`)

  let entryIndex = 0
  node.forEach((child) => {
    if (child.type.name === 'bibliographyTitle') {
      lines.push(`${indent(depth + 1)}<h2 data-type="bibliography-title" class="std-bibliography-title">${renderInline(child)}</h2>`)
    } else if (child.type.name === 'bibEntry') {
      entryIndex++
      lines.push(`${indent(depth + 1)}<div data-type="bib-entry" class="std-bib-entry" data-index="${entryIndex}">[${entryIndex}] ${renderInline(child)}</div>`)
    }
  })

  lines.push(`${indent(depth)}</section>`)
}

function renderCoverPage(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<section data-type="cover-page" class="cover-page">`)
  const a = node.attrs
  if (a.standardNo) lines.push(`${indent(depth + 1)}<div class="cover-standard-no">${escapeHtml(a.standardNo)}</div>`)
  if (a.titleCn) lines.push(`${indent(depth + 1)}<h1 class="cover-title-cn">${escapeHtml(a.titleCn)}</h1>`)
  if (a.titleEn) lines.push(`${indent(depth + 1)}<h1 class="cover-title-en" lang="en">${escapeHtml(a.titleEn)}</h1>`)
  if (a.publishDate) lines.push(`${indent(depth + 1)}<div class="cover-pub-date">${escapeHtml(a.publishDate)} 发布</div>`)
  if (a.implementDate) lines.push(`${indent(depth + 1)}<div class="cover-impl-date">${escapeHtml(a.implementDate)} 实施</div>`)
  if (a.issuer) lines.push(`${indent(depth + 1)}<div class="cover-issuer">${escapeHtml(a.issuer)}</div>`)
  lines.push(`${indent(depth)}</section>`)
}

function renderBlockNode(lines: string[], node: PMNode, ctx: RenderContext, depth: number) {
  switch (node.type.name) {
    case 'stdParagraph':
    case 'paragraph':
      lines.push(`${indent(depth)}<p data-type="std-paragraph" class="std-paragraph">${renderInline(node)}</p>`)
      break

    case 'note':
      lines.push(`${indent(depth)}<div data-type="note" class="std-note" role="note">${renderInline(node)}</div>`)
      break

    case 'example':
      lines.push(`${indent(depth)}<div data-type="example" class="std-example">${renderInline(node)}</div>`)
      break

    case 'stdTable':
      renderTable(lines, node, depth)
      break

    case 'figure':
      renderFigure(lines, node, depth)
      break

    case 'formula':
      renderFormula(lines, node, depth)
      break

    case 'stdList':
      renderList(lines, node, depth)
      break

    default:
      if (node.isTextblock) {
        lines.push(`${indent(depth)}<p>${renderInline(node)}</p>`)
      } else {
        node.forEach((child) => renderNode(lines, child, ctx, depth))
      }
      break
  }
}

function renderTable(lines: string[], node: PMNode, depth: number) {
  const id = node.attrs.id
  lines.push(`${indent(depth)}<div data-type="std-table" class="std-table-wrapper"${id ? ` id="${id}"` : ''}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'tableCaption':
        lines.push(`${indent(depth + 1)}<div data-type="table-caption" class="std-table-caption">${renderInline(child)}</div>`)
        break
      case 'tableCaptionEn':
        lines.push(`${indent(depth + 1)}<div data-type="table-caption-en" class="std-table-caption-en" lang="en">${renderInline(child)}</div>`)
        break
      case 'table':
        renderHtmlTable(lines, child, depth + 1)
        break
      case 'tableFootnote':
        lines.push(`${indent(depth + 1)}<div data-type="table-footnote" class="std-table-footnote">${renderInline(child)}</div>`)
        break
    }
  })

  lines.push(`${indent(depth)}</div>`)
}

function renderHtmlTable(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<table>`)
  node.forEach((row) => {
    if (row.type.name === 'tableRow') {
      lines.push(`${indent(depth + 1)}<tr>`)
      row.forEach((cell) => {
        const tag = cell.type.name === 'tableHeader' ? 'th' : 'td'
        const attrs: string[] = []
        if (cell.attrs.colspan > 1) attrs.push(`colspan="${cell.attrs.colspan}"`)
        if (cell.attrs.rowspan > 1) attrs.push(`rowspan="${cell.attrs.rowspan}"`)
        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''
        const content = renderCellContent(cell)
        lines.push(`${indent(depth + 2)}<${tag}${attrStr}>${content}</${tag}>`)
      })
      lines.push(`${indent(depth + 1)}</tr>`)
    }
  })
  lines.push(`${indent(depth)}</table>`)
}

function renderCellContent(cell: PMNode): string {
  const parts: string[] = []
  cell.forEach((child) => {
    if (child.isTextblock) parts.push(renderInline(child))
  })
  return parts.join(' ')
}

function renderFigure(lines: string[], node: PMNode, depth: number) {
  const id = node.attrs.id
  lines.push(`${indent(depth)}<figure data-type="std-figure" class="std-figure"${id ? ` id="${id}"` : ''}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'figureImage':
        lines.push(`${indent(depth + 1)}<img data-type="figure-image" class="std-figure-image" src="${escapeHtml(child.attrs.src || '')}" alt="${escapeHtml(child.attrs.alt || '')}" />`)
        break
      case 'figureCaption':
        lines.push(`${indent(depth + 1)}<figcaption data-type="figure-caption" class="std-figure-caption">${renderInline(child)}</figcaption>`)
        break
      case 'figureCaptionEn':
        lines.push(`${indent(depth + 1)}<figcaption data-type="figure-caption-en" class="std-figure-caption-en" lang="en">${renderInline(child)}</figcaption>`)
        break
    }
  })

  lines.push(`${indent(depth)}</figure>`)
}

function renderFormula(lines: string[], node: PMNode, depth: number) {
  const id = node.attrs.id
  lines.push(`${indent(depth)}<div data-type="formula" class="std-formula"${id ? ` id="${id}"` : ''}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'formulaContent':
        lines.push(`${indent(depth + 1)}<div data-type="formula-content" class="std-formula-content">${renderInline(child)}</div>`)
        break
      case 'formulaDescription':
        lines.push(`${indent(depth + 1)}<div data-type="formula-description" class="std-formula-description">${renderInline(child)}</div>`)
        break
    }
  })

  lines.push(`${indent(depth)}</div>`)
}

function renderList(lines: string[], node: PMNode, depth: number) {
  const listType = node.attrs.listType || 'dash'
  lines.push(`${indent(depth)}<div data-type="std-list" data-list-type="${listType}" class="std-list std-list-${listType}">`)

  node.forEach((child) => {
    if (child.type.name === 'stdListItem') {
      lines.push(`${indent(depth + 1)}<div data-type="std-list-item" class="std-list-item">${renderInline(child)}</div>`)
    }
  })

  lines.push(`${indent(depth)}</div>`)
}

/** 渲染行内内容为 HTML */
function renderInline(node: PMNode): string {
  const parts: string[] = []

  node.forEach((child) => {
    if (child.isText) {
      let text = escapeHtml(child.text || '')
      if (child.marks && child.marks.length > 0) {
        for (const mark of child.marks) {
          switch (mark.type.name) {
            case 'bold':
              text = `<strong>${text}</strong>`
              break
            case 'italic':
              text = `<em>${text}</em>`
              break
            case 'subscript':
              text = `<sub>${text}</sub>`
              break
            case 'superscript':
              text = `<sup>${text}</sup>`
              break
            case 'underline':
              text = `<u>${text}</u>`
              break
            case 'strike':
              text = `<del>${text}</del>`
              break
            case 'crossRef':
              text = `<a data-type="cross-ref" class="std-cross-ref" href="#${escapeHtml(mark.attrs.refId || '')}" data-ref-type="${mark.attrs.refType || 'sec'}">${text}</a>`
              break
          }
        }
      }
      parts.push(text)
    } else if (child.type.name === 'hardBreak') {
      parts.push('<br />')
    }
  })

  return parts.join('')
}

/** 基础样式（内嵌到导出的 HTML 中） */
function getBaseStyles(): string {
  return `
    body {
      font-family: 'SimSun', 'Songti SC', serif;
      font-size: 14px;
      line-height: 1.8;
      max-width: 210mm;
      margin: 0 auto;
      padding: 25mm 20mm;
      color: #000;
    }
    .std-chapter-title, .std-clause-title, .std-appendix-label, .std-appendix-title,
    .std-bibliography-title, .std-term-name, .std-table-caption, .std-figure-caption {
      font-family: 'SimHei', 'Heiti SC', sans-serif;
      font-weight: bold;
    }
    .std-chapter-title { font-size: 16px; text-align: left; margin: 24px 0 12px; }
    .std-clause-title { margin: 4px 0 0; }
    .std-paragraph { text-indent: 2em; margin: 6px 0; }
    .std-term-name { font-size: 14px; margin: 4px 0 0; }
    .std-term-name-en { font-style: italic; font-size: 13px; color: #555; }
    .std-term-definition { text-indent: 2em; }
    .std-note, .std-example { padding-left: 2em; font-size: 13px; color: #333; margin: 8px 0; }
    .std-table-wrapper { margin: 16px 0; }
    .std-table-caption { text-align: center; margin-bottom: 8px; }
    .std-figure { margin: 16px 0; text-align: center; }
    .std-figure-image { max-width: 100%; }
    .std-figure-caption { text-align: center; margin-top: 8px; }
    .std-formula { margin: 16px 0; text-align: center; }
    .std-appendix-label, .std-appendix-title { text-align: center; font-size: 16px; }
    .std-bibliography-title { text-align: center; font-size: 16px; margin-bottom: 16px; }
    .std-bib-entry { padding-left: 2em; text-indent: -2em; margin: 4px 0; font-size: 13px; }
    .std-list { padding-left: 2em; margin: 8px 0; }
    .std-cross-ref { color: #0066cc; text-decoration: underline; }
    .cover-page { text-align: center; padding: 40px 0; border-bottom: 2px solid #333; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #333; padding: 6px 8px; }
    th { font-weight: bold; background: #f5f5f5; }
  `
}
