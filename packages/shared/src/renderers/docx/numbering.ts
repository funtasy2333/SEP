/**
 * DOCX 编号方案（docs/wp7-docx-delivery.md §4）。
 *
 * `ABSTRACT_NUM_ID` 是 A1–A16 的 abstractNumId 表（§4.2 的表序号）；16 个 abstractNum 定义与
 * 8 个固定实例（numId = abstractNumId，§4.2）总是全部输出。`createNumberingAllocator()`
 * 按§4.3 的分配规则给按需实例（注/示例分组、附录图表、编号列表）发放 numId（从 101 起递增），
 * 渲染结束后 `buildNumberingXml()` 汇总成完整的 `word/numbering.xml`。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API；不用 class 的参数属性（shared 的
 * erasableSyntaxOnly 约束），改用工厂函数 + 闭包（同 package.ts 的 createRelationshipIdAllocator）。
 */

import { abstractNum, escapeXmlAttr, joinOrderedChildren, lvl, num, numbering, pPr, rPr, wrapElement, type XmlChild } from './xml'

const SP = '　' // 全角空格（标识后「空一个汉字」，§4.2）

/** A1–A16 的 abstractNumId（§4.2 表序号即 abstractNumId） */
export const ABSTRACT_NUM_ID = {
  chapter: 1, // A1 章条
  appendixClause: 2, // A2 附录
  figure: 3, // A3 正文图
  table: 4, // A4 正文表
  appendixFigure: 5, // A5 附录图
  appendixTable: 6, // A6 附录表
  note: 7, // A7 注（单条）
  noteGroup: 8, // A8 注 X（多条，按组分配实例）
  example: 9, // A9 示例（单个）
  exampleGroup: 10, // A10 示例 X（多个，按组分配实例）
  listDash: 11, // A11 破折号/间隔号列项
  listAlpha: 12, // A12 字母列项
  listNumber: 13, // A13 数字列项
  listRoman: 14, // A14 罗马列项
  listRomanUpper: 15, // A15 大写罗马列项
  bibEntry: 16, // A16 参考文献
} as const

/** 8 个固定实例：每个文档一个，numId = abstractNumId（§4.2），属主样式引用它们 */
const FIXED_ABSTRACT_NUM_IDS: readonly number[] = [
  ABSTRACT_NUM_ID.chapter,
  ABSTRACT_NUM_ID.appendixClause,
  ABSTRACT_NUM_ID.figure,
  ABSTRACT_NUM_ID.table,
  ABSTRACT_NUM_ID.note,
  ABSTRACT_NUM_ID.example,
  ABSTRACT_NUM_ID.listDash,
  ABSTRACT_NUM_ID.bibEntry,
]

/** 列表类型 → 按需实例所属的 abstractNumId（§4.4 级别选择表；boxed 退化为 number 并记 list-format-fallback，由调用方记警告） */
const LIST_TYPE_ABSTRACT_NUM = new Map<string, number>([
  ['alpha', ABSTRACT_NUM_ID.listAlpha],
  ['number', ABSTRACT_NUM_ID.listNumber],
  ['roman', ABSTRACT_NUM_ID.listRoman],
  ['romanUpper', ABSTRACT_NUM_ID.listRomanUpper],
  ['boxed', ABSTRACT_NUM_ID.listNumber],
])

/** 列表类型（§4.4 表）→ 按需实例的 abstractNumId；'dash' 不经过此表（用属主样式 A11，不分配实例） */
export function listAbstractNumId(listType: string): number {
  const id = LIST_TYPE_ABSTRACT_NUM.get(listType)
  if (id === undefined) throw new Error(`numbering: 列表类型 "${listType}" 没有对应的按需实例 abstractNum（dash 不经过这里）`)
  return id
}

// ---------------- 级别定义（§4.2） ----------------

const HEI_RFONTS = '<w:rFonts w:ascii="黑体" w:eastAsia="黑体" w:hAnsi="黑体" w:cs="黑体"/>'
const RPR_HEI = rPr([['rFonts', HEI_RFONTS]])
/** A2 L0「附录%1」专用：黑体 + 字符间距 210（§3.3 标题字距偏差登记） */
const RPR_HEI_SPACING = rPr([
  ['rFonts', HEI_RFONTS],
  ['spacing', '<w:spacing w:val="210"/>'],
])

const IND_DEFAULT = '<w:ind w:left="0" w:firstLine="0"/>'
const IND_A7 = '<w:ind w:left="780" w:hanging="360"/>'
const IND_A8 = '<w:ind w:left="870" w:hanging="450"/>'
const IND_FIRSTLINE_420 = '<w:ind w:left="0" w:firstLine="420"/>'
const IND_LIST_L0 = '<w:ind w:left="840" w:hanging="420"/>'
const IND_LIST_L1 = '<w:ind w:left="1260" w:hanging="420"/>'

interface LevelSpec {
  ilvl: number
  numFmt: string
  lvlText: string
  suff?: 'tab' | 'nothing'
  ind: string
  rPr?: string
}

interface AbstractNumSpec {
  id: number
  multilevel: boolean
  levels: LevelSpec[]
}

/** A1/A2 的 L1..L5：lvlText 形如 "%1.%2　"（depth+1 个 %n 用 "." 连接，末尾全角空格） */
function chapterLikeLvlText(depth: number): string {
  const parts: string[] = []
  for (let k = 1; k <= depth + 1; k++) parts.push(`%${k}`)
  return parts.join('.') + SP
}

function chapterLikeLevels(): LevelSpec[] {
  const levels: LevelSpec[] = [{ ilvl: 0, numFmt: 'decimal', lvlText: `%1${SP}`, ind: IND_DEFAULT, rPr: RPR_HEI }]
  for (let depth = 1; depth <= 5; depth++) {
    levels.push({ ilvl: depth, numFmt: 'decimal', lvlText: chapterLikeLvlText(depth), ind: IND_DEFAULT, rPr: RPR_HEI })
  }
  return levels
}

function appendixLevels(): LevelSpec[] {
  const levels: LevelSpec[] = [
    { ilvl: 0, numFmt: 'upperLetter', lvlText: `附录%1`, ind: IND_DEFAULT, rPr: RPR_HEI_SPACING },
  ]
  for (let depth = 1; depth <= 5; depth++) {
    levels.push({ ilvl: depth, numFmt: 'decimal', lvlText: chapterLikeLvlText(depth), ind: IND_DEFAULT, rPr: RPR_HEI })
  }
  return levels
}

/** A12–A15：两级列项，suff=tab，缩进相同，仅 numFmt 不同（§4.2） */
function listLevels(l0Fmt: string, l0Text: string, l1Fmt: string, l1Text: string): LevelSpec[] {
  return [
    { ilvl: 0, numFmt: l0Fmt, lvlText: l0Text, suff: 'tab', ind: IND_LIST_L0 },
    { ilvl: 1, numFmt: l1Fmt, lvlText: l1Text, suff: 'tab', ind: IND_LIST_L1 },
  ]
}

const ABSTRACT_NUM_DEFS: readonly AbstractNumSpec[] = [
  { id: ABSTRACT_NUM_ID.chapter, multilevel: true, levels: chapterLikeLevels() },
  { id: ABSTRACT_NUM_ID.appendixClause, multilevel: true, levels: appendixLevels() },
  { id: ABSTRACT_NUM_ID.figure, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: `图%1${SP}`, ind: IND_DEFAULT }] },
  { id: ABSTRACT_NUM_ID.table, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: `表%1${SP}`, ind: IND_DEFAULT }] },
  // A5/A6：占位定义（实例覆盖整个 L0，§4.2），abstractNum 本身的 lvlText 不会被实际使用
  { id: ABSTRACT_NUM_ID.appendixFigure, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: `图%1${SP}`, ind: IND_DEFAULT }] },
  { id: ABSTRACT_NUM_ID.appendixTable, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: `表%1${SP}`, ind: IND_DEFAULT }] },
  { id: ABSTRACT_NUM_ID.note, multilevel: false, levels: [{ ilvl: 0, numFmt: 'none', lvlText: '注：', ind: IND_A7, rPr: RPR_HEI }] },
  { id: ABSTRACT_NUM_ID.noteGroup, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '注%1：', ind: IND_A8, rPr: RPR_HEI }] },
  { id: ABSTRACT_NUM_ID.example, multilevel: false, levels: [{ ilvl: 0, numFmt: 'none', lvlText: '示例：', ind: IND_FIRSTLINE_420, rPr: RPR_HEI }] },
  { id: ABSTRACT_NUM_ID.exampleGroup, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: '示例%1：', ind: IND_FIRSTLINE_420, rPr: RPR_HEI }] },
  {
    id: ABSTRACT_NUM_ID.listDash,
    multilevel: true,
    levels: [
      { ilvl: 0, numFmt: 'bullet', lvlText: '——', suff: 'nothing', ind: IND_LIST_L0 },
      { ilvl: 1, numFmt: 'bullet', lvlText: '·', suff: 'tab', ind: IND_LIST_L1 },
    ],
  },
  { id: ABSTRACT_NUM_ID.listAlpha, multilevel: true, levels: listLevels('lowerLetter', '%1)', 'decimal', '%2)') },
  { id: ABSTRACT_NUM_ID.listNumber, multilevel: true, levels: listLevels('decimal', '%1)', 'lowerLetter', '%2)') },
  { id: ABSTRACT_NUM_ID.listRoman, multilevel: true, levels: listLevels('lowerRoman', '%1)', 'decimal', '%2)') },
  { id: ABSTRACT_NUM_ID.listRomanUpper, multilevel: true, levels: listLevels('upperRoman', '%1)', 'decimal', '%2)') },
  { id: ABSTRACT_NUM_ID.bibEntry, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: `[%1]${SP}`, ind: IND_FIRSTLINE_420 }] },
]

function levelXml(spec: LevelSpec): string {
  const children: XmlChild[] = [
    ['start', '<w:start w:val="1"/>'],
    ['numFmt', `<w:numFmt w:val="${spec.numFmt}"/>`],
    ['suff', `<w:suff w:val="${spec.suff ?? 'nothing'}"/>`],
    ['lvlText', `<w:lvlText w:val="${escapeXmlAttr(spec.lvlText)}"/>`],
    ['lvlJc', '<w:lvlJc w:val="left"/>'],
    ['pPr', pPr([['ind', spec.ind]])],
  ]
  if (spec.rPr) children.push(['rPr', spec.rPr])
  return lvl(children, { 'w:ilvl': spec.ilvl })
}

function abstractNumXml(spec: AbstractNumSpec): string {
  const children: XmlChild[] = [
    ['multiLevelType', `<w:multiLevelType w:val="${spec.multilevel ? 'multilevel' : 'singleLevel'}"/>`],
    ...spec.levels.map((l): XmlChild => ['lvl', levelXml(l)]),
  ]
  return abstractNum(children, { 'w:abstractNumId': spec.id })
}

// ---------------- lvlOverride / num ----------------

function lvlOverrideXml(ilvl: number, startOverride?: number, fullLvlXml?: string): string {
  const children: XmlChild[] = []
  if (startOverride !== undefined) children.push(['startOverride', `<w:startOverride w:val="${startOverride}"/>`])
  if (fullLvlXml !== undefined) children.push(['lvl', fullLvlXml])
  return wrapElement('w:lvlOverride', joinOrderedChildren('lvlOverride', children), { 'w:ilvl': ilvl })
}

function fixedNumXml(abstractNumId: number): string {
  return num([['abstractNumId', `<w:abstractNumId w:val="${abstractNumId}"/>`]], { 'w:numId': abstractNumId })
}

function overrideOnlyNumXml(numId: number, abstractNumId: number, overrides: readonly { ilvl: number; start: number }[]): string {
  const children: XmlChild[] = [['abstractNumId', `<w:abstractNumId w:val="${abstractNumId}"/>`]]
  for (const ov of overrides) children.push(['lvlOverride', lvlOverrideXml(ov.ilvl, ov.start)])
  return num(children, { 'w:numId': numId })
}

/** 附录图/表按需实例：startOverride=1 之后再写一个完整 w:lvl 覆盖 L0，lvlText 换成本附录字母（§4.3） */
function appendixOverrideNumXml(numId: number, abstractNumId: number, lvlText: string): string {
  const overrideLvl = levelXml({ ilvl: 0, numFmt: 'decimal', lvlText, ind: IND_DEFAULT })
  const children: XmlChild[] = [
    ['abstractNumId', `<w:abstractNumId w:val="${abstractNumId}"/>`],
    ['lvlOverride', lvlOverrideXml(0, 1, overrideLvl)],
  ]
  return num(children, { 'w:numId': numId })
}

// ---------------- 按需实例分配器（§4.3） ----------------

export interface NumberingAllocator {
  /**
   * 多条注：作用域键与上一次使用该 abstractNum(A8) 的段落相同则沿用当前实例，否则新建
   * （startOverride = ordinalInScope，取自 Resolver 的 label「注N：」）。
   */
  allocNoteInstance(scopeKey: string, ordinalInScope: number): number
  /** 多个示例：规则同 allocNoteInstance，作用于 A10 */
  allocExampleInstance(scopeKey: string, ordinalInScope: number): number
  /** 附录图：每个附录一个实例（该附录第一次用到时创建），lvlText 覆盖为 "图{letter}.%1　" */
  allocAppendixFigureInstance(appendixId: string, letter: string): number
  /** 附录表：同上，lvlText 覆盖为 "表{letter}.%1　" */
  allocAppendixTableInstance(appendixId: string, letter: string): number
  /** 编号列表（A12–A15）：每次调用新建一个实例，ilvl 0 与 1 都写 startOverride=1（§4.3：按需实例对
   * 该 abstractNum 的每个级别都写 startOverride，不论本次是否用到该级别） */
  allocListInstance(abstractNumId: number): number
  /** 汇总 16 个 abstractNum + 8 个固定实例 + 已分配的按需实例，生成完整 word/numbering.xml（含 XML 声明） */
  buildNumberingXml(): string
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

export function createNumberingAllocator(): NumberingAllocator {
  let nextDynamicId = 101
  let lastNoteScope: string | undefined
  let lastNoteNumId: number | undefined
  let lastExampleScope: string | undefined
  let lastExampleNumId: number | undefined
  const appendixFigureIds = new Map<string, number>()
  const appendixTableIds = new Map<string, number>()
  const dynamicNums: string[] = []

  function nextId(): number {
    const id = nextDynamicId
    nextDynamicId += 1
    return id
  }

  return {
    allocNoteInstance(scopeKey, ordinalInScope) {
      if (lastNoteScope === scopeKey && lastNoteNumId !== undefined) return lastNoteNumId
      const id = nextId()
      dynamicNums.push(overrideOnlyNumXml(id, ABSTRACT_NUM_ID.noteGroup, [{ ilvl: 0, start: ordinalInScope }]))
      lastNoteScope = scopeKey
      lastNoteNumId = id
      return id
    },
    allocExampleInstance(scopeKey, ordinalInScope) {
      if (lastExampleScope === scopeKey && lastExampleNumId !== undefined) return lastExampleNumId
      const id = nextId()
      dynamicNums.push(overrideOnlyNumXml(id, ABSTRACT_NUM_ID.exampleGroup, [{ ilvl: 0, start: ordinalInScope }]))
      lastExampleScope = scopeKey
      lastExampleNumId = id
      return id
    },
    allocAppendixFigureInstance(appendixId, letter) {
      const existing = appendixFigureIds.get(appendixId)
      if (existing !== undefined) return existing
      const id = nextId()
      dynamicNums.push(appendixOverrideNumXml(id, ABSTRACT_NUM_ID.appendixFigure, `图${letter}.%1${SP}`))
      appendixFigureIds.set(appendixId, id)
      return id
    },
    allocAppendixTableInstance(appendixId, letter) {
      const existing = appendixTableIds.get(appendixId)
      if (existing !== undefined) return existing
      const id = nextId()
      dynamicNums.push(appendixOverrideNumXml(id, ABSTRACT_NUM_ID.appendixTable, `表${letter}.%1${SP}`))
      appendixTableIds.set(appendixId, id)
      return id
    },
    allocListInstance(abstractNumId) {
      const id = nextId()
      dynamicNums.push(
        overrideOnlyNumXml(id, abstractNumId, [
          { ilvl: 0, start: 1 },
          { ilvl: 1, start: 1 },
        ]),
      )
      return id
    },
    buildNumberingXml() {
      const children: XmlChild[] = []
      for (const def of ABSTRACT_NUM_DEFS) children.push(['abstractNum', abstractNumXml(def)])
      for (const id of FIXED_ABSTRACT_NUM_IDS) children.push(['num', fixedNumXml(id)])
      for (const dyn of dynamicNums) children.push(['num', dyn])
      const el = numbering(children, { 'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' })
      return XML_DECL + el
    },
  }
}
