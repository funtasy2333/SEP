import { describe, expect, it } from 'vitest'
import { pmToIr, type IRFormula, type PMJsonNode } from '@ses/shared'
import { applyDocumentOperations } from './apply'
import { readNode } from './readNode'
import { chapter, clone, deepFreeze, doc, node, seqIds, text } from './testFixtures'

/** 含公式符号式中的文档：f-1 的第一条符号是行内公式，第二条是文字。 */
function source(): PMJsonNode {
  return doc(chapter('ch-1', '计算',
    node('formula', { nodeId: 'f-1', latex: 'q_{V}=Av', numbered: true }, [
      node('formulaContent', undefined, [text('q_{V}=Av')]),
      node('whereList', undefined, [
        node('whereItem', { nodeId: 'f-1-w0' }, [
          node('whereTerm', undefined, [node('formulaInline', { nodeId: 'sym-q', latex: 'q_{V}', mathml: null, source: null })]),
          node('whereDefinition', undefined, [text('体积流量')]),
        ]),
        node('whereItem', { nodeId: 'f-1-w1' }, [
          node('whereTerm', undefined, [text('A')]),
          node('whereDefinition', undefined, [text('面积')]),
        ]),
      ]),
    ]),
  ))
}

function apply(operations: unknown) {
  return applyDocumentOperations(deepFreeze(clone(source())), operations, { generateId: seqIds() })
}

describe('文档操作：式中符号行内公式', () => {
  it('读出的公式可以原样整体替换，文档保持不变', () => {
    const read = readNode(source(), 'f-1')
    if (!read.ok) throw new Error(read.reason)
    expect(read.node.replaceable).toBe(true)
    expect((read.node.ir as IRFormula).whereList[0]!.term).toEqual([{ text: '', formula: { id: 'sym-q', latex: 'q_{V}' } }])
    const result = apply([{ op: 'replace', nodeId: 'f-1', content: [read.node.ir] }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(pmToIr(result.doc).doc).toEqual(pmToIr(source()).doc)
  })

  it('插入带公式符号的公式，写入生产文档的 formulaInline', () => {
    const result = apply([{ op: 'insert', parent: 'ch-1', position: 'end', content: [
      { kind: 'formula', latex: String.raw`\rho_{\mathrm{w}} = m/V`, whereList: [
        { term: [{ formula: { latex: String.raw`\rho_{\mathrm{w}}` } }], definition: '水的密度' },
      ] },
    ] }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    const formula = pmToIr(result.doc).doc.body[0]!.children[1] as IRFormula
    expect(formula.whereList[0]!.term).toEqual([{ text: '', formula: { id: expect.any(String), latex: String.raw`\rho_{\mathrm{w}}` } }])
  })

  it('KaTeX 无法解析的符号在写入前拒绝，并给出位置', () => {
    const result = apply([{ op: 'insert', parent: 'ch-1', position: 'end', content: [
      { kind: 'formula', latex: 'x', whereList: [{ term: [{ formula: { latex: String.raw`\frac{` } }], definition: '坏符号' }] },
    ] }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([expect.objectContaining({
      operationIndex: 0,
      code: 'invalid-value',
      path: 'operations[0].content[0].whereList[0].term[0].formula.latex',
    })])
    expect(result.issues[0]!.reason).toContain('KaTeX')
  })
})

describe('文档操作：正文类位置的行内公式（Phase 7）', () => {
  it('插入含行内公式的段落与表格，读出后可原样替换', () => {
    const result = apply([{ op: 'insert', parent: 'ch-1', position: 'end', content: [
      { kind: 'paragraph', id: 'p-new', content: ['当', { formula: { latex: 'q_{V}' } }, '大于 1 时'] },
      { kind: 'table', id: 't-new', caption: '参数', rows: [{ cells: [{ content: [{ formula: { latex: String.raw`\lambda` } }] }] }] },
    ] }])
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    for (const id of ['p-new', 't-new']) {
      const read = readNode(result.doc, id)
      if (!read.ok) throw new Error(read.reason)
      expect(read.node.replaceable).toBe(true)
      expect(JSON.stringify(read.node.ir)).toContain('"formula":')
    }
  })

  it('段落中 KaTeX 无法解析的公式写入前拒绝', () => {
    const result = apply([{ op: 'insert', parent: 'ch-1', position: 'end', content: [
      { kind: 'paragraph', content: ['坏', { formula: { latex: String.raw`\frac{` } }] },
    ] }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([expect.objectContaining({ code: 'invalid-value', path: 'operations[0].content[0].content[1].formula.latex' })])
  })
})
