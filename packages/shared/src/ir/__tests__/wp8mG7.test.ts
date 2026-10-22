/**
 * WP8.M G7：罗马列项（docs/wp8.m/design.md §4.7；矩阵 M-5.7-04；约定 C-S-32；§7.1 D-M-06）与注/示例的块内容（M-5.6-05）。
 *
 * 本文件覆盖 IR/Resolver/PM 映射与诊断；HTML/DOCX 排版与输出边界见 renderers/__tests__/wp8mG7.test.ts，
 * 生产 Schema 与保存重开见 client/src/extensions/wp8mG7.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { hasSemanticExtensions } from '../extensions'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import { gbT11Strategy } from '../strategies'
import type { IRDoc, IRList } from '../types'
import { createG7RomanIrDoc, docWithBlocks, para, simpleList, t } from './wp8mG7Fixtures'

function errors(doc: IRDoc) { return resolve(doc).problems.filter(problem => problem.severity === 'error') }

function diagnosticsOf(doc: IRDoc) {
  try { irToPm(doc) } catch (error) {
    expect(error).toBeInstanceOf(IRToPmError)
    return (error as IRToPmError).diagnostics
  }
  throw new Error('期望 irToPm 抛出 IRToPmError')
}

function findNodes(root: PMJsonNode, type: string): PMJsonNode[] {
  return [...(root.type === type ? [root] : []), ...(root.content ?? []).flatMap(child => findNodes(child, type))]
}

describe('[M-5.7-04] 罗马列项：IR → PM（stdList listType=roman）→ IR', () => {
  const doc = createG7RomanIrDoc()

  it('irToPm 输出 stdList(listType=roman, level=1)，列项保留 nodeId，根属性 extensionVersion=1', () => {
    const pm = irToPm(doc)
    expect(pm.attrs).toEqual({ extensionVersion: 1 })
    const lists = findNodes(pm, 'stdList')
    expect(lists.map(list => [list.attrs?.nodeId, list.attrs?.listType, list.attrs?.level])).toEqual([
      ['g7-l-roman', 'roman', 1], ['g7-l-roman2', 'roman', 1],
    ])
    expect(findNodes(lists[0]!, 'stdListItem').map(item => item.attrs?.nodeId)).toEqual(['g7-r1', 'g7-r2', 'g7-r3', 'g7-r4'])
  })

  it('往返：pmToIr(irToPm(doc)) 与原 IR 深度相等（带 extensionVersion），无 warning、无 unsupportedContent', () => {
    const { doc: back, warnings } = pmToIr(irToPm(doc))
    expect(warnings).toEqual([])
    expect(back.unsupportedContent).toBeUndefined()
    expect(back).toEqual({ ...doc, extensionVersion: 1 })
    const again = pmToIr(irToPm(back)).doc
    expect(again).toEqual(back)
  })

  it('hasSemanticExtensions：roman 列表是语义扩展（listType 是旧字段，需按 kind 专门判断）；其他列表类型不是', () => {
    expect(hasSemanticExtensions(doc)).toBe(true)
    for (const type of ['dash', 'alpha', 'number', 'dot', 'boxed'] as const) {
      expect(hasSemanticExtensions(docWithBlocks([simpleList('l', type, ['i1', '项'])])), type).toBe(false)
    }
  })

  it('level：roman 是一级（与字母列项相同）；显式 level=1 通过，level=2 与固定级别冲突被拒绝', () => {
    const roman = simpleList('l', 'roman', ['i1', '项'])
    expect(() => irToPm(docWithBlocks([{ ...roman, level: 1 }]))).not.toThrow()
    expect(diagnosticsOf(docWithBlocks([{ ...roman, level: 2 }]))).toContainEqual(expect.objectContaining({
      path: 'body[0][0][0].level', nodeId: 'l', reason: expect.stringContaining('固定为 1 级'),
    }))
  })

  it('romanUpper（GB/T 46687.2 没有 roman-upper 取值）仍被拒绝，不静默转成数字', () => {
    expect(diagnosticsOf(docWithBlocks([simpleList('up', 'romanUpper', ['i1', '项'])]))).toContainEqual(expect.objectContaining({
      path: 'body[0][0][0].listType', nodeId: 'up', reason: expect.stringContaining('不支持「romanUpper」'),
    }))
  })

  it('嵌套列项（项内含子列表）与段落 id 非派生仍无法投影为 stdList：沿用既有诊断，roman 没有例外', () => {
    const nested: IRList = {
      kind: 'list', id: 'n', listType: 'roman',
      items: [{ id: 'n1', content: [para('n1.p0', t('外')), simpleList('n1-sub', 'dot', ['n1-s1', '内'])] }],
    }
    expect(diagnosticsOf(docWithBlocks([nested])).some(item => item.nodeId === 'n' && item.reason.includes('嵌套'))).toBe(true)
    const mismatched = simpleList('m', 'roman', ['m1', '项'])
    mismatched.items[0]!.content[0]!.id = 'authored-id'
    expect(diagnosticsOf(docWithBlocks([mismatched]))).toContainEqual(expect.objectContaining({ nodeId: 'authored-id', reason: expect.stringContaining('无法保留') }))
  })
})

describe('[M-5.7-04] Resolver：罗马列项标记为 i) ii) iii) iv)（半角，D-M-03），列项引用与 G4 一致', () => {
  const { labels, problems } = resolve(createG7RomanIrDoc())

  it('没有 error；被引用的列项得到标签 / li_<k> / refText（容器编号 + 标记）', () => {
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['g7-r3']).toEqual({ label: 'iii)', xmlId: 'li_1', refText: '1.1 iii)' })
    expect(labels['g7-s2']).toEqual({ label: 'ii)', xmlId: 'li_2', refText: '1.1 ii)' })
    expect(labels['g7-r1']).toBeUndefined()
  })

  it('gbT11Strategy.listItem：罗马数字按 i)…；与 DOCX lowerRoman / HTML lower-roman 的计数一致（含 iv、ix、xl、xc）', () => {
    const marks = [1, 2, 3, 4, 5, 8, 9, 10, 14, 19, 40, 49, 90].map(n => gbT11Strategy.listItem!('roman', n))
    expect(marks).toEqual(['i)', 'ii)', 'iii)', 'iv)', 'v)', 'viii)', 'ix)', 'x)', 'xiv)', 'xix)', 'xl)', 'xlix)', 'xc)'])
  })

  it('引用无序列项与 romanUpper 仍报 dangling-xref（没有编号），不受 roman 支持影响', () => {
    const doc = docWithBlocks([
      para('x', { text: '见', marks: [{ type: 'crossRef', targetId: 'u1', targetKind: 'listItem' }] }),
      simpleList('up', 'romanUpper', ['u1', '项']),
    ])
    expect(resolve(doc).problems.some(problem => problem.code === 'dangling-xref' && problem.severity === 'error')).toBe(true)
  })
})
