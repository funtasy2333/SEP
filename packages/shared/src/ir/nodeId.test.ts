import { describe, expect, it } from 'vitest'
import { NODE_ID_LENGTH, generateNodeId } from './nodeId'

describe('generateNodeId', () => {
  it('生成 12 位字母数字 ID', () => {
    for (let i = 0; i < 1000; i++) {
      const id = generateNodeId()
      expect(id).toMatch(/^[A-Za-z0-9]{12}$/)
      expect(id).toHaveLength(NODE_ID_LENGTH)
    }
  })

  it('10 万次生成无碰撞', () => {
    const seen = new Set<string>()
    const count = 100_000
    for (let i = 0; i < count; i++) {
      seen.add(generateNodeId())
    }
    expect(seen.size).toBe(count)
  })
})
