/**
 * issue #70：列项「继续前一列项编号／重新编号」在 IR、Resolver、内部引用、HTML、DOCX、XML、写作片段与校验中一致。
 */
import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { irToPm } from '../irToPm'
import { computeListNumbering, computeOrderedListMarkers, resolve } from '../resolve'
import { ListSequence, isContinuablePmListType, listOrdinalLabel } from '../listNumbering'
import { normalizeAuthoringFragment } from '../authoring'
import type { IRDoc, IRList } from '../types'
import { renderHtml } from '../../renderers/html'
import { renderDocxTraced } from '../../renderers/docx/render'
import { simulateNumbering } from '../../renderers/docx/__tests__/helpers/numberingSim'
import { completeMeta, renderOk } from '../../renderers/__tests__/xml46687Kit'
import { analyzeDocument } from '../../validation/analyze'
import { chapter, clause, para, standardDoc, text } from './fixtures'

const list = (nodeId: string, listType: string, items: [string, string][], continueNumbering?: boolean): PMJsonNode => ({
  type: 'stdList',
  attrs: { nodeId, listType, level: listType === 'numeric' || listType === 'dot' ? 2 : 1, ...(continueNumbering === undefined ? {} : { continueNumbering }) },
  content: items.map(([id, t]) => ({ type: 'stdListItem', attrs: { nodeId: id }, content: [text(t)] })),
})

const refTo = (targetId: string): PMJsonNode => ({
  type: 'text', text: '见', marks: [{ type: 'crossRef', attrs: { refId: targetId, refType: 'listItem' } }],
})

/** issue #70 的典型场景：一级字母列项 a）、b），各自下面的二级数字列项都从 1）开始。 */
function riskDoc(opts: { continueOuter?: boolean; between?: PMJsonNode[]; ref?: boolean } = {}): PMJsonNode {
  return standardDoc({},
    chapter('ch1', '范围', para('p-scope', text('范围。'))),
    chapter('ch2', '风险识别',
      clause('c21', 2, '识别要求',
        para('p-lead', text('开展风险识别时，分析以下内部因素和外部因素。')),
        list('L-in', 'alpha', [['a-in', '内部因素，包括但不限于：']]),
        list('N-in', 'numeric', [['n-in-1', '组织架构；'], ['n-in-2', '管理制度；'], ['n-in-3', '人员能力。']]),
        ...(opts.between ?? []),
        list('L-out', 'alpha', [['a-out', '外部因素，包括但不限于：']], opts.continueOuter ?? true),
        list('N-out', 'numeric', [['n-out-1', '市场环境；'], ['n-out-2', '监管要求；'], ['n-out-3', '外部相关方情况。']]),
        ...(opts.ref ? [para('p-ref', refTo('a-out'), refTo('n-out-2'))] : []),
      ),
    ),
  )
}

const irOf = (pm: PMJsonNode): IRDoc => pmToIr(pm).doc
const listsIn = (doc: IRDoc): IRList[] => {
  const out: IRList[] = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!value || typeof value !== 'object') return
    if ((value as IRList).kind === 'list') out.push(value as IRList)
    Object.values(value).forEach(walk)
  }
  walk(doc)
  return out
}
const markersOf = (doc: IRDoc, ids: string[]) => {
  const markers = computeOrderedListMarkers(doc)
  return ids.map(id => markers[id] ?? '')
}
const ALL_ITEMS = ['a-in', 'n-in-1', 'n-in-2', 'n-in-3', 'a-out', 'n-out-1', 'n-out-2', 'n-out-3']

describe('ListSequence：接续同一兄弟序列中前一个同类型列表', () => {
  it('缺省重新编号；继续编号时首项 = 前一同类型列表末项 + 1，可逐级累加', () => {
    const seq = new ListSequence<string>()
    expect(seq.next('alpha', false, 2, 'A')).toEqual({ start: 1, continued: false, orphan: false })
    expect(seq.next('number', false, 3, 'N')).toEqual({ start: 1, continued: false, orphan: false })
    expect(seq.next('alpha', true, 1, 'B')).toEqual({ start: 3, continued: true, orphan: false, previous: 'A' })
    expect(seq.next('alpha', true, 2, 'C')).toEqual({ start: 4, continued: true, orphan: false, previous: 'B' })
    expect(seq.next('number', false, 1, 'N2')).toEqual({ start: 1, continued: false, orphan: false })
    expect(seq.next('alpha', false, 1, 'D')).toEqual({ start: 1, continued: false, orphan: false })
  })

  it('前面没有同类型列表：按重新编号处理并标为 orphan；无序类型忽略设置', () => {
    const seq = new ListSequence<string>()
    expect(seq.next('number', true, 2, 'N')).toEqual({ start: 1, continued: false, orphan: true })
    expect(seq.next('dash', true, 2, 'D')).toEqual({ start: 1, continued: false, orphan: false })
    expect(seq.next('number', true, 1, 'N2')).toEqual({ start: 3, continued: true, orphan: false, previous: 'N' })
  })

  it('PM 类型名与提示用的序号文字', () => {
    expect(['alpha', 'numeric', 'roman'].every(isContinuablePmListType)).toBe(true)
    expect(['dash', 'dot', 'boxedNumeric', 'number'].some(isContinuablePmListType)).toBe(false)
    expect([listOrdinalLabel('alpha', 3), listOrdinalLabel('numeric', 4), listOrdinalLabel('roman', 4), listOrdinalLabel('dash', 2)])
      .toEqual(['c）', '4）', 'iv）', ''])
  })
})

describe('issue #70 典型场景：一级继续、二级重新开始', () => {
  it('一级显示 a）、b），两组二级都从 1）开始', () => {
    expect(markersOf(irOf(riskDoc()), ALL_ITEMS)).toEqual(['a）', '1）', '2）', '3）', 'b）', '1）', '2）', '3）'])
  })

  it('设为重新编号（缺省）时，外部因素回到 a）', () => {
    expect(markersOf(irOf(riskDoc({ continueOuter: false })), ['a-in', 'a-out'])).toEqual(['a）', 'a）'])
  })

  it('中间插入说明段落、注后，已设置的继续关系保持', () => {
    const doc = irOf(riskDoc({ between: [para('p-mid', text('说明段落。')), { type: 'note', attrs: { nodeId: 'nt' }, content: [text('注文。')] }] }))
    expect(markersOf(doc, ['a-in', 'a-out', 'n-out-1'])).toEqual(['a）', 'b）', '1）'])
  })

  it('接续目标记录为前一个同类型列表；不跨条接续，找不到目标时为 orphan', () => {
    expect(computeListNumbering(irOf(riskDoc()))['L-out']).toEqual({ start: 2, continued: true, orphan: false, previous: 'L-in' })
    const otherClause = standardDoc({}, chapter('ch1', '范围',
      clause('c11', 2, '甲', list('L1', 'alpha', [['x1', '一'], ['x2', '二']])),
      clause('c12', 2, '乙', list('L2', 'alpha', [['y1', '三']], true)),
    ))
    const numbering = computeListNumbering(irOf(otherClause))
    expect(numbering['L2']).toEqual({ start: 1, continued: false, orphan: true })
    expect(markersOf(irOf(otherClause), ['y1'])).toEqual(['a）'])
  })

  it('内部引用文字使用接续后的编号', () => {
    const { labels } = resolve(irOf(riskDoc({ ref: true })))
    expect(labels['a-out']?.label).toBe('b）')
    expect(labels['a-out']?.refText).toBe('2.1 b）')
    expect(labels['n-out-2']?.label).toBe('2）')
  })
})

describe('保存与往返：继续编号随 PM / IR / JSON 保留，旧数据不变', () => {
  it('pmToIr → irToPm → pmToIr 往返保留 continueNumbering，JSON 序列化不丢失', () => {
    const ir = irOf(riskDoc())
    expect(listsIn(ir).map(l => [l.id, l.continueNumbering ?? false])).toEqual([
      ['L-in', false], ['N-in', false], ['L-out', true], ['N-out', false],
    ])
    const back = irToPm(JSON.parse(JSON.stringify(ir)) as IRDoc)
    const again = irOf(back)
    expect(listsIn(again).map(l => l.continueNumbering ?? false)).toEqual([false, false, true, false])
    expect(markersOf(again, ALL_ITEMS)).toEqual(['a）', '1）', '2）', '3）', 'b）', '1）', '2）', '3）'])
  })

  it('没有设置继续编号的既有文档：IR 与投影出的 PM 都不出现该字段，编号仍各自从头开始', () => {
    const legacy = standardDoc({}, chapter('ch1', '范围',
      list('A', 'alpha', [['a1', '一'], ['a2', '二']]),
      para('p', text('段落。')),
      list('B', 'alpha', [['b1', '三']]),
    ))
    const ir = irOf(legacy)
    expect(listsIn(ir).some(l => 'continueNumbering' in l)).toBe(false)
    expect(JSON.stringify(irToPm(ir))).not.toContain('continueNumbering')
    expect(markersOf(ir, ['a1', 'a2', 'b1'])).toEqual(['a）', 'b）', 'a）'])
  })

  it('无序类型上残留的继续编号设置不进入 IR（改类型后不串号）', () => {
    const ir = irOf(standardDoc({}, chapter('ch1', '范围',
      list('A', 'dash', [['a1', '一']]),
      list('B', 'dash', [['b1', '二']], true),
    )))
    expect(listsIn(ir).some(l => 'continueNumbering' in l)).toBe(false)
  })
})

describe('块级列项（stdListBlockItem）', () => {
  /** 一级字母列项的列项里含说明段落与嵌套二级数字列项（WP8.3 嵌套列项）。 */
  const blockList = (id: string, lead: string, sub: [string, string][], continueNumbering?: boolean): PMJsonNode => ({
    type: 'stdList',
    attrs: { nodeId: id, listType: 'alpha', level: 1, ...(continueNumbering ? { continueNumbering } : {}) },
    content: [{ type: 'stdListBlockItem', attrs: { nodeId: `${id}-i` }, content: [
      { type: 'paragraph', attrs: { nodeId: `${id}-p` }, content: [text(lead)] },
      list(`${id}-n`, 'numeric', sub),
    ] }],
  })

  const doc = () => standardDoc({}, chapter('ch1', '范围',
    blockList('B1', '内部因素：', [['b1-1', '组织架构；'], ['b1-2', '管理制度。']]),
    para('mid', text('说明。')),
    blockList('B2', '外部因素：', [['b2-1', '市场环境；']], true),
  ))

  it('irToPm → pmToIr 往返保留继续编号，一级仍为 b）', () => {
    const ir = irOf(doc())
    expect(markersOf(ir, ['B1-i', 'B2-i'])).toEqual(['a）', 'b）'])
    const again = irOf(irToPm(JSON.parse(JSON.stringify(ir)) as IRDoc))
    expect(listsIn(again).filter(l => l.listType === 'alpha').map(l => l.continueNumbering ?? false)).toEqual([false, true])
    expect(markersOf(again, ['B1-i', 'B2-i'])).toEqual(['a）', 'b）'])
  })

  it('同一块级列项内的两组嵌套数字列项：后一组可继续前一组', () => {
    const nested = standardDoc({}, chapter('ch1', '范围', {
      type: 'stdList', attrs: { nodeId: 'O', listType: 'alpha', level: 1 },
      content: [{ type: 'stdListBlockItem', attrs: { nodeId: 'O-i' }, content: [
        { type: 'paragraph', attrs: { nodeId: 'O-p' }, content: [text('因素：')] },
        list('N1', 'numeric', [['n1', '一'], ['n2', '二']]),
        { type: 'paragraph', attrs: { nodeId: 'O-p2' }, content: [text('另外：')] },
        list('N2', 'numeric', [['n3', '三']], true),
      ] }],
    }))
    expect(computeListNumbering(irOf(nested))['N2']).toMatchObject({ start: 3, continued: true, previous: 'N1' })
  })
})

describe('校验：找不到接续目标时给出提示', () => {
  it('orphan 产生 list-continue-orphan 警告与 structure.list-continuation 校验项；正常接续无提示', () => {
    const orphanDoc = irOf(standardDoc({}, chapter('ch1', '范围',
      para('p', text('段落。')),
      list('N', 'numeric', [['n1', '一']], true),
    )))
    const problems = resolve(orphanDoc).problems.filter(p => p.code === 'list-continue-orphan')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ nodeId: 'N', severity: 'warning' })
    expect(problems[0]!.message).toContain('数字编号列项')
    const issues = analyzeDocument(orphanDoc).validation.issues.filter(issue => issue.ruleId === 'structure.list-continuation')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning', nodeId: 'N' })

    expect(resolve(irOf(riskDoc())).problems.filter(p => p.code === 'list-continue-orphan')).toEqual([])
  })
})

describe('出口一致：HTML / DOCX / XML 与编辑器编号相同', () => {
  const ir = irOf(riskDoc())
  const { labels } = resolve(ir)

  it('HTML（含 PDF 用的 print 变体）：接续列表的计数器从前一组末项起', () => {
    for (const variant of ['screen', 'print'] as const) {
      const html = renderHtml(ir, labels, { variant })
      expect(html).toMatch(/data-node-id="L-out"/)
      expect(html).toMatch(/<div class="ses-list ses-list-alpha"[^>]*data-start="2" style="counter-reset: ses-li 1"[^>]*data-node-id="L-out"/)
      // 重新编号的列表不带起点，与既有输出相同
      expect(html).toMatch(/<div class="ses-list ses-list-alpha" data-type="list" data-list-type="alpha" data-node-id="L-in">/)
      expect(html).not.toMatch(/data-node-id="N-out"[^>]*counter-reset/)
    }
  })

  it('DOCX：Word 编号模拟得到 a）、1）2）3）、b）、1）2）3）', () => {
    const { pkg } = renderDocxTraced(ir, labels, { formulaOmml: {}, images: {}, stage: 'approval_draft', createdAt: '2026-11-02T00:00:00.000Z' })
    const listLabels = simulateNumbering(pkg)
      .filter(p => p.styleId === 'SesListItem')
      .map(p => `${(p.label ?? '').trim()}${p.text}`)
    expect(listLabels).toEqual([
      'a）内部因素，包括但不限于：', '1）组织架构；', '2）管理制度；', '3）人员能力。',
      'b）外部因素，包括但不限于：', '1）市场环境；', '2）监管要求；', '3）外部相关方情况。',
    ])
  })

  it('XML（GB/T 46687.2）：list-item/label 写接续后的序号', () => {
    const { xml } = renderOk({ ...ir, meta: completeMeta() })
    const labelsInXml = [...xml.matchAll(/<label>([^<]*)<\/label>\s*<p>([^<]*)<\/p>/g)].map(m => `${m[1]}${m[2]}`)
    expect(labelsInXml).toEqual(expect.arrayContaining(['a)内部因素，包括但不限于：', 'b)外部因素，包括但不限于：', '1)市场环境；']))
  })
})

describe('写作片段（MCP）：continueNumbering', () => {
  const context = { parent: 'chapter' } as const
  let n = 0
  const generateId = () => `g${++n}`

  it('alpha / number 可设为继续编号；false 等同省略', () => {
    const result = normalizeAuthoringFragment([
      { kind: 'list', listType: 'alpha', items: ['甲'] },
      { kind: 'list', listType: 'number', items: ['一'] },
      { kind: 'list', listType: 'alpha', continueNumbering: true, items: ['乙'] },
      { kind: 'list', listType: 'number', continueNumbering: false, items: ['二'] },
    ], context, { generateId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes.map(node => (node as IRList).continueNumbering ?? false)).toEqual([false, false, true, false])
    expect('continueNumbering' in result.nodes[3]!).toBe(false)
  })

  it('无序类型设为继续编号被拒绝（invalid-value）；非布尔值被拒绝（invalid-type）', () => {
    const dash = normalizeAuthoringFragment([{ kind: 'list', listType: 'dash', continueNumbering: true, items: ['一'] }], context, { generateId })
    expect(dash.ok).toBe(false)
    if (!dash.ok) expect(dash.issues.map(issue => [issue.code, issue.path])).toContainEqual(['invalid-value', 'fragment[0].continueNumbering'])
    const bad = normalizeAuthoringFragment([{ kind: 'list', listType: 'alpha', continueNumbering: 'yes', items: ['一'] }], context, { generateId })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues.map(issue => issue.code)).toContain('invalid-type')
  })
})
