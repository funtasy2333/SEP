// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { getCoverDesignation, pmToIr, type DocumentMeta, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { exportSemanticJson, serializeToXml } from '../serializer'
import { prepareDocxInput } from '../serializer/docxExporter'
import {
  documentMetaFromSettingsDraft,
  documentSettingsDraftFromDocument,
  synchronizeCoverMetadata,
} from './documentSettings'

const schema = getSchema(createEditorExtensions())

function legacyContent(withCover = true) {
  const content: PMJsonNode[] = []
  if (withCover) {
    content.push({
      type: 'coverPage',
      attrs: {
        standardType: 'industry', standardNo: 'HG/T 1000—2020', titleCn: '旧封面题名',
        titleEn: 'Old English title', icsCode: '35.240', ccsCode: 'L 70', issuer: '旧发布单位',
        replaces: 'HG/T 900—2018', consistency: '（ISO 1234:2020，MOD）', filingNo: '备案 123',
        industryName: '机械', regionName: '浙江省', coverDesignation: '中华人民共和国先进装备行业标准',
      },
      content: [{ type: 'paragraph' }],
    })
  }
  content.push({
    type: 'foreword',
    content: [{
      type: 'paragraph', attrs: { nodeId: 'foreword-node-keep' },
      content: [{ type: 'text', text: '人工改写的前言', marks: [{ type: 'bold' }] }],
    }],
  })
  content.push({
    type: 'chapter', attrs: { number: '1', nodeId: 'chapter-node-keep' },
    content: [
      { type: 'chapterTitle', attrs: { nodeId: 'chapter-title-keep' }, content: [{ type: 'text', text: '范围' }] },
      { type: 'stdParagraph', attrs: { nodeId: 'paragraph-node-keep' }, content: [{ type: 'text', text: '正文节点保留' }] },
    ],
  })
  return schema.nodeFromJSON({ type: schema.topNodeType.name, content }).toJSON()
}

const documentMeta = {
  standardType: 'national',
  titleCn: '数据库题名',
  titleEn: 'Database English title',
  icsCode: '',
  customSettingsEvidence: { preserved: true },
} as DocumentMeta

describe('文件设置草稿与封面同步', () => {
  it('数据库明确值优先，旧文档缺失字段从有效封面回填，未知类型原样保留', () => {
    const content = legacyContent()
    const draft = documentSettingsDraftFromDocument({
      title: '库标题', meta: documentMeta, stage: 'working_draft', content,
    })

    expect(draft).toMatchObject({
      standardType: 'national',
      titleCn: '数据库题名',
      titleEn: 'Database English title',
      standardNo: 'HG/T 1000—2020',
      icsCode: '',
      ccsCode: 'L 70',
      issuer: '旧发布单位',
      replaces: 'HG/T 900—2018',
      coverDesignation: '中华人民共和国先进装备行业标准',
      publishDate: '',
      stage: 'working_draft',
    })

    const unknownTypeDraft = documentSettingsDraftFromDocument({
      title: '库标题',
      meta: { ...documentMeta, standardType: undefined } as unknown as DocumentMeta,
      stage: 'legacy_stage',
      content: { type: 'doc', attrs: { standardType: 'constructor' }, content: [] },
    })
    expect(unknownTypeDraft.standardType).toBe('constructor')
    expect(unknownTypeDraft.stage).toBe('legacy_stage')

    const rootFallbackDraft = documentSettingsDraftFromDocument({
      title: '库标题',
      meta: {} as DocumentMeta,
      stage: 'working_draft',
      content: {
        type: 'doc',
        attrs: { standardType: 'local', standardNo: 'DB33/T 100—2024', titleCn: '根属性题名', icsCode: '03.080' },
        content: [],
      },
    })
    expect(rootFallbackDraft).toMatchObject({
      standardType: 'local', standardNo: 'DB33/T 100—2024', titleCn: '根属性题名', icsCode: '03.080',
    })
  })

  it('设置保存把非空旧完整称谓规范成前后缀加片段，空覆盖值保持为空', () => {
    const draft = documentSettingsDraftFromDocument({
      title: '行业称谓规范化',
      meta: { ...documentMeta, standardType: 'industry' } as DocumentMeta,
      stage: 'working_draft',
      content: legacyContent(),
    })
    const normalized = documentMetaFromSettingsDraft(documentMeta, {
      ...draft,
      standardType: 'industry',
      coverDesignation: '先进装备行业标准',
      industryName: '旧行业名称',
    })
    expect(normalized).toMatchObject({
      coverDesignation: '中华人民共和国先进装备行业标准',
      industryName: '先进装备',
    })

    const cleared = documentMetaFromSettingsDraft(documentMeta, {
      ...draft,
      standardType: 'industry',
      coverDesignation: '',
      industryName: '',
    })
    expect(cleared.coverDesignation).toBe('')
    expect(cleared.industryName).toBe('')
  })

  it('空的可选字段显式清除，扩展元数据保留，生产 schema 下前言、正文和节点 ID不变', () => {
    const original = legacyContent()
    const source = schema.nodeFromJSON(original)
    const draft = documentSettingsDraftFromDocument({
      title: '库标题', meta: documentMeta, stage: 'working_draft', content: original,
    })
    const meta = documentMetaFromSettingsDraft(documentMeta, {
      ...draft,
      standardType: 'industry',
      stage: 'review_draft',
      titleCn: '  更新后的标准题名  ',
      titleEn: '',
      standardNo: 'HG/T 1000—2026',
      icsCode: '',
      issuer: '',
      replaces: '',
      consistency: '',
      publishDate: '2026-05-01',
      coverDesignation: '',
    })
    const savedJson = synchronizeCoverMetadata(original, meta)
    const saved = schema.nodeFromJSON(savedJson)
    saved.check()

    expect(meta).toMatchObject({
      titleCn: '更新后的标准题名', titleEn: '', standardNo: 'HG/T 1000—2026',
      icsCode: '', issuer: '', replaces: '', consistency: '', publishDate: '2026-05-01', coverDesignation: '',
      customSettingsEvidence: { preserved: true },
    })
    expect(saved.child(1).toJSON()).toEqual(source.child(1).toJSON())
    expect(saved.child(2).toJSON()).toEqual(source.child(2).toJSON())

    const irMeta = pmToIr(saved.toJSON() as PMJsonNode).doc.meta
    expect(irMeta).toMatchObject({
      standardType: 'industry', title: '更新后的标准题名', stdCode: 'HG/T 1000—2026',
      ccsCode: 'L 70', publishDate: '2026-05-01',
    })
    expect(irMeta).not.toHaveProperty('issuer')
    expect(irMeta).not.toHaveProperty('replaces')

    const xml = serializeToXml(saved)
    expect(xml).toContain('HG/T 1000—2026')
    expect(xml).toContain('更新后的标准题名')
    expect(xml).toContain('2026-05-01')
    expect(xml).not.toContain('旧发布单位')
    expect(xml).not.toContain('<meta-name>coverDesignation</meta-name>')

    const semantic = exportSemanticJson(saved)
    expect(semantic.content?.[0]).toMatchObject({
      type: 'coverPage',
      attrs: { standardNo: 'HG/T 1000—2026', titleCn: '更新后的标准题名', issuer: '', coverDesignation: '' },
    })
    const docxMeta = prepareDocxInput(saved, meta).doc.meta
    expect(docxMeta).toMatchObject({ stdCode: 'HG/T 1000—2026', title: '更新后的标准题名', issuer: '', coverDesignation: '' })
    expect(getCoverDesignation(docxMeta)).toBe('中华人民共和国机械行业标准')
  })

  it('旧文档没有 coverPage 时插入封面且不丢正文，也不推测缺失日期', () => {
    const original = legacyContent(false)
    const originalBody = schema.nodeFromJSON(original).toJSON().content
    const meta: DocumentMeta = { standardType: 'guidance', titleCn: '无封面文档' }
    const synced = synchronizeCoverMetadata(original, meta)
    const saved = schema.nodeFromJSON(synced)
    saved.check()

    expect(saved.child(0).type.name).toBe('coverPage')
    expect(saved.child(0).attrs.standardType).toBe('guidance')
    expect(saved.child(0).attrs.publishDate).toBe('')
    expect(saved.toJSON().content?.slice(1)).toEqual(originalBody)
  })
})
