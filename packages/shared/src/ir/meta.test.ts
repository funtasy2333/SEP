import { describe, expect, it } from 'vitest'
import { irMetaFromDocumentMeta, toIrStandardType } from './meta'
import type { DocumentMeta } from '../types/document'

describe('toIrStandardType', () => {
  it('文档库口径的 6 个取值全部映射为 IR 口径', () => {
    expect(toIrStandardType('national')).toBe('gb')
    expect(toIrStandardType('industry')).toBe('industry')
    expect(toIrStandardType('local')).toBe('local')
    expect(toIrStandardType('group')).toBe('group')
    expect(toIrStandardType('enterprise')).toBe('enterprise')
    expect(toIrStandardType('guidance')).toBe('guide')
  })

  it('也接受已经是 IR 口径的取值 gb、guide，原样返回', () => {
    expect(toIrStandardType('gb')).toBe('gb')
    expect(toIrStandardType('guide')).toBe('guide')
  })

  it('未知取值与 undefined 返回 undefined', () => {
    expect(toIrStandardType('weird')).toBeUndefined()
    expect(toIrStandardType('')).toBeUndefined()
    expect(toIrStandardType(undefined)).toBeUndefined()
  })

  it('撞上 Object.prototype 属性名的取值一律返回 undefined（审查第 1 条：原型链查找）', () => {
    expect(toIrStandardType('constructor')).toBeUndefined()
    expect(toIrStandardType('toString')).toBeUndefined()
    expect(toIrStandardType('__proto__')).toBeUndefined()
    expect(toIrStandardType('hasOwnProperty')).toBeUndefined()
  })
})

describe('irMetaFromDocumentMeta', () => {
  const full: DocumentMeta = {
    standardNo: 'GB/T 12345—2026',
    icsCode: '35.240',
    ccsCode: 'L 70',
    titleCn: '标准化文件编辑系统',
    titleEn: 'Standardization document editing system',
    publishDate: '2026-06-01',
    implementDate: '2026-12-01',
    standardType: 'national',
    issuer: '国家市场监督管理总局',
    applicant: '某申请单位',
    proposer: '某提出单位',
    technicalCommittee: '某归口单位',
  }

  it('字段映射：titleCn→title、standardNo→stdCode，其余同名复制，standardType 经 toIrStandardType', () => {
    expect(irMetaFromDocumentMeta(full)).toEqual({
      title: '标准化文件编辑系统',
      titleEn: 'Standardization document editing system',
      stdCode: 'GB/T 12345—2026',
      icsCode: '35.240',
      ccsCode: 'L 70',
      publishDate: '2026-06-01',
      implementDate: '2026-12-01',
      standardType: 'gb',
      issuer: '国家市场监督管理总局',
      applicant: '某申请单位',
    })
  })

  it('proposer、technicalCommittee 不进 IR', () => {
    const out = irMetaFromDocumentMeta(full)
    expect('proposer' in out).toBe(false)
    expect('technicalCommittee' in out).toBe(false)
  })

  it('meta 为 undefined 时返回空对象', () => {
    expect(irMetaFromDocumentMeta(undefined)).toEqual({})
  })

  it('可选字段 undefined 时跳过对应 key（不出现在结果里）', () => {
    const minimal: DocumentMeta = { titleCn: '标题', standardType: 'industry' }
    const out = irMetaFromDocumentMeta(minimal)
    expect(out).toEqual({ title: '标题', standardType: 'industry' })
    expect('titleEn' in out).toBe(false)
    expect('stdCode' in out).toBe(false)
    expect('icsCode' in out).toBe(false)
    expect('ccsCode' in out).toBe(false)
    expect('issuer' in out).toBe(false)
    expect('applicant' in out).toBe(false)
    expect('publishDate' in out).toBe(false)
    expect('implementDate' in out).toBe(false)
  })

  it('空字符串照常复制，不当作 undefined 跳过', () => {
    const withEmpty: DocumentMeta = { titleCn: '', titleEn: '', standardType: 'local' }
    const out = irMetaFromDocumentMeta(withEmpty)
    expect(out.title).toBe('')
    expect(out.titleEn).toBe('')
    expect('title' in out).toBe(true)
    expect('titleEn' in out).toBe(true)
  })

  it('standardType 无法识别时该 key 被跳过（toIrStandardType 返回 undefined）', () => {
    const weird = { titleCn: '标题', standardType: 'weird' } as unknown as DocumentMeta
    const out = irMetaFromDocumentMeta(weird)
    expect('standardType' in out).toBe(false)
  })
})
