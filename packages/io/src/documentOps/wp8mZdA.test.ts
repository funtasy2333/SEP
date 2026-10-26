/**
 * WP8.M M-Z-d A：documentOps 读写引言中的条（Codex 评审 PR #56 的 P2）。
 *
 * G6 让 pmToIr 把引言里的条放进 `ir.front.introductionClauses`（编号 0.1、0.2…，GB/T 1.1—2020 8.4），
 * 但 documentOps 原先只读 `ir.front.introduction`：readNode 报 node-not-addressable、readContainer 返回空节点、
 * 结构树不列条。这里固定修复后的行为：
 * - 读：引言容器的节点 = 引言块之后接引言中的条（与 irToPm 的投影顺序一致）；条递归索引子条与块；结构树里的条带 Resolver 编号；
 * - 写：条内的块与子条可替换/插入；引言直属的条可删除/移动，但不能整体替换，也不能由写作片段新建（引言上下文只允许块），
 *   这些情形返回明确的原因而不是崩溃或静默丢失；条之后再写入引言块（悬置段）被整批拒绝，文档保持不变。
 *
 * 用例标题统一带 `[M-Z-d A]`。夹具为 shared 的 `createG6IrDoc()`（经 irToPm 得到生产 PM JSON）。
 */

import { describe, expect, it } from 'vitest'
import { irToPm, pmToIr, resolve, type IRClause, type IRDoc, type IRFragmentNode, type PMJsonNode } from '@ses/shared'
import { createG6IrDoc, createG6IrDocWithoutClauses } from '../../../shared/src/ir/__tests__/wp8mG6Fixtures'
import { applyDocumentOperations } from './apply'
import { indexDocument } from './locator'
import { buildOutline } from './outline'
import { readContainer, readNode } from './readNode'
import { clone, deepFreeze, seqIds } from './testFixtures'
import type { OutlineItem, ReadNodeInfo } from './types'

const pm = deepFreeze(irToPm(createG6IrDoc()))

function read(nodeId: string, source: PMJsonNode = pm): ReadNodeInfo {
  const result = readNode(source, nodeId)
  if (!result.ok) throw new Error(`${result.code}: ${result.reason}`)
  return result.node
}

const ids = (nodes: readonly IRFragmentNode[]): string[] => nodes.map(item => item.id)

/** 引言容器里的条（PM 路径：根下第 N 个 introduction 节点）。 */
function introductionNode(source: PMJsonNode): PMJsonNode | undefined {
  return (source.content ?? []).find(child => child.type === 'introduction')
}

describe('[M-Z-d A] readContainer：引言容器 = 引言块之后接引言中的条', () => {
  it('只有条的引言：exists 为 true，nodes 是三个条（原先为空数组）', () => {
    const result = readContainer(pm, 'introduction')
    if (!result.ok) throw new Error(result.reason)
    expect(result.container).toMatchObject({ container: 'introduction', exists: true, context: { parent: 'introduction' } })
    expect(result.container.nodes.map(node => node.kind)).toEqual(['clause', 'clause', 'clause'])
    expect(ids(result.container.nodes)).toEqual(['intro-c1', 'intro-c2', 'intro-c3'])
  })

  it('引言块在前、条在后，顺序与 irToPm 的投影一致', () => {
    const ir = createG6IrDoc()
    ir.front.introduction = [{ kind: 'paragraph', id: 'intro-lead', content: [{ text: '引言导语。' }] }]
    const mixed = irToPm(ir)
    const result = readContainer(mixed, 'introduction')
    if (!result.ok) throw new Error(result.reason)
    expect(ids(result.container.nodes)).toEqual(['intro-lead', 'intro-c1', 'intro-c2', 'intro-c3'])
    // 与 PM 容器内的子节点顺序一致
    expect((introductionNode(mixed)!.content ?? []).map(child => child.attrs?.nodeId)).toEqual(ids(result.container.nodes))
  })

  it('回归：没有条的引言仍只返回引言块；前言、参考文献容器不受影响', () => {
    const legacy = irToPm(createG6IrDocWithoutClauses())
    const intro = readContainer(legacy, 'introduction')
    if (!intro.ok) throw new Error(intro.reason)
    expect(ids(intro.container.nodes)).toEqual(['intro-p1'])
    const foreword = readContainer(pm, 'foreword')
    if (!foreword.ok) throw new Error(foreword.reason)
    expect(ids(foreword.container.nodes)).toEqual(['fw-p1'])
  })
})

describe('[M-Z-d A] readNode：引言中的条、子条与条内的块可寻址', () => {
  it('条：Resolver 编号 0.1、父节点是引言容器、位置与兄弟总数按引言里的条计', () => {
    expect(read('intro-c1')).toMatchObject({
      nodeId: 'intro-c1', kind: 'clause', number: '0.1',
      parent: { container: 'introduction' }, index: 0, siblingCount: 3, context: { parent: 'introduction' },
    })
    expect(read('intro-c2')).toMatchObject({ number: '0.2', index: 1, siblingCount: 3 })
    // 无题条同样占一个编号
    expect(read('intro-c3')).toMatchObject({ number: '0.3', index: 2, siblingCount: 3 })
    expect(read('intro-c1').ir).toMatchObject({ kind: 'clause', id: 'intro-c1', level: 1, titled: true })
  })

  it('子条：编号 0.1.1，父节点是条，替换上下文是 1 级条', () => {
    expect(read('intro-c1-1')).toMatchObject({
      kind: 'clause', number: '0.1.1', parent: { nodeId: 'intro-c1', kind: 'clause' },
      index: 0, siblingCount: 2, context: { parent: 'clause', level: 1 },
    })
    expect(read('intro-c1-2')).toMatchObject({ number: '0.1.2', index: 1 })
  })

  it('条内的块（段落、注、列项、表、图）：父节点是引言条，图表编号从引言起算', () => {
    expect(read('intro-c1-1-p1')).toMatchObject({
      kind: 'paragraph', parent: { nodeId: 'intro-c1-1', kind: 'clause' }, index: 0, siblingCount: 2,
      context: { parent: 'clause', level: 2 },
    })
    expect(read('intro-c1-1-note')).toMatchObject({ kind: 'note', number: '注：', index: 1 })
    expect(read('intro-c2-list')).toMatchObject({ kind: 'list', parent: { nodeId: 'intro-c2', kind: 'clause' }, index: 1 })
    expect(read('intro-tab')).toMatchObject({ kind: 'table', number: '表1', index: 2, siblingCount: 4 })
    expect(read('intro-fig')).toMatchObject({ kind: 'figure', number: '图1', index: 3, siblingCount: 4 })
    expect(read('intro-c3-p1')).toMatchObject({ kind: 'paragraph', parent: { nodeId: 'intro-c3', kind: 'clause' } })
  })

  it('条内的块与子条按与正文相同的规则判定可替换', () => {
    expect(read('intro-c1-1-p1').replaceable).toBe(true)
    expect(read('intro-c1-1-note').replaceable).toBe(true)
    expect(read('intro-c2-list').replaceable).toBe(true)
    expect(read('intro-tab').replaceable).toBe(true)
    expect(read('intro-c1-1').replaceable).toBe(true)
  })

  it('引言直属的条不能整体替换：原因明确（no-context），而不是自相矛盾的“条不能放在引言中”', () => {
    for (const id of ['intro-c1', 'intro-c2', 'intro-c3']) {
      const info = read(id)
      expect(info.replaceable).toBe(false)
      expect(info.notReplaceable).toEqual([
        expect.objectContaining({ code: 'no-context', message: expect.stringContaining('引言中的条暂不支持整体替换') }),
      ])
    }
  })

  it('穷举：IR 里引言条下的每个 id（条、子条、块）都能被定位索引找到并被 readNode 读成同一种 kind', () => {
    const ir = pmToIr(pm).doc
    const index = indexDocument(pm)
    const walk = (node: IRClause | IRFragmentNode, out: IRFragmentNode[]): void => {
      out.push(node)
      if (node.kind === 'clause') for (const child of node.children) walk(child, out)
    }
    const all: IRFragmentNode[] = []
    for (const clause of ir.front.introductionClauses ?? []) walk(clause, all)
    // 条 + 子条 + 段落/注/列项/表/图：至少这些
    expect(all.length).toBeGreaterThanOrEqual(12)
    for (const node of all) {
      expect(index.byId.has(node.id), `索引缺少 ${node.id}`).toBe(true)
      expect(read(node.id).kind).toBe(node.kind)
    }
  })

  it('找不到的 id 仍报 node-not-found；条内表格的行/单元格仍是“不可单独寻址”并指向所在的表', () => {
    const missing = readNode(pm, 'no-such-node')
    expect(missing).toMatchObject({ ok: false, code: 'node-not-found' })
    const cell = readNode(pm, 'intro-tab-r1c1')
    expect(cell).toMatchObject({ ok: false, code: 'node-not-addressable' })
    if (!cell.ok) expect(cell.reason).toContain('intro-tab')
  })
})

describe('[M-Z-d A] 结构树：引言列出其中的条，带编号与标题，结构与正文章下的条一致', () => {
  const outline = buildOutline(pm)

  it('引言：present、没有引言块（blockCount 0）、三个条按 0.1/0.2/0.3 编号', () => {
    expect(outline.introduction).toMatchObject({ present: true, blockCount: 0 })
    expect(outline.introduction.items.map(item => [item.nodeId, item.kind, item.number, item.title])).toEqual([
      ['intro-c1', 'clause', '0.1', '背景'],
      ['intro-c2', 'clause', '0.2', '目的'],
      ['intro-c3', 'clause', '0.3', ''],
    ])
  })

  it('条递归列出子条与表、图，并给出直接子块数量；形状与正文章下的条相同', () => {
    const [c1, c2] = outline.introduction.items as [OutlineItem, OutlineItem]
    expect(c1).toMatchObject({ level: 1, blockCount: 0 })
    expect(c1.children!.map(item => [item.nodeId, item.number, item.title, item.level])).toEqual([
      ['intro-c1-1', '0.1.1', '起因', 2],
      ['intro-c1-2', '0.1.2', '说明', 2],
    ])
    expect(c1.children![0]).toMatchObject({ blockCount: 2, children: [] })
    // 0.2：段落与列项计入 blockCount，表、图单独列出
    expect(c2).toMatchObject({ blockCount: 2 })
    expect(c2.children!.map(item => [item.nodeId, item.kind, item.number])).toEqual([
      ['intro-tab', 'table', '表1'],
      ['intro-fig', 'figure', '图1'],
    ])
    // 正文章下的条：同样的字段集合（kind/number/title/level/blockCount/children）
    const bodyClause = outline.body[0]!.children![0]!
    expect(Object.keys(bodyClause).sort()).toEqual(Object.keys(c1).sort())
    expect(bodyClause).toMatchObject({ kind: 'clause', number: '1.1', level: 1 })
  })

  it('编号全部来自 Resolver（与 resolve 的 labels 一致），正文编号不受引言条影响', () => {
    const { labels } = resolve(pmToIr(pm).doc)
    const flat: OutlineItem[] = []
    const walk = (items: readonly OutlineItem[]): void => { for (const item of items) { flat.push(item); walk(item.children ?? []) } }
    walk(outline.introduction.items)
    expect(flat.map(item => item.nodeId)).toEqual(['intro-c1', 'intro-c1-1', 'intro-c1-2', 'intro-c2', 'intro-tab', 'intro-fig', 'intro-c3'])
    for (const item of flat) expect(item.number).toBe(labels[item.nodeId]?.label)
    expect(outline.body[0]).toMatchObject({ nodeId: 'ch1', number: '1' })
  })

  it('回归：没有条的引言只给 blockCount；前言不变', () => {
    const legacy = buildOutline(irToPm(createG6IrDocWithoutClauses()))
    expect(legacy.introduction).toEqual({ present: true, blockCount: 1, items: [] })
    expect(legacy.foreword).toEqual({ present: true, blockCount: 1, items: [] })
  })
})

describe('[M-Z-d A] 写操作：不崩溃、不静默丢失（正常工作，或返回明确原因）', () => {
  const run = (source: PMJsonNode, operations: unknown[]) =>
    applyDocumentOperations(source, operations, { generateId: seqIds('zd') })

  it('替换条内的块：成功，其余引言内容与编号保持不变', () => {
    const result = run(pm, [{ op: 'replace', nodeId: 'intro-c1-1-p1', content: [{ kind: 'paragraph', content: ['改写后的起因。'] }] }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.operations[0]).toMatchObject({ op: 'replace', removed: ['intro-c1-1-p1'] })
    const ir = pmToIr(result.doc).doc
    const labels = resolve(ir).labels
    expect(labels['intro-c1-1']).toMatchObject({ label: '0.1.1' })
    expect(ir.front.introductionClauses!.map(clause => clause.id)).toEqual(['intro-c1', 'intro-c2', 'intro-c3'])
    expect(JSON.stringify(ir.front.introductionClauses![0])).toContain('改写后的起因。')
  })

  it('向引言条里插入块：成功，且新块可被 readNode 读到（父节点是该引言条）', () => {
    const result = run(pm, [{ op: 'insert', parent: 'intro-c2', position: 'end', content: [{ kind: 'paragraph', id: 'zd-new', content: ['补充说明。'] }] }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(result.operations[0]).toMatchObject({ op: 'insert', inserted: ['zd-new'] })
    expect(read('zd-new', result.doc)).toMatchObject({ kind: 'paragraph', parent: { nodeId: 'intro-c2', kind: 'clause' }, index: 4 })
  })

  it('在引言条里插入子条：成功，编号 0.2.1', () => {
    const result = run(pm, [{
      op: 'insert', parent: 'intro-c2', position: 'end',
      content: [{ kind: 'clause', id: 'zd-sub', title: '细则', children: [{ kind: 'paragraph', content: ['细则内容。'] }] }],
    }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(read('zd-sub', result.doc)).toMatchObject({ kind: 'clause', number: '0.2.1', parent: { nodeId: 'intro-c2' } })
  })

  it('删除引言条：成功，后续条重新编号；删光所有条后引言容器随之移除', () => {
    const one = run(pm, [{ op: 'delete', nodeId: 'intro-c1' }])
    if (!one.ok) throw new Error(JSON.stringify(one.issues))
    expect(one.operations[0]!.removed).toEqual(expect.arrayContaining(['intro-c1', 'intro-c1-1', 'intro-c1-2', 'intro-c1-1-note']))
    expect(read('intro-c2', one.doc)).toMatchObject({ number: '0.1', index: 0, siblingCount: 2 })

    const all = run(pm, [
      { op: 'delete', nodeId: 'intro-c1' }, { op: 'delete', nodeId: 'intro-c2' }, { op: 'delete', nodeId: 'intro-c3' },
    ])
    if (!all.ok) throw new Error(JSON.stringify(all.issues))
    expect(all.operations[2]).toMatchObject({ removedContainer: 'introduction' })
    expect((all.doc.content ?? []).some(child => child.type === 'introduction')).toBe(false)
  })

  it('移动引言条到正文章：成功，层级与编号按新位置重算', () => {
    const result = run(pm, [{ op: 'move', nodeId: 'intro-c3', parent: 'ch1', position: 'end' }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(read('intro-c3', result.doc)).toMatchObject({ kind: 'clause', number: '1.2', parent: { nodeId: 'ch1', kind: 'chapter' } })
    expect(read('intro-c2', result.doc)).toMatchObject({ siblingCount: 2 })
  })

  it('整体替换引言条：返回 invalid-context 的明确原因，文档不变（不崩溃、不静默丢失）', () => {
    const before = JSON.stringify(pm)
    const result = run(pm, [{ op: 'replace', nodeId: 'intro-c3', content: [{ kind: 'clause', title: '新', content: ['x'] }] }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-context', nodeId: 'intro-c3', operationIndex: 0,
        reason: expect.stringContaining('引言中的条「intro-c3」暂不支持整体替换'),
      }),
    ])
    expect(JSON.stringify(pm)).toBe(before)
  })

  it('由写作片段向引言容器新建条：以 not-allowed-here 拒绝（引言上下文只允许块）', () => {
    const result = run(pm, [{ op: 'insert', parent: 'introduction', position: 'end', content: [{ kind: 'clause', title: '新条', content: ['x'] }] }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toEqual(['not-allowed-here'])
    const move = run(pm, [{ op: 'move', nodeId: 'ch1-c1', parent: 'introduction', position: 'end' }])
    expect(move.ok).toBe(false)
    if (!move.ok) expect(move.issues.map(issue => issue.code)).toEqual(['not-allowed-here'])
  })

  it('在条之后写入引言块（悬置段）：整批拒绝并说明原因；写在条之前则成功且顺序为块在前', () => {
    const hanging = run(pm, [{ op: 'insert', parent: 'introduction', position: 'end', content: [{ kind: 'paragraph', content: ['悬置段。'] }] }])
    expect(hanging.ok).toBe(false)
    if (!hanging.ok) {
      expect(hanging.issues).toEqual([expect.objectContaining({ code: 'unsupported-content', reason: expect.stringContaining('悬置段') })])
    }
    const anchored = run(pm, [{ op: 'insert', parent: 'introduction', position: { after: 'intro-c3' }, content: [{ kind: 'paragraph', content: ['悬置段。'] }] }])
    expect(anchored.ok).toBe(false)
    if (!anchored.ok) expect(anchored.issues.map(issue => issue.code)).toEqual(['unsupported-content'])

    const leading = run(pm, [{ op: 'insert', parent: 'introduction', position: 'start', content: [{ kind: 'paragraph', id: 'zd-lead', content: ['引言导语。'] }] }])
    if (!leading.ok) throw new Error(JSON.stringify(leading.issues))
    const container = readContainer(leading.doc, 'introduction')
    if (!container.ok) throw new Error(container.reason)
    expect(ids(container.container.nodes)).toEqual(['zd-lead', 'intro-c1', 'intro-c2', 'intro-c3'])
    expect(read('intro-c1', leading.doc)).toMatchObject({ number: '0.1', index: 1, siblingCount: 4 })
  })

  it('把条内的块移到引言容器末尾也会产生悬置段：整批拒绝', () => {
    const result = run(pm, [{ op: 'move', nodeId: 'intro-c1-1-p1', parent: 'introduction', position: 'end' }])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(issue => issue.code)).toEqual(['unsupported-content'])
  })

  it('入参（冻结的文档）不被修改；多次读取结果稳定', () => {
    const snapshot = JSON.stringify(pm)
    run(pm, [{ op: 'delete', nodeId: 'intro-c2' }])
    read('intro-c1')
    buildOutline(pm)
    expect(JSON.stringify(pm)).toBe(snapshot)
    expect(clone(buildOutline(pm))).toEqual(buildOutline(pm))
  })
})

// 防御：夹具本身没有引言块，且条之后无悬置段（否则上面的断言前提不成立）。
describe('[M-Z-d A] 夹具前提', () => {
  it('createG6IrDoc 引言只有条', () => {
    const ir: IRDoc = createG6IrDoc()
    expect(ir.front.introduction).toEqual([])
    expect(ir.front.introductionClauses).toHaveLength(3)
    expect(pmToIr(pm).doc.unsupportedContent ?? []).toEqual([])
  })
})
