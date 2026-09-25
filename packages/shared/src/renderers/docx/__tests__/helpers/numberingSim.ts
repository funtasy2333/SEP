/**
 * §4.7 Word 编号模拟器（docs/wp7-docx-delivery.md §4.7 helpers/numberingSim.ts）。
 *
 * 复现 Word 实际的编号计数行为（spike v10 实测：计数器属于 abstractNum、按级别存放，
 * 由引用同一 abstractNum 的全部 w:num 实例共用；startOverride 只在实例第一次被段落使用时
 * 生效一次；§4.3）。`numberingSim.test.ts` 先用手写 XML 片段复现 §4.7 表的全部自测用例，
 * 验证模拟器本身；随后各一致性 fixture 用它逐段核对渲染器输出与 Resolver 的 labels 是否一致。
 *
 * 这是测试代码（属于 shared 测试基建），不从任何 index.ts 导出，同样不得使用 Node 或浏览器
 * 专有 API。
 */

import type { DocxPackage } from '../../types'
import { extractParagraphText, findChild } from './outline'
import { parseXml, type XmlElement, type XmlNode } from './xmlTree'

/** OOXML 编号级别上限（w:ilvl 取值 0–8） */
const MAX_LEVELS = 9

export interface SimParagraph {
  /** 段落序号，从 0 起（document.xml 中全部 w:p 按文档顺序深度优先，含表格单元格内的段落） */
  index: number
  styleId: string | undefined
  numId: string | undefined
  ilvl: number | undefined
  /** 模拟出的标识全文，含 lvlText 里的全角空格；无编号为 undefined */
  label: string | undefined
  text: string
}

interface SimLevel {
  start: number
  numFmt: string
  lvlText: string
}

interface SimAbstractNum {
  levels: Map<number, SimLevel>
}

interface SimNumInstance {
  abstractNumId: string
  /** ilvl -> 该级别的 lvlOverride（startOverride 与/或完整 lvl 覆盖，均可选） */
  overrides: Map<number, { startOverride?: number; lvl?: SimLevel }>
}

interface SimStyle {
  basedOn?: string
  numPr?: { numId: string; ilvl: number }
}

// ---------------- 编号格式化 ----------------

/** 1→a、26→z、27→aa、28→bb……（Word 的字母编号过 26 后的延展规则，非电子表格式的 aa=27） */
function letterFormat(n: number, upper: boolean): string {
  const idx = (n - 1) % 26
  const repeat = Math.floor((n - 1) / 26) + 1
  const ch = String.fromCharCode((upper ? 65 : 97) + idx)
  return ch.repeat(repeat)
}

const ROMAN_TABLE: readonly (readonly [number, string])[] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

function toRomanLower(n: number): string {
  let rest = n
  let out = ''
  for (const [value, sym] of ROMAN_TABLE) {
    while (rest >= value) {
      out += sym
      rest -= value
    }
  }
  return out
}

/** 导出供直接单测：decimal / upperLetter / lowerLetter / upperRoman / lowerRoman；其余（bullet/none）原样返回数字文本，
 * 这两种格式的 lvlText 在本规格中从不含 %n，实际不会走到这个分支 */
export function formatCounterValue(n: number, numFmt: string): string {
  switch (numFmt) {
    case 'decimal':
      return String(n)
    case 'lowerLetter':
      return letterFormat(n, false)
    case 'upperLetter':
      return letterFormat(n, true)
    case 'lowerRoman':
      return toRomanLower(n)
    case 'upperRoman':
      return toRomanLower(n).toUpperCase()
    default:
      return String(n)
  }
}

/** 把 lvlText 中的 %1..%9 替换为对应级别（%n 指第 n-1 级）的计数按该级 numFmt 格式化的结果 */
function expandLvlText(lvlText: string, levelOf: (k: number) => SimLevel | undefined, counters: readonly number[]): string {
  return lvlText.replace(/%([1-9])/g, (_m, d: string) => {
    const k = Number(d) - 1
    const level = levelOf(k)
    return formatCounterValue(counters[k] ?? 0, level ? level.numFmt : 'decimal')
  })
}

// ---------------- word/numbering.xml 解析 ----------------

function parseLevel(lvlEl: XmlElement): SimLevel {
  const start = Number(findChild(lvlEl, 'w:start')?.attrs['w:val'] ?? '1')
  const numFmt = findChild(lvlEl, 'w:numFmt')?.attrs['w:val'] ?? 'decimal'
  const lvlText = findChild(lvlEl, 'w:lvlText')?.attrs['w:val'] ?? ''
  return { start, numFmt, lvlText }
}

interface ParsedNumbering {
  abstractNums: Map<string, SimAbstractNum>
  instances: Map<string, SimNumInstance>
}

function parseNumbering(numberingXml: string): ParsedNumbering {
  const root = parseXml(numberingXml)
  const abstractNums = new Map<string, SimAbstractNum>()
  const instances = new Map<string, SimNumInstance>()
  for (const child of root.children) {
    if (child.kind !== 'element') continue
    if (child.name === 'w:abstractNum') {
      const id = child.attrs['w:abstractNumId']
      if (id === undefined) throw new Error('numberingSim: abstractNum 缺少 w:abstractNumId')
      const levels = new Map<number, SimLevel>()
      for (const lvlEl of child.children) {
        if (lvlEl.kind !== 'element' || lvlEl.name !== 'w:lvl') continue
        const ilvl = Number(lvlEl.attrs['w:ilvl'])
        levels.set(ilvl, parseLevel(lvlEl))
      }
      abstractNums.set(id, { levels })
    } else if (child.name === 'w:num') {
      const numId = child.attrs['w:numId']
      if (numId === undefined) throw new Error('numberingSim: num 缺少 w:numId')
      const abstractNumId = findChild(child, 'w:abstractNumId')?.attrs['w:val']
      if (abstractNumId === undefined) throw new Error(`numberingSim: num "${numId}" 缺少 w:abstractNumId`)
      const overrides = new Map<number, { startOverride?: number; lvl?: SimLevel }>()
      for (const ov of child.children) {
        if (ov.kind !== 'element' || ov.name !== 'w:lvlOverride') continue
        const ilvl = Number(ov.attrs['w:ilvl'])
        const startOverrideEl = findChild(ov, 'w:startOverride')
        const lvlEl = findChild(ov, 'w:lvl')
        overrides.set(ilvl, {
          startOverride: startOverrideEl ? Number(startOverrideEl.attrs['w:val']) : undefined,
          lvl: lvlEl ? parseLevel(lvlEl) : undefined,
        })
      }
      instances.set(numId, { abstractNumId, overrides })
    }
  }
  return { abstractNums, instances }
}

// ---------------- word/styles.xml 解析 ----------------

function parseStyles(stylesXml: string): Map<string, SimStyle> {
  const root = parseXml(stylesXml)
  const out = new Map<string, SimStyle>()
  for (const child of root.children) {
    if (child.kind !== 'element' || child.name !== 'w:style') continue
    const id = child.attrs['w:styleId']
    if (id === undefined) continue
    const basedOn = findChild(child, 'w:basedOn')?.attrs['w:val']
    const pPr = findChild(child, 'w:pPr')
    const numPrEl = pPr && findChild(pPr, 'w:numPr')
    const numPr = numPrEl
      ? {
          numId: findChild(numPrEl, 'w:numId')?.attrs['w:val'] ?? '',
          ilvl: Number(findChild(numPrEl, 'w:ilvl')?.attrs['w:val'] ?? '0'),
        }
      : undefined
    out.set(id, { basedOn, numPr })
  }
  return out
}

/** 沿 basedOn 链找第一个带 pPr/numPr 的样式（含自身）；找不到返回 undefined。有环时停止（防御性保护，
 * 生成器不应产出环，出现环说明生成器有 bug，这里不抛错、按找不到处理，避免测试死循环） */
function resolveStyleNumPr(styleId: string | undefined, styles: Map<string, SimStyle>): { numId: string; ilvl: number } | undefined {
  let cur = styleId
  const seen = new Set<string>()
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur)
    const style = styles.get(cur)
    if (!style) return undefined
    if (style.numPr) return style.numPr
    cur = style.basedOn
  }
  return undefined
}

// ---------------- word/document.xml 遍历 ----------------

function collectParagraphs(nodes: readonly XmlNode[], out: XmlElement[]): void {
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    if (node.name === 'w:p') {
      out.push(node)
    } else if (node.name === 'w:tbl') {
      for (const row of node.children) {
        if (row.kind !== 'element' || row.name !== 'w:tr') continue
        for (const cell of row.children) {
          if (cell.kind !== 'element' || cell.name !== 'w:tc') continue
          collectParagraphs(cell.children, out)
        }
      }
    }
  }
}

function paragraphsInOrder(documentXml: string): XmlElement[] {
  const doc = parseXml(documentXml)
  const body = findChild(doc, 'w:body')
  if (!body) throw new Error('numberingSim: word/document.xml 缺少 w:body')
  const out: XmlElement[] = []
  collectParagraphs(body.children, out)
  return out
}

/** 段落自身的 numPr：undefined 表示没写；'none' 表示写了但 numId="0"（显式「无编号」，§4.7） */
type OwnNumPr = { numId: string; ilvl: number } | 'none' | undefined

function paragraphOwnNumPr(p: XmlElement): OwnNumPr {
  const pPr = findChild(p, 'w:pPr')
  const numPrEl = pPr && findChild(pPr, 'w:numPr')
  if (!numPrEl) return undefined
  const numId = findChild(numPrEl, 'w:numId')?.attrs['w:val']
  if (numId === undefined || numId === '0') return 'none'
  const ilvl = Number(findChild(numPrEl, 'w:ilvl')?.attrs['w:val'] ?? '0')
  return { numId, ilvl }
}

// ---------------- 计数状态机（§4.3） ----------------

class CounterState {
  /** abstractNumId -> 按级别存放的计数器（初值 0 表示未计数），§4.3 规则 1：同一 abstractNum 的全部实例共用 */
  private readonly counters = new Map<string, number[]>()
  /** 已经「被段落使用过」的 numId 集合，§4.3 规则 2：startOverride 只在实例第一次被使用时生效 */
  private readonly usedNumIds = new Set<string>()

  private countersOf(abstractNumId: string): number[] {
    let arr = this.counters.get(abstractNumId)
    if (!arr) {
      arr = new Array(MAX_LEVELS).fill(0)
      this.counters.set(abstractNumId, arr)
    }
    return arr
  }

  /** 处理一个编号段落，返回它的标识文本 */
  process(numId: string, ilvl: number, numbering: ParsedNumbering): string {
    const instance = numbering.instances.get(numId)
    if (!instance) throw new Error(`numberingSim: 段落引用的 numId "${numId}" 不在 numbering.xml 中`)
    const abstractNum = numbering.abstractNums.get(instance.abstractNumId)
    if (!abstractNum) throw new Error(`numberingSim: num "${numId}" 的 abstractNumId "${instance.abstractNumId}" 不存在`)
    const counters = this.countersOf(instance.abstractNumId)

    // 规则 2：实例第一次被段落使用时，把它写了 startOverride 的每个级别都置为「v-1」
    // ——不论触发这次「首次使用」的段落本身是哪个级别（T4：override 只写 ilvl0，在 ilvl1 使用也会触发 ilvl0 重置）。
    if (!this.usedNumIds.has(numId)) {
      this.usedNumIds.add(numId)
      for (const [k, ov] of instance.overrides) {
        if (ov.startOverride !== undefined) counters[k] = ov.startOverride - 1
      }
    }

    // 级别定义：实例 lvlOverride 内的 w:lvl 优先，否则取 abstractNum 的同级 w:lvl
    const effectiveLevel = (k: number): SimLevel | undefined => instance.overrides.get(k)?.lvl ?? abstractNum.levels.get(k)

    // 规则 3 前半：比本段浅且尚未计过数（仍是初值 0）的级别，按其 start 隐式计一次（跳级隐式计数）
    for (let k = 0; k < ilvl; k++) {
      if (counters[k] === 0) {
        const def = abstractNum.levels.get(k)
        counters[k] = def ? def.start : 1
      }
    }
    // 本段级别：仍是初值 0（从未计数，含刚被 startOverride 置为 0 的情形）则取 start，否则加 1
    const ownDef = effectiveLevel(ilvl)
    if (!ownDef) throw new Error(`numberingSim: numId "${numId}" 的第 ${ilvl} 级没有级别定义（既无 lvlOverride/lvl 也无 abstractNum 同级 lvl）`)
    if (counters[ilvl] === 0) counters[ilvl] = ownDef.start
    else counters[ilvl] += 1
    // 规则 3 后半：比本段深的级别全部重置
    for (let k = ilvl + 1; k < MAX_LEVELS; k++) counters[k] = 0

    return expandLvlText(ownDef.lvlText, effectiveLevel, counters)
  }
}

// ---------------- 入口 ----------------

/**
 * 模拟 Word 的编号计数与显示，按 document.xml 顺序输出每个段落的 (styleId, numId, ilvl, label, text)。
 * 没有 word/styles.xml 或 word/numbering.xml 时视为全文无编号（label 全部 undefined）。
 */
export function simulateNumbering(pkg: DocxPackage): SimParagraph[] {
  const documentXml = pkg.parts['word/document.xml']
  if (documentXml === undefined) throw new Error('numberingSim: 包内没有 word/document.xml')
  const stylesXml = pkg.parts['word/styles.xml']
  const numberingXml = pkg.parts['word/numbering.xml']

  const styles = stylesXml !== undefined ? parseStyles(stylesXml) : undefined
  const numbering = numberingXml !== undefined ? parseNumbering(numberingXml) : undefined
  const enabled = styles !== undefined && numbering !== undefined

  const state = new CounterState()
  const paragraphs = paragraphsInOrder(documentXml)

  return paragraphs.map((p, index): SimParagraph => {
    const pPr = findChild(p, 'w:pPr')
    const styleId = pPr && findChild(pPr, 'w:pStyle')?.attrs['w:val']
    const text = extractParagraphText(p)

    if (!enabled) {
      return { index, styleId, numId: undefined, ilvl: undefined, label: undefined, text }
    }

    const own = paragraphOwnNumPr(p)
    const resolved = own === 'none' ? undefined : (own ?? resolveStyleNumPr(styleId, styles))
    if (!resolved) {
      return { index, styleId, numId: undefined, ilvl: undefined, label: undefined, text }
    }
    const label = state.process(resolved.numId, resolved.ilvl, numbering)
    return { index, styleId, numId: resolved.numId, ilvl: resolved.ilvl, label, text }
  })
}
