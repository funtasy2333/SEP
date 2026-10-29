import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
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

it('[M-4.5.4-04] 索引保留引用目标及参见目标', () => {
  const { root, ctx } = setup('<root><sec id="s"/><index><index-title-group><title>索引</title></index-title-group><index-div><index-entry><term>词</term><see-entry><xref ref-type="sec" rid="s">1</xref></see-entry><see-also><xref ref-type="sec" rid="s">1</xref></see-also></index-entry></index-div></index></root>')
  expect(mapIndex(child(root, 'index'), ctx)).toEqual({ id: 'n2', title: [{ text: '索引' }], groups: [{ id: 'n5', entries: [{ id: 'n6', term: [{ text: '词' }], targets: ['n1'], seeAlso: ['n1'] }] }] })
})

function findAll(e: XmlElement, name: string): XmlElement[] {
  return [ ...(e.name.local === name ? [e] : []), ...e.children.flatMap(c => c.type === 'element' ? findAll(c, name) : []) ]
}

it('[M-10.1.8-04] valid09 双脚注引用指向同一原位定义', () => {
  const xml = readFileSync('../../schemas/gbt46687.2/samples/valid/09-import-pending.xml', 'utf8')
  const { root, ctx } = setup(xml)
  const fn = findAll(root, 'fn')[0]!
  const parent = ctx.index.parent.get(fn)!
  const runs = readInlineChildren(parent, ctx)
  const refs = runs.filter(r => r.footnoteRef).map(r => r.footnoteRef!.targetId)
  const definitions = runs.filter(r => r.footnoteDefinition).map(r => r.footnoteDefinition!)
  expect(refs).toEqual([ctx.elementId(fn), ctx.elementId(fn)])
  expect(definitions).toEqual([{ id: ctx.elementId(fn), content: [{ text: '脚注内容。' }] }])
})

it('[M-4.4.2.3-03] 规范条目的未知文本不能悄悄丢弃', () => {
  const { root, ctx } = setup('<ref-list content-type="norm-refs"><ref>丢失风险<std><std-ref>GB 1</std-ref><title>名称</title></std></ref></ref-list>')
  mapReferenceBlock(root, ctx)
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-unsupported', severity: 'error' }))
})

it('[M-4.5.3-08] 尾部 URI 保留文献外链与位置之前的文本', () => {
  const { root, ctx } = setup('<ref-list content-type="bibl"><ref id="r"><mixed-citation>文献<break/><uri>https://example.org/a</uri></mixed-citation></ref></ref-list>')
  expect(mapBibliography(root, ctx)).toEqual([{ kind: 'bibEntry', id: 'n1', content: [{ text: '文献' }, { text: '\n' }], externalLink: { href: 'https://example.org/a', displayText: 'https://example.org/a' } }])
  expect(ctx.problems).toEqual([])
})

it('[M-4.5.4-04] 无身份索引引用保留显示文本并提示无法自动更新', () => {
  const { root, ctx } = setup('<index><index-div><index-entry><term>词</term><see-entry><italic>5.1</italic></see-entry></index-entry></index-div></index>')
  expect(mapIndex(root, ctx)?.groups[0]?.entries[0]).toMatchObject({ targets: [], seeAlso: [], sourceReferences: [{ type: 'see', content: [{ text: '5.1', marks: [{ type: 'italic' }] }] }] })
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', severity: 'warning' }))
})

it('[M-4.4.2.3-02] valid07 的异写规范清单和缩略语引用可映射', () => {
  const xml = readFileSync('../../schemas/gbt46687.2/samples/valid/07-import-variants.xml', 'utf8')
  const { root, ctx } = setup(xml)
  const list = findAll(root, 'ref-list').find(e => ctx.attr(e, null, 'content-type') === 'norm_refs')!
  expect(mapReferenceBlock(list, ctx)?.[0]).toMatchObject({ kind: 'normRefList', entries: [{ entryType: 'std', ref: [{ text: 'GB/T 1.1—2020' }] }] })
  const other = findAll(root, 'xref').find(e => ctx.attr(e, null, 'ref-type') === 'other')!
  expect(mapReferenceInline(other, ctx)).toEqual([{ text: 'GPS', marks: [{ type: 'crossRef', targetId: ctx.xmlTargetID('abb-gps'), targetKind: 'abbreviation' }] }])
  expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
})

it('[M-4.5.3-08] 中途 URI 因无法保留来源形式而拒绝', () => {
  const { root, ctx } = setup('<ref-list content-type="bibl"><ref id="r"><mixed-citation><uri>https://example.org</uri>后续</mixed-citation></ref></ref-list>')
  mapBibliography(root, ctx)
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-unsupported', severity: 'error' }))
})

it('[M-4.4.2.3-04] 规范引用内 URI 无来源字段时明确拒绝', () => {
  const { root, ctx } = setup('<ref-list content-type="norm-refs"><ref><mixed-citation>文本<uri>https://example.org</uri></mixed-citation></ref></ref-list>')
  mapReferenceBlock(root, ctx)
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-unsupported', severity: 'error' }))
})
