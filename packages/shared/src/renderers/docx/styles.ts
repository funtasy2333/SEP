/**
 * DOCX 样式表（docs/wp7-docx-delivery.md §3，格式的唯一数据源）。
 *
 * `buildStylesXml()` 输出 §3.2 与 §6 的全部样式。约定（§3.1）：
 * - 样式 ID 用 ASCII（Ses*），中文名 SES_*；全部 w:customStyle="1"、w:qFormat；
 * - 除 SesNormal 外全部 basedOn SesNormal；SesNormal 是默认段落样式；
 * - 带编号段落的缩进只写在编号级别（numbering.ts），标「缩进见 Ax」的样式本身不写 ind；
 * - 格式只写样式里显式给出的属性，未提及的属性一律不写、走继承（对齐 SesNormal 的默认值）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import { ABSTRACT_NUM_ID } from './numbering'
import { CHAR_WIDTH_TWIPS as CH } from './units'
import { docDefaults, escapeXmlAttr, numPr, pPr, rPr, style, styles as stylesEl, wrapElement, type XmlAttrs, type XmlChild } from './xml'

// ---------------- 字体、字号 ----------------

const SONG_RFONTS = '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
const SONG_ALL_RFONTS = '<w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体" w:cs="宋体"/>'
const HEI_RFONTS = '<w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体" w:cs="黑体"/>'

function szChildren(halfPoint: number): XmlChild[] {
  return [
    ['sz', `<w:sz w:val="${halfPoint}"/>`],
    ['szCs', `<w:szCs w:val="${halfPoint}"/>`],
  ]
}

// ---------------- 常用 spacing / ind / tabs 片段（§3.1、§3.2 字面值） ----------------

const SPACING_ONE_LINE = '<w:spacing w:beforeLines="100" w:before="312" w:afterLines="100" w:after="312"/>'
const SPACING_HALF_LINE = '<w:spacing w:beforeLines="50" w:before="156" w:afterLines="50" w:after="156"/>'
const SPACING_QUARTER_LINE = '<w:spacing w:beforeLines="25" w:before="78" w:afterLines="25" w:after="78"/>'
/** 三号标题：段前 500 段后 600、固定 20 磅行距（配合 snapToGridOff） */
const SPACING_TITLE_20PT = '<w:spacing w:before="500" w:after="600" w:line="400" w:lineRule="exact"/>'
/** SesAppendix、SesBibTitle 起始值，按 §10 实测调整（§3.2 表注） */
const SPACING_APPENDIX_TITLE = '<w:spacing w:before="520" w:after="150"/>'
const SPACING_APPENDIX_FIRST = '<w:spacing w:before="520" w:after="0"/>'
const SPACING_APPENDIX_LAST = '<w:spacing w:before="0" w:after="150"/>'
const SPACING_ZERO = '<w:spacing w:before="0" w:after="0"/>'

const IND_ZERO = '<w:ind w:left="0" w:firstLine="0"/>'
const IND_FIRSTLINE_2CH = `<w:ind w:left="0" w:firstLine="${2 * CH}"/>`
const IND_TABLETEXT = `<w:ind w:left="0" w:firstLine="${CH}"/>`
const IND_LIST_CONT_L1 = '<w:ind w:left="840" w:firstLine="0"/>'
const IND_LIST_CONT_L2 = '<w:ind w:left="1260" w:firstLine="0"/>'
const IND_NOTE_CONT = '<w:ind w:left="780" w:firstLine="0"/>'
const IND_NOTEN_CONT = '<w:ind w:left="870" w:firstLine="0"/>'
/** 终结线左右缩进（§3.2：经 Word 边框延伸量校准） */
// Word 16.113 会把段落底边框在两端各延伸约 0.5 mm；3532 的实测线宽约 41.3 mm，
// 对应 165 mm 版心的 1/4（§5.13）。
const IND_END_MARK = '<w:ind w:left="3532" w:right="3532"/>'
/** 横排 252 mm 版心的 1/4 终结线，扣除 Word 边框两端各约 0.5 mm 的延伸。 */
const IND_END_MARK_LANDSCAPE = '<w:ind w:left="5415" w:right="5415"/>'
const IND_TOC2 = '<w:ind w:left="210" w:firstLine="0"/>'
const IND_TOC3 = '<w:ind w:left="420" w:firstLine="0"/>'
const SPACING_COVER_TITLE = '<w:spacing w:before="0" w:after="0" w:line="732" w:lineRule="exact"/>'
const SPACING_COVER_ENGLISH = '<w:spacing w:before="378" w:after="0" w:line="400" w:lineRule="exact"/>'
const SPACING_COVER_CONSISTENCY = '<w:spacing w:before="639" w:after="0" w:line="400" w:lineRule="exact"/>'
const TABS_COVER_DATES = '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>'
const PBDR_COVER_RULE = wrapElement('w:pBdr', '<w:bottom w:val="single" w:sz="4" w:space="1" w:color="000000"/>')
const COVER_DESIGNATION_FIT_WIDTH = 9780 // Word 墨迹宽170mm的长称谓校准值

/** 版心宽 9355、中线 4677（§2.1 字面值，不用除法重新计算避免舍入到 4678） */
const BODY_WIDTH = 9355
const BODY_CENTER = 4677
const TABS_TOC = `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${BODY_WIDTH}"/></w:tabs>`
const TABS_FORMULA = `<w:tabs><w:tab w:val="center" w:pos="${BODY_CENTER}"/><w:tab w:val="right" w:leader="dot" w:pos="${BODY_WIDTH}"/></w:tabs>`

// 原终结线素材在 72 dpi 下为 1 像素实线，约等于 1 磅；边框保留可编辑性并避免低分辨率图片的白边。
const PBDR_END_MARK = wrapElement('w:pBdr', '<w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/>')

function numPrXml(numId: number, ilvl: number): string {
  return numPr([
    ['ilvl', `<w:ilvl w:val="${ilvl}"/>`],
    ['numId', `<w:numId w:val="${numId}"/>`],
  ])
}

// ---------------- 样式描述 ----------------

interface StyleSpec {
  id: string
  name: string
  /** 省略 = 'SesNormal'；SesNormal 自身传 null（不写 basedOn） */
  basedOn?: string | null
  isDefault?: boolean
  next?: string
  outlineLvl?: number
  rFonts?: 'song' | 'songAll' | 'hei'
  sz?: number
  jc?: 'left' | 'center' | 'right' | 'both' | 'distribute'
  bold?: boolean
  characterScale?: number
  fitText?: number
  keepNext?: boolean
  keepLines?: boolean
  widowControl?: boolean
  autoSpaceDEDN?: boolean
  snapToGridOff?: boolean
  spacing?: string
  ind?: string
  numPr?: { numId: number; ilvl: number }
  tabs?: string
  pBdr?: string
}

function buildStyleXml(spec: StyleSpec): string {
  const pprChildren: XmlChild[] = []
  if (spec.keepNext) pprChildren.push(['keepNext', '<w:keepNext/>'])
  if (spec.keepLines) pprChildren.push(['keepLines', '<w:keepLines/>'])
  if (spec.widowControl) pprChildren.push(['widowControl', '<w:widowControl/>'])
  if (spec.numPr) pprChildren.push(['numPr', numPrXml(spec.numPr.numId, spec.numPr.ilvl)])
  if (spec.pBdr) pprChildren.push(['pBdr', spec.pBdr])
  if (spec.tabs) pprChildren.push(['tabs', spec.tabs])
  if (spec.autoSpaceDEDN) {
    pprChildren.push(['autoSpaceDE', '<w:autoSpaceDE/>'])
    pprChildren.push(['autoSpaceDN', '<w:autoSpaceDN/>'])
  }
  if (spec.snapToGridOff) pprChildren.push(['snapToGrid', '<w:snapToGrid w:val="0"/>'])
  if (spec.spacing) pprChildren.push(['spacing', spec.spacing])
  if (spec.ind) pprChildren.push(['ind', spec.ind])
  if (spec.jc) pprChildren.push(['jc', `<w:jc w:val="${spec.jc}"/>`])
  if (spec.outlineLvl !== undefined) pprChildren.push(['outlineLvl', `<w:outlineLvl w:val="${spec.outlineLvl}"/>`])

  const rprChildren: XmlChild[] = []
  if (spec.rFonts === 'song') rprChildren.push(['rFonts', SONG_RFONTS])
  else if (spec.rFonts === 'songAll') rprChildren.push(['rFonts', SONG_ALL_RFONTS])
  else if (spec.rFonts === 'hei') rprChildren.push(['rFonts', HEI_RFONTS])
  if (spec.bold) {
    rprChildren.push(['b', '<w:b/>'])
    rprChildren.push(['bCs', '<w:bCs/>'])
  }
  if (spec.sz !== undefined) rprChildren.push(...szChildren(spec.sz))
  if (spec.characterScale !== undefined) rprChildren.push(['w', `<w:w w:val="${spec.characterScale}"/>`])
  if (spec.fitText !== undefined) rprChildren.push(['fitText', `<w:fitText w:val="${spec.fitText}"/>`])

  const styleChildren: XmlChild[] = [['name', `<w:name w:val="${escapeXmlAttr(spec.name)}"/>`]]
  if (spec.basedOn !== null) styleChildren.push(['basedOn', `<w:basedOn w:val="${spec.basedOn ?? 'SesNormal'}"/>`])
  if (spec.next) styleChildren.push(['next', `<w:next w:val="${spec.next}"/>`])
  styleChildren.push(['qFormat', '<w:qFormat/>'])
  if (pprChildren.length > 0) styleChildren.push(['pPr', pPr(pprChildren)])
  if (rprChildren.length > 0) styleChildren.push(['rPr', rPr(rprChildren)])

  const attrs: XmlAttrs = { 'w:type': 'paragraph', 'w:customStyle': '1', 'w:styleId': spec.id }
  if (spec.isDefault) attrs['w:default'] = '1'
  return style(styleChildren, attrs)
}

// ---------------- §3.2 样式清单 ----------------

/** 标题类样式（§3.1）：keepNext 属于各自行单独给出，这里只处理 next=SesPara */
const TITLE_NEXT_PARA = 'SesPara'

/** 条级样式中文名用汉字数字（SES_一级条标题…SES_五级条标题），不是阿拉伯数字（§3.2、#34 审查） */
const CN_LEVEL = ['一', '二', '三', '四', '五']

function clauseFamily(): StyleSpec[] {
  const out: StyleSpec[] = []
  for (let level = 1; level <= 5; level++) {
    const cn = CN_LEVEL[level - 1]
    out.push({
      id: `SesClause${level}`,
      name: `SES_${cn}级条标题`,
      rFonts: 'hei',
      keepNext: true,
      spacing: SPACING_HALF_LINE,
      outlineLvl: level,
      next: TITLE_NEXT_PARA,
      numPr: { numId: ABSTRACT_NUM_ID.chapter, ilvl: level },
    })
    out.push({ id: `SesNoTitle${level}`, name: `SES_${cn}级无标题条`, rFonts: 'songAll' })
    out.push({
      id: `SesAppClause${level}`,
      name: `SES_附录${cn}级条标题`,
      rFonts: 'hei',
      keepNext: true,
      spacing: SPACING_HALF_LINE,
      outlineLvl: level,
      next: TITLE_NEXT_PARA,
      numPr: { numId: ABSTRACT_NUM_ID.appendixClause, ilvl: level },
    })
    out.push({ id: `SesAppNoTitle${level}`, name: `SES_附录${cn}级无标题条`, rFonts: 'songAll' })
  }
  return out
}

const STYLE_SPECS: readonly StyleSpec[] = [
  {
    id: 'SesNormal',
    name: 'SES_正文基础',
    basedOn: null,
    isDefault: true,
    rFonts: 'song',
    sz: 21,
    jc: 'both',
    widowControl: true,
    autoSpaceDEDN: true,
  },
  { id: 'SesPara', name: 'SES_段', rFonts: 'songAll', ind: IND_FIRSTLINE_2CH },
  {
    id: 'SesTocTitle',
    name: 'SES_目次标题',
    rFonts: 'hei',
    sz: 32,
    jc: 'center',
    snapToGridOff: true,
    spacing: SPACING_TITLE_20PT,
  },
  {
    id: 'SesFrontTitle',
    name: 'SES_前言引言标题',
    rFonts: 'hei',
    sz: 32,
    jc: 'center',
    snapToGridOff: true,
    spacing: SPACING_TITLE_20PT,
    outlineLvl: 0,
    next: TITLE_NEXT_PARA,
  },
  {
    id: 'SesBodyTitle',
    name: 'SES_正文首页名称',
    rFonts: 'hei',
    sz: 32,
    jc: 'center',
    snapToGridOff: true,
    spacing: SPACING_TITLE_20PT,
  },
  {
    id: 'SesChapter',
    name: 'SES_章标题',
    rFonts: 'hei',
    keepNext: true,
    spacing: SPACING_ONE_LINE,
    outlineLvl: 0,
    next: TITLE_NEXT_PARA,
    numPr: { numId: ABSTRACT_NUM_ID.chapter, ilvl: 0 },
  },
  ...clauseFamily(),
  { id: 'SesTermNum', name: 'SES_术语条目编号', rFonts: 'hei', keepNext: true, spacing: SPACING_ZERO },
  { id: 'SesTermHead', name: 'SES_术语', rFonts: 'hei', keepNext: true, ind: IND_FIRSTLINE_2CH },
  { id: 'SesTermSource', name: 'SES_术语来源', rFonts: 'songAll', ind: IND_FIRSTLINE_2CH },
  {
    id: 'SesAppendix',
    name: 'SES_附录标识',
    rFonts: 'hei',
    keepNext: true,
    jc: 'center',
    spacing: SPACING_APPENDIX_FIRST,
    outlineLvl: 0,
    next: TITLE_NEXT_PARA,
    numPr: { numId: ABSTRACT_NUM_ID.appendixClause, ilvl: 0 },
  },
  { id: 'SesAppendixKind', name: 'SES_附录性质', rFonts: 'hei', keepNext: true, jc: 'center', spacing: SPACING_ZERO },
  { id: 'SesAppendixTitle', name: 'SES_附录标题', rFonts: 'hei', keepNext: true, jc: 'center', spacing: SPACING_APPENDIX_LAST, next: TITLE_NEXT_PARA },
  { id: 'SesListDash', name: 'SES_破折号列项', numPr: { numId: ABSTRACT_NUM_ID.listDash, ilvl: 0 } },
  { id: 'SesListDot', name: 'SES_间隔号列项', numPr: { numId: ABSTRACT_NUM_ID.listDash, ilvl: 1 } },
  { id: 'SesListItem', name: 'SES_编号列项' },
  { id: 'SesListCont', name: 'SES_列项续段', ind: IND_LIST_CONT_L1 },
  { id: 'SesListCont2', name: 'SES_列项续段2', ind: IND_LIST_CONT_L2 },
  { id: 'SesNote', name: 'SES_注', sz: 18, numPr: { numId: ABSTRACT_NUM_ID.note, ilvl: 0 } },
  { id: 'SesNoteN', name: 'SES_注X', sz: 18 },
  { id: 'SesNoteCont', name: 'SES_注续段', sz: 18, ind: IND_NOTE_CONT },
  { id: 'SesNoteNCont', name: 'SES_注X续段', sz: 18, ind: IND_NOTEN_CONT },
  { id: 'SesExLabel', name: 'SES_示例标识', sz: 18, keepNext: true, numPr: { numId: ABSTRACT_NUM_ID.example, ilvl: 0 } },
  { id: 'SesExLabelN', name: 'SES_示例X标识', sz: 18, keepNext: true },
  { id: 'SesExText', name: 'SES_示例内容', sz: 18, ind: IND_FIRSTLINE_2CH },
  { id: 'SesFigure', name: 'SES_图', jc: 'center', keepNext: true, ind: IND_ZERO },
  { id: 'SesFigCap', name: 'SES_图题', rFonts: 'hei', jc: 'center', spacing: SPACING_HALF_LINE, numPr: { numId: ABSTRACT_NUM_ID.figure, ilvl: 0 } },
  { id: 'SesAppFigCap', name: 'SES_附录图题', rFonts: 'hei', jc: 'center', spacing: SPACING_HALF_LINE },
  {
    id: 'SesTblCap',
    name: 'SES_表题',
    rFonts: 'hei',
    jc: 'center',
    keepNext: true,
    spacing: SPACING_HALF_LINE,
    numPr: { numId: ABSTRACT_NUM_ID.table, ilvl: 0 },
  },
  { id: 'SesAppTblCap', name: 'SES_附录表题', rFonts: 'hei', jc: 'center', keepNext: true, spacing: SPACING_HALF_LINE },
  { id: 'SesTblCapCont', name: 'SES_续表题', rFonts: 'hei', jc: 'center', keepNext: true, spacing: SPACING_HALF_LINE },
  { id: 'SesAppTblCapCont', name: 'SES_附录续表题', rFonts: 'hei', jc: 'center', keepNext: true, spacing: SPACING_HALF_LINE },
  { id: 'SesTableText', name: 'SES_表格文字', sz: 18, ind: IND_TABLETEXT },
  { id: 'SesTableCenter', name: 'SES_表格居中', sz: 18, jc: 'center', ind: IND_ZERO },
  { id: 'SesTableNote', name: 'SES_表注', sz: 18 },
  { id: 'SesFormula', name: 'SES_公式', tabs: TABS_FORMULA, spacing: SPACING_HALF_LINE, ind: IND_ZERO },
  { id: 'SesWhereLabel', name: 'SES_式中', ind: IND_FIRSTLINE_2CH },
  { id: 'SesWhereItem', name: 'SES_式中条目' },
  {
    id: 'SesBibTitle',
    name: 'SES_参考文献标题',
    rFonts: 'hei',
    keepNext: true,
    jc: 'center',
    spacing: SPACING_APPENDIX_TITLE,
    outlineLvl: 0,
    next: TITLE_NEXT_PARA,
  },
  { id: 'SesBibEntry', name: 'SES_参考文献条目', numPr: { numId: ABSTRACT_NUM_ID.bibEntry, ilvl: 0 } },
  {
    id: 'SesEndMark',
    name: 'SES_终结线',
    sz: 8, // 4 磅（字面量，非六个标准中文字号之一）
    keepLines: true,
    ind: IND_END_MARK,
    pBdr: PBDR_END_MARK,
  },
  {
    id: 'SesEndMarkLandscape',
    name: 'SES_横排终结线',
    sz: 8,
    keepLines: true,
    ind: IND_END_MARK_LANDSCAPE,
    pBdr: PBDR_END_MARK,
  },
  { id: 'SesHeader', name: 'SES_书眉', rFonts: 'hei' },
  { id: 'SesFooter', name: 'SES_页码', sz: 18 },
  { id: 'TOC1', name: 'toc 1', rFonts: 'songAll', tabs: TABS_TOC, spacing: SPACING_QUARTER_LINE },
  { id: 'TOC2', name: 'toc 2', rFonts: 'songAll', tabs: TABS_TOC, ind: IND_TOC2 },
  { id: 'TOC3', name: 'toc 3', rFonts: 'songAll', tabs: TABS_TOC, ind: IND_TOC3 },
  { id: 'SesCoverIcs', name: 'SES_封面分类号', rFonts: 'hei', sz: 21, jc: 'left' },
  { id: 'SesCoverLogo', name: 'SES_封面标志', jc: 'center' },
  { id: 'SesCoverLogoText', name: 'SES_封面行业标志代号', rFonts: 'song', sz: 96, bold: true, characterScale: 130, jc: 'right' },
  { id: 'SesCoverGroupLogo', name: 'SES_封面团体标志及代号', rFonts: 'song', sz: 96, bold: true, characterScale: 130, jc: 'right' },
  { id: 'SesCoverEnterpriseLogo', name: 'SES_封面企业标志及代号', rFonts: 'song', sz: 96, bold: true, characterScale: 130, jc: 'right' },
  { id: 'SesCoverDbRegion', name: 'SES_封面地方标志及代号', rFonts: 'song', sz: 96, bold: true, characterScale: 130, jc: 'right' },
  { id: 'SesCoverDesignationGb', name: 'SES_封面国家标准称谓', rFonts: 'song', sz: 52, bold: true, jc: 'distribute' },
  { id: 'SesCoverDesignationGuide', name: 'SES_封面指导性技术文件称谓', rFonts: 'song', sz: 52, bold: true, fitText: COVER_DESIGNATION_FIT_WIDTH, jc: 'distribute' },
  { id: 'SesCoverDesignationOther', name: 'SES_封面其他标准称谓', rFonts: 'hei', sz: 48, jc: 'distribute' },
  { id: 'SesCoverStdNo', name: 'SES_封面文件编号', rFonts: 'hei', sz: 28, jc: 'right' },
  { id: 'SesCoverReplaces', name: 'SES_封面代替文件编号', rFonts: 'hei', sz: 21, jc: 'right' },
  { id: 'SesCoverRule', name: 'SES_封面横线', pBdr: PBDR_COVER_RULE },
  { id: 'SesCoverName', name: 'SES_封面文件名称', rFonts: 'hei', sz: 52, jc: 'center', snapToGridOff: true, spacing: SPACING_COVER_TITLE },
  { id: 'SesCoverEnglish', name: 'SES_封面英文译名', rFonts: 'hei', sz: 28, jc: 'center', snapToGridOff: true, spacing: SPACING_COVER_ENGLISH },
  { id: 'SesCoverConsistency', name: 'SES_封面一致性程度', rFonts: 'hei', sz: 28, jc: 'center', snapToGridOff: true, spacing: SPACING_COVER_CONSISTENCY },
  { id: 'SesCoverStage', name: 'SES_封面阶段标识', rFonts: 'hei', sz: 28, jc: 'center' },
  { id: 'SesCoverPatent', name: 'SES_封面专利说明', rFonts: 'song', sz: 21, jc: 'center' },
  { id: 'SesCoverDates', name: 'SES_封面日期', rFonts: 'hei', sz: 28, jc: 'left', snapToGridOff: true, spacing: '<w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/>', tabs: TABS_COVER_DATES, pBdr: PBDR_COVER_RULE },
  { id: 'SesCoverIssuer', name: 'SES_封面发布机构', rFonts: 'hei', sz: 28, jc: 'center' },
]

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

/** docDefaults：rPrDefault 为宋体类 rFonts + lang，pPrDefault 为空 pPr（§3.1，同 gen_spike.py） */
function buildDocDefaultsXml(): string {
  const rPrDefaultInner = rPr([
    ['rFonts', SONG_RFONTS],
    ['lang', '<w:lang w:val="en-US" w:eastAsia="zh-CN"/>'],
  ])
  const children: XmlChild[] = [
    ['rPrDefault', wrapElement('w:rPrDefault', rPrDefaultInner)],
    ['pPrDefault', wrapElement('w:pPrDefault', pPr([]))],
  ]
  return docDefaults(children)
}

/** 生成完整的 word/styles.xml（含 XML 声明），§3.2 与 §6 全部样式 */
export function buildStylesXml(): string {
  const children: XmlChild[] = [
    ['docDefaults', buildDocDefaultsXml()],
    ...STYLE_SPECS.map((spec): XmlChild => ['style', buildStyleXml(spec)]),
  ]
  const el = stylesEl(children, { 'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' })
  return XML_DECL + el
}

/** 供渲染器与测试查询样式清单（不含 docDefaults），如需校验「样式是否为属主样式」等 */
export function styleSpecs(): readonly StyleSpec[] {
  return STYLE_SPECS
}

/**
 * 带样式级 numPr 的「属主样式」ID 集合（§4.1：一个编号级别只能绑定一个属主样式）。
 * render.ts 的 emitParagraph() 据此判断「样式本身即为编号段落」，即使调用方没有额外传
 * 段落级 numPr，也必须传 nodeId/kind 记入 §4.7 的追踪（漏传即抛错）。
 */
export const OWNER_STYLE_IDS: ReadonlySet<string> = new Set(
  STYLE_SPECS.filter((spec) => spec.numPr !== undefined).map((spec) => spec.id),
)

/** §6.1 非国标发布机构与「发　布」均为四号黑体常规字。
 * 「发　布」字符缩放87%经Word墨迹校准；间隔run不缩放，保持约5mm。
 */
export function buildCoverReleaseRunPr(compress: boolean): string {
  const children: XmlChild[] = [
    ['rFonts', HEI_RFONTS],
    ...szChildren(28),
  ]
  if (compress) children.push(['w', '<w:w w:val="87"/>'])
  return rPr(children)
}
