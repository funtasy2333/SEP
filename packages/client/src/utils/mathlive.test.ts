// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { configureMathfieldElement, loadMathLive, validateWhereSymbolLatex } from './mathlive'

describe('式中符号 LaTeX 校验', () => {
  it.each([
    ['q_{V}', 'q_{V}'],
    [String.raw`  \rho_{\mathrm{w}} `, String.raw`\rho_{\mathrm{w}}`],
  ])('通过：%j', (input, latex) => {
    expect(validateWhereSymbolLatex(input)).toEqual({ ok: true, latex })
  })

  it.each([
    ['', '请输入符号'],
    ['   ', '请输入符号'],
    [String.raw`q_{\placeholder{}}`, '符号中还有未填写的位置'],
    [String.raw`\frac{`, 'KaTeX 无法解析'],
    [String.raw`\differentialD x`, 'KaTeX 无法解析'],
  ])('拒绝：%j', (input, message) => {
    const result = validateWhereSymbolLatex(input)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain(message)
  })
})

describe('MathLive 加载', () => {
  it('配置为不加载外部字体与音效，虚拟键盘只在手动请求时显示', () => {
    const element = { fontsDirectory: './fonts' as string | null, soundsDirectory: './sounds' as string | null, plonkSound: 'plonk.wav' as string | null, keypressSound: 'k.wav' as unknown }
    configureMathfieldElement(element)
    expect(element).toEqual({ fontsDirectory: null, soundsDirectory: null, plonkSound: null, keypressSound: null })
  })

  it('加载失败时返回 null，下一次重新尝试', async () => {
    const importer = vi.fn()
      .mockRejectedValueOnce(new Error('chunk 加载失败'))
      .mockResolvedValueOnce({ MathfieldElement: { fontsDirectory: './fonts', soundsDirectory: './sounds', plonkSound: null, keypressSound: null } })
    expect(await loadMathLive(importer)).toBeNull()
    expect(await loadMathLive(importer)).not.toBeNull()
    expect(importer).toHaveBeenCalledTimes(2)
  })
})
