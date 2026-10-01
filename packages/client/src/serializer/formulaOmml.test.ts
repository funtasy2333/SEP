import { describe, expect, it } from 'vitest'
import type { IRDoc } from '@ses/shared'
import { convertFormulaToOmml, convertFormulasToOmml } from './formulaOmml'

const FORMULAS = [
  String.raw`w = \frac{m_1-m_2}{m_1}\times 100\%`,
  String.raw`\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i`,
  String.raw`a < b \leq c \quad \text{且} \quad A \& B`,
  String.raw`s=\sqrt{\frac{\sum_{i=1}^{n}(x_i-\bar{x})^2}{n-1}}`,
  String.raw`\int_{0}^{\infty}e^{-x^2}\,\mathrm{d}x=\frac{\sqrt{\pi}}{2}`,
  String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
  String.raw`f(x)=\begin{cases}x^2,&x\geq 0\\-x,&x<0\end{cases}`,
  String.raw`\prod_{i=1}^{n}p_i`,
  String.raw`\sqrt[3]{a+b}`,
  String.raw`\sum_{i=1}^{n}i^2`,
  String.raw`\iint_D f(x,y)\,\mathrm{d}A`,
  String.raw`(\sum_{i=1}^{n}x_i)+y`,
  String.raw`(\sum_{i=1}^{n}x_i)^2-z`,
  String.raw`A\cap B\cup C\neq\varnothing`,
]

function assertWellFormedXml(xml: string): void {
  const stack: string[] = []
  const token = /<\/?[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\s*\/?>|[^<]+/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = token.exec(xml))) {
    expect(match.index).toBe(cursor)
    cursor = token.lastIndex
    const value = match[0]
    if (!value.startsWith('<')) {
      expect(value).not.toMatch(/&(?!lt;|gt;|amp;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/)
      continue
    }
    const close = /^<\//.test(value)
    const selfClosing = /\/\s*>$/.test(value)
    const name = /^<\/?([A-Za-z_][\w:.-]*)/.exec(value)?.[1]
    expect(name).toBeTruthy()
    if (close) expect(stack.pop()).toBe(name)
    else if (!selfClosing) stack.push(name!)
  }
  expect(cursor).toBe(xml.length)
  expect(stack).toEqual([])
}

function formulaDoc(latex: string[]): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [{
      kind: 'chapter',
      id: 'c1',
      secType: 'general',
      title: [{ text: '公式样例' }],
      children: latex.map((source, index) => ({
        kind: 'formula' as const,
        id: `f${index + 1}`,
        latex: source,
        numbered: true,
        whereList: [],
      })),
    }],
    appendices: [],
    bibliography: [],
  }
}

describe('公式 MathML → OMML', () => {
  it('转换方案中的 14 类公式，OMML 均为完整 XML 且 n-ary 主体非空', async () => {
    const converted = await Promise.all(FORMULAS.map(convertFormulaToOmml))
    expect(converted).toHaveLength(14)
    for (const omml of converted) {
      expect(omml).toMatch(/^<m:oMath\b/)
      expect(omml).toMatch(/<\/m:oMath>$/)
      expect(omml).not.toMatch(/<m:e\s*\/>|<m:e\s*>\s*<\/m:e>/)
      expect(omml).not.toMatch(/<m:sty\s+m:val="undefined"|<m:scrLvl\b/)
      expect(omml).not.toMatch(/<w:rPr\s*\/>|<w:rPr>/)
      assertWellFormedXml(omml)
    }
    expect(converted[2]).toContain('&lt;')
    expect(converted[2]).toContain('&amp;')
    expect(converted[5]).toContain('<m:m>')
    expect(converted[6]).toContain('<m:m>')
    expect(converted[6]).toContain('<m:mr>')
    expect(converted[6]).toContain('<m:t xml:space="preserve">{</m:t>')
    expect(converted[11]).toContain('<m:nary>')
    expect(converted[12]).toContain('<m:nary>')
    expect(converted[5].match(/<m:mr>/g)).toHaveLength(2)
    expect(converted[5].match(/<m:e>/g)).toHaveLength(4)
    for (const cell of ['a', 'b', 'c', 'd']) {
      expect(converted[5]).toContain(`<m:t xml:space="preserve">${cell}</m:t>`)
    }
  })

  it('schema 规整保留数学字形、脚本尺寸和公式主体', async () => {
    const bold = await convertFormulaToOmml(String.raw`\mathbf{A}`)
    const roman = await convertFormulaToOmml(String.raw`\mathrm{x}`)
    const sans = await convertFormulaToOmml(String.raw`\mathsf{x}`)
    const text = await convertFormulaToOmml(String.raw`\text{中文}`)
    const sizedFraction = await convertFormulaToOmml(String.raw`\frac{\scriptstyle x}{\scriptscriptstyle y}`)

    expect(bold).toContain('<m:sty m:val="b"/>')
    expect(bold).not.toContain('<m:nor/>')
    expect(bold).toContain('<m:t xml:space="preserve">A</m:t>')
    expect(roman).toContain('<m:nor/>')
    expect(roman).toContain('<m:t xml:space="preserve">x</m:t>')
    expect(sans).toContain('<m:t xml:space="preserve">x</m:t>')
    expect(text).toContain('<m:nor/>')
    expect(text).toContain('<m:t xml:space="preserve">中文</m:t>')
    expect(sizedFraction).toContain('<m:argSz m:val="-1"/>')
    expect(sizedFraction).toContain('<m:argSz m:val="-2"/>')
    expect(sizedFraction).toContain('<m:num>')
    expect(sizedFraction).toContain('<m:den>')

    for (const omml of [bold, roman, sans, text, sizedFraction]) {
      expect(omml).not.toMatch(/<m:sty\s+m:val="undefined"|<m:scrLvl\b/)
      expect(omml).not.toMatch(/<w:rPr\s*\/>|<w:rPr>/)
      assertWellFormedXml(omml)
    }
  })

  it('收集 IR 文档中的公式，单条转换失败时留下告警并继续处理', async () => {
    const { formulaOmml, warnings } = await convertFormulasToOmml(formulaDoc([
      FORMULAS[0]!,
      String.raw`\notARealControlSequence{`,
      FORMULAS[1]!,
    ]))

    expect(formulaOmml.f1).toMatch(/^<m:oMath\b/)
    expect(formulaOmml.f2).toBeUndefined()
    expect(formulaOmml.f3).toMatch(/^<m:oMath\b/)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ code: 'formula-conversion-failed', nodeId: 'f2' })
    expect(warnings[0]?.message).toContain('Undefined control sequence')
  })

  it('求和主体在转义形式的比较运算符前结束，外层右括号保留在主体外', async () => {
    const comparison = await convertFormulaToOmml(String.raw`\sum_{i=1}^{n}x_i < y`)
    const grouped = await convertFormulaToOmml(String.raw`(\sum_{i=1}^{n}x_i)+y`)

    expect(comparison.indexOf('</m:nary>')).toBeLessThan(comparison.indexOf('&lt;'))
    expect(grouped.indexOf('</m:nary>')).toBeLessThan(grouped.indexOf(')'))
  })

  it('收集前言、引言、条款和附录公式', async () => {
    const doc = formulaDoc([FORMULAS[0]!])
    const formula = {
      kind: 'formula' as const,
      id: 'extra',
      latex: FORMULAS[0]!,
      numbered: true,
      whereList: [],
    }
    doc.front.foreword.push({ ...formula, id: 'front' })
    doc.front.introduction.push({ ...formula, id: 'intro' })
    doc.appendices.push({
      kind: 'appendix',
      id: 'appA',
      normative: false,
      title: [],
      children: [{ kind: 'clause', id: 'a1', level: 1, titled: true, title: [], children: [{ ...formula, id: 'appendix-formula' }] }],
    })

    const { formulaOmml, warnings } = await convertFormulasToOmml(doc)
    expect(Object.keys(formulaOmml).sort()).toEqual(['appendix-formula', 'f1', 'front', 'intro'])
    expect(warnings).toEqual([])
  })
})
