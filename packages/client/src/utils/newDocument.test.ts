// @vitest-environment happy-dom
import JSZip from 'jszip'
import { getSchema } from '@tiptap/core'
import { expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { buildDocxBlob, prepareDocxInput } from '../serializer/docxExporter'
import { parseXmlToEditorJson, serializeToXml } from '../serializer'
import { createDefaultDocumentContent, createNewDocument, newDocumentStandardNo, type NewDocForm } from './newDocument'

const blankForm = (): NewDocForm => ({
  type: 'national', stage: 'working_draft', titleCn: '新建验收标准', titleEn: '', stdPrefix: '', stdNo: '',
  icsCode: '', ccsCode: '', issuer: '', applicant: '', proposer: '', technicalCommittee: '',
  replaces: '', consistency: '',
})
const patent = '请注意本文件的某些内容可能涉及专利。本文件的发布机构不承担识别这些专利的责任。'

it.each([
  ['national', 'GB/T'], ['industry', 'XX/T'], ['local', 'DBXX/T'],
  ['group', 'T/XXX'], ['enterprise', 'Q/XXX'], ['guidance', 'GB/Z'],
] as const)('新建%s：预览与实际保存共用占位编号，不预填未知地区/机构/年份', (type, prefix) => {
  const form = { ...blankForm(), type, stdNo: ' \t' }
  const created = createNewDocument(form)
  expect(newDocumentStandardNo(form)).toBe(`${prefix} XXXXX—XXXX`)
  expect(created.meta.standardNo).toBe(newDocumentStandardNo(form))
  const stored = JSON.parse(JSON.stringify(created))
  expect(stored.content.content[0].attrs.standardNo).toBe(created.meta.standardNo)
})

it('明确填写的前缀和编号保留，空前缀使用所选类型而不丢代号', () => {
  expect(createNewDocument({ ...blankForm(), stdPrefix: ' HG/T ', stdNo: ' 1234—2026 ' }).meta.standardNo).toBe('HG/T 1234—2026')
  expect(createNewDocument({ ...blankForm(), type: 'guidance', stdNo: '1234—2026' }).meta.standardNo).toBe('GB/Z 1234—2026')
})

it('新建时持久化的前言经生产schema、XML和DOCX保留单位、专利及两项封面信息', async () => {
  const created = createNewDocument({ ...blankForm(),
    proposer: '  提出单位甲  ', technicalCommittee: '归口单位乙', applicant: '起草单位丙、起草单位丁',
    replaces: ' GB/T 1000—2020 ', consistency: '（ISO 1234:2020，MOD）',
  })
  const schema = getSchema(createEditorExtensions())
  const stored = JSON.parse(JSON.stringify(created))
  const node = schema.nodeFromJSON(stored.content)
  const foreword = node.child(1)
  expect(foreword.type.name).toBe('foreword')
  expect(foreword.content.content.map((p) => p.textContent)).toEqual([
    '本文件按照GB/T 1.1-2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草。',
    patent, '本文件由提出单位甲提出。', '本文件由归口单位乙归口。', '本文件起草单位：起草单位丙、起草单位丁。',
  ])
  const xml = serializeToXml(node)
  const reloaded = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
  expect(prepareDocxInput(reloaded).doc.meta).toMatchObject({
    stdCode: 'GB/T XXXXX—XXXX', replaces: 'GB/T 1000—2020', consistency: '（ISO 1234:2020，MOD）',
  })
  expect(reloaded.child(1).textContent).toBe(foreword.textContent)
  const { blob, warnings } = await buildDocxBlob({ pmDoc: node, documentMeta: stored.meta, stage: stored.stage })
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const body = await zip.file('word/document.xml')!.async('string')
  for (const text of [patent, '本文件由提出单位甲提出。', '本文件由归口单位乙归口。', '本文件起草单位：起草单位丙、起草单位丁。',
    'GB/T XXXXX—XXXX', 'XXXX-XX-XX 发布', 'XXXX-XX-XX 实施', '代替 GB/T 1000—2020', '（ISO 1234:2020，MOD）']) expect(body).toContain(text)
  expect(body).toContain('w:val="SesCoverDates"')
  expect(stored.meta.publishDate).toBeUndefined()
  expect(stored.meta.implementDate).toBeUndefined()
  expect(warnings.some((w) => w.code === 'cover-field-missing' && w.message.includes('stdCode'))).toBe(false)
})

it('新建表单中的完整封面称谓同步到文档元数据和生产封面属性', () => {
  const created = createNewDocument({
    ...blankForm(), type: 'enterprise', coverDesignation: '某科技有限公司企业标准',
  })
  expect(created.meta.coverDesignation).toBe('某科技有限公司企业标准')
  expect(created.content.content?.[0]?.attrs?.coverDesignation).toBe('某科技有限公司企业标准')
})

it('新建内容初始化时保留可选封面完整称谓', () => {
  const meta = { ...createNewDocument(blankForm()).meta, coverDesignation: '中华人民共和国定制企业标准' }
  const content = createDefaultDocumentContent(meta)
  const schema = getSchema(createEditorExtensions())
  const node = schema.nodeFromJSON(content)
  expect(node.child(0).attrs.coverDesignation).toBe(meta.coverDesignation)
})

it('未填写单位时省略空责任语句，仍保留专利提示且每份默认正文独立', () => {
  const first = createDefaultDocumentContent()
  const second = createDefaultDocumentContent()
  expect(first.content![0]!.content!.map((p) => p.content![0]!.text)).toHaveLength(2)
  expect(first.content![0]!.content![1]!.content![0]!.text).toBe(patent)
  first.content![0]!.content![1]!.content![0]!.text = '用户已修改'
  expect(second.content![0]!.content![1]!.content![0]!.text).toBe(patent)
})
