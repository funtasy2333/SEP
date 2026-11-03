import { expect, it } from 'vitest'
import { IMPORT_PROBLEM_CODES, importParserProblem } from './contracts'

it('公共码目录唯一且固定，包括解析、严格规则和通用诊断', () => {
  expect(IMPORT_PROBLEM_CODES).toHaveLength(35)
  expect(new Set(IMPORT_PROBLEM_CODES).size).toBe(35)
  expect(IMPORT_PROBLEM_CODES).toEqual(expect.arrayContaining(['xml-syntax', 'xml-term-definition-count', 'xml-schema-invalid']))
})

it('解析器诊断窄转换保留代码和位置且不共享位置对象', () => {
  const source = { code: 'xml-syntax' as const, severity: 'error' as const, message: 'XML 不完整', xml: { line: 3, column: 4, path: '/a[1]' } }
  const converted = importParserProblem(source)
  expect(converted).toEqual(source)
  expect(converted.xml).not.toBe(source.xml)
})
