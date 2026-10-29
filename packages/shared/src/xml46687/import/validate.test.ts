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

describe('[M-10.1.9-02] 语义和安全规则', () => {
  const cases = [
    ['dup-id.xml', 'xml-id-duplicate', undefined],
    ['dangling-rid.xml', 'xml-reference-dangling', undefined],
    ['wrong-xref-type.xml', 'xml-reference-kind', undefined],
    ['term-sec-outside-terms.xml', 'xml-content-model', 'V-2'],
    ['numbered-paragraph-with-title.xml', 'xml-content-model', 'V-2'],
    ['chapter-sec-type-intro.xml', 'xml-content-model', 'V-2'],
    ['front-scope-sec.xml', 'xml-content-model', 'V-2'],
    ['bibl-ref-list-in-app.xml', 'xml-content-model', 'V-3'],
    ['bad-app-content-type.xml', 'xml-content-model', 'V-3'],
    ['bad-ref-list-content-type.xml', 'xml-content-model', 'V-3'],
    ['bad-date-format.xml', 'xml-date-invalid', 'V-4'],
    ['invalid-calendar-date.xml', 'xml-date-invalid', 'V-4'],
    ['dup-release-date.xml', 'xml-date-invalid', 'V-4'],
    ['bad-list-type.xml', 'xml-content-model', 'V-5'],
    ['unordered-list-label.xml', 'xml-content-model', 'V-5'],
    ['bad-processing-meta.xml', 'xml-content-model', 'V-6'],
    ['title-wrap-no-lang.xml', 'xml-content-model', 'V-6'],
    ['mathml-onclick.xml', 'xml-unsupported', 'V-10'],
    ['mathml-href-control-char.xml', 'xml-unsupported', 'V-10'],
    ['js-ext-link.xml', 'xml-unsupported', 'V-11'],
    ['ext-link-newline-in-url.xml', 'xml-unsupported', 'V-11'],
    ['ext-link-tab-in-scheme.xml', 'xml-unsupported', 'V-11'],
    ['nested-table.xml', 'xml-unsupported', 'M-6.1-06'],
    ['std-in-tbx-source.xml', 'xml-unsupported', 'M-9.2.8-02'],
    ['fig-footnote.xml', 'xml-unsupported', 'M-8.6-02'],
    ['block-level-fn.xml', 'xml-unsupported', 'M-10.1.8-01'],
    ['nested-term-entry.xml', 'xml-unsupported', 'M-9.1-03'],
    ['definition-target.xml', 'xml-unsupported', 'M-C.1-08'],
    ['caption-two-titles.xml', 'xml-content-model', 'M-6.2.1-06'],
  ] as const
  for (const [name, code, rule] of cases) {
    it(`按 ${rule ?? code} 拒绝 ${name}`, () => {
      const expected = { code, severity: 'error', ...(rule ? { detail: expect.objectContaining({ rule }) } : {}) }
      expect(validateXml46687(load('invalid', name)).problems).toEqual(expect.arrayContaining([expect.objectContaining(expected)]))
    })
  }
})
