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
