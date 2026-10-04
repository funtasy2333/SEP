import { describe, expect, it } from 'vitest'
import { getCoverDesignation } from './coverDesignation'

describe('getCoverDesignation', () => {
  it.each([
    ['industry', '中华人民共和国机械行业标准'],
    ['local', '浙江省地方标准'],
    ['group', '团体标准'],
    ['enterprise', '企业标准'],
  ] as const)('%s 空值沿用既有默认称谓', (standardType, expected) => {
    expect(getCoverDesignation({
      standardType,
      industryName: '机械',
      regionName: '浙江省',
      coverDesignation: '  ',
    })).toBe(expected)
  })

  it.each(['industry', 'local', 'group', 'enterprise'] as const)('%s 使用完整自定义称谓', (standardType) => {
    expect(getCoverDesignation({ standardType, coverDesignation: '某组织制定的完整标准称谓' }))
      .toBe('某组织制定的完整标准称谓')
  })

  it.each([
    ['national', '中华人民共和国国家标准'],
    ['gb', '中华人民共和国国家标准'],
    ['guidance', '中华人民共和国国家标准化指导性技术文件'],
    ['guide', '中华人民共和国国家标准化指导性技术文件'],
  ] as const)('%s 保留固定称谓并忽略覆盖值', (standardType, expected) => {
    expect(getCoverDesignation({ standardType, coverDesignation: '不应采用的旧值' })).toBe(expected)
  })
})
