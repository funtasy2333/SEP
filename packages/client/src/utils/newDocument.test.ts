// @vitest-environment happy-dom
import JSZip from 'jszip'
import { Editor, getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { analyzeDocument, pmToIr, UnsupportedOutputError, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { NODE_ID_TYPES } from '../extensions/plugins/ensureNodeId'
import { semanticLabels } from './semanticLabels'
import { buildDocxBlob, prepareDocxInput } from '../serializer/docxExporter'
import { parseXmlToEditorJson, serializeToXml } from '../serializer'
import {
  createDefaultDocumentContent, createNewDocument, newDocumentStandardNo, NORMATIVE_REFERENCES_LEAD, TERMS_AND_DEFINITIONS_LEAD, type NewDocForm,
} from './newDocument'

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

it('新建时完整持久化前言和提出/归口元数据，DOCX保留而旧XML拒绝', async () => {
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
    patent, '本文件由提出单位甲提出。', '本文件由归口单位乙归口。', '本文件起草单位：起草单位丙、起草单位丁。', '本文件主要起草人：',
  ])
  expect(prepareDocxInput(node, stored.meta).doc.meta).toMatchObject({ proposer: '提出单位甲', technicalCommittee: '归口单位乙' })
  expect(() => serializeToXml(node)).toThrow(UnsupportedOutputError)
  const zip = await JSZip.loadAsync(await (await buildDocxBlob({ pmDoc: node, documentMeta: stored.meta })).blob.arrayBuffer())
  const documentXml = await zip.file('word/document.xml')!.async('string')
  expect(documentXml).toContain('本文件由提出单位甲提出。')
  expect(documentXml).toContain('本文件由归口单位乙归口。')
  const properties = new DOMParser().parseFromString(await zip.file('docProps/custom.xml')!.async('string'), 'application/xml')
  expect(properties.querySelector('[name="ses-proposer"]')?.textContent).toBe('提出单位甲')
  expect(properties.querySelector('[name="ses-technicalCommittee"]')?.textContent).toBe('归口单位乙')
  expect(JSON.stringify(node.toJSON())).toContain('提出单位甲')
  expect(JSON.stringify(node.toJSON())).toContain('归口单位乙')
})

it('不含新增作者元数据的旧文档仍能导出前言正文和封面信息', async () => {
  const created = createNewDocument({ ...blankForm(), applicant: '起草单位丙、起草单位丁',
    replaces: ' GB/T 1000—2020 ', consistency: '（ISO 1234:2020，MOD）',
  })
  // Older manuscripts may already contain these responsibility sentences as ordinary text.
  created.content.content![1]!.content!.splice(2, 0,
    { type: 'paragraph', attrs: { nodeId: 'legacy-proposer-text' }, content: [{ type: 'text', text: '本文件由提出单位甲提出。' }] },
    { type: 'paragraph', attrs: { nodeId: 'legacy-committee-text' }, content: [{ type: 'text', text: '本文件由归口单位乙归口。' }] },
  )
  const stored = JSON.parse(JSON.stringify(created))
  const schema = getSchema(createEditorExtensions())
  const node = schema.nodeFromJSON(stored.content)
  node.check()
  const foreword = node.child(1)
  const xml = serializeToXml(node)
  const reloaded = schema.nodeFromJSON(parseXmlToEditorJson(xml, schema.topNodeType.name))
  expect(prepareDocxInput(reloaded).doc.meta).toMatchObject({
    stdCode: 'GB/T XXXXX—XXXX', replaces: 'GB/T 1000—2020', consistency: '（ISO 1234:2020，MOD）',
  })
  expect(reloaded.child(1).textContent).toBe(foreword.textContent)
  const { blob, warnings } = await buildDocxBlob({ pmDoc: node, documentMeta: stored.meta, stage: stored.stage })
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const body = await zip.file('word/document.xml')!.async('string')
  for (const text of [patent, '本文件由提出单位甲提出。', '本文件由归口单位乙归口。', '本文件起草单位：起草单位丙、起草单位丁。', '本文件主要起草人：',
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

it('新建将缺少固定前缀的旧行业称谓规范化，并同步兼容行业名称', () => {
  const created = createNewDocument({
    ...blankForm(), type: 'industry', coverDesignation: '先进装备行业标准', industryName: '旧名称',
  })
  expect(created.meta.coverDesignation).toBe('中华人民共和国先进装备行业标准')
  expect(created.meta.industryName).toBe('先进装备')
  expect(created.content.content?.[0]?.attrs?.coverDesignation).toBe('中华人民共和国先进装备行业标准')
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
  expect(first.content![0]!.content!.map((p) => p.content![0]!.text)).toHaveLength(3)
  expect(first.content![0]!.content![1]!.content![0]!.text).toBe(patent)
  first.content![0]!.content![1]!.content![0]!.text = '用户已修改'
  expect(second.content![0]!.content![1]!.content![0]!.text).toBe(patent)
})

describe('默认章节的标准引导语（GB/T 1.1—2020 8.6.2、8.7.2）', () => {
  const normLead = '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。其中，注日期的引用文件，仅该日期对应的版本适用于本文件；不注日期的引用文件，其最新版本（包括所有的修改单）适用于本文件。'
  const termsLead = '下列术语和定义适用于本文件。'

  it('新建文档的第2、3章各以一个无编号正文段给出完整引导语，第1章仍为空段', () => {
    const schema = getSchema(createEditorExtensions())
    const node = schema.nodeFromJSON(createNewDocument(blankForm()).content)
    node.check()
    const chapters = node.content.content.filter(child => child.type.name === 'chapter')
    expect(chapters.map(chapter => chapter.firstChild!.textContent)).toEqual(['范围', '规范性引用文件', '术语和定义'])
    expect(chapters.map(chapter => chapter.childCount)).toEqual([2, 2, 2])
    expect(chapters.map(chapter => [chapter.child(1).type.name, chapter.child(1).textContent])).toEqual([
      ['stdParagraph', ''], ['stdParagraph', normLead], ['stdParagraph', termsLead],
    ])
    expect(NORMATIVE_REFERENCES_LEAD).toBe(normLead)
    expect(TERMS_AND_DEFINITIONS_LEAD).toBe(termsLead)
  })

  it('引导语不编号、不计为术语条目或引用文件，也不触发规范性引用文件格式提示', () => {
    const content = assignTestNodeIds(createDefaultDocumentContent())
    const { doc } = pmToIr(content)
    const terms = doc.body[2]!
    expect(terms.children.map(child => child.kind)).toEqual(['paragraph'])
    const { labels } = semanticLabels(content)
    const paragraphIds = doc.body.slice(1).map(chapter => (chapter.children[0] as { id: string }).id)
    for (const id of paragraphIds) expect(labels[id]).toBeUndefined()
    const validation = analyzeDocument(doc).validation
    expect(validation.issues.filter(issue => issue.ruleId.startsWith('normative-reference.'))).toEqual([])
    expect(validation.coverage.normativeReferences.reason).not.toContain('无法识别的出版物')
  })

  it('引导语可编辑并在保存重开、DOCX 导出后保留', async () => {
    const created = createNewDocument(blankForm())
    const schema = getSchema(createEditorExtensions())
    const editor = new Editor({ extensions: createEditorExtensions(), content: JSON.parse(JSON.stringify(created.content)) })
    try {
      // 按“没有规范性引用文件”的情形改写第2章引导语
      let leadPos = -1
      editor.state.doc.descendants((child, pos) => {
        if (leadPos < 0 && child.type.name === 'stdParagraph' && child.textContent === normLead) leadPos = pos
      })
      editor.view.dispatch(editor.state.tr.insertText('本文件没有规范性引用文件。', leadPos + 1, leadPos + 1 + normLead.length))
      const reopened = schema.nodeFromJSON(JSON.parse(JSON.stringify(editor.getJSON())))
      const texts = reopened.content.content.filter(child => child.type.name === 'chapter').map(chapter => chapter.child(1).textContent)
      expect(texts).toEqual(['', '本文件没有规范性引用文件。', termsLead])
      const zip = await JSZip.loadAsync(await (await buildDocxBlob({ pmDoc: reopened, documentMeta: created.meta })).blob.arrayBuffer())
      const body = await zip.file('word/document.xml')!.async('string')
      expect(body).toContain('本文件没有规范性引用文件。')
      expect(body).toContain(termsLead)
    } finally {
      editor.destroy()
    }
  })

  it('只在空内容初始化时套用：每次生成独立副本，不向已有正文追加', () => {
    const first = createDefaultDocumentContent()
    const second = createDefaultDocumentContent()
    const lead = (content: ReturnType<typeof createDefaultDocumentContent>) => content.content![2]!.content![1]!.content![0]!
    lead(first).text = '用户已改写的引导语'
    expect(lead(second).text).toBe(normLead)
  })
})

function assignTestNodeIds<T extends PMJsonNode>(node: T): T {
  let serial = 0
  const visit = (current: PMJsonNode) => {
    if (NODE_ID_TYPES.includes(current.type)) current.attrs = { ...current.attrs, nodeId: `n${++serial}` }
    current.content?.forEach(visit)
  }
  visit(node)
  return node
}
