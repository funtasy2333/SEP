import { describe, expect, it } from 'vitest'
import { normalizeAuthoringFragment } from '../authoring'
import { irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRBlock, IRClause, IRList, IRParagraph, IRReferenceTargetKind, IRTitlePart } from '../types'
import { chapter, clause, docOf, item, list, listItemDoc, para, pmProjectableDoc, xref } from './wp8mG4Fixtures'

const marksOf = (node: PMJsonNode): NonNullable<PMJsonNode['marks']> => {
  const found: NonNullable<PMJsonNode['marks']> = []
  const visit = (current: PMJsonNode): void => {
    for (const mark of current.marks ?? []) if (mark.type === 'crossRef') found.push(mark)
    current.content?.forEach(visit)
  }
  visit(node)
  return found
}

describe('[M-10.1.5-01] PM crossRef.refType=listItem ↔ IR targetKind=listItem', () => {
  it('IR → PM：targetKind 映射为 refType，stdListItem 带稳定 nodeId', () => {
    const pm = irToPm(pmProjectableDoc())
    expect(marksOf(pm).map(mark => mark.attrs)).toEqual([
      { targetId: 'a3', refType: 'listItem' },
      { targetId: 'n2', refType: 'listItem' },
    ])
    const ids: string[] = []
    const visit = (node: PMJsonNode): void => {
      if (node.type === 'stdListItem') ids.push(String(node.attrs?.nodeId))
      node.content?.forEach(visit)
    }
    visit(pm)
    expect(ids).toEqual(['a1', 'a2', 'a3', 'n1', 'n2', 'd1', 'd2'])
  })

  it('PM → IR：refType=listItem 映射回 targetKind，无警告、无 unsupportedContent', () => {
    const original = pmProjectableDoc()
    const { doc, warnings } = pmToIr(irToPm(original))
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    const clauseNode = (doc.body[0]!.children[0] as IRClause)
    const reference = clauseNode.children[0] as IRParagraph
    expect(reference.content.flatMap(run => run.marks ?? [])).toEqual([
      { type: 'crossRef', targetId: 'a3', targetKind: 'listItem' },
      { type: 'crossRef', targetId: 'n2', targetKind: 'listItem' },
    ])
    const lists = clauseNode.children.filter((child): child is IRList => child.kind === 'list')
    expect(lists.map(entry => [entry.listType, entry.items.map(row => row.id)])).toEqual([
      ['alpha', ['a1', 'a2', 'a3']], ['number', ['n1', 'n2']], ['dash', ['d1', 'd2']],
    ])
  })

  it('IR → PM → IR 两轮 + JSON 往返后 IR 深度相等', () => {
    const first = pmToIr(irToPm(pmProjectableDoc())).doc
    const second = pmToIr(JSON.parse(JSON.stringify(irToPm(first))) as PMJsonNode).doc
    expect(second).toEqual(first)
    expect(irToPm(second)).toEqual(irToPm(first))
  })

  it('往返后的 IR 经 Resolver：被引用列项得到 c) / 2)，xmlId 按文档序', () => {
    const { doc } = pmToIr(irToPm(pmProjectableDoc()))
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['a3']).toEqual({ label: 'c)', xmlId: 'li_1', refText: '1.1 c)' })
    expect(labels['n2']).toEqual({ label: '2)', xmlId: 'li_2', refText: '1.1 2)' })
    expect(labels['a1']).toBeUndefined()
    expect(labels['d1']).toBeUndefined()
  })

  it('旧稿形态仍然兼容：refType 缺省或其他取值的映射不变', () => {
    const pm: PMJsonNode = irToPm(docOf([chapter('ch1', 'general', '一般要求', clause('c1', 1, '条',
      para('p', xref('c1', 'clause', '条'), xref('c1')),
    ))]))
    expect(marksOf(pm).map(mark => mark.attrs)).toEqual([
      { targetId: 'c1', refType: 'clause' },
      { targetId: 'c1', refType: '' },
    ])
  })

  it('PM 里未知的 refType 仍以 unsupportedContent 报告（listItem 的加入不放宽其他取值）', () => {
    const pm = irToPm(pmProjectableDoc())
    for (const mark of marksOf(pm)) if (mark.attrs?.refType === 'listItem') mark.attrs.refType = 'listitem'
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent?.some(issue => issue.nodeType === 'crossRef' && issue.reason.includes('listitem'))).toBe(true)
  })

  it.each(['root', 'cover'] as const)('结构化元数据（%s attrs）里的 crossRef 可携带 targetKind=listItem', (location) => {
    const targetKind: IRReferenceTargetKind = 'listItem'
    const titleParts: IRTitlePart[] = [{
      id: 'title-ref', content: [{ text: '引用', marks: [{ type: 'crossRef', targetId: 'a1', targetKind }] }],
    }]
    const input = location === 'root'
      ? { type: 'doc', attrs: { titleParts }, content: [] }
      : { type: 'doc', content: [{ type: 'coverPage', attrs: { titleParts }, content: [] }] }
    expect(pmToIr(input).doc.meta.titleParts).toEqual(titleParts)
  })
})

describe('[M-10.1.5-02] Resolver 对 IR 原生夹具（含嵌套/罗马）的整体结果', () => {
  it('嵌套列表为 IR 原生结构，生产 PM 暂不能表达，irToPm 明确拒绝而不是静默丢弃', () => {
    const nested: IRBlock = list('l-outer', 'alpha', [item('o1', '外一', list('l-inner', 'number', [item('i1', '内一')], 2))])
    expect(() => irToPm(docOf([chapter('ch1', 'general', '一般要求', clause('c1', 1, '条', nested))]))).toThrow()
  })

  it('listItemDoc 夹具：全部标签与问题清单稳定', () => {
    const doc = listItemDoc([xref('a1', 'listItem'), xref('a3', 'listItem'), xref('n2', 'listItem'), xref('r3', 'listItem')])
    const { labels, problems } = resolve(doc)
    expect(problems).toEqual([])
    const listLabels = Object.fromEntries(Object.entries(labels).filter(([, label]) => label.xmlId.startsWith('li_')))
    expect(listLabels).toEqual({
      a1: { label: 'a)', xmlId: 'li_1', refText: '5.2 a)' },
      a3: { label: 'c)', xmlId: 'li_2', refText: '5.2 c)' },
      n2: { label: '2)', xmlId: 'li_3', refText: '5.2 2)' },
      r3: { label: 'iii)', xmlId: 'li_4', refText: '5.2 iii)' },
    })
  })
})

describe('[M-10.1.5-01] 写作层接受 targetKind=listItem', () => {
  const fragment = (targetKind: string) => [{ kind: 'paragraph', content: [{ text: '见列项', marks: [{ type: 'crossRef', targetId: 'a3', targetKind }] }] }]
  let n = 0
  const generateId = () => `gen${++n}`

  it('listItem 作为 crossRef 的 targetKind 原样保留', () => {
    const result = normalizeAuthoringFragment(fragment('listItem'), { parent: 'chapter' }, { generateId })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.nodes[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '见列项', marks: [{ type: 'crossRef', targetId: 'a3', targetKind: 'listItem' }] }] })
  })

  it('其他未知取值仍被拒绝，提示列出 listItem', () => {
    const result = normalizeAuthoringFragment(fragment('listitem'), { parent: 'chapter' }, { generateId })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const issue = result.issues.find(entry => entry.path === 'fragment[0].content[0].marks[0].targetKind')
      expect(issue?.code).toBe('invalid-value')
      expect(issue?.reason).toContain('listItem')
    }
  })
})
