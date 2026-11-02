import { describe, expect, it } from 'vitest'
import { computeOrderedListMarkers, pmToIr, type IRList, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { readNode } from './readNode'
import { chapter, clause, clone, deepFreeze, doc, para, seqIds, text } from './testFixtures'

/**
 * issue #70：MCP（文档操作引擎）能创建、读取、修改与编辑器等价的「继续前一列项编号／重新编号」意图。
 */
const source = deepFreeze(doc(chapter('ch-1', '风险识别', clause('cl-1', 1, '识别要求', para('p-lead', text('开展风险识别时，分析以下因素。'))))))

const markersOf = (pm: PMJsonNode, ids: string[]) => {
  const markers = computeOrderedListMarkers(pmToIr(pm).doc)
  return ids.map(id => markers[id] ?? '')
}

const insertRisk = () => applyDocumentOperations(clone(source), [{
  op: 'insert', parent: 'cl-1', position: 'end', content: [
    { kind: 'list', id: 'L-in', listType: 'alpha', items: [{ id: 'a-in', content: '内部因素，包括但不限于：' }] },
    { kind: 'list', id: 'N-in', listType: 'number', items: [{ id: 'n-in-1', content: '组织架构；' }, { id: 'n-in-2', content: '管理制度；' }] },
    { kind: 'list', id: 'L-out', listType: 'alpha', continueNumbering: true, items: [{ id: 'a-out', content: '外部因素，包括但不限于：' }] },
    { kind: 'list', id: 'N-out', listType: 'number', items: [{ id: 'n-out-1', content: '市场环境；' }, { id: 'n-out-2', content: '监管要求；' }] },
  ],
}], { generateId: seqIds() })

describe('documentOps：列项继续编号', () => {
  it('insert：写入的编号意图进入编辑器 JSON（stdList.attrs.continueNumbering），一级 a）、b），二级各自从 1）开始', () => {
    const result = insertRisk()
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(markersOf(result.doc, ['a-in', 'n-in-1', 'n-in-2', 'a-out', 'n-out-1', 'n-out-2'])).toEqual(['a）', '1）', '2）', 'b）', '1）', '2）'])
    const lists: Record<string, unknown>[] = []
    const walk = (node: PMJsonNode): void => { if (node.type === 'stdList') lists.push(node.attrs ?? {}); node.content?.forEach(walk) }
    walk(result.doc)
    expect(lists.map(attrs => [attrs.nodeId, attrs.continueNumbering])).toEqual([
      ['L-in', undefined], ['N-in', undefined], ['L-out', true], ['N-out', undefined],
    ])
    expect(result.problems.filter(problem => problem.code === 'list-continue-orphan')).toEqual([])
  })

  it('readNode：继续编号的列表带 continueNumbering:true，可原样替换；重新编号的列表不带该字段', () => {
    const result = insertRisk()
    if (!result.ok) throw new Error('insert failed')
    const continued = readNode(result.doc, 'L-out')
    if (!continued.ok) throw new Error(continued.reason)
    expect((continued.node.ir as IRList).continueNumbering).toBe(true)
    expect(continued.node.replaceable).toBe(true)
    const restarted = readNode(result.doc, 'N-out')
    if (!restarted.ok) throw new Error(restarted.reason)
    expect('continueNumbering' in restarted.node.ir).toBe(false)
  })

  it('replace：改为重新编号、再改回继续编号', () => {
    const inserted = insertRisk()
    if (!inserted.ok) throw new Error('insert failed')
    const read = readNode(inserted.doc, 'L-out')
    if (!read.ok) throw new Error(read.reason)
    const { continueNumbering: _drop, ...restartIr } = read.node.ir as IRList
    const restarted = applyDocumentOperations(inserted.doc, [{ op: 'replace', nodeId: 'L-out', content: [restartIr] }], { generateId: seqIds() })
    if (!restarted.ok) throw new Error(JSON.stringify(restarted.issues))
    expect(markersOf(restarted.doc, ['a-out'])).toEqual(['a）'])
    expect(JSON.stringify(restarted.doc)).not.toContain('continueNumbering')

    const again = applyDocumentOperations(restarted.doc, [{ op: 'replace', nodeId: 'L-out', content: [{ ...restartIr, continueNumbering: true }] }], { generateId: seqIds() })
    if (!again.ok) throw new Error(JSON.stringify(again.issues))
    expect(markersOf(again.doc, ['a-out'])).toEqual(['b）'])
  })

  it('找不到接续目标：写入成功，但结果的 problems 带 list-continue-orphan 警告（introduced）', () => {
    const result = applyDocumentOperations(clone(source), [{
      op: 'insert', parent: 'cl-1', position: 'end',
      content: [{ kind: 'list', id: 'N', listType: 'number', continueNumbering: true, items: ['一'] }],
    }], { generateId: seqIds() })
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.problems.filter(problem => problem.code === 'list-continue-orphan')).toMatchObject([{ nodeId: 'N', severity: 'warning', introduced: true }])
  })

  it('无序列项写 continueNumbering:true 被拒绝，整批不生效', () => {
    const result = applyDocumentOperations(clone(source), [{
      op: 'insert', parent: 'cl-1', position: 'end',
      content: [{ kind: 'list', listType: 'dash', continueNumbering: true, items: ['一'] }],
    }], { generateId: seqIds() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toContain('invalid-value')
  })
})
