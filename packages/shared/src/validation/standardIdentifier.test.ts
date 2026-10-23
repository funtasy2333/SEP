import { describe, expect, it } from 'vitest'
import { parseStandardIdentifier } from './standardIdentifier'

describe('parseStandardIdentifier', () => {
  it('parses common domestic and international identifiers without requiring a date', () => {
    expect(parseStandardIdentifier('GB/T 1.1—2020 标准化工作导则')).toMatchObject({
      recognized: true, valid: true, identifier: 'GB/T 1.1—2020', title: '标准化工作导则', dated: true,
    })
    expect(parseStandardIdentifier('ISO/IEC 27001 信息安全管理')).toMatchObject({
      recognized: true, valid: true, identifier: 'ISO/IEC 27001', title: '信息安全管理', dated: false,
    })
  })

  it('distinguishes malformed known-family identifiers from unknown publications', () => {
    expect(parseStandardIdentifier('GB/T ??? 标准标题')).toMatchObject({ recognized: true, valid: false })
    expect(parseStandardIdentifier('某出版社内部手册')).toMatchObject({ recognized: false, valid: false })
  })

  it('normalizes full-width punctuation and spacing while preserving the author title', () => {
    expect(parseStandardIdentifier('ＧＢ／Ｔ　１２３４５—２０２６　文件标题')).toMatchObject({
      recognized: true, valid: true, identifier: 'GB/T 12345—2026', title: '文件标题', dated: true,
    })
  })

  it('supports group, local, and multipart ISO identifiers with a separate year', () => {
    expect(parseStandardIdentifier('T/ABC 001—2026 团体标准名称')).toMatchObject({
      recognized: true, valid: true, identifier: 'T/ABC 001—2026', title: '团体标准名称', dated: true,
    })
    expect(parseStandardIdentifier('DB33/T 123—2024 地方标准名称')).toMatchObject({
      recognized: true, valid: true, identifier: 'DB33/T 123—2024', title: '地方标准名称', dated: true,
    })
    expect(parseStandardIdentifier('ISO/IEC 27001-1:2022 信息安全管理')).toMatchObject({
      recognized: true, valid: true, identifier: 'ISO/IEC 27001-1:2022', title: '信息安全管理', dated: true,
    })
  })
})
