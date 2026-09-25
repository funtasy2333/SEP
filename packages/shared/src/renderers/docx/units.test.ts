import { describe, expect, it } from 'vitest'
import { CHAR_WIDTH_TWIPS, mmToEmu, mmToTwips, ptToHalfPoint } from './units'

describe('mmToTwips', () => {
  it('§2.1 页面参数的毫米值换算结果与规格表一致', () => {
    expect(mmToTwips(34)).toBe(1928) // 上边距
    expect(mmToTwips(25)).toBe(1417) // 下边距 / 内侧 / 页眉距
    expect(mmToTwips(20)).toBe(1134) // 外侧 / 页脚距
    expect(mmToTwips(210)).toBe(11906) // A4 宽
    expect(mmToTwips(297)).toBe(16838) // A4 高
  })

  it('结果取整', () => {
    expect(Number.isInteger(mmToTwips(1))).toBe(true)
    expect(mmToTwips(0)).toBe(0)
  })
})

describe('ptToHalfPoint', () => {
  it('磅 → 半磅', () => {
    expect(ptToHalfPoint(10.5)).toBe(21) // 五号
    expect(ptToHalfPoint(9)).toBe(18) // 小五
    expect(ptToHalfPoint(4)).toBe(8) // 终结线线宽对应的字号
  })
})

describe('mmToEmu', () => {
  it('毫米 → EMU（×36000）', () => {
    expect(mmToEmu(1)).toBe(36000)
    expect(mmToEmu(25.4)).toBe(914400) // 1 英寸
    expect(mmToEmu(0)).toBe(0)
  })
})

describe('CHAR_WIDTH_TWIPS', () => {
  it('五号汉字宽为 210 twips', () => {
    expect(CHAR_WIDTH_TWIPS).toBe(210)
  })
})
