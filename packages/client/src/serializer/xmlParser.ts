/**
 * XML 解析器
 * 将 GB/T 37967-2019 兼容的 XML 解析为 ProseMirror 文档 JSON
 *
 * 输入：XML 字符串
 * 输出：ProseMirror 兼容的 JSON 文档结构
 */

import { readPageOrientation } from '../utils/orientation'

/** ProseMirror JSON 节点类型 */
export interface PMJsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMJsonNode[]
  text?: string
  marks?: PMJsonMark[]
}

export interface PMJsonMark {
  type: string
  attrs?: Record<string, unknown>
}

const SES_COVER_META_KEYS = ['replaces', 'consistency', 'filingNo', 'industryName', 'regionName'] as const
const LEGACY_COVER_META_KEYS = [
  'standardNo',
  'titleCn',
  'titleEn',
  'publishDate',
  'implementDate',
  'icsCode',
  'ccsCode',
  'standardType',
] as const
const EDITOR_COVER_META_KEYS = [
  ...LEGACY_COVER_META_KEYS,
  'issuer',
  ...SES_COVER_META_KEYS,
] as const

/**
 * 将 GB/T 37967-2019 XML 字符串解析为 ProseMirror JSON
 */
export function parseXmlToJson(xmlString: string): PMJsonNode {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml')

  // 检查解析错误
  const parseError = xmlDoc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`XML 解析错误: ${parseError.textContent}`)
  }

  const root = xmlDoc.documentElement
  if (root.tagName !== 'standard') {
    throw new Error(`期望根元素为 <standard>，实际为 <${root.tagName}>`)
  }

  return parseStandard(root)
}

/**
 * XML uses a `standardDoc` wrapper, while the live editor currently uses StarterKit's `doc` top node.
 * Keep parseXmlToJson's existing wrapper contract, and adapt only at the editor import boundary.
 */
export function parseXmlToEditorJson(xmlString: string, topNodeTypeName: string): PMJsonNode {
  const parsed = parseXmlToJson(xmlString)
  if (parsed.type === topNodeTypeName) return parsed

  // StarterKit's production `doc` node has no attrs. Lift the parsed <front>/<std-meta> data
  // onto the schema-backed coverPage before the standardDoc wrapper is discarded.
  const rootAttrs = parsed.attrs ?? {}
  const coverAttrs: Record<string, unknown> = {}
  for (const key of EDITOR_COVER_META_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rootAttrs, key)) coverAttrs[key] = rootAttrs[key]
  }

  const content = [...(parsed.content ?? [])]
  const coverIndex = content.findIndex((node) => node.type === 'coverPage')
  if (coverIndex >= 0) {
    const coverPage = content[coverIndex]!
    // Explicit cover metadata remains authoritative if an XML document contains both sources.
    content[coverIndex] = { ...coverPage, attrs: { ...coverAttrs, ...coverPage.attrs } }
  } else if (Object.keys(coverAttrs).length > 0) {
    content.unshift({
      type: 'coverPage',
      attrs: coverAttrs,
      content: [{ type: 'paragraph', content: [] }],
    })
  }

  return { type: topNodeTypeName, content }
}

// ========== 解析函数 ==========

/** 解析 <standard> 根元素 */
function parseStandard(el: Element): PMJsonNode {
  const doc: PMJsonNode = {
    type: 'standardDoc',
    attrs: {},
    content: [],
  }

  const front = el.querySelector(':scope > front')
  const body = el.querySelector(':scope > body')
  const back = el.querySelector(':scope > back')

  // 解析 front 元数据
  if (front) {
    const meta = parseFrontMeta(front)
    doc.attrs = { ...doc.attrs, ...meta }
    const sesCoverAttrs = extractSesCoverMeta(meta)
    if (Object.keys(sesCoverAttrs).length > 0) {
      // The live editor uses a `doc` root without metadata attrs. Once SES cover metadata is
      // present, carry the already parsed legacy cover fields on coverPage as well, so importing
      // into the production schema does not lose them when the standardDoc wrapper is adapted.
      const coverAttrs: Record<string, string> = {
        ...extractLegacyCoverMeta(meta),
        ...sesCoverAttrs,
      }
      const issuer = parseCoverIssuer(front)
      if (issuer) coverAttrs.issuer = issuer
      doc.content!.push({
        type: 'coverPage',
        attrs: coverAttrs,
        content: [{ type: 'paragraph', content: [] }],
      })
    }
  }

  // 解析 body
  if (body) {
    // 前言
    const foreword = body.querySelector(':scope > foreword')
    if (foreword) {
      doc.content!.push(parseForeword(foreword))
    }

    // 引言
    const intro = body.querySelector(':scope > intro')
    if (intro) {
      doc.content!.push(parseIntroduction(intro))
    }

    // 章（顶级 <sec>）
    for (const sec of body.querySelectorAll(':scope > sec')) {
      doc.content!.push(parseChapter(sec))
    }
  }

  // 解析 back
  if (back) {
    // 附录
    const appGroup = back.querySelector(':scope > app-group')
    if (appGroup) {
      for (const app of appGroup.querySelectorAll(':scope > app')) {
        doc.content!.push(parseAppendix(app))
      }
    }
    // 也支持直接在 back 下的 app
    for (const app of back.querySelectorAll(':scope > app')) {
      doc.content!.push(parseAppendix(app))
    }

    // 参考文献
    const refList = back.querySelector(':scope > ref-list')
    if (refList) {
      doc.content!.push(parseBibliography(refList))
    }
  }

  // 确保至少有一个章
  if (!doc.content!.some(n => n.type === 'chapter')) {
    doc.content!.push({
      type: 'chapter',
      content: [
        { type: 'chapterTitle', content: [] },
      ],
    })
  }

  return doc
}

/** 解析 <front> 中的元数据 */
function parseFrontMeta(front: Element): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  const issuer = parseCoverIssuer(front)
  if (issuer) attrs.issuer = issuer
  const meta = front.querySelector(':scope > std-meta')
  if (!meta) return attrs

  // 标准编号
  const stdRef = meta.querySelector(':scope > std-ref')
  if (stdRef) attrs.standardNo = stdRef.textContent?.trim() || ''

  // 标准标识
  const stdIdent = meta.querySelector(':scope > std-ident')
  if (stdIdent) {
    const ics = stdIdent.querySelector(':scope > ics')
    const ccs = stdIdent.querySelector(':scope > ccs')
    if (ics) attrs.icsCode = ics.textContent?.trim() || ''
    if (ccs) attrs.ccsCode = ccs.textContent?.trim() || ''
  }

  // 标题
  for (const titleWrap of meta.querySelectorAll(':scope > title-wrap')) {
    const lang = titleWrap.getAttribute('lang')
    const mainTitle = titleWrap.querySelector(':scope > main')
    const titleText = mainTitle?.textContent?.trim() || ''
    if (lang === 'zh') attrs.titleCn = titleText
    else if (lang === 'en') attrs.titleEn = titleText
  }

  // 日期
  const pubDate = meta.querySelector(':scope > pub-date')
  if (pubDate) attrs.publishDate = pubDate.textContent?.trim() || ''
  const releaseDate = meta.querySelector(':scope > release-date')
  if (releaseDate) attrs.implementDate = releaseDate.textContent?.trim() || ''

  // 标准类型
  const stdType = meta.querySelector(':scope > std-type')
  if (stdType) attrs.standardType = stdType.textContent?.trim() || 'national'

  // Keep the parsed values on root attrs for legacy PM JSON consumers; parseStandard also places
  // them on coverPage so a schema-backed editor doc can retain them after its root wrapper is removed.
  Object.assign(attrs, parseSesCoverMeta(meta))

  return attrs
}

/** Reads only our named STS custom-meta group, leaving other organizations' metadata untouched. */
function parseSesCoverMeta(meta: Element): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const group of meta.querySelectorAll(':scope > custom-meta-group')) {
    if (group.getAttribute('content-type') !== 'ses-cover') continue
    for (const item of group.querySelectorAll(':scope > custom-meta')) {
      const name = item.querySelector(':scope > meta-name')?.textContent?.trim()
      if (!name || !SES_COVER_META_KEYS.includes(name as typeof SES_COVER_META_KEYS[number])) continue
      const value = item.querySelector(':scope > meta-value')?.textContent?.trim()
      if (value) attrs[name] = value
    }
  }
  return attrs
}

function extractSesCoverMeta(meta: Record<string, unknown>): Record<string, string> {
  const coverAttrs: Record<string, string> = {}
  for (const key of SES_COVER_META_KEYS) {
    const value = meta[key]
    if (typeof value === 'string' && value !== '') coverAttrs[key] = value
  }
  return coverAttrs
}

function extractLegacyCoverMeta(meta: Record<string, unknown>): Record<string, string> {
  const coverAttrs: Record<string, string> = {}
  for (const key of LEGACY_COVER_META_KEYS) {
    const value = meta[key]
    if (typeof value === 'string' && value !== '') coverAttrs[key] = value
  }
  return coverAttrs
}

function parseCoverIssuer(front: Element): string {
  return front
    .querySelector(':scope > std-meta > std-org > std-org-name')
    ?.textContent?.trim() ?? ''
}

/** 解析前言 */
function parseForeword(el: Element): PMJsonNode {
  return {
    type: 'foreword',
    content: parseBlockChildren(el),
  }
}

/** 解析引言 */
function parseIntroduction(el: Element): PMJsonNode {
  return {
    type: 'introduction',
    content: parseBlockChildren(el),
  }
}

/** 解析章（顶级 <sec>） */
function parseChapter(el: Element): PMJsonNode {
  const chapter: PMJsonNode = {
    type: 'chapter',
    attrs: { id: el.getAttribute('id') },
    content: [],
  }

  for (const child of el.children) {
    const tag = child.tagName
    if (tag === 'title') {
      chapter.content!.push({
        type: 'chapterTitle',
        content: parseInlineContent(child),
      })
    } else if (tag === 'sec') {
      chapter.content!.push(parseClause(child, 1))
    } else if (tag === 'term-sec') {
      chapter.content!.push(parseTermDef(child, 1))
    } else {
      const blockNode = parseBlockElement(child)
      if (blockNode) chapter.content!.push(blockNode)
    }
  }

  // 确保有标题
  if (!chapter.content!.some(n => n.type === 'chapterTitle')) {
    chapter.content!.unshift({ type: 'chapterTitle', content: [] })
  }

  return chapter
}

/** 解析条 (<sec>)，支持递归嵌套 */
function parseClause(el: Element, level: number): PMJsonNode {
  const isUntitled = el.getAttribute('content-type') === 'untitled'
  const clause: PMJsonNode = {
    type: 'clause',
    attrs: {
      id: el.getAttribute('id'),
      level,
      hasTitle: !isUntitled,
    },
    content: [],
  }

  for (const child of el.children) {
    const tag = child.tagName
    if (tag === 'title') {
      clause.content!.push({
        type: 'clauseTitle',
        attrs: { level },
        content: parseInlineContent(child),
      })
    } else if (tag === 'sec') {
      clause.content!.push(parseClause(child, level + 1))
    } else if (tag === 'term-sec') {
      clause.content!.push(parseTermDef(child, level + 1))
    } else {
      const blockNode = parseBlockElement(child)
      if (blockNode) clause.content!.push(blockNode)
    }
  }

  // 确保有标题
  if (!clause.content!.some(n => n.type === 'clauseTitle')) {
    clause.content!.unshift({
      type: 'clauseTitle',
      attrs: { level },
      content: [],
    })
  }

  return clause
}

/** 解析术语定义 (<term-sec>) */
function parseTermDef(el: Element, level: number): PMJsonNode {
  const termDef: PMJsonNode = {
    type: 'termDef',
    attrs: {
      id: el.getAttribute('id'),
      level,
    },
    content: [],
  }

  let hasName = false
  let hasDefinition = false

  for (const child of el.children) {
    const tag = child.tagName

    if (tag === 'term') {
      // <term> 可包含 <preferred> 或 <admitted>
      const preferred = child.querySelector(':scope > preferred')
      const admitted = child.querySelector(':scope > admitted')

      if (preferred) {
        const termName = preferred.querySelector(':scope > term-name')
        termDef.content!.push({
          type: 'termName',
          content: termName ? parseInlineContent(termName) : [],
        })
        hasName = true
      }
      if (admitted) {
        const termName = admitted.querySelector(':scope > term-name')
        termDef.content!.push({
          type: 'termNameEn',
          content: termName ? parseInlineContent(termName) : [],
        })
      }
    } else if (tag === 'def') {
      const p = child.querySelector(':scope > p')
      termDef.content!.push({
        type: 'termDefinition',
        content: p ? parseInlineContent(p) : [],
      })
      hasDefinition = true
    } else if (tag === 'term-note') {
      const p = child.querySelector(':scope > p')
      termDef.content!.push({
        type: 'note',
        content: p ? parseInlineContent(p) : [],
      })
    } else if (tag === 'term-example') {
      const p = child.querySelector(':scope > p')
      termDef.content!.push({
        type: 'example',
        content: p ? parseInlineContent(p) : [],
      })
    } else if (tag === 'term-sec') {
      // 嵌套术语
      termDef.content!.push(parseTermDef(child, level + 1))
    } else {
      const blockNode = parseBlockElement(child)
      if (blockNode) termDef.content!.push(blockNode)
    }
  }

  // 确保必要子节点存在
  if (!hasName) {
    termDef.content!.unshift({ type: 'termName', content: [] })
  }
  if (!hasDefinition) {
    // 在 termName/termNameEn 之后插入 termDefinition
    const insertIdx = termDef.content!.findIndex(
      n => n.type !== 'termName' && n.type !== 'termNameEn',
    )
    termDef.content!.splice(insertIdx >= 0 ? insertIdx : termDef.content!.length, 0, {
      type: 'termDefinition',
      content: [],
    })
  }

  return termDef
}

/** 解析附录 (<app>) */
function parseAppendix(el: Element): PMJsonNode {
  const normative = el.getAttribute('content-type') === 'normative'
  const appendix: PMJsonNode = {
    type: 'appendix',
    attrs: {
      id: el.getAttribute('id'),
      normative,
    },
    content: [],
  }

  // 附录标识（自动生成）
  appendix.content!.push({
    type: 'appendixLabel',
    content: [],
  })

  let hasTitle = false
  for (const child of el.children) {
    const tag = child.tagName
    if (tag === 'title') {
      appendix.content!.push({
        type: 'appendixTitle',
        content: parseInlineContent(child),
      })
      hasTitle = true
    } else if (tag === 'sec') {
      appendix.content!.push(parseClause(child, 1))
    } else if (tag === 'term-sec') {
      appendix.content!.push(parseTermDef(child, 1))
    } else {
      const blockNode = parseBlockElement(child)
      if (blockNode) appendix.content!.push(blockNode)
    }
  }

  if (!hasTitle) {
    appendix.content!.push({ type: 'appendixTitle', content: [] })
  }

  return appendix
}

/** 解析参考文献 (<ref-list>) */
function parseBibliography(el: Element): PMJsonNode {
  const bib: PMJsonNode = {
    type: 'bibliography',
    content: [],
  }

  let refIndex = 0
  for (const child of el.children) {
    const tag = child.tagName
    if (tag === 'title') {
      bib.content!.push({
        type: 'bibliographyTitle',
        content: parseInlineContent(child),
      })
    } else if (tag === 'ref') {
      refIndex++
      const mixedCitation = child.querySelector(':scope > mixed-citation')
      bib.content!.push({
        type: 'bibEntry',
        attrs: { index: refIndex },
        content: mixedCitation ? parseInlineContent(mixedCitation) : parseInlineContent(child),
      })
    }
  }

  // 确保有标题
  if (!bib.content!.some(n => n.type === 'bibliographyTitle')) {
    bib.content!.unshift({
      type: 'bibliographyTitle',
      content: [{ type: 'text', text: '参考文献' }],
    })
  }

  // 确保至少有一个条目
  if (!bib.content!.some(n => n.type === 'bibEntry')) {
    bib.content!.push({ type: 'bibEntry', attrs: { index: 1 }, content: [] })
  }

  return bib
}

/** 解析通用块级元素 */
function parseBlockElement(el: Element): PMJsonNode | null {
  const tag = el.tagName

  switch (tag) {
    case 'p':
      return {
        type: 'stdParagraph',
        content: parseInlineContent(el),
      }

    case 'non-normative-note':
    case 'note': {
      const p = el.querySelector(':scope > p')
      return {
        type: 'note',
        content: p ? parseInlineContent(p) : parseInlineContent(el),
      }
    }

    case 'non-normative-example':
    case 'example': {
      const p = el.querySelector(':scope > p')
      return {
        type: 'example',
        content: p ? parseInlineContent(p) : parseInlineContent(el),
      }
    }

    case 'table-wrap':
      return parseTableWrap(el)

    case 'fig':
      return parseFig(el)

    case 'disp-formula':
      return parseFormula(el)

    case 'list':
      return parseList(el)

    default:
      return null
  }
}

/** 解析 <table-wrap> */
function parseTableWrap(el: Element): PMJsonNode {
  const stdTable: PMJsonNode = {
    type: 'stdTable',
    attrs: { id: el.getAttribute('id'), orientation: readPageOrientation(el) },
    content: [],
  }

  // 标题
  const captions = el.querySelectorAll(':scope > caption')
  let hasCaptionCn = false
  for (const caption of captions) {
    const lang = caption.getAttribute('lang')
    const titleEl = caption.querySelector(':scope > title')
    const content = titleEl ? parseInlineContent(titleEl) : parseInlineContent(caption)

    if (lang === 'en') {
      stdTable.content!.push({ type: 'tableCaptionEn', content })
    } else {
      stdTable.content!.push({ type: 'tableCaption', content })
      hasCaptionCn = true
    }
  }
  if (!hasCaptionCn) {
    stdTable.content!.unshift({ type: 'tableCaption', content: [] })
  }

  // 表格主体
  const table = el.querySelector(':scope > table')
  if (table) {
    stdTable.content!.push(parseHtmlTable(table))
  }

  // 表注
  const foot = el.querySelector(':scope > table-wrap-foot')
  if (foot) {
    const p = foot.querySelector(':scope > p')
    stdTable.content!.push({
      type: 'tableFootnote',
      content: p ? parseInlineContent(p) : [],
    })
  }

  return stdTable
}

/** 解析 <table> HTML 表格 */
function parseHtmlTable(el: Element): PMJsonNode {
  const table: PMJsonNode = {
    type: 'table',
    content: [],
  }

  for (const row of el.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr')) {
    const tableRow: PMJsonNode = {
      type: 'tableRow',
      content: [],
    }

    for (const cell of row.children) {
      const isHeader = cell.tagName === 'th'
      const cellNode: PMJsonNode = {
        type: isHeader ? 'tableHeader' : 'tableCell',
        attrs: {
          colspan: parseInt(cell.getAttribute('colspan') || '1', 10),
          rowspan: parseInt(cell.getAttribute('rowspan') || '1', 10),
        },
        content: [{
          type: 'paragraph',
          content: parseInlineContent(cell),
        }],
      }
      tableRow.content!.push(cellNode)
    }

    table.content!.push(tableRow)
  }

  return table
}

/** 解析 <fig> */
function parseFig(el: Element): PMJsonNode {
  const figure: PMJsonNode = {
    type: 'figure',
    attrs: { id: el.getAttribute('id'), orientation: readPageOrientation(el) },
    content: [],
  }

  // 图片
  const graphic = el.querySelector(':scope > graphic')
  figure.content!.push({
    type: 'figureImage',
    attrs: {
      src: graphic?.getAttribute('xlink:href') || graphic?.getAttribute('href') || '',
      alt: graphic?.getAttribute('alt') || '',
    },
  })

  // 标题
  const captions = el.querySelectorAll(':scope > caption')
  let hasCaptionCn = false
  for (const caption of captions) {
    const lang = caption.getAttribute('lang')
    const titleEl = caption.querySelector(':scope > title')
    const content = titleEl ? parseInlineContent(titleEl) : parseInlineContent(caption)

    if (lang === 'en') {
      figure.content!.push({ type: 'figureCaptionEn', content })
    } else {
      figure.content!.push({ type: 'figureCaption', content })
      hasCaptionCn = true
    }
  }
  if (!hasCaptionCn) {
    figure.content!.push({ type: 'figureCaption', content: [] })
  }

  return figure
}

/** 解析 <disp-formula> */
function parseFormula(el: Element): PMJsonNode {
  const formula: PMJsonNode = {
    type: 'formula',
    attrs: { id: el.getAttribute('id') },
    content: [],
  }

  // LaTeX 内容
  const texMath = el.querySelector(':scope > tex-math')
  formula.content!.push({
    type: 'formulaContent',
    content: texMath
      ? [{ type: 'text', text: texMath.textContent?.trim() || '' }]
      : [],
  })

  // 公式说明
  const defList = el.querySelector(':scope > def-list')
  if (defList) {
    const p = defList.querySelector(':scope > p')
    formula.content!.push({
      type: 'formulaDescription',
      content: p ? parseInlineContent(p) : parseInlineContent(defList),
    })
  }

  return formula
}

/** 解析 <list> */
export function fromXmlListType(xmlType: string): string {
  const listTypeMap: Record<string, string> = {
    dash: 'dash',
    'alpha-lower': 'alpha',
    arabic: 'numeric',
    bullet: 'dot',
    // 兼容先前测试版导出的非标准值。
    dot: 'dot',
    'roman-lower': 'numeric',
    'roman-upper': 'numeric',
  }
  return listTypeMap[xmlType] || 'dash'
}

function parseList(el: Element): PMJsonNode {
  const xmlType = el.getAttribute('list-type') || 'dash'
  const listType = fromXmlListType(xmlType)

  const list: PMJsonNode = {
    type: 'stdList',
    attrs: { listType, level: listType === 'numeric' || listType === 'dot' ? 2 : 1 },
    content: [],
  }

  for (const item of el.querySelectorAll(':scope > list-item')) {
    const p = item.querySelector(':scope > p')
    list.content!.push({
      type: 'stdListItem',
      content: p ? parseInlineContent(p) : parseInlineContent(item),
    })
  }

  // 确保至少有一个列项
  if (list.content!.length === 0) {
    list.content!.push({ type: 'stdListItem', content: [] })
  }

  return list
}

/** 解析块级子元素列表 */
function parseBlockChildren(el: Element): PMJsonNode[] {
  const result: PMJsonNode[] = []
  for (const child of el.children) {
    const node = parseBlockElement(child)
    if (node) result.push(node)
  }
  // 确保至少有内容
  if (result.length === 0) {
    result.push({ type: 'stdParagraph', content: [] })
  }
  return result
}

/**
 * 解析行内内容（文本 + marks）
 * 返回 ProseMirror JSON 内容数组
 */
function parseInlineContent(el: Element): PMJsonNode[] {
  const result: PMJsonNode[] = []

  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (text) {
        result.push({ type: 'text', text })
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const childEl = node as Element
      const tag = childEl.tagName

      // 行内标记元素
      const markMap: Record<string, string> = {
        'bold': 'bold',
        'b': 'bold',
        'strong': 'bold',
        'italic': 'italic',
        'i': 'italic',
        'em': 'italic',
        'sub': 'subscript',
        'sup': 'superscript',
        'underline': 'underline',
        'u': 'underline',
        'strike': 'strike',
        's': 'strike',
        'del': 'strike',
      }

      if (tag === 'xref') {
        // 交叉引用
        const innerNodes = parseInlineContent(childEl)
        for (const inner of innerNodes) {
          if (inner.type === 'text') {
            inner.marks = inner.marks || []
            inner.marks.push({
              type: 'crossRef',
              attrs: {
                refId: childEl.getAttribute('rid') || '',
                refType: childEl.getAttribute('ref-type') || 'sec',
              },
            })
          }
          result.push(inner)
        }
      } else if (tag === 'break' || tag === 'br') {
        result.push({ type: 'hardBreak' })
      } else if (markMap[tag]) {
        // 行内格式标记
        const markType = markMap[tag]
        const innerNodes = parseInlineContent(childEl)
        for (const inner of innerNodes) {
          if (inner.type === 'text') {
            inner.marks = inner.marks || []
            inner.marks.push({ type: markType })
          }
          result.push(inner)
        }
      } else {
        // 未知行内元素，尝试提取文本
        const innerNodes = parseInlineContent(childEl)
        result.push(...innerNodes)
      }
    } else if (node.nodeType === Node.CDATA_SECTION_NODE) {
      const text = node.textContent || ''
      if (text) {
        result.push({ type: 'text', text })
      }
    }
  }

  return result
}
