import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { shouldSkipValidation } from '../../renderers/__tests__/xml46687PythonValidation'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import { getXmlAttr, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import { detectLegacyXml46687 } from './legacy'
import { validateXml46687 } from './validate'
import { mapXml46687 } from './facade'
import type { IRArray, IRFigure, IRFigureSet, IRFormula, IRFormulaGroup, IRTable } from '../../ir/types'

const sampleDir = resolve(process.cwd(), '../../schemas/gbt46687.2/samples')
// 实际 1×1 PNG 的完整字节，固定为可持久化资源；一个 href 对应一个准备好的资源。
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII='
function prepare(root: XmlElement) {
  const nodeIdsByPath = new Map<string, string>()
  const resources = new Map<string, { src: string; mediaType: string; resourceId: string }>()
  function visit(el: XmlElement) {
    nodeIdsByPath.set(el.position!.path, `node-${nodeIdsByPath.size}`)
    if (el.name.ns === null && ['graphic', 'inline-graphic'].includes(el.name.local)) {
      const href = getXmlAttr(el, XLINK_NS, 'href')
      if (href) resources.set(href, { src: png, mediaType: 'image/png', resourceId: `resource:${href}` })
    }
    for (const c of el.children) if (c.type === 'element') visit(c)
  }
  visit(root)
  return { nodeIdsByPath, resources }
}
const markers: Record<string, string> = {
  '01-minimal.xml': '本文件给出一个只含必需结构的最小文档。',
  '02-full-metadata.xml': '本文件规定了网络设备的安全要求。',
  '03-structure.xml': '这是一个无标题条，没有 title，带 numbered-paragraph 属性。',
  '04-tables.xml': '多段单元格',
  '05-formulas-figures.xml': '图形与图题之间的说明段落。',
  '06-terms-references.xml': '下列术语和定义适用于本文件。',
  '07-import-variants.xml': '无标题条，不带 sec-type 属性。',
  '08-original-forms-vs-sts.xml': '行内正文脚注，紧随其 xref。',
  '09-import-pending.xml': '引言中的有标题条。',
}

describe('WP8.3 完整有效样例的共享解析、校验与映射', () => {
  const files = readdirSync(resolve(sampleDir, 'valid')).filter(n => n.endsWith('.xml')).sort()
  it('按文件清单覆盖全部有效样例', () => expect(files).toEqual(Object.keys(markers).sort()))
  for (const file of files) {
    it(`真实资源与节点 ID 下保留 ${file} 的正文`, () => {
      const source = readFileSync(resolve(sampleDir, 'valid', file), 'utf8')
      const parsed = parseXml46687(source)
      expect(parsed.problems, file).toEqual([])
      expect(parsed.tree, file).not.toBeNull()
      const tree = parsed.tree!
      expect(detectLegacyXml46687(tree), file).toEqual([])
      const errors = validateXml46687(tree).problems.filter(p => p.severity === 'error')
      expect(errors, `${file}: ${JSON.stringify(errors)}`).toEqual([])
      const result = mapXml46687(tree, prepare(tree.root))
      expect(result.problems.filter(p => p.severity === 'error'), `${file}: ${JSON.stringify(result.problems)}`).toEqual([])
      expect(result.ir, file).not.toBeNull()
      expect(JSON.stringify(result.ir), file).toContain(markers[file])
    })
  }
})

function mapValid(file: string) {
  const parsed = parseXml46687(readFileSync(resolve(sampleDir, 'valid', file), 'utf8'))
  expect(parsed.problems).toEqual([])
  const tree = parsed.tree!
  const result = mapXml46687(tree, prepare(tree.root))
  expect(result.problems.filter(p => p.severity === 'error'), JSON.stringify(result.problems)).toEqual([])
  expect(result.ir).not.toBeNull()
  return result.ir!
}
function collectKind<T>(value: unknown, kind: string): T[] {
  if (Array.isArray(value)) return value.flatMap(item => collectKind<T>(item, kind))
  if (value === null || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return [...(object.kind === kind ? [object as T] : []), ...Object.values(object).flatMap(item => collectKind<T>(item, kind))]
}

describe('完整样例的映射关系', () => {
  it('[M-6.2.1-04] [M-6.2.1-05] 表题和横纵方向分别属于各表', () => {
    const tables = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')
    expect(tables).toHaveLength(2)
    expect(tables.map(t => t.caption)).toEqual([[{text:'带表头、合并单元格、表注与表脚注的表'}], [{text:'横向表'}]])
    expect(tables.map(t => t.orientation)).toEqual(['portrait', 'landscape'])
  })
  it('[M-6.2.2-02] [M-6.2.4-01] 表头行、跨行跨列及单元格内容按网格保留', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.headerRowCount).toBe(2)
    expect(table.rows[0]!.cells.map(c => [c.rowspan, c.colspan, c.header])).toEqual([[2, 1, true], [1, 2, true]])
    expect(table.rows[0]!.cells[0]!.content).toMatchObject([{kind:'paragraph', content:[{text:'项目'}]}])
    expect(JSON.stringify(table.rows)).toContain('多段单元格')
  })
  it('[M-6.2.3-07] [M-6.2.3-09] 表脚注正文与两个表格引用的目标保持一致', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.footnotes?.map(f => f.content)).toEqual([[{text:'第一个表脚注。'}], [{text:'第二个表脚注。'}]])
    const rowText = JSON.stringify(table.rows)
    for (const footnote of table.footnotes!) expect(rowText).toContain(`"targetId":"${footnote.id}"`)
  })
  it('[M-6.2.5-02] [M-6.2.3-06] 表单位和注正文完整保留', () => {
    const table = collectKind<IRTable>(mapValid('04-tables.xml'), 'table')[0]!
    expect(table.unit).toBe('单位为毫米')
    expect(JSON.stringify(table.notes)).toContain('表中数值为示例。')
  })
  it('[M-7.1-01] [M-7.4-01] 行间公式保留 MathML 与编号状态', () => {
    const formulas = collectKind<IRFormula>(mapValid('05-formulas-figures.xml'), 'formula')
    expect(formulas).toHaveLength(2)
    expect(formulas.map(f => f.numbered)).toEqual([true, false])
    expect(formulas[0]!.mathml).toContain('<mml:mfrac>')
    expect(formulas[1]!.mathml).toContain('<mml:mi>a</mml:mi>')
  })
  it('[M-8.2-06] [M-8.2-09] 图题与每个图形资源归属保留', () => {
    const ir = mapValid('05-formulas-figures.xml')
    const figures = collectKind<IRFigure>(ir, 'figure')
    expect(figures.map(f => f.caption)).toEqual([[{text:'系统结构示意'}], [{text:'含说明段落和多个图形的图'}], [{text:'分图一'}], [{text:'分图二'}]])
    expect(figures.map(f => f.resourceId)).toEqual(['resource:fig_1','resource:fig_2','resource:fig_3','resource:fig_4'])
    expect(figures[1]!.additionalGraphics?.[0]).toMatchObject({src: png, resourceId:'resource:fig_2_b', specificUse:'size:M'})
    const set = collectKind<IRFigureSet>(ir, 'figureSet')[0]!
    expect(set.figures.map(f => f.resourceId)).toEqual(['resource:fig_3','resource:fig_4'])
    expect(set.legend?.items[0]?.definition).toEqual([{text:'组合图的共用说明。'}])
  })
  it('[M-8.2-12] 图形后的说明段属于该图', () => {
    const figures = collectKind<IRFigure>(mapValid('05-formulas-figures.xml'), 'figure')
    expect(figures[1]!.descriptions?.[0]?.content).toEqual([{text:'图形与图题之间的说明段落。'}])
  })
  it('[M-5.8-01] 数组保留列组及单元格顺序', () => {
    const array = collectKind<IRArray>(mapValid('09-import-pending.xml'), 'array')[0]!
    expect(array.columnGroups).toEqual([{start:0, count:2}])
    expect(array.rows[0]!.cells.map(c => JSON.stringify(c.content))).toEqual([expect.stringContaining('甲'),expect.stringContaining('按列对齐的文本')])
  })
  it('[M-C.1-05] 公式组保留两个成员及各自编号状态', () => {
    const group = collectKind<IRFormulaGroup>(mapValid('09-import-pending.xml'), 'formulaGroup')[0]!
    expect(group.numbered).toBe(true)
    expect(group.formulas.map(f => f.numbered)).toEqual([false,false])
    expect(group.formulas[0]!.mathml).toContain('<mml:mi>a</mml:mi>')
    expect(group.formulas[1]!.mathml).toContain('<mml:mi>b</mml:mi>')
  })
})

// 明确的格式/语义错误期待；两个仅改变合法 ID 字面的样例另测，待用户裁定。
const expectedInvalid: Record<string, string> = {
  'admn-sts-value.xml': 'xml-content-model',
  'alternatives.xml': 'xml-content-model',
  'app-without-annex-type.xml': 'xml-annex-type-required',
  'bad-app-content-type.xml': 'xml-content-model',
  'bad-date-format.xml': 'xml-date-invalid',
  'bad-list-type.xml': 'xml-content-model',
  'bad-part-of-speech.xml': 'xml-content-model',
  'bad-processing-meta.xml': 'xml-content-model',
  'bad-ref-list-content-type.xml': 'xml-content-model',
  'bibl-ref-list-in-app.xml': 'xml-content-model',
  'block-level-fn.xml': 'xml-content-model',
  'caption-two-titles.xml': 'xml-content-model',
  'chapter-sec-type-intro.xml': 'xml-content-model',
  'custom-xref-no-type.xml': 'xml-xref-custom-type-required',
  'custom-xref-to-section.xml': 'xml-reference-kind',
  'custom-xref-wrong-target.xml': 'xml-reference-kind',
  'dangling-entailed-term.xml': 'xml-reference-dangling',
  'dangling-rid.xml': 'xml-reference-dangling',
  'definition-target.xml': 'xml-unsupported',
  'doctype-internal-subset.xml': 'xml-forbidden-doctype',
  'dup-id.xml': 'xml-id-duplicate',
  'dup-release-date.xml': 'xml-date-invalid',
  'empty-table-wrap-foot.xml': 'xml-content-model',
  'encoding-declared-after-400-bytes.xml': 'xml-encoding',
  'ext-id.xml': 'xml-paragraph-id-forbidden',
  'ext-link-newline-in-url.xml': 'xml-unsupported',
  'ext-link-tab-in-scheme.xml': 'xml-unsupported',
  'ext-link-without-type.xml': 'xml-ext-link-type-invalid',
  'fig-footnote-in-caption.xml': 'xml-unsupported',
  'fig-footnote.xml': 'xml-unsupported',
  'fn-xref-to-table-footnote.xml': 'xml-reference-kind',
  'front-scope-sec.xml': 'xml-content-model',
  'gbt37967-root.xml': 'legacy-format',
  'impl-date-in-release-date.xml': 'xml-date-invalid',
  'invalid-calendar-date.xml': 'xml-date-invalid',
  'issue-agencies.xml': 'xml-content-model',
  'js-ext-link.xml': 'xml-unsupported',
  'mathml-display-inline-in-disp-formula.xml': 'xml-math-display-invalid',
  'mathml-href-control-char.xml': 'xml-unsupported',
  'mathml-id-missing.xml': 'xml-math-id-required',
  'mathml-onclick.xml': 'xml-unsupported',
  'mathml-unprefixed.xml': 'xml-content-model',
  'missing-app-id.xml': 'xml-app-id-required',
  'missing-ref-id.xml': 'xml-bibl-ref-id-required',
  'missing-term-entry-id.xml': 'xml-term-id-required',
  'mixed-cell-content.xml': 'xml-content-model',
  'named-content-without-type.xml': 'xml-content-model',
  'nested-table.xml': 'xml-content-model',
  'nested-term-entry.xml': 'xml-content-model',
  'non-utf8-encoding.xml': 'xml-encoding',
  'not-wellformed.xml': 'xml-syntax',
  'numbered-paragraph-with-title.xml': 'xml-content-model',
  'p-number-id.xml': 'xml-paragraph-id-forbidden',
  'p-with-id.xml': 'xml-paragraph-id-forbidden',
  'sec-block-after-subsec.xml': 'xml-content-model',
  'sec-without-label.xml': 'xml-section-label-required',
  'sep-legacy-namespace.xml': 'legacy-format',
  'std-in-tbx-source.xml': 'xml-unsupported',
  'std-meta-wrong-order.xml': 'xml-meta-order-invalid',
  'table-fn-xref-to-body-fn.xml': 'xml-reference-kind',
  'table-wrap-without-label.xml': 'xml-table-label-required',
  'tbx-definition-alias.xml': 'xml-content-model',
  'tbx-grammatical-number-alias.xml': 'xml-content-model',
  'tbx-langset-no-lang.xml': 'xml-content-model',
  'tbx-normative-authorization-alias.xml': 'xml-content-model',
  'tbx-term-entry-alias.xml': 'xml-content-model',
  'term-entry-without-definition.xml': 'xml-term-definition-count',
  'term-sec-outside-terms.xml': 'xml-content-model',
  'term-two-definitions.xml': 'xml-term-definition-count',
  'tex-math.xml': 'xml-content-model',
  'tfoot.xml': 'xml-content-model',
  'title-wrap-no-lang.xml': 'xml-content-model',
  'unknown-element.xml': 'xml-content-model',
  'unordered-list-label.xml': 'xml-content-model',
  'wrong-root.xml': 'xml-content-model',
  'wrong-xref-type.xml': 'xml-reference-kind',
}

describe('WP8.3 负例的具体诊断与位置', () => {
  const pendingOpaque = ['formula-id.xml', 'uuid-id.xml']
  const files = readdirSync(resolve(sampleDir, 'invalid')).filter(n => n.endsWith('.xml')).sort()
  it('清单包含每个样例与待裁决的不透明 ID 样例', () => {
    expect(files).toEqual([...Object.keys(expectedInvalid), ...pendingOpaque].sort())
  })
  for (const [file, code] of Object.entries(expectedInvalid)) {
    it(`拒绝 ${file} 并给出 ${code} 和 XML 位置`, () => {
      const parsed = parseXml46687(readFileSync(resolve(sampleDir, 'invalid', file), 'utf8'))
      const problems = parsed.tree
        ? [...detectLegacyXml46687(parsed.tree), ...validateXml46687(parsed.tree).problems]
        : parsed.problems
      const expected = problems.find(p => p.code === code && p.severity === 'error')
      expect(expected, `${file}: ${JSON.stringify(problems)}`).toBeDefined()
      expect(expected?.message).toMatch(/[\u4e00-\u9fff]/)
      expect(expected?.xml).toEqual(expect.objectContaining({ line: expect.any(Number), column: expect.any(Number), path: expect.any(String) }))
      expect(expected!.xml!.line).toBeGreaterThan(0)
      expect(expected!.xml!.column).toBeGreaterThan(0)
      if (parsed.tree) expect(mapXml46687(parsed.tree, prepare(parsed.tree.root)).ir).toBeNull()
    })
  }
  for (const file of pendingOpaque) it(`合法不透明 ID 当前可接受，等待裁定：${file}`, () => {
    const parsed = parseXml46687(readFileSync(resolve(sampleDir, 'invalid', file), 'utf8'))
    expect(parsed.problems).toEqual([])
    const tree = parsed.tree!
    expect(detectLegacyXml46687(tree)).toEqual([])
    expect(validateXml46687(tree).problems.filter(p => p.severity === 'error')).toEqual([])
    const result = mapXml46687(tree, prepare(tree.root))
    expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
    expect(result.ir).not.toBeNull()
  })
})

interface PythonSampleResult { file: string; valid: boolean; engines_consistent: boolean; errors: Array<{ rule: string }> }
let external: Map<string, PythonSampleResult> | undefined
function externalResults(): Map<string, PythonSampleResult> {
  if (external) return external
  const paths = ['valid', 'invalid'].flatMap(group =>
    readdirSync(resolve(sampleDir, group)).filter(n => n.endsWith('.xml')).map(n => resolve(sampleDir, group, n)))
  const script = resolve(process.cwd(), '../../scripts/xml46687/validate.py')
  const result = spawnSync('python3', ['-I', script, '--profile', 'import', '--json', ...paths], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(1) // 负例存在时整批命令必须为 1
  const parsed = JSON.parse(result.stdout) as { results: PythonSampleResult[] }
  expect(parsed.results).toHaveLength(paths.length)
  external = new Map(parsed.results.map(r => [resolve(r.file), r]))
  return external
}

describe.skipIf(shouldSkipValidation())('WP8.3 与 Python import 裁判的格式判定一致', () => {
  for (const group of ['valid', 'invalid']) {
    for (const file of readdirSync(resolve(sampleDir, group)).filter(n => n.endsWith('.xml')).sort()) {
      it(`${group}/${file} 的解析与语义结论一致`, () => {
        const path = resolve(sampleDir, group, file)
        const xml = parseXml46687(readFileSync(path, 'utf8'))
        const problems = xml.tree ? [...detectLegacyXml46687(xml.tree), ...validateXml46687(xml.tree).problems] : xml.problems
        const actual = !problems.some(p => p.severity === 'error')
        const oracle = externalResults().get(path)!
        expect(oracle.engines_consistent, file).toBe(true)
        expect(actual, `${file}: Python ${JSON.stringify(oracle.errors)}; TS ${JSON.stringify(problems)}`).toBe(oracle.valid)
      }, 30000)
    }
  }
})
