import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { irToPm } from '../../ir/irToPm'
import { pmToIr } from '../../ir/pmToIr'
import type { IRDoc, IRTable } from '../../ir/types'
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

it('[M-4.5.4-05] 参见索引项通过其真实元素解析身份', () => {
  const { root, ctx } = setup('<index><index-div><index-entry id="first"><term>甲</term><see-also-entry><xref ref-type="other" rid="second">乙</xref></see-also-entry></index-entry><index-entry id="second"><term>乙</term></index-entry></index-div></index>')
  const result = mapIndex(root, ctx)!
  expect(result.groups[0]?.entries[0]?.seeAlso).toEqual([ctx.elementId(resultTarget(root))])
})
function resultTarget(root: XmlElement): XmlElement {
  return findAll(root, 'index-entry').find(e => e.attrs.some(a => a.name.local === 'id' && a.value === 'second'))!
}

it('[M-4.5.4-04] 交错的实名与显示文字索引目标不能保序时拒绝', () => {
  const { root, ctx } = setup('<root><sec id="s"/><index><index-div><index-entry><term>词</term><see-entry>甲</see-entry><see-entry><xref ref-type="sec" rid="s">1</xref></see-entry></index-entry></index-div></index></root>')
  mapIndex(child(root, 'index'), ctx)
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-unsupported', severity: 'error' }))
})

it.each([
  ['valid03', '../../schemas/gbt46687.2/samples/valid/03-structure.xml', 'https://example.org/', '示例网站'],
  ['wp82', 'src/renderers/__tests__/__snapshots__/xml46687.wp82.xml', 'mailto:sac@example.org', '邮件'],
  ['wp6', 'src/renderers/__tests__/__snapshots__/xml46687.wp6.xml', 'https://example.org/spec', ' 官方链接'],
])('[M-10.1.9-01] 完整样例 %s 的外链保留文本和样式', (_label, path, href, expectedText) => {
  const { root, ctx } = setup(readFileSync(path, 'utf8'))
  const links = findAll(root, 'ext-link')
  const link = links.find(e => ctx.attr(e, 'http://www.w3.org/1999/xlink', 'href') === href)!
  expect(link).toBeDefined()
  const runs = mapReferenceInline(link, ctx)
  expect(runs).toBeDefined()
  if (!runs) return
  const expectedHref = ctx.attr(link, 'http://www.w3.org/1999/xlink', 'href')!
  expect(runs.map(r => r.text).join('')).toBe(expectedText)
  expect(runs.every(r => r.marks?.some(m => m.type === 'externalLink' && m.href === expectedHref))).toBe(true)
  if (expectedText === '邮件') expect(runs[0]?.marks).toContainEqual({ type: 'bold' })
  expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
})

it.each(['javascript:alert(1)', 'data:text/html,evil', 'java&#x9;script:evil'])('[M-10.1.9-02] 直接映射拒绝危险链接 %s', href => {
  const { root, ctx } = setup(`<ext-link xmlns:x="http://www.w3.org/1999/xlink" x:href="${href}">链接</ext-link>`)
  expect(mapReferenceInline(root, ctx)).toEqual([])
  expect(ctx.problems).toContainEqual(expect.objectContaining({ severity: 'error' }))
})

it('[M-10.1.9-01] 直接映射拒绝无法保真的未知属性', () => {
  const { root, ctx } = setup('<ext-link xmlns:x="http://www.w3.org/1999/xlink" x:href="https://example.org" title="丢失">链接</ext-link>')
  expect(mapReferenceInline(root, ctx)).toEqual([])
  expect(ctx.problems).toContainEqual(expect.objectContaining({ severity: 'error' }))
})

it('[M-6.2.3-08] valid04 表脚注引用使用单一原子并保留独立身份', () => {
  const { root, ctx } = setup(readFileSync('../../schemas/gbt46687.2/samples/valid/04-tables.xml', 'utf8'))
  const refs = findAll(root, 'xref').filter(e => ctx.attr(e, null, 'ref-type') === 'table-fn')
  expect(refs).toHaveLength(2)
  for (const ref of refs) {
    const rid = ctx.attr(ref, null, 'rid')!
    expect(mapReferenceInline(ref, ctx)).toEqual([{ text: '', marks: [{ type: 'tableFootnoteRef', targetId: ctx.xmlTargetID(rid), id: ctx.elementId(ref) }] }])
  }
  expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
})

it('[M-6.2.3-08] 表脚注引用显示文字与定义不同则提示会重新编号', () => {
  const xml = '<table-wrap><table><tr><td><xref ref-type="table-fn" rid="f">旧号</xref></td></tr></table><table-wrap-foot><fn id="f"><label>a</label><p>正文</p></fn></table-wrap-foot></table-wrap>'
  const { root, ctx } = setup(xml)
  mapReferenceInline(findAll(root, 'xref')[0]!, ctx)
  expect(ctx.problems).toContainEqual(expect.objectContaining({ code: 'xml-normalized', severity: 'warning' }))
})

it('[M-6.2.3-08] 重复引用保留目标首次引用对应的编号', () => {
  const xml = '<table-wrap><table><tr><td><xref ref-type="table-fn" rid="a">a</xref><xref ref-type="table-fn" rid="b">b</xref><xref ref-type="table-fn" rid="a">a</xref></td></tr></table><table-wrap-foot><fn id="a"><label>a</label><p>甲</p></fn><fn id="b"><label>b</label><p>乙</p></fn></table-wrap-foot></table-wrap>'
  const { root, ctx } = setup(xml)
  for (const ref of findAll(root, 'xref')) mapReferenceInline(ref, ctx)
  expect(ctx.problems).toEqual([])
})

it('[M-6.2.3-08] 表脚注原子经生产 PM 往返保留引用与定义身份', () => {
  const { root, ctx } = setup(readFileSync('../../schemas/gbt46687.2/samples/valid/04-tables.xml', 'utf8'))
  const ref = findAll(root, 'xref').find(e => ctx.attr(e, null, 'ref-type') === 'table-fn')!
  const rid = ctx.attr(ref, null, 'rid')!
  const targetId = ctx.xmlTargetID(rid)!
  const runs = mapReferenceInline(ref, ctx)!
  const table: IRTable = { kind: 'table', id: 'table', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [], footnotes: [{ id: targetId, content: [{ text: '内容' }] }], rows: [{ id: 'row', cells: [{ id: 'cell', colspan: 1, rowspan: 1, header: false, content: [{ kind: 'paragraph', id: 'paragraph', content: runs }] }] }] }
  const doc: IRDoc = { schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] }, body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [], children: [table] }], appendices: [], bibliography: [] }
  const reopened = pmToIr(irToPm(doc)).doc.body[0]!.children[0] as IRTable
  expect(reopened.rows[0]!.cells[0]!.content[0]).toMatchObject({ kind: 'paragraph', content: runs })
  expect(reopened.footnotes?.[0]?.id).toBe(targetId)
})
