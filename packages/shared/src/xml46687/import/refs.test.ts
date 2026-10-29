import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { createImportContext } from './context'
import { mapCoreInline, readInlineChildren } from './inline'
import { mapReferenceInline, mapReferenceBlock, mapBibliography, mapIndex } from './refs'

function setup(xml: string) {
  const tree = parseXml46687(xml).tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: (el, c) => mapCoreInline(el, c) ?? mapReferenceInline(el, c) })
  return { root: tree.root, ctx }
}
const child = (el: XmlElement, name: string) => el.children.find((c): c is XmlElement => c.type === 'element' && c.name.local === name)!

it('[M-10.1.8-04] 两处引用共享原位定义且只保存一次正文', () => {
  const { root, ctx } = setup('<p><xref ref-type="fn" rid="f">1)</xref><xref ref-type="fn" rid="f">1)</xref><fn id="f"><label>1)</label><p>正文</p></fn></p>')
  const runs = readInlineChildren(root, ctx)
  expect(runs).toEqual([{ text: '', footnoteRef: { targetId: 'n3', refText: '1)' } }, { text: '', footnoteRef: { targetId: 'n3', refText: '1)' } }, { text: '', footnoteDefinition: { id: 'n3', content: [{ text: '正文' }] } }])
  expect(ctx.problems).toEqual([])
})

it('[M-4.4.2.3-03] 规范引用保留标准编号及标题，且不是参考文献', () => {
  const { root, ctx } = setup('<ref-list content-type="norm_refs"><ref id="r"><std><std-ref>GB 1</std-ref><title>名称</title></std></ref></ref-list>')
  expect(mapReferenceBlock(root, ctx)).toEqual([{ kind: 'normRefList', id: 'n0', entries: [{ kind: 'normRef', id: 'n1', entryType: 'std', ref: [{ text: 'GB 1' }], title: [{ text: '名称' }] }] }])
  expect(mapBibliography(root, ctx)).toBeUndefined()
})

it('[M-4.5.3-05] 参考文献保留标准字段及不透明身份', () => {
  const { root, ctx } = setup('<ref-list content-type="bibl"><ref id="opaque"><label>[1]</label><std><std-ref>GB 1</std-ref><title>名称</title></std></ref></ref-list>')
  expect(mapBibliography(root, ctx)).toEqual([{ kind: 'bibEntry', id: 'n1', content: [{ text: 'GB 1' }, { text: '名称' }], entryType: 'standard', fields: [{ id: 'n4', name: 'std-ref', value: [{ text: 'GB 1' }] }, { id: 'n5', name: 'title', value: [{ text: '名称' }] }] }])
})

it('[M-4.5.4-01] 无关元素不被索引处理器认领', () => {
  const { root, ctx } = setup('<p>文本</p>')
  expect(mapIndex(root, ctx)).toBeUndefined()
  expect(child(root, 'none')).toBeUndefined()
})

it('[M-10.1.8-03] 相邻单次引用维持原有脚注表示', () => {
  const { root, ctx } = setup('<p><xref ref-type="fn" rid="f">1)</xref><fn id="f"><label>1)</label><p><bold>正文</bold></p></fn></p>')
  expect(readInlineChildren(root, ctx)).toEqual([{ text: '', footnote: { id: 'n2', content: [{ text: '正文', marks: [{ type: 'bold' }] }] } }])
})

it('[M-10.1.1-01] 规范文献目标的交叉引用明确拒绝', () => {
  const { root, ctx } = setup('<root><ref-list content-type="norm-refs"><ref id="r"><mixed-citation>文本</mixed-citation></ref></ref-list><p><xref ref-type="bibr" rid="r">文献</xref></p></root>')
  const xref = child(child(root, 'p'), 'xref')
  expect(mapReferenceInline(xref, ctx)).toEqual([])
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-unsupported', severity: 'error' }))
})

it('[M-10.1.4-01] 多段缩略语释义保留并提示归一化', () => {
  const { root, ctx } = setup('<def-list list-content="abbreviation"><def-item id="x"><term>CPU</term><def><p>甲</p><p>乙</p></def></def-item></def-list>')
  expect(mapReferenceBlock(root, ctx)).toEqual([{ kind: 'defList', id: 'n0', items: [{ id: 'n1', term: [{ text: 'CPU' }], definition: [{ text: '甲' }, { text: '\n' }, { text: '乙' }] }] }])
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', severity: 'warning' }))
})
