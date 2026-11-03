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
import type { IRDoc, IRList, IRNote } from '../types'
import { createG7NoteIrDoc, createG7RomanIrDoc, docWithBlocks, para, simpleList, t } from './wp8mG7Fixtures'

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

  it('罗马嵌套列项保存重开保留内容；扁平列项的非派生段落 id 仍拒绝', () => {
    const nested: IRList = {
      kind: 'list', id: 'n', listType: 'roman',
      items: [{ id: 'n1', content: [para('n1.p0', t('外')), simpleList('n1-sub', 'dot', ['n1-s1', '内'])] }],
    }
    const restored = pmToIr(JSON.parse(JSON.stringify(irToPm(docWithBlocks([nested])))) as PMJsonNode).doc
    expect((restored.body[0]!.children[0] as { children: IRList[] }).children[0]).toEqual(nested)
    const mismatched = simpleList('m', 'roman', ['m1', '项'])
    mismatched.items[0]!.content[0]!.id = 'authored-id'
    expect(diagnosticsOf(docWithBlocks([mismatched]))).toContainEqual(expect.objectContaining({ nodeId: 'authored-id', reason: expect.stringContaining('无法保留') }))
  })
})

describe('[M-5.7-04] Resolver：罗马列项标记为 i） ii） iii） iv）（全角右括号，D-M-03 修订），列项引用与 G4 一致', () => {
  const { labels, problems } = resolve(createG7RomanIrDoc())

  it('没有 error；被引用的列项得到标签 / li_<k> / refText（容器编号 + 标记）', () => {
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['g7-r3']).toEqual({ label: 'iii）', xmlId: 'li_1', refText: '1.1 iii）' })
    expect(labels['g7-s2']).toEqual({ label: 'ii）', xmlId: 'li_2', refText: '1.1 ii）' })
    expect(labels['g7-r1']).toBeUndefined()
  })

  it('gbT11Strategy.listItem：罗马数字按 i）…；与 DOCX lowerRoman / HTML lower-roman 的计数一致（含 iv、ix、xl、xc）', () => {
    const marks = [1, 2, 3, 4, 5, 8, 9, 10, 14, 19, 40, 49, 90].map(n => gbT11Strategy.listItem!('roman', n))
    expect(marks).toEqual(['i）', 'ii）', 'iii）', 'iv）', 'v）', 'viii）', 'ix）', 'x）', 'xiv）', 'xix）', 'xl）', 'xlix）', 'xc）'])
  })

  it('引用无序列项与 romanUpper 仍报 dangling-xref（没有编号），不受 roman 支持影响', () => {
    const doc = docWithBlocks([
      para('x', { text: '见', marks: [{ type: 'crossRef', targetId: 'u1', targetKind: 'listItem' }] }),
      simpleList('up', 'romanUpper', ['u1', '项']),
    ])
    expect(resolve(doc).problems.some(problem => problem.code === 'dangling-xref' && problem.severity === 'error')).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// M-5.6-05 注/示例的块内容
// ---------------------------------------------------------------------------------------------------------------------

describe('[M-5.6-05] 注/示例的块内容：IR → PM（noteBlock/exampleBlock）→ IR，canonical 规则', () => {
  const doc = createG7NoteIrDoc()

  it('irToPm：单段派生 id → 旧 note/example；多块/含列项/段落 id 非派生 → noteBlock/exampleBlock，子块保留各自 id，列项投影为 stdList', () => {
    const pm = irToPm(doc)
    const clause = findNodes(pm, 'clause')[0]!
    expect(clause.content!.slice(1).map(node => [node.type, node.attrs?.nodeId])).toEqual([
      ['stdParagraph', 'g7-note-intro'],
      ['note', 'g7-n1'], ['noteBlock', 'g7-n2'], ['noteBlock', 'g7-n3'], ['noteBlock', 'g7-n4'],
      ['example', 'g7-e1'], ['exampleBlock', 'g7-e2'],
    ])
    const multi = findNodes(pm, 'noteBlock').find(node => node.attrs?.nodeId === 'g7-n2')!
    expect(multi.content!.map(child => [child.type, child.attrs?.nodeId])).toEqual([['stdParagraph', 'g7-n2-p1'], ['stdParagraph', 'g7-n2-p2'], ['stdList', 'g7-n2-l']])
    expect(multi.content![2]!.attrs).toMatchObject({ listType: 'dash', level: 1 })
    expect(findNodes(pm, 'noteBlock').find(node => node.attrs?.nodeId === 'g7-n3')!.content![0]!.attrs?.nodeId).toBe('g7-n3-p')
    expect(findNodes(pm, 'exampleBlock')[0]!.content!.map(child => child.type)).toEqual(['stdParagraph', 'stdList'])
    // 旧 note 的内容是行内文字（与此前逐字节相同）
    expect(findNodes(pm, 'note')[0]).toEqual({ type: 'note', attrs: { nodeId: 'g7-n1' }, content: [{ type: 'text', text: '旧式单段注。' }] })
  })

  it('往返：pmToIr(irToPm(doc)) 与原 IR 深度相等（带 extensionVersion），无 warning、无 unsupportedContent；再往返不变', () => {
    const { doc: back, warnings } = pmToIr(irToPm(doc))
    expect(warnings).toEqual([])
    expect(back.unsupportedContent).toBeUndefined()
    expect(back).toEqual({ ...doc, extensionVersion: 1 })
    expect(pmToIr(irToPm(back)).doc).toEqual(back)
  })

  it('hasSemanticExtensions：多块、含列项、段落 id 非派生的注/示例是语义扩展；canonical 单段不是（旧文档不被误标）', () => {
    const only = (...blocks: Parameters<typeof docWithBlocks>[0]) => docWithBlocks(blocks)
    expect(hasSemanticExtensions(only({ kind: 'note', id: 'a', content: [para('a.p0', t('x'))] }))).toBe(false)
    expect(hasSemanticExtensions(only({ kind: 'example', id: 'a', content: [para('a.p0', t('x'))] }))).toBe(false)
    expect(hasSemanticExtensions(only({ kind: 'note', id: 'a', content: [para('a.p0', t('x')), para('a-p2', t('y'))] }))).toBe(true)
    expect(hasSemanticExtensions(only({ kind: 'example', id: 'a', content: [simpleList('l', 'dash', ['i', 'x'])] }))).toBe(true)
    expect(hasSemanticExtensions(only({ kind: 'note', id: 'a', content: [para('authored', t('x'))] }))).toBe(true)
    expect(irToPm(only({ kind: 'note', id: 'a', content: [para('a.p0', t('x'))] })).attrs).toBeUndefined()
    expect(irToPm(only({ kind: 'note', id: 'a', content: [para('authored', t('x'))] })).attrs).toEqual({ extensionVersion: 1 })
  })

  it('Resolver：多块注/示例与单段共用同一作用域编号（注1：～注4：、示例1：、示例2：）', () => {
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(['g7-n1', 'g7-n2', 'g7-n3', 'g7-n4'].map(id => labels[id]!.label)).toEqual(['注1：', '注2：', '注3：', '注4：'])
    expect(['g7-e1', 'g7-e2'].map(id => labels[id]!.label)).toEqual(['示例1：', '示例2：'])
  })

  it('无法投影：注里放表、含嵌套内容的列项、空内容——带路径与 nodeId 的诊断，不静默改写', () => {
    const table = { kind: 'table' as const, id: 't', caption: [], orientation: 'portrait' as const, headerRowCount: 0, rows: [], notes: [] }
    const bad = docWithBlocks([
      { kind: 'note', id: 'n-table', content: [para('n-table-p', t('x')), table] },
      { kind: 'example', id: 'n-empty', content: [] },
      {
        kind: 'note', id: 'n-nested',
        content: [{ kind: 'list', id: 'n-nested-l', listType: 'dash', items: [{ id: 'n-nested-i', content: [para('n-nested-i.p0', t('外')), simpleList('n-nested-s', 'dash', ['n-nested-si', '内'])] }] }],
      },
    ])
    const diagnostics = diagnosticsOf(bad)
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: 't', path: 'body[0][0][0].content[1]', reason: expect.stringContaining('只接受段落与列项') }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: 'n-empty', path: 'body[0][0][1].content', reason: expect.stringContaining('至少需要') }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ nodeId: 'n-nested-l', reason: expect.stringContaining('简单列项') }))
  })

  it('术语条目内的注与表注行内的注仍是单段：多块在那两处继续报错（文案指向该位置的限制），不使用 noteBlock', () => {
    const multi = (id: string): IRNote => ({ kind: 'note', id, content: [para(`${id}.p0`, t('甲')), para(`${id}-p2`, t('乙'))] })
    const bad = docWithBlocks([
      { kind: 'termEntry', id: 'te', term: [t('术语')], definition: [para('te.def0', t('定义'))], notes: [multi('te-note')], examples: [] },
      { kind: 'table', id: 'tb', caption: [], orientation: 'portrait', headerRowCount: 0, rows: [{ id: 'r', cells: [{ id: 'c', colspan: 1, rowspan: 1, header: false, content: [para('c-p', t('格'))] }] }], notes: [multi('tb-note')] },
    ])
    const diagnostics = diagnosticsOf(bad)
    expect(diagnostics.filter(item => item.reason.includes('该位置的注/示例只支持单段落')).map(item => item.path)).toEqual([
      'body[0][0][0].notes.te-note', 'body[0][0][1].notes.tb-note',
    ])
  })
})
