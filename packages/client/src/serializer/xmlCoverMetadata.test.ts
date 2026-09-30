// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { parseXmlToEditorJson, parseXmlToJson, serializeToXml } from './index'

describe('XML 封面元数据往返', () => {
  it('真实序列化 XML 经 DOMParser 和生产编辑器 schema 导入后保留五字段', () => {
    const schema = getSchema(createEditorExtensions())
    const legacyCoverAttrs = {
      standardNo: 'GB/T 1000—2024',
      titleCn: '机械 & 装备标准',
      titleEn: 'Machinery & equipment standard',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      issuer: '某机构 & 有限公司',
      icsCode: '35.240',
      ccsCode: 'L 70',
    }
    const attrs = {
      replaces: 'GB/T 1000—2010 & GB/T 2000—2018',
      consistency: '（ISO 1234:2020，MOD）',
      filingNo: '备案 123 & 124',
      industryName: '机械行业',
      regionName: '浙江省',
    }
    const source = schema.nodeFromJSON({
      type: schema.topNodeType.name,
      content: [{
        type: 'coverPage',
        attrs: { ...legacyCoverAttrs, ...attrs },
        content: [{ type: 'paragraph' }],
      }],
    })

    const xml = serializeToXml(source)
    expect(xml).toContain('<custom-meta-group content-type="ses-cover">')
    expect(xml).toContain('<meta-name>industryName</meta-name>')
    expect(xml).toContain('备案 123 &amp; 124')
    expect(xml).toContain('<std-ref>GB/T 1000—2024</std-ref>')
    expect(xml).toContain('<ics>35.240</ics>')
    expect(xml).toContain('<ccs>L 70</ccs>')
    expect(xml).toContain('<main>机械 &amp; 装备标准</main>')
    expect(xml).toContain('<main>Machinery &amp; equipment standard</main>')
    expect(xml).toContain('<pub-date>2026-01-01</pub-date>')
    expect(xml).toContain('<release-date>2026-02-01</release-date>')
    expect(xml).toContain('<std-org-name>某机构 &amp; 有限公司</std-org-name>')

    const parsed = parseXmlToJson(xml)
    expect(parsed.type).toBe('standardDoc')
    expect(parsed.attrs).toMatchObject(attrs)
    const expectedCoverAttrs = { ...legacyCoverAttrs, ...attrs }
    expect(parsed.content?.[0]).toMatchObject({ type: 'coverPage', attrs: expectedCoverAttrs })

    // This is the same root adapter called by EditorView's XML import handler.
    const editorJson = parseXmlToEditorJson(xml, schema.topNodeType.name)
    expect(editorJson.type).toBe(schema.topNodeType.name)
    expect(editorJson.attrs).toBeUndefined()
    const imported = schema.nodeFromJSON(editorJson)
    const coverPage = imported.child(0)
    expect(coverPage.type.name).toBe('coverPage')
    expect(coverPage.attrs).toMatchObject(expectedCoverAttrs)

    const { doc: ir } = pmToIr(imported.toJSON() as PMJsonNode)
    expect(ir.meta).toMatchObject(attrs)

    const reExportedXml = serializeToXml(imported)
    expect(reExportedXml).toContain('<meta-name>replaces</meta-name>')
    expect(reExportedXml).toContain('GB/T 1000—2010 &amp; GB/T 2000—2018')
    expect(reExportedXml).toContain('<std-ref>GB/T 1000—2024</std-ref>')
    expect(reExportedXml).toContain('<ics>35.240</ics>')
    expect(reExportedXml).toContain('<ccs>L 70</ccs>')
    expect(reExportedXml).toContain('<main>机械 &amp; 装备标准</main>')
    expect(reExportedXml).toContain('<main>Machinery &amp; equipment standard</main>')
    expect(reExportedXml).toContain('<pub-date>2026-01-01</pub-date>')
    expect(reExportedXml).toContain('<release-date>2026-02-01</release-date>')
    expect(reExportedXml).toContain('<std-org-name>某机构 &amp; 有限公司</std-org-name>')

    const reparsed = parseXmlToJson(reExportedXml)
    expect(reparsed.attrs).toMatchObject({
      standardNo: legacyCoverAttrs.standardNo,
      titleCn: legacyCoverAttrs.titleCn,
      titleEn: legacyCoverAttrs.titleEn,
      publishDate: legacyCoverAttrs.publishDate,
      implementDate: legacyCoverAttrs.implementDate,
      icsCode: legacyCoverAttrs.icsCode,
      ccsCode: legacyCoverAttrs.ccsCode,
    })
    expect(reparsed.content?.[0]).toMatchObject({
      type: 'coverPage',
      attrs: expectedCoverAttrs,
    })
  })

  it('没有 ses-cover 扩展组的既有 XML 保留原有元数据解析行为', () => {
    const legacyXml = `<?xml version="1.0"?>
<standard xmlns="urn:csbts:std:xml:1.0">
  <front><std-meta>
    <std-ref>GB/T 12345—2026</std-ref>
    <title-wrap lang="zh"><main>既有标准名称</main></title-wrap>
    <pub-date>2026-01-01</pub-date>
    <std-type>national</std-type>
  </std-meta></front>
  <body><sec><title>范围</title></sec></body>
</standard>`
    const parsed = parseXmlToJson(legacyXml)
    expect(parsed.attrs).toMatchObject({
      standardNo: 'GB/T 12345—2026',
      titleCn: '既有标准名称',
      publishDate: '2026-01-01',
      standardType: 'national',
    })
    expect(parsed.content?.some((node) => node.type === 'coverPage')).toBe(false)
  })
})
