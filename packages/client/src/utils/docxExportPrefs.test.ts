import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TABLE_CONTINUATION,
  TABLE_CONTINUATION_OPTIONS,
  TABLE_CONTINUATION_STORAGE_KEY,
  isTableContinuation,
  loadTableContinuation,
  saveTableContinuation,
} from './docxExportPrefs'

describe('DOCX 续表方式偏好', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('默认自动续表（定稿），两个选项的文字与取值固定', () => {
    expect(DEFAULT_TABLE_CONTINUATION).toBe('split')
    expect(TABLE_CONTINUATION_OPTIONS.map(option => [option.value, option.label])).toEqual([
      ['split', '自动续表（定稿）'],
      ['natural', 'Word 自然分页（编辑稿）'],
    ])
    expect(isTableContinuation('split')).toBe(true)
    expect(isTableContinuation('natural')).toBe(true)
    expect(isTableContinuation('other')).toBe(false)
    expect(isTableContinuation(null)).toBe(false)
  })

  it('保存后可读回；未保存或值非法时回退默认', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    })
    expect(loadTableContinuation()).toBe('split')
    saveTableContinuation('natural')
    expect(store.get(TABLE_CONTINUATION_STORAGE_KEY)).toBe('natural')
    expect(loadTableContinuation()).toBe('natural')
    store.set(TABLE_CONTINUATION_STORAGE_KEY, 'bogus')
    expect(loadTableContinuation()).toBe('split')
  })

  it('localStorage 读写抛错或不存在时不影响导出，回退默认值', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(loadTableContinuation()).toBe('split')
    expect(() => saveTableContinuation('natural')).not.toThrow()
    vi.stubGlobal('localStorage', undefined)
    expect(loadTableContinuation()).toBe('split')
    expect(() => saveTableContinuation('natural')).not.toThrow()
  })
})
