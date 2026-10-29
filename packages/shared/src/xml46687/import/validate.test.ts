import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import { validateXml46687 } from './validate'
import { detectLegacyXml46687 } from './legacy'

const samples = resolve(process.cwd(), '../../schemas/gbt46687.2/samples')
function load(group: string, name: string) {
  const result = parseXml46687(readFileSync(resolve(samples, group, name), 'utf8'))
  expect(result.problems).toEqual([])
  return result.tree!
}

describe('[M-4.1-01] 导入校验', () => {
  for (const name of readdirSync(resolve(samples, 'valid')).filter(n => n.endsWith('.xml'))) {
    it(`接受有效样例 ${name}`, () => {
      const tree = load('valid', name)
      expect(detectLegacyXml46687(tree)).toEqual([])
      expect(validateXml46687(tree).problems.filter(p => p.severity === 'error')).toEqual([])
    })
  }
  const cases = [
    ['app-without-annex-type.xml', 'xml-annex-type-required'],
    ['custom-xref-no-type.xml', 'xml-xref-custom-type-required'],
    ['ext-link-without-type.xml', 'xml-ext-link-type-invalid'],
    ['mathml-display-inline-in-disp-formula.xml', 'xml-math-display-invalid'],
    ['mathml-id-missing.xml', 'xml-math-id-required'],
    ['missing-app-id.xml', 'xml-app-id-required'],
    ['missing-ref-id.xml', 'xml-bibl-ref-id-required'],
    ['missing-term-entry-id.xml', 'xml-term-id-required'],
    ['p-with-id.xml', 'xml-paragraph-id-forbidden'],
    ['sec-without-label.xml', 'xml-section-label-required'],
    ['std-meta-wrong-order.xml', 'xml-meta-order-invalid'],
    ['table-wrap-without-label.xml', 'xml-table-label-required'],
    ['term-entry-without-definition.xml', 'xml-term-definition-count'],
  ] as const
  for (const [name, code] of cases) {
    it(`拒绝 ${name} 并定位 ${code}`, () => {
      const problems = validateXml46687(load('invalid', name)).problems
      expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({
        code, severity: 'error', xml: expect.objectContaining({ line: expect.any(Number), column: expect.any(Number), path: expect.any(String) }),
      })]))
    })
  }
  for (const name of ['gbt37967-root.xml', 'sep-legacy-namespace.xml']) {
    it(`独立识别旧格式 ${name}`, () => {
      expect(detectLegacyXml46687(load('invalid', name))).toEqual(expect.arrayContaining([expect.objectContaining({code: 'legacy-format', severity: 'error'})]))
    })
  }
})
