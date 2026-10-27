/**
 * WP8.2 / T2.3：Resolver xmlId 调整（R-1、R-2、R-4、R-10、R-11）。
 * 依据 docs/wp8.2/design.md §1.4、§3.1；约定编号见 docs/wp8.1/conventions-S.md §2.2（X-xx）。
 */
import { describe, expect, it } from 'vitest'
import { computeOrderedListMarkers, resolve } from '../resolve'
import { gbT11Strategy } from '../strategies'
import type { IRBibEntry, IRBlock, IRDoc, IRFormula, IRInline, IRTable, NumberingStrategy } from '../types'
import { appendix, chapter, clause, docOf, example, figure, item, list, note, para, table, termEntry, xref } from './wp8mG4Fixtures'

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

describe('[X-13] [R-4] 术语条目内的注 xmlId = nte_<术语编号>-<k>，不占全局 note_<n> 计数', () => {
  const noteOf = (id: string) => note(id, para(`${id}.p`, { text: `注${id}` }))
  const exampleOf = (id: string) => example(id, para(`${id}.p`, { text: `示例${id}` }))

  function termDoc(): IRDoc {
    const nested = termEntry('t1a', { notes: [noteOf('tna1')] })
    return docOf([
      chapter('ch1', 'scope', '范围', para('ch1-p', { text: '范围' }), noteOf('n-before')),
      chapter('ch2', 'norm-refs', '规范性引用文件', para('ch2-p', { text: '无' })),
      chapter('ch3', 'terms', '术语和定义',
        { ...termEntry('t1', { notes: [noteOf('tn1'), noteOf('tn2')], examples: [exampleOf('tx1')] }), nestedEntries: [nested] },
        termEntry('t2', { notes: [noteOf('tn3')], examples: [exampleOf('tx2')] }),
      ),
      chapter('ch4', 'general', '一般要求', para('ch4-p', { text: '正文' }), noteOf('n-after'), exampleOf('ex-after')),
    ])
  }

  it('术语注得到 nte_<术语编号>-<k>：k 为术语内序号，嵌套术语按自己的编号（3.1.1）', () => {
    const { labels, problems } = resolve(termDoc())
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['t1']).toMatchObject({ label: '3.1', xmlId: 'sec_3.1', termEntryXmlId: 'term_3.1' })
    expect(labels['tn1']).toEqual({ label: '注1：', xmlId: 'nte_3.1-1', refText: '注1' })
    expect(labels['tn2']).toEqual({ label: '注2：', xmlId: 'nte_3.1-2', refText: '注2' })
    expect(labels['t1a']).toMatchObject({ label: '3.1.1', termEntryXmlId: 'term_3.1.1' })
    expect(labels['tna1']).toEqual({ label: '注：', xmlId: 'nte_3.1.1-1', refText: '注' })
    expect(labels['tn3']).toEqual({ label: '注：', xmlId: 'nte_3.2-1', refText: '注' })
  })

  it('不占全局 note_<n> 计数（D-X-19）：术语前后其余的注仍是连续的 note_1、note_2', () => {
    const { labels } = resolve(termDoc())
    expect(labels['n-before']!.xmlId).toBe('note_1')
    expect(labels['n-after']!.xmlId).toBe('note_2')
    const noteIds = Object.values(labels).map(label => label.xmlId).filter(xmlId => /^note_/.test(xmlId))
    expect(noteIds).toEqual(['note_1', 'note_2'])
  })

  it('术语内的示例仍是全局 example_<n>（tbx:example 没有 id，渲染器遇到引用才报错）', () => {
    const { labels } = resolve(termDoc())
    expect(['tx1', 'tx2', 'ex-after'].map(id => labels[id]!.xmlId)).toEqual(['example_1', 'example_2', 'example_3'])
    expect(labels['tx1']!.label).toBe('示例：')
  })
})

describe('[M-7.2-02] [R-10] 公式注进入作用域编号：label「注：/注n：」+ note_<n>', () => {
  const formula = (id: string, noteIds: string[]): IRFormula => ({
    kind: 'formula', id, latex: 'x = 1', numbered: true, whereList: [],
    notes: noteIds.map(noteId => ({ id: noteId, content: [{ text: `注 ${noteId}` }] })),
  })

  it('一个公式一个作用域：单条注为“注：”，多条注为“注1：”“注2：”；note_<n> 与其他注共用全局序号（文档序）', () => {
    const doc = docOf([
      chapter('c1', 'general', '一般要求',
        formula('f1', ['fn-a']),
        note('body-note', para('body-note.p', { text: '正文注' })),
        formula('f2', ['fn-b', 'fn-c']),
      ),
    ])
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['fn-a']).toEqual({ label: '注：', xmlId: 'note_1', refText: '注' })
    expect(labels['fn-b']).toEqual({ label: '注1：', xmlId: 'note_3', refText: '注1' })
    expect(labels['fn-c']).toEqual({ label: '注2：', xmlId: 'note_4', refText: '注2' })
    // note_<n> 按作用域首次出现的顺序赋号：f1 的注 → 章 c1 的正文注 → f2 的注
    expect(labels['body-note']).toEqual({ label: '注：', xmlId: 'note_2', refText: '注' })
  })

  it('不再留下 ext_ 占位 xmlId，且被类型化引用的公式注仍是合法目标（无 dangling-typed-ref）', () => {
    const doc = docOf([
      chapter('c1', 'general', '一般要求',
        para('p1', { text: '见', marks: [{ type: 'crossRef', targetId: 'fn-a', targetKind: 'note' }] }),
        formula('f1', ['fn-a']),
      ),
    ])
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.code === 'dangling-typed-ref' || problem.code === 'dangling-xref')).toEqual([])
    expect(labels['fn-a']).toEqual({ label: '注：', xmlId: 'note_1', refText: '注' })
    expect(Object.entries(labels).filter(([, label]) => label.xmlId.startsWith('ext_')).map(([id]) => id)).toEqual([])
  })
})

describe('[M-5.7-09] [R-11] computeOrderedListMarkers：有序列项标记（D-X-08、D-M-17）', () => {
  /** 把块放进一个章，返回全文标记表 */
  const markersOf = (...blocks: IRBlock[]) => computeOrderedListMarkers(docOf([chapter('ch', 'general', '一般要求', ...blocks)]))

  it('一层 alpha / number / roman 有标记（全角右括号），含未被引用的列项', () => {
    const markers = markersOf(
      list('la', 'alpha', [item('a1', '甲'), item('a2', '乙'), item('a3', '丙')]),
      list('ln', 'number', [item('n1', '壹'), item('n2', '贰')]),
      list('lr', 'roman', [item('r1', 'Ⅰ'), item('r2', 'Ⅱ'), item('r3', 'Ⅲ'), item('r4', 'Ⅳ')]),
    )
    expect(markers).toEqual({
      a1: 'a）', a2: 'b）', a3: 'c）', n1: '1）', n2: '2）', r1: 'i）', r2: 'ii）', r3: 'iii）', r4: 'iv）',
    })
  })

  it('二层 number 有标记；二层 alpha / roman 没有（HTML/DOCX 渲染为间隔号）', () => {
    const markers = markersOf(list('outer', 'alpha', [
      item('o1', '外一',
        list('in-n', 'number', [item('in-n1', '一'), item('in-n2', '二')]),
        list('in-a', 'alpha', [item('in-a1', '甲'), item('in-a2', '乙')]),
        list('in-r', 'roman', [item('in-r1', 'Ⅰ')]),
      ),
      item('o2', '外二'),
    ]))
    expect(markers).toEqual({ o1: 'a）', o2: 'b）', 'in-n1': '1）', 'in-n2': '2）' })
    expect(markers['in-a1']).toBeUndefined()
    expect(markers['in-r1']).toBeUndefined()
  })

  it('三层及以下没有标记，即使是 number；无序列项与 romanUpper 也没有', () => {
    const markers = markersOf(
      list('l1', 'number', [item('x1', '一', list('l2', 'number', [item('y1', '二', list('l3', 'number', [item('z1', '三', list('l4', 'number', [item('w1', '四')]))]))]))]),
      ...(['dash', 'dot', 'boxed', 'romanUpper'] as const).map(listType => list(`l-${listType}`, listType, [item(`${listType}-1`, '项'), item(`${listType}-2`, '项')])),
    )
    expect(markers).toEqual({ x1: '1）', y1: '1）' })
  })

  it('无序父列表不产生标记，但仍使子列表成为嵌套列表：其下的 alpha 没有标记，number 有', () => {
    const markers = markersOf(list('dash', 'dash', [
      item('d1', '破折', list('d-alpha', 'alpha', [item('da1', '甲')]), list('d-number', 'number', [item('dn1', '壹')])),
    ]))
    expect(markers).toEqual({ dn1: '1）' })
  })

  it('覆盖文档里所有放块的位置：前言、引言、章/条/附录、注、示例、表（单元格与表注）、图（注与示例）、警告、摘录、术语（定义/注/示例/嵌套）', () => {
    const alpha = (id: string) => list(`l-${id}`, 'alpha', [item(`${id}-a`, '甲'), item(`${id}-b`, '乙')])
    const nested = termEntry('t-nested', { notes: [note('tn-nested', alpha('tnn'))] })
    const entry = {
      ...termEntry('t1', { definition: [para('t1-def', { text: '定义' }), alpha('tdef')], notes: [note('tn1', alpha('tn'))], examples: [example('tx1', alpha('tx'))] }),
      nestedEntries: [nested],
    }
    const doc = docOf([
      chapter('ch1', 'general', '一般要求',
        alpha('ch'),
        clause('c1', 1, '条', alpha('cl'), note('n1', alpha('n')), example('x1', alpha('x')),
          { kind: 'warning', id: 'w1', content: [alpha('w')] }, { kind: 'quote', id: 'q1', content: [alpha('q')] },
          table('tab1', [alpha('cell')], [note('tab-note', alpha('tabn'))]),
          { ...figure('fig1', [note('fig-note', alpha('fign'))]), examples: [example('fig-ex', alpha('figx'))] },
        ),
      ),
      chapter('ch2', 'terms', '术语和定义', entry),
    ], { foreword: [alpha('fw')], appendices: [appendix('apx', '附录', alpha('ap'))] })
    doc.front.introduction = [alpha('intro')]
    doc.front.introductionClauses = [clause('intro-c', 1, '引言条', alpha('introc'))]

    const prefixes = ['fw', 'intro', 'introc', 'ch', 'cl', 'n', 'x', 'w', 'q', 'cell', 'tabn', 'fign', 'figx', 'tdef', 'tn', 'tx', 'tnn', 'ap']
    const markers = computeOrderedListMarkers(doc)
    expect(Object.keys(markers).sort()).toEqual(prefixes.flatMap(prefix => [`${prefix}-a`, `${prefix}-b`]).sort())
    expect(prefixes.flatMap(prefix => [markers[`${prefix}-a`], markers[`${prefix}-b`]])).toEqual(prefixes.flatMap(() => ['a）', 'b）']))
  })

  it('与 resolve() 的 labels 一致：被引用时 label === 标记；不在结果里的项被引用 → dangling-xref 且无 label', () => {
    const refAll = (ids: string[]): IRInline[] => ids.map(id => xref(id))
    const withMarker = ['a1', 'a2', 'n1', 'in1']
    const withoutMarker = ['d1', 'u1', 'ia1', 'deep1']
    const doc = docOf([chapter('ch', 'general', '一般要求', clause('c1', 1, '条',
      para('refs', ...refAll([...withMarker, ...withoutMarker])),
      list('la', 'alpha', [item('a1', '甲', list('l-in', 'number', [item('in1', '内')]), list('l-ia', 'alpha', [item('ia1', '内甲', list('l-deep', 'number', [item('deep1', '深')]))])), item('a2', '乙')]),
      list('ln', 'number', [item('n1', '壹')]),
      list('ld', 'dash', [item('d1', '一')]),
      list('lu', 'romanUpper', [item('u1', 'Ⅴ')]),
    ))])
    const markers = computeOrderedListMarkers(doc)
    const { labels, problems } = resolve(doc)
    for (const id of withMarker) {
      expect(markers[id], id).toBeTruthy()
      expect(labels[id]?.label, id).toBe(markers[id])
    }
    for (const id of withoutMarker) {
      expect(markers[id], id).toBeUndefined()
      expect(labels[id], id).toBeUndefined()
      expect(problems.some(problem => problem.code === 'dangling-xref' && problem.message.includes(`「${id}」`)), id).toBe(true)
    }
  })

  it('labels 内容不变：未被引用的列项仍没有 label，只有被引用者获得 li_<k>', () => {
    const doc = docOf([chapter('ch', 'general', '一般要求', clause('c1', 1, '条',
      para('refs', xref('a2')),
      list('la', 'alpha', [item('a1', '甲'), item('a2', '乙'), item('a3', '丙')]),
    ))])
    expect(Object.keys(computeOrderedListMarkers(doc)).sort()).toEqual(['a1', 'a2', 'a3'])
    const { labels } = resolve(doc)
    expect(labels['a1']).toBeUndefined()
    expect(labels['a3']).toBeUndefined()
    expect(labels['a2']).toEqual({ label: 'b）', xmlId: 'li_1', refText: '1.1 b）' })
  })

  it('策略：默认 gbT11Strategy；自定义 listItem 策略同时作用于函数与 resolve()；省略 listItem 时回退内置规则', () => {
    const doc = docOf([chapter('ch', 'general', '一般要求', clause('c1', 1, '条',
      para('refs', xref('a2')),
      list('la', 'alpha', [item('a1', '甲'), item('a2', '乙')]),
    ))])
    expect(computeOrderedListMarkers(doc)).toEqual(computeOrderedListMarkers(doc, gbT11Strategy))
    const custom: NumberingStrategy = { ...gbT11Strategy, listItem: (listType, ordinal) => `(${listType}${ordinal})` }
    expect(computeOrderedListMarkers(doc, custom)).toEqual({ a1: '(alpha1)', a2: '(alpha2)' })
    expect(resolve(doc, custom).labels['a2']).toMatchObject({ label: '(alpha2)', refText: '1.1 (alpha2)' })
    const { listItem: _omitted, ...withoutListItem } = gbT11Strategy
    expect(computeOrderedListMarkers(doc, withoutListItem as NumberingStrategy)).toEqual({ a1: 'a）', a2: 'b）' })
    // 自定义策略返回空串 = 该项没有标记
    const blank: NumberingStrategy = { ...gbT11Strategy, listItem: (_listType, ordinal) => (ordinal === 1 ? '' : 'x') }
    expect(computeOrderedListMarkers(doc, blank)).toEqual({ a2: 'x' })
  })

  it('纯函数：不修改入参，同一输入两次结果深度相等；无列表的文档返回空表', () => {
    const doc = docOf([chapter('ch', 'general', '一般要求', list('la', 'alpha', [item('a1', '甲')]), para('p', { text: '正文' }))])
    const before = JSON.stringify(doc)
    expect(computeOrderedListMarkers(doc)).toEqual(computeOrderedListMarkers(doc))
    expect(JSON.stringify(doc)).toBe(before)
    expect(computeOrderedListMarkers(docOf([chapter('ch', 'general', '一般要求', para('p', { text: '正文' }))]))).toEqual({})
  })
})
