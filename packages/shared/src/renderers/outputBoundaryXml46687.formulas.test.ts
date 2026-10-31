import { describe, expect, it } from 'vitest'
import type { IRDoc } from '../ir/types'
import { getOutputSupportProblems } from './outputBoundary'
import { XML46687_FORMULAS_BOUNDARY } from './xml46687Parts/formulas'
import { XML46687_DECLARED_DIFFERENCES, findDeclaredDifference, type Xml46687DeclaredDifference } from './xml46687Boundary'
import { expectDeclaredDifferences, expectReleased } from './__tests__/xml46687BoundaryKit'
import { baseDoc, expectOnlyUnknownField, pushBlock, pushRun, titleOf, xml46687Paths, xmlPaths } from './__tests__/xml46687BoundaryDomainKit'

/**
 * XML46687 输出边界：T2.4b 的“公式”域放行项（WP8.2 设计 §1.3.2～§1.3.4）。
 *
 * - 逐项正例：块公式的 `mathml`、`notes` 各有最小文档，旧 XML 阻断、XML46687 放行；
 * - 行内公式的 `mathml`、`source`：旧 XML 对 `formula` 整体阻断且不再下探，所以观察不到单独的差异，只验证放行后零问题、未登记字段仍被报；
 * - shape 登记：`formulaNote`（无 kind）放行后零问题，未登记字段被精确报出；
 * - 仍阻断：`formula.sourceInlines` 含格式/脚注/公式或与 latex 不等价（与旧 XML 相同）、行内公式带 marks 或脚注。
 */

const OWN = XML46687_FORMULAS_BOUNDARY.declared
const MML = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>'
const formulaOf = (extra: Record<string, unknown> = {}) => ({ kind: 'formula', id: 'f1', latex: 'x', numbered: true, whereList: [], ...extra })
const withFormula = (extra: Record<string, unknown> = {}): IRDoc => pushBlock(baseDoc(), formulaOf(extra))

const INSTALLERS: Record<string, () => IRDoc> = {
  'formulaGroup@.kind': () => pushBlock(baseDoc(), {kind:'formulaGroup',id:'fg',numbered:true,formulas:[formulaOf({id:'f2',numbered:false})]}),
  'mathml@.mathml': () => withFormula({ mathml: MML }),
  'notes@.notes': () => withFormula({ notes: [{ id: 'fn1', content: [{ text: '公式注' }] }] }),
}
const keyOf = (entry: Xml46687DeclaredDifference): string => `${entry.name}@${entry.pathSuffix}`

function richDoc(): IRDoc {
  const doc = pushBlock(baseDoc(), formulaOf({
    mathml: MML, notes: [{ id: 'fn1', content: [{ text: '公式注', marks: [{ type: 'bold' }] }] }, { id: 'fn2', content: [{ text: '另一条' }] }],
    whereList: [{ id: 'w1', term: [{ text: 'x' }], definition: [{ text: '变量' }] }],
  }))
  pushBlock(doc, {kind:'formulaGroup',id:'fg',numbered:true,formulas:[formulaOf({id:'f2',numbered:false})]})
  pushRun(doc, { text: '', formula: { id: 'i1', mathml: MML, source: '\\frac{1}{2}' } })
  return doc
}

describe('[M-7.4-01] 公式域放行项：逐项正例（旧 XML 阻断、XML46687 放行）', () => {
  it('本文件为每个本域声明项准备了安装器，也没有多余的安装器；本域声明项都登记在全局声明集合里，task 为 T2.4b', () => {
    expect(OWN.map(keyOf).sort()).toEqual(Object.keys(INSTALLERS).sort())
    for (const entry of OWN) {
      expect(entry.task).toBe('T2.4b')
      expect(XML46687_DECLARED_DIFFERENCES).toContain(entry)
    }
  })

  it.each(OWN.map((entry) => [titleOf(entry), entry] as const))('逐项正例 %s', (_title, entry) => {
    const doc = INSTALLERS[keyOf(entry)]!()
    expectReleased(doc, entry)
    expectDeclaredDifferences(doc, [entry])
  })

  it('[M-7.4-02] [M-7.4-03] [M-7.2-01] [M-7.2-02] 声明项引用的矩阵行：mathml 的 id / display 约定、公式注', () => {
    const ids = new Set(OWN.flatMap((entry) => entry.matrixIds))
    for (const id of ['M-7.4-01', 'M-7.4-02', 'M-7.4-03', 'M-7.2-01', 'M-7.2-02']) expect(ids, id).toContain(id)
  })

  it('富文档：块公式的 mathml、notes 与行内公式的 mathml、source 一起出现，差集恰等于声明集合，XML46687 零问题', () => {
    const doc = richDoc()
    const before = JSON.stringify(doc)
    expectDeclaredDifferences(doc, OWN)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('块公式的 mathml 在任何块位置的路径后缀都命中 .mathml（前言、引言、章、附录、列项、注内的公式）', () => {
    const doc = baseDoc()
    doc.front.foreword.push(formulaOf({ id: 'ff', numbered: false, mathml: MML }) as never)
    const found = xmlPaths(doc).map((path) => findDeclaredDifference(doc, path))
    expect(found.map((entry) => entry?.name)).toEqual(['mathml'])
    expectReleased(doc, found[0]!)
  })
})

describe('行内公式：mathml / source 放行', () => {
  it('[M-7.1-05] 行内公式只有 mathml（没有 latex）也放行；mathml + source + latex 一起零问题', () => {
    expect(xml46687Paths(pushRun(baseDoc(), { text: '', formula: { id: 'i1', mathml: MML } }))).toEqual([])
    expect(xml46687Paths(pushRun(baseDoc(), { text: '', formula: { id: 'i1', latex: 'x', mathml: MML, source: 'x' } }))).toEqual([])
  })

  it('[M-7.1-04] 行内公式里未登记的字段仍被报；带 marks 或脚注的 run 上的公式仍被报（原子不被 marks 包裹，边界保证）', () => {
    expectOnlyUnknownField(pushRun(baseDoc(), { text: '', formula: { id: 'i1', mathml: MML, zzz: 1 } as never }), 'doc.body[0].children[0].content[1].formula.zzz')
    const marked = pushRun(baseDoc(), { text: '', marks: [{ type: 'bold' }], formula: { id: 'i1', mathml: MML } })
    expect(xml46687Paths(marked)).toEqual(['doc.body[0].children[0].content[1].marks'])
    const footnoted = pushRun(baseDoc(), { text: '', formula: { id: 'i1', mathml: MML }, footnote: { id: 'fn', content: [{ text: '脚注' }] } })
    expect(xml46687Paths(footnoted)).toEqual(['doc.body[0].children[0].content[1].footnote'])
  })

  it('旧 XML 对行内公式整体阻断（保留旧断言）：一条 formula，不再下探', () => {
    expect(xmlPaths(pushRun(baseDoc(), { text: '', formula: { id: 'i1', mathml: MML, source: 'x' } }))).toEqual(['doc.body[0].children[0].content[1].formula'])
  })
})

describe('shape 登记：放行后零问题，对象里的未登记字段被精确报出', () => {
  const F = 'doc.body[0].children[1]'

  it('formulaNote：id、content 合法，content 按行内字段表校验；未登记字段被报', () => {
    expect(xml46687Paths(withFormula({ notes: [{ id: 'n1', content: [{ text: '注', marks: [{ type: 'italic' }] }] }] }))).toEqual([])
    expectOnlyUnknownField(withFormula({ notes: [{ id: 'n1', content: [], zzz: 1 }] }), `${F}.notes[0].zzz`)
  })

  it('公式注里的行内样式（颜色）仍被报（D-S-06 永久阻断）', () => {
    expect(xml46687Paths(withFormula({ notes: [{ id: 'n1', content: [{ text: '红', style: { color: '#f00' } }] }] }))).toEqual([`${F}.notes[0].content[0].style`])
  })

  it('式中项（where）与块公式的其余字段不受影响', () => {
    expect(xml46687Paths(withFormula({ whereList: [{ id: 'w1', term: [{ text: 'x' }], definition: [{ text: '含义' }] }] }))).toEqual([])
    expectOnlyUnknownField(withFormula({ whereList: [{ id: 'w1', term: [], definition: [], zzz: 1 }] }), `${F}.whereList[0].zzz`)
  })
})

describe('仍阻断 / 与旧 XML 相同', () => {
  it('formula.sourceInlines 与 latex 不等价（含格式、脚注、公式，或文本不同）仍被阻断，与旧 XML 逐字相同', () => {
    const doc = withFormula({ latex: 'x', sourceInlines: [{ text: 'y' }] })
    expect(xml46687Paths(doc)).toEqual([`doc.body[0].children[1].sourceInlines`])
    expect(xmlPaths(doc)).toEqual([`doc.body[0].children[1].sourceInlines`])
    const equivalent = withFormula({ latex: 'x', sourceInlines: [{ text: 'x' }] })
    expect(xml46687Paths(equivalent)).toEqual([])
  })

  it('旧 XML 对本域字段仍阻断（保留旧断言）：块公式的 mathml、notes 各报一条', () => {
    const doc = richDoc()
    const blocked = xmlPaths(doc).map((path) => path.replace(/\[\d+\]/g, ''))
    expect(blocked.filter((path) => path.endsWith('.mathml'))).toHaveLength(1)
    expect(blocked.filter((path) => path.endsWith('.notes'))).toHaveLength(1)
  })

  it('HTML 与 DOCX 的结论不受影响：块公式的 mathml、notes 对它们仍阻断', () => {
    for (const format of ['HTML', 'DOCX'] as const) {
      const found = getOutputSupportProblems(withFormula({ mathml: MML, notes: [{ id: 'n1', content: [] }] }), format).map((problem) => problem.path)
      expect(found, format).toContain('doc.body[0].children[1].mathml')
    }
  })
})
