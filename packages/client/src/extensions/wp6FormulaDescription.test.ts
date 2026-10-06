// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import { irToPm, pmToIr, resolve, type IRFormula, type PMJsonNode } from '@ses/shared'
import { expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'

const schema = getSchema(createEditorExtensions())
const styled = (text: string): PMJsonNode => ({ type: 'text', text, marks: [
  { type: 'bold' }, { type: 'textStyle', attrs: { color: 'red', fontSize: '14pt' } },
] })
const atom: PMJsonNode = { type: 'formulaInline', attrs: {
  nodeId: 'formula-desc-inline', latex: 'y^2', mathml: '<math><msup><mi>y</mi><mn>2</mn></msup></math>', source: 'mathml',
}, marks: [{ type: 'variable', attrs: { kind: 'symbol', name: 'y' } }, { type: 'textStyle', attrs: { color: 'blue' } }] }

it.each([
  [atom],
  [styled('式中： '), atom, styled(' —— 变量定义； x —— 第二项定义 ')],
  [styled('式中： x —— 首项定义； '), atom],
].map(description => ({ description })))('preserves rich legacy formula descriptions through production schema and typed IR projection: %#', ({ description }) => {
  const root = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'chapter-desc' }, content: [
    { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
    { type: 'formula', attrs: { nodeId: 'formula-desc' }, content: [
      { type: 'formulaContent', content: [{ type: 'text', text: 'x=1' }] },
      { type: 'formulaDescription', content: description },
    ] },
  ] }] })
  root.check()
  const before = root.toJSON() as PMJsonNode
  const initial = pmToIr(before).doc
  const formula = initial.body[0]!.children[0]! as IRFormula
  const runs = formula.whereList.flatMap(item => [...item.term, ...item.definition])
  expect(runs.filter(run => run.formula)).toHaveLength(1)
  expect(runs.find(run => run.formula)).toMatchObject({
    text: '', formula: { id: 'formula-desc-inline', latex: 'y^2', mathml: atom.attrs!.mathml, source: 'mathml' },
    style: { color: 'blue' }, marks: [{ type: 'variable', kind: 'symbol', name: 'y' }],
  })
  for (const run of runs.filter(run => run.text.length > 0)) {
    expect(run.style).toEqual({ color: 'red', fontSize: '14pt' })
    expect(run.marks).toEqual([{ type: 'bold' }])
  }
  const reopened = schema.nodeFromJSON(irToPm(initial))
  reopened.check()
  const returned = pmToIr(reopened.toJSON() as PMJsonNode).doc
  expect((returned.body[0]!.children[0] as IRFormula).whereList).toEqual(formula.whereList)
  expect(resolve(returned).problems.filter(problem => problem.severity === 'error')).toEqual([])
  expect(root.toJSON()).toEqual(before)
})
