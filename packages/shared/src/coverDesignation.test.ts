import { describe, expect, it } from 'vitest'
import {
  buildCoverDesignation, getCoverDesignation, getCoverDesignationName, getCoverDesignationParts,
} from './coverDesignation'

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

describe('标准类型名称片段', () => {
  it.each([
    ['industry', '中华人民共和国先进装备行业标准', '先进装备', '中华人民共和国先进装备行业标准'],
    ['industry', '机械行业标准', '机械', '中华人民共和国机械行业标准'],
    ['local', '浙江省数字技术地方标准', '浙江省数字技术', '浙江省数字技术地方标准'],
    ['group', '电子信息协会团体标准', '电子信息协会', '电子信息协会团体标准'],
    ['enterprise', '某科技有限公司企业标准', '某科技有限公司', '某科技有限公司企业标准'],
  ] as const)('%s 从旧称谓读取片段并规范化输出', (standardType, oldValue, name, canonical) => {
    expect(getCoverDesignationParts(standardType)).toBeDefined()
    expect(getCoverDesignationName({ standardType, coverDesignation: oldValue })).toBe(name)
    expect(buildCoverDesignation(standardType, name)).toBe(canonical)
  })

  it('空值回退行业/地方旧字段，未知旧文本保留且未知类型不命中对象原型键', () => {
    expect(getCoverDesignationName({ standardType: 'industry', industryName: '机械' })).toBe('机械')
    expect(getCoverDesignationName({ standardType: 'local', regionName: '浙江省' })).toBe('浙江省')
    expect(getCoverDesignationName({ standardType: 'group', coverDesignation: '旧版自定义抬头' })).toBe('旧版自定义抬头')
    expect(getCoverDesignationParts('constructor')).toBeUndefined()
    expect(getCoverDesignationParts('__proto__')).toBeUndefined()
  })
})
