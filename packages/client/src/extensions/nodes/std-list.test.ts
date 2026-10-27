import { describe, expect, it } from 'vitest'
import { normalizeStdListType } from './std-list'

describe('标准列项类型兼容', () => {
  // WP8.M G7-a：原断言「roman 与 romanUpper 都降级为 numeric」；小写罗马现为受支持类型（M-5.7-04），只有 romanUpper 仍降级。
  it('[M-5.7-04] 小写罗马类型保留，大写罗马（无原文取值）降级为数字类型，其他受支持类型保留', () => {
    expect(normalizeStdListType('roman')).toBe('roman')
    expect(normalizeStdListType('romanUpper')).toBe('numeric')
    expect(normalizeStdListType('alpha')).toBe('alpha')
    expect(normalizeStdListType('numeric')).toBe('numeric')
    expect(normalizeStdListType('dash')).toBe('dash')
    expect(normalizeStdListType('dot')).toBe('dot')
  })
})
