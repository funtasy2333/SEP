import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { createImportContext } from './context'
import { mapCoreInline } from './inline'
import { mapMetadata } from './metadata'

it('[M-4.3.2-04] [M-4.3.2-05] [M-4.3.2-06] [M-4.3.2-10] 保存分段题名、编号、多机构及日期异写', () => {
  const tree = parseXml46687('<std-meta><title-wrap xml:lang="zh"><main>主体</main><full>中文</full></title-wrap><title-wrap xml:lang="en"><full>English</full></title-wrap><std-ident><originator>SAC</originator><doc-number>123</doc-number></std-ident><std-org-group><std-org><std-org-name>甲</std-org-name></std-org><std-org std-org-role="publisher"><std-org-name>乙</std-org-name><std-org-abbrev>B</std-org-abbrev></std-org></std-org-group><std-ref type="dated">GB/T 123</std-ref><release-date date-type="published">2020-01-01</release-date><release-date date-type="implemented">2020-06-01</release-date></std-meta>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  const meta = mapMetadata(tree.root, ctx)!
  expect(meta.titleParts?.map(x => [x.lang, x.role, x.content[0]?.text])).toEqual([['zh', 'main', '主体'], ['zh', 'full', '中文'], ['en', 'full', 'English']])
  expect(meta.identifiers?.[0]?.parts.map(x => x.kind)).toEqual(['originator', 'doc-number'])
  expect(meta.publishers?.map(x => x.name[0]?.text)).toEqual(['甲', '乙'])
  expect(meta).toMatchObject({ title: '中文', titleEn: 'English', stdCode: 'GB/T 123', publishDate: '2020-01-01', implementDate: '2020-06-01' })
})

it('[M-4.3.2-10] [M-4.3.2-11] 重复日期与不存在的日期阻断导入', () => {
  const tree = parseXml46687('<std-meta><release-date>2020-02-30</release-date><release-date date-type="published">2020-03-01</release-date></std-meta>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  mapMetadata(tree.root, ctx)
  expect(ctx.problems.filter(p => p.severity === 'error')).toHaveLength(2)
})

it('[M-4.3.2-06] [M-G-01] 保留同一机构组多个名称和仅有缩写的机构', () => {
  const tree = parseXml46687('<std-meta><std-org-group><std-org std-org-role="lead"><std-org-name>甲</std-org-name><std-org-name>乙</std-org-name><std-org-abbrev>GB</std-org-abbrev></std-org></std-org-group><std-org std-org-type="national"><std-org-abbrev>SAC</std-org-abbrev></std-org></std-meta>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  const meta = mapMetadata(tree.root, ctx)!
  expect(meta.publishers?.map(p => [p.name[0]?.text, p.role, p.identifier])).toEqual([['甲', 'lead', 'GB'], ['乙', 'lead', undefined], ['SAC', undefined, 'SAC']])
  expect(ctx.problems.some(p => p.severity === 'error')).toBe(false)
  expect(ctx.problems.some(p => p.severity === 'warning')).toBe(true)
})

it('[M-C-01] [M-C-02] [M-C-03] [M-G-04] [M-G-05] 可接收但无法表达的元数据给出提示', () => {
  const tree = parseXml46687('<std-meta><proj-id>P</proj-id><release-version>draft</release-version><doc-ref>R</doc-ref><secretariat>S</secretariat><page-count count="8"/></std-meta>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  mapMetadata(tree.root, ctx)
  expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(ctx.problems.filter(p => p.severity === 'warning')).toHaveLength(6)
})

it('[M-4.3.2-04] 只有分段题名时保留完整分段并提供旧封面题名', () => {
  const tree = parseXml46687('<std-meta><title-wrap xml:lang="zh"><intro>总</intro><main>主体</main><compl>部分</compl></title-wrap><std-ref type="dated">GB/Z 123</std-ref></std-meta>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  const meta = mapMetadata(tree.root, ctx)!
  expect(meta.titleParts?.map(p => p.role)).toEqual(['intro', 'main', 'compl'])
  expect(meta.title).toBe('总 主体 部分')
  expect(meta.standardType).toBe('guide')
})

it('[M-4.3.2-06] 一个机构包含多个名称时提示结构已规范化', () => {
  const tree = parseXml46687('<std-meta><std-org-group><std-org><std-org-name>甲</std-org-name><std-org-name>乙</std-org-name></std-org></std-org-group><std-ref type="dated">GB/T 1</std-ref></std-meta>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  mapMetadata(tree.root, ctx)
  expect(ctx.problems.some(p => p.severity === 'warning' && p.xml?.path.includes('std-org[1]'))).toBe(true)
})

it('[M-4.3.2-32] 题名继承上层 xml:lang 并用于旧题名', () => {
  const tree = parseXml46687('<std-meta xml:lang="en"><title-wrap><full>Inherited</full></title-wrap><std-ref type="dated">GB/T 1</std-ref></std-meta>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  const meta = mapMetadata(tree.root, ctx)!
  expect(meta.titleParts?.[0]?.lang).toBe('en')
  expect(meta.titleEn).toBe('Inherited')
})
