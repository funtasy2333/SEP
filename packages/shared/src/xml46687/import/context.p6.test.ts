import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { buildImportIndex } from './context'

function index(xml: string) {
  const tree = parseXml46687(xml).tree!
  const ids = new Map<string, string>()
  function visit(e: XmlElement) {
    ids.set(e.position!.path, `node${ids.size}`)
    for (const child of e.children) if (child.type === 'element') visit(child)
  }
  visit(tree.root)
  return buildImportIndex(tree, { nodeIdsByPath: ids, resources: new Map() })
}
it('普通无类型缩略语目标可引用，但 figure 定义项不能冒充缩略语', () => {
  const result = index('<standard><body><def-list><def-item id="ab"/></def-list><def-list list-content="figure"><def-item id="figdef"/></def-list><p><xref ref-type="abbreviation" rid="ab"/><xref ref-type="abbreviation" rid="figdef"/></p></body></standard>')
  expect(result.index.byXmlId.get('ab')?.kind).toBe('abbreviation')
  expect(result.problems.filter(p => p.code === 'xml-reference-kind')).toHaveLength(1)
})
it('索引项内部参见可引用真实索引项，普通 xref 仍须验证目标种类', () => {
  const result = index('<standard><body><p><xref ref-type="sec" rid="entry"/></p></body><back><index><index-div><index-entry id="entry"/><index-entry id="other"><see-entry><xref ref-type="other" rid="entry"/></see-entry></index-entry></index-div></index></back></standard>')
  expect(result.problems.filter(p => p.code === 'xml-reference-kind')).toHaveLength(1)
})
