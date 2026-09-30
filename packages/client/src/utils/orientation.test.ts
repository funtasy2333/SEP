import { describe, expect, it } from 'vitest'
import { normalizePageOrientation, readPageOrientation } from './orientation'

function elementWithAttributes(attributes: Record<string, string>): Element {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
  } as unknown as Element
}

describe('图表页面方向', () => {
  it('只接受 landscape，其余值回退到 portrait', () => {
    expect(normalizePageOrientation('landscape')).toBe('landscape')
    expect(normalizePageOrientation('portrait')).toBe('portrait')
    expect(normalizePageOrientation(undefined)).toBe('portrait')
    expect(normalizePageOrientation('sideways')).toBe('portrait')
  })

  it('读取 XML orientation 与编辑器 data-orientation 属性', () => {
    expect(readPageOrientation(elementWithAttributes({ orientation: 'landscape' }))).toBe('landscape')
    expect(readPageOrientation(elementWithAttributes({ 'data-orientation': 'landscape' }))).toBe('landscape')
    expect(readPageOrientation(elementWithAttributes({ orientation: 'portrait' }))).toBe('portrait')
  })
})
