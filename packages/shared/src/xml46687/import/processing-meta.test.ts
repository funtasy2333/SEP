import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import { validateXml46687 } from './validate'

const sample = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')
function check(xml: string) {
  const parsed = parseXml46687(xml)
  expect(parsed.problems).toEqual([])
  return validateXml46687(parsed.tree!).problems
}

describe('[M-4.3.2-30] 导入处理元数据的 MathML 版本', () => {
  it('接受 MathML 2.0 并给出定位到 processing-meta 的兼容告警', () => {
    const problems = check(sample.replace('mathml-version="3.0"', 'mathml-version="2.0"'))
    expect(problems.filter(p => p.severity === 'error')).toEqual([])
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'xml-normalized', severity: 'warning', matrixId: 'M-4.3.2-30',
      detail: expect.objectContaining({rule: 'V-6'}),
      xml: expect.objectContaining({path: expect.stringContaining('/processing-meta[1]'), line: expect.any(Number), column: expect.any(Number)}),
    })]))
  })
  it('继续接受 MathML 3.0 且没有版本兼容告警', () => {
    const problems = check(sample)
    expect(problems.filter(p => p.severity === 'error')).toEqual([])
    expect(problems.filter(p => p.code === 'xml-normalized' && p.matrixId === 'M-4.3.2-30')).toEqual([])
  })
  it('拒绝其他 MathML 版本', () => {
    const problems = check(sample.replace('mathml-version="3.0"', 'mathml-version="2.1"'))
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', severity: 'error', detail: expect.objectContaining({rule: 'V-6'})})]))
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', severity: 'error', detail: expect.objectContaining({rule: 'RNG'})})]))
  })
  it('不把 2.0 作为其他处理属性的允许值', () => {
    const problems = check(sample.replace('base-tagset="interchange"', 'base-tagset="2.0"'))
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', severity: 'error', detail: expect.objectContaining({rule: 'V-6'})})]))
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', severity: 'error', detail: expect.objectContaining({rule: 'RNG'})})]))
  })
  it('版本属性缺失时仍拒绝', () => {
    const problems = check(sample.replace(' mathml-version="3.0"', ''))
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', severity: 'error', detail: expect.objectContaining({rule: 'V-6'})})]))
    expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', severity: 'error', detail: expect.objectContaining({rule: 'RNG'})})]))
  })
})
