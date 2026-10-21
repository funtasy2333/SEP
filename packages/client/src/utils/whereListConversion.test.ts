import katex from 'katex'
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { pmToIr, type IRFormula, type IRInline, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { convertLegacyWhereDescription, termToLatex } from './whereListConversion'

const schema = getSchema(createEditorExtensions())
type Json = PMJsonNode
const t = (text: string, ...marks: string[]): Json => ({ type: 'text', text, ...(marks.length ? { marks: marks.map(type => ({ type })) } : {}) })

function legacyFormula(description: Json[], extra: Json[] = []): Json {
  return {
    type: 'formula', attrs: { nodeId: 'f1', numbered: true },
    content: [
      { type: 'formulaContent', content: [t('q_{V}=Av')] },
      { type: 'formulaDescription', content: description },
      ...extra,
    ],
  }
}

describe('旧式中符号转 LaTeX', () => {
  const run = (text: string, ...marks: Array<'italic' | 'sub' | 'sup' | 'bold'>): IRInline => ({ text, ...(marks.length ? { marks: marks.map(type => ({ type })) } : {}) })

  it.each<[string, IRInline[], string]>([
    ['单个字母', [run('A')], 'A'],
    ['斜体字母', [run('q', 'italic')], 'q'],
    ['未标斜体的下标视为正体', [run('q'), run('V', 'sub')], String.raw`q_{\mathrm{V}}`],
    ['斜体下标保持斜体', [run('q', 'italic'), run('V', 'italic', 'sub')], 'q_{V}'],
    ['希腊字母与说明性下标', [run('ρ'), run('w', 'sub')], String.raw`\rho_{\mathrm{w}}`],
    ['多字母下标', [run('Δp'), run('max', 'sub')], String.raw`\Delta p_{\mathrm{max}}`],
    ['下标含数字与标点', [run('σ'), run('c,0.2', 'sub')], String.raw`\sigma_{\mathrm{c},0.2}`],
    ['上标', [run('x'), run('2', 'sup')], 'x^{2}'],
    ['上下标', [run('x'), run('i', 'italic', 'sub'), run('2', 'sup')], 'x_{i}^{2}'],
    ['撇号', [run('t′')], "t'"],
    ['希腊字母与后一片段的字母之间保留命令边界', [run('Δ', 'italic'), run('p')], String.raw`\Delta p`],
    ['脚标跨片段时同样保留命令边界', [run('ρ'), run('α', 'italic', 'sub'), run('x', 'italic', 'sub')], String.raw`\rho_{\alpha x}`],
  ])('%s', (_name, term, latex) => {
    expect(termToLatex(term)).toBe(latex)
    // 转换结果直接写入文档，必须能被导出端的 KaTeX 解析。
    expect(() => katex.renderToString(latex, { throwOnError: true })).not.toThrow()
  })

  it.each<[string, IRInline[]]>([
    ['空符号', []],
    ['加粗', [run('A', 'bold')]],
    ['脚注', [{ text: 'A', footnote: { id: 'fn', content: [{ text: '注' }] } }]],
    ['已是公式', [{ text: '', formula: { id: 'x', latex: 'x' } }]],
    ['中文', [run('长度')]],
    ['LaTeX 特殊字符', [run('a&b')]],
    ['同一片段同时为上标和下标', [run('x'), run('j', 'sub', 'sup')]],
  ])('不能可靠转换：%s', (_name, term) => {
    expect(termToLatex(term)).toBeNull()
  })
})

describe('自由文本式中 → 结构化式中', () => {
  it('拆成条目，可转换的符号变为行内公式，其余保留文字并标出', () => {
    const formula = legacyFormula([
      t('式中：'), t('q'), t('V', 'subscript'), t('——体积流量；A——面积，单位为 m'), t('2', 'superscript'), t('；长度——管长。'),
    ], [{ type: 'formulaNote', content: [t('注')] }])
    const { formula: converted, rows } = convertLegacyWhereDescription(formula)

    expect(rows.map(row => [row.termText, row.latex])).toEqual([
      ['qV', String.raw`q_{\mathrm{V}}`],
      ['A', 'A'],
      ['长度', null],
    ])
    expect(rows[2]!.reason).toBeTruthy()
    expect((converted.content ?? []).map(child => child.type)).toEqual(['formulaContent', 'formulaNote', 'whereList'])

    const node = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', content: [{ type: 'chapterTitle', content: [t('计算')] }, converted] }] })
    node.check()
    const ir = pmToIr(node.toJSON() as Json).doc.body[0]!.children[0] as IRFormula
    expect(ir.whereList.map(item => item.term)).toEqual([
      [{ text: '', formula: { id: expect.any(String), latex: String.raw`q_{\mathrm{V}}` } }],
      [{ text: '', formula: { id: expect.any(String), latex: 'A' } }],
      [{ text: '长度' }],
    ])
    // 释义原样保留，含上标标记。
    expect(ir.whereList[1]!.definition).toEqual([{ text: '面积，单位为 m' }, { text: '2', marks: [{ type: 'sup' }] }])
  })

  it('新条目与行内公式不带旧 ID，交给 ensureNodeId 分配；公式本身的属性不变', () => {
    const { formula } = convertLegacyWhereDescription(legacyFormula([t('A——面积。')]))
    expect(formula.attrs).toEqual({ nodeId: 'f1', numbered: true })
    const list = formula.content!.find(child => child.type === 'whereList')!
    const item = list.content![0]!
    expect(item.attrs?.nodeId ?? null).toBeNull()
    expect(item.content![0]!.content![0]!.attrs?.nodeId ?? null).toBeNull()
  })

  it('没有自由文本式中时原样返回空结果', () => {
    const formula: Json = { type: 'formula', content: [{ type: 'formulaContent', content: [t('x')] }] }
    expect(convertLegacyWhereDescription(formula)).toEqual({ formula, rows: [] })
  })
})
