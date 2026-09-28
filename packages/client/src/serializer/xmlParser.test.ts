import { describe, expect, it } from 'vitest'
import { fromXmlListType } from './xmlParser'

describe('XML 列项导入类型', () => {
  it('旧罗马列项 XML 兼容解析为数字类型', () => {
    expect(fromXmlListType('roman-lower')).toBe('numeric')
    expect(fromXmlListType('roman-upper')).toBe('numeric')
    expect(fromXmlListType('arabic')).toBe('numeric')
    expect(fromXmlListType('alpha-lower')).toBe('alpha')
    expect(fromXmlListType('dash')).toBe('dash')
  })
})
