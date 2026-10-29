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

describe('[M-4.1-04] 根和基本容器内容模型', () => {
  const fixture = () => load('valid', '01-minimal.xml')
  it('拒绝错误根名称', () => {
    const tree = fixture(); tree.root.name.local = 'other'
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'xml-content-model', detail: expect.objectContaining({rule: 'ROOT'}) })]))
  })
  it('拒绝重复 body', () => {
    const tree = fixture(); tree.root.children.push(structuredClone(tree.root.children.find(c => c.type === 'element' && c.name.local === 'body')!))
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'xml-content-model', detail: expect.objectContaining({rule: 'ROOT'}) })]))
  })
  it('拒绝未知顶层属性', () => {
    const tree = fixture(); tree.root.attrs.push({name: {ns: null, local: 'unknown'}, value: 'x'})
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', detail: expect.objectContaining({rule: 'ROOT'})})]))
  })
  it('拒绝 body 中的未知元素', () => {
    const tree = fixture(); const body = tree.root.children.find(c => c.type === 'element' && c.name.local === 'body')!
    if (body.type !== 'element') throw new Error('body missing')
    body.children.push({type: 'element', name: {ns: null, local: 'unknown'}, attrs: [], children: []})
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code: 'xml-content-model', detail: expect.objectContaining({rule: 'BODY'})})]))
  })
})

describe('[M-6.2.3-01] 内容模型拒绝未知属性与非法组合', () => {
  function find(root: import('../tree').XmlElement, name: string): import('../tree').XmlElement {
    if (root.name.local === name) return root
    for (const c of root.children) if (c.type === 'element') { try { return find(c, name) } catch { /* search siblings */ } }
    throw new Error(`missing ${name}`)
  }
  it('拒绝段落未知属性', () => {
    const tree = load('valid', '01-minimal.xml'); find(tree.root, 'p').attrs.push({ name: { ns: null, local: 'surprise' }, value: 'x' })
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-content-model', detail: expect.objectContaining({rule:'RNG'})})]))
  })
  it('拒绝章内未知元素', () => {
    const tree = load('valid', '01-minimal.xml'); find(tree.root, 'sec').children.push({type: 'element', name: {ns: null, local:'unexpected'}, attrs:[], children:[]})
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-content-model', detail: expect.objectContaining({rule:'RNG'})})]))
  })
  it('拒绝章内 label 在 title 之后', () => {
    const tree = load('valid', '01-minimal.xml'), sec = find(tree.root, 'sec')
    const label = sec.children.findIndex(c => c.type === 'element' && c.name.local === 'label')
    const title = sec.children.findIndex(c => c.type === 'element' && c.name.local === 'title')
    ;[sec.children[label], sec.children[title]] = [sec.children[title], sec.children[label]]
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-content-model', detail: expect.objectContaining({rule:'RNG'})})]))
  })
  it('拒绝重复 mandatory 标题', () => {
    const tree = load('valid', '01-minimal.xml'), sec = find(tree.root, 'sec')
    const title = sec.children.find(c => c.type === 'element' && c.name.local === 'title')!
    sec.children.push(structuredClone(title))
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-content-model', detail: expect.objectContaining({rule:'RNG'})})]))
  })
})

describe('[M-C.1-01] 固定内容模型样例', () => {
  const schemaInvalid = [
    'admn-sts-value.xml', 'alternatives.xml', 'bad-part-of-speech.xml', 'caption-two-titles.xml',
    'empty-table-wrap-foot.xml', 'issue-agencies.xml', 'mathml-unprefixed.xml', 'mixed-cell-content.xml',
    'named-content-without-type.xml', 'nested-table.xml', 'nested-term-entry.xml',
    'sec-block-after-subsec.xml', 'tbx-definition-alias.xml', 'tbx-grammatical-number-alias.xml',
    'tbx-langset-no-lang.xml', 'tbx-normative-authorization-alias.xml', 'tbx-term-entry-alias.xml',
    'tfoot.xml', 'title-wrap-no-lang.xml', 'unknown-element.xml', 'wrong-root.xml',
  ]
  for (const name of schemaInvalid) it(`按 RNG 拒绝 ${name}`, () => {
    expect(validateXml46687(load('invalid', name)).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-content-model', detail: expect.objectContaining({rule:'RNG'})})]))
  })
})

describe('[M-6.4-02] 表格网格和列声明', () => {
  function find(el: import('../tree').XmlElement, name: string): import('../tree').XmlElement {
    if (el.name.local === name) return el
    for (const c of el.children) if (c.type === 'element') { try { return find(c, name) } catch { /* search siblings */ } }
    throw new Error(`missing ${name}`)
  }
  const elements = (el: import('../tree').XmlElement, name: string) => el.children.filter((c): c is import('../tree').XmlElement => c.type === 'element' && c.name.local === name)
  const assertGrid = (tree: import('../tree').XmlDocument) => expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-content-model', detail: expect.objectContaining({rule:'TABLE-GRID'})})]))
  it('拒绝同一表内行宽不一致', () => {
    const tree = load('valid', '04-tables.xml'), body = find(find(tree.root, 'table'), 'tbody'), row = elements(body, 'tr')[0]
    row.children.splice(row.children.findIndex(c => c.type === 'element' && c.name.local === 'td'), 1)
    assertGrid(tree)
  })
  it('拒绝 rowspan 超过表格', () => {
    const tree = load('valid', '04-tables.xml'), cell = find(find(tree.root, 'thead'), 'th')
    cell.attrs.find(a => a.name.local === 'rowspan')!.value = '99'
    assertGrid(tree)
  })
  it('拒绝列声明数量与网格不一致', () => {
    const tree = load('valid', '04-tables.xml'), table = find(tree.root, 'table')
    table.children.splice(table.children.findIndex(c => c.type === 'element' && c.name.local === 'col'), 1)
    assertGrid(tree)
  })
  it('拒绝 colspan 横跨被 rowspan 占据的格子', () => {
    const tree = load('valid', '04-tables.xml'), head = find(tree.root, 'thead'), rows = elements(head, 'tr'), first = elements(rows[0], 'th'), second = elements(rows[1], 'th')
    first[0].attrs = first[0].attrs.filter(a => a.name.local !== 'rowspan')
    first[1].attrs.push({name:{ns:null,local:'rowspan'},value:'2'})
    second[0].attrs.push({name:{ns:null,local:'colspan'},value:'2'})
    assertGrid(tree)
  })
})

describe('[M-6.4-03] 网格空洞及 URI 安全', () => {
  it('拒绝由跨行单元格形成的空洞', () => {
    const xml = '<standard><front><std-meta><title-wrap xml:lang="zh"><full>x</full></title-wrap></std-meta></front><body><sec><label>1</label><title>x</title><table-wrap><label>表1</label><table><tbody><tr><td>a</td><td>b</td><td rowspan="2">c</td></tr><tr><td>d</td></tr></tbody></table></table-wrap></sec></body></standard>'
    const tree = parseXml46687(xml).tree!
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-content-model', detail: expect.objectContaining({rule:'TABLE-GRID'})})]))
  })
  it('URI 文本两端的控制字符不能被 trim 消除', () => {
    const xml = '<standard><front><std-meta><title-wrap xml:lang="zh"><full>x</full></title-wrap></std-meta></front><body><sec><label>1</label><title>x</title><p><mixed-citation><uri>&#10;https://example.test</uri></mixed-citation></p></sec></body></standard>'
    const tree = parseXml46687(xml).tree!
    expect(validateXml46687(tree).problems).toEqual(expect.arrayContaining([expect.objectContaining({code:'xml-unsupported', detail: expect.objectContaining({rule:'V-11'})})]))
  })
})

describe('[M-4.4.2.1-04] 重复结构内容模型', () => {
  it('接受同一章的大量段落且不改变输入', () => {
    const xml = '<standard><front><std-meta><title-wrap xml:lang="zh"><full>x</full></title-wrap></std-meta></front><body><sec><label>1</label><title>x</title>' + '<p>内容</p>'.repeat(500) + '</sec></body></standard>'
    const tree = parseXml46687(xml).tree!, before = JSON.stringify(tree)
    expect(validateXml46687(tree).problems.filter(p => p.severity === 'error')).toEqual([])
    expect(JSON.stringify(tree)).toBe(before)
  })
})

describe('[M-E-04] 不透明 XML ID', () => {
  it('接受 XML NCName 允许的非拉丁名称字符', () => {
    const tree = load('valid', '01-minimal.xml')
    const body = tree.root.children.find(c => c.type === 'element' && c.name.local === 'body')!
    if (body.type !== 'element') throw new Error('body missing')
    const section = body.children.find(c => c.type === 'element' && c.name.local === 'sec')!
    if (section.type !== 'element') throw new Error('section missing')
    section.attrs.find(a => a.name.local === 'id')!.value = '\u200c合法'
    expect(validateXml46687(tree).problems.filter(p => p.severity === 'error')).toEqual([])
  })
})

describe('[M-4.1-04] 导出黄金样例的内容模型', () => {
  for (const name of ['wp82', 'fullRenderer', 'wp8m', 'wp6']) it(`接受 ${name}`, () => {
    const path = resolve(process.cwd(), `src/renderers/__tests__/__snapshots__/xml46687.${name}.xml`)
    const parsed = parseXml46687(readFileSync(path, 'utf8'))
    expect(parsed.problems).toEqual([])
    expect(validateXml46687(parsed.tree!).problems.filter(p => p.severity === 'error')).toEqual([])
  })
})

describe('[M-4.1-04] 旧格式判别的上下文', () => {
  it('识别 SEP 旧元数据英文类型', () => {
    const tree = parseXml46687('<standard><front><std-meta><std-type>national</std-type></std-meta></front><body/></standard>').tree!
    expect(detectLegacyXml46687(tree)).toEqual(expect.arrayContaining([expect.objectContaining({code:'legacy-format'})]))
  })
  it('不从合法 ID 的字面形式推断旧格式', () => {
    const tree = load('valid', '03-structure.xml')
    const visit = (el: import('../tree').XmlElement) => {
      if (el.name.local === 'app') { const id = el.attrs.find(a => a.name.local === 'id'); if (id) id.value = 'app_A' }
      for (const c of el.children) if (c.type === 'element') visit(c)
    }
    visit(tree.root)
    expect(detectLegacyXml46687(tree)).toEqual([])
  })
})

describe('[M-10.1.1-01] 引用及剩余负例定位', () => {
  const cases = [
    ['custom-xref-to-section.xml', 'xml-reference-kind', undefined],
    ['custom-xref-wrong-target.xml', 'xml-reference-kind', undefined],
    ['dangling-entailed-term.xml', 'xml-reference-dangling', undefined],
    ['fn-xref-to-table-footnote.xml', 'xml-reference-kind', undefined],
    ['table-fn-xref-to-body-fn.xml', 'xml-reference-kind', undefined],
    ['fig-footnote-in-caption.xml', 'xml-unsupported', 'M-8.6-02'],
    ['impl-date-in-release-date.xml', 'xml-date-invalid', 'V-4'],
    ['term-two-definitions.xml', 'xml-term-definition-count', 'R13'],
  ] as const
  for (const [name, code, rule] of cases) it(`定位 ${name}`, () => {
    const expected = {code, severity:'error', ...(rule ? {detail: expect.objectContaining({rule})} : {})}
    expect(validateXml46687(load('invalid', name)).problems).toEqual(expect.arrayContaining([expect.objectContaining(expected)]))
  })
  for (const [name, code] of [
    ['doctype-internal-subset.xml', 'xml-forbidden-doctype'],
    ['encoding-declared-after-400-bytes.xml', 'xml-encoding'],
    ['non-utf8-encoding.xml', 'xml-encoding'],
    ['not-wellformed.xml', 'xml-syntax'],
  ] as const) it(`解析层定位 ${name}`, () => {
    const parsed = parseXml46687(readFileSync(resolve(samples, 'invalid', name), 'utf8'))
    expect(parsed.tree).toBeNull()
    expect(parsed.problems).toEqual(expect.arrayContaining([expect.objectContaining({code, severity:'error'})]))
  })
})
