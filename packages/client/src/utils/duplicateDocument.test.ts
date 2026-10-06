// @vitest-environment happy-dom
import JSZip from 'jszip'
import { getSchema } from '@tiptap/core'
import { expect, it } from 'vitest'
import { UnsupportedOutputError, type DocumentMeta } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { buildDocxBlob, prepareDocxInput } from '../serializer/docxExporter'
import { parseXmlToEditorJson, serializeToXml } from '../serializer'
import { createDefaultDocumentContent } from './newDocument'
import { createDocumentDuplicate } from './duplicateDocument'

const originalMeta: DocumentMeta = {
  titleCn: '原标准名称', standardNo: 'GB/T 12345—2026', standardType: 'national',
  applicant: '原起草单位',
  replaces: 'GB/T 12345—2020', consistency: 'IDT',
}
const makeSource = () => ({ title: originalMeta.titleCn, meta: { ...originalMeta }, content: createDefaultDocumentContent(originalMeta) })

it('复制后库名/封面/XML/DOCX题名一致，正文保留且不修改源文档', async () => {
  const source = makeSource()
  // 模拟库中已有元数据更新，而内嵌封面仍保存创建时的值。
  source.meta.titleCn = '最新标准名称'
  source.meta.standardType = 'local'
  source.meta.standardNo = 'DB33/T 12345—2026'
  source.meta.coverDesignation = '浙江省数字技术地方标准'
  source.meta.replaces = ''
  source.meta.consistency = 'MOD'
  const before = JSON.parse(JSON.stringify(source))
  const duplicate = JSON.parse(JSON.stringify(createDocumentDuplicate(source)))
  expect(duplicate).toMatchObject({ title: '最新标准名称（副本）', stage: 'working_draft',
    meta: { titleCn: '最新标准名称（副本）', standardType: 'local', standardNo: 'DB33/T 12345—2026', coverDesignation: '浙江省数字技术地方标准' } })
  expect(duplicate.content.content.slice(1)).toEqual(before.content.content.slice(1))
  expect(source).toEqual(before)
  const schema = getSchema(createEditorExtensions())
  const node = schema.nodeFromJSON(duplicate.content)
  node.check()
  const xml = serializeToXml(node)
  expect(xml).toContain('<main>最新标准名称（副本）</main>')
  expect(xml).toContain('<std-ref>DB33/T 12345—2026</std-ref>')
  expect(xml).toContain('<std-type>local</std-type>')
  expect(xml).toContain('<meta-name>coverDesignation</meta-name>')
  expect(xml).toContain('<meta-value>浙江省数字技术地方标准</meta-value>')
  expect(xml).not.toContain('原标准名称')
  expect(xml).not.toContain('<meta-name>replaces</meta-name>')
  const reloaded = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
  reloaded.check()
  expect(prepareDocxInput(reloaded).doc.meta).toMatchObject({ title: duplicate.meta.titleCn,
    stdCode: duplicate.meta.standardNo, standardType: 'local', consistency: 'MOD', coverDesignation: duplicate.meta.coverDesignation })
  const { blob } = await buildDocxBlob({ pmDoc: node, documentMeta: duplicate.meta, stage: duplicate.stage })
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const body = await zip.file('word/document.xml')!.async('string')
  expect(body).toContain('最新标准名称（副本）')
  expect(body).toContain('浙江省数字技术地方标准')
  expect(body).not.toContain('原标准名称')
  duplicate.content.content[1].content[0].content[0].text = '副本中的新正文'
  expect(source).toEqual(before)
})

it('旧正文没有封面节点时补元数据容器，保留原正文与根属性兼容', () => {
  const content = { type: 'doc', attrs: { titleCn: '旧根题名', standardNo: '旧根编号', issuer: '旧根发布机构', icsCode: '01.020', custom: '保留扩展' },
    content: [{ type: 'chapter', attrs: { nodeId: 'legacy-chapter' }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'legacy-body' }, content: [{ type: 'text', text: '原有编辑正文' }] },
    ] }] }
  const source = { title: '旧文档', meta: originalMeta, content }
  const duplicate = createDocumentDuplicate(source)
  const copied = duplicate.content as typeof content
  expect(copied.attrs).toEqual({ titleCn: '原标准名称（副本）', standardNo: originalMeta.standardNo, issuer: '旧根发布机构', icsCode: '01.020', custom: '保留扩展' })
  expect(copied.content.slice(1)).toEqual(content.content)
  const schema = getSchema(createEditorExtensions())
  const node = schema.nodeFromJSON(copied)
  node.check()
  expect(serializeToXml(node)).toContain('<main>原标准名称（副本）</main>')
  expect(serializeToXml(node)).toContain('<std-org-name>旧根发布机构</std-org-name>')
  expect(prepareDocxInput(node, duplicate.meta).doc.meta).toMatchObject({ issuer: '旧根发布机构', icsCode: '01.020' })
  expect(source.content.content).toHaveLength(1)
  expect(source.content.attrs.titleCn).toBe('旧根题名')
})

it.each([{}, { type: 'doc', content: [] }])('空内容继续保留初始化路径，空中文名使用库名，副本为独立对象：%j', (content) => {
  const source = { title: '库中显示名称', meta: { ...originalMeta, titleCn: '' }, content }
  const first = createDocumentDuplicate(source)
  const second = createDocumentDuplicate(source)
  expect(first.title).toBe('库中显示名称（副本）')
  expect(first.meta.titleCn).toBe(first.title)
  expect(first.content).toEqual(content)
  expect(first.content).not.toBe(second.content)
  first.meta.titleCn = '手动修改副本'
  expect(source.meta.titleCn).toBe('')
  expect(second.meta.titleCn).toBe('库中显示名称（副本）')
})

it('库元数据缺省字段保留内嵌封面回退值，XML与DOCX仍一致', () => {
  const source = makeSource()
  source.meta.standardNo = undefined
  source.meta.consistency = undefined
  const coverAttrs = source.content.content![0]!.attrs!
  coverAttrs.issuer = '原封面发布机构'
  coverAttrs.publishDate = '2026-10-01'
  const before = JSON.parse(JSON.stringify(source))
  const duplicate = createDocumentDuplicate(source)
  const schema = getSchema(createEditorExtensions())
  const node = schema.nodeFromJSON(duplicate.content!)
  node.check()
  const xml = serializeToXml(node)
  expect(xml).toContain('<std-ref>GB/T 12345—2026</std-ref>')
  expect(xml).toContain('<std-org-name>原封面发布机构</std-org-name>')
  expect(xml).toContain('<pub-date>2026-10-01</pub-date>')
  const reloaded = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
  expect(prepareDocxInput(node, duplicate.meta).doc.meta).toMatchObject({
    title: '原标准名称（副本）', stdCode: originalMeta.standardNo, consistency: 'IDT',
    issuer: '原封面发布机构', publishDate: '2026-10-01',
  })
  expect(prepareDocxInput(reloaded).doc.meta).toMatchObject({
    title: '原标准名称（副本）', stdCode: originalMeta.standardNo, consistency: 'IDT',
    issuer: '原封面发布机构', publishDate: '2026-10-01',
  })
  expect(JSON.parse(JSON.stringify(source))).toEqual(before)
})


it('非空根段落没有IR正文对应位置时明确阻断旧XML，不丢原JSON', () => {
  const source = { title: '旧文档', meta: originalMeta, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { nodeId: 'root-p' }, content: [{ type: 'text', text: '需要保留的根正文' }] }] } }
  const duplicate = createDocumentDuplicate(source)
  const schema = getSchema(createEditorExtensions())
  const node = schema.nodeFromJSON(duplicate.content)
  const before = node.toJSON()
  expect(() => serializeToXml(node)).toThrow(/doc.content\[1\]/)
  expect(node.toJSON()).toEqual(before)
  expect(JSON.stringify(duplicate.content)).toContain('需要保留的根正文')
})


it('复制完整保留新增提出/归口元数据，旧出口明确阻断并保护原稿', async () => {
  const meta = { ...originalMeta, proposer: '原提出单位', technicalCommittee: '原归口单位' }
  const source = { title: meta.titleCn, meta, content: createDefaultDocumentContent(meta) }
  const before = JSON.parse(JSON.stringify(source))
  const duplicate = createDocumentDuplicate(source)
  expect(duplicate.meta).toMatchObject({ proposer: meta.proposer, technicalCommittee: meta.technicalCommittee })
  const node = getSchema(createEditorExtensions()).nodeFromJSON(duplicate.content)
  node.check()
  expect(prepareDocxInput(node, duplicate.meta).doc.meta).toMatchObject({ proposer: meta.proposer, technicalCommittee: meta.technicalCommittee })
  expect(() => serializeToXml(node)).toThrow(UnsupportedOutputError)
  await expect(buildDocxBlob({ pmDoc: node, documentMeta: duplicate.meta })).rejects.toThrow(UnsupportedOutputError)
  expect(JSON.stringify(node.toJSON())).toContain(meta.proposer)
  expect(JSON.stringify(node.toJSON())).toContain(meta.technicalCommittee)
  expect(source).toEqual(before)
})
