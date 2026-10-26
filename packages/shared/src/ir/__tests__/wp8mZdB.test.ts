/**
 * WP8.M M-Z-d B（D-M-17）：Resolver 只给“渲染时确有该标识”的列项赋标记。
 *
 * Codex 评审 PR #56 发现：Resolver 对任何 alpha / number / roman 列表都赋列项标识，但嵌套（第二层）列表的实际渲染是
 * - HTML screen/print：`.ses-list .ses-list:not(.ses-list-number) > .ses-list-item::before { content: "·" }`
 *   —— 嵌套的 alpha / roman 显示为间隔号，嵌套 number 仍显示 1） 2）；
 * - DOCX（`planForList` depth 2）：number → 另起 A13 实例（ilvl 0，1） 2））；dash / dot → 点；其他 → 父列表实例的 ilvl 1
 *   （A11 / A12 / A13 / A14 的 ilvl 1 都是 bullet“·”）；第三层及以下只有 SesListDot（`list-too-deep` 警告），没有编号。
 * 于是引用嵌套 roman 项会导出“1） i）”这类文档里并不存在的标识。
 *
 * 规则（resolve.ts，显式的列表嵌套深度）：第一层 alpha / number / roman，以及第二层 number 有标记；
 * 其余（嵌套的 alpha / roman、第三层及以下）与无序列项同等处理：不赋标签，对它们的引用报 dangling-xref（没有编号）。
 * 渲染一致性见 renderers/__tests__/wp8mZdB.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { resolve } from '../resolve'
import type { IRDoc, IRList, IRParagraph, NumberingStrategy } from '../types'
import { gbT11Strategy } from '../strategies'
import { item, list } from './wp8mG4Fixtures'
import { nestedListDoc, nestedLists, xref } from './wp8mZdBFixtures'

const NO_NUMBER = /没有编号/
const danglingXrefs = (doc: IRDoc) => resolve(doc).problems.filter(problem => problem.code === 'dangling-xref')
const errors = (doc: IRDoc) => resolve(doc).problems.filter(problem => problem.severity === 'error')
const extLabels = (doc: IRDoc) => Object.entries(resolve(doc).labels).filter(([, label]) => label.xmlId.startsWith('ext_')).map(([id]) => id)
const listItemLabels = (doc: IRDoc) => Object.entries(resolve(doc).labels).filter(([, label]) => label.xmlId.startsWith('li_'))

/** 与 {@link nestedLists} 的第一层相同，但项里不带嵌套列表：用来证明第一层的标记不因嵌套而改变。 */
function firstLevelOnlyLists(): IRList[] {
  const textOf = (entry: IRList['items'][number]): string => (entry.content[0] as IRParagraph).content.map(run => run.text).join('')
  return nestedLists().map(source => ({ ...source, items: source.items.map(entry => item(entry.id, textOf(entry))) }))
}

describe('[M-Z-d B] 第一层 alpha / number / roman：与 G4 现有行为完全不变', () => {
  const ids = ['n1', 'n2', 'n3', 'a1', 'a2', 'r1', 'r2']
  const refs = ids.map(id => xref(id, 'listItem'))

  it('标签与 G4 一致：label 为标记、xmlId 按文档序 li_k、refText 为“容器编号 + 标记”', () => {
    const { labels, problems } = resolve(nestedListDoc(refs))
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['n1']).toEqual({ label: '1）', xmlId: 'li_1', refText: '1.1 1）' })
    expect(labels['n3']).toEqual({ label: '3）', xmlId: 'li_3', refText: '1.1 3）' })
    expect(labels['a1']).toEqual({ label: 'a）', xmlId: 'li_4', refText: '1.1 a）' })
    expect(labels['a2']).toEqual({ label: 'b）', xmlId: 'li_5', refText: '1.1 b）' })
    expect(labels['r1']).toEqual({ label: 'i）', xmlId: 'li_6', refText: '1.1 i）' })
    expect(labels['r2']).toEqual({ label: 'ii）', xmlId: 'li_7', refText: '1.1 ii）' })
  })

  it('带嵌套列表与不带嵌套列表的同一篇文档，第一层列项的标签逐字相同', () => {
    const withNested = resolve(nestedListDoc(refs)).labels
    const plain = resolve(nestedListDoc(refs, firstLevelOnlyLists())).labels
    for (const id of ids) expect(withNested[id], id).toEqual(plain[id])
  })

  it('没有任何引用时整篇文档不产生 li_ 标签、ext_ 占位与 error', () => {
    const doc = nestedListDoc()
    expect(listItemLabels(doc)).toEqual([])
    expect(extLabels(doc)).toEqual([])
    expect(errors(doc)).toEqual([])
  })

  it('无类型 crossRef（旧稿形态）对第一层列项同样触发标签', () => {
    const { labels } = resolve(nestedListDoc([xref('a2')]))
    expect(labels['a2']).toEqual({ label: 'b）', xmlId: 'li_1', refText: '1.1 b）' })
  })
})

describe('[M-Z-d B] number 内嵌 roman / alpha：引用报问题、没有 refText', () => {
  it.each(['nr1', 'nr2', 'nr3', 'na1', 'na2'])('指向 %s（带类型）：不赋标签，dangling-xref（没有编号），也没有 ext_ 占位', id => {
    const doc = nestedListDoc([xref(id, 'listItem')])
    const { labels } = resolve(doc)
    expect(labels[id]).toBeUndefined()
    expect(danglingXrefs(doc)).toEqual([
      expect.objectContaining({ nodeId: 'zd-ref', severity: 'error', message: expect.stringMatching(NO_NUMBER) }),
    ])
    expect(danglingXrefs(doc)[0]!.message).toContain(`「${id}」`)
    expect(resolve(doc).problems.some(problem => problem.code === 'dangling-typed-ref')).toBe(false)
    expect(extLabels(doc)).toEqual([])
    expect(listItemLabels(doc)).toEqual([])
  })

  it('无类型 crossRef 指向嵌套 roman：同样 dangling-xref', () => {
    const doc = nestedListDoc([xref('nr2')])
    expect(resolve(doc).labels['nr2']).toBeUndefined()
    expect(danglingXrefs(doc)).toHaveLength(1)
  })

  it('嵌套 roman / alpha 项本身仍是 listItem 类型的有效目标：只是没有编号，不会被报成“目标不存在”或类型错误', () => {
    const { problems } = resolve(nestedListDoc([xref('nr2', 'listItem')]))
    expect(problems.filter(problem => problem.code === 'dangling-xref').map(problem => problem.message)).toEqual([
      '交叉引用的目标「nr2」没有编号，无法生成引用文本',
    ])
    expect(problems.some(problem => /不存在/.test(problem.message))).toBe(false)
  })
})

describe('[M-Z-d B] alpha / number 内嵌 number：标签与渲染一致', () => {
  it('number 内嵌 number：嵌套列表各自从 1） 起，refText 带上外层标记（3） 2））', () => {
    const { labels, problems } = resolve(nestedListDoc([xref('nn1', 'listItem'), xref('nn2', 'listItem')]))
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['nn1']).toEqual({ label: '1）', xmlId: 'li_1', refText: '1.1 3） 1）' })
    expect(labels['nn2']).toEqual({ label: '2）', xmlId: 'li_2', refText: '1.1 3） 2）' })
  })

  it('alpha 内嵌 number：refText 为“a） 2）”', () => {
    const { labels, problems } = resolve(nestedListDoc([xref('an2', 'listItem')]))
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['an2']).toEqual({ label: '2）', xmlId: 'li_1', refText: '1.1 a） 2）' })
  })

  it('同一文档里被引用的嵌套 roman 不占 li_ 序号：li_k 只数真正有标签的列项', () => {
    const doc = nestedListDoc([xref('nr2', 'listItem'), xref('nn2', 'listItem'), xref('da2', 'listItem'), xref('an2', 'listItem')])
    const { labels } = resolve(doc)
    expect(listItemLabels(doc).map(([id, label]) => [id, label.xmlId])).toEqual([['nn2', 'li_1'], ['an2', 'li_2']])
    expect(labels['nr2']).toBeUndefined()
    expect(labels['da2']).toBeUndefined()
    expect(danglingXrefs(doc)).toHaveLength(2)
  })
})

describe('[M-Z-d B] dash 内嵌 alpha / roman：无标识（无序祖先不使嵌套 alpha / roman 获得标识）', () => {
  it.each(['da1', 'da2', 'dr1', 'dr2'])('指向 %s：dangling-xref，不赋标签', id => {
    const doc = nestedListDoc([xref(id, 'listItem')])
    expect(resolve(doc).labels[id]).toBeUndefined()
    expect(danglingXrefs(doc)).toEqual([expect.objectContaining({ nodeId: 'zd-ref', severity: 'error', message: expect.stringMatching(NO_NUMBER) })])
  })

  it('dash 内嵌 number 仍有标记（渲染为 1） 2））；无序祖先不贡献标记路径，refText 只含 2）', () => {
    const { labels, problems } = resolve(nestedListDoc([xref('dn2', 'listItem')]))
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['dn2']).toEqual({ label: '2）', xmlId: 'li_1', refText: '1.1 2）' })
  })

  it('与无序列项同等处理：指向 dash 项自身的引用结果相同（dangling-xref），问题码与严重级别一致', () => {
    const nested = danglingXrefs(nestedListDoc([xref('da1', 'listItem')]))[0]!
    const unordered = danglingXrefs(nestedListDoc([xref('d1', 'listItem')]))[0]!
    expect(nested.code).toBe(unordered.code)
    expect(nested.severity).toBe(unordered.severity)
    expect(nested.message.replace('da1', 'd1')).toBe(unordered.message)
  })
})

describe('[M-Z-d B] 其他嵌套情形', () => {
  it('alpha 内嵌 alpha、roman 内嵌 roman：无标识', () => {
    for (const id of ['aa1', 'aa2', 'rr1', 'rr2']) {
      const doc = nestedListDoc([xref(id, 'listItem')])
      expect(resolve(doc).labels[id], id).toBeUndefined()
      expect(danglingXrefs(doc), id).toHaveLength(1)
    }
  })

  it('第三层 number（DOCX 只输出 SesListDot、没有编号）不赋标记；同一棵树的第二层 number 仍有', () => {
    const doc = nestedListDoc([xref('dp2', 'listItem'), xref('an1', 'listItem')])
    const { labels } = resolve(doc)
    expect(labels['dp2']).toBeUndefined()
    expect(labels['an1']).toEqual({ label: '1）', xmlId: 'li_1', refText: '1.1 a） 1）' })
    expect(danglingXrefs(doc)).toEqual([expect.objectContaining({ message: expect.stringContaining('「dp2」') })])
  })

  it('嵌套深度按列表重新计：前一个列表嵌套之后，后面的第一层列表不受影响', () => {
    const lists: IRList[] = [
      list('l1', 'alpha', [item('x1', '甲', list('l1-in', 'roman', [item('x1r', '罗')]))]),
      list('l2', 'roman', [item('y1', '罗一'), item('y2', '罗二')]),
      list('l3', 'number', [item('z1', '数一')], 2),
    ]
    const { labels, problems } = resolve(nestedListDoc([xref('y2', 'listItem'), xref('z1', 'listItem'), xref('x1r', 'listItem')], lists))
    expect(labels['y2']).toMatchObject({ label: 'ii）', refText: '1.1 ii）' })
    expect(labels['z1']).toMatchObject({ label: '1）', refText: '1.1 1）' })
    expect(labels['x1r']).toBeUndefined()
    expect(problems.filter(problem => problem.code === 'dangling-xref')).toHaveLength(1)
  })

  it('romanUpper / boxed / dot 等本来无标记的类型不受影响（嵌套与否都没有标签）', () => {
    const lists: IRList[] = [
      list('lu', 'romanUpper', [item('u1', 'Ⅴ', list('lu-in', 'romanUpper', [item('u1a', 'Ⅵ')]))]),
      list('lb', 'boxed', [item('b1', '框')]),
    ]
    const doc = nestedListDoc([xref('u1', 'listItem'), xref('u1a', 'listItem'), xref('b1', 'listItem')], lists)
    expect(listItemLabels(doc)).toEqual([])
    expect(danglingXrefs(doc)).toHaveLength(3)
  })

  it('不给不渲染标识的列项计算标记：第三方策略的 listItem 只会被第一层与第二层 number 调用', () => {
    const calls: string[] = []
    const strategy: NumberingStrategy = { ...gbT11Strategy, listItem: (listType, index) => { calls.push(`${listType}:${index}`); return gbT11Strategy.listItem!(listType, index) } }
    resolve(nestedListDoc([xref('nn2', 'listItem')]), strategy)
    // 第一层：zd-num(number)×3、zd-alpha(alpha)×2、zd-roman(roman)×2；第二层 number：zd-num-num×2、zd-alpha-num×2、zd-dash-num×2
    expect(calls.filter(call => call.startsWith('roman:'))).toEqual(['roman:1', 'roman:2'])
    expect(calls.filter(call => call.startsWith('alpha:'))).toEqual(['alpha:1', 'alpha:2'])
    expect(calls.filter(call => call.startsWith('number:'))).toHaveLength(3 + 2 + 2 + 2)
  })
})

describe('[M-Z-d B] 纯函数', () => {
  it('不修改入参，两次结果深度相等', () => {
    const doc = nestedListDoc([xref('nr2', 'listItem'), xref('nn2', 'listItem'), xref('a2', 'listItem')])
    const before = JSON.stringify(doc)
    const first = resolve(doc)
    expect(resolve(doc)).toEqual(first)
    expect(JSON.stringify(doc)).toBe(before)
  })
})
