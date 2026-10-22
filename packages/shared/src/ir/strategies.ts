/**
 * 编号策略实现（Phase 5.5 / WP3，接口定稿见计划 2.4 节）。
 * gbT11Strategy：GB/T 1.1-2020 编号规则。
 */

import type { IRList, NumberingStrategy } from './types'

/** 1 -> "A"，27 -> "AA"（GB/T 1.1 附录通常不超过 26 个，超出按双字母延展） */
export function appendixLetterOf(seq: number): string {
  let n = seq
  let letters = ''
  while (n > 0) {
    n -= 1
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26)
  }
  return letters
}

/** 1 -> "a"，26 -> "z"，27 -> "aa"（与表脚注字母同一种逐位进位） */
function lowerLetters(index: number): string {
  let n = index
  let letters = ''
  while (n > 0) {
    n -= 1
    letters = String.fromCharCode(97 + (n % 26)) + letters
    n = Math.floor(n / 26)
  }
  return letters
}

const ROMAN_STEPS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

/** 1 -> "i"，4 -> "iv"；超出 1～3999 不可表示，退回十进制。 */
function lowerRoman(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 3999) return String(index)
  let rest = index
  let out = ''
  for (const [value, glyph] of ROMAN_STEPS) {
    while (rest >= value) { out += glyph; rest -= value }
  }
  return out
}

/**
 * 有序列项标记（GB/T 1.1-2020 列项，半角括号，D-M-03）：alpha -> "a)"…"z)"，27 起 "aa)"；
 * number -> "1)"；roman -> "i)"。无序列项与 romanUpper 没有标记，返回空串。
 * 由 gbT11Strategy.listItem 引用；Resolver 在第三方策略缺该方法时也用它。
 */
export function listItem(listType: IRList['listType'], index: number): string {
  switch (listType) {
    case 'alpha': return `${lowerLetters(index)})`
    case 'number': return `${index})`
    case 'roman': return `${lowerRoman(index)})`
    default: return ''
  }
}

function prefixed(seq: number, appendixLetter?: string): string {
  return appendixLetter ? `${appendixLetter}.${seq}` : String(seq)
}

export const gbT11Strategy: NumberingStrategy = {
  chapter: (seq) => String(seq),
  clause: (path) => path.join('.'),
  appendix: (seq) => `附录${appendixLetterOf(seq)}`,
  appendixLetter: appendixLetterOf,
  figure: (seq, appendixLetter) => `图${prefixed(seq, appendixLetter)}`,
  table: (seq, appendixLetter) => `表${prefixed(seq, appendixLetter)}`,
  formula: (seq, appendixLetter) => `(${prefixed(seq, appendixLetter)})`,
  // 同一作用域内单条不编号、多条编号（GB/T 1.1 与 ISO 同规则）
  note: (index, totalInScope) => (totalInScope > 1 ? `注${index}：` : '注：'),
  example: (index, totalInScope) => (totalInScope > 1 ? `示例${index}：` : '示例：'),
  bibEntry: (seq) => `[${seq}]`,
  listItem,
}
