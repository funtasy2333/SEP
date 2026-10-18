import { describe, expect, it } from 'vitest'
import { getOutputSupportProblems } from './outputBoundary'
import { renderDocx } from './docx'
import { renderHtml } from './html'
import { latexWidthFallback } from './docx/body/formula'
import { renderRun } from './docx/body/inline'
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

/** Phase 7 二期：正文类位置的行内公式（docs/phase7-inline-formula.md）。 */
const sym = (id: string): IRInline => symbol(id, 'x_{i}')
const para = (id: string, content: IRInline[]) => ({ kind: 'paragraph' as const, id, content })

export const bodyFormulaDoc = (): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' },
  front: { foreword: [para('fw', [{ text: '前言' }, sym('s-fw')])], introduction: [] },
  body: [{ kind: 'chapter', id: 'ch', secType: 'general', title: [{ text: '要求' }], children: [
    para('p1', [{ text: '当' }, sym('s-p1'), { text: '大于 1 时' }]),
    para('p-only', [sym('s-only')]),
    { kind: 'list', id: 'l1', listType: 'dash', items: [{ id: 'li1', content: [para('lp1', [sym('s-li')])] }] },
    { kind: 'note', id: 'n1', content: [para('np1', [{ text: '注文' }, sym('s-note')])] },
    { kind: 'example', id: 'e1', content: [para('ep1', [sym('s-ex')])] },
    { kind: 'table', id: 't1', caption: [{ text: '参数' }], orientation: 'portrait', headerRowCount: 0,
      rows: [{ id: 'r1', cells: [
        { id: 'c1', colspan: 1, rowspan: 1, header: false, content: [para('cp1', [sym('s-cell')])] },
        { id: 'c2', colspan: 1, rowspan: 1, header: false, content: [para('cp2', [{ text: '值', marks: [{ type: 'tableFootnoteRef', targetId: 'tf1' }] }])] },
      ] }],
      notes: [{ kind: 'note', id: 'tn1', content: [para('tnp1', [sym('s-tnote')])] }],
      footnotes: [{ id: 'tf1', content: [{ text: '表脚注' }, sym('s-tfn')] }] },
    { kind: 'clause', id: 'cl1', level: 1, titled: false, title: [], children: [para('clp1', [sym('s-clause')])] },
    { kind: 'termEntry', id: 'te1', term: [{ text: '流量' }], definition: [para('tdp1', [sym('s-def')])], notes: [], examples: [] },
    para('p-fn', [{ text: '正文', footnote: { id: 'fn1', content: [{ text: '脚注' }, sym('s-fn')] } }]),
  ] }],
  appendices: [{ kind: 'appendix', id: 'app', normative: false, title: [{ text: '示例' }], children: [para('ap1', [sym('s-app')])] }],
  bibliography: [],
} as IRDoc)

describe('导出边界：正文类位置的行内公式', () => {
  it.each(['DOCX', 'HTML'] as const)('%s 放行段落、列项、注、示例、单元格、表注、表脚注、无题条、术语定义、脚注、前言与附录', format => {
    expect(getOutputSupportProblems(bodyFormulaDoc(), format)).toEqual([])
  })

  it('XML 出口照旧拒绝', () => {
    expect(getOutputSupportProblems(bodyFormulaDoc(), 'XML').some(problem => problem.path.endsWith('.formula'))).toBe(true)
  })

  it.each(['DOCX', 'HTML'] as const)('%s 拒绝标题、图表题、术语名与英文名、术语来源、参考文献中的行内公式', format => {
    const doc = bodyFormulaDoc()
    const chapter = doc.body[0]!
    chapter.title.push(sym('s-title'))
    const children = chapter.children as unknown as Array<Record<string, unknown>>
    ;(children.find(child => child.id === 't1')!.caption as IRInline[]).push(sym('s-caption'))
    children.push({ kind: 'figure', id: 'fig', caption: [sym('s-figcap')], orientation: 'portrait', src: 'data:image/png;base64,AAAA', notes: [] })
    children.push({ kind: 'clause', id: 'cl2', level: 1, titled: true, title: [sym('s-cltitle')], children: [] })
    const term = children.find(child => child.id === 'te1')!
    Object.assign(term, { term: [sym('s-term')], termEn: [sym('s-termen')], source: [sym('s-source')] })
    doc.appendices[0]!.title.push(sym('s-apptitle'))
    doc.bibliography.push({ kind: 'bibEntry', id: 'bib', content: [sym('s-bib')] })
    const problems = getOutputSupportProblems(doc, format).filter(problem => problem.path.endsWith('.formula'))
    expect(problems.map(problem => problem.nodeId).sort()).toEqual([
      'app', 'bib', 'ch', 'cl2', 'fig', 't1', 'te1', 'te1', 'te1',
    ])
    expect(problems[0]!.message).toContain('标题、图表题、术语名、参考文献中暂不支持行内公式')
  })
})

describe('DOCX：正文类位置的行内公式', () => {
  const ids = ['s-fw', 's-p1', 's-only', 's-li', 's-note', 's-ex', 's-cell', 's-tnote', 's-tfn', 's-clause', 's-def', 's-fn', 's-app']
  const fake = (id: string) => `<m:oMath><m:r><m:t>OMML:${id}</m:t></m:r></m:oMath>`
  const render = (omml: Record<string, string>) => {
    const doc = bodyFormulaDoc()
    return renderDocx(doc, resolve(doc).labels, {
      images: {}, formulaOmml: omml, stage: 'working_draft', createdAt: '2026-10-18T00:00:00.000Z',
    })
  }

  it('各容器都输出 OMML，按文字在前的顺序；只含公式的段落与单元格不被当作空段', () => {
    const pkg = render(Object.fromEntries(ids.map(id => [id, fake(id)])))
    const xml = pkg.parts['word/document.xml']! + pkg.parts['word/footnotes.xml']!
    for (const id of ids) expect(xml, id).toContain(fake(id))
    expect(xml).toMatch(/<w:t xml:space="preserve">当<\/w:t><\/w:r><m:oMath><m:r><m:t>OMML:s-p1<\/m:t><\/m:r><\/m:oMath><w:r><w:t xml:space="preserve">大于 1 时/)
    expect(pkg.warnings.filter(warning => warning.code === 'formula-missing-omml')).toEqual([])
  })

  it('缺 OMML 时每处都回退为 LaTeX 源码并记 warning（含脚注）', () => {
    const pkg = render({})
    const missing = pkg.warnings.filter(warning => warning.code === 'formula-missing-omml').map(warning => warning.nodeId).sort()
    expect(missing).toEqual([...ids].sort())
    expect(pkg.parts['word/footnotes.xml']).toContain('<w:t xml:space="preserve">x_{i}</w:t>')
  })

  it('没有提供 OMML 来源的调用直接报错，避免公式被静默丢弃', () => {
    expect(() => renderRun(sym('s-x'), {})).toThrow(/行内公式/)
  })
})

describe('HTML：正文类位置的行内公式占位', () => {
  it.each(['screen', 'print'] as const)('%s 变体在各容器输出占位，数量与公式片段一致', variant => {
    const doc = bodyFormulaDoc()
    const html = renderHtml(doc, resolve(doc).labels, { variant })
    expect(html.match(/<span class="ses-formula-inline" data-latex="x_\{i\}"><\/span>/g)).toHaveLength(13)
    expect(html).toMatch(/当<span class="ses-formula-inline" data-latex="x_\{i\}"><\/span>大于 1 时/)
  })
})
