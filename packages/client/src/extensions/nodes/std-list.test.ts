import { describe, expect, it } from 'vitest'
import { normalizeStdListType } from './std-list'

describe('标准列项类型兼容', () => {
  it('旧罗马类型降级为数字类型，其他受支持类型保留', () => {
    expect(normalizeStdListType('roman')).toBe('numeric')
    expect(normalizeStdListType('romanUpper')).toBe('numeric')
    expect(normalizeStdListType('alpha')).toBe('alpha')
    expect(normalizeStdListType('numeric')).toBe('numeric')
    expect(normalizeStdListType('dash')).toBe('dash')
    expect(normalizeStdListType('dot')).toBe('dot')
  })
})
