/**
 * docxTemplateExporter — 基于官方 .dotx 模板的导出器
 *
 * 与 docxExporter.ts (从零构建) 不同，本模块直接以官方模板为基板：
 *   1. fetch `/templates/{type}.dotx`
 *   2. JSZip 打开 ZIP
 *   3. 在 document.xml 中：
 *      - 替换封面上的占位文本（ICS / CCS / 标题 / 一致性程度 / 等）
 *      - 用 styleId 锚定的方式重写"标准编号" / "发布日期" / "实施日期"段
 *        （这三段的文字被切分到很多个 w:r，简单文本替换无效）
 *      - 把封面分节符之后、正文分节符之前的内容整体替换为编辑器生成的正文
 *   4. 同步更新 word/header*.xml 与 docProps/core.xml
 *   5. 重新打包为 .docx Blob
 *
 * 这种"模板填充"方式保留了模板里 ~150 个自定义段落 / 字符样式、
 * 页眉页脚、页边距、字体设置 —— 因此导出文档天然符合 GB/T 1.1 排版。
 */

import JSZip from 'jszip'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { DocMeta, StandardType } from './docxExporter'

const TEMPLATE_URL: Record<StandardType, string> = {
  gb: '/templates/national.dotx',
  industry: '/templates/industry.dotx',
  local: '/templates/local.dotx',
  group: '/templates/group.dotx',
  enterprise: '/templates/enterprise.dotx',
  // GB/Z 指导性技术文件沿用国标模板
  guide: '/templates/national.dotx',
}

/**
 * 模板内的样式 ID。5 份模板共用同一套 styleId（来源于官方母版），
 * 因此这张表对所有标准类型通用。
 */
const STYLE_ID = {
  chapterTitle: 'affc',                                        // 标准文件_章标题
  paragraph: 'affffb',                                         // 标准文件_段
  clauseTitle: ['affd', 'affe', 'afff', 'afff0', 'afff1'],     // 一~五级条标题
  noTitleClause: ['a0', 'a1', 'a2', 'a3', 'a4'],               // 一~五级无标题条
  appendixChapter: 'affffff',                                  // 附录章标题
  appendixLabel: 'aff3',                                       // 附录标识
  appendixTitle: 'afffffffff4',                                // 附录标题
  appendixClause: ['aff4', 'aff5', 'aff6', 'aff7', 'aff8'],    // 附录一~五级条标题
  forewordTitle: 'affb',                                       // 前言标题
  introductionTitle: 'affffffffb',                             // 引言标题
  bibTitle: 'afffff2',                                         // 参考文献标题
  bibEntry: 'a',                                               // 参考文献条目
  tableCaption: 'aff2',                                        // 正文表标题
  figureCaption: 'afd',                                        // 正文图标题
  formula: 'affffffd',                                         // 正文公式
  note: 'afff2',                                               // 注：
  example: 'ac',                                               // 示例：
  appendixFigure: 'af9',                                       // 附录图标题
  appendixTable: 'aff',                                        // 附录表标题
  listDash: 'af1',                                             // 破折号列项
  listNum: 'aff9',                                             // 数字编号列项
  listAlpha: 'af5',                                            // 字母编号列项
  listRoman: 'ae',                                             // 小写罗马数字
  listRomanUpper: 'aff1',                                      // 大写罗马数字
  listBoxed: 'ad',                                             // 方框数字
  termDef: ['afffffffffff5', 'afffffffffff6', 'afffffffffff7', 'afffffffffff8', 'afffffffffff9'], // 术语条一~五
}

/** 占位字符串 → 取值函数（命中即替换全部 occurrence） */
const TEXT_PLACEHOLDERS: { needle: string; value: (m: DocMeta) => string }[] = [
  { needle: '点击此处添加ICS号', value: m => m.icsCode ?? '' },
  { needle: '点击此处添加CCS号', value: m => m.ccsCode ?? '' },
  { needle: '点击此处添加标准名称的英文译名', value: m => m.titleEn ?? '' },
  { needle: '点击此处添加标准名称', value: m => m.title ?? '' },
  { needle: '(点击此处添加与国际标准一致性程度的标识)', value: () => '' },
  { needle: '点击此处添加与国际标准一致性程度的标识', value: () => '' },
  { needle: '（本草案完成时间：）', value: () => '' },
  { needle: '==请在此处编写适用范围==', value: () => '' },
  { needle: '==请在此处逐条编写规范性引用文件==', value: () => '' },
  { needle: '==请在此处继续编写术语和定义==', value: () => '' },
  { needle: '==请在此处继续编写正文==', value: () => '' },
  { needle: '点击此处，以便选择适当的引导语', value: () => '' },
  { needle: '点击并选择适当的引导语', value: () => '' },
  { needle: '代替 XX/T', value: () => '' },
]

export async function exportDocxFromTemplate(pmDoc: PMNode, meta: DocMeta): Promise<Blob> {
  const stype: StandardType = (meta.standardType ?? 'gb') as StandardType
  const tplUrl = TEMPLATE_URL[stype] ?? TEMPLATE_URL.gb

  const res = await fetch(tplUrl)
  if (!res.ok) throw new Error(`无法加载模板 ${tplUrl}：HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)

  await rewriteDocumentXml(zip, pmDoc, meta)
  await rewriteHeaders(zip, meta)
  await rewriteCoreProps(zip, meta)
  await convertTemplateToDocument(zip)

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

// ============================================================
// .dotx → .docx 转换：修复 Content-Type 使 Word 能正常打开
// ============================================================

/**
 * 官方模板是 .dotx 格式，其 [Content_Types].xml 把 /word/document.xml
 * 声明为 `template.main+xml`。导出为 .docx 时 Word 会因 Content-Type
 * 不匹配而拒绝打开（WPS 较宽松不受影响）。
 * 本函数将模板类型替换为文档类型，并移除可能导致兼容问题的空目录条目。
 */
async function convertTemplateToDocument(zip: JSZip): Promise<void> {
  const ctFile = zip.file('[Content_Types].xml')
  if (!ctFile) return
  let ct = await ctFile.async('string')
  // template.main+xml → document.main+xml
  ct = ct.replace(
    /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.template\.main\+xml/g,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  )
  zip.file('[Content_Types].xml', ct)

  // 移除空目录条目（Word 对此比 WPS 更严格）
  zip.remove('word/')
  zip.remove('docProps/')
}

// ============================================================
// document.xml 重写
// ============================================================

async function rewriteDocumentXml(zip: JSZip, pmDoc: PMNode, meta: DocMeta): Promise<void> {
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('模板缺少 word/document.xml')
  let xml = await file.async('string')

  // 1) 简单文本替换（占位词）
  xml = applyTextPlaceholders(xml, meta)

  // 2) 跨 w:r 拆分的封面段：按 styleId 重写整段
  xml = rewriteParagraphByStyle(xml, 'affffffffff3', buildStdNumber(meta))
  xml = rewriteParagraphByStyle(xml, 'affffffffff1', formatPublishDate(meta))
  xml = rewriteParagraphByStyle(xml, 'affffffffff2', formatImplementDate(meta))

  // 3) 正文区整体替换
  xml = replaceBodyRegion(xml, pmDoc)

  zip.file('word/document.xml', xml)
}

function applyTextPlaceholders(xml: string, meta: DocMeta): string {
  let out = xml
  for (const { needle, value } of TEXT_PLACEHOLDERS) {
    const replacement = escapeXmlText(value(meta))
    out = out.split(needle).join(replacement)
  }
  // 后处理：模板里像 `(点击此处添加与国际标准一致性程度的标识)`
  // 的左右括号是独立 w:r，简单文本替换会留下空的 "()" 段。
  // 这里把整段只剩括号的段落清空。
  out = clearEmptyParenParagraphs(out)
  return out
}

function clearEmptyParenParagraphs(xml: string): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraph => {
    const texts = paragraph.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) || []
    const joined = texts
      .map(t => t.replace(/<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>/, ''))
      .join('')
    // 只有空白 + 括号 → 视为占位副产物
    if (joined.length === 0) return paragraph
    if (!/^[\s  （）()【】\[\]]*$/.test(joined)) return paragraph
    if (!/[（）()【】\[\]]/.test(joined)) return paragraph
    // 清除所有 w:r，保留 pPr
    const pPr = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
    const opening = paragraph.match(/^<w:p\b[^>]*>/)?.[0] ?? '<w:p>'
    return `${opening}${pPr?.[0] ?? ''}</w:p>`
  })
}

/**
 * 按 styleId 锚定段落，删掉它原有的所有 w:r / bookmark，
 * 注入一个新的 w:r 包含目标文本。pPr (含 pStyle) 整体保留。
 */
function rewriteParagraphByStyle(xml: string, styleId: string, text: string): string {
  if (!text) return xml
  const re = new RegExp(
    `(<w:p\\b[^>]*>\\s*<w:pPr>[\\s\\S]*?<w:pStyle\\s+w:val="${styleId}"[^>]*/?>[\\s\\S]*?</w:pPr>)([\\s\\S]*?)(</w:p>)`,
    'g',
  )
  return xml.replace(re, (_, pPr, _body, close) => {
    return `${pPr}<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>${close}`
  })
}

/**
 * 把封面分节符后的所有 body 段落替换为由编辑器内容生成的段落。
 * 锚点：
 *   - 起点 = 第一个 <w:sectPr> 所在的 <w:p>...</w:p> 的末尾
 *           （封面分节段：<w:p><w:pPr><w:sectPr>…</w:sectPr></w:pPr></w:p>）
 *   - 终点 = 最后一个 <w:sectPr> 的起点（body 级 sectPr，紧贴 </w:body>）
 */
function replaceBodyRegion(xml: string, pmDoc: PMNode): string {
  const firstSectPr = xml.indexOf('<w:sectPr')
  if (firstSectPr < 0) return xml
  const coverEnd = xml.indexOf('</w:p>', firstSectPr)
  if (coverEnd < 0) return xml
  const coverEndPos = coverEnd + '</w:p>'.length

  const lastSectPr = xml.lastIndexOf('<w:sectPr')
  if (lastSectPr <= coverEndPos) return xml

  const newBody = renderBody(pmDoc)
  return xml.slice(0, coverEndPos) + newBody + xml.slice(lastSectPr)
}

// ============================================================
// 编辑器 doc → docx 段落 XML
// ============================================================

interface RenderCtx {
  inAppendix: boolean
  inIntroduction: boolean
  chapterNo: number
  clauseNos: [number, number, number, number, number]
  figureNo: number
  tableNo: number
  noteNo: number
  exampleNo: number
}

function createRenderCtx(overrides: Partial<RenderCtx> = {}): RenderCtx {
  return {
    inAppendix: false,
    inIntroduction: false,
    chapterNo: 0,
    clauseNos: [0, 0, 0, 0, 0],
    figureNo: 0,
    tableNo: 0,
    noteNo: 0,
    exampleNo: 0,
    ...overrides,
  }
}

function renderBody(pmDoc: PMNode): string {
  const lines: string[] = []
  const rootCtx = createRenderCtx()
  // 在封面分节符与第一个章之间留一行空白
  lines.push('<w:p/>')

  pmDoc.forEach(node => renderTopLevel(lines, node, rootCtx))
  return lines.join('')
}

function renderTopLevel(out: string[], node: PMNode, rootCtx: RenderCtx): void {
  switch (node.type.name) {
    case 'coverPage':
      // 封面信息已由模板提供，编辑器中的 coverPage 节点忽略
      return
    case 'foreword':
      out.push(paragraph(STYLE_ID.forewordTitle, run('前言')))
      node.forEach(c => renderBlock(out, c, createRenderCtx()))
      return
    case 'introduction':
      out.push(paragraph(STYLE_ID.introductionTitle, run('引言')))
      node.forEach(c => renderBlock(out, c, createRenderCtx({ inIntroduction: true })))
      return
    case 'chapter':
      rootCtx.chapterNo += 1
      renderChapter(out, node, rootCtx.chapterNo)
      return
    case 'appendix':
      renderAppendix(out, node)
      return
    case 'bibliography':
      renderBibliography(out, node)
      return
    default:
      // 其余顶层节点降级为正文段
      renderBlock(out, node, createRenderCtx())
  }
}

function renderChapter(out: string[], node: PMNode, chapterNo: number): void {
  const ctx = createRenderCtx({ chapterNo })
  let first = true
  node.forEach(child => {
    if (first && child.type.name === 'chapterTitle') {
      out.push(paragraph(STYLE_ID.chapterTitle, run(`${chapterNo} `) + inline(child)))
      first = false
    } else {
      renderBlock(out, child, ctx)
    }
  })
}

function renderAppendix(out: string[], node: PMNode): void {
  // 附录标识 + 附录标题
  const labelNode = node.firstChild
  const labelText = labelNode?.type.name === 'appendixLabel' ? inline(labelNode) : run('')
  out.push(paragraph(STYLE_ID.appendixLabel, labelText))

  let idx = 0
  node.forEach(child => {
    if (idx++ === 0 && child.type.name === 'appendixLabel') return
    if (child.type.name === 'appendixTitle') {
      out.push(paragraph(STYLE_ID.appendixChapter, inline(child)))
    } else {
      renderBlock(out, child, createRenderCtx({ inAppendix: true }))
    }
  })
}

function renderBibliography(out: string[], node: PMNode): void {
  let first = true
  node.forEach(child => {
    if (first && child.type.name === 'bibliographyTitle') {
      out.push(paragraph(STYLE_ID.bibTitle, inline(child)))
      first = false
      return
    }
    if (child.type.name === 'bibEntry') {
      out.push(paragraph(STYLE_ID.bibEntry, inline(child)))
    } else {
      renderBlock(out, child, createRenderCtx())
    }
  })
}

function renderBlock(out: string[], node: PMNode, ctx: RenderCtx): void {
  switch (node.type.name) {
    case 'stdParagraph':
    case 'paragraph':
      out.push(paragraph(STYLE_ID.paragraph, inline(node)))
      return
    case 'clause':
      renderClause(out, node, ctx)
      return
    case 'note':
      ctx.noteNo += 1
      out.push(paragraph(STYLE_ID.note, run(ctx.noteNo > 1 ? `注${ctx.noteNo}：` : '注：') + inline(node)))
      return
    case 'example':
      ctx.exampleNo += 1
      out.push(paragraph(STYLE_ID.example, run(ctx.exampleNo > 1 ? `示例${ctx.exampleNo}：` : '示例：') + inline(node)))
      return
    case 'figure':
      renderFigure(out, node, ctx)
      return
    case 'stdTable':
      renderTable(out, node, ctx)
      return
    case 'formula':
      renderFormula(out, node)
      return
    case 'stdList':
      renderList(out, node)
      return
    case 'termDef':
      renderTermDef(out, node)
      return
    default:
      if (node.isTextblock) {
        out.push(paragraph(STYLE_ID.paragraph, inline(node)))
      } else {
        node.forEach(c => renderBlock(out, c, ctx))
      }
  }
}

function renderClause(out: string[], node: PMNode, ctx: RenderCtx): void {
  const level = clamp(Number(node.attrs.level) || 1, 1, 5)
  const hasTitle = node.attrs.hasTitle !== false
  const titleStyles = ctx.inAppendix ? STYLE_ID.appendixClause : STYLE_ID.clauseTitle
  const noTitleStyle = STYLE_ID.noTitleClause[level - 1]

  let first = true
  const clauseNo = nextClauseNo(ctx, level)
  node.forEach(child => {
    if (first && child.type.name === 'clauseTitle') {
      const styleId = hasTitle ? titleStyles[level - 1] : noTitleStyle
      out.push(paragraph(styleId, run(`${clauseNo} `) + inline(child)))
      first = false
    } else {
      renderBlock(out, child, ctx)
    }
  })
}

function renderFigure(out: string[], node: PMNode, ctx: RenderCtx): void {
  let imageAlt = ''
  let captionRuns = ''
  node.forEach(child => {
    if (child.type.name === 'figureImage') {
      imageAlt = `[图片：${child.attrs.alt || child.attrs.src || '未提供路径'}]`
    } else if (child.type.name === 'figureCaption') {
      captionRuns = inline(child)
    }
  })
  // 图片占位段（图片真正嵌入需要额外处理 media + rels，本版略）
  if (imageAlt) out.push(paragraph(STYLE_ID.paragraph, run(imageAlt)))
  if (captionRuns) {
    ctx.figureNo += 1
    out.push(paragraph(ctx.inAppendix ? STYLE_ID.appendixFigure : STYLE_ID.figureCaption, run(`图${ctx.chapterNo}.${ctx.figureNo} `) + captionRuns))
  }
}

function renderTable(out: string[], node: PMNode, ctx: RenderCtx): void {
  let caption = ''
  let tableNode: PMNode | null = null
  let footnote = ''
  node.forEach(child => {
    switch (child.type.name) {
      case 'tableCaption':
        caption = inline(child)
        break
      case 'table':
        tableNode = child
        break
      case 'tableFootnote':
        footnote = inline(child)
        break
    }
  })
  if (caption) {
    ctx.tableNo += 1
    out.push(paragraph(ctx.inAppendix ? STYLE_ID.appendixTable : STYLE_ID.tableCaption, run(`表${ctx.chapterNo}.${ctx.tableNo} `) + caption))
  }
  if (tableNode) {
    out.push(renderTableXml(tableNode))
  }
  if (footnote) {
    out.push(paragraph(STYLE_ID.paragraph, footnote))
  }
}

function renderTableXml(table: PMNode): string {
  const rows: string[] = []
  table.forEach(row => {
    if (row.type.name !== 'tableRow') return
    const cells: string[] = []
    row.forEach(cell => {
      if (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader') return
      const tcParts: string[] = []
      cell.forEach(p => {
        if (p.isTextblock) {
          tcParts.push(paragraph(STYLE_ID.paragraph, inline(p)))
        }
      })
      const colspan = Number(cell.attrs.colspan) || 1
      const rowspan = Number(cell.attrs.rowspan) || 1
      const tcPr: string[] = []
      if (colspan > 1) tcPr.push(`<w:gridSpan w:val="${colspan}"/>`)
      if (rowspan > 1) tcPr.push('<w:vMerge w:val="restart"/>')
      cells.push(
        `<w:tc>${tcPr.length ? `<w:tcPr>${tcPr.join('')}</w:tcPr>` : ''}${
          tcParts.join('') || '<w:p/>'
        }</w:tc>`,
      )
    })
    rows.push(`<w:tr>${cells.join('')}</w:tr>`)
  })
  return (
    '<w:tbl>' +
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
    '</w:tblBorders></w:tblPr>' +
    rows.join('') +
    '</w:tbl>'
  )
}

function renderFormula(out: string[], node: PMNode): void {
  let content = ''
  let description = ''
  node.forEach(child => {
    if (child.type.name === 'formulaContent') content = inline(child)
    else if (child.type.name === 'formulaDescription') description = inline(child)
  })
  if (content) out.push(paragraph(STYLE_ID.formula, content))
  if (description) out.push(paragraph(STYLE_ID.paragraph, description))
}

const LIST_STYLE: Record<string, string> = {
  dash: STYLE_ID.listDash,
  alpha: STYLE_ID.listAlpha,
  numeric: STYLE_ID.listNum,
  roman: STYLE_ID.listRoman,
  romanUpper: STYLE_ID.listRomanUpper,
  boxedNumeric: STYLE_ID.listBoxed,
}

function renderList(out: string[], node: PMNode): void {
  const listType = String(node.attrs.listType || 'dash')
  const style = LIST_STYLE[listType] || STYLE_ID.listDash
  node.forEach(item => {
    if (item.type.name !== 'stdListItem') return
    out.push(paragraph(style, inline(item)))
  })
}

function renderTermDef(out: string[], node: PMNode): void {
  const level = clamp(Number(node.attrs.level) || 1, 1, 5)
  const style = STYLE_ID.termDef[level - 1]
  // term name + 英文 + definition 合并成一段
  const parts: string[] = []
  node.forEach(child => {
    const t = child.type.name
    if (t === 'termName' || t === 'termNameEn' || t === 'termDefinition') {
      const ix = inline(child)
      if (ix) parts.push(ix)
    }
  })
  out.push(paragraph(style, parts.join(run('\t'))))
}

function nextClauseNo(ctx: RenderCtx, level: number): string {
  const idx = level - 1
  ctx.clauseNos[idx] += 1
  for (let i = idx + 1; i < ctx.clauseNos.length; i += 1) ctx.clauseNos[i] = 0
  return ctx.clauseNos.slice(0, level).join('.')
}

// ============================================================
// 行内 / 段落工具
// ============================================================

function inline(node: PMNode): string {
  const runs: string[] = []
  node.forEach(child => {
    if (child.isText) {
      runs.push(textRun(child.text || '', child.marks))
    } else if (child.type.name === 'hardBreak') {
      runs.push('<w:r><w:br/></w:r>')
    } else if (child.isInline) {
      // 行内的复合节点（如 inline crossRef）— 递归取文本
      const inner = (child as unknown as { textContent?: string }).textContent
      if (typeof inner === 'string' && inner.length) {
        runs.push(textRun(inner, []))
      }
    }
  })
  return runs.join('')
}

interface PMMark {
  type: { name: string }
  attrs?: Record<string, unknown>
}

function textRun(text: string, marks: readonly PMMark[]): string {
  const props: string[] = []
  let isCrossRef = false
  for (const m of marks) {
    switch (m.type.name) {
      case 'bold': props.push('<w:b/><w:bCs/>'); break
      case 'italic': props.push('<w:i/><w:iCs/>'); break
      case 'underline': props.push('<w:u w:val="single"/>'); break
      case 'strike': props.push('<w:strike/>'); break
      case 'crossRef':
        isCrossRef = true
        props.push('<w:color w:val="0070C0"/>')
        break
    }
  }
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  // crossRef 渲染的文本：优先使用 mark.attrs.refText (实际编号)
  let displayText = text
  if (isCrossRef) {
    const refText = marks.find(m => m.type.name === 'crossRef')?.attrs?.refText
    if (typeof refText === 'string' && refText) displayText = refText
  }
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(displayText)}</w:t></w:r>`
}

function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`
}

function paragraph(styleId: string, runsXml: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>${runsXml}</w:p>`
}

// ============================================================
// 元数据格式化
// ============================================================

function buildStdNumber(meta: DocMeta): string {
  if (meta.stdCode) return meta.stdCode
  return '' // 留空时，模板自带的 XXXXX—XXXX 不会被替换，提示用户标准号未填
}

function formatPublishDate(meta: DocMeta): string {
  if (!meta.publishDate) return ''
  return `${formatYmd(meta.publishDate)}发布`
}

function formatImplementDate(meta: DocMeta): string {
  if (!meta.implementDate) return ''
  return `${formatYmd(meta.implementDate)}实施`
}

function formatYmd(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y} - ${m} - ${day}`
}

// ============================================================
// headers + core.xml
// ============================================================

async function rewriteHeaders(zip: JSZip, meta: DocMeta): Promise<void> {
  const wordDir = zip.folder('word')
  if (!wordDir) return
  const headerEntries: string[] = []
  zip.forEach(relPath => {
    if (/^word\/header\d+\.xml$/.test(relPath)) headerEntries.push(relPath)
  })
  for (const path of headerEntries) {
    const f = zip.file(path)
    if (!f) continue
    let xml = await f.async('string')
    xml = applyTextPlaceholders(xml, meta)
    if (meta.stdCode) {
      // 页眉里的标准号也是分散在多个 w:r，按 paragraph 重写不一定有 styleId 锚点
      // 退而求其次：直接拼出 "GB/T XXXXX—XXXX" / "T/... XXXX—XXXX" / 等已知模式做替换
      xml = replaceHeaderStdNumber(xml, meta.stdCode)
    }
    zip.file(path, xml)
  }
}

function replaceHeaderStdNumber(xml: string, stdCode: string): string {
  // 移除 w:r 包装后的文本，把可识别的 "XXXXX—XXXX" / "XXXX—XXXX" / "XXX XXXX-XXXX" 模板号
  // 整体替换为 stdCode。简化处理：在每个段落中若同时出现 "XXXXX" 或 "XXXX—XXXX"，
  // 整段重写为纯文本 stdCode。
  return xml.replace(
    /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g,
    (full, inner: string) => {
      if (
        inner.includes('GB/T') ||
        inner.includes('XX/T') ||
        inner.includes('DB') ||
        inner.includes('T/') ||
        inner.includes('Q/')
      ) {
        // 找到 pPr，保留
        const pPrMatch = inner.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
        const pPr = pPrMatch ? pPrMatch[0] : ''
        return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXmlText(stdCode)}</w:t></w:r></w:p>`
      }
      return full
    },
  )
}

async function rewriteCoreProps(zip: JSZip, meta: DocMeta): Promise<void> {
  const f = zip.file('docProps/core.xml')
  if (!f) return
  let xml = await f.async('string')
  const title = meta.title || ''
  if (title) {
    if (xml.includes('<dc:title>')) {
      xml = xml.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${escapeXmlText(title)}</dc:title>`)
    } else {
      xml = xml.replace(/<dc:subject>/, `<dc:title>${escapeXmlText(title)}</dc:title><dc:subject>`)
    }
  }
  zip.file('docProps/core.xml', xml)
}

// ============================================================
// 工具
// ============================================================

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
