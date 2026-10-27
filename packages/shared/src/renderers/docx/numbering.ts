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
  listRoman: 14, // A14 小写罗马列项 i） ii） iii）（lowerRoman；WP8.M G7-c，D-M-06 A 真排）
  listRomanUpper: 15, // A15 大写罗马兼容槽：GB/T 46687.2 没有 roman-upper 取值，romanUpper 仍降级为数字列项（A13），本槽保持占位
  bibEntry: 16, // A16 参考文献
  /** A17 引言中的条（0.1、0.2…）。按需输出：只有文档含引言条时才写入 numbering.xml（WP8.M G6），其余文档仍是 16 个 abstractNum */
  introClause: 17,
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
  ['romanUpper', ABSTRACT_NUM_ID.listNumber],
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
const SONG_RFONTS = '<w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体" w:cs="宋体"/>'
export const RPR_SONG = rPr([['rFonts', SONG_RFONTS]])
/**
 * A14 L0（小写罗马标识 i） ii） iii）…）：ASCII 字母用 Times New Roman，全角右括号仍用宋体（eastAsia）。
 * 宋体的 ASCII 字母是半角等宽（0.5 em），`ii）`（1+1 em）已占满 2 字的悬挂量、`iii）`（1.5+1 em）超出，
 * Word 会把标识之后的文字推到下一个默认制表位（再右移 2 字），第 2 项起就与回行不对齐；Times 的 i 只有 0.28 em，
 * `i）`～`vi）` 都能落在 2 字之内，文字保持在第五字位（GB/T 1.1—2020 10.2.2）。
 */
const ROMAN_LABEL_RFONTS = '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>'
const RPR_ROMAN_LABEL = rPr([['rFonts', ROMAN_LABEL_RFONTS]])
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

/**
 * A17：引言中的条。引言不给章编号（GB/T 1.1—2020 8.4），条编号为 0.1、0.2……；Word 的多级列表里 L0 无法
 * 显示为 0，所以 L1..L5 的 lvlText 把 "0" 写成字面量、只引用 %2..%n：L1 `0.%2　`、L2 `0.%2.%3　`……
 * L0 仅为保持级别连续而保留（`0　`），文档里没有段落使用它。缩进、字体与 A1 的 L1..L5 完全相同。
 */
function introClauseLevels(): LevelSpec[] {
  return chapterLikeLevels().map(level => {
    if (level.ilvl === 0) return { ...level, lvlText: `0${SP}` }
    const parts: string[] = []
    for (let k = 2; k <= level.ilvl + 1; k++) parts.push(`%${k}`)
    return { ...level, lvlText: `0.${parts.join('.')}${SP}` }
  })
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

/** A12–A15：保留双层抽象编号；二级数字列项另用 A13 L0 + 段落直接缩进。 */
function listLevels(l0Fmt: string, l0Text: string, l1Fmt: string, l1Text: string, l0RPr: string = RPR_SONG): LevelSpec[] {
  return [
    { ilvl: 0, numFmt: l0Fmt, lvlText: l0Text, suff: 'tab', ind: IND_LIST_L0, rPr: l0RPr },
    { ilvl: 1, numFmt: l1Fmt, lvlText: l1Text, suff: 'tab', ind: IND_LIST_L1, rPr: RPR_SONG },
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
      { ilvl: 0, numFmt: 'bullet', lvlText: '——', suff: 'nothing', ind: IND_LIST_L0, rPr: RPR_SONG },
      { ilvl: 1, numFmt: 'bullet', lvlText: '·', suff: 'tab', ind: IND_LIST_L1, rPr: RPR_SONG },
    ],
  },
  { id: ABSTRACT_NUM_ID.listAlpha, multilevel: true, levels: listLevels('lowerLetter', '%1）', 'bullet', '·') },
  { id: ABSTRACT_NUM_ID.listNumber, multilevel: true, levels: listLevels('decimal', '%1）', 'bullet', '·') },
  // A14：小写罗马列项，lvlText 与 A12/A13 同为全角右括号（i）ii）iii）），缩进与 A12 的 L0/L1 相同；L0 标识的 ASCII 用 Times New Roman（见 RPR_ROMAN_LABEL）。
  { id: ABSTRACT_NUM_ID.listRoman, multilevel: true, levels: listLevels('lowerRoman', '%1）', 'bullet', '·', RPR_ROMAN_LABEL) },
  // A15：占位槽，保持 A1–A16 的文档结构；大写罗马没有原文取值，不会被任何列项使用（romanUpper → A13 数字列项）。
  { id: ABSTRACT_NUM_ID.listRomanUpper, multilevel: true, levels: listLevels('decimal', '%1）', 'bullet', '·') },
  { id: ABSTRACT_NUM_ID.bibEntry, multilevel: false, levels: [{ ilvl: 0, numFmt: 'decimal', lvlText: `[%1]${SP}`, ind: IND_FIRSTLINE_420, rPr: RPR_SONG }] },
]

/** 按需输出的 abstractNum：不在 ABSTRACT_NUM_DEFS（后者总是全部输出），由分配器在首次使用时登记 */
const INTRO_CLAUSE_DEF: AbstractNumSpec = { id: ABSTRACT_NUM_ID.introClause, multilevel: true, levels: introClauseLevels() }

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
  /**
   * 引言中的条（A17）：整份文档共用一个实例（引言只有一个，条编号连续），首次调用时才登记 A17 与实例，
   * ilvl 1..5 都写 startOverride=1（§4.3：按需实例对该 abstractNum 的每个级别都写）。
   */
  allocIntroClauseInstance(): number
  /** 汇总 16 个 abstractNum（含按需登记的 A17）+ 8 个固定实例 + 已分配的按需实例，生成完整 word/numbering.xml（含 XML 声明） */
  buildNumberingXml(): string
  /** 与生成的编号级别同源的段落缩进，供页流估算使用。 */
  getIndent(numId: number, ilvl: number): string | undefined
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
  let introClauseNumId: number | undefined
  const dynamicNums: string[] = []
  const abstractIds = new Map(FIXED_ABSTRACT_NUM_IDS.map(id => [id, id] as [number, number]))

  function nextId(abstractId: number): number {
    const id = nextDynamicId
    abstractIds.set(id, abstractId)
    nextDynamicId += 1
    return id
  }

  return {
    allocNoteInstance(scopeKey, ordinalInScope) {
      if (lastNoteScope === scopeKey && lastNoteNumId !== undefined) return lastNoteNumId
      const id = nextId(ABSTRACT_NUM_ID.noteGroup)
      dynamicNums.push(overrideOnlyNumXml(id, ABSTRACT_NUM_ID.noteGroup, [{ ilvl: 0, start: ordinalInScope }]))
      lastNoteScope = scopeKey
      lastNoteNumId = id
      return id
    },
    allocExampleInstance(scopeKey, ordinalInScope) {
      if (lastExampleScope === scopeKey && lastExampleNumId !== undefined) return lastExampleNumId
      const id = nextId(ABSTRACT_NUM_ID.exampleGroup)
      dynamicNums.push(overrideOnlyNumXml(id, ABSTRACT_NUM_ID.exampleGroup, [{ ilvl: 0, start: ordinalInScope }]))
      lastExampleScope = scopeKey
      lastExampleNumId = id
      return id
    },
    allocAppendixFigureInstance(appendixId, letter) {
      const existing = appendixFigureIds.get(appendixId)
      if (existing !== undefined) return existing
      const id = nextId(ABSTRACT_NUM_ID.appendixFigure)
      dynamicNums.push(appendixOverrideNumXml(id, ABSTRACT_NUM_ID.appendixFigure, `图${letter}.%1${SP}`))
      appendixFigureIds.set(appendixId, id)
      return id
    },
    allocAppendixTableInstance(appendixId, letter) {
      const existing = appendixTableIds.get(appendixId)
      if (existing !== undefined) return existing
      const id = nextId(ABSTRACT_NUM_ID.appendixTable)
      dynamicNums.push(appendixOverrideNumXml(id, ABSTRACT_NUM_ID.appendixTable, `表${letter}.%1${SP}`))
      appendixTableIds.set(appendixId, id)
      return id
    },
    allocListInstance(abstractNumId) {
      const id = nextId(abstractNumId)
      dynamicNums.push(
        overrideOnlyNumXml(id, abstractNumId, [
          { ilvl: 0, start: 1 },
          { ilvl: 1, start: 1 },
        ]),
      )
      return id
    },
    allocIntroClauseInstance() {
      if (introClauseNumId !== undefined) return introClauseNumId
      const id = nextId(ABSTRACT_NUM_ID.introClause)
      dynamicNums.push(overrideOnlyNumXml(id, ABSTRACT_NUM_ID.introClause,
        INTRO_CLAUSE_DEF.levels.filter(level => level.ilvl >= 1).map(level => ({ ilvl: level.ilvl, start: 1 }))))
      introClauseNumId = id
      return id
    },
    getIndent(numId, ilvl) {
      return [...ABSTRACT_NUM_DEFS, INTRO_CLAUSE_DEF].find(def => def.id === abstractIds.get(numId))?.levels.find(level => level.ilvl === ilvl)?.ind
    },
    buildNumberingXml() {
      const children: XmlChild[] = []
      for (const def of ABSTRACT_NUM_DEFS) children.push(['abstractNum', abstractNumXml(def)])
      if (introClauseNumId !== undefined) children.push(['abstractNum', abstractNumXml(INTRO_CLAUSE_DEF)])
      for (const id of FIXED_ABSTRACT_NUM_IDS) children.push(['num', fixedNumXml(id)])
      for (const dyn of dynamicNums) children.push(['num', dyn])
      const el = numbering(children, { 'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' })
      return XML_DECL + el
    },
  }
}
