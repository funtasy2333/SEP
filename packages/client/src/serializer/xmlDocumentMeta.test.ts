// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { irMetaFromDocumentMeta } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { buildPdfExportRequest } from './pdfExporter'
import { prepareDocxInput } from './docxExporter'
import { parseXmlToEditorJson } from './xmlParser'
import { prepareXmlImportDocumentUpdate } from './xmlDocumentMeta'

const OLD_META = {
  titleCn: '旧国家标准名称',
  titleEn: 'Old national title',
  standardNo: 'GB 99999—2020',
  icsCode: '01.020',
  ccsCode: 'A 00',
  publishDate: '2020-01-01',
  implementDate: '2020-07-01',
  standardType: 'national' as const,
  issuer: '旧发布机构',
  replaces: 'GB 88888—2010',
  consistency: 'IDT',
  filingNo: '旧备案号',
  industryName: '旧行业',
  regionName: '旧地区',
  applicant: '保留申请单位',
  proposer: '保留提出单位',
  technicalCommittee: '保留归口单位',
}

function parseWithProductionSchema(xml: string) {
  const schema = getSchema(createEditorExtensions())
  const json = parseXmlToEditorJson(xml, schema.topNodeType.name)
  const node = schema.nodeFromJSON(json)
  node.check()
  return node
}

describe('XML 导入后的 DocumentMeta 同步', () => {
  it('以已校验的地方 XML front 更新 DOCX/PDF 元数据并保留编辑器维护字段', () => {
    const xml = `<?xml version="1.0"?>
<standard xmlns="urn:csbts:std:xml:1.0">
  <front><std-meta>
    <std-ref>DB33/T 12345—2026</std-ref>
    <std-ident><ics>35.240</ics><ccs>L 70</ccs></std-ident>
    <title-wrap lang="zh"><main>新地方标准名称</main></title-wrap>
    <title-wrap lang="en"><main>New local standard title</main></title-wrap>
    <pub-date>2026-03-01</pub-date><release-date>2026-09-01</release-date>
    <std-type>local</std-type>
    <std-org><std-org-name>浙江省市场监督管理局</std-org-name></std-org>
    <custom-meta-group content-type="ses-cover">
      <custom-meta><meta-name>regionName</meta-name><meta-value>浙江省</meta-value></custom-meta>
      <custom-meta><meta-name>consistency</meta-name><meta-value>MOD</meta-value></custom-meta>
    </custom-meta-group>
  </std-meta></front>
  <body><foreword><p>XML 前言正文</p></foreword><sec><title>范围</title></sec></body>
</standard>`
    const node = parseWithProductionSchema(xml)
    const update = prepareXmlImportDocumentUpdate(node.toJSON(), OLD_META)

    expect(update.title).toBe('新地方标准名称')
    expect(update.meta).toEqual({
      titleCn: '新地方标准名称',
      titleEn: 'New local standard title',
      standardNo: 'DB33/T 12345—2026',
      icsCode: '35.240',
      ccsCode: 'L 70',
      publishDate: '2026-03-01',
      implementDate: '2026-09-01',
      standardType: 'local',
      issuer: '浙江省市场监督管理局',
      replaces: '',
      consistency: 'MOD',
      filingNo: '',
      industryName: '',
      regionName: '浙江省',
      applicant: '保留申请单位',
      proposer: '保留提出单位',
      technicalCommittee: '保留归口单位',
    })

    const docx = prepareDocxInput(node, update.meta).doc
    expect(docx.meta).toMatchObject({
      standardType: 'local',
      stdCode: 'DB33/T 12345—2026',
      title: '新地方标准名称',
      issuer: '浙江省市场监督管理局',
    })
    expect(docx.meta).not.toMatchObject({
      standardType: 'gb',
      stdCode: 'GB 99999—2020',
      title: '旧国家标准名称',
      issuer: '旧发布机构',
    })

    const pdf = buildPdfExportRequest(node, irMetaFromDocumentMeta(update.meta))
    expect(pdf.docTitle).toBe('新地方标准名称')
    expect(pdf.filename).toBe('新地方标准名称')
    expect(pdf.html).toContain('新地方标准名称')
    expect(pdf.html).toContain('DB33/T 12345—2026')
    expect(pdf.html).not.toContain('旧国家标准名称')
    expect(pdf.html).not.toContain('GB 99999—2020')
  })

  it('缺少的 XML-owned 字段显式清空，并保留类型别名和缺省类型契约', () => {
    const xml = `<?xml version="1.0"?>
<standard xmlns="urn:csbts:std:xml:1.0"><front><std-meta>
  <title-wrap lang="zh"><main>指导性文件</main></title-wrap>
  <std-type>guide</std-type>
</std-meta></front><body><sec><title>范围</title></sec></body></standard>`
    const node = parseWithProductionSchema(xml)
    const update = prepareXmlImportDocumentUpdate(node.toJSON(), OLD_META)
    expect(update.meta.standardType).toBe('guidance')
    expect(update.meta).toMatchObject({
      standardNo: '', titleEn: '', icsCode: '', ccsCode: '',
      publishDate: '', implementDate: '', issuer: '', replaces: '',
      consistency: '', filingNo: '', industryName: '', regionName: '',
    })
    expect(update.meta).toMatchObject({
      applicant: OLD_META.applicant,
      proposer: OLD_META.proposer,
      technicalCommittee: OLD_META.technicalCommittee,
    })

    const missingTypeNode = parseWithProductionSchema(`<?xml version="1.0"?>
<standard xmlns="urn:csbts:std:xml:1.0"><body><sec><title>范围</title></sec></body></standard>`)
    expect(prepareXmlImportDocumentUpdate(missingTypeNode.toJSON(), OLD_META).meta.standardType).toBe('national')
  })

  it('拒绝非空未知标准类型，不将其静默归为国家标准', () => {
    const xml = `<?xml version="1.0"?>
<standard xmlns="urn:csbts:std:xml:1.0"><front><std-meta>
  <title-wrap lang="zh"><main>未知类型</main></title-wrap><std-type>mystery</std-type>
</std-meta></front><body><sec><title>范围</title></sec></body></standard>`
    const node = parseWithProductionSchema(xml)
    expect(() => prepareXmlImportDocumentUpdate(node.toJSON(), OLD_META)).toThrow('标准类型「mystery」无法识别')
  })
})
