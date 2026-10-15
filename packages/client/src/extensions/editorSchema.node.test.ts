// @vitest-environment node
/**
 * 守护测试：编辑器的生产扩展必须能在没有 DOM 的纯 Node 环境加载并构建 schema。
 *
 * 服务端（@ses/server）依赖这一点：它把 editorSchema.ts 及其依赖链打入 webpack 产物（jest 中直接加载源码），
 * 用生产 schema 校验文档内容、规范化 nodeId（见 packages/server/src/editor-schema/）。服务端进程里没有
 * window / document，所以扩展在模块加载与 getSchema() 期间不得访问浏览器对象：NodeView、插件回调、
 * 事件派发里的访问是允许的（它们只在编辑器视图存在时运行），模块顶层与扩展配置阶段不行。
 *
 * 本文件用 node 环境、且在测试体内动态导入，违反时失败信息直接指向抛错的那一行，而不是整个套件加载失败。
 * 另一条约束：这条依赖链不得使用 `@/` 别名导入（服务端的 webpack 与 jest 不认识它），见最后一个用例。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import { createWp6Fixture } from './__fixtures__/wp6'

async function loadEditorSchema() {
  return import('./editorSchema')
}

function collectNodeIds(node: PMJsonNode, ids: string[] = []): string[] {
  const nodeId = node.attrs?.nodeId
  if (typeof nodeId === 'string' && nodeId !== '') ids.push(nodeId)
  for (const child of node.content ?? []) collectNodeIds(child, ids)
  return ids
}

/** 找出所有携带 nodeId 属性的节点（含值为空的），先序。 */
function nodesWithNodeIdAttr(node: PMJsonNode, found: PMJsonNode[] = []): PMJsonNode[] {
  if (node.attrs && 'nodeId' in node.attrs) found.push(node)
  for (const child of node.content ?? []) nodesWithNodeIdAttr(child, found)
  return found
}

describe('生产 schema 在无 DOM 的 Node 环境（服务端依赖）', () => {
  it('运行环境没有浏览器全局对象（否则本守护测试不成立）', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })

  it('导入 editorSchema 并构建 schema：根节点 doc，含生产节点类型', async () => {
    const { createEditorSchema } = await loadEditorSchema()
    const schema = createEditorSchema()
    expect(schema.topNodeType.name).toBe('doc')
    for (const name of ['coverPage', 'chapter', 'clause', 'stdParagraph', 'stdTable', 'figure', 'formula', 'termDef']) {
      expect(schema.nodes[name], name).toBeDefined()
    }
  })

  it('createEditorExtensions() 本身可在 Node 环境导入与调用', async () => {
    const { createEditorExtensions } = await import('./editorExtensions')
    expect(createEditorExtensions().length).toBeGreaterThan(50)
  })

  it('典型文档：nodeFromJSON().check() 通过，toJSON() 往返不变', async () => {
    const { createEditorSchema } = await loadEditorSchema()
    const schema = createEditorSchema()
    const fixture = createWp6Fixture()
    const doc = schema.nodeFromJSON(fixture)
    expect(() => doc.check()).not.toThrow()
    expect(doc.toJSON()).toEqual(JSON.parse(JSON.stringify(doc.toJSON())))
    // 夹具本身就是生产形态：往返后 nodeId 集合不变。
    expect(collectNodeIds(doc.toJSON() as PMJsonNode).sort()).toEqual(collectNodeIds(fixture).sort())
  })

  it('不符合 schema 的文档被拒绝（check 不是摆设）', async () => {
    const { createEditorSchema } = await loadEditorSchema()
    const schema = createEditorSchema()
    expect(() => schema.nodeFromJSON({ type: 'noSuchNode' })).toThrow(RangeError)
    // 章必须以 chapterTitle 开头。
    const invalid = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'chapter', content: [{ type: 'stdParagraph' }] }],
    })
    expect(() => invalid.check()).toThrow(RangeError)
  })

  it('normalizeNodeIds：补齐缺失的 nodeId，重复的保留首个、其余重新生成', async () => {
    const { createEditorSchema, normalizeNodeIds } = await loadEditorSchema()
    const schema = createEditorSchema()
    // 先经 schema 往返：toJSON() 会给缺省的 nodeId 属性补上 null，这样规范化前后的节点集合一致。
    const json = JSON.parse(JSON.stringify(schema.nodeFromJSON(createWp6Fixture()).toJSON())) as PMJsonNode
    const withId = nodesWithNodeIdAttr(json).filter((node) => typeof node.attrs?.nodeId === 'string')
    expect(withId.length).toBeGreaterThan(4)
    const [missing, original, duplicate] = [withId[1]!, withId[2]!, withId[3]!]
    const originalId = original.attrs!.nodeId as string
    missing.attrs!.nodeId = null
    duplicate.attrs!.nodeId = originalId

    // 规范化只改属性、不改结构：前后节点顺序一致，可按下标对应。
    const before = nodesWithNodeIdAttr(json)
    const normalized = normalizeNodeIds(schema.nodeFromJSON(json))
    expect(() => normalized.check()).not.toThrow()
    const after = nodesWithNodeIdAttr(normalized.toJSON() as PMJsonNode)
    expect(after).toHaveLength(before.length)

    const ids = after.map((node) => node.attrs!.nodeId)
    expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(after[before.indexOf(original)]!.attrs!.nodeId).toBe(originalId)
    expect(after[before.indexOf(duplicate)]!.attrs!.nodeId).not.toBe(originalId)
    expect(typeof after[before.indexOf(missing)]!.attrs!.nodeId).toBe('string')
  })

  it('扩展依赖链不使用 `@/` 别名导入（服务端的 webpack 与 jest 不认识它）', () => {
    const root = fileURLToPath(new URL('.', import.meta.url))
    const offenders: string[] = []
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__fixtures__') visit(path)
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          if (/(?:from|import)\s*\(?\s*['"]@\//.test(readFileSync(path, 'utf8'))) offenders.push(path)
        }
      }
    }
    visit(root)
    expect(offenders).toEqual([])
  })
})
