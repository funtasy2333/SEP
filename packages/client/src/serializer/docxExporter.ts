/**
 * DOCX 导出器
 * 将 ProseMirror 文档导出为符合 GB/T 1.1-2020 的 Word 文档
 */

import {
  AlignmentType,
  Document,
  Footer,
  Header,
  ImageRun,
  LineRuleType,
  NumberFormat,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip as mm2t,
} from 'docx'
import type { Node as PMNode } from '@tiptap/pm/model'

// =================== 类型定义 ===================

export type StandardType = 'gb' | 'industry' | 'local' | 'group' | 'enterprise' | 'guide'

export const STANDARD_TYPE_LABELS: Record<StandardType, string> = {
  gb: '国家标准',
  industry: '行业标准',
  local: '地方标准',
  group: '团体标准',
  enterprise: '企业标准',
  guide: '标准化指导性技术文件',
}

export interface DocMeta {
  title?: string
  titleEn?: string
  stdCode?: string
  icsCode?: string
  ccsCode?: string
  issuer?: string
  applicant?: string
  publishDate?: string
  implementDate?: string
  standardType?: StandardType
}

interface ExportCtx {
  chapterNo: number
  appendixNo: number
  appendixLetter: string
  inAppendix: boolean
  clauseNos: [number, number, number, number, number]
  appendixClauseNos: [number, number, number, number, number]
  figNo: number
  tableNo: number
  formulaNo: number
  noteNo: number
  exampleNo: number
}

type DocxEl = Paragraph | Table

// =================== 常量 ===================

// 字体定义
const FONT_BODY = { ascii: 'Times New Roman', eastAsia: 'SimSun', hAnsi: 'Times New Roman', cs: 'SimSun' }
const FONT_HEADING = { ascii: 'SimHei', eastAsia: 'SimHei', hAnsi: 'SimHei', cs: 'SimHei' }
const FONT_TABLE = { ascii: 'Times New Roman', eastAsia: 'SimSun', hAnsi: 'Times New Roman', cs: 'SimSun' }

// 字号（半点数，1pt=2半点）
const SIZE_BODY = 24       // 12pt (小4号)
const SIZE_CH = 30         // 15pt (小3号) 章标题
const SIZE_CL1 = 28        // 14pt (4号) 一级条
const SIZE_CL2 = 26        // 13pt
const SIZE_CL35 = 24       // 12pt 三至五级条
const SIZE_CAPTION = 20    // 10pt 表题/图题
const SIZE_NOTE = 20       // 10pt 注

// 页面 (A4)
const PAGE_W = mm2t(210)
const PAGE_H = mm2t(297)
const MARGIN_TOP = mm2t(37)
const MARGIN_BOTTOM = mm2t(35)
const MARGIN_LEFT = mm2t(28)
const MARGIN_RIGHT = mm2t(28)
const MARGIN_HEADER = mm2t(15)
const MARGIN_FOOTER = mm2t(17.5)

// 缩进
const INDENT_BODY = mm2t(8)  // 约2字符缩进 (2em@12pt)

// =================== 样式定义 ===================

function buildStyles() {
  return {
    paragraphStyles: [
      // 标准正文
      {
        id: 'BodyText',
        name: '标准正文',
        basedOn: 'Normal',
        quickFormat: true,
        paragraph: {
          indent: { firstLine: INDENT_BODY },
          spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 章标题
      {
        id: 'ChapterTitle',
        name: '章标题',
        basedOn: 'Normal',
        paragraph: {
          spacing: { before: mm2t(3), after: mm2t(3), line: 360, lineRule: LineRuleType.AUTO },
        },
        run: { font: FONT_HEADING, size: SIZE_CH, bold: true },
      },
      // 条标题（一级）
      {
        id: 'Clause1Title',
        name: '一级条标题',
        basedOn: 'Normal',
        paragraph: {
          indent: { firstLine: 0 },
          spacing: { before: mm2t(2), after: mm2t(1), line: 360, lineRule: LineRuleType.AUTO },
        },
        run: { font: FONT_HEADING, size: SIZE_CL1, bold: true },
      },
      // 条标题（二级）
      {
        id: 'Clause2Title',
        name: '二级条标题',
        basedOn: 'Normal',
        paragraph: {
          indent: { firstLine: 0 },
          spacing: { before: mm2t(1), after: mm2t(1), line: 360, lineRule: LineRuleType.AUTO },
        },
        run: { font: FONT_HEADING, size: SIZE_CL2, bold: true },
      },
      // 条标题（三至五级）
      {
        id: 'Clause35Title',
        name: '三至五级条标题',
        basedOn: 'Normal',
        paragraph: {
          indent: { firstLine: 0 },
          spacing: { before: mm2t(1), after: 0, line: 360, lineRule: LineRuleType.AUTO },
        },
        run: { font: FONT_HEADING, size: SIZE_CL35, bold: true },
      },
      // 无题条正文（同正文，前缀编号黑体）
      {
        id: 'ClauseNoTitle',
        name: '无题条',
        basedOn: 'BodyText',
        paragraph: {
          indent: { firstLine: INDENT_BODY },
          spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 表标题
      {
        id: 'TableCaptionStyle',
        name: '正文表标题',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(1), after: mm2t(1) },
        },
        run: { font: FONT_HEADING, size: SIZE_CAPTION },
      },
      // 图标题
      {
        id: 'FigureCaptionStyle',
        name: '正文图标题',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(1), after: mm2t(1) },
        },
        run: { font: FONT_HEADING, size: SIZE_CAPTION },
      },
      // 公式
      {
        id: 'FormulaStyle',
        name: '正文公式',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(2), after: mm2t(2) },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 注
      {
        id: 'NoteStyle',
        name: '条文脚注',
        basedOn: 'Normal',
        paragraph: {
          indent: { firstLine: INDENT_BODY },
          spacing: { line: 280, lineRule: LineRuleType.AUTO, before: mm2t(1), after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_NOTE },
      },
      // 示例
      {
        id: 'ExampleStyle',
        name: '示例',
        basedOn: 'Normal',
        paragraph: {
          indent: { firstLine: INDENT_BODY },
          spacing: { line: 280, lineRule: LineRuleType.AUTO, before: mm2t(1), after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_NOTE },
      },
      // 列项（一级）
      {
        id: 'ListItem1',
        name: '一级列项',
        basedOn: 'Normal',
        paragraph: {
          indent: { left: INDENT_BODY, hanging: mm2t(4) },
          spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 列项（二级）
      {
        id: 'ListItem2',
        name: '二级列项',
        basedOn: 'Normal',
        paragraph: {
          indent: { left: mm2t(16), hanging: mm2t(4) },
          spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 附录标识行
      {
        id: 'AppendixLabelStyle',
        name: '附录标识',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(3), after: mm2t(1) },
        },
        run: { font: FONT_HEADING, size: SIZE_BODY, bold: true },
      },
      // 附录标题
      {
        id: 'AppendixTitleStyle',
        name: '附录标题',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(1), after: mm2t(3) },
        },
        run: { font: FONT_HEADING, size: SIZE_CL1, bold: true },
      },
      // 参考文献标题
      {
        id: 'BibTitleStyle',
        name: '参考文献标题',
        basedOn: 'ChapterTitle',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(3), after: mm2t(3) },
        },
        run: { font: FONT_HEADING, size: SIZE_CH, bold: true },
      },
      // 参考文献条目
      {
        id: 'BibEntryStyle',
        name: '参考文献条目',
        basedOn: 'Normal',
        paragraph: {
          indent: { left: mm2t(12), hanging: mm2t(12) },
          spacing: { line: 360, lineRule: LineRuleType.AUTO, before: mm2t(1), after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 前言/引言标题
      {
        id: 'ForewordTitleStyle',
        name: '前言引言标题',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(3), after: mm2t(3) },
        },
        run: { font: FONT_HEADING, size: SIZE_CH, bold: true },
      },
      // 正文标准名称（正文首页顶部，与封面一致）
      {
        id: 'BodyTitle',
        name: '正文标准名称',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(5), after: mm2t(5) },
        },
        run: { font: FONT_HEADING, size: 32, bold: true },
      },
      // 术语名称
      {
        id: 'TermNameStyle',
        name: '术语名称',
        basedOn: 'Normal',
        paragraph: {
          spacing: { before: mm2t(2), after: mm2t(1), line: 360, lineRule: LineRuleType.AUTO },
        },
        run: { font: FONT_HEADING, size: SIZE_BODY, bold: true },
      },
      // 术语定义
      {
        id: 'TermDefStyle',
        name: '术语定义',
        basedOn: 'BodyText',
        paragraph: {
          indent: { firstLine: INDENT_BODY },
          spacing: { line: 360, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 封面：标准名称
      {
        id: 'CoverTitle',
        name: '封面标准名称',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(10), after: mm2t(5) },
        },
        run: { font: FONT_HEADING, size: 48, bold: true },
      },
      // 封面：英文名称
      {
        id: 'CoverTitleEn',
        name: '封面英文名称',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(5), after: mm2t(10) },
        },
        run: { font: { ascii: 'Times New Roman', eastAsia: 'SimSun', hAnsi: 'Times New Roman', cs: 'SimSun' }, size: 32, italics: true },
      },
      // 封面：标准编号
      {
        id: 'CoverCode',
        name: '封面标准编号',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(5), after: mm2t(5) },
        },
        run: { font: FONT_HEADING, size: 36, bold: true },
      },
      // 封面：发布/实施日期
      {
        id: 'CoverDate',
        name: '封面日期',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(2), after: mm2t(2) },
        },
        run: { font: FONT_BODY, size: SIZE_BODY },
      },
      // 封面：发布机构
      {
        id: 'CoverIssuer',
        name: '封面发布机构',
        basedOn: 'Normal',
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { before: mm2t(15), after: mm2t(3) },
        },
        run: { font: FONT_HEADING, size: 32, bold: true },
      },
    ],
  }
}

// =================== 上下文辅助函数 ===================

function createCtx(): ExportCtx {
  return {
    chapterNo: 0,
    appendixNo: 0,
    appendixLetter: '',
    inAppendix: false,
    clauseNos: [0, 0, 0, 0, 0],
    appendixClauseNos: [0, 0, 0, 0, 0],
    figNo: 0,
    tableNo: 0,
    formulaNo: 0,
    noteNo: 0,
    exampleNo: 0,
  }
}

function nextClauseNum(ctx: ExportCtx, level: number): string {
  const nos = ctx.inAppendix ? ctx.appendixClauseNos : ctx.clauseNos
  nos[level - 1]++
  for (let i = level; i < 5; i++) nos[i] = 0
  const prefix = ctx.inAppendix ? ctx.appendixLetter : String(ctx.chapterNo)
  return prefix + '.' + nos.slice(0, level).join('.')
}

function currentChapterPrefix(ctx: ExportCtx): string {
  return ctx.inAppendix ? ctx.appendixLetter : String(ctx.chapterNo)
}

// =================== 行内文本转换 ===================

function convertInlineNode(node: PMNode): TextRun[] {
  if (node.type.name === 'text') {
    const text = node.text || ''
    const opts: Parameters<typeof TextRun>[0] = {
      text,
      font: FONT_BODY,
      size: SIZE_BODY,
    }
    for (const mark of node.marks) {
      switch (mark.type.name) {
        case 'bold':
          opts.bold = true
          opts.font = FONT_HEADING  // 加粗时用黑体
          break
        case 'italic':
          opts.italics = true
          break
        case 'underline':
          opts.underline = {}
          break
        case 'strike':
          opts.strike = true
          break
      }
    }
    return [new TextRun(opts)]
  }
  const runs: TextRun[] = []
  node.forEach(child => { runs.push(...convertInlineNode(child)) })
  return runs
}

function getInlineRuns(node: PMNode): TextRun[] {
  const runs: TextRun[] = []
  node.forEach(child => { runs.push(...convertInlineNode(child)) })
  return runs
}

function paraFromRuns(runs: TextRun[], style: string): Paragraph {
  if (runs.length === 0) return new Paragraph({ style, text: '' })
  return new Paragraph({ style, children: runs })
}

// =================== 节点转换 ===================

function convertNode(node: PMNode, ctx: ExportCtx): DocxEl[] {
  const els: DocxEl[] = []

  switch (node.type.name) {

    case 'doc': {
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'foreword': {
      els.push(new Paragraph({ style: 'ForewordTitleStyle', text: '前　言', pageBreakBefore: false }))
      node.forEach(child => { if (child.type.name !== 'foreword') els.push(...convertNode(child, ctx)) })
      break
    }

    case 'introduction': {
      els.push(new Paragraph({ style: 'ForewordTitleStyle', text: '引　言', pageBreakBefore: true }))
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'chapter': {
      ctx.chapterNo++
      ctx.clauseNos = [0, 0, 0, 0, 0]
      ctx.inAppendix = false
      ctx.figNo = 0
      ctx.tableNo = 0
      ctx.formulaNo = 0
      ctx.noteNo = 0
      ctx.exampleNo = 0
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'chapterTitle': {
      const runs = getInlineRuns(node)
      els.push(new Paragraph({
        style: 'ChapterTitle',
        pageBreakBefore: ctx.chapterNo > 1,
        children: [
          new TextRun({ text: ctx.chapterNo + '  ', font: FONT_HEADING, size: SIZE_CH, bold: true }),
          ...runs.map(r => new TextRun({ ...r, bold: true, font: FONT_HEADING, size: SIZE_CH })),
        ],
      }))
      break
    }

    case 'clause': {
      const level = (node.attrs.level as number) || 1
      const hasTitle = node.attrs.hasTitle !== false
      const clauseNum = nextClauseNum(ctx, level)

      if (!hasTitle) {
        // 无题条：编号（黑体）+ 正文（宋体）
        let bodyRuns: TextRun[] = []
        node.forEach(child => {
          if (child.type.name === 'clauseTitle') {
            bodyRuns = getInlineRuns(child)
          }
        })
        els.push(new Paragraph({
          style: 'ClauseNoTitle',
          children: [
            new TextRun({ text: clauseNum + '  ', font: FONT_HEADING, size: SIZE_BODY, bold: true }),
            ...bodyRuns,
          ],
        }))
        // 处理后续子节点（非clauseTitle）
        node.forEach(child => {
          if (child.type.name !== 'clauseTitle') {
            els.push(...convertNode(child, ctx))
          }
        })
      } else {
        // 有题条
        const styleId = level <= 1 ? 'Clause1Title' : level === 2 ? 'Clause2Title' : 'Clause35Title'
        const fontSize = level <= 1 ? SIZE_CL1 : level === 2 ? SIZE_CL2 : SIZE_CL35
        node.forEach(child => {
          if (child.type.name === 'clauseTitle') {
            const runs = getInlineRuns(child)
            els.push(new Paragraph({
              style: styleId,
              children: [
                new TextRun({ text: clauseNum + '  ', font: FONT_HEADING, size: fontSize, bold: true }),
                ...runs.map(r => new TextRun({ ...r, bold: true, font: FONT_HEADING, size: fontSize })),
              ],
            }))
          } else {
            els.push(...convertNode(child, ctx))
          }
        })
      }
      break
    }

    case 'clauseTitle':
      // 由 clause 处理，此处跳过
      break

    case 'stdParagraph': {
      const runs = getInlineRuns(node)
      els.push(paraFromRuns(runs, 'BodyText'))
      break
    }

    case 'paragraph': {
      // TipTap 通用段落（用于表格单元格等）
      const runs = getInlineRuns(node)
      if (runs.length > 0) {
        els.push(new Paragraph({ children: runs }))
      } else {
        els.push(new Paragraph({ text: '' }))
      }
      break
    }

    case 'termDef': {
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'termName': {
      const text = node.textContent
      if (text.trim()) {
        els.push(new Paragraph({
          style: 'TermNameStyle',
          children: [new TextRun({ text, font: FONT_HEADING, size: SIZE_BODY, bold: true })],
        }))
      }
      break
    }

    case 'termNameEn': {
      const text = node.textContent
      if (text.trim()) {
        els.push(new Paragraph({
          style: 'TermDefStyle',
          children: [new TextRun({ text, font: { ascii: 'Times New Roman', eastAsia: 'SimSun', hAnsi: 'Times New Roman' }, size: SIZE_BODY, italics: true })],
        }))
      }
      break
    }

    case 'termDefinition': {
      const runs = getInlineRuns(node)
      if (runs.length > 0) els.push(paraFromRuns(runs, 'TermDefStyle'))
      break
    }

    case 'stdTable': {
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'tableCaption': {
      ctx.tableNo++
      const num = `表${currentChapterPrefix(ctx)}.${ctx.tableNo}`
      const runs = getInlineRuns(node)
      els.push(new Paragraph({
        style: 'TableCaptionStyle',
        children: [
          new TextRun({ text: num + '  ', font: FONT_HEADING, size: SIZE_CAPTION }),
          ...runs.map(r => new TextRun({ ...r, font: FONT_HEADING, size: SIZE_CAPTION })),
        ],
      }))
      break
    }

    case 'tableCaptionEn': {
      const runs = getInlineRuns(node)
      if (runs.length > 0) {
        els.push(new Paragraph({
          style: 'TableCaptionStyle',
          children: runs.map(r => new TextRun({ ...r, size: SIZE_CAPTION })),
        }))
      }
      break
    }

    case 'tableFootnote': {
      const runs = getInlineRuns(node)
      if (runs.length > 0) {
        els.push(new Paragraph({
          style: 'NoteStyle',
          children: [
            new TextRun({ text: '注：', font: FONT_HEADING, size: SIZE_NOTE }),
            ...runs.map(r => new TextRun({ ...r, size: SIZE_NOTE })),
          ],
        }))
      }
      break
    }

    case 'table': {
      // TipTap 原生 table
      const rows: TableRow[] = []
      node.forEach(rowNode => {
        if (rowNode.type.name !== 'tableRow') return
        const cells: TableCell[] = []
        rowNode.forEach(cellNode => {
          if (cellNode.type.name !== 'tableCell' && cellNode.type.name !== 'tableHeader') return
          const colspan = (cellNode.attrs.colspan as number) || 1
          const rowspan = (cellNode.attrs.rowspan as number) || 1
          const cellParagraphs: Paragraph[] = []
          cellNode.forEach(child => {
            const childEls = convertNode(child, ctx)
            for (const el of childEls) {
              if (el instanceof Paragraph) cellParagraphs.push(el)
            }
          })
          if (cellParagraphs.length === 0) cellParagraphs.push(new Paragraph({ text: '' }))
          cells.push(new TableCell({
            children: cellParagraphs,
            columnSpan: colspan > 1 ? colspan : undefined,
            rowSpan: rowspan > 1 ? rowspan : undefined,
            shading: cellNode.type.name === 'tableHeader' ? { fill: 'F0F0F0' } : undefined,
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
          }))
        })
        if (cells.length > 0) rows.push(new TableRow({ children: cells }))
      })
      if (rows.length > 0) {
        els.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
        }))
      }
      break
    }

    case 'figure': {
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'figureImage': {
      const src = node.attrs.src as string
      if (src && src.startsWith('data:')) {
        const match = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/)
        if (match) {
          const imgType = (match[1] === 'jpeg' ? 'jpg' : match[1]) as 'png' | 'jpg' | 'gif' | 'bmp'
          const b64 = match[2]
          const binary = atob(b64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          const w = Math.min((node.attrs.width as number) || 400, 500) // px，最大500px≈约13cm
          const h = (node.attrs.height as number) || 300
          els.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ type: imgType, data: bytes, transformation: { width: w, height: h } })],
          }))
        }
      }
      break
    }

    case 'figureCaption': {
      ctx.figNo++
      const num = `图${currentChapterPrefix(ctx)}.${ctx.figNo}`
      const runs = getInlineRuns(node)
      els.push(new Paragraph({
        style: 'FigureCaptionStyle',
        children: [
          new TextRun({ text: num + '  ', font: FONT_HEADING, size: SIZE_CAPTION }),
          ...runs.map(r => new TextRun({ ...r, font: FONT_HEADING, size: SIZE_CAPTION })),
        ],
      }))
      break
    }

    case 'figureCaptionEn': {
      const runs = getInlineRuns(node)
      if (runs.length > 0) {
        els.push(new Paragraph({
          style: 'FigureCaptionStyle',
          children: runs.map(r => new TextRun({ ...r, size: SIZE_CAPTION })),
        }))
      }
      break
    }

    case 'formula': {
      ctx.formulaNo++
      const fNum = `（${currentChapterPrefix(ctx)}.${ctx.formulaNo}）`
      let contentText = ''
      let descRuns: TextRun[] = []
      node.forEach(child => {
        if (child.type.name === 'formulaContent') contentText = child.textContent
        else if (child.type.name === 'formulaDescription') descRuns = getInlineRuns(child)
      })
      if (contentText) {
        els.push(new Paragraph({
          style: 'FormulaStyle',
          children: [
            new TextRun({ text: contentText + '  ', font: { ascii: 'Cambria Math', eastAsia: 'SimSun', hAnsi: 'Cambria Math' }, size: SIZE_BODY }),
            new TextRun({ text: fNum, font: FONT_BODY, size: SIZE_BODY }),
          ],
        }))
      }
      if (descRuns.length > 0) {
        els.push(new Paragraph({
          style: 'BodyText',
          children: [
            new TextRun({ text: '式中：', font: FONT_BODY, size: SIZE_BODY }),
            ...descRuns,
          ],
        }))
      }
      break
    }

    case 'note': {
      ctx.noteNo++
      const noteLabel = ctx.noteNo > 1 ? `注${ctx.noteNo}：` : '注：'
      const firstChild = node.firstChild
      if (firstChild) {
        const runs = getInlineRuns(firstChild)
        els.push(new Paragraph({
          style: 'NoteStyle',
          children: [
            new TextRun({ text: noteLabel, font: FONT_HEADING, size: SIZE_NOTE, bold: true }),
            ...runs.map(r => new TextRun({ ...r, size: SIZE_NOTE })),
          ],
        }))
        // 剩余子节点
        let first = true
        node.forEach(child => {
          if (first) { first = false; return }
          const runs2 = getInlineRuns(child)
          if (runs2.length > 0) {
            els.push(new Paragraph({ style: 'NoteStyle', children: runs2.map(r => new TextRun({ ...r, size: SIZE_NOTE })) }))
          }
        })
      } else {
        els.push(new Paragraph({ style: 'NoteStyle', text: noteLabel }))
      }
      break
    }

    case 'example': {
      ctx.exampleNo++
      const exLabel = ctx.exampleNo > 1 ? `示例${ctx.exampleNo}：` : '示例：'
      const firstChild = node.firstChild
      if (firstChild) {
        const runs = getInlineRuns(firstChild)
        els.push(new Paragraph({
          style: 'ExampleStyle',
          children: [
            new TextRun({ text: exLabel, font: FONT_HEADING, size: SIZE_NOTE, bold: true }),
            ...runs.map(r => new TextRun({ ...r, size: SIZE_NOTE })),
          ],
        }))
        let first = true
        node.forEach(child => {
          if (first) { first = false; return }
          const runs2 = getInlineRuns(child)
          if (runs2.length > 0) {
            els.push(new Paragraph({ style: 'ExampleStyle', children: runs2.map(r => new TextRun({ ...r, size: SIZE_NOTE })) }))
          }
        })
      } else {
        els.push(new Paragraph({ style: 'ExampleStyle', text: exLabel }))
      }
      break
    }

    case 'appendix': {
      ctx.appendixNo++
      ctx.appendixLetter = String.fromCharCode(64 + ctx.appendixNo)  // A, B, C...
      ctx.inAppendix = true
      ctx.appendixClauseNos = [0, 0, 0, 0, 0]
      ctx.figNo = 0
      ctx.tableNo = 0
      ctx.formulaNo = 0
      ctx.noteNo = 0
      ctx.exampleNo = 0
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'appendixLabel': {
      const labelText = node.textContent || ''
      els.push(new Paragraph({
        style: 'AppendixLabelStyle',
        pageBreakBefore: true,
        children: [
          new TextRun({ text: `附录${ctx.appendixLetter}`, font: FONT_HEADING, size: SIZE_BODY, bold: true }),
          new TextRun({ text: `  ${labelText}`, font: FONT_BODY, size: SIZE_BODY }),
        ],
      }))
      break
    }

    case 'appendixTitle': {
      const runs = getInlineRuns(node)
      els.push(new Paragraph({
        style: 'AppendixTitleStyle',
        children: runs.length > 0
          ? runs.map(r => new TextRun({ ...r, font: FONT_HEADING, size: SIZE_CL1, bold: true }))
          : [new TextRun({ text: '' })],
      }))
      break
    }

    case 'bibliography': {
      ctx.inAppendix = false
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }

    case 'bibliographyTitle': {
      const text = node.textContent || '参考文献'
      els.push(new Paragraph({ style: 'BibTitleStyle', text, pageBreakBefore: true }))
      break
    }

    case 'bibEntry': {
      const runs = getInlineRuns(node)
      els.push(paraFromRuns(runs, 'BibEntryStyle'))
      break
    }

    case 'stdList': {
      const listType = (node.attrs.listType as string) || 'dash'
      const level = (node.attrs.level as number) || 1
      const styleId = level <= 1 ? 'ListItem1' : 'ListItem2'
      let idx = 0
      node.forEach(child => {
        if (child.type.name !== 'stdListItem') return
        let bullet = '——'
        if (listType === 'alpha') bullet = String.fromCharCode(96 + idx + 1) + ')'
        else if (listType === 'numeric') bullet = String(idx + 1) + ')'
        else if (listType === 'roman') bullet = toRoman(idx + 1).toLowerCase() + ')'
        else if (listType === 'romanUpper') bullet = toRoman(idx + 1) + ')'
        else if (listType === 'boxedNumeric') bullet = BOXED_NUMS[idx] || String(idx + 1)
        const runs = getInlineRuns(child)
        els.push(new Paragraph({
          style: styleId,
          children: [
            new TextRun({ text: bullet + '  ', font: FONT_BODY, size: SIZE_BODY }),
            ...runs,
          ],
        }))
        idx++
      })
      break
    }

    case 'coverPage':
      // 封面由元数据生成，跳过文档节点
      break

    default: {
      // 通用处理：递归子节点
      node.forEach(child => { els.push(...convertNode(child, ctx)) })
      break
    }
  }

  return els
}

// =================== 列表辅助 ===================

const BOXED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
  let result = ''
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i] }
  }
  return result
}

// =================== 封面页 ===================

function buildCoverPage(meta: DocMeta): Paragraph[] {
  const stdType = meta.standardType ? STANDARD_TYPE_LABELS[meta.standardType] : '国家标准'
  const els: Paragraph[] = []

  // ICS 和 CCS 分类号（右对齐）
  if (meta.icsCode) {
    els.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: `ICS  ${meta.icsCode}`, font: FONT_BODY, size: SIZE_BODY })],
    }))
  }
  if (meta.ccsCode) {
    els.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: `CCS  ${meta.ccsCode}`, font: FONT_BODY, size: SIZE_BODY })],
    }))
  }

  // 标准类型
  els.push(new Paragraph({
    style: 'CoverIssuer',
    text: stdType,
    spacing: { before: meta.icsCode || meta.ccsCode ? mm2t(40) : mm2t(60), after: mm2t(5) },
  } as Parameters<typeof Paragraph>[0]))

  // 标准编号
  if (meta.stdCode) {
    els.push(new Paragraph({ style: 'CoverCode', text: meta.stdCode }))
  }

  // 中文标题
  els.push(new Paragraph({ style: 'CoverTitle', text: meta.title || '（标准名称）' }))

  // 英文标题
  if (meta.titleEn) {
    els.push(new Paragraph({ style: 'CoverTitleEn', text: meta.titleEn }))
  }

  // 发布/实施日期
  if (meta.publishDate || meta.implementDate) {
    const pubStr = meta.publishDate ? `${meta.publishDate} 发布` : ''
    const impStr = meta.implementDate ? `${meta.implementDate} 实施` : ''
    const dateText = [pubStr, impStr].filter(Boolean).join('          ')
    els.push(new Paragraph({ style: 'CoverDate', text: dateText }))
  }

  // 发布机构
  if (meta.issuer) {
    els.push(new Paragraph({ style: 'CoverIssuer', text: meta.issuer }))
  } else {
    els.push(new Paragraph({ style: 'CoverIssuer', text: '发布机构' }))
  }

  return els
}

// =================== 页眉页脚 ===================

function buildHeader(meta: DocMeta): Header {
  const code = meta.stdCode || ''
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: code, font: FONT_BODY, size: SIZE_NOTE }),
        ],
      }),
    ],
  })
}

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], font: FONT_BODY, size: SIZE_NOTE }),
        ],
      }),
    ],
  })
}

// =================== 主导出函数 ===================

export async function exportDocx(doc: PMNode, meta: DocMeta = {}): Promise<Blob> {
  const ctx = createCtx()

  // 封面元素
  const coverEls = buildCoverPage(meta)

  // 正文元素（跳过 coverPage 节点，在正文首章前插入标准名称）
  const mainEls: DocxEl[] = []
  let stdTitleAdded = false
  doc.forEach(child => {
    if (child.type.name === 'coverPage') return
    if (!stdTitleAdded && child.type.name === 'chapter') {
      if (meta.title) {
        mainEls.push(new Paragraph({
          style: 'BodyTitle',
          text: meta.title,
        }))
      }
      stdTitleAdded = true
    }
    mainEls.push(...convertNode(child, ctx))
  })

  // 如果没有内容，加一个空段落防止报错
  if (mainEls.length === 0) {
    mainEls.push(new Paragraph({ text: '' }))
  }

  const document = new Document({
    title: meta.title || '',
    subject: meta.stdCode || '',
    creator: meta.issuer || '',
    styles: buildStyles() as Parameters<typeof Document>[0]['styles'],
    sections: [
      // 封面页（无页眉页脚）
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN_TOP, right: MARGIN_RIGHT, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT },
          },
        },
        headers: { default: new Header({ children: [new Paragraph({ text: '' })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ text: '' })] }) },
        children: coverEls,
      },
      // 正文（有页眉页脚，页码从1开始）
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: {
              top: MARGIN_TOP,
              right: MARGIN_RIGHT,
              bottom: MARGIN_BOTTOM,
              left: MARGIN_LEFT,
              header: MARGIN_HEADER,
              footer: MARGIN_FOOTER,
            },
            pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
          },
        },
        headers: { default: buildHeader(meta) },
        footers: { default: buildFooter() },
        children: mainEls,
      },
    ],
  })

  return Packer.toBlob(document)
}
