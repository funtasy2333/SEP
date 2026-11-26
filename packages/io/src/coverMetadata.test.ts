import { describe, expect, it } from 'vitest'
import type { DocumentMeta } from '@ses/shared'
import { COVER_SETTINGS_KEYS, synchronizeCoverMetadata } from './coverMetadata'

describe('封面元数据同步', () => {
  it('封面键列表包含全部可编辑的封面字段', () => {
    expect(COVER_SETTINGS_KEYS).toEqual([
      'standardType', 'standardNo', 'titleCn', 'titleEn', 'icsCode', 'ccsCode', 'issuer', 'applicant', 'proposer', 'technicalCommittee',
      'publishDate', 'implementDate', 'replaces', 'consistency', 'filingNo', 'industryName', 'regionName', 'coverDesignation',
    ])
  })

  it('没有封面节点时在文档开头创建，库元数据为准，缺失字段按空字符串写入', () => {
    const meta: DocumentMeta = { standardType: 'national', titleCn: '库标题', standardNo: '' }
    const synced = synchronizeCoverMetadata({ type: 'doc', content: [{ type: 'chapter' }] }, meta) as {
      content: Array<{ type: string; attrs?: Record<string, string> }>
    }
    expect(synced.content.map((node) => node.type)).toEqual(['coverPage', 'chapter'])
    expect(synced.content[0]!.attrs).toMatchObject({ standardType: 'national', titleCn: '库标题', standardNo: '', titleEn: '' })
  })

  it('库元数据未提供的字段沿用已有值：封面优先字段先取封面，其余先取根属性', () => {
    const content = {
      type: 'doc',
      attrs: { titleEn: '根英文标题', replaces: '根代替号' },
      content: [{ type: 'coverPage', attrs: { titleEn: '封面英文标题', replaces: '封面代替号' } }],
    }
    const synced = synchronizeCoverMetadata(content, { standardType: 'national', titleCn: '标题' }) as {
      attrs: Record<string, string>
      content: Array<{ attrs: Record<string, string> }>
    }
    expect(synced.content[0]!.attrs).toMatchObject({ titleEn: '根英文标题', replaces: '封面代替号' })
    // 旧版根属性仅在原本存在时同步
    expect(synced.attrs).toEqual({ titleEn: '根英文标题', replaces: '封面代替号' })
    expect(Object.keys(synced.attrs)).toEqual(['titleEn', 'replaces'])
  })

  it('不修改传入的内容对象', () => {
    const content = { type: 'doc', attrs: { titleCn: '旧' }, content: [{ type: 'coverPage', attrs: { titleCn: '旧' } }] }
    const before = JSON.stringify(content)
    synchronizeCoverMetadata(content, { standardType: 'national', titleCn: '新' })
    expect(JSON.stringify(content)).toBe(before)
  })

  it('仅在显式编辑时删除不再使用的结构化编号和发布单位并保留其他元数据', () => {
    const content = { type: 'doc', attrs: { identifiers: [
      { id: 'a', scheme: 'dated', value: 'A', parts: [] }, { id: 'b', scheme: 'dated', value: 'B', parts: [] },
      { id: 'part', parts: [{ kind: 'doc-number' }] }, { id: 'undated', scheme: 'undated', value: 'U', parts: [] },
    ], publishers: [
      { id: 'x', name: [{ text: '甲', marks: [{ type: 'bold' }] }], role: 'lead' },
      { id: 'y', name: [{ text: '乙' }], identifier: 'YY' },
    ] }, content: [
      { type: 'coverPage', attrs: { standardNo: 'A\nB', issuer: '甲\n乙' } },
      { type: 'metadataBlock', content: [
        { type: 'standardIdentifier', attrs: { nodeId: 'a', scheme: 'dated', value: 'A' } },
        { type: 'standardIdentifier', attrs: { nodeId: 'b', scheme: 'dated', value: 'B' } },
        { type: 'standardIdentifier', attrs: { nodeId: 'part' }, content: [{ type: 'identifierPart' }] },
        { type: 'publisher', attrs: { nodeId: 'x', role: 'lead' }, content: [{ type: 'text', text: '甲', marks: [{ type: 'bold' }] }] },
        { type: 'publisher', attrs: { nodeId: 'y', identifier: 'YY' }, content: [{ type: 'text', text: '乙' }] },
        { type: 'language', attrs: { tag: 'zh' } },
      ] }, { type: 'chapter', attrs: { nodeId: 'body' } },
    ] }
    const meta: DocumentMeta = { titleCn: '标题', standardType: 'group', standardNo: 'A', issuer: '甲' }
    const unrelated = synchronizeCoverMetadata(content, meta) as any
    expect(unrelated.content[1]).toEqual(content.content[1])
    const updated = synchronizeCoverMetadata(content, meta, { standardNo: true, issuer: true }) as any
    expect(updated.content[1].content).toEqual([content.content[1]!.content![0], content.content[1]!.content![2], content.content[1]!.content![3], content.content[1]!.content![5]])
    expect(updated.attrs.identifiers.map((x: any) => x.id)).toEqual(['a', 'part', 'undated'])
    expect(updated.attrs.publishers.map((x: any) => x.id)).toEqual(['x'])
    expect(updated.content[2]).toEqual(content.content[2])
    const cleared = synchronizeCoverMetadata(content, { ...meta, standardNo: '', issuer: '' }, { standardNo: true, issuer: true }) as any
    expect(cleared.content[1].content.map((x: any) => x.type)).toEqual(['standardIdentifier', 'language'])
    expect(cleared.attrs.identifiers.map((x: any) => x.id)).toEqual(['part', 'undated'])
    expect(cleared.attrs.publishers).toEqual([])
  })

  it('缩减重复值时按行数保留结构化记录', () => {
    const content = { type: 'doc', content: [{ type: 'metadataBlock', content: [
      { type: 'standardIdentifier', attrs: { nodeId: 'i1', scheme: 'dated', value: 'A' } },
      { type: 'standardIdentifier', attrs: { nodeId: 'i2', scheme: 'dated', value: 'A' } },
      { type: 'publisher', attrs: { nodeId: 'p1' }, content: [{ type: 'text', text: '甲' }] },
      { type: 'publisher', attrs: { nodeId: 'p2' }, content: [{ type: 'text', text: '甲' }] },
    ] }] }
    const result = synchronizeCoverMetadata(content, { standardType: 'group', titleCn: '标题', standardNo: 'A', issuer: '甲' }, { standardNo: true, issuer: true }) as any
    expect(result.content.find((node: any) => node.type === 'metadataBlock').content.map((node: any) => node.attrs.nodeId)).toEqual(['i1', 'p1'])
  })
})
