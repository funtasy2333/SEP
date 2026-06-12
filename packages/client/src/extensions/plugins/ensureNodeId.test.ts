import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { findNodeIdFixes, ensureNodeIdPlugin } from './ensureNodeId'

/** 最小测试 schema：带 nodeId 的块级节点 + 不带 nodeId 的标题节点 */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      attrs: { nodeId: { default: null } },
      toDOM: (node) => ['p', { 'data-node-id': node.attrs.nodeId }, 0],
    },
    plainTitle: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['h1', 0],
    },
    text: {},
  },
})

function para(nodeId: string | null, text = 'x'): PMNode {
  return schema.nodes.paragraph.create({ nodeId }, schema.text(text))
}

function collectIds(doc: PMNode): (string | null)[] {
  const ids: (string | null)[] = []
  doc.descendants((node) => {
    if ('nodeId' in node.attrs) ids.push(node.attrs.nodeId)
  })
  return ids
}

function createState(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc, plugins: [ensureNodeIdPlugin()] })
}

describe('findNodeIdFixes', () => {
  it('给缺失 nodeId 的节点生成修复项（旧文档补齐场景）', () => {
    const doc = schema.nodes.doc.create(null, [para(null), para(null), para('keep-this-id')])
    const fixes = findNodeIdFixes(doc)
    expect(fixes).toHaveLength(2)
    const ids = fixes.map((f) => f.nodeId)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{12}$/)
  })

  it('重复 nodeId 保留首个出现者，其余重新生成', () => {
    const doc = schema.nodes.doc.create(null, [para('dup'), para('dup'), para('dup')])
    const fixes = findNodeIdFixes(doc)
    expect(fixes).toHaveLength(2)
    // 首个 dup（pos 0）不在修复列表中
    expect(fixes.map((f) => f.pos)).not.toContain(0)
    expect(fixes.every((f) => f.nodeId !== 'dup')).toBe(true)
  })

  it('全部唯一且存在时无修复项', () => {
    const doc = schema.nodes.doc.create(null, [para('a1'), para('a2')])
    expect(findNodeIdFixes(doc)).toHaveLength(0)
  })

  it('忽略无 nodeId 属性的节点类型', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.plainTitle.create(null, schema.text('title')),
      para(null),
    ])
    expect(findNodeIdFixes(doc)).toHaveLength(1)
  })
})

describe('ensureNodeIdPlugin', () => {
  it('插入新节点后自动补 nodeId', () => {
    const state = createState(schema.nodes.doc.create(null, [para('exist')]))
    const tr = state.tr.insert(state.doc.content.size, para(null))
    const { state: next } = state.applyTransaction(tr)
    const ids = collectIds(next.doc)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('exist')
    expect(ids[1]).toMatch(/^[A-Za-z0-9]{12}$/)
  })

  it('粘贴产生的重复 nodeId 被重新生成，文档内全部唯一', () => {
    const state = createState(schema.nodes.doc.create(null, [para('exist')]))
    // 模拟粘贴：插入两个携带与现有节点相同 ID 的节点
    const tr = state.tr.insert(state.doc.content.size, [para('exist'), para('exist')])
    const { state: next } = state.applyTransaction(tr)
    const ids = collectIds(next.doc)
    expect(ids).toHaveLength(3)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('exist')
  })

  it('拆分节点后两半均有 nodeId 且不重复', () => {
    const state = createState(
      schema.nodes.doc.create(null, [para('orig', 'hello world')]),
    )
    // 在 "hello"（pos 6）处拆分；PM 原生 split 会复制 attrs 产生重复 ID
    const tr = state.tr.split(6)
    const { state: next } = state.applyTransaction(tr)
    const ids = collectIds(next.doc)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('orig')
    expect(ids[1]).not.toBe('orig')
    expect(ids[1]).toMatch(/^[A-Za-z0-9]{12}$/)
  })

  it('未改动文档的事务不触发修复', () => {
    const state = createState(schema.nodes.doc.create(null, [para(null)]))
    const tr = state.tr.setMeta('noop', true)
    const { state: next, transactions } = state.applyTransaction(tr)
    expect(transactions).toHaveLength(1)
    expect(collectIds(next.doc)).toEqual([null])
  })

  it('修复事务不进历史记录（addToHistory=false）', () => {
    const state = createState(schema.nodes.doc.create(null, []))
    const tr = state.tr.insert(0, para(null))
    const { transactions } = state.applyTransaction(tr)
    expect(transactions).toHaveLength(2)
    expect(transactions[1].getMeta('addToHistory')).toBe(false)
  })
})
