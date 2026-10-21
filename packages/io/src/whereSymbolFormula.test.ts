import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { irToPm, type IRDoc, type IRInline } from '@ses/shared'
import { buildDocx } from './docx'
import { convertFormulaToOmml, convertFormulasToOmml, estimateFormulaWidth } from './formulaOmml'

const symbol = (id: string, latex: string): IRInline => ({ text: '', formula: { id, latex } })

const doc = (terms: IRInline[][]): IRDoc => ({
  schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
  body: [{ kind: 'chapter', id: 'ch', secType: 'general', title: [{ text: '计算' }], children: [
    { kind: 'formula', id: 'f1', latex: 'q_{V}=Av', numbered: true, whereList: terms.map((term, index) => ({
      id: `w${index}`, term, definition: [{ text: '定义' }],
    })) },
  ] }],
  appendices: [], bibliography: [],
})

describe('式中符号行内公式 → OMML', () => {
  it('收集式中符号的行内公式，按行内公式 id 写入 OMML 表，并给出宽度', async () => {
    const result = await convertFormulasToOmml(doc([[symbol('sym-q', 'q_{V}')], [{ text: 'A' }], [symbol('sym-rho', String.raw`\rho_{\mathrm{w}}`)]]))
    expect(result.warnings).toEqual([])
    expect(Object.keys(result.formulaOmml).sort()).toEqual(['f1', 'sym-q', 'sym-rho'])
    expect(result.formulaOmml['sym-q']).toMatch(/^<m:oMath\b[\s\S]*<m:sSub>[\s\S]*<\/m:oMath>$/)
    expect(Object.keys(result.formulaWidths).sort()).toEqual(['sym-q', 'sym-rho'])
    expect(result.formulaWidths['sym-q']).toBeCloseTo(estimateFormulaWidth('q_{V}'))
  })

  it('转换失败的符号记 warning，不写入 OMML 与宽度', async () => {
    const result = await convertFormulasToOmml(doc([[symbol('sym-bad', String.raw`\frac{`)]]))
    expect(result.formulaOmml['sym-bad']).toBeUndefined()
    expect(result.formulaWidths['sym-bad']).toBeUndefined()
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'formula-conversion-failed', nodeId: 'sym-bad' })])
  })

  it('行内模式与块级模式分别使用 KaTeX 的 inline/display 布局', async () => {
    const display = await convertFormulaToOmml(String.raw`\sum_{i=1}^{n}x_i`)
    const inline = await convertFormulaToOmml(String.raw`\sum_{i=1}^{n}x_i`, { display: false })
    expect(display).not.toBe(inline)
    expect(inline).toMatch(/^<m:oMath\b/)
  })
})

describe('式中符号宽度估算（单位：汉字宽）', () => {
  it.each([
    ['q', 0.5 + 0.25],
    ['q_{V}', 0.5 + 0.35 + 0.25],
    [String.raw`\rho_{\mathrm{w}}`, 0.5 + 0.35 + 0.25],
    [String.raw`\Delta p_{\max}`, 1 + 3 * 0.35 + 0.25],
    ['x_{i}^{2}', 0.5 + 0.35 + 0.25],
    [String.raw`\bar{x}`, 0.5 + 0.25],
    [String.raw`\sigma_{\mathrm{c},0.2}`, 0.5 + 5 * 0.35 + 0.25],
  ])('%s', (latex, expected) => {
    expect(estimateFormulaWidth(latex)).toBeCloseTo(expected, 5)
  })

  it('空白命令（mspace）按 em 计入宽度，负宽度按 0 计', () => {
    const base = estimateFormulaWidth('qV')
    expect(estimateFormulaWidth(String.raw`q\qquad V`)).toBeCloseTo(base + 2, 5)
    expect(estimateFormulaWidth(String.raw`q\hspace{1cm}V`)).toBeCloseTo(base + 2.8453, 5)
    expect(estimateFormulaWidth(String.raw`q\hspace{-1em}V`)).toBeCloseTo(base, 5)
  })

  it('幻影（\\phantom、\\hphantom）不显示但占位，按内容计入宽度', () => {
    expect(estimateFormulaWidth(String.raw`q\phantom{MMMM}V`)).toBeCloseTo(estimateFormulaWidth('qMMMMV'), 5)
    expect(estimateFormulaWidth(String.raw`q\hphantom{MM}V`)).toBeCloseTo(estimateFormulaWidth('qMMV'), 5)
  })

  it('CJK 字符按一个汉字宽计', () => {
    expect(estimateFormulaWidth(String.raw`\text{长}`)).toBeCloseTo(1 + 0.25, 5)
  })
})

describe('DOCX 出件：式中符号端到端', () => {
  it('PM 文档中的 formulaInline 符号以 OMML 写入式中段落，制表位使用估算宽度', async () => {
    const pmDoc = irToPm(doc([[symbol('sym-q', 'q_{V}')], [symbol('sym-rho', String.raw`\rho_{\mathrm{w}}`)]]))
    const { bytes, warnings } = await buildDocx({ pmDoc, createdAt: '2026-10-18T00:00:00Z' })
    expect(warnings.filter(warning => warning.nodeId?.startsWith('sym-'))).toEqual([])
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    const items = Array.from(xml.matchAll(/<w:p><w:pPr><w:pStyle w:val="SesWhereItem"\/>[\s\S]*?<\/w:p>/g), match => match[0])
    expect(items).toHaveLength(2)
    for (const item of items) expect(item).toMatch(/<\/m:oMath><w:r><w:tab\/><\/w:r>/)
    const widest = Math.max(estimateFormulaWidth('q_{V}'), estimateFormulaWidth(String.raw`\rho_{\mathrm{w}}`))
    expect(items[0]).toContain(`w:pos="${420 + Math.ceil(widest * 210) + 210}"`)
  })
})

describe('正文类位置的行内公式 → OMML（Phase 7）', () => {
  it('整篇收集：前言、段落、单元格、表脚注、条文脚注、附录、式中', async () => {
    const s = (id: string): IRInline => symbol(id, 'x_{i}')
    const p = (id: string, content: IRInline[]) => ({ kind: 'paragraph' as const, id, content })
    const full = {
      schemaVersion: 1, meta: { standardType: 'gb' },
      front: { foreword: [p('fw', [s('s-fw')])], introduction: [] },
      body: [{ kind: 'chapter', id: 'ch', secType: 'general', title: [{ text: '要求' }], children: [
        p('p1', [{ text: '当' }, s('s-p1')]),
        { kind: 'table', id: 't1', caption: [], orientation: 'portrait', headerRowCount: 0,
          rows: [{ id: 'r1', cells: [{ id: 'c1', colspan: 1, rowspan: 1, header: false, content: [p('cp', [s('s-cell')])] }] }],
          notes: [], footnotes: [{ id: 'tf1', content: [s('s-tfn')] }] },
        p('p2', [{ text: '正文', footnote: { id: 'fn1', content: [s('s-fn')] } }]),
        { kind: 'formula', id: 'f1', latex: 'y', numbered: true, whereList: [{ id: 'w', term: [s('s-term')], definition: [s('s-wdef')] }] },
      ] }],
      appendices: [{ kind: 'appendix', id: 'app', normative: false, title: [], children: [p('ap', [s('s-app')])] }],
      bibliography: [],
    } as unknown as IRDoc
    const result = await convertFormulasToOmml(full)
    expect(result.warnings).toEqual([])
    expect(Object.keys(result.formulaOmml).sort()).toEqual(['f1', 's-app', 's-cell', 's-fn', 's-fw', 's-p1', 's-term', 's-tfn', 's-wdef'])
    expect(result.formulaOmml['s-p1']).not.toContain('oMathPara')
  })
})

describe('DOCX 出件：正文类位置端到端（Phase 7）', () => {
  it('PM 文档的段落、注、表格单元格中的 formulaInline 写为 OMML', async () => {
    const t = (text: string) => ({ type: 'text', text })
    const f = (latex: string) => ({ type: 'formulaInline', attrs: { latex } })
    const pmDoc = { type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [t('要求')] },
      { type: 'stdParagraph', content: [t('当'), f('q_{V}'), t('大于 1 时')] },
      { type: 'note', content: [t('注文'), f('\\rho_{\\mathrm{w}}')] },
      { type: 'stdTable', content: [
        { type: 'tableCaption', content: [t('参数')] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [f('\\lambda')] }] }] }] },
      ] },
    ] }] }
    const { bytes, warnings } = await buildDocx({ pmDoc, createdAt: '2026-10-18T00:00:00Z' })
    expect(warnings.filter(warning => warning.code === 'formula-missing-omml' || warning.code === 'formula-conversion-failed')).toEqual([])
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')
    const paragraphs = (style: string) => Array.from(xml.matchAll(new RegExp(`<w:p><w:pPr><w:pStyle w:val="${style}"/>[\\s\\S]*?</w:p>`, 'g')), match => match[0])
    expect(paragraphs('SesPara').some(p => /当<\/w:t><\/w:r><m:oMath[\s\S]*<\/m:oMath><w:r><w:t xml:space="preserve">大于 1 时/.test(p))).toBe(true)
    expect(paragraphs('SesNote').some(p => p.includes('<m:oMath'))).toBe(true)
    expect(xml).toMatch(/<w:tc>[\s\S]*?<m:oMath[\s\S]*?<\/w:tc>/)
  })
})
