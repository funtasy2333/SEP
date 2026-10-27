/**
 * WP8.2 / T2.3：Resolver xmlId 调整（R-1、R-2、R-4、R-10、R-11）。
 * 依据 docs/wp8.2/design.md §1.4、§3.1；约定编号见 docs/wp8.1/conventions-S.md §2.2（X-xx）。
 */
import { describe, expect, it } from 'vitest'
import { resolve } from '../resolve'
import type { IRBibEntry, IRDoc } from '../types'
import { chapter, docOf, para } from './wp8mG4Fixtures'

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
