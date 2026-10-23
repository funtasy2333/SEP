import { describe, expect, it } from 'vitest'
import { analyzeDocument } from './analyze'
import { createParagraphDocument } from './__fixtures__/documents'
import type { IRBlock, IRChapter, IRDoc, IRInline, IRParagraph, IRTermEntry } from '../ir/types'

const p = (id: string, value: string | IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content: typeof value === 'string' ? [{ text: value }] : value })
const figure = (id: string): IRBlock => ({ kind: 'figure', id, src: 'data:image/png;base64,a', orientation: 'portrait', caption: [{ text: '结构' }], notes: [] })
function document(children: IRBlock[]): IRDoc {
  const doc = createParagraphDocument(0)
  doc.body[0]!.children = children
  return doc
}
const term = (id: string, name: string): IRTermEntry => ({ kind: 'termEntry', id, term: [{ text: name }], definition: [p(`${id}-definition`, '定义。')], notes: [], examples: [] })
function withTerms(doc: IRDoc, entries: IRTermEntry[]) {
  const chapter: IRChapter = { kind: 'chapter', id: 'terms', secType: 'terms', title: [{ text: '术语和定义' }], children: entries }
  doc.body.unshift(chapter)
  return doc
}

describe('independent shared review regressions', () => {
  it('preserves two distinct dangling targets in one source paragraph', () => {
    const doc = document([p('broken', [
      { text: '第一处', marks: [{ type: 'crossRef', targetId: 'missing-one' }] },
      { text: '第二处', marks: [{ type: 'crossRef', targetId: 'missing-two' }] },
    ])])
    const analysis = analyzeDocument(doc)
    expect(analysis.resolution.problems.filter(item => item.code === 'dangling-xref')).toHaveLength(2)
    const issues = analysis.validation.issues.filter(item => item.ruleId === 'reference.dangling')
    expect(issues).toHaveLength(2)
    expect(new Set(issues.map(item => item.id)).size).toBe(2)
  })

  it('does not treat a second external-document figure in an enumeration as a local mention', () => {
    const doc = document([p('external', '结构采用GB/T 123—2020中的图1和图2。'), figure('f1'), figure('f2')])
    const issues = analyzeDocument(doc).validation.issues.filter(item => item.ruleId === 'object.introduction-and-mention')
    expect(issues.map(item => item.nodeId)).toEqual(['f1', 'f2'])
    expect(issues.every(item => item.message.includes('正文未提及'))).toBe(true)
  })

  it('accepts an explicit local figure mention after the external sentence has ended', () => {
    const doc = document([p('mixed', '采用GB/T 123—2020中的图2。结构见图1。'), figure('f1')])
    expect(analyzeDocument(doc).validation.issues.filter(item => item.ruleId === 'object.introduction-and-mention')).toEqual([])
  })

  it('does not credit an ambiguous parenthesized external figure source as a local mention', () => {
    const doc = document([p('source', '结构见图1（GB/T 123—2020）。'), figure('f1')])
    expect(analyzeDocument(doc).validation.issues.find(item => item.nodeId === 'f1')).toEqual(expect.objectContaining({ message: expect.stringContaining('正文未提及') }))
  })

  it('checks a supported nested list introduction inside a list item', () => {
    const doc = document([{ kind: 'list', id: 'outer', listType: 'dash', items: [{ id: 'item', content: [
      { kind: 'list', id: 'nested-list', listType: 'dot', items: [{ id: 'nested-item', content: [p('nested-p', '内容。')] }] },
    ] }] }])
    expect(analyzeDocument(doc).validation.issues.find(item => item.ruleId === 'list.introduction' && item.nodeId === 'nested-list')).toBeDefined()
  })

  it('does not let nested list text inside a table count as that table’s outside mention', () => {
    const doc = document([{ kind: 'table', id: 'self-table', caption: [{ text: '数据' }], orientation: 'portrait', headerRowCount: 0, notes: [], rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [
      { kind: 'list', id: 'cell-list', listType: 'dash', items: [{ id: 'cell-item', content: [p('self', '信息见表1。')] }] },
    ] }] }] }])
    expect(analyzeDocument(doc).validation.issues.find(item => item.nodeId === 'self-table')).toEqual(expect.objectContaining({ message: expect.stringContaining('正文未提及') }))
  })

  it('does not silently pass distinct same-name definitions on ambiguous literal occurrences', () => {
    const doc = withTerms(document([p('uses', '系统。系统。')]), [term('t1', '系统'), term('t2', '系统')])
    const issues = analyzeDocument(doc).validation.issues
    expect(issues.filter(item => item.ruleId === 'coverage.term-name-ambiguous').map(item => item.nodeId)).toEqual(['t1', 't2'])
  })

  it('uses normalized English boundaries without counting fullwidth word substrings', () => {
    const doc = withTerms(document([p('uses', 'ＸＡＰＩ ＡＰＩｘ')]), [term('api', 'API')])
    expect(analyzeDocument(doc).validation.issues.find(item => item.ruleId === 'term.minimum-usage')).toMatchObject({ count: 0 })
  })

  it('does not erase English word separators to invent a term occurrence', () => {
    const doc = withTerms(document([p('uses', 'A PI A PI')]), [term('api', 'API')])
    expect(analyzeDocument(doc).validation.issues.find(item => item.ruleId === 'term.minimum-usage')).toMatchObject({ count: 0 })
  })

  it('keeps whitespace between a figure number and following English prose', () => {
    const doc = document([p('lead', '结构见图1 API接口。'), figure('f1')])
    expect(analyzeDocument(doc).validation.issues.filter(item => item.ruleId === 'object.introduction-and-mention')).toEqual([])
  })

  it('does not count inline code and does not glue text across a skipped code run', () => {
    const doc = withTerms(document([p('code', [
      { text: '阀门', marks: [{ type: 'code' }] }, { text: '阀门', marks: [{ type: 'code' }] },
      { text: '阀' }, { text: 'not prose', marks: [{ type: 'code' }] }, { text: '门' },
    ])]), [term('valve', '阀门')])
    expect(analyzeDocument(doc).validation.issues.find(item => item.ruleId === 'term.minimum-usage')).toMatchObject({ count: 0 })
  })

  it('indexes numbered figures and lists inside supported warning blocks', () => {
    const doc = document([{ kind: 'warning', id: 'warning', content: [figure('nested'), { kind: 'list', id: 'list', listType: 'dash', items: [{ id: 'item', content: [p('item-p', '内容。')] }] }] }])
    const report = analyzeDocument(doc).validation
    expect(report.issues.find(item => item.nodeId === 'nested' && item.ruleId === 'object.introduction-and-mention')).toBeDefined()
    expect(report.issues.find(item => item.nodeId === 'list' && item.ruleId === 'list.introduction')).toBeDefined()
  })

  it('recognizes actual introduction and mention for nested warning figure', () => {
    const doc = document([{ kind: 'warning', id: 'warning', content: [p('lead', '结构见图1。'), figure('nested')] }])
    expect(analyzeDocument(doc).validation.issues.filter(item => item.ruleId === 'object.introduction-and-mention')).toEqual([])
  })

  it('orders same-severity body issues before appendix issues', () => {
    const doc = document([figure('body-figure')])
    doc.appendices.push({ kind: 'appendix', id: 'app', normative: false, title: [{ text: '说明' }], children: [p('app-p', '说明。')] })
    const issues = analyzeDocument(doc).validation.issues.filter(issue => issue.category === 'mentions')
    expect(issues.map(issue => issue.nodeId)).toEqual(['body-figure', 'app'])
  })
})
