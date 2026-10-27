import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import type { IRBlock, IRDoc } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { fullRendererFixture } from './fullRendererFixture'
import { EMPTY_OPTIONS, chapter, labelsOf, makeDoc, para } from './xml46687Kit'

/**
 * 领域桩（T2.4a-1）：表、图、公式、MathML 在 T2.4b 之前是桩（术语、缩略语、规范性引用、参考文献、索引已由 T2.4c 实现，对应的桩行已删除）——
 * 遇到这些内容就抛“未实现”，不静默丢弃（设计 §6.3）。
 *
 * **接手任务的人：实现某个领域后，删掉本文件里属于你的那一行**；其余行保持原样。
 * 本文件不属于矩阵覆盖断言的范围（它不引用矩阵 id）。
 */

const inTerms = (blocks: IRBlock[]): IRDoc => makeDoc([chapter('ch1', '范围', blocks, 'scope')])

describe('领域桩：遇到未实现的内容抛 “… not implemented (T2.4b)”', () => {
  const table: IRBlock = { kind: 'table', id: 't1', caption: [], orientation: 'portrait', headerRowCount: 0, notes: [], rows: [] }
  const figure: IRBlock = { kind: 'figure', id: 'f1', caption: [], orientation: 'portrait', src: '', notes: [] }
  const formula: IRBlock = { kind: 'formula', id: 'fo1', latex: 'x', numbered: false, whereList: [] }

  it.each([
    ['表 → renderTable（T2.4b）', () => exportXml46687(inTerms([table]), labelsOf(inTerms([table])), EMPTY_OPTIONS), /renderTable.*not implemented \(T2\.4b\)/],
    ['图 → renderFigure（T2.4b）', () => exportXml46687(inTerms([figure]), labelsOf(inTerms([figure])), EMPTY_OPTIONS), /renderFigure.*not implemented \(T2\.4b\)/],
    ['块公式 → renderFormula（T2.4b）', () => exportXml46687(inTerms([formula]), labelsOf(inTerms([formula])), EMPTY_OPTIONS), /renderFormula.*not implemented \(T2\.4b\)/],
  ])('%s', (_title, run, pattern) => {
    expect(run).toThrow(pattern)
  })

  it('行内公式、行内图 → renderInlineFormula / renderInlineImage（T2.4b）', () => {
    const formulaDoc = makeDoc([chapter('ch1', '范围', [para('p1', { text: '', formula: { id: 'f-inline', latex: 'x' } })], 'scope')])
    expect(() => exportXml46687(formulaDoc, labelsOf(formulaDoc), EMPTY_OPTIONS)).toThrow(/renderInlineFormula.*not implemented \(T2\.4b\)/)
    const imageDoc = makeDoc([chapter('ch1', '范围', [para('p1', { text: '', image: { src: 'x.png' } })], 'scope')])
    // 行内图通过输出边界之前不被放行（本阶段边界对 image 仍阻断），所以直接走管线入口前的边界断言
    expect(exportXml46687(imageDoc, labelsOf(imageDoc), EMPTY_OPTIONS).xml).toBeNull()
  })

  it('fullRendererFixture 含表、图、公式、术语与参考文献，T2.4b 的桩（表、图、公式）无法导出：它的 XML 黄金样例留给 T2.6（设计 §7.2）', () => {
    const { doc } = pmToIr(fullRendererFixture())
    expect(() => exportXml46687(doc, resolve(doc).labels, EMPTY_OPTIONS)).toThrow(/not implemented \(T2\.4b\)/)
  })
})
