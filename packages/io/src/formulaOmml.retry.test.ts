import { describe, expect, it, vi } from 'vitest'

const loading = vi.hoisted(() => ({ attempts: 0 }))

vi.mock('mathml2omml', () => {
  loading.attempts += 1
  if (loading.attempts === 1) throw new Error('temporary chunk failure')
  return { mml2omml: () => '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>' }
})

import { convertFormulaToOmml } from './formulaOmml'

describe('公式转换器动态加载', () => {
  it('首次加载失败后，下一次转换会重新加载', async () => {
    await expect(convertFormulaToOmml('x')).rejects.toThrow()
    await expect(convertFormulaToOmml('x')).resolves.toContain('<m:oMath>')
    expect(loading.attempts).toBe(2)
  })
})
