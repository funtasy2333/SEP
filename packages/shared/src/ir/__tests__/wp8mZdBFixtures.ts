/**
 * WP8.M M-Z-d B（D-M-17）：嵌套列表的 IR 原生 fixture。
 *
 * 只描述“渲染时确有标识的列项才有 Resolver 标记”所需的最小结构，不修改字节锁定的 fixtures.ts，
 * 也不改 G4 的夹具；复用 G4 夹具的构造函数。
 *
 * 文档：第 1 章“一般要求”下的 1.1 条（`zd-c11`），条下依次是引用段 `zd-ref` 和下面几个列表
 * （括号里是列表类型，缩进表示嵌套；id 即语义）：
 *
 *   zd-num (number)             n1 壹   ── zd-num-roman (roman)  : nr1 nr2 nr3     ← number 内嵌 roman
 *                               n2 贰   ── zd-num-alpha (alpha)  : na1 na2         ← number 内嵌 alpha
 *                               n3 叁   ── zd-num-num   (number) : nn1 nn2         ← number 内嵌 number
 *   zd-alpha (alpha)            a1 甲   ── zd-alpha-num (number) : an1 an2         ← alpha 内嵌 number
 *                                              └─ zd-deep-num (number) : dp1 dp2     ← 第三层 number（DOCX 无编号）
 *                               a2 乙   ── zd-alpha-alpha (alpha): aa1 aa2         ← alpha 内嵌 alpha
 *   zd-dash (dash)              d1 一   ── zd-dash-alpha (alpha) : da1 da2         ← dash 内嵌 alpha
 *                               d2 二   ── zd-dash-roman (roman) : dr1 dr2         ← dash 内嵌 roman
 *                               d3 三   ── zd-dash-num   (number): dn1 dn2         ← dash 内嵌 number
 *   zd-roman (roman)            r1 Ⅰ    ── zd-roman-roman (roman): rr1 rr2         ← roman 内嵌 roman
 *                               r2 Ⅱ
 */

import type { IRDoc, IRInline, IRList } from '../types'
import { chapter, clause, docOf, item, list, para } from './wp8mG4Fixtures'

export { xref } from './wp8mG4Fixtures'

/** 嵌套项的文字取“id + 文”（如 nr2 → “nr2文”），DOCX / HTML 测试可按文字唯一定位到某一项。 */
const items = (prefix: string, count: number): ReturnType<typeof item>[] =>
  Array.from({ length: count }, (_, index) => item(`${prefix}${index + 1}`, `${prefix}${index + 1}文`))

/** 引用段之后的全部列表（每次调用返回新对象，测试可随意改动）。 */
export function nestedLists(): IRList[] {
  return [
    list('zd-num', 'number', [
      item('n1', '壹', list('zd-num-roman', 'roman', items('nr', 3))),
      item('n2', '贰', list('zd-num-alpha', 'alpha', items('na', 2))),
      item('n3', '叁', list('zd-num-num', 'number', items('nn', 2))),
    ], 2),
    list('zd-alpha', 'alpha', [
      item('a1', '甲', list('zd-alpha-num', 'number', [
        item('an1', 'an1文', list('zd-deep-num', 'number', items('dp', 2))),
        item('an2', 'an2文'),
      ])),
      item('a2', '乙', list('zd-alpha-alpha', 'alpha', items('aa', 2))),
    ]),
    list('zd-dash', 'dash', [
      item('d1', '一', list('zd-dash-alpha', 'alpha', items('da', 2))),
      item('d2', '二', list('zd-dash-roman', 'roman', items('dr', 2))),
      item('d3', '三', list('zd-dash-num', 'number', items('dn', 2))),
    ]),
    list('zd-roman', 'roman', [
      item('r1', 'Ⅰ', list('zd-roman-roman', 'roman', items('rr', 2))),
      item('r2', 'Ⅱ'),
    ]),
  ]
}

/** `refs` 写进引用段 `zd-ref`；`lists` 缺省为 {@link nestedLists}。 */
export function nestedListDoc(refs: IRInline[] = [], lists: IRList[] = nestedLists()): IRDoc {
  return docOf([
    chapter('zd-ch1', 'general', '一般要求',
      clause('zd-c11', 1, '嵌套列项',
        para('zd-ref', { text: '参见' }, ...refs),
        ...lists)),
  ])
}
