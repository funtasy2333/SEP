/**
 * 编号策略实现（Phase 5.5 / WP3，接口定稿见计划 2.4 节）。
 * gbT11Strategy：GB/T 1.1-2020 编号规则。
 */

import type { NumberingStrategy } from './types'

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
}
