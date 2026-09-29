import { describe, expect, it } from 'vitest'
import { toXmlListType } from './xmlSerializer'

describe('XML 列项导出类型', () => {
  it('旧罗马列项导出为阿拉伯数字类型，不再产生罗马类型', () => {
    expect(toXmlListType('roman')).toBe('arabic')
    expect(toXmlListType('romanUpper')).toBe('arabic')
    expect(toXmlListType('numeric')).toBe('arabic')
    expect(toXmlListType('alpha')).toBe('alpha-lower')
    expect(toXmlListType('dash')).toBe('dash')
  })
})
