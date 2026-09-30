/**
 * XML 序列化器
 * 将 ProseMirror 文档结构序列化为 GB/T 37967-2019 兼容的 XML
 *
 * GB/T 37967-2019《标准文献的XML标记》基于 NISO STS (Standards Tag Suite)，
 * 核心结构：<standard> → <front> + <body> + <back>
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { normalizePageOrientation } from '../utils/orientation'

/** 缩进辅助 */
function indent(depth: number): string {
  return '  '.repeat(depth)
}

/** XML 特殊字符转义 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 构建 XML 属性字符串 */
function buildAttrs(attrs: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null && value !== '') {
      parts.push(`${key}="${escapeXml(String(value))}"`)
    }
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

/**
 * 将 ProseMirror 文档序列化为 GB/T 37967-2019 XML
 */
export function serializeToXml(doc: PMNode): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<standard xmlns="urn:csbts:std:xml:1.0">')

  // 收集文档各部分
  const frontNodes: PMNode[] = []   // coverPage
  const forewordNode: PMNode | null = findChild(doc, 'foreword')
  const introNode: PMNode | null = findChild(doc, 'introduction')
  const chapters: PMNode[] = []
  const appendices: PMNode[] = []
  let bibliographyNode: PMNode | null = null
  const coverNode: PMNode | null = findChild(doc, 'coverPage')

  doc.forEach((child) => {
    switch (child.type.name) {
      case 'coverPage':
        frontNodes.push(child)
        break
      case 'chapter':
        chapters.push(child)
        break
      case 'appendix':
        appendices.push(child)
        break
      case 'bibliography':
        bibliographyNode = child
        break
    }
  })

  // === <front> ===
  lines.push(`${indent(1)}<front>`)
  serializeFront(lines, doc, coverNode, 2)
  lines.push(`${indent(1)}</front>`)

  // === <body> ===
  lines.push(`${indent(1)}<body>`)

  // 前言
  if (forewordNode) {
    serializeForeword(lines, forewordNode, 2)
  }

  // 引言
  if (introNode) {
    serializeIntroduction(lines, introNode, 2)
  }

  // 章
  let chapterNum = 0
  const clauseCounters = [0, 0, 0, 0, 0]
  for (const chapter of chapters) {
    chapterNum++
    clauseCounters.fill(0)
    serializeChapter(lines, chapter, chapterNum, clauseCounters, 2)
  }

  lines.push(`${indent(1)}</body>`)

  // === <back> ===
  if (appendices.length > 0 || bibliographyNode) {
    lines.push(`${indent(1)}<back>`)

    // 附录
    if (appendices.length > 0) {
      lines.push(`${indent(2)}<app-group>`)
      let appIndex = 0
      for (const appendix of appendices) {
        appIndex++
        const letter = String.fromCharCode(64 + appIndex)
        serializeAppendix(lines, appendix, letter, 3)
      }
      lines.push(`${indent(2)}</app-group>`)
    }

    // 参考文献
    if (bibliographyNode) {
      serializeBibliography(lines, bibliographyNode, 2)
    }

    lines.push(`${indent(1)}</back>`)
  }

  lines.push('</standard>')
  return lines.join('\n')
}

// ========== 各节点序列化函数 ==========

/** 序列化 <front> 元数据 */
function serializeFront(lines: string[], doc: PMNode, coverNode: PMNode | null, depth: number) {
  const attrs = doc.attrs
  lines.push(`${indent(depth)}<std-meta>`)

  // 标准编号
  if (attrs.standardNo || coverNode?.attrs.standardNo) {
    const no = attrs.standardNo || coverNode?.attrs.standardNo
    lines.push(`${indent(depth + 1)}<std-ref>${escapeXml(no)}</std-ref>`)
  }

  // 标准标识
  if (attrs.icsCode || attrs.ccsCode || coverNode?.attrs.icsCode || coverNode?.attrs.ccsCode) {
    lines.push(`${indent(depth + 1)}<std-ident>`)
    const ics = attrs.icsCode || coverNode?.attrs.icsCode
    const ccs = attrs.ccsCode || coverNode?.attrs.ccsCode
    if (ics) lines.push(`${indent(depth + 2)}<ics>${escapeXml(ics)}</ics>`)
    if (ccs) lines.push(`${indent(depth + 2)}<ccs>${escapeXml(ccs)}</ccs>`)
    lines.push(`${indent(depth + 1)}</std-ident>`)
  }

  // 标题
  const titleCn = attrs.titleCn || coverNode?.attrs.titleCn
  const titleEn = attrs.titleEn || coverNode?.attrs.titleEn
  if (titleCn) {
    lines.push(`${indent(depth + 1)}<title-wrap lang="zh">`)
    lines.push(`${indent(depth + 2)}<main>${escapeXml(titleCn)}</main>`)
    lines.push(`${indent(depth + 1)}</title-wrap>`)
  }
  if (titleEn) {
    lines.push(`${indent(depth + 1)}<title-wrap lang="en">`)
    lines.push(`${indent(depth + 2)}<main>${escapeXml(titleEn)}</main>`)
    lines.push(`${indent(depth + 1)}</title-wrap>`)
  }

  // 日期
  const pubDate = attrs.publishDate || coverNode?.attrs.publishDate
  const implDate = attrs.implementDate || coverNode?.attrs.implementDate
  if (pubDate) lines.push(`${indent(depth + 1)}<pub-date>${escapeXml(pubDate)}</pub-date>`)
  if (implDate) lines.push(`${indent(depth + 1)}<release-date>${escapeXml(implDate)}</release-date>`)

  // 标准类型
  if (attrs.standardType) {
    lines.push(`${indent(depth + 1)}<std-type>${escapeXml(attrs.standardType)}</std-type>`)
  }

  // 发布机构
  const issuer = coverNode?.attrs.issuer
  if (issuer) {
    lines.push(`${indent(depth + 1)}<std-org>`)
    lines.push(`${indent(depth + 2)}<std-org-name>${escapeXml(issuer)}</std-org-name>`)
    lines.push(`${indent(depth + 1)}</std-org>`)
  }

  lines.push(`${indent(depth)}</std-meta>`)
}

/** 序列化前言 */
function serializeForeword(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<foreword>`)
  serializeBlockChildren(lines, node, depth + 1)
  lines.push(`${indent(depth)}</foreword>`)
}

/** 序列化引言 */
function serializeIntroduction(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<intro>`)
  serializeBlockChildren(lines, node, depth + 1)
  lines.push(`${indent(depth)}</intro>`)
}

/** 序列化章 */
function serializeChapter(
  lines: string[],
  node: PMNode,
  chapterNum: number,
  clauseCounters: number[],
  depth: number,
) {
  const id = node.attrs.id || `sec_${chapterNum}`
  lines.push(`${indent(depth)}<sec${buildAttrs({ id })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'chapterTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeClause(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeTermDef(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</sec>`)
}

/** 序列化条 */
function serializeClause(
  lines: string[],
  node: PMNode,
  chapterNum: number,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [chapterNum, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = node.attrs.id || `sec_${numStr}`
  const hasTitle = node.attrs.hasTitle !== false

  const attrs: Record<string, string | number | boolean | null> = { id }
  if (!hasTitle) attrs['content-type'] = 'untitled'

  lines.push(`${indent(depth)}<sec${buildAttrs(attrs)}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'clauseTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeClause(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeTermDef(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</sec>`)
}

/** 序列化术语定义 */
function serializeTermDef(
  lines: string[],
  node: PMNode,
  chapterNum: number,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [chapterNum, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = node.attrs.id || `term_${numStr}`

  lines.push(`${indent(depth)}<term-sec${buildAttrs({ id })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'termName': {
        lines.push(`${indent(depth + 1)}<term>`)
        lines.push(`${indent(depth + 2)}<preferred>`)
        lines.push(`${indent(depth + 3)}<term-name>${serializeInlineContent(child)}</term-name>`)
        lines.push(`${indent(depth + 2)}</preferred>`)
        lines.push(`${indent(depth + 1)}</term>`)
        break
      }
      case 'termNameEn': {
        const text = serializeInlineContent(child)
        if (text.trim()) {
          lines.push(`${indent(depth + 1)}<term>`)
          lines.push(`${indent(depth + 2)}<admitted>`)
          lines.push(`${indent(depth + 3)}<term-name lang="en">${text}</term-name>`)
          lines.push(`${indent(depth + 2)}</admitted>`)
          lines.push(`${indent(depth + 1)}</term>`)
        }
        break
      }
      case 'termDefinition':
        lines.push(`${indent(depth + 1)}<def>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</def>`)
        break
      case 'note':
        lines.push(`${indent(depth + 1)}<term-note>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-note>`)
        break
      case 'example':
        lines.push(`${indent(depth + 1)}<term-example>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-example>`)
        break
      case 'termDef':
        serializeTermDef(lines, child, chapterNum, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</term-sec>`)
}

/** 序列化附录 */
function serializeAppendix(lines: string[], node: PMNode, letter: string, depth: number) {
  const normative = node.attrs.normative ? 'normative' : 'informative'
  const id = node.attrs.id || `app_${letter}`
  lines.push(`${indent(depth)}<app${buildAttrs({ id, 'content-type': normative })}>`)

  const clauseCounters = [0, 0, 0, 0, 0]

  node.forEach((child) => {
    switch (child.type.name) {
      case 'appendixLabel':
        // 附录标识由系统自动生成，XML 中通过 id 和 content-type 表达
        break
      case 'appendixTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeAppendixClause(lines, child, letter, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeAppendixTermDef(lines, child, letter, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</app>`)
}

/** 序列化附录中的条 */
function serializeAppendixClause(
  lines: string[],
  node: PMNode,
  letter: string,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [letter, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = node.attrs.id || `sec_${numStr}`
  const hasTitle = node.attrs.hasTitle !== false

  const attrs: Record<string, string | number | boolean | null> = { id }
  if (!hasTitle) attrs['content-type'] = 'untitled'

  lines.push(`${indent(depth)}<sec${buildAttrs(attrs)}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'clauseTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'clause':
        serializeAppendixClause(lines, child, letter, clauseCounters, depth + 1)
        break
      case 'termDef':
        serializeAppendixTermDef(lines, child, letter, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</sec>`)
}

/** 序列化附录中的术语定义 */
function serializeAppendixTermDef(
  lines: string[],
  node: PMNode,
  letter: string,
  clauseCounters: number[],
  depth: number,
) {
  const level = node.attrs.level || 1
  clauseCounters[level - 1]++
  for (let i = level; i < 5; i++) clauseCounters[i] = 0

  const numParts = [letter, ...clauseCounters.slice(0, level)]
  const numStr = numParts.join('.')
  const id = node.attrs.id || `term_${numStr}`

  lines.push(`${indent(depth)}<term-sec${buildAttrs({ id })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'termName':
        lines.push(`${indent(depth + 1)}<term>`)
        lines.push(`${indent(depth + 2)}<preferred>`)
        lines.push(`${indent(depth + 3)}<term-name>${serializeInlineContent(child)}</term-name>`)
        lines.push(`${indent(depth + 2)}</preferred>`)
        lines.push(`${indent(depth + 1)}</term>`)
        break
      case 'termNameEn': {
        const text = serializeInlineContent(child)
        if (text.trim()) {
          lines.push(`${indent(depth + 1)}<term>`)
          lines.push(`${indent(depth + 2)}<admitted>`)
          lines.push(`${indent(depth + 3)}<term-name lang="en">${text}</term-name>`)
          lines.push(`${indent(depth + 2)}</admitted>`)
          lines.push(`${indent(depth + 1)}</term>`)
        }
        break
      }
      case 'termDefinition':
        lines.push(`${indent(depth + 1)}<def>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</def>`)
        break
      case 'note':
        lines.push(`${indent(depth + 1)}<term-note>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-note>`)
        break
      case 'example':
        lines.push(`${indent(depth + 1)}<term-example>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</term-example>`)
        break
      case 'termDef':
        serializeAppendixTermDef(lines, child, letter, clauseCounters, depth + 1)
        break
      default:
        serializeBlockNode(lines, child, depth + 1)
        break
    }
  })

  lines.push(`${indent(depth)}</term-sec>`)
}

/** 序列化参考文献 */
function serializeBibliography(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<ref-list>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'bibliographyTitle':
        lines.push(`${indent(depth + 1)}<title>${serializeInlineContent(child)}</title>`)
        break
      case 'bibEntry': {
        const index = child.attrs.index
        const attrs: Record<string, string | null> = {}
        if (index) attrs.id = `bib_${index}`
        lines.push(`${indent(depth + 1)}<ref${buildAttrs(attrs)}>`)
        lines.push(`${indent(depth + 2)}<mixed-citation>${serializeInlineContent(child)}</mixed-citation>`)
        lines.push(`${indent(depth + 1)}</ref>`)
        break
      }
    }
  })

  lines.push(`${indent(depth)}</ref-list>`)
}

/** 序列化通用块级节点 */
function serializeBlockNode(lines: string[], node: PMNode, depth: number) {
  switch (node.type.name) {
    case 'stdParagraph':
    case 'paragraph':
      lines.push(`${indent(depth)}<p>${serializeInlineContent(node)}</p>`)
      break

    case 'note':
      lines.push(`${indent(depth)}<non-normative-note>`)
      lines.push(`${indent(depth + 1)}<p>${serializeInlineContent(node)}</p>`)
      lines.push(`${indent(depth)}</non-normative-note>`)
      break

    case 'example':
      lines.push(`${indent(depth)}<non-normative-example>`)
      lines.push(`${indent(depth + 1)}<p>${serializeInlineContent(node)}</p>`)
      lines.push(`${indent(depth)}</non-normative-example>`)
      break

    case 'stdTable':
      serializeTable(lines, node, depth)
      break

    case 'figure':
      serializeFigure(lines, node, depth)
      break

    case 'formula':
      serializeFormula(lines, node, depth)
      break

    case 'stdList':
      serializeList(lines, node, depth)
      break

    default:
      // 其他未知节点尝试输出文本
      if (node.isTextblock) {
        lines.push(`${indent(depth)}<p>${serializeInlineContent(node)}</p>`)
      } else {
        // 递归处理子节点
        node.forEach((child) => {
          serializeBlockNode(lines, child, depth)
        })
      }
      break
  }
}

/** 序列化表格 */
function serializeTable(lines: string[], node: PMNode, depth: number) {
  const id = node.attrs.id
  const orientation = normalizePageOrientation(node.attrs.orientation)
  lines.push(`${indent(depth)}<table-wrap${buildAttrs({
    id: id || undefined,
    orientation: orientation === 'landscape' ? orientation : undefined,
  })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'tableCaption':
        lines.push(`${indent(depth + 1)}<caption>`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
      case 'tableCaptionEn':
        lines.push(`${indent(depth + 1)}<caption lang="en">`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
      case 'table':
        serializeHtmlTable(lines, child, depth + 1)
        break
      case 'tableFootnote':
        lines.push(`${indent(depth + 1)}<table-wrap-foot>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</table-wrap-foot>`)
        break
    }
  })

  lines.push(`${indent(depth)}</table-wrap>`)
}

/** 序列化 HTML 表格结构 (Tiptap 内置表格) */
function serializeHtmlTable(lines: string[], node: PMNode, depth: number) {
  lines.push(`${indent(depth)}<table>`)

  // Tiptap 的表格结构：table > tableRow > tableCell/tableHeader
  node.forEach((row) => {
    if (row.type.name === 'tableRow') {
      lines.push(`${indent(depth + 1)}<tr>`)
      row.forEach((cell) => {
        const tag = cell.type.name === 'tableHeader' ? 'th' : 'td'
        const cellAttrs: Record<string, string | number | null | undefined> = {}
        if (cell.attrs.colspan && cell.attrs.colspan > 1) cellAttrs.colspan = cell.attrs.colspan
        if (cell.attrs.rowspan && cell.attrs.rowspan > 1) cellAttrs.rowspan = cell.attrs.rowspan

        const content = serializeCellContent(cell)
        lines.push(`${indent(depth + 2)}<${tag}${buildAttrs(cellAttrs)}>${content}</${tag}>`)
      })
      lines.push(`${indent(depth + 1)}</tr>`)
    }
  })

  lines.push(`${indent(depth)}</table>`)
}

/** 序列化表格单元格内容 */
function serializeCellContent(cell: PMNode): string {
  const parts: string[] = []
  cell.forEach((child) => {
    if (child.isTextblock) {
      parts.push(serializeInlineContent(child))
    }
  })
  return parts.join(' ')
}

/** 序列化图 */
function serializeFigure(lines: string[], node: PMNode, depth: number) {
  const id = node.attrs.id
  const orientation = normalizePageOrientation(node.attrs.orientation)
  lines.push(`${indent(depth)}<fig${buildAttrs({
    id: id || undefined,
    orientation: orientation === 'landscape' ? orientation : undefined,
  })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'figureImage': {
        const src = child.attrs.src
        const alt = child.attrs.alt
        if (src) {
          lines.push(`${indent(depth + 1)}<graphic${buildAttrs({ 'xlink:href': src, alt: alt || undefined })} />`)
        }
        break
      }
      case 'figureCaption':
        lines.push(`${indent(depth + 1)}<caption>`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
      case 'figureCaptionEn':
        lines.push(`${indent(depth + 1)}<caption lang="en">`)
        lines.push(`${indent(depth + 2)}<title>${serializeInlineContent(child)}</title>`)
        lines.push(`${indent(depth + 1)}</caption>`)
        break
    }
  })

  lines.push(`${indent(depth)}</fig>`)
}

/** 序列化公式 */
function serializeFormula(lines: string[], node: PMNode, depth: number) {
  const id = node.attrs.id
  lines.push(`${indent(depth)}<disp-formula${buildAttrs({ id: id || undefined })}>`)

  node.forEach((child) => {
    switch (child.type.name) {
      case 'formulaContent':
        lines.push(`${indent(depth + 1)}<tex-math><![CDATA[${child.textContent}]]></tex-math>`)
        break
      case 'formulaDescription':
        lines.push(`${indent(depth + 1)}<def-list>`)
        lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
        lines.push(`${indent(depth + 1)}</def-list>`)
        break
    }
  })

  lines.push(`${indent(depth)}</disp-formula>`)
}

/** 序列化列表 */
export function toXmlListType(listType: string): string {
  const listTypeMap: Record<string, string> = {
    dash: 'dash',
    alpha: 'alpha-lower',
    numeric: 'arabic',
    roman: 'arabic',
    romanUpper: 'arabic',
  }
  return listTypeMap[listType] || 'dash'
}

function serializeList(lines: string[], node: PMNode, depth: number) {
  const listType = toXmlListType(node.attrs.listType)

  lines.push(`${indent(depth)}<list${buildAttrs({ 'list-type': listType })}>`)

  node.forEach((child) => {
    if (child.type.name === 'stdListItem') {
      lines.push(`${indent(depth + 1)}<list-item>`)
      lines.push(`${indent(depth + 2)}<p>${serializeInlineContent(child)}</p>`)
      lines.push(`${indent(depth + 1)}</list-item>`)
    }
  })

  lines.push(`${indent(depth)}</list>`)
}

/** 序列化块级子节点（用于 foreword/introduction 等容器） */
function serializeBlockChildren(lines: string[], node: PMNode, depth: number) {
  node.forEach((child) => {
    serializeBlockNode(lines, child, depth)
  })
}

/**
 * 序列化行内内容（文本 + marks）
 * 输出带行内标签的文本
 */
function serializeInlineContent(node: PMNode): string {
  const parts: string[] = []

  node.forEach((child) => {
    if (child.isText) {
      let text = escapeXml(child.text || '')
      // 处理 marks
      if (child.marks && child.marks.length > 0) {
        for (const mark of child.marks) {
          switch (mark.type.name) {
            case 'bold':
              text = `<bold>${text}</bold>`
              break
            case 'italic':
              text = `<italic>${text}</italic>`
              break
            case 'subscript':
              text = `<sub>${text}</sub>`
              break
            case 'superscript':
              text = `<sup>${text}</sup>`
              break
            case 'underline':
              text = `<underline>${text}</underline>`
              break
            case 'strike':
              text = `<strike>${text}</strike>`
              break
            case 'crossRef':
              text = `<xref${buildAttrs({
                'ref-type': mark.attrs.refType || 'sec',
                rid: mark.attrs.refId || '',
              })}>${text}</xref>`
              break
          }
        }
      }
      parts.push(text)
    } else if (child.type.name === 'hardBreak') {
      parts.push('<break />')
    }
  })

  return parts.join('')
}

/** 查找文档中某类型的第一个子节点 */
function findChild(doc: PMNode, typeName: string): PMNode | null {
  let found: PMNode | null = null
  doc.forEach((child) => {
    if (!found && child.type.name === typeName) {
      found = child
    }
  })
  return found
}
