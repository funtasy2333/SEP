/**
 * T2.5 (a)：XML46687 的 LaTeX → MathML 准备层（WP8.2 设计 §5.2 (a)、§5.3）。
 * 提取自 formulaOmml.ts 的部分（解析/序列化/去 annotation）由 formulaOmml*.test.ts 与 DOCX 快照保证行为不变。
 */

import { describe, expect, it } from 'vitest'
import type { IRChapter, IRChapterChild, IRDoc, IRFormula, IRInline, IRParagraph } from '@ses/shared'
import { convertFormulasToMathMl, convertLatexToMathMl } from './formulaMathMl'

const MATHML_NS = 'xmlns="http://www.w3.org/1998/Math/MathML"'

function assertWellFormedXml(xml: string): void {
  const stack: string[] = []
  const token = /<!--[\s\S]*?-->|<\/?[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\s*\/?>|[^<]+/g
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
    if (value.startsWith('<!--')) continue
    const close = /^<\//.test(value)
    const selfClosing = /\/\s*>$/.test(value)
    const name = /^<\/?([A-Za-z_][\w:.-]*)/.exec(value)?.[1]
    if (close) expect(stack.pop()).toBe(name)
    else if (!selfClosing) stack.push(name!)
  }
  expect(cursor).toBe(xml.length)
  expect(stack).toEqual([])
}

function expectNoTex(mathml: string): void {
  expect(mathml).not.toMatch(/<annotation|<\/annotation|application\/x-tex|tex-math/i)
}

const text = (value: string): IRInline => ({ text: value })
const inlineFormula = (id: string, latex?: string, mathml?: string): IRInline => ({
  text: '',
  formula: { id, ...(latex === undefined ? {} : { latex }), ...(mathml === undefined ? {} : { mathml }) },
})
const paragraph = (id: string, content: IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content })
const formula = (id: string, latex: string, extra: Partial<IRFormula> = {}): IRFormula => ({
  kind: 'formula', id, latex, numbered: false, whereList: [], ...extra,
})

function docOf(children: IRChapterChild[], extra: Partial<IRDoc> = {}): IRDoc {
  const chapter: IRChapter = { kind: 'chapter', id: 'c1', secType: 'general', title: [text('章')], children }
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [chapter],
    appendices: [],
    bibliography: [],
    ...extra,
  }
}

describe('convertLatexToMathMl', () => {
  it('块公式：完整的 MathML 元素，默认命名空间，display="block"', () => {
    const mathml = convertLatexToMathMl(String.raw`w = \frac{m_1-m_2}{m_1}\times 100\%`)
    expect(mathml).toMatch(new RegExp(`^<math ${MATHML_NS} display="block">`))
    expect(mathml).toMatch(/<\/math>$/)
    expect(mathml).toContain('<mfrac>')
    expect(mathml).toContain('<msub>')
    assertWellFormedXml(mathml)
  })

  it('行内公式（display:false）：不写 display，布局不同于块公式', () => {
    const inline = convertLatexToMathMl(String.raw`\sum_{i=1}^{n} x_i`, { display: false })
    const block = convertLatexToMathMl(String.raw`\sum_{i=1}^{n} x_i`, { display: true })
    expect(inline).toMatch(new RegExp(`^<math ${MATHML_NS}>`))
    expect(inline).not.toContain('display=')
    expect(block).toContain('display="block"')
    assertWellFormedXml(inline)
  })

  it('输出不含 annotation 与 TeX 源码（semantics 的 TeX 注释被去掉）', () => {
    const source = String.raw`\alpha + \beta_{ij} \le \sqrt{x^2+y^2}`
    for (const display of [true, false]) {
      const mathml = convertLatexToMathMl(source, { display })
      expectNoTex(mathml)
      expect(mathml).not.toContain('\\alpha')
      expect(mathml).not.toContain('\\sqrt')
      expect(mathml).toContain('<mi>α</mi>')
    }
  })

  it('特殊字符按 XML 转义，结果保持良构', () => {
    const mathml = convertLatexToMathMl(String.raw`a < b \quad A \& B > c`)
    expect(mathml).toContain('&lt;')
    expect(mathml).toContain('&gt;')
    expect(mathml).toContain('&amp;')
    assertWellFormedXml(mathml)
  })

  it('KaTeX 解析失败抛 Error，消息保留 “at position N”', () => {
    expect(() => convertLatexToMathMl(String.raw`\undefinedmacro`)).toThrow(/Undefined control sequence.*at position 1/)
    expect(() => convertLatexToMathMl('a^^')).toThrow(/at position 2/)
  })

  it('空白源码是失败，不返回空公式', () => {
    expect(() => convertLatexToMathMl('')).toThrow('公式源代码为空')
    expect(() => convertLatexToMathMl('   \n')).toThrow('公式源代码为空')
  })
})

describe('convertFormulasToMathMl', () => {
  it('块公式与行内公式分别按 display 转换，键为公式 NodeId', () => {
    const doc = docOf([
      formula('f1', 'x^2'),
      paragraph('p1', [text('设 '), inlineFormula('i1', 'y_1'), text(' 为参数')]),
    ])
    const { mathml, problems } = convertFormulasToMathMl(doc)
    expect(problems).toEqual([])
    expect(Object.keys(mathml)).toEqual(['f1', 'i1'])
    expect(mathml.f1).toContain('display="block"')
    expect(mathml.i1).not.toContain('display=')
    for (const value of Object.values(mathml)) {
      expectNoTex(value)
      assertWellFormedXml(value)
    }
  })

  it('原生 MathML 优先：IR 自带 mathml 的公式不转换（即使 LaTeX 无法解析），也不产生问题', () => {
    const native = `<math ${MATHML_NS}><mi>x</mi></math>`
    const doc = docOf([
      formula('f-native', String.raw`\undefinedmacro`, { mathml: native }),
      formula('f-latex', 'z'),
      paragraph('p1', [inlineFormula('i-native', 'a^^', native), inlineFormula('i-latex', 'q')]),
    ])
    const { mathml, problems } = convertFormulasToMathMl(doc)
    expect(problems).toEqual([])
    expect(Object.keys(mathml)).toEqual(['f-latex', 'i-latex'])
  })

  it('只有 mathml、没有 latex 的行内公式：无需转换，没有问题', () => {
    const doc = docOf([paragraph('p1', [inlineFormula('i1', undefined, `<math ${MATHML_NS}><mi>x</mi></math>`)])])
    expect(convertFormulasToMathMl(doc)).toEqual({ mathml: {}, problems: [] })
  })

  it('mathml 为空白时不算“有值”，回落到 LaTeX 转换', () => {
    const doc = docOf([formula('f1', 'x', { mathml: '  \n' })])
    const { mathml, problems } = convertFormulasToMathMl(doc)
    expect(problems).toEqual([])
    expect(Object.keys(mathml)).toEqual(['f1'])
  })

  it('latex 为空 → error mathml-empty-source，带 nodeId 与 IR 路径，且不产出空公式', () => {
    const doc = docOf([
      paragraph('p0', [text('前文')]),
      formula('f-blank', '  '),
      paragraph('p1', [text('a'), inlineFormula('i-missing')]),
    ])
    const { mathml, problems } = convertFormulasToMathMl(doc)
    expect(mathml).toEqual({})
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatchObject({
      code: 'mathml-empty-source', severity: 'error', nodeId: 'f-blank', path: 'doc.body[0].children[1]',
    })
    expect(problems[1]).toMatchObject({
      code: 'mathml-empty-source', severity: 'error', nodeId: 'i-missing', path: 'doc.body[0].children[2].content[1]',
    })
    expect(problems[0]!.message).toContain('f-blank')
  })

  it('KaTeX 失败 → error mathml-conversion-failed，带 nodeId、IR 路径与 KaTeX 位置；其余公式照常转换', () => {
    const doc = docOf([
      formula('f-ok', 'a+b'),
      formula('f-bad', String.raw`x + \undefinedmacro`),
      paragraph('p1', [inlineFormula('i-bad', String.raw`\frac{1`), inlineFormula('i-ok', 'c')]),
    ])
    const { mathml, problems } = convertFormulasToMathMl(doc)
    expect(Object.keys(mathml)).toEqual(['f-ok', 'i-ok'])
    expect(problems.map(problem => [problem.code, problem.severity, problem.nodeId, problem.path])).toEqual([
      ['mathml-conversion-failed', 'error', 'f-bad', 'doc.body[0].children[1]'],
      ['mathml-conversion-failed', 'error', 'i-bad', 'doc.body[0].children[2].content[0]'],
    ])
    expect(problems[0]!.message).toMatch(/Undefined control sequence/)
    expect(problems[0]!.message).toMatch(/at position 5/)
    // KaTeX 用组合下划线标注出错位置，面向用户的消息里不保留。
    expect(problems[0]!.message).not.toContain('̲')
    // 消息里没有 “at position” 的 KaTeX 错误，补上 ParseError 自带的位置。
    expect(problems[1]!.message).toMatch(/位置 \d+/)
  })

  it('通用深度遍历：列项、表格、图注、注/示例、术语、条、附录与式中里的公式一个不漏，按文档序返回', () => {
    const doc = docOf([
      {
        kind: 'list', id: 'l1', listType: 'dash',
        items: [{ id: 'l1-1', content: [
          paragraph('l1-1-p', [inlineFormula('in-list', 'a')]),
          { kind: 'list', id: 'l1-1-n', listType: 'alpha', items: [{ id: 'l1-1-n-1', content: [paragraph('l1-1-n-1-p', [inlineFormula('in-nested-list', 'b')])] }] },
        ] }],
      },
      {
        kind: 'table', id: 't1', caption: [inlineFormula('in-table-caption', 'c')], orientation: 'portrait', headerRowCount: 0,
        rows: [{ id: 'r1', cells: [{ id: 'cell1', colspan: 1, rowspan: 1, header: false, content: [
          paragraph('cell1-p', [inlineFormula('in-cell', 'd')]),
        ] }] }],
        notes: [{ kind: 'note', id: 't1-n', content: [paragraph('t1-n-p', [inlineFormula('in-table-note', 'e')])] }],
      },
      {
        kind: 'figure', id: 'fig1', caption: [inlineFormula('in-figure-caption', 'f')], orientation: 'portrait', src: 'x',
        notes: [{ kind: 'note', id: 'fig1-n', content: [paragraph('fig1-n-p', [inlineFormula('in-figure-note', 'g')])] }],
        examples: [{ kind: 'example', id: 'fig1-e', content: [paragraph('fig1-e-p', [inlineFormula('in-figure-example', 'h')])] }],
      },
      {
        kind: 'note', id: 'n1', content: [
          paragraph('n1-p', [inlineFormula('in-note', 'i')]),
          formula('block-in-note', 'j'),
        ],
      },
      formula('block-main', 'k', {
        whereList: [{ id: 'w1', term: [inlineFormula('in-where-term', 'l')], definition: [text('说明')] }],
        notes: [{ id: 'fn1', content: [inlineFormula('in-formula-note', 'm')] }],
      }),
      {
        kind: 'clause', id: 'cl1', level: 1, titled: true, title: [text('条')],
        children: [{
          kind: 'clause', id: 'cl1-1', level: 2, titled: false, title: [],
          children: [formula('block-in-clause', 'n')],
        }],
      },
      {
        kind: 'termEntry', id: 'term1', term: [text('术语')],
        definition: [paragraph('term1-def', [inlineFormula('in-term-definition', 'o')])],
        notes: [{ kind: 'note', id: 'term1-n', content: [paragraph('term1-n-p', [inlineFormula('in-term-note', 'p')])] }],
        examples: [{ kind: 'example', id: 'term1-e', content: [formula('block-in-term-example', 'q')] }],
      },
    ])
    doc.front.foreword = [paragraph('fw', [inlineFormula('in-foreword', 'r')])]
    doc.front.introductionClauses = [{
      kind: 'clause', id: 'ic1', level: 1, titled: true, title: [text('引言条')],
      children: [formula('block-in-intro-clause', 's')],
    }]
    doc.appendices = [{
      kind: 'appendix', id: 'a1', normative: true, title: [text('附录')],
      children: [formula('block-in-appendix', 't')],
    }]

    const { mathml, problems } = convertFormulasToMathMl(doc)
    expect(problems).toEqual([])
    // 文档序：前言、引言条、各章（对象内按字段序）、附录。
    expect(Object.keys(mathml)).toEqual([
      'in-foreword', 'block-in-intro-clause',
      'in-list', 'in-nested-list', 'in-table-caption', 'in-cell', 'in-table-note',
      'in-figure-caption', 'in-figure-note', 'in-figure-example', 'in-note', 'block-in-note',
      'block-main', 'in-where-term', 'in-formula-note', 'block-in-clause',
      'in-term-definition', 'in-term-note', 'block-in-term-example', 'block-in-appendix',
    ])
    // 块公式 display，行内公式不写 display。
    expect(mathml['block-in-appendix']).toContain('display="block"')
    expect(mathml['block-in-intro-clause']).toContain('display="block"')
    expect(mathml['in-cell']).not.toContain('display=')
    expect(mathml['in-where-term']).not.toContain('display=')
  })

  it('问题与结果都按 IR 文档序：前言先于正文，正文先于附录', () => {
    const doc = docOf([formula('body-f', 'b')])
    doc.front.foreword = [formula('fw-f', 'a')]
    doc.appendices = [{ kind: 'appendix', id: 'a1', normative: false, title: [], children: [formula('app-f', '')] }]
    const { mathml, problems } = convertFormulasToMathMl(doc)
    expect(Object.keys(mathml)).toEqual(['fw-f', 'body-f'])
    expect(problems.map(problem => problem.nodeId)).toEqual(['app-f'])
    expect(problems[0]!.path).toBe('doc.appendices[0].children[0]')
  })

  it('不修改输入文档；全部输出不含 annotation / tex-math', () => {
    const doc = docOf([
      formula('f1', String.raw`\frac{a}{b}`),
      paragraph('p1', [inlineFormula('i1', String.raw`\beta`)]),
    ])
    const before = JSON.stringify(doc)
    const { mathml } = convertFormulasToMathMl(doc)
    expect(JSON.stringify(doc)).toBe(before)
    for (const value of Object.values(mathml)) expectNoTex(value)
  })

  it('没有公式的文档：空结果', () => {
    expect(convertFormulasToMathMl(docOf([paragraph('p1', [text('无公式')])]))).toEqual({ mathml: {}, problems: [] })
  })
})
