import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { computeOrderedListMarkers, resolve as resolveIr } from '../../ir/resolve'
import { parseXml46687 } from '../parse'
import { getXmlAttr, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
const sample = (name: string) => readFileSync(new URL(`../../../../../schemas/gbt46687.2/samples/valid/${name}`, import.meta.url), 'utf8')
function mapComplete(xml: string) {
  const parsed = parseXml46687(xml)
  expect(parsed.problems).toEqual([])
  expect(parsed.tree).not.toBeNull()
  const tree = parsed.tree!
  const ids = new Map<string, string>()
  const resources = new Map<string, { src: string; mediaType: string; resourceId: string }>()
  const visit = (el: XmlElement) => {
    const path = el.position!.path
    ids.set(path, `node:${path}`)
    const href = ['graphic', 'inline-graphic'].includes(el.name.local) ? getXmlAttr(el, XLINK_NS, 'href') : undefined
    if (href) resources.set(href, { src: png, mediaType: 'image/png', resourceId: `resource:${href}` })
    for (const child of el.children) if (child.type === 'element') visit(child)
  }
  visit(tree.root)
  const result = mapXml46687(tree, { nodeIdsByPath: ids, resources })
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(result.ir).not.toBeNull()
  return { doc: result.ir!, problems: result.problems }
}

it('[M-4.1-04] front 中的元数据、前言和引言分别进入文档字段', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  expect(doc.meta.title).toBe('结构示例')
  expect(doc.front.foreword).toMatchObject([{ kind: 'paragraph', content: [{ text: '本文件用于演示章、条、无标题条、附录、参考文献和索引的标记。' }] }])
  expect(doc.front.introduction).toMatchObject([{ kind: 'paragraph', content: [{ text: '引言可以只含段落。' }] }])
})

it('[M-4.4.2.1-01] 章及嵌套条保留结构和深度', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  const chapter = doc.body[3]!
  expect(chapter).toMatchObject({ kind: 'chapter', title: [{ text: '技术要求' }] })
  expect(chapter.children[0]).toMatchObject({ kind: 'clause', level: 1, title: [{ text: '总体要求' }], children: expect.arrayContaining([expect.objectContaining({ kind: 'clause', level: 2, titled: false })]) })
})

it('[M-4.4.2.1-04] 章中的 p 按原文字进入段落', () => {
  const { doc } = mapComplete(sample('01-minimal.xml'))
  expect(doc.body[0]!.children).toMatchObject([{ kind: 'paragraph', content: [{ text: '本文件给出一个只含必需结构的最小文档。' }] }])
})

it('[M-4.4.2.1-02] 章标签由 Resolver 根据结构生成', () => {
  const { doc } = mapComplete(sample('01-minimal.xml'))
  const labels = resolveIr(doc).labels
  expect(labels[doc.body[0]!.id]).toMatchObject({ label: '1' })
  expect(doc.body[0]).toMatchObject({ kind: 'chapter', title: [{ text: '范围' }] })
})


it('[M-4.3.2-30] 合法处理元数据只用于验证，不进入标准内容', () => {
  const xml = sample('01-minimal.xml')
  const withoutProcessing = xml.replace(/  <processing-meta[\s\S]*?\/>\n/, '')
  expect(withoutProcessing).not.toBe(xml)
  expect(mapComplete(xml).doc).toEqual(mapComplete(withoutProcessing).doc)
})

it('[M-4.3.2-31] 处理元数据中的指南名称和版本不进入标准正文', () => {
  const xml = sample('02-full-metadata.xml')
  const withoutCustom = xml.replace(/    <custom-meta-group>[\s\S]*?<\/custom-meta-group>\n/, '')
  expect(withoutCustom).not.toBe(xml)
  expect(mapComplete(xml).doc).toEqual(mapComplete(withoutCustom).doc)
})

it('[M-4.4.2.1-03] 章标题行内斜体及文字保留', () => {
  const xml = sample('01-minimal.xml').replace('<title>范围</title>', '<title>范<italic>围</italic></title>')
  const { doc } = mapComplete(xml)
  expect(doc.body[0]!.title).toEqual([{ text: '范' }, { text: '围', marks: [{ type: 'italic' }] }])
})

it('[M-4.5.2-03] 附录标签由结构派生，附录题名与性质保留', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  expect(doc.appendices.map(a => [a.normative, a.title])).toEqual([[false, [{ text: '资料性附录示例' }]], [true, [{ text: '规范性附录示例' }]]])
  const labels = resolveIr(doc).labels
  expect(doc.appendices.map(a => labels[a.id]?.label)).toEqual(['附录A', '附录B'])
})

it('[M-5.2-01] 章标签被重新派生且未混入题名或正文', () => {
  const { doc } = mapComplete(sample('01-minimal.xml'))
  const chapter = doc.body[0]!
  expect(resolveIr(doc).labels[chapter.id]?.label).toBe('1')
  expect(chapter.title).toEqual([{ text: '范围' }])
  expect(chapter.children[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '本文件给出一个只含必需结构的最小文档。' }] })
})

it('[M-5.2-02] 附录标题作为行内文字进入对应附录', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  expect(doc.appendices[0]!.title).toEqual([{ text: '资料性附录示例' }])
  expect(doc.appendices[1]!.title).toEqual([{ text: '规范性附录示例' }])
})

it('[M-5.4-01] 五种预定义实体与数字字符引用还原为文本', () => {
  const xml = sample('01-minimal.xml').replace('本文件给出一个只含必需结构的最小文档。', '&amp;&lt;&gt;&quot;&apos;&#x2264;&#128512;')
  const { doc } = mapComplete(xml)
  expect(doc.body[0]!.children[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '&<>"\'≤😀' }] })
})

it('[M-5.6-04] 注和示例的标签由同作用域重新派生，文字不混入内容', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  const clause = doc.body[3]!.children[0]!
  if (clause.kind !== 'clause') throw new Error('应为条')
  const notes = clause.children.filter(c => c.kind === 'note')
  const example = clause.children.find(c => c.kind === 'example')!
  expect(notes).toHaveLength(2)
  const labels = resolveIr(doc).labels
  expect(notes.map(n => labels[n.id]?.label)).toEqual(['注1：', '注2：'])
  expect(labels[example.id]?.label).toBe('示例：')
  expect(notes[0]).toMatchObject({ content: [{ kind: 'paragraph', content: [{ text: '被引用的注才带 id。' }] }] })
})

it('[M-5.7-08] 列表项分别保留身份、文字及嵌套项', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  const clause = doc.body[3]!.children[1]!
  if (clause.kind !== 'clause') throw new Error('应为条')
  const list = clause.children.find(c => c.kind === 'list')!
  if (list.kind !== 'list') throw new Error('应为列表')
  expect(list.items).toHaveLength(2)
  expect(list.items[0]!.id).not.toBe(list.items[1]!.id)
  expect(list.items[0]!.content[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '第一项；' }] })
  expect(list.items[1]!.content).toMatchObject([{ kind: 'paragraph', content: [{ text: '第二项，含嵌套无序列项：' }] }, { kind: 'list', listType: 'dash', items: [{ content: [{ content: [{ text: '嵌套项一；' }] }] }, { content: [{ content: [{ text: '嵌套项二。' }] }] }] }])
})

it('[M-5.7-09] 有序列项标签按类型和顺序重新派生', () => {
  const { doc } = mapComplete(sample('03-structure.xml'))
  const clause = doc.body[3]!.children[1]!
  if (clause.kind !== 'clause') throw new Error('应为条')
  const list = clause.children.find(c => c.kind === 'list')!
  if (list.kind !== 'list') throw new Error('应为列表')
  const markers = computeOrderedListMarkers(doc)
  expect(list.items.map(item => markers[item.id])).toEqual(['a）', 'b）'])
  expect(list.items[0]!.content[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '第一项；' }] })
})

it('[M-4.1-03] 根元素上的命名空间按 URI 而非前缀映射术语、公式及图片', () => {
  const termsXml = sample('06-terms-references.xml').replace('xmlns:tbx=', 'xmlns:termAlias=').replaceAll('tbx:', 'termAlias:')
  const termDoc = mapComplete(termsXml).doc
  const group = termDoc.body[1]!.children.find(c => c.kind === 'clause')!
  if (group.kind !== 'clause') throw new Error('应为术语分组条')
  const term = group.children.find(c => c.kind === 'termEntry')!
  if (term.kind !== 'termEntry') throw new Error('应为术语条目')
  expect(term.languageSets?.[0]?.groups[0]?.terms[0]?.content).toEqual([{ text: '标准化文件' }])

  const mediaXml = sample('05-formulas-figures.xml')
    .replace('xmlns:mml=', 'xmlns:mathAlias=').replaceAll('mml:', 'mathAlias:')
    .replace('xmlns:xlink=', 'xmlns:linkAlias=').replaceAll('xlink:', 'linkAlias:')
  const mediaDoc = mapComplete(mediaXml).doc
  const paragraph = mediaDoc.body[1]!.children.find(c => c.kind === 'paragraph')!
  if (paragraph.kind !== 'paragraph') throw new Error('应为段落')
  const formula = paragraph.content.find(run => run.formula)?.formula
  const image = paragraph.content.find(run => run.image)?.image
  expect(formula?.mathml).toContain('http://www.w3.org/1998/Math/MathML')
  expect(formula?.mathml).toContain('≤')
  expect(image?.src).toBe(png)
  expect(image?.resourceId).toBe('resource:icon_1')
})

it('[M-4.3.2-30] MathML 2.0 处理元数据允许导入并给出兼容性提示', () => {
  const xml = sample('01-minimal.xml').replace('mathml-version="3.0"', 'mathml-version="2.0"')
  const { doc, problems } = mapComplete(xml)
  expect(doc.body[0]!.title).toEqual([{ text: '范围' }])
  expect(problems.some(p => p.severity === 'warning' && p.xml?.path.includes('processing-meta'))).toBe(true)
})
