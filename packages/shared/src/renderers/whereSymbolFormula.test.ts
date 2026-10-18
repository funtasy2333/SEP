import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems } from './outputBoundary'
import { renderDocx } from './docx'
import { renderHtml } from './html'
import { latexWidthFallback } from './docx/body/formula'
import type { DocxRenderOptions } from './docx/types'
import { resolve } from '../ir/resolve'
import type { IRDoc, IRFormula, IRInline } from '../ir/types'

/** 式中符号使用行内公式（docs/where-symbol-formula.md）。 */
const symbol = (id: string, latex: string): IRInline => ({ text: '', formula: { id, latex } })

export const whereFormulaDoc = (term: IRInline[] = [symbol('sym-q', 'q_{V}')]): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' },
  front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'chapter', secType: 'general', title: [{ text: '计算' }], children: [
    { kind: 'formula', id: 'f1', latex: 'q_{V}=Av', numbered: true, whereList: [
      { id: 'w1', term, definition: [{ text: '体积流量，单位为立方米每秒（m³/s）；' }] },
    ] },
  ] }],
  appendices: [], bibliography: [],
})

const formulaOf = (doc: IRDoc): IRFormula => doc.body[0]!.children[0] as IRFormula

describe('导出边界：式中符号行内公式', () => {
  it.each(['DOCX', 'HTML'] as const)('%s 放行式中符号位置的 {id, latex} 行内公式', format => {
    expect(getOutputSupportProblems(whereFormulaDoc(), format)).toEqual([])
  })

  it.each(['DOCX', 'HTML'] as const)('%s 放行文字与公式混排的符号', format => {
    const doc = whereFormulaDoc([{ text: '2' }, symbol('sym-x', 'x_{i}')])
    expect(getOutputSupportProblems(doc, format)).toEqual([])
  })

  it('XML 出口照旧拒绝行内公式', () => {
    const problems = getOutputSupportProblems(whereFormulaDoc(), 'XML')
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'doc.body[0].children[0].whereList[0].term[0].formula' }),
    ]))
  })

  it.each(['DOCX', 'HTML'] as const)('%s 拒绝式中符号以外位置的行内公式，并说明本期范围', format => {
    const doc = whereFormulaDoc()
    formulaOf(doc).whereList[0]!.definition.push(symbol('sym-def', 'v'))
    doc.body[0]!.children.push({ kind: 'paragraph', id: 'p1', content: [symbol('sym-p', 'x')] })
    const problems = getOutputSupportProblems(doc, format)
    expect(problems.map(problem => problem.path)).toEqual([
      'doc.body[0].children[0].whereList[0].definition[1].formula',
      'doc.body[0].children[1].content[0].formula',
    ])
    expect(problems[0]!.message).toContain('本期只支持式中符号使用行内公式')
  })

  it.each([
    ['空 latex', { id: 'sym-q', latex: '  ' }, 'latex'],
    ['缺 latex 只有 MathML', { id: 'sym-q', mathml: '<math><mi>q</mi></math>' }, 'latex'],
    ['带 MathML 原文', { id: 'sym-q', latex: 'q', mathml: '<math><mi>q</mi></math>' }, 'mathml'],
    ['带外部源', { id: 'sym-q', latex: 'q', source: 'x' }, 'source'],
  ])('拒绝无法如实输出的行内公式：%s', (_name, formula, field) => {
    const doc = whereFormulaDoc([{ text: '', formula } as IRInline])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: `doc.body[0].children[0].whereList[0].term[0].formula.${field}` }),
    ]))
  })

  it('拒绝同一片段同时带公式与脚注', () => {
    const doc = whereFormulaDoc([{ ...symbol('sym-q', 'q'), footnote: { id: 'fn1', content: [{ text: '注' }] } }])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'doc.body[0].children[0].whereList[0].term[0].footnote' }),
    ]))
  })

  it('拒绝带文字格式的公式片段，避免格式被静默丢弃', () => {
    const doc = whereFormulaDoc([{ ...symbol('sym-q', 'q'), marks: [{ type: 'bold' }] }])
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([
      expect.objectContaining({ path: 'doc.body[0].children[0].whereList[0].term[0].marks' }),
    ])
  })
})

describe('DOCX：式中符号输出 OMML', () => {
  const fakeOmml = (name: string) => `<m:oMath><m:r><m:t>${name}</m:t></m:r></m:oMath>`
  const options = (extra: Partial<DocxRenderOptions> = {}): DocxRenderOptions => ({
    images: {}, formulaOmml: { f1: fakeOmml('MAIN'), 'sym-q': fakeOmml('SYMQ') }, stage: 'working_draft',
    createdAt: '2026-10-18T00:00:00.000Z', ...extra,
  })
  const whereParagraphs = (xml: string) => Array.from(xml.matchAll(/<w:p>(?:(?!<\/w:p>)[\s\S])*SesWhereItem[\s\S]*?<\/w:p>/g), match => match[0])

  it('符号位置输出行内公式的 OMML，制表位按宽度表计算', () => {
    const doc = whereFormulaDoc()
    const pkg = renderDocx(doc, resolve(doc).labels, options({ formulaWidths: { 'sym-q': 1.1 } }))
    const [item] = whereParagraphs(pkg.parts['word/document.xml']!)
    expect(item).toContain(`${fakeOmml('SYMQ')}<w:r><w:tab/></w:r>`)
    // d = 420 + ceil(1.1 × 210) + 210
    expect(item).toContain('<w:tab w:val="left" w:pos="862"/>')
    expect(pkg.warnings.filter(warning => warning.nodeId === 'sym-q')).toEqual([])
  })

  it('文字与公式混排时按原顺序输出', () => {
    const doc = whereFormulaDoc([{ text: '2' }, symbol('sym-q', 'q')])
    const [item] = whereParagraphs(renderDocx(doc, resolve(doc).labels, options({ formulaWidths: { 'sym-q': 0.75 } })).parts['word/document.xml']!)
    expect(item).toMatch(/<w:t xml:space="preserve">2<\/w:t><\/w:r><m:oMath><m:r><m:t>SYMQ/)
    // 0.5（"2"）+ 0.75 → ceil(1.25 × 210) = 263；d = 420 + 263 + 210
    expect(item).toContain('w:pos="893"')
  })

  it('缺 OMML 时回退为 LaTeX 源码并记 warning', () => {
    const doc = whereFormulaDoc([symbol('sym-x', 'x_{i}')])
    const pkg = renderDocx(doc, resolve(doc).labels, options())
    const [item] = whereParagraphs(pkg.parts['word/document.xml']!)
    expect(item).toContain('<w:t xml:space="preserve">x_{i}</w:t>')
    expect(pkg.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'formula-missing-omml', nodeId: 'sym-x' })]))
  })

  it('缺宽度时按 LaTeX 源码保守估算：命令计一个字符，格式命令与花括号、脚标符不计', () => {
    expect(latexWidthFallback(String.raw`\rho_{\mathrm{w}}`)).toBe(1)
    expect(latexWidthFallback('q_{V}')).toBe(1)
    expect(latexWidthFallback(String.raw`\text{长}`)).toBe(1)
  })
})

describe('HTML：式中符号行内公式占位', () => {
  it.each(['screen', 'print'] as const)('%s 变体在 dt 中输出 ses-formula-inline 占位，data-latex 保留原文', variant => {
    const doc = whereFormulaDoc([{ text: '2' }, symbol('sym-q', String.raw`q_{V}<"a"&`)])
    const html = renderHtml(doc, resolve(doc).labels, { variant })
    expect(html).toContain('<dt data-node-id="w1"')
    expect(html).toMatch(/<dt[^>]*>2<span class="ses-formula-inline" data-latex="q_\{V\}&lt;&quot;a&quot;&amp;"><\/span><\/dt>/)
  })
})
