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
})
