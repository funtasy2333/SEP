// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { buildXml46687Package, importXml46687, type ContentValidator } from '@ses/io'
import { pmToIr, renderDocx, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { exportSemanticJson, prepareXmlImportDocumentUpdate } from './index'

function schemaValidator(schema: ReturnType<typeof getSchema>): ContentValidator {
  return (candidate) => {
    try {
      const node = schema.nodeFromJSON(candidate)
      node.check()
      return { ok: true, content: node.toJSON() as PMJsonNode }
    } catch (error) {
      return {
        ok: false,
        code: 'xml-schema-invalid',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

describe('GB/T 46687.2 XML 封面元数据往返', () => {
  it('真实导出的 GB/T 46687.2 XML 经生产编辑器 schema 导入后保留封面与专有元数据', async () => {
    const schema = getSchema(createEditorExtensions())
    const metaAttrs = {
      standardType: 'local',
      standardNo: 'DB33/T 1000—2024',
      titleCn: '机械 & 装备标准',
      titleEn: 'Machinery & equipment standard',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      issuer: '某机构 & 有限公司',
      icsCode: '35.240',
      ccsCode: 'L 70',
      replaces: 'DB33/T 1000—2010 & DB33/T 2000—2018',
      filingNo: '备案 123 & 124',
      industryName: '机械',
      regionName: '浙江省',
      coverDesignation: '浙江省先进装备地方标准',
      applicant: '申请单位A',
      proposer: '提出单位B',
      technicalCommittee: 'SAC/TC 1',
    }
    const source = schema.nodeFromJSON({
      type: schema.topNodeType.name,
      content: [
        {
          type: 'coverPage',
          attrs: metaAttrs,
          content: [{ type: 'paragraph' }],
        },
        {
          type: 'chapter',
          attrs: { nodeId: 'ch-1' },
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
            { type: 'stdParagraph', attrs: { nodeId: 'p-1' }, content: [{ type: 'text', text: '本文件规定了测试范围。' }] },
          ],
        },
      ],
    })

    const exported = await buildXml46687Package({
      pmDoc: source.toJSON() as PMJsonNode,
    })
    const errors = exported.problems.filter((problem) => problem.severity === 'error')
    expect(errors).toEqual([])
    const xml = exported.xml!
    expect(xml).toContain('<custom-meta-group>')
    expect(xml).toContain('<meta-name>industry-name</meta-name>')
    expect(xml).toContain('<meta-name>cover-designation</meta-name>')
    expect(xml).toContain('<meta-value>浙江省先进装备地方标准</meta-value>')
    expect(xml).toContain('备案 123 &amp; 124')
    expect(xml).toContain('<std-ref type="dated">DB33/T 1000—2024</std-ref>')
    expect(xml).toContain('<ics>35.240</ics>')
    expect(xml).toContain('<ccs>L 70</ccs>')
    expect(xml).toContain('<comm-ref>SAC/TC 1</comm-ref>')
    expect(xml).toContain('<full>机械 &amp; 装备标准</full>')
    expect(xml).toContain('<full>Machinery &amp; equipment standard</full>')
    expect(xml).toContain('<release-date>2026-01-01</release-date>')
    expect(xml).toContain('<implementation-date>2026-02-01</implementation-date>')
    expect(xml).toContain('<std-supersedes>DB33/T 1000—2010 &amp; DB33/T 2000—2018</std-supersedes>')
    expect(xml).toContain('<std-org-name>某机构 &amp; 有限公司</std-org-name>')

    const importedResult = await importXml46687(xml, {
      validateContent: schemaValidator(schema),
    })
    expect(importedResult.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    const editorJson = importedResult.pmDoc!
    expect(editorJson.type).toBe(schema.topNodeType.name)
    const imported = schema.nodeFromJSON(editorJson)
    imported.check()

    const coverPage = imported.child(0)
    expect(coverPage.type.name).toBe('coverPage')
    expect(coverPage.attrs).toMatchObject(metaAttrs)

    const { doc: ir } = pmToIr(imported.toJSON() as PMJsonNode)
    const semantic = exportSemanticJson(imported)
    expect(semantic.content?.[0]?.attrs?.coverDesignation).toBe(metaAttrs.coverDesignation)
    expect(ir.meta.coverDesignation).toBe(metaAttrs.coverDesignation)
    expect(ir.meta.filingNo).toBe(metaAttrs.filingNo)
    expect(ir.meta.replaces).toBe(metaAttrs.replaces)

    const docUpdate = prepareXmlImportDocumentUpdate(editorJson)
    expect(docUpdate.title).toBe(metaAttrs.titleCn)
    expect(docUpdate.meta).toMatchObject(metaAttrs)

    const { titleParts: _tp, identifiers: _id, publishers: _pub, replacedStandards: _rep, ...docxMeta } = ir.meta
    const docxIr = { ...ir, meta: docxMeta }
    const docx = renderDocx(docxIr, resolve(docxIr).labels, {
      images: {},
      formulaOmml: {},
      stage: 'working_draft',
      createdAt: '2026-09-30T08:00:00.000Z',
    })
    const docxXml = docx.parts['word/document.xml'] ?? ''
    expect(docxXml).toContain('浙江省先进装备地方标准')

    const reExported = await buildXml46687Package({
      pmDoc: imported.toJSON() as PMJsonNode,
    })
    expect(reExported.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    expect(reExported.xml).toContain('<meta-name>cover-designation</meta-name>')
    expect(reExported.xml).toContain('<std-supersedes>DB33/T 1000—2010 &amp; DB33/T 2000—2018</std-supersedes>')
    expect(reExported.xml).toContain('<std-ref type="dated">DB33/T 1000—2024</std-ref>')
    expect(reExported.xml).toContain('<release-date>2026-01-01</release-date>')
    expect(reExported.xml).toContain('<implementation-date>2026-02-01</implementation-date>')
    expect(reExported.xml).toContain('<std-org-name>某机构 &amp; 有限公司</std-org-name>')
  })

  it('无 custom-meta-group 的 GB/T 46687.2 XML 保留 std-meta 元数据；同时明确拒绝旧版 GB/T 37967 XML', async () => {
    const xmlWithoutCustomMeta = `<?xml version="1.0" encoding="UTF-8"?>
<standard xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:mml="http://www.w3.org/1998/Math/MathML">
  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" math-representation="mathml" tagset-family="sts" />
  <front>
    <std-meta>
      <title-wrap xml:lang="zh"><full>既有标准名称</full></title-wrap>
      <title-wrap xml:lang="en"><full>Existing standard title</full></title-wrap>
      <std-org-group><std-org><std-org-name>既有发布机构</std-org-name></std-org></std-org-group>
      <content-language>zh</content-language>
      <std-ref type="dated">DB33/T 12345—2026</std-ref>
      <release-date>2026-01-01</release-date>
      <implementation-date>2026-02-01</implementation-date>
      <ics>35.240</ics>
      <ccs>L 70</ccs>
    </std-meta>
  </front>
  <body>
    <sec id="sec_1"><label>1</label><title>范围</title><p>测试条款。</p></sec>
  </body>
</standard>`

    const schema = getSchema(createEditorExtensions())
    const importedResult = await importXml46687(xmlWithoutCustomMeta, {
      validateContent: schemaValidator(schema),
    })
    expect(importedResult.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    const editorJson = importedResult.pmDoc!
    expect(editorJson.content?.[0]?.type).toBe('coverPage')

    const imported = schema.nodeFromJSON(editorJson)
    imported.check()
    expect(imported.child(0).attrs).toMatchObject({
      standardNo: 'DB33/T 12345—2026',
      titleCn: '既有标准名称',
      titleEn: 'Existing standard title',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      icsCode: '35.240',
      ccsCode: 'L 70',
      issuer: '既有发布机构',
    })

    const { doc: ir } = pmToIr(imported.toJSON() as PMJsonNode)
    expect(ir.meta).toMatchObject({
      stdCode: 'DB33/T 12345—2026',
      title: '既有标准名称',
      titleEn: 'Existing standard title',
      icsCode: '35.240',
      ccsCode: 'L 70',
      publishDate: '2026-01-01',
      implementDate: '2026-02-01',
      issuer: '既有发布机构',
    })

    // 显式负向断言：拒绝旧版 urn:csbts:std:xml:1.0 XML
    const legacyXml = `<?xml version="1.0"?>
<standard xmlns="urn:csbts:std:xml:1.0">
  <front><std-meta>
    <std-ref>DB33/T 12345—2026</std-ref>
    <title-wrap lang="zh"><main>既有标准名称</main></title-wrap>
  </std-meta></front>
  <body><sec><title>范围</title></sec></body>
</standard>`
    const legacyResult = await importXml46687(legacyXml, {
      validateContent: schemaValidator(schema),
    })
    expect(legacyResult.pmDoc).toBeNull()
    expect(legacyResult.problems.some((problem) => problem.severity === 'error')).toBe(true)
  })
})
