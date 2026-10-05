import { describe, expect, it } from 'vitest'
import { MISSING_ID_PREFIX, parseWhereList, pmToIr } from '../pmToIr'
import type {
  IRChapter,
  IRClause,
  IRFigure,
  IRFormula,
  IRList,
  IRNote,
  IRCodeBlock,
  IRParagraph,
  IRTable,
  IRTermEntry,
} from '../types'
import * as fx from './fixtures'

describe('pmToIr / 元数据', () => {
  it('standardDoc attrs 映射为 IRDocMeta，national→gb，issuer 取自 coverPage', () => {
    const { doc, warnings } = pmToIr(fx.fullFixture())
    expect(doc.meta).toEqual({
      standardType: 'gb',
      title: '标准化文件编辑系统',
      titleEn: 'Standardization document editing system',
      stdCode: 'GB/T 12345—2026',
      icsCode: '35.240',
      ccsCode: 'L 70',
      publishDate: '2026-06-01',
      implementDate: '2026-12-01',
      issuer: '国家市场监督管理总局',
    })
    expect(warnings).toEqual([])
  })

  it('未知 standardType 回退为 gb 并产生警告', () => {
    const { doc, warnings } = pmToIr(fx.standardDoc({ standardType: 'weird' }))
    expect(doc.meta.standardType).toBe('gb')
    expect(warnings.some((w) => w.includes('weird'))).toBe(true)
  })

  it('文档库口径 guidance 映射为 IR 口径 guide，不再报警告（WP7.1 修复）', () => {
    const { doc, warnings } = pmToIr(fx.standardDoc({ standardType: 'guidance' }))
    expect(doc.meta.standardType).toBe('guide')
    expect(warnings).toEqual([])
  })

  it('新增封面字段优先取 coverPage attrs，空值回退 root attrs', () => {
    const { doc, warnings } = pmToIr(fx.standardDoc(
      {
        standardType: 'national',
        replaces: 'ROOT replace',
        consistency: 'ROOT consistency',
        filingNo: 'ROOT filing',
        industryName: 'ROOT industry',
        regionName: 'ROOT region',
        coverDesignation: 'ROOT designation',
      },
      {
        type: 'coverPage',
        attrs: {
          replaces: 'COVER replace',
          consistency: '',
          filingNo: 'COVER filing',
          industryName: '',
          regionName: 'COVER region',
          coverDesignation: 'COVER designation',
        },
        content: [],
      },
    ))

    expect(doc.meta).toMatchObject({
      replaces: 'COVER replace',
      consistency: 'ROOT consistency',
      filingNo: 'COVER filing',
      industryName: 'ROOT industry',
      regionName: 'COVER region',
      coverDesignation: 'COVER designation',
    })
    expect(warnings).toEqual([])
  })

  it('无 coverPage 时仍兼容从 root attrs 读取新增封面字段', () => {
    const { doc } = pmToIr(fx.standardDoc({
      standardType: 'national',
      replaces: 'ROOT replace',
      consistency: 'ROOT consistency',
      filingNo: 'ROOT filing',
      industryName: 'ROOT industry',
      regionName: 'ROOT region',
      coverDesignation: 'ROOT designation',
    }))

    expect(doc.meta).toMatchObject({
      replaces: 'ROOT replace',
      consistency: 'ROOT consistency',
      filingNo: 'ROOT filing',
      industryName: 'ROOT industry',
      regionName: 'ROOT region',
      coverDesignation: 'ROOT designation',
    })
  })

  it('新增封面字段缺失或为空时不写入 IR', () => {
    const { doc } = pmToIr(fx.standardDoc(
      {},
      {
        type: 'coverPage',
        attrs: {
          replaces: '',
          consistency: '',
          filingNo: '',
          industryName: '',
          regionName: '',
          coverDesignation: '',
        },
        content: [],
      },
    ))

    for (const key of ['replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation'] as const) {
      expect(key in doc.meta).toBe(false)
    }
  })

  it('standardType="constructor" 回落为 gb 并报警告，不把原型链上的函数写进 IR（审查第 1 条）', () => {
    const { doc, warnings } = pmToIr(fx.standardDoc({ standardType: 'constructor' }))
    expect(doc.meta.standardType).toBe('gb')
    expect(warnings.some((w) => w.includes('constructor'))).toBe(true)
    // 不变式 4：IR 必须可 JSON 往返无损——原实现会在这里丢失 standardType 这个键
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  })
})

describe('pmToIr / 结构', () => {
  it('前言、引言进入 front，章进入 body', () => {
    const { doc } = pmToIr(fx.fullFixture())
    expect(doc.front.foreword.length).toBe(2)
    expect(doc.front.introduction.length).toBe(1)
    expect(doc.body.map((c) => c.id)).toEqual(['ch-scope', 'ch-refs', 'ch-terms', 'ch-4'])
    expect(doc.appendices.map((a) => a.id)).toEqual(['app-a', 'app-b'])
    expect(doc.bibliography.map((b) => b.id)).toEqual(['bib-1', 'bib-2'])
  })

  it('章 secType 按标题识别：范围/规范性引用文件/术语和定义/一般', () => {
    const { doc } = pmToIr(fx.fullFixture())
    expect(doc.body.map((c) => c.secType)).toEqual(['scope', 'norm-refs', 'terms', 'general'])
  })

  it('条转换：level、titled 与嵌套；无题条 title 为空数组', () => {
    const { doc } = pmToIr(fx.fullFixture())
    const ch4 = doc.body[3]
    const cl42 = ch4.children[1] as IRClause
    expect(cl42.kind).toBe('clause')
    expect(cl42.level).toBe(1)
    expect(cl42.titled).toBe(true)
    const cl421 = cl42.children[0] as IRClause
    expect(cl421.level).toBe(2)
    expect(cl421.titled).toBe(false)
    expect(cl421.title).toEqual([])
  })

  it('条 level 超界时按边界值收敛并警告', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X', fx.clause('cl', 7, 't')))
    const { doc, warnings } = pmToIr(pm)
    const cl = (doc.body[0].children[0]) as IRClause
    expect(cl.level).toBe(5)
    expect(warnings.some((w) => w.includes('超出'))).toBe(true)
  })

  it('附录转换：normative 与标题，appendixLabel 不入 IR', () => {
    const { doc } = pmToIr(fx.fullFixture())
    expect(doc.appendices[0].normative).toBe(true)
    expect(doc.appendices[1].normative).toBe(false)
    expect(doc.appendices[0].title).toEqual([{ text: '附加技术内容' }])
  })
})

describe('pmToIr / 术语条目', () => {
  it('termDef 转换：term/termEn/definition/note/example/source', () => {
    const { doc } = pmToIr(fx.fullFixture())
    const terms = doc.body[2]
    const t1 = terms.children[1] as IRTermEntry
    expect(t1.kind).toBe('termEntry')
    expect(t1.term).toEqual([{ text: '标准' }])
    expect(t1.termEn).toEqual([{ text: 'standard' }])
    expect((t1.definition[0] as IRParagraph).content[0].text).toBe('通过标准化活动制定的文件。')
    expect(t1.notes.length).toBe(1)
    expect(t1.examples.length).toBe(1)
    expect(t1.source?.[0].text).toContain('[来源：GB/T 20000.1—2014')
  })

  it('嵌套 termDef 保留为术语子条目', () => {
    const nested = fx.termDef('t-in', '内层', { definition: 'd2' })
    const outerPm = fx.termDef('t-out', '外层', { definition: 'd1', extra: [nested] })
    const { doc, warnings } = pmToIr(fx.standardDoc({}, fx.chapter('c', '术语和定义', outerPm)))
    const outer = doc.body[0].children[0] as IRTermEntry
    expect(doc.body[0].children).toHaveLength(1)
    expect(outer.id).toBe('t-out')
    expect(outer.nestedEntries?.map((entry) => entry.id)).toEqual(['t-in'])
    expect(outer.nestedEntries?.[0].term).toEqual([{ text: '内层' }])
    expect(warnings).toEqual([])
  })
})

describe('pmToIr / 块级要素', () => {
  it('数字列项固定为二级缩进，间隔号列项保持独立类型', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X',
      fx.stdList('number', 'numeric', ['n', '数字子项']),
      fx.stdList('alpha', 'alpha', ['a', '父项']),
      fx.stdList('dot', 'dot', ['d', '间隔号子项']),
    ))
    const lists = pmToIr(pm).doc.body[0].children as IRList[]
    expect(lists.map(({ listType, level }) => [listType, level ?? 1])).toEqual([
      ['number', 2], ['alpha', 1], ['dot', 2],
    ])
  })

  it('stdList 类型映射：numeric→number，boxedNumeric→boxed', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X',
      fx.stdList('l1', 'numeric', ['i1', 'a']),
      fx.stdList('l2', 'boxedNumeric', ['i2', 'b']),
      fx.stdList('l3', 'dash', ['i3', 'c']),
    ))
    const { doc } = pmToIr(pm)
    const types = doc.body[0].children.map((l) => (l as IRList).listType)
    expect(types).toEqual(['number', 'boxed', 'dash'])
  })

  it('旧罗马列项类型兼容降级为数字编号并给出警告', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X',
      fx.stdList('l1', 'roman', ['i1', 'a']),
      fx.stdList('l2', 'romanUpper', ['i2', 'b']),
    ))
    const { doc, warnings } = pmToIr(pm)
    const types = doc.body[0].children.map((block) => (block as IRList).listType)
    expect(types).toEqual(['number', 'number'])
    expect(warnings.filter((warning) => warning.includes('旧罗马列项类型'))).toHaveLength(2)
  })

  it('未知列表类型回退 dash 并警告；列表项内容包装为段落', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X', fx.stdList('l1', 'fancy', ['i1', '内容'])))
    const { doc, warnings } = pmToIr(pm)
    const list = doc.body[0].children[0] as IRList
    expect(list.listType).toBe('dash')
    expect(list.items[0].id).toBe('i1')
    expect((list.items[0].content[0] as IRParagraph).content[0].text).toBe('内容')
    expect(warnings.some((w) => w.includes('fancy'))).toBe(true)
  })

  it('StarterKit bulletList/orderedList 映射为 dash/number 列表', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X', {
      type: 'orderedList',
      attrs: { nodeId: 'ol' },
      content: [{
        type: 'listItem',
        attrs: { nodeId: 'oli' },
        content: [{ type: 'paragraph', attrs: { nodeId: 'olp' }, content: [fx.text('x')] }],
      }],
    }))
    const { doc } = pmToIr(pm)
    const list = doc.body[0].children[0] as IRList
    expect(list.listType).toBe('number')
    expect(list.level).toBe(2)
    expect(list.items[0].id).toBe('oli')
  })

  it('stdTable 转换：表头行计数、跨行列、英文表题与表注', () => {
    const { doc } = pmToIr(fx.fullFixture())
    const cl42 = (doc.body[3].children[1]) as IRClause
    const cl422 = cl42.children[1] as IRClause
    const table = cl422.children[0] as IRTable
    expect(table.kind).toBe('table')
    expect(table.headerRowCount).toBe(1)
    expect(table.rows.length).toBe(2)
    expect(table.caption).toEqual([{ text: '性能指标' }])
    expect(table.captionEn).toEqual([{ text: 'Performance' }])
    expect(table.notes.length).toBe(1)
    expect(table.rows[0].cells[0].colspan).toBe(1)
  })

  it('表格单元格 colspan/rowspan 取自 attrs', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X', fx.stdTable('t1', '题', [
      fx.tableRow(fx.tableCell('tableHeader', 'h', { colspan: 2 })),
      fx.tableRow(fx.tableCell('tableCell', 'a', { rowspan: 3 }), fx.tableCell('tableCell', 'b')),
    ])))
    const { doc } = pmToIr(pm)
    const table = doc.body[0].children[0] as IRTable
    expect(table.rows[0].cells[0].colspan).toBe(2)
    expect(table.rows[1].cells[0].rowspan).toBe(3)
  })

  it('figure 转换：src、中英文图题', () => {
    const { doc } = pmToIr(fx.fullFixture())
    const cl42 = doc.body[3].children[1] as IRClause
    const cl422 = cl42.children[1] as IRClause
    const fig = cl422.children[1] as IRFigure
    expect(fig.kind).toBe('figure')
    expect(fig.src).toBe(fx.FIG_PNG_BLUE)
    expect(fig.caption).toEqual([{ text: '系统架构图' }])
    expect(fig.captionEn).toEqual([{ text: 'System architecture' }])
  })

  it('formula 转换：latex 与式中键值对解析', () => {
    const { doc } = pmToIr(fx.fullFixture())
    const cl42 = doc.body[3].children[1] as IRClause
    const cl422 = cl42.children[1] as IRClause
    const f = cl422.children[2] as IRFormula
    expect(f.latex).toBe('E = mc^2')
    expect(f.numbered).toBe(true)
    expect(f.whereList.map((w) => [w.term[0]?.text, w.definition[0]?.text])).toEqual([
      ['E', '能量，单位为焦耳（J）'],
      ['m', '质量'],
      ['c', '光速。'],
    ])
  })

  it('note/example 行内内容包装为派生 ID 段落', () => {
    const { doc } = pmToIr(fx.fullFixture())
    const cl41 = doc.body[3].children[0] as IRClause
    const n = cl41.children[2] as IRNote
    expect(n.kind).toBe('note')
    expect(n.content[0].id).toBe('n-41a.p0')
    expect((n.content[0] as IRParagraph).content[0].text).toBe('第一条注。')
  })
})

describe('pmToIr / StarterKit 节点类型化保真（WP6）', () => {
  it('blockquote 保留为引文块，分段、ID与行内标记不丢', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X', {
      type: 'blockquote',
      attrs: { nodeId: 'bq' },
      content: [
        { type: 'paragraph', attrs: { nodeId: 'bqp1' }, content: [fx.text('第一段', [{ type: 'bold' }])] },
        { type: 'paragraph', attrs: { nodeId: 'bqp2' }, content: [fx.text('第二段')] },
      ],
    }))
    const { doc, warnings } = pmToIr(pm)
    const quote = doc.body[0].children[0]
    expect(quote).toEqual({
      kind: 'quote',
      id: 'bq',
      content: [
        { kind: 'paragraph', id: 'bqp1', content: [{ text: '第一段', marks: [{ type: 'bold' }] }] },
        { kind: 'paragraph', id: 'bqp2', content: [{ text: '第二段' }] },
      ],
    })
    expect(warnings).toEqual([])
  })

  it('codeBlock 保留为带语言属性的类型化代码块', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X', {
      type: 'codeBlock',
      attrs: { nodeId: 'cb', language: 'typescript' },
      content: [fx.text('const x = 1')],
    }))
    const { doc, warnings } = pmToIr(pm)
    const code = doc.body[0].children[0] as IRCodeBlock
    expect(code).toEqual({ kind: 'code', id: 'cb', language: 'typescript', text: 'const x = 1' })
    expect(warnings).toEqual([])
  })

  it('horizontalRule 跳过并警告', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X',
      { type: 'horizontalRule', attrs: { nodeId: 'hr' } },
      fx.para('p1', fx.text('正文')),
    ))
    const { doc, warnings } = pmToIr(pm)
    expect(doc.body[0].children.map((c) => c.id)).toEqual(['p1'])
    expect(warnings.filter((w) => w.includes('horizontalRule')).length).toBe(1)
  })
})

describe('pmToIr / orientation 透传', () => {
  it('figure/stdTable attrs 带 orientation: landscape 时透传到 IR', () => {
    const fig = fx.figure('g1', 's', '横图')
    fig.attrs = { ...fig.attrs, orientation: 'landscape' }
    const tbl = fx.stdTable('t1', '横表', [fx.tableRow(fx.tableCell('tableCell', 'x'))])
    tbl.attrs = { ...tbl.attrs, orientation: 'landscape' }
    const { doc } = pmToIr(fx.standardDoc({}, fx.chapter('c', 'X', fig, tbl)))
    expect((doc.body[0].children[0] as IRFigure).orientation).toBe('landscape')
    expect((doc.body[0].children[1] as IRTable).orientation).toBe('landscape')
  })

  it('未设置 orientation 时默认 portrait', () => {
    const { doc } = pmToIr(fx.standardDoc({}, fx.chapter('c', 'X', fx.figure('g1', 's', '图'))))
    expect((doc.body[0].children[0] as IRFigure).orientation).toBe('portrait')
  })
})

describe('pmToIr / 行内与健壮性', () => {
  it('标记映射：bold/subscript/superscript/crossRef', () => {
    const pm = fx.standardDoc({}, fx.chapter('c', 'X', fx.para('p1',
      fx.text('粗', [{ type: 'bold' }]),
      fx.text('下', [{ type: 'subscript' }]),
      fx.text('上', [{ type: 'superscript' }]),
      fx.xref('引用', 'target-1'),
    )))
    const { doc } = pmToIr(pm)
    const p = doc.body[0].children[0] as IRParagraph
    expect(p.content.map((r) => r.marks)).toEqual([
      [{ type: 'bold' }],
      [{ type: 'sub' }],
      [{ type: 'sup' }],
      [{ type: 'crossRef', targetId: 'target-1', targetKind: 'clause' }],
    ])
  })

  it('未知行内标记与未知节点类型收集进 warnings，不中断转换', () => {
    const pm = fx.standardDoc({},
      fx.chapter('c', 'X',
        fx.para('p1', fx.text('t', [{ type: 'highlight' }])),
        { type: 'mysteryBlock', content: [] },
      ),
      { type: 'mysteryTop' },
    )
    const { doc, warnings } = pmToIr(pm)
    expect(doc.body.length).toBe(1)
    expect(warnings.some((w) => w.includes('highlight'))).toBe(true)
    expect(warnings.some((w) => w.includes('mysteryBlock'))).toBe(true)
    expect(warnings.some((w) => w.includes('mysteryTop'))).toBe(true)
  })

  it('缺失 nodeId 时使用确定性占位 ID 并警告', () => {
    const pm = fx.standardDoc({}, {
      type: 'chapter',
      content: [{ type: 'chapterTitle', content: [fx.text('X')] }],
    })
    const r1 = pmToIr(pm)
    const r2 = pmToIr(pm)
    expect(r1.doc.body[0].id.startsWith(MISSING_ID_PREFIX)).toBe(true)
    expect(r1.doc.body[0].id).toBe(r2.doc.body[0].id)
    expect(r1.warnings.some((w) => w.includes('缺少 nodeId'))).toBe(true)
  })

  it('IR 可 JSON 往返无损（不变式 4）', () => {
    const { doc } = pmToIr(fx.fullFixture())
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  })

  it('纯函数：同一输入两次转换深度相等', () => {
    expect(pmToIr(fx.fullFixture())).toEqual(pmToIr(fx.fullFixture()))
  })
})

describe('parseWhereList', () => {
  it('无「——」的条目整体作为释义', () => {
    const list = parseWhereList([{ text: '式中：以上变量含义同前。' }], 'f')
    expect(list).toEqual([{ id: 'f.w0', term: [], definition: [{ text: '以上变量含义同前。' }] }])
  })

  it('保留分段内的 marks', () => {
    const list = parseWhereList(
      [{ text: 'P', marks: [{ type: 'italic' }] }, { text: '——功率；' }],
      'f',
    )
    expect(list[0].term).toEqual([{ text: 'P', marks: [{ type: 'italic' }] }])
    expect(list[0].definition).toEqual([{ text: '功率' }])
  })
})
