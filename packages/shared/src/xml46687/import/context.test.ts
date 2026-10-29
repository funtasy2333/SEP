import { describe, expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlDocument, XmlElement } from '../tree'
import { buildImportIndex, createImportContext } from './context'

function fixture(xml: string): { tree: XmlDocument; ids: Map<string, string> } {
  const tree = parseXml46687(xml).tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => {
    ids.set(el.position!.path, `n${ids.size}`)
    el.children.forEach(child => { if (child.type === 'element') visit(child) })
  }
  visit(tree.root)
  return { tree, ids }
}

describe('导入索引与上下文', () => {
  it('不透明双术语 ID 指向同一个实体，引用和脚注计数跨上下文解析', () => {
    const { tree, ids } = fixture('<standard xmlns:t="urn:iso:std:iso:30042:ed-1"><body><sec id="outside"><term-sec id="outer"><t:termEntry id="inner"/></term-sec><p><xref ref-type="custom" custom-type="term-entry" rid="inner"/><xref ref-type="fn" rid="foot"/><xref ref-type="fn" rid="foot"/><fn id="foot"/></p></sec></body></standard>')
    const result = buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
    expect(result.problems).toEqual([])
    expect(result.index.byXmlId.get('outer')?.nodeId).toBe(result.index.byXmlId.get('inner')?.nodeId)
    expect(result.index.byXmlId.get('outer')?.kind).toBe('term')
    expect(result.index.footnoteReferenceCounts.get('foot')).toBe(2)
  })

  it('重复、非法、悬空和错误目标均报错', () => {
    const { tree, ids } = fixture('<standard><body><sec id="same"/><fig id="same"/><sec id="1bad"/><p><xref ref-type="table" rid="same"/><xref ref-type="sec" rid="absent"/></p></body></standard>')
    const result = buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
    expect(result.problems.map(p => p.code)).toEqual(expect.arrayContaining(['xml-id-duplicate', 'xml-id-invalid', 'xml-reference-dangling', 'xml-reference-kind']))
  })

  it('缺失和重复分配、缺资源、未知处理器明确报错且不修改输入', () => {
    const { tree, ids } = fixture('<standard xmlns:x="http://www.w3.org/1999/xlink"><body><graphic x:href="a"/><sec/></body></standard>')
    const before = JSON.stringify(tree)
    const paths = [...ids.keys()]
    ids.delete(paths[1]!)
    ids.set(paths[3]!, ids.get(paths[2]!)!)
    const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, {})
    expect(ctx.problems.map(p => p.code)).toEqual(expect.arrayContaining(['xml-node-id-missing', 'xml-node-id-duplicate']))
    const body = tree.root.children[0] as XmlElement
    const graphic = body.children[0] as XmlElement
    expect(ctx.requiredResource(graphic)).toBeUndefined()
    expect(ctx.dispatchBlock(graphic)).toBeUndefined()
    expect(ctx.problems.map(p => p.code)).toEqual(expect.arrayContaining(['xml-resource-missing', 'xml-unsupported']))
    expect(JSON.stringify(tree)).toBe(before)
  })
})

describe('索引边界', () => {
  it('前言和引言容器无实体，引言子条有实体', () => {
    const { tree, ids } = fixture('<standard><front><sec id="front" sec-type="foreword"/><sec id="intro" sec-type="intro"><sec id="child"/></sec></front></standard>')
    const { index } = buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
    expect(index.byXmlId.has('front')).toBe(false)
    expect(index.byXmlId.has('intro')).toBe(false)
    expect(index.byXmlId.get('child')?.kind).toBe('clause')
  })
  it('同时索引 id 和 xml:id 并检测重复及术语 target 悬空', () => {
    const { tree, ids } = fixture('<standard xmlns:t="urn:iso:std:iso:30042:ed-1"><body><sec id="a" xml:id="alias"/><sec id="alias"/><t:entailedTerm target="missing"/></body></standard>')
    const { index, problems } = buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
    expect(index.byXmlId.get('a')?.nodeId).toBe(index.byXmlId.get('alias')?.nodeId)
    expect(problems.map(p => p.code)).toEqual(expect.arrayContaining(['xml-id-duplicate', 'xml-reference-dangling']))
  })
})

describe('派生段落身份', () => {
  it('单段容器使用生产 Schema 的派生 ID，并拒绝与预分配 ID 冲突', () => {
    const { tree, ids } = fixture('<standard><body><list-item/><p/></body></standard>')
    const body = tree.root.children[0] as XmlElement
    const item = body.children[0] as XmlElement
    const paragraph = body.children[1] as XmlElement
    ids.set(item.position!.path, 'item')
    ids.set(paragraph.position!.path, 'item.p0')
    const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, {})
    expect(ctx.singleParagraphId(item)).toBeUndefined()
    expect(ctx.problems.map(p => p.code)).toContain('xml-node-id-duplicate')
    ids.set(paragraph.position!.path, 'other')
    const clean = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, {})
    expect(clean.singleParagraphId(item)).toBe('item.p0')
  })
})

describe('纯资源与分发', () => {
  it('按命名空间 URI 查资源，返回副本且分发持有独立问题状态', () => {
    const { tree, ids } = fixture('<standard xmlns:alias="http://www.w3.org/1999/xlink"><graphic alias:href="img"/></standard>')
    const resource = Object.freeze({ src: 'data:image/png;base64,AA==', mediaType: 'image/png', resourceId: 'r' })
    const resources = new Map([['img', resource]])
    const opts = { nodeIdsByPath: ids, resources }
    const graphic = tree.root.children[0] as XmlElement
    const first = createImportContext(tree, opts, { inline: () => [{ text: '内容' }] })
    const second = createImportContext(tree, opts, {})
    expect(first.requiredResource(graphic)).toEqual(resource)
    expect(first.requiredResource(graphic)).not.toBe(resource)
    expect(first.dispatchInline(graphic)).toEqual([{ text: '内容' }])
    second.dispatchInline(graphic)
    expect(first.problems).toEqual([])
    expect(second.problems[0]?.code).toBe('xml-unsupported')
    expect(resources.get('img')).toBe(resource)
  })
})

it('注册处理器拒绝未知元素时必须报告错误', () => {
  const { tree, ids } = fixture('<standard><unknown/></standard>')
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { block: () => undefined })
  expect(ctx.dispatchBlock(tree.root.children[0] as XmlElement)).toBeUndefined()
  expect(ctx.problems.map(p => p.code)).toContain('xml-unsupported')
})

it('构造术语时元素 ID 与双 XML ID 使用同一身份', () => {
  const { tree, ids } = fixture('<standard xmlns:t="urn:iso:std:iso:30042:ed-1"><body><term-sec id="container"><t:termEntry id="entry"/></term-sec></body></standard>')
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, {})
  const entry = ctx.index.elementsByXmlId.get('entry')!
  expect(ctx.elementId(entry)).toBe(ctx.xmlTargetID('container'))
  expect(ctx.elementId(entry)).toBe(ctx.xmlTargetID('entry'))
})

it('无实体的容器不能冒充引用目标', () => {
  const { tree, ids } = fixture('<standard><body><list id="l"><list-item id="item"/></list><fig-group id="group"/><ref-list id="refs"/><p><xref ref-type="list" rid="l"/><xref ref-type="list" rid="item"/><xref ref-type="fig" rid="group"/><xref ref-type="sec" rid="refs"/></p></body></standard>')
  const { index, problems } = buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
  expect(index.byXmlId.has('l')).toBe(false)
  expect(index.byXmlId.has('group')).toBe(false)
  expect(index.byXmlId.has('refs')).toBe(false)
  expect(index.byXmlId.get('item')?.kind).toBe('listItem')
  expect(problems.filter(p => p.code === 'xml-reference-kind')).toHaveLength(3)
})

it('术语关联必须指向 TBX termEntry，不接受章或术语容器', () => {
  const { tree, ids } = fixture('<standard xmlns:t="urn:iso:std:iso:30042:ed-1"><body><sec id="chapter"/><term-sec id="container"><t:termEntry id="entry"/></term-sec><t:entailedTerm target="chapter"/><t:entailedTerm target="container"/><t:entailedTerm target="entry"/></body></standard>')
  const { problems } = buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
  expect(problems.filter(p => p.code === 'xml-reference-kind')).toHaveLength(2)
})

it('非法根结构不会令缩略语分类抛出异常', () => {
  const { tree, ids } = fixture('<def-item id="orphan"/>')
  const { index } = buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
  expect(index.byXmlId.has('orphan')).toBe(false)
})
