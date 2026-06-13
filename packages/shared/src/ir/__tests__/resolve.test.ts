import { describe, expect, it } from 'vitest'
import { pmToIr } from '../pmToIr'
import { resolve } from '../resolve'
import { gbT11Strategy } from '../strategies'
import type { ResolveResult } from '../types'
import * as fx from './fixtures'

function resolveFull(): ResolveResult {
  return resolve(pmToIr(fx.fullFixture()).doc)
}

describe('resolve / 章条编号', () => {
  it('章按顺序编号，refText 为「第N章」', () => {
    const { labels } = resolveFull()
    expect(labels['ch-scope']).toEqual({ label: '1', xmlId: 'sec_1', refText: '第1章' })
    expect(labels['ch-4']).toEqual({ label: '4', xmlId: 'sec_4', refText: '第4章' })
  })

  it('条按路径编号，无题条照常编号', () => {
    const { labels } = resolveFull()
    expect(labels['cl-41'].label).toBe('4.1')
    expect(labels['cl-42'].label).toBe('4.2')
    expect(labels['cl-421']).toEqual({ label: '4.2.1', xmlId: 'sec_4.2.1', refText: '4.2.1' })
    expect(labels['cl-422'].label).toBe('4.2.2')
  })

  it('术语条目与条共用编号序列（3.1、3.2）', () => {
    const { labels } = resolveFull()
    expect(labels['term-1']).toEqual({ label: '3.1', xmlId: 'sec_3.1', refText: '3.1' })
    expect(labels['term-2'].label).toBe('3.2')
  })

  it('附录编号：label 含「附录」前缀，xmlId 用字母', () => {
    const { labels } = resolveFull()
    expect(labels['app-a']).toEqual({ label: '附录A', xmlId: 'sec_A', refText: '附录A' })
    expect(labels['app-b'].label).toBe('附录B')
  })

  it('附录内条按字母前缀编号（A.1）', () => {
    const { labels } = resolveFull()
    expect(labels['cl-a1']).toEqual({ label: 'A.1', xmlId: 'sec_A.1', refText: 'A.1' })
  })
})

describe('resolve / 图表公式编号', () => {
  it('正文图/表/公式全文连续编号', () => {
    const { labels } = resolveFull()
    expect(labels['tbl-1']).toEqual({ label: '表1', xmlId: 'tab_1', refText: '表1' })
    expect(labels['fig-1']).toEqual({ label: '图1', xmlId: 'fig_1', refText: '图1' })
    expect(labels['f-1']).toEqual({ label: '(1)', xmlId: 'formula_1', refText: '公式(1)' })
  })

  it('图表公式跨章连续、不按章重置', () => {
    const pm = fx.standardDoc({},
      fx.chapter('c1', '甲', fx.figure('g1', 's', '一')),
      fx.chapter('c2', '乙', fx.figure('g2', 's', '二'), fx.stdTable('t1', '表甲', [fx.tableRow(fx.tableCell('tableCell', 'x'))])),
      fx.chapter('c3', '丙', fx.stdTable('t2', '表乙', [fx.tableRow(fx.tableCell('tableCell', 'y'))])),
    )
    const { labels } = resolve(pmToIr(pm).doc)
    expect(labels['g2'].label).toBe('图2')
    expect(labels['t2'].label).toBe('表2')
  })

  it('附录内图/表/公式按附录字母重新计数', () => {
    const { labels } = resolveFull()
    expect(labels['fig-a1']).toEqual({ label: '图A.1', xmlId: 'fig_A.1', refText: '图A.1' })
    expect(labels['tbl-a1'].label).toBe('表A.1')
    expect(labels['f-a1']).toEqual({ label: '(A.1)', xmlId: 'formula_A.1', refText: '公式(A.1)' })
  })

  it('不编号公式不产生 label', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X', fx.formula('f1', 'x=1')))
    const ir = pmToIr(pm).doc
    ;(ir.body[0].children[0] as { numbered: boolean }).numbered = false
    const { labels } = resolve(ir)
    expect(labels['f1']).toBeUndefined()
  })
})

describe('resolve / 注与示例', () => {
  it('同一作用域多条注编号、多条示例编号', () => {
    const { labels } = resolveFull()
    expect(labels['n-41a'].label).toBe('注1：')
    expect(labels['n-41b'].label).toBe('注2：')
    expect(labels['n-41a'].refText).toBe('注1')
    expect(labels['ex-41a'].label).toBe('示例1：')
    expect(labels['ex-41b'].label).toBe('示例2：')
  })

  it('作用域内单条注不编号（前言、术语条目）', () => {
    const { labels } = resolveFull()
    expect(labels['fw-note'].label).toBe('注：')
    expect(labels['term-1-note'].label).toBe('注：')
    expect(labels['term-1-ex'].label).toBe('示例：')
  })

  it('表内注独立计数，不与所在条的注合并编号', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.note('n1', '正文注一。'),
      fx.note('n2', '正文注二。'),
      fx.stdTable('t1', '题', [fx.tableRow(fx.tableCell('tableCell', 'x'))], { footnote: '表注。' }),
    ))
    const result = resolve(pmToIr(pm).doc)
    expect(result.labels['n1'].label).toBe('注1：')
    expect(result.labels['n2'].label).toBe('注2：')
    expect(result.labels['t1.note0'].label).toBe('注：')
  })

  it('注的作用域为最近的条：不同条各自计数', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.clause('cl1', 1, '甲', fx.note('na', 'a')),
      fx.clause('cl2', 1, '乙', fx.note('nb', 'b')),
    ))
    const { labels } = resolve(pmToIr(pm).doc)
    expect(labels['na'].label).toBe('注：')
    expect(labels['nb'].label).toBe('注：')
  })
})

describe('resolve / 参考文献', () => {
  it('被引用条目按首次引用顺序编号，未引用条目排后', () => {
    // 全要素文档中正文仅引用 bib-2，bib-2 应为 [1]
    const { labels, bibliographyOrder } = resolveFull()
    expect(bibliographyOrder).toEqual(['bib-2', 'bib-1'])
    expect(labels['bib-2']).toEqual({ label: '[1]', xmlId: 'bib_1', refText: '[1]' })
    expect(labels['bib-1'].label).toBe('[2]')
  })

  it('无引用时按文档顺序编号', () => {
    const pm = fx.standardDoc({},
      fx.chapter('c1', 'X', fx.para('p1', fx.text('正文'))),
      fx.bibliography(['b1', '文献一'], ['b2', '文献二']),
    )
    const { labels, bibliographyOrder } = resolve(pmToIr(pm).doc)
    expect(bibliographyOrder).toEqual(['b1', 'b2'])
    expect(labels['b1'].label).toBe('[1]')
  })
})

describe('resolve / problems', () => {
  it('全要素文档无任何 problems', () => {
    const { problems } = resolveFull()
    expect(problems).toEqual([])
  })

  it('dangling-xref：引用目标不存在', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.para('p1', fx.xref('见5.1', 'no-such-node')),
    ))
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems).toEqual([
      expect.objectContaining({ code: 'dangling-xref', severity: 'error', nodeId: 'p1' }),
    ])
  })

  it('dangling-xref：目标存在但没有编号', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.para('p1', fx.text('正文')),
      fx.para('p2', fx.xref('引段落', 'p1')),
    ))
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems.map((p) => p.code)).toEqual(['dangling-xref'])
  })

  it('duplicate-id：同一 ID 出现两次', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.para('dup', fx.text('一')),
      fx.para('dup', fx.text('二')),
    ))
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems).toEqual([
      expect.objectContaining({ code: 'duplicate-id', severity: 'error', nodeId: 'dup' }),
    ])
  })

  it('missing-id：pmToIr 占位 ID 被报告', () => {
    const pm = fx.standardDoc({}, {
      type: 'chapter',
      content: [{ type: 'chapterTitle', content: [fx.text('X')] }, { type: 'stdParagraph', content: [] }],
    })
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems.filter((p) => p.code === 'missing-id').length).toBe(2)
  })

  it('heading-skip：章下直接出现 2 级条', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.clause('cl1', 2, '跳级', fx.para('p1', fx.text('内容'))),
    ))
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems).toEqual([
      expect.objectContaining({ code: 'heading-skip', severity: 'warning', nodeId: 'cl1' }),
    ])
  })

  it('heading-skip：条下子条层级跳级', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.clause('cl1', 1, '甲', fx.clause('cl11', 3, '跳', fx.para('p1', fx.text('内容')))),
    ))
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems.map((p) => [p.code, p.nodeId])).toEqual([['heading-skip', 'cl11']])
  })

  it('hanging-paragraph：含子条的容器直接含正文段', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', 'X',
      fx.para('p1', fx.text('悬置段')),
      fx.clause('cl1', 1, '甲', fx.para('p2', fx.text('正常'))),
    ))
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems).toEqual([
      expect.objectContaining({ code: 'hanging-paragraph', severity: 'warning', nodeId: 'c1' }),
    ])
  })

  it('术语章引导语 + 术语条目不算悬置段（GB/T 1.1 规范写法）', () => {
    const pm = fx.standardDoc({}, fx.chapter('c1', '术语和定义',
      fx.para('p0', fx.text('下列术语和定义适用于本文件。')),
      fx.termDef('t1', '术语', { definition: '定义' }),
    ))
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems).toEqual([])
  })

  it('empty-section：空章/空条', () => {
    const pm = fx.standardDoc({},
      fx.chapter('c1', '空章'),
      fx.chapter('c2', 'X', fx.clause('cl1', 1, '空条')),
    )
    const { problems } = resolve(pmToIr(pm).doc)
    expect(problems.map((p) => [p.code, p.nodeId])).toEqual([
      ['empty-section', 'c1'],
      ['empty-section', 'cl1'],
    ])
  })
})

describe('resolve / 编号策略可配置', () => {
  it('覆盖 strategy.clause() 可改变条编号格式（含附录内条）', () => {
    const custom = { ...gbT11Strategy, clause: (path: Array<number | string>) => path.join('-') }
    const { labels } = resolve(pmToIr(fx.fullFixture()).doc, custom)
    expect(labels['cl-421']).toEqual({ label: '4-2-1', xmlId: 'sec_4-2-1', refText: '4-2-1' })
    expect(labels['cl-a1'].label).toBe('A-1')
    expect(labels['term-1'].label).toBe('3-1')
    // 章与图表编号不受 clause() 影响
    expect(labels['ch-4'].label).toBe('4')
    expect(labels['tbl-1'].label).toBe('表1')
  })
})

describe('resolve / 纯函数性', () => {
  it('同一输入两次 resolve 输出深度相等', () => {
    const ir = pmToIr(fx.fullFixture()).doc
    const r1 = resolve(ir)
    const r2 = resolve(ir)
    expect(r1).toEqual(r2)
  })

  it('resolve 不修改入参 doc', () => {
    const ir = pmToIr(fx.fullFixture()).doc
    const before = JSON.parse(JSON.stringify(ir))
    resolve(ir)
    expect(ir).toEqual(before)
  })

  it('返回的 doc 即入参引用（不复制树）', () => {
    const ir = pmToIr(fx.fullFixture()).doc
    expect(resolve(ir).doc).toBe(ir)
  })
})
