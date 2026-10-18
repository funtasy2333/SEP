import { describe, expect, it } from 'vitest'
import { normalizeAuthoringFragment, type AuthoringIssue } from '../authoring'
import type { AuthoringContext, IRFragmentNode } from '../fragmentContext'
import { irFragmentToPm } from '../irToPm'
import type { IRFormula } from '../types'
import { seqIds } from './authoringHelpers'

const CHAPTER: AuthoringContext = { parent: 'chapter' }

const formula = (term: unknown, definition: unknown = '体积流量') => [{
  kind: 'formula', latex: 'q_{V}=Av', whereList: [{ term, definition }],
}]

function normalize(input: unknown) {
  return normalizeAuthoringFragment(input, CHAPTER, { generateId: seqIds() })
}

function nodesOf(input: unknown): IRFragmentNode[] {
  const result = normalize(input)
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2))
  return result.nodes
}

function issuesOf(input: unknown): AuthoringIssue[] {
  const result = normalize(input)
  if (result.ok) throw new Error('应当失败')
  return result.issues
}

describe('写作片段：式中符号行内公式', () => {
  it('whereList 的 term 接受 {"formula": {"latex": …}}，文字可省略', () => {
    const [node] = nodesOf(formula([{ formula: { latex: ' q_{V} ' } }]))
    const term = (node as IRFormula).whereList[0]!.term
    expect(term).toEqual([{ text: '', formula: { id: expect.any(String), latex: 'q_{V}' } }])
  })

  it('可以显式指定 id，并与文字片段混排、不被合并', () => {
    const [node] = nodesOf(formula(['2', { formula: { id: 'sym-x', latex: 'x_{i}' } }, ' ']))
    expect((node as IRFormula).whereList[0]!.term).toEqual([
      { text: '2' }, { text: '', formula: { id: 'sym-x', latex: 'x_{i}' } }, { text: ' ' },
    ])
  })

  it('只有公式的符号不算空白', () => {
    expect(normalize(formula([{ formula: { latex: 'A' } }])).ok).toBe(true)
  })

  it('归一化结果再次输入是不动点，并能投影为生产文档的 formulaInline', () => {
    const nodes = nodesOf(formula([{ formula: { latex: 'q_{V}' } }]))
    expect(nodesOf(JSON.parse(JSON.stringify(nodes)))).toEqual(nodes)
    const pm = irFragmentToPm(nodes, CHAPTER)
    const where = pm[0]!.content!.find(child => child.type === 'whereList')!
    expect(where.content![0]!.content![0]!.content).toEqual([
      expect.objectContaining({ type: 'formulaInline', attrs: expect.objectContaining({ latex: 'q_{V}' }) }),
    ])
  })

  it.each([
    ['释义', formula('q', [{ formula: { latex: 'v' } }]), 'fragment[0].whereList[0].definition[0].formula'],
    ['段落', [{ kind: 'paragraph', content: [{ formula: { latex: 'x' } }] }], 'fragment[0].content[0].formula'],
  ])('其他位置（%s）拒绝行内公式，并说明本期范围', (_name, input, path) => {
    const issue = issuesOf(input).find(item => item.path === path)
    expect(issue).toEqual(expect.objectContaining({ code: 'unsupported-field' }))
    expect(issue!.reason).toContain('本期只支持式中符号')
  })

  it.each([
    ['latex 缺失', { formula: {} }, 'fragment[0].whereList[0].term[0].formula.latex', 'missing-field'],
    ['latex 为空', { formula: { latex: '  ' } }, 'fragment[0].whereList[0].term[0].formula.latex', 'empty-value'],
    ['latex 非字符串', { formula: { latex: 1 } }, 'fragment[0].whereList[0].term[0].formula.latex', 'invalid-type'],
    ['formula 不是对象', { formula: 'q' }, 'fragment[0].whereList[0].term[0].formula', 'invalid-type'],
    ['MathML 暂不支持', { formula: { latex: 'q', mathml: '<math/>' } }, 'fragment[0].whereList[0].term[0].formula.mathml', 'unsupported-field'],
    ['同时带文字', { text: 'q', formula: { latex: 'q' } }, 'fragment[0].whereList[0].term[0].text', 'invalid-value'],
    ['带标记', { formula: { latex: 'q' }, marks: [{ type: 'bold' }] }, 'fragment[0].whereList[0].term[0].marks', 'invalid-value'],
  ])('拒绝无效的公式片段：%s', (_name, run, path, code) => {
    expect(issuesOf(formula([run]))).toEqual(expect.arrayContaining([expect.objectContaining({ path, code })]))
  })
})
