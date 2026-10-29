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
