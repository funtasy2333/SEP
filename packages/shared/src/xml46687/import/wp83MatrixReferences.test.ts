import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { resolve as resolveIr } from '../../ir/resolve'
import type { IRDoc, IRInline } from '../../ir/types'
import { parseXml46687 } from '../parse'
import { getXmlAttr, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII='
function imported(name: string, modify: (xml: string) => string = xml => xml) {
  const source = modify(readFileSync(`../../schemas/gbt46687.2/samples/valid/${name}`, 'utf8'))
  const parsed = parseXml46687(source)
  expect(parsed.problems).toEqual([])
  const ids = new Map<string, string>()
  const elements = new Map<string, XmlElement>()
  const resources = new Map<string, { src: string; mediaType: string }>()
  function visit(el: XmlElement) {
    ids.set(el.position!.path, `matrix-${ids.size}`)
    const xmlId = getXmlAttr(el, null, 'id')
    if (xmlId) elements.set(xmlId, el)
    if (el.name.local === 'graphic' || el.name.local === 'inline-graphic') {
      const href = getXmlAttr(el, XLINK_NS, 'href')
      if (href) resources.set(href, { src: png, mediaType: 'image/png' })
    }
    el.children.forEach(c => { if (c.type === 'element') visit(c) })
  }
  visit(parsed.tree!.root)
  const result = mapXml46687(parsed.tree!, { nodeIdsByPath: ids, resources })
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(result.ir).not.toBeNull()
  const xmlId = (id: string) => ids.get(elements.get(id)!.position!.path)!
  return { doc: result.ir as IRDoc, xmlId, problems: result.problems }
}
function inlines(value: unknown): IRInline[] {
  if (Array.isArray(value)) return value.flatMap(inlines)
  if (!value || typeof value !== 'object') return []
  const o = value as Record<string, unknown>
  return [...(typeof o.text === 'string' ? [o as unknown as IRInline] : []), ...Object.values(o).flatMap(inlines)]
}

it('[M-4.4.2.3-04] 规范性引用的非标准文献保留原有正文', () => {
  const { doc } = imported('03-structure.xml')
  const chapter = doc.body.find(c => c.secType === 'norm-refs')!
  const list = chapter.children.find(c => c.kind === 'normRefList')!
  if (list.kind !== 'normRefList') throw new Error('缺规范引用清单')
  expect(list.entries[1]).toMatchObject({ kind: 'normRef', entryType: 'mixed', content: [{ text: 'Example Corp. Interface specification, version 3 [EB/OL].' }] })
})

it('[M-4.5.3-06] 参考文献混合引文保留正文与尾部 URI', () => {
  const { doc } = imported('03-structure.xml')
  expect(doc.bibliography[1]).toMatchObject({ kind: 'bibEntry', content: [{ text: '李四.标准数字化概论[M].北京:示例出版社,2024.' }, { text: '\n' }], externalLink: { href: 'https://example.org/book' } })
})

it('[M-10.1.9-02] 外链 href 与显示文字保持关联', () => {
  const { doc } = imported('03-structure.xml')
  expect(inlines(doc.body)).toContainEqual(expect.objectContaining({ text: '示例网站', marks: expect.arrayContaining([{ type: 'externalLink', href: 'https://example.org/' }]) }))
})

it('[M-4.5.3.1-01] 文献条目以 XML ref 的分配身份进入文献表', () => {
  const { doc, xmlId } = imported('03-structure.xml')
  expect(doc.bibliography.map(entry => entry.id)).toEqual([xmlId('biblref_1'), xmlId('biblref_2')])
  expect(doc.bibliography.map(entry => entry.kind)).toEqual(['bibEntry', 'bibEntry'])
})


it('[M-9.1-01] 术语章按 sec-type 进入章节类型', () => {
  const { doc, xmlId } = imported('06-terms-references.xml')
  expect(doc.body.find(chapter => chapter.id === xmlId('sec_3'))?.secType).toBe('terms')
})

it('[M-9.2.1-01] 每个 term-sec 形成独立术语条目', () => {
  const { doc, xmlId } = imported('06-terms-references.xml')
  const chapter = doc.body.find(c => c.secType === 'terms')!
  const clause = chapter.children.find(c => c.kind === 'clause')!
  if (clause.kind !== 'clause') throw new Error('缺术语条')
  expect(clause.children.filter(c => c.kind === 'termEntry').map(c => c.id)).toEqual([xmlId('sec_3.1.1'), xmlId('sec_3.1.2')])
})

it('[M-9.2.1-02] term-sec id 作为不透明身份并供引用使用', () => {
  const { doc, xmlId } = imported('06-terms-references.xml')
  const target = xmlId('sec_3.1.1')
  expect(inlines(doc.body)).toContainEqual(expect.objectContaining({ marks: expect.arrayContaining([{ type: 'termRef', targetId: target }]) }))
})

it('[M-9.2.1-03] 术语标签由 Resolver 重新生成而不采信源标签', () => {
  const original = imported('06-terms-references.xml')
  const changed = imported('06-terms-references.xml', xml => xml.replace('<label>3.1.1</label>', '<label>9.9.9</label>'))
  const before = resolveIr(original.doc).labels[original.xmlId('sec_3.1.1')]
  const after = resolveIr(changed.doc).labels[changed.xmlId('sec_3.1.1')]
  expect(before?.label).toBeTruthy()
  expect(after?.label).toBe(before?.label)
  expect(after?.label).not.toBe('9.9.9')
})

it('[M-9.2.1-04] TBX 条目语言组、术语文本和定义进入对应条目', () => {
  const { doc, xmlId } = imported('06-terms-references.xml')
  const chapter = doc.body.find(c => c.secType === 'terms')!
  const clause = chapter.children.find(c => c.kind === 'clause')!
  if (clause.kind !== 'clause') throw new Error('缺术语条')
  const term = clause.children.find(c => c.kind === 'termEntry' && c.id === xmlId('sec_3.1.1'))!
  if (term.kind !== 'termEntry') throw new Error('缺术语')
  expect(term.languageSets?.[0]?.groups[0]?.terms[0]?.content).toEqual([{ text: '标准化文件' }])
  expect(term.definition[0]).toMatchObject({ kind: 'paragraph', content: expect.arrayContaining([{ text: '规定了' }]) })
})

it('[M-9.2.1-05] TBX id 和 term-sec id 指向同一条目并派生术语标识', () => {
  const { doc, xmlId } = imported('06-terms-references.xml')
  const termId = xmlId('sec_3.1.2')
  expect(inlines(doc.body)).toContainEqual(expect.objectContaining({ text: '要求 (3.1.2)', marks: expect.arrayContaining([{ type: 'termRef', targetId: termId }]) }))
  const label = resolveIr(doc).labels[termId]
  expect(label?.termEntryXmlId).toBe(`term_${label?.label}`)
  expect(label?.xmlId).toBe(`sec_${label?.label}`)
})

it('[M-10.1.1-01] 正文 xref 形成具目标类型的引用', () => {
  const { doc, xmlId } = imported('03-structure.xml')
  expect(inlines(doc.body)).toContainEqual(expect.objectContaining({ text: '5.2', marks: expect.arrayContaining([{ type: 'crossRef', targetId: xmlId('sec_5.2'), targetKind: 'clause' }]) }))
})

it('[M-10.1.1-02] 引用 rid 指向目标条目的真实内部身份', () => {
  const { doc, xmlId } = imported('03-structure.xml')
  const target = xmlId('biblref_1')
  expect(doc.bibliography[0]?.id).toBe(target)
  expect(inlines(doc.body)).toContainEqual(expect.objectContaining({ text: '[1]', marks: expect.arrayContaining([{ type: 'bibRef', targetId: target }]) }))
})

it('[M-10.1.6-02] bibl 和 bibr 异写均映射为参考文献列表', () => {
  const canonical = imported('03-structure.xml')
  const variant = imported('07-import-variants.xml')
  expect(canonical.doc.bibliography.map(entry => entry.id)).toEqual([canonical.xmlId('biblref_1'), canonical.xmlId('biblref_2')])
  expect(variant.doc.bibliography).toMatchObject([{ kind: 'bibEntry', id: variant.xmlId('biblref_1'), content: [{ text: '文献条目。' }] }])
})

it('[M-4.5.3-04] 文献 label 被重新编号且不作为正文', () => {
  const original = imported('03-structure.xml')
  const changed = imported('03-structure.xml', xml => xml.replace('<label>[1]</label>', '<label>[999]</label>'))
  const id = changed.xmlId('biblref_1')
  expect(changed.doc.bibliography[0]).toEqual(original.doc.bibliography[0])
  expect(resolveIr(changed.doc).labels[id]?.label).toBe('[1]')
})

it('[M-4.5.3.1-02] 文献编号与源 label 无关且引用指向该条', () => {
  const changed = imported('03-structure.xml', xml => xml.replace('<label>[1]</label>', '<label>[999]</label>'))
  const id = changed.xmlId('biblref_1')
  expect(resolveIr(changed.doc).labels[id]).toMatchObject({ label: '[1]', xmlId: 'biblref_1' })
  expect(inlines(changed.doc.body)).toContainEqual(expect.objectContaining({ marks: expect.arrayContaining([{ type: 'bibRef', targetId: id }]) }))
})
