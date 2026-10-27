import { describe, expect, it } from 'vitest'
import type { IRBlock, IRDefItem, IRDoc, IRFormula, IRInline } from '../../ir/types'
import { exportXml46687, renderXml46687, type RenderXml46687Options } from '../xml46687'
import {
  EMPTY_OPTIONS, appendix, chapter, codesOf, deepFreeze, find, labelsOf, makeDoc, para, renderRuns, run,
} from './xml46687Kit'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'
import { stubMathMl } from './xml46687StubKit'

/**
 * 公式（WP8.2 设计 §2.8）：disp-formula（label、id、mml:math、公式注、“式中”）、inline-formula、MathML 的来源与根属性重写。
 * 整条管线渲染，断言 `<disp-formula>` 内的片段（相邻元素间的缩进空白去掉）与问题；MathML 解析器本身的正反例在 xml46687.mathml.test.ts。
 */

const MML = 'http://www.w3.org/1998/Math/MathML'
const formula = (id: string, extra: Partial<IRFormula> = {}): IRFormula => ({ kind: 'formula', id, latex: 'x', numbered: true, whereList: [], ...extra })
const item = (id: string, term: string | IRInline[], definition: string | IRInline[]): IRDefItem => ({
  id, term: typeof term === 'string' ? [{ text: term }] : term, definition: typeof definition === 'string' ? [{ text: definition }] : definition,
})
const options = (mathml: Record<string, string>): RenderXml46687Options => ({ mathml, resources: { version: 1, entries: [] } })

const docWith = (blocks: IRBlock[], rest: Partial<IRDoc> = {}): IRDoc => makeDoc([chapter('ch1', '范围', blocks, 'scope')], rest)
const norm = (xml: string): string => xml.replace(/>\s+</g, '><')

function exportOk(doc: IRDoc, opts: RenderXml46687Options) {
  const result = exportXml46687(doc, labelsOf(doc), opts)
  const errors = result.problems.filter((problem) => problem.severity === 'error')
  if (result.xml === null || errors.length > 0) {
    throw new Error(`期望导出成功，但有 error：\n${errors.map((problem) => `${problem.code} ${problem.path}: ${problem.message}`).join('\n')}`)
  }
  return { xml: norm(result.xml), problems: result.problems }
}
/** 渲染并取出第 n 个 `<disp-formula …>…</disp-formula>`。 */
function dispXml(blocks: IRBlock[], opts: RenderXml46687Options, index = 0) {
  const { xml, problems } = exportOk(docWith(blocks), opts)
  return { xml: [...xml.matchAll(/<disp-formula[ >][\s\S]*?<\/disp-formula>/g)].map((match) => match[0])[index]!, problems, whole: xml }
}

describe('disp-formula 的结构（设计 §2.8）', () => {
  it('[M-7.1-01] [M-7.1-03] [M-7.4-01] disp-formula ＞ label、mml:math（恰好一个）；label 取 Resolver 的半角 (1)，id 为 formula_<n>；mml:math 带 id=mml_m1 与 display="block"', () => {
    const { xml } = dispXml([formula('f1')], options({ f1: stubMathMl('E') }))
    expect(xml).toBe('<disp-formula id="formula_1"><label>(1)</label><mml:math id="mml_m1" display="block"><mml:mi>E</mml:mi></mml:math></disp-formula>')
  })

  it('[M-7.1-02] [M-7.1-03] id 与 label 来自 Resolver：正文 formula_1、formula_2，附录 formula_A.1 / (A.1)；各 id 全文唯一', () => {
    const doc = makeDoc(
      [chapter('ch1', '范围', [formula('f1'), formula('f2')], 'scope')],
      { appendices: [appendix('app-a', false, '附录', [formula('f3')])] },
    )
    const { xml } = exportOk(doc, options({ f1: stubMathMl(), f2: stubMathMl(), f3: stubMathMl() }))
    expect([...xml.matchAll(/<disp-formula id="([^"]*)"/g)].map((match) => match[1])).toEqual(['formula_1', 'formula_2', 'formula_A.1'])
    expect([...xml.matchAll(/<label>(\([^<]*\))<\/label>/g)].map((match) => match[1])).toEqual(['(1)', '(2)', '(A.1)'])
    expect(xml).not.toMatch(/<label>（/)
  })

  it('[M-7.1-03] 无编号公式既不写 label 也不写 id（X-21）；其余内容不变', () => {
    const { xml } = dispXml([formula('f1', { numbered: false })], options({ f1: stubMathMl() }))
    expect(xml).toBe('<disp-formula><mml:math id="mml_m1" display="block"><mml:mi>x</mml:mi></mml:math></disp-formula>')
  })

  it('[M-7.1-01] 一个 IR 公式块对应一个 disp-formula、一个 mml:math（多个单独排列的公式宜写在一个 mml:math 中，由 MathML 自身承担）', () => {
    const { whole } = dispXml([formula('f1'), formula('f2')], options({ f1: stubMathMl('a'), f2: stubMathMl('b') }))
    expect(whole.match(/<disp-formula /g)).toHaveLength(2)
    expect(whole.match(/<mml:math /g)).toHaveLength(2)
  })

  it('xml-label-missing（error）：有编号的公式在 labels 里没有标签或编号文本为空', () => {
    const doc = docWith([formula('f1')])
    const missing = labelsOf(doc)
    delete missing.f1
    const noLabel = exportXml46687(doc, missing, options({ f1: stubMathMl() }))
    expect(noLabel.xml).toBeNull()
    expect(find(noLabel.problems, 'xml-label-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'f1', path: 'doc.body[0].children[0]' })
    const blank = labelsOf(doc)
    blank.f1 = { ...blank.f1!, label: '' }
    expect(find(exportXml46687(doc, blank, options({ f1: stubMathMl() })).problems, 'xml-label-missing')).toHaveLength(1)
  })
})

describe('MathML 的来源与根属性（设计 §4.5）', () => {
  it('[M-7.4-01] IR 的 mathml 优先，options.mathml 只补缺；不用 latex 重算（latex 与 MathML 不一致时以 MathML 为准）', () => {
    const { xml } = dispXml([formula('f1', { latex: 'y', mathml: stubMathMl('A') }), formula('f2', { latex: 'z' })], options({ f1: stubMathMl('B'), f2: stubMathMl('C') }), 0)
    expect(xml).toContain('<mml:mi>A</mml:mi>')
    expect(xml).not.toContain('<mml:mi>B</mml:mi>')
    const second = dispXml([formula('f1', { mathml: stubMathMl('A') }), formula('f2', { latex: 'z' })], options({ f2: stubMathMl('C') }), 1)
    expect(second.xml).toContain('<mml:mi>C</mml:mi>')
    expect(second.whole).not.toContain('>z<')
  })

  it('[M-7.4-01] 接受默认命名空间写法 <math xmlns="…MathML">，统一成 mml: 前缀；根上声明 xmlns:mml', () => {
    const native = `<math xmlns="${MML}"><mrow><mi>a</mi><mo>+</mo><mn>1</mn></mrow></math>`
    const { xml, whole } = dispXml([formula('f1', { mathml: native })], options({}))
    expect(xml).toContain('<mml:math id="mml_m1" display="block"><mml:mrow><mml:mi>a</mml:mi><mml:mo>+</mml:mo><mml:mn>1</mml:mn></mml:mrow></mml:math>')
    expect(whole).toContain(`xmlns:mml="${MML}"`)
    expect(whole).not.toMatch(/<math[ >]|<mrow/)
  })

  it('[M-7.4-02] [M-7.4-03] 根上的 id 与 display 由渲染器重写：输入里的 id="m1"（7.1 示例）与 display="inline" 被丢弃，块公式一律 block；其他根属性保留', () => {
    const odd = `<math xmlns="${MML}" id="m1" display="inline" alttext="E=mc2"><mi>E</mi></math>`
    const { xml } = dispXml([formula('f1', { mathml: odd })], options({}))
    expect(xml).toContain('<mml:math id="mml_m1" alttext="E=mc2" display="block">')
    expect(xml).not.toMatch(/ id="m1"/)
    expect(xml).not.toContain('display="inline"')
  })

  it('[M-7.4-02] mml_m<k> 按输出文档序连续编号，行间与行内合并计数；公式内嵌套的 mml:math（如 semantics 里）不另计数', () => {
    const nested = `<mml:math><mml:mrow><mml:mi>n</mml:mi></mml:mrow></mml:math>`
    const doc = docWith([
      para('p1', '行内', { text: '', formula: { id: 'i1', latex: 'a' } }),
      formula('f1', { mathml: nested, whereList: [item('w1', [{ text: '', formula: { id: 'wi', latex: 'b' } }], '符号')] }),
      para('p2', { text: '', formula: { id: 'i2', latex: 'c' } }),
    ])
    const { xml } = exportOk(doc, options({ i1: stubMathMl('a'), i2: stubMathMl('c'), wi: stubMathMl('b') }))
    expect([...xml.matchAll(/<mml:math id="([^"]*)"/g)].map((match) => match[1])).toEqual(['mml_m1', 'mml_m2', 'mml_m3', 'mml_m4'])
    // 输出序：行内 a → 块公式 n → “式中”里的行内 b → 行内 c
    expect([...xml.matchAll(/<mml:mi>([^<]*)<\/mml:mi>/g)].map((match) => match[1])).toEqual(['a', 'n', 'b', 'c'])
  })

  it('[M-7.4-04] [M-7.4-05] [M-7.4-06] [M-7.4-07] [M-7.4-08] [M-7.4-09] [M-7.4-10] [M-7.4-11] MathML 内部元素按字符串保真：mrow、mi、mn、mo、mfrac、msub、msup、mspace 及其属性原样输出', () => {
    const source = `<mml:math><mml:mrow><mml:mi>E</mml:mi><mml:mo>=</mml:mo><mml:mfrac><mml:mrow><mml:mi>m</mml:mi><mml:msup><mml:mi>v</mml:mi><mml:mn>2</mml:mn></mml:msup></mml:mrow><mml:mn>2</mml:mn></mml:mfrac>`
      + `<mml:mspace width="1em"/><mml:msub><mml:mi>E</mml:mi><mml:mn>0</mml:mn></mml:msub></mml:mrow></mml:math>`
    const { xml } = dispXml([formula('f1', { mathml: source })], options({}))
    for (const element of ['mrow', 'mi', 'mn', 'mo', 'mfrac', 'msub', 'msup', 'mspace']) expect(xml, element).toContain(`<mml:${element}`)
    expect(xml).toContain('<mml:mspace width="1em"/>')
    expect(xml).toContain('<mml:msup><mml:mi>v</mml:mi><mml:mn>2</mml:mn></mml:msup>')
    expect(xml).toContain('<mml:msub><mml:mi>E</mml:mi><mml:mn>0</mml:mn></mml:msub>')
  })

  it('不输出 TeX：KaTeX 风格的 semantics/annotation 去掉 TeX 注释并展开 semantics（info mathml-annotation-removed）；输出里没有 tex-math/alternatives/annotation', () => {
    const katex = `<math xmlns="${MML}"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^{2}</annotation></semantics></math>`
    const { xml, problems } = dispXml([formula('f1', { mathml: katex })], options({}))
    expect(xml).toContain('<mml:math id="mml_m1" display="block"><mml:mrow><mml:mi>x</mml:mi></mml:mrow></mml:math>')
    expect(xml).not.toMatch(/tex-math|alternatives|annotation|semantics|x\^/)
    const infos = find(problems, 'mathml-annotation-removed')
    expect(infos).toHaveLength(1)
    expect(infos[0]).toMatchObject({ severity: 'info', nodeId: 'f1' })
  })

  it('mathml-missing（error）：公式既没有 IR 的 mathml 也没有 options.mathml 条目（不用图片或空公式代替）；空白字符串视同没有', () => {
    for (const mathml of [undefined, '', '   ']) {
      const doc = docWith([formula('f1', mathml === undefined ? {} : { mathml })])
      const result = exportXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)
      expect(result.xml).toBeNull()
      expect(find(result.problems, 'mathml-missing')).toHaveLength(1)
      expect(find(result.problems, 'mathml-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'f1', path: 'doc.body[0].children[0]' })
    }
    const inherited = docWith([formula('constructor')])
    expect(find(exportXml46687(inherited, labelsOf(inherited), EMPTY_OPTIONS).problems, 'mathml-missing')).toHaveLength(1)
  })

  it('mathml-invalid（error）：不合约定的 MathML，消息带公式 NodeId 与字符位置；其余公式照常渲染并继续收集问题', () => {
    const doc = docWith([formula('f1', { mathml: '<math xmlns="' + MML + '"><mi>x</mn></math>' }), formula('f2')])
    const result = exportXml46687(doc, labelsOf(doc), options({}))
    expect(result.xml).toBeNull()
    const invalid = find(result.problems, 'mathml-invalid')
    expect(invalid).toHaveLength(1)
    expect(invalid[0]).toMatchObject({ severity: 'error', nodeId: 'f1', path: 'doc.body[0].children[0]' })
    expect(invalid[0]!.message).toContain('f1')
    expect(invalid[0]!.message).toMatch(/第 1 行第 \d+ 列，字符偏移 \d+/)
    expect(find(result.problems, 'mathml-missing')).toHaveLength(1)
  })

  it('mathml-invalid：命名实体、事件属性、危险协议、DOCTYPE 在管线里同样被拒绝（解析器的完整正反例见 xml46687.mathml.test.ts）', () => {
    const bad = [
      `<mml:math><mml:mo>&InvisibleTimes;</mml:mo></mml:math>`,
      `<mml:math onclick="alert(1)"><mml:mi>x</mml:mi></mml:math>`,
      `<mml:math href="javascript:alert(1)"><mml:mi>x</mml:mi></mml:math>`,
      `<!DOCTYPE math><mml:math><mml:mi>x</mml:mi></mml:math>`,
    ]
    for (const mathml of bad) {
      const doc = docWith([formula('f1', { mathml })])
      const result = exportXml46687(doc, labelsOf(doc), options({}))
      expect(result.xml, mathml).toBeNull()
      expect(codesOf(result.problems, 'error'), mathml).toEqual(['mathml-invalid'])
    }
  })
})

describe('公式注（M-7.2-01、M-7.2-02）', () => {
  it('[M-7.2-01] [M-7.2-02] 公式注是 mml:math 之后的 non-normative-note，label 取 Resolver（单条“注：”，多条“注1：”“注2：”），内容在一个 p 里', () => {
    const one = dispXml([formula('f1', { notes: [{ id: 'n1', content: [{ text: '推导见附录。' }] }] })], options({ f1: stubMathMl() })).xml
    expect(one).toBe(
      '<disp-formula id="formula_1"><label>(1)</label><mml:math id="mml_m1" display="block"><mml:mi>x</mml:mi></mml:math>'
      + '<non-normative-note><label>注：</label><p>推导见附录。</p></non-normative-note></disp-formula>',
    )
    const two = dispXml([formula('f1', { notes: [{ id: 'n1', content: [{ text: '甲' }] }, { id: 'n2', content: [{ text: '乙' }] }] })], options({ f1: stubMathMl() })).xml
    expect(two).toContain('<label>注1：</label><p>甲</p>')
    expect(two).toContain('<label>注2：</label><p>乙</p>')
  })

  it('[M-7.2-02] 公式注的 id 仅被引用时写（note_<n>）；公式注可被引用（R-10）', () => {
    const referencing = para('ref', '见', run('注', { type: 'crossRef', targetId: 'n2', targetKind: 'note' }))
    const { xml } = exportOk(docWith([referencing, formula('f1', { notes: [{ id: 'n1', content: [{ text: '甲' }] }, { id: 'n2', content: [{ text: '乙' }] }] })]), options({ f1: stubMathMl() }))
    expect(xml).toContain('<non-normative-note><label>注1：</label><p>甲</p></non-normative-note>')
    expect(xml).toMatch(/<non-normative-note id="note_\d+"><label>注2：<\/label><p>乙<\/p><\/non-normative-note>/)
    expect(xml.match(/<non-normative-note id=/g)).toHaveLength(1)
  })

  it('xml-label-missing（error）：公式注在 labels 中没有标签', () => {
    const doc = docWith([formula('f1', { notes: [{ id: 'n1', content: [{ text: '注' }] }] })])
    const labels = labelsOf(doc)
    delete labels.n1
    const result = exportXml46687(doc, labels, options({ f1: stubMathMl() }))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-label-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'n1', path: 'doc.body[0].children[0].notes[0]' })
  })
})

describe('“式中”说明 legend（M-7.3-01～07）', () => {
  const where = [item('w1', [{ text: 'E', marks: [{ type: 'italic' }] }], '能量，单位为焦耳（J）；'), item('w2', [{ text: 'm', marks: [{ type: 'italic' }] }], '质量，单位为千克（kg）。')]

  it('[M-7.3-01] [M-7.3-02] [M-7.3-03] [M-7.3-04] [M-7.3-05] [M-7.3-06] [M-7.3-07] legend ＞ title“式中：”（固定常量）、def-list[@list-content="formula"] ＞ def-item ＞ term、def/p；legend 接在公式注之后；legend/def-list/def-item/p 都不写 id', () => {
    const { xml } = dispXml([formula('f1', { whereList: where, notes: [{ id: 'n1', content: [{ text: '注文' }] }] })], options({ f1: stubMathMl('E') }))
    expect(xml).toBe(
      '<disp-formula id="formula_1"><label>(1)</label><mml:math id="mml_m1" display="block"><mml:mi>E</mml:mi></mml:math>'
      + '<non-normative-note><label>注：</label><p>注文</p></non-normative-note>'
      + '<legend><title>式中：</title><def-list list-content="formula">'
      + '<def-item><term><italic>E</italic></term><def><p>能量，单位为焦耳（J）；</p></def></def-item>'
      + '<def-item><term><italic>m</italic></term><def><p>质量，单位为千克（kg）。</p></def></def-item>'
      + '</def-list></legend></disp-formula>',
    )
    expect(xml.match(/ id="/g)).toHaveLength(2) // disp-formula 与 mml:math
  })

  it('[M-7.3-01] whereList 为空则不写 legend；每个公式至多一个 legend', () => {
    expect(dispXml([formula('f1')], options({ f1: stubMathMl() })).xml).not.toContain('legend')
    expect(dispXml([formula('f1', { whereList: where })], options({ f1: stubMathMl() })).xml.match(/<legend>/g)).toHaveLength(1)
  })

  it('[M-7.3-09] 含义里的上标等格式如实输出（10<sup>−7</sup>）；符号里可以有行内公式', () => {
    const { xml } = dispXml([formula('f1', { whereList: [
      item('w1', [{ text: 'μ', marks: [{ type: 'italic' }] }], [{ text: '= 4π × 10' }, { text: '−7', marks: [{ type: 'sup' }] }, { text: 'H/m；' }]),
      item('w2', [{ text: '', formula: { id: 'wi', latex: 'x_0' } }], '初始值。'),
    ] })], options({ f1: stubMathMl(), wi: stubMathMl('x') }))
    expect(xml).toContain('<def><p>= 4π × 10<sup>−7</sup>H/m；</p></def>')
    expect(xml).toContain('<term><inline-formula><mml:math id="mml_m2"><mml:mi>x</mml:mi></mml:math></inline-formula></term>')
  })

  it('empty-content（warning）：“式中”项没有含义时写出空的 p（def 至少需要一个 p）', () => {
    const { xml, problems } = dispXml([formula('f1', { whereList: [item('w1', 'x', [])] })], options({ f1: stubMathMl() }))
    expect(xml).toContain('<def-item><term>x</term><def><p/></def></def-item>')
    expect(find(problems, 'empty-content')).toHaveLength(1)
    expect(find(problems, 'empty-content')[0]).toMatchObject({ severity: 'warning', nodeId: 'w1' })
  })

  it('xml-xref-target-unsupported（error）：对“式中”项与无编号公式的引用（它们没有 id 方案，D-X-06）', () => {
    const doc = docWith([
      formula('f1', { whereList: [item('w1', 'x', '含义')] }), formula('f2', { numbered: false }),
      para('p1', '见', run('项', { type: 'crossRef', targetId: 'w1' }), run('式', { type: 'crossRef', targetId: 'f2', targetKind: 'formula' })),
    ])
    const result = exportXml46687(doc, labelsOf(doc), options({ f1: stubMathMl(), f2: stubMathMl() }))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-xref-target-unsupported')).toHaveLength(2)
  })
})

describe('行内公式（M-7.1-04、M-7.1-05）', () => {
  it('[M-7.1-04] [M-7.1-05] inline-formula 内恰好一个 mml:math：不带 display，id=mml_m<k>；inline-formula 自身没有 id 或属性', () => {
    const doc = docWith([para('p1', '当', { text: '', formula: { id: 'i1', latex: 'x' } }, '时')])
    const { xml } = exportOk(doc, options({ i1: stubMathMl('x') }))
    expect(xml).toContain('<p>当<inline-formula><mml:math id="mml_m1"><mml:mi>x</mml:mi></mml:math></inline-formula>时</p>')
  })

  it('[M-7.1-05] 行内公式根上输入的 display 被丢弃（行内不写 display，V-15）；IR 的 mathml 优先于 options', () => {
    const odd = `<math xmlns="${MML}" display="block"><mi>y</mi></math>`
    const doc = docWith([para('p1', { text: '', formula: { id: 'i1', latex: 'x', mathml: odd } })])
    const { xml } = exportOk(doc, options({ i1: stubMathMl('z') }))
    expect(xml).toContain('<inline-formula><mml:math id="mml_m1"><mml:mi>y</mml:mi></mml:math></inline-formula>')
    expect(xml).not.toContain('display=')
  })

  it('[M-7.1-04] 行内公式可以出现在标题、单元格等 inline 容器里；只含一个行内公式的 p 不被塞进缩进空白（逐字写出）', () => {
    const doc = docWith([para('p1', { text: '', formula: { id: 'i1', latex: 'x' } })])
    const result = exportXml46687(doc, labelsOf(doc), options({ i1: stubMathMl() }))
    expect(result.xml).toContain('<p><inline-formula><mml:math id="mml_m1"><mml:mi>x</mml:mi></mml:math></inline-formula></p>')
  })

  it('mathml-missing / mathml-invalid（error）：行内公式同样适用，path 指向 run 上的 formula', () => {
    const doc = docWith([para('p1', { text: '', formula: { id: 'i1', latex: 'x' } }), para('p2', { text: '', formula: { id: 'i2', latex: 'y', mathml: '<mml:math>' } })])
    const result = exportXml46687(doc, labelsOf(doc), options({}))
    expect(find(result.problems, 'mathml-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'i1', path: 'doc.body[0].children[0].content[0].formula' })
    expect(find(result.problems, 'mathml-invalid')[0]).toMatchObject({ severity: 'error', nodeId: 'i2', path: 'doc.body[0].children[1].content[0].formula' })
  })

  it('formula-in-text-only（error）：纯文本容器（text、subsup）里的行内公式——公式内容会丢失，不能导出；其他容器（term、label）允许', () => {
    const doc = docWith([para('p1', 'x')])
    const withFormula: IRInline[] = [{ text: '', formula: { id: 'i1', latex: 'x' } }]
    for (const container of ['text', 'subsup'] as const) {
      const { problems } = renderRuns(doc, withFormula, container, options({ i1: stubMathMl() }))
      expect(find(problems, 'formula-in-text-only'), container).toHaveLength(1)
      expect(find(problems, 'formula-in-text-only')[0], container).toMatchObject({ severity: 'error', path: 'doc.test.content[0].formula' })
    }
    for (const container of ['term', 'label', 'inline'] as const) {
      const { problems, xml } = renderRuns(doc, withFormula, container, options({ i1: stubMathMl() }))
      expect(find(problems, 'formula-in-text-only'), container).toHaveLength(0)
      expect(xml, container).toContain('<inline-formula><mml:math><mml:mi>x</mml:mi></mml:math></inline-formula>')
    }
  })

  it('xref 到公式（M-10.1.2-04）：xref[@ref-type="disp-formula"] 的 rid 是 formula_<n>，内容是 Resolver 的引用文本', () => {
    const doc = docWith([para('p1', '见', run('式', { type: 'crossRef', targetId: 'f1', targetKind: 'formula' })), formula('f1')])
    const { xml } = exportOk(doc, options({ f1: stubMathMl() }))
    expect(xml).toContain('<xref ref-type="disp-formula" rid="formula_1">公式(1)</xref>')
  })
})

describe('确定性与不修改输入', () => {
  const rich = (): IRDoc => docWith([
    para('p1', '当', { text: '', formula: { id: 'i1', latex: 'x' } }),
    formula('f1', { notes: [{ id: 'n1', content: [{ text: '注' }] }], whereList: [item('w1', 'E', '能量')] }),
  ])
  const opts = options({ i1: stubMathMl('x'), f1: stubMathMl('E') })

  it('同一输入两次导出逐字节相同；options.mathml 的键序不影响输出；深冻结的输入不被修改、不抛错（解析结果不是 options 字符串的引用）', () => {
    const doc = rich()
    const first = renderXml46687(doc, labelsOf(doc), opts)
    expect(renderXml46687(doc, labelsOf(doc), opts)).toBe(first)
    expect(renderXml46687(doc, labelsOf(doc), options({ f1: stubMathMl('E'), i1: stubMathMl('x') }))).toBe(first)
    const frozen = deepFreeze(rich())
    const frozenOptions = deepFreeze(options({ i1: stubMathMl('x'), f1: stubMathMl('E') }))
    const before = JSON.stringify([frozen, frozenOptions])
    expect(renderXml46687(frozen, labelsOf(frozen), frozenOptions)).toBe(first)
    expect(JSON.stringify([frozen, frozenOptions])).toBe(before)
  })
})

/** 域黄金样例：公式的主要写法一次出齐（有/无编号、注、“式中”、附录公式、行内公式、native MathML 与 KaTeX 风格、各 MathML 元素）。 */
function domainDoc(): { doc: IRDoc; opts: RenderXml46687Options } {
  const energy = `<mml:math><mml:mrow><mml:mi>E</mml:mi><mml:mo>=</mml:mo><mml:mfrac><mml:mrow><mml:mi>m</mml:mi><mml:msup><mml:mi>v</mml:mi><mml:mn>2</mml:mn></mml:msup></mml:mrow><mml:mn>2</mml:mn></mml:mfrac><mml:mspace width="1em"/><mml:msub><mml:mi>E</mml:mi><mml:mn>0</mml:mn></mml:msub></mml:mrow></mml:math>`
  const katex = `<math xmlns="${MML}"><semantics><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><annotation encoding="application/x-tex">a+b</annotation></semantics></math>`
  const doc = makeDoc(
    [
      chapter('ch1', '范围', [
        para('scope-p', '见', run('式(1)', { type: 'crossRef', targetId: 'fm-energy', targetKind: 'formula' }), '，注', run('注2', { type: 'crossRef', targetId: 'fm-energy-n2', targetKind: 'note' }), '。'),
      ], 'scope'),
      chapter('ch2', '公式', [
        para('inline-p', '当', { text: '', formula: { id: 'fm-inline', latex: 'x\\le 1.5' } }, '时，传递率应不超过限值；', { text: '', formula: { id: 'fm-inline2', latex: 'y', mathml: `<math xmlns="${MML}" id="m1"><mi>y</mi></math>` } }, '同理。'),
        formula('fm-energy', {
          latex: 'E=\\frac{mv^2}{2}', mathml: energy,
          notes: [{ id: 'fm-energy-n1', content: [{ text: '公式注紧跟在公式之后。' }] }, { id: 'fm-energy-n2', content: [{ text: '另一条公式注。' }] }],
          whereList: [
            item('fm-w1', [{ text: 'E', marks: [{ type: 'italic' }] }], '能量，单位为焦耳（J）；'),
            item('fm-w2', [{ text: 'm', marks: [{ type: 'italic' }] }], '质量，单位为千克（kg）；'),
            item('fm-w3', [{ text: 'μ', marks: [{ type: 'italic' }] }], [{ text: '= 4π × 10' }, { text: '−7', marks: [{ type: 'sup' }] }, { text: 'H/m。' }]),
          ],
        }),
        formula('fm-plain', { numbered: false, latex: 'a+b', mathml: katex }),
      ], 'general'),
    ],
    { appendices: [appendix('app-a', false, '附录', [formula('fm-app', { latex: 'c' })])] },
  )
  return { doc, opts: options({ 'fm-inline': stubMathMl('x'), 'fm-app': stubMathMl('c') }) }
}

describe('域黄金样例：公式', () => {
  const { doc, opts } = domainDoc()
  const labels = labelsOf(doc)

  it('XML 文件快照（toMatchFileSnapshot，便于直接喂给 validate.py）', async () => {
    await expect(renderXml46687(doc, labels, opts)).toMatchFileSnapshot('__snapshots__/xml46687.formulas.xml')
  })

  it('问题集合恰为预期（防止告警悄悄增多）：没有 error；标准类型 info、TeX 注释去除 info', () => {
    const { problems } = exportXml46687(doc, labels, opts)
    expect(codesOf(problems, 'error')).toEqual([])
    expect(problems.map((problem) => `${problem.severity} ${problem.code}`)).toEqual(['info meta-not-expressed', 'info mathml-annotation-removed'])
  })

  it('mml_m<k> 从 1 起连续（行间与行内合并计数）；输出不含 tex-math、alternatives、annotation、内部占位 id', () => {
    const xml = renderXml46687(doc, labels, opts)
    const ids = [...xml.matchAll(/<mml:math id="([^"]*)"/g)].map((match) => match[1]!)
    expect(ids).toEqual(ids.map((_id, index) => `mml_m${index + 1}`))
    expect(ids).toHaveLength(5)
    expect(xml).not.toMatch(/tex-math|alternatives|annotation|semantics|\b(?:id|rid)="ext_/)
    expect(xml).toContain('<xref ref-type="disp-formula" rid="formula_1">公式(1)</xref>')
  })
})

describe.skipIf(shouldSkipValidation())('外部校验：python3 -I scripts/xml46687/validate.py --json --profile export', () => {
  it('域黄金样例：valid:true，errors:[]，warnings:[]', () => {
    const { doc, opts } = domainDoc()
    const result = validateWithPython(renderXml46687(doc, labelsOf(doc), opts), 'export')
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('sts_compat.py（与官方 NISO STS 1.2 / MathML3 DTD 对照）：含公式的样例退出码 0，零未解释偏差', () => {
    const { doc, opts } = domainDoc()
    const result = stsCompatWithPython(renderXml46687(doc, labelsOf(doc), opts))
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('未解释偏差 0 个')
  })
})
