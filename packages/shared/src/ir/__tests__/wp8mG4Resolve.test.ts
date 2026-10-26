import { describe, expect, it } from 'vitest'
import { resolve } from '../resolve'
import { gbT11Strategy, listItem } from '../strategies'
import type { IRBibEntry, IRDoc, NumberingStrategy } from '../types'
import {
  appendix, chapter, clause, clause52, docOf, example, figure, item, list, listItemDoc, note, para, table, termEntry, xref,
} from './wp8mG4Fixtures'

const problemCodes = (doc: IRDoc) => resolve(doc).problems.map(problem => `${problem.code}|${problem.nodeId}`)
const extLabels = (doc: IRDoc) => Object.entries(resolve(doc).labels).filter(([, label]) => label.xmlId.startsWith('ext_')).map(([id]) => id)

describe('[M-10.1.5-02] gbT11Strategy.listItem：列项标记（全角右括号，D-M-03 修订）', () => {
  it('alpha：a）…z），27 起逐位进位 aa） ab）', () => {
    expect(gbT11Strategy.listItem!('alpha', 1)).toBe('a）')
    expect(gbT11Strategy.listItem!('alpha', 3)).toBe('c）')
    expect(gbT11Strategy.listItem!('alpha', 26)).toBe('z）')
    expect(gbT11Strategy.listItem!('alpha', 27)).toBe('aa）')
    expect(gbT11Strategy.listItem!('alpha', 28)).toBe('ab）')
    expect(gbT11Strategy.listItem!('alpha', 52)).toBe('az）')
    expect(gbT11Strategy.listItem!('alpha', 53)).toBe('ba）')
  })

  it('number：1） 2） …', () => {
    expect(gbT11Strategy.listItem!('number', 1)).toBe('1）')
    expect(gbT11Strategy.listItem!('number', 12)).toBe('12）')
  })

  it('roman：i） ii） iii） iv） …（小写）', () => {
    const marks = [1, 2, 3, 4, 5, 9, 14, 19, 40, 49, 90, 400, 1994].map(n => listItem('roman', n))
    expect(marks).toEqual(['i）', 'ii）', 'iii）', 'iv）', 'v）', 'ix）', 'xiv）', 'xix）', 'xl）', 'xlix）', 'xc）', 'cd）', 'mcmxciv）'])
    expect(listItem('roman', 4000)).toBe('4000）')
  })

  it('无序列项与 romanUpper 没有标记', () => {
    for (const listType of ['dash', 'dot', 'boxed', 'romanUpper'] as const) expect(gbT11Strategy.listItem!(listType, 1)).toBe('')
  })
})

describe('[M-10.1.5-01] [M-10.1.5-02] Resolver：被引用的有序列项获得标签', () => {
  it('5.2 条下引用 alpha 列表第 3 项：label=c）、refText=5.2 c）、xmlId=li_1', () => {
    const doc = listItemDoc([xref('a3', 'listItem')])
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['c52']?.label).toBe('5.2')
    expect(labels['a3']).toEqual({ label: 'c）', xmlId: 'li_1', refText: '5.2 c）' })
  })

  it('未被引用的列项没有标签（含同一列表的其余项、列表自身、列项内的段落）', () => {
    const { labels } = resolve(listItemDoc([xref('a3', 'listItem')]))
    for (const id of ['a1', 'a2', 'l-alpha', 'a1.p0', 'a3.p0', 'n1', 'r1', 'd1']) expect(labels[id], id).toBeUndefined()
  })

  it('没有任何引用时整篇文档不产生 li_ 标签，也没有 ext_ 占位', () => {
    const { labels, problems } = resolve(listItemDoc())
    expect(Object.values(labels).filter(label => label.xmlId.startsWith('li_'))).toEqual([])
    expect(extLabels(listItemDoc())).toEqual([])
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  it('无类型 crossRef（旧稿形态）同样触发标签；重复引用同一项只给一个 xmlId', () => {
    const doc = listItemDoc([xref('a2'), xref('a2', 'listItem')])
    const { labels } = resolve(doc)
    expect(labels['a2']).toEqual({ label: 'b）', xmlId: 'li_1', refText: '5.2 b）' })
    expect(Object.values(labels).filter(label => label.xmlId.startsWith('li_'))).toHaveLength(1)
  })

  it('li_<k> 的 k 按被引用列项在文档中的先后，而不是按引用出现的先后', () => {
    const doc = listItemDoc([xref('n2', 'listItem'), xref('a3', 'listItem'), xref('a1', 'listItem')])
    const { labels } = resolve(doc)
    expect(labels['a1']?.xmlId).toBe('li_1')
    expect(labels['a3']?.xmlId).toBe('li_2')
    expect(labels['n2']?.xmlId).toBe('li_3')
    expect(labels['n2']?.refText).toBe('5.2 2）')
  })

  it('number 与 roman 列表：1） 与 iv）（IR 原生，PM 侧罗马支持属 G7）', () => {
    const { labels, problems } = resolve(listItemDoc([xref('n3', 'listItem'), xref('r4', 'listItem')]))
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['n3']).toEqual({ label: '3）', xmlId: 'li_1', refText: '5.2 3）' })
    expect(labels['r4']).toEqual({ label: 'iv）', xmlId: 'li_2', refText: '5.2 iv）' })
  })

  it('嵌套列表：标记路径 a） 1），无序祖先不贡献标记', () => {
    const nested = list('l-outer', 'alpha', [
      item('o1', '外一'),
      item('o2', '外二', list('l-inner', 'number', [item('i1', '内一'), item('i2', '内二')], 2)),
    ])
    const dashOuter = list('l-dash-outer', 'dash', [
      item('x1', '破折', list('l-alpha-in-dash', 'alpha', [item('y1', '甲'), item('y2', '乙')])),
    ])
    const doc = docOf([chapter('ch5', 'general', '技术要求',
      clause('c1', 1, '嵌套',
        para('p', { text: '见' }, xref('i2', 'listItem'), xref('y2', 'listItem'), xref('o1', 'listItem')),
        nested, dashOuter),
    )])
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['i2']).toMatchObject({ label: '2）', refText: '1.1 b） 2）' })
    expect(labels['y2']).toMatchObject({ label: 'b）', refText: '1.1 b）' })
    expect(labels['o1']).toMatchObject({ label: 'a）', refText: '1.1 a）' })
    // 文档序：o1、i2、y2
    expect(['o1', 'i2', 'y2'].map(id => labels[id]?.xmlId)).toEqual(['li_1', 'li_2', 'li_3'])
    expect(labels['i1']).toBeUndefined()
  })

  it('容器编号：章直属列表、附录、前言（无编号）', () => {
    const doc = listItemDoc(
      [xref('ch1-b', 'listItem'), xref('ap-b', 'listItem'), xref('fw-b', 'listItem')],
      {
        ch1: [list('ch1-list', 'alpha', [item('ch1-a', '甲'), item('ch1-b', '乙')])],
        foreword: [list('fw-list', 'alpha', [item('fw-a', '甲'), item('fw-b', '乙')])],
        appendices: [appendix('apx', '附录标题', list('ap-list', 'alpha', [item('ap-a', '甲'), item('ap-b', '乙')]))],
      },
    )
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.code === 'dangling-xref' || problem.code === 'dangling-typed-ref')).toEqual([])
    expect(labels['ch1-b']?.refText).toBe('1 b）')
    expect(labels['ap-b']?.refText).toBe('附录A b）')
    expect(labels['fw-b']?.refText).toBe('b）')
    expect(labels['fw-b']?.label).toBe('b）')
    // 文档序：前言先于正文，正文先于附录
    expect(['fw-b', 'ch1-b', 'ap-b'].map(id => labels[id]?.xmlId)).toEqual(['li_1', 'li_2', 'li_3'])
  })

  it('参考文献与索引里的引用同样计入（先于 checkTypedReferences，不出现 ext_）', () => {
    const bib: IRBibEntry = { kind: 'bibEntry', id: 'bib1', content: [{ text: '文献' }, xref('a2', 'listItem')] }
    const doc = listItemDoc()
    doc.bibliography = [bib]
    doc.index = { id: 'idx', groups: [{ id: 'idx-g', entries: [{ id: 'idx-e', term: [xref('a3', 'listItem')], targets: [] }] }] }
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['a2']?.xmlId).toBe('li_1')
    expect(labels['a3']?.xmlId).toBe('li_2')
    // 索引实体自己的 ext_ 占位是既有行为；列项不应出现
    expect(extLabels(doc)).toEqual(['idx', 'idx-g', 'idx-e'])
  })

  it('脚注内的引用也计入', () => {
    const doc = listItemDoc([{ text: '脚注', footnote: { id: 'fn1', content: [xref('a1', 'listItem')] } }])
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['a1']?.refText).toBe('5.2 a）')
  })

  it('纯函数：不修改入参，两次结果深度相等', () => {
    const doc = listItemDoc([xref('a3', 'listItem'), xref('r2', 'listItem')])
    const before = JSON.stringify(doc)
    const first = resolve(doc)
    expect(resolve(doc)).toEqual(first)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('[M-10.1.5-01] 无序列项与 romanUpper 不赋标签，引用照旧 dangling-xref', () => {
  it.each([
    ['dash', 'd2'],
    ['romanUpper', 'u1'],
  ])('指向 %s 列项（带类型）：dangling-xref，且没有 ext_ 占位标签', (_type, id) => {
    const doc = listItemDoc([xref(id, 'listItem')])
    const { labels, problems } = resolve(doc)
    expect(labels[id]).toBeUndefined()
    expect(problems.filter(problem => problem.code === 'dangling-xref')).toEqual([
      expect.objectContaining({ nodeId: 'c52-ref', severity: 'error', message: expect.stringContaining('没有编号') }),
    ])
    expect(problems.some(problem => problem.code === 'dangling-typed-ref')).toBe(false)
    expect(extLabels(doc)).toEqual([])
  })

  it('指向无序列项（无类型）同样 dangling-xref', () => {
    expect(problemCodes(listItemDoc([xref('d1')]))).toEqual(['dangling-xref|c52-ref'])
  })

  it('dot 与 boxed 同样不编号', () => {
    const doc = docOf([chapter('ch5', 'general', '技术要求', clause('c1', 1, '条',
      para('p', xref('dot1', 'listItem'), xref('box1', 'listItem')),
      list('l-dot', 'dot', [item('dot1', '点')], 2),
      list('l-box', 'boxed', [item('box1', '框')]),
    ))])
    expect(problemCodes(doc)).toEqual(['dangling-xref|p', 'dangling-xref|p'])
  })
})

describe('[M-10.1.5-01] targetKind=listItem 的类型检查', () => {
  it('指向非列项（条、列表块、列项内的段落）：dangling-typed-ref', () => {
    const doc = listItemDoc([xref('c51', 'listItem'), xref('l-alpha', 'listItem'), xref('a1.p0', 'listItem')])
    const typed = resolve(doc).problems.filter(problem => problem.code === 'dangling-typed-ref')
    expect(typed).toHaveLength(3)
    expect(typed.map(problem => problem.message)).toEqual([
      expect.stringContaining('应为 listItem，实际为 clause'),
      expect.stringContaining('应为 listItem，实际为 list'),
      expect.stringContaining('应为 listItem，实际为 paragraph'),
    ])
  })

  it('指向列项的其他 targetKind（paragraph）：dangling-typed-ref', () => {
    const typed = resolve(listItemDoc([xref('a1', 'paragraph')])).problems.filter(problem => problem.code === 'dangling-typed-ref')
    expect(typed).toEqual([expect.objectContaining({ message: expect.stringContaining('应为 paragraph，实际为 listItem') })])
  })

  it('目标不存在：只报 dangling-xref，不重复报类型错误', () => {
    expect(problemCodes(listItemDoc([xref('missing', 'listItem')]))).toEqual(['dangling-xref|c52-ref'])
  })
})

describe('[M-10.1.5-02] NumberingStrategy.listItem 可选', () => {
  const withoutListItem: NumberingStrategy = (() => {
    const { listItem: _omitted, ...rest } = gbT11Strategy
    return rest
  })()

  it('第三方策略缺该方法时用内置同款函数', () => {
    expect(withoutListItem.listItem).toBeUndefined()
    const { labels } = resolve(listItemDoc([xref('a3', 'listItem')]), withoutListItem)
    expect(labels['a3']).toEqual({ label: 'c）', xmlId: 'li_1', refText: '5.2 c）' })
  })

  it('策略实现的 listItem 优先；返回空串表示该类型不编号', () => {
    const custom: NumberingStrategy = {
      ...gbT11Strategy,
      listItem: (listType, index) => (listType === 'alpha' ? `（${index}）` : ''),
    }
    const { labels, problems } = resolve(listItemDoc([xref('a2', 'listItem'), xref('n1', 'listItem')]), custom)
    expect(labels['a2']).toEqual({ label: '（2）', xmlId: 'li_1', refText: '5.2 （2）' })
    expect(labels['n1']).toBeUndefined()
    expect(problems.filter(problem => problem.code === 'dangling-xref')).toHaveLength(1)
  })
})

describe('列表自身的登记', () => {
  it('列项 id 重复仍报 duplicate-id', () => {
    const doc = listItemDoc([xref('a1', 'listItem')], { extra: [list('l-dup', 'alpha', [item('a1', '重复')])] })
    expect(resolve(doc).problems.some(problem => problem.code === 'duplicate-id' && problem.nodeId === 'a1')).toBe(true)
  })

  it('clause52 夹具的其余引用不产生问题（对照）', () => {
    expect(resolve(docOf([chapter('ch5', 'general', '技术要求', clause('c1', 1, '条', ...clause52().children))])).problems
      .filter(problem => problem.severity === 'error')).toEqual([])
  })
})

describe('[M-10.1.5-02] 无编号作用域内的列表：refText 回溯到最近的有编号祖先', () => {
  const alpha = (prefix: string) => list(`${prefix}-list`, 'alpha', [item(`${prefix}-a`, '甲'), item(`${prefix}-b`, '乙')])
  const refs = (...ids: string[]) => para('refs', ...ids.map(id => xref(id, 'listItem')))
  const errors = (doc: IRDoc) => resolve(doc).problems.filter(problem => problem.severity === 'error')

  it('条 1.2 里的注与示例内的列项 → 1.2 a）、1.2 b）；注自身的编号不受影响', () => {
    const doc = docOf([chapter('ch5', 'general', '技术要求',
      clause('c51', 1, '前一条', para('c51-p', { text: '正文' })),
      clause('c52', 1, '列项条',
        refs('n-a', 'x-b'),
        note('n1', para('n1-p', { text: '注文' }), alpha('n')),
        example('x1', para('x1-p', { text: '示例文' }), alpha('x')),
      ),
    )])
    const { labels } = resolve(doc)
    expect(errors(doc)).toEqual([])
    expect(labels['c52']?.label).toBe('1.2')
    expect(labels['n-a']).toEqual({ label: 'a）', xmlId: 'li_1', refText: '1.2 a）' })
    expect(labels['x-b']).toEqual({ label: 'b）', xmlId: 'li_2', refText: '1.2 b）' })
    expect(labels['n1']?.label).toBe('注：')
    expect(labels['x1']?.label).toBe('示例：')
  })

  it('章直属的注、附录内的注 → 1 a）、附录A a）', () => {
    const doc = docOf(
      [chapter('ch1', 'general', '一般要求', refs('n-b', 'ap-b'), note('n1', alpha('n')))],
      { appendices: [appendix('apx', '附录标题', note('ap-n', alpha('ap')))] },
    )
    const { labels } = resolve(doc)
    expect(errors(doc)).toEqual([])
    expect(labels['n-b']?.refText).toBe('1 b）')
    expect(labels['ap-b']?.refText).toBe('附录A b）')
  })

  it('术语条目内的注与示例 → 3.1 a）；嵌套术语条目取自己的编号', () => {
    const nested = termEntry('t-nested', { notes: [note('tn2', alpha('tn2'))] })
    const entry = { ...termEntry('t1', { notes: [note('tn1', alpha('tn1'))], examples: [example('tx1', alpha('tx1'))] }), nestedEntries: [nested] }
    const doc = docOf([
      chapter('ch1', 'general', '一般要求', para('p1', { text: '引导' })),
      chapter('ch2', 'general', '章二', para('p2', { text: '正文' })),
      chapter('ch3', 'terms', '术语和定义', para('refs', xref('tn1-a', 'listItem'), xref('tx1-b', 'listItem'), xref('tn2-b', 'listItem')), entry),
    ])
    const { labels } = resolve(doc)
    expect(errors(doc)).toEqual([])
    expect(labels['t1']?.label).toBe('3.1')
    expect(labels['tn1-a']?.refText).toBe('3.1 a）')
    expect(labels['tx1-b']?.refText).toBe('3.1 b）')
    expect(labels['t-nested']?.label).toBe('3.1.1')
    expect(labels['tn2-b']?.refText).toBe('3.1.1 b）')
  })

  it('表内列表保持 表1 a）；表注内的列表同样落在 表1；图注内的列表落在 图1', () => {
    const doc = docOf([chapter('ch5', 'general', '技术要求', clause('c52', 1, '列项条',
      refs('cell-b', 'tn-a', 'fn-b'),
      table('tab1', [alpha('cell')], [note('tab-note', alpha('tn'))]),
      figure('fig1', [note('fig-note', alpha('fn'))]),
    ))])
    const { labels } = resolve(doc)
    expect(errors(doc)).toEqual([])
    expect(labels['tab1']?.label).toBe('表1')
    expect(labels['cell-b']?.refText).toBe('表1 b）')
    expect(labels['tn-a']?.refText).toBe('表1 a）')
    expect(labels['fig1']?.label).toBe('图1')
    expect(labels['fn-b']?.refText).toBe('图1 b）')
  })

  it('前言里的注没有任何编号祖先：只写标记路径（含前言直属列表）', () => {
    const doc = listItemDoc([xref('fw-n-b', 'listItem'), xref('fw-b', 'listItem')], {
      foreword: [list('fw-l', 'alpha', [item('fw-a', '甲'), item('fw-b', '乙')]), note('fw-note', alpha('fw-n'))],
    })
    const { labels } = resolve(doc)
    expect(errors(doc)).toEqual([])
    expect(labels['fw-n-b']?.refText).toBe('b）')
    expect(labels['fw-b']?.refText).toBe('b）')
  })

  it('注套注、示例套注：沿父链一直回溯到条', () => {
    const doc = docOf([chapter('ch5', 'general', '技术要求', clause('c1', 1, '条',
      refs('deep-a'),
      example('x1', note('inner-note', alpha('deep'))),
    ))])
    const { labels } = resolve(doc)
    expect(errors(doc)).toEqual([])
    expect(labels['deep-a']?.refText).toBe('1.1 a）')
  })
})
