/**
 * WP8.2 / T2.3：Resolver xmlId 调整（R-1、R-2、R-4、R-10、R-11）。
 * 依据 docs/wp8.2/design.md §1.4、§3.1；约定编号见 docs/wp8.1/conventions-S.md §2.2（X-xx）。
 */
import { describe, expect, it } from 'vitest'
import { resolve } from '../resolve'
import type { IRBibEntry, IRDoc, IRTable } from '../types'
import { appendix, chapter, docOf, para } from './wp8mG4Fixtures'

describe('[X-09] [R-1] 参考文献条目 xmlId = biblref_<n>', () => {
  const bib = (id: string, text: string): IRBibEntry => ({ kind: 'bibEntry', id, content: [{ text }] })
  const bibRef = (targetId: string) => ({ text: '[?]', marks: [{ type: 'bibRef' as const, targetId }] })

  it('n 取 bibliographyOrder 的位置：先被引用者按首次引用顺序，未被引用者居后', () => {
    const doc: IRDoc = docOf(
      [chapter('c1', 'general', '一般要求', para('p1', { text: '见' }, bibRef('bib-b')))],
      { bibliography: [bib('bib-a', '文献甲'), bib('bib-b', '文献乙'), bib('bib-c', '文献丙')] },
    )
    const { labels, bibliographyOrder, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(bibliographyOrder).toEqual(['bib-b', 'bib-a', 'bib-c'])
    expect(labels['bib-b']).toEqual({ label: '[1]', xmlId: 'biblref_1', refText: '[1]' })
    expect(labels['bib-a']).toEqual({ label: '[2]', xmlId: 'biblref_2', refText: '[2]' })
    expect(labels['bib-c']).toEqual({ label: '[3]', xmlId: 'biblref_3', refText: '[3]' })
  })

  it('旧前缀 bib_ 不再出现在任何 xmlId 中', () => {
    const doc: IRDoc = docOf(
      [chapter('c1', 'general', '一般要求', para('p1', { text: '正文' }))],
      { bibliography: [bib('bib-a', '文献甲'), bib('bib-b', '文献乙')] },
    )
    const xmlIds = Object.values(resolve(doc).labels).map(label => label.xmlId)
    expect(xmlIds.filter(xmlId => xmlId.startsWith('bib_'))).toEqual([])
    expect(xmlIds.filter(xmlId => xmlId.startsWith('biblref_'))).toEqual(['biblref_1', 'biblref_2'])
  })
})

describe('[X-24] [R-2] 表脚注 xmlId = table-fn_<表号>.<k>', () => {
  /** 一张带表脚注的表：refOrder 是单元格里上标的引用顺序（即字母标记的分配顺序），每个脚注 id 为 `<表 id>-fn-<名>` */
  function tableWithFootnotes(id: string, refOrder: string[]): IRTable {
    const fnId = (name: string) => `${id}-fn-${name}`
    return {
      kind: 'table', id, caption: [{ text: '表题' }], orientation: 'portrait', headerRowCount: 0, notes: [],
      rows: [{ id: `${id}-row`, cells: [{
        id: `${id}-cell`, colspan: 1, rowspan: 1, header: false,
        content: [{
          kind: 'paragraph', id: `${id}-p`,
          content: refOrder.map(name => ({ text: name, marks: [{ type: 'tableFootnoteRef' as const, targetId: fnId(name) }] })),
        }],
      }] }],
      footnotes: [...refOrder].sort().map(name => ({ id: fnId(name), content: [{ text: `脚注${name}` }] })),
    }
  }
  const fnId = (tableId: string, name: string) => `${tableId}-fn-${name}`

  it('k 是表内序号：按首次引用顺序 1、2…，与定义顺序无关；表号取表 xmlId 去掉 tab_', () => {
    const doc = docOf([chapter('c1', 'general', '一般要求', tableWithFootnotes('t1', ['y', 'x']))])
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['t1']!.xmlId).toBe('tab_1')
    // 定义顺序 x、y；引用顺序 y、x → y 得 a / .1，x 得 b / .2
    expect(labels[fnId('t1', 'y')]).toEqual({ label: 'a', xmlId: 'table-fn_1.1', refText: 'a' })
    expect(labels[fnId('t1', 'x')]).toEqual({ label: 'b', xmlId: 'table-fn_1.2', refText: 'b' })
  })

  it('k 按表重新计数；附录表带附录字母（table-fn_A.1.1）', () => {
    const doc = docOf(
      [chapter('c1', 'general', '一般要求', tableWithFootnotes('t1', ['p', 'q']), tableWithFootnotes('t2', ['p']))],
      { appendices: [appendix('apx', '附录', tableWithFootnotes('t3', ['p', 'q']))] },
    )
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(['t1', 't2', 't3'].map(id => labels[id]!.xmlId)).toEqual(['tab_1', 'tab_2', 'tab_A.1'])
    expect(labels[fnId('t1', 'q')]!.xmlId).toBe('table-fn_1.2')
    expect(labels[fnId('t2', 'p')]!.xmlId).toBe('table-fn_2.1')
    expect(labels[fnId('t3', 'p')]!.xmlId).toBe('table-fn_A.1.1')
    expect(labels[fnId('t3', 'q')]!.xmlId).toBe('table-fn_A.1.2')
  })

  it('k 与标签字符无关：第 27 个脚注标记为 aa，xmlId 仍是 .27；旧前缀 tabfn_ 不再出现', () => {
    const names = Array.from({ length: 27 }, (_, i) => `n${String(i).padStart(2, '0')}`)
    const doc = docOf([chapter('c1', 'general', '一般要求', tableWithFootnotes('t1', names))])
    const { labels } = resolve(doc)
    expect(labels[fnId('t1', 'n25')]).toMatchObject({ label: 'z', xmlId: 'table-fn_1.26' })
    expect(labels[fnId('t1', 'n26')]).toMatchObject({ label: 'aa', xmlId: 'table-fn_1.27' })
    expect(Object.values(labels).filter(label => label.xmlId.startsWith('tabfn_'))).toEqual([])
  })
})
