// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { pmToIr, renderDocx, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { exportSemanticJson, parseXmlToEditorJson, parseXmlToJson, serializeToXml } from './index'

describe('XML 封面元数据往返', () => {
  it('真实序列化 XML 经 DOMParser 和生产编辑器 schema 导入后保留五字段', () => {
    const schema = getSchema(createEditorExtensions())
    const legacyCoverAttrs = {
      standardNo: 'HG/T 1000—2024',
      titleCn: '机械 & 装备标准',
      titleEn: 'Machinery & equipment standard',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      issuer: '某机构 & 有限公司',
      icsCode: '35.240',
      ccsCode: 'L 70',
    }
    const attrs = {
      standardType: 'industry',
      replaces: 'HG/T 1000—2010 & HG/T 2000—2018',
      consistency: '（ISO 1234:2020，MOD）',
      filingNo: '备案 123 & 124',
      industryName: '机械',
      regionName: '浙江省',
      coverDesignation: '中华人民共和国先进装备行业标准',
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
    expect(xml).toContain('<meta-name>coverDesignation</meta-name>')
    expect(xml).toContain('<meta-value>中华人民共和国先进装备行业标准</meta-value>')
    expect(xml).toContain('备案 123 &amp; 124')
    expect(xml).toContain('<std-ref>HG/T 1000—2024</std-ref>')
    expect(xml).toContain('<std-type>industry</std-type>')
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
    const semantic = exportSemanticJson(imported)
    expect(semantic.content?.[0]?.attrs?.coverDesignation).toBe(attrs.coverDesignation)
    expect(ir.meta).toMatchObject(attrs)
    expect(ir.meta.standardType).toBe('industry')

    const docx = renderDocx(ir, resolve(ir).labels, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-09-30T08:00:00.000Z',
    })
    const docxXml = docx.parts['word/document.xml'] ?? ''
    expect(docxXml).toContain('SesCoverDesignationOther')
    expect(docxXml).toContain('中华人民共和国先进装备行业标准')
    expect(docxXml).toContain('SesCoverLogoText')

    const reExportedXml = serializeToXml(imported)
    expect(reExportedXml).toContain('<meta-name>replaces</meta-name>')
    expect(reExportedXml).toContain('<meta-name>coverDesignation</meta-name>')
    expect(reExportedXml).toContain('<meta-value>中华人民共和国先进装备行业标准</meta-value>')
    expect(reExportedXml).toContain('HG/T 1000—2010 &amp; HG/T 2000—2018')
    expect(reExportedXml).toContain('<std-ref>HG/T 1000—2024</std-ref>')
    expect(reExportedXml).toContain('<std-type>industry</std-type>')
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

  it('没有 ses-cover 扩展组的既有 XML 经真实编辑器 schema 保留根元数据和标准类型', () => {
    const legacyXml = `<?xml version="1.0"?>
<standard xmlns="urn:csbts:std:xml:1.0">
  <front><std-meta>
    <std-ref>DB33/T 12345—2026</std-ref>
    <std-ident><ics>35.240</ics><ccs>L 70</ccs></std-ident>
    <title-wrap lang="zh"><main>既有标准名称</main></title-wrap>
    <title-wrap lang="en"><main>Existing standard title</main></title-wrap>
    <pub-date>2026-01-01</pub-date>
    <release-date>2026-02-01</release-date>
    <std-type>local</std-type>
    <std-org><std-org-name>既有发布机构</std-org-name></std-org>
  </std-meta></front>
  <body><sec><title>范围</title></sec></body>
</standard>`
    const parsed = parseXmlToJson(legacyXml)
    expect(parsed.attrs).toMatchObject({
      standardNo: 'DB33/T 12345—2026',
      titleCn: '既有标准名称',
      titleEn: 'Existing standard title',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      icsCode: '35.240',
      ccsCode: 'L 70',
      standardType: 'local',
      issuer: '既有发布机构',
    })
    expect(parsed.content?.some((node) => node.type === 'coverPage')).toBe(false)

    const schema = getSchema(createEditorExtensions())
    const editorJson = parseXmlToEditorJson(legacyXml, schema.topNodeType.name)
    expect(editorJson.attrs).toBeUndefined()
    expect(editorJson.content?.[0]?.type).toBe('coverPage')
    const imported = schema.nodeFromJSON(editorJson)
    const coverPage = imported.child(0)
    expect(coverPage.attrs).toMatchObject({
      standardNo: 'DB33/T 12345—2026',
      titleCn: '既有标准名称',
      titleEn: 'Existing standard title',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      icsCode: '35.240',
      ccsCode: 'L 70',
      standardType: 'local',
      issuer: '既有发布机构',
    })

    const { doc: ir } = pmToIr(imported.toJSON() as PMJsonNode)
    expect(ir.meta.standardType).toBe('local')
    expect(ir.meta).toMatchObject({
      standardType: 'local',
      stdCode: 'DB33/T 12345—2026',
      title: '既有标准名称',
      titleEn: 'Existing standard title',
      icsCode: '35.240',
      ccsCode: 'L 70',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      issuer: '既有发布机构',
    })

    const docx = renderDocx(ir, resolve(ir).labels, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-09-30T08:00:00.000Z',
    })
    const docxXml = docx.parts['word/document.xml'] ?? ''
    expect(docxXml).toContain('SesCoverDbRegion')
    expect(docxXml).not.toContain('SesCoverLogoText')

    const reExportedXml = serializeToXml(imported)
    expect(reExportedXml).toContain('<std-ref>DB33/T 12345—2026</std-ref>')
    expect(reExportedXml).toContain('<title-wrap lang="zh">')
    expect(reExportedXml).toContain('<main>既有标准名称</main>')
    expect(reExportedXml).toContain('<title-wrap lang="en">')
    expect(reExportedXml).toContain('<main>Existing standard title</main>')
    expect(reExportedXml).toContain('<pub-date>2026-01-01</pub-date>')
    expect(reExportedXml).toContain('<release-date>2026-02-01</release-date>')
    expect(reExportedXml).toContain('<ics>35.240</ics>')
    expect(reExportedXml).toContain('<ccs>L 70</ccs>')
    expect(reExportedXml).toContain('<std-type>local</std-type>')
    expect(reExportedXml).toContain('<std-org-name>既有发布机构</std-org-name>')
  })
})
