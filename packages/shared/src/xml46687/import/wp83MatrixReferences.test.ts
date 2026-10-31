import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { resolve as resolveIr } from '../../ir/resolve'
import type { IRDoc, IRInline } from '../../ir/types'
import { parseXml46687 } from '../parse'
import { getXmlAttr, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII='
function imported(name: string) {
  const source = readFileSync(`../../schemas/gbt46687.2/samples/valid/${name}`, 'utf8')
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
