// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { importXml46687 } from '@ses/io'
import { irMetaFromDocumentMeta, type PMJsonNode } from '@ses/shared'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { prepareDocxInput } from './docxExporter'
import { buildPdfExportRequest } from './pdfExporter'
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
  applicant: '旧起草单位',
  proposer: '旧提出单位',
  technicalCommittee: '旧归口单位',
}

async function importWithProductionSchema(xml: string) {
  const schema = getSchema(createEditorExtensions())
  const result = await importXml46687(xml, {
    validateContent(json) {
      try {
        const node = schema.nodeFromJSON(json)
        node.check()
        return { ok: true, content: node.toJSON() as PMJsonNode }
      } catch (error) {
        return { ok: false, code: 'xml-schema-invalid', message: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  expect(result.problems.filter((p) => p.severity === 'error')).toEqual([])
  expect(result.pmDoc).not.toBeNull()
  const node = schema.nodeFromJSON(result.pmDoc!)
  node.check()
  return node
}

describe('GB/T 46687.2 XML 导入后的 DocumentMeta 同步', () => {
  it('以已校验的地方 XML std-meta 更新 DOCX/PDF 元数据并权威覆盖起草/提出/归口字段', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML">
  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" math-representation="mathml" tagset-family="sts" />
  <front>
    <std-meta>
      <std-type>地方标准</std-type>
      <title-wrap xml:lang="zh"><full>新地方标准名称</full></title-wrap>
      <title-wrap xml:lang="en"><full>New local standard title</full></title-wrap>
      <std-org-group><std-org><std-org-name>浙江省市场监督管理局</std-org-name></std-org></std-org-group>
      <content-language>zh</content-language>
      <std-ref type="dated">DB33/T 12345—2026</std-ref>
      <release-date>2026-03-01</release-date>
      <implementation-date>2026-09-01</implementation-date>
      <comm-ref>新归口技术委员会</comm-ref>
      <ics>35.240</ics>
      <ccs>L 70</ccs>
      <custom-meta-group>
        <custom-meta><meta-name>region-name</meta-name><meta-value>浙江省</meta-value></custom-meta>
        <custom-meta><meta-name>cover-designation</meta-name><meta-value>浙江省数字经济地方标准</meta-value></custom-meta>
        <custom-meta><meta-name>applicant</meta-name><meta-value>新起草单位</meta-value></custom-meta>
        <custom-meta><meta-name>proposer</meta-name><meta-value>新提出单位</meta-value></custom-meta>
      </custom-meta-group>
    </std-meta>
  </front>
  <body>
    <sec id="sec_1"><label>1</label><title>范围</title><p>XML 正文</p></sec>
  </body>
</standard>`
    const node = await importWithProductionSchema(xml)
    const update = prepareXmlImportDocumentUpdate(node.toJSON() as PMJsonNode, OLD_META)

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
      consistency: '',
      filingNo: '',
      industryName: '',
      regionName: '浙江省',
      coverDesignation: '浙江省数字经济地方标准',
      applicant: '新起草单位',
      proposer: '新提出单位',
      technicalCommittee: '新归口技术委员会',
    })

    const printJson = structuredClone(node.toJSON()) as PMJsonNode
    for (const key of ['titleParts', 'identifiers', 'publishers', 'replacedStandards', 'languages', 'copyrights', 'adoptions']) {
      if (printJson.attrs) delete printJson.attrs[key]
      const cover = printJson.content?.find((child) => child.type === 'coverPage')
      if (cover?.attrs) delete cover.attrs[key]
    }
    printJson.content = (printJson.content ?? []).filter((child) => child.type !== 'metadataBlock')
    const printNode = node.type.schema.nodeFromJSON(printJson)

    const docx = prepareDocxInput(printNode, update.meta).doc
    expect(docx.meta).toMatchObject({
      standardType: 'local',
      stdCode: 'DB33/T 12345—2026',
      title: '新地方标准名称',
      issuer: '浙江省市场监督管理局',
      coverDesignation: '浙江省数字经济地方标准',
    })
    expect(docx.meta).not.toMatchObject({
      standardType: 'gb',
      stdCode: 'GB 99999—2020',
      title: '旧国家标准名称',
      issuer: '旧发布机构',
    })

    const pdf = buildPdfExportRequest(printNode, irMetaFromDocumentMeta(update.meta))
    expect(pdf.docTitle).toBe('新地方标准名称')
    expect(pdf.filename).toBe('新地方标准名称')
    expect(pdf.html).toContain('新地方标准名称')
    expect(pdf.html).toContain('DB33/T 12345—2026')
    expect(pdf.html).not.toContain('旧国家标准名称')
    expect(pdf.html).not.toContain('GB 99999—2020')
  })

  it('缺失的可选字段显式清空，并保留类型语义与缺省类型契约', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML">
  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" math-representation="mathml" tagset-family="sts" />
  <front>
    <std-meta>
      <std-type>标准化指导性技术文件</std-type>
      <title-wrap xml:lang="zh"><full>指导性文件</full></title-wrap>
      <content-language>zh</content-language>
      <std-ref type="dated">GB/Z 12345—2026</std-ref>
      <release-date>2026-01-01</release-date>
      <implementation-date>2026-06-01</implementation-date>
    </std-meta>
  </front>
  <body><sec id="sec_1"><label>1</label><title>范围</title><p>正文</p></sec></body>
</standard>`
    const node = await importWithProductionSchema(xml)
    const update = prepareXmlImportDocumentUpdate(node.toJSON() as PMJsonNode, OLD_META)
    expect(update.meta.standardType).toBe('guidance')
    expect(update.meta).toMatchObject({
      standardNo: 'GB/Z 12345—2026',
      titleEn: '',
      icsCode: '',
      ccsCode: '',
      publishDate: '2026-01-01',
      implementDate: '2026-06-01',
      issuer: '',
      replaces: '',
      consistency: '',
      filingNo: '',
      industryName: '',
      regionName: '',
      coverDesignation: '',
      applicant: '',
      proposer: '',
      technicalCommittee: '',
    })

    const missingTypeNode = await importWithProductionSchema(`<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML">
  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" math-representation="mathml" tagset-family="sts" />
  <front>
    <std-meta>
      <title-wrap xml:lang="zh"><full>默认类型标准</full></title-wrap>
      <content-language>zh</content-language>
      <release-date>2026-01-01</release-date>
      <implementation-date>2026-06-01</implementation-date>
    </std-meta>
  </front>
  <body><sec id="sec_1"><label>1</label><title>范围</title><p>正文</p></sec></body>
</standard>`)
    expect(prepareXmlImportDocumentUpdate(missingTypeNode.toJSON() as PMJsonNode, OLD_META).meta.standardType).toBe('national')
  })

  it('拒绝非空未知标准类型，不将其静默归为国家标准', () => {
    const pmDoc: PMJsonNode = {
      type: 'doc',
      attrs: { standardType: 'mystery' },
      content: [
        { type: 'coverPage', attrs: { standardType: 'mystery', titleCn: '未知类型' }, content: [{ type: 'paragraph' }] },
        { type: 'chapter', attrs: { nodeId: 'c1' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] }] },
      ],
    }
    expect(() => prepareXmlImportDocumentUpdate(pmDoc, OLD_META)).toThrow('标准类型「mystery」无法识别')
  })
})
