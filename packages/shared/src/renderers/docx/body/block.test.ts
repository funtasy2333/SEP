/**
 * body/block.ts 单元测试：公式编号在 DOCX 中的显示文本、直接字体格式和缺失 label 警告。
 */

import { describe, expect, it } from 'vitest'
import type { IRFormula, NodeId, ResolvedLabel } from '../../../ir/types'
import { findChild, parseXml, type XmlElement } from '../__tests__/helpers/xmlTree'
import { renderBlock } from './block'
import { createRenderContext } from './context'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const SONG_FONT_ATTRS = {
  'w:ascii': '宋体',
  'w:eastAsia': '宋体',
  'w:hAnsi': '宋体',
  'w:cs': '宋体',
}

function renderFormula(label?: string): { xml: string; warnings: ReturnType<typeof createRenderContext>['warnings'] } {
  const labels: Record<NodeId, ResolvedLabel> = {}
  if (label !== undefined) labels['formula-1'] = { label, xmlId: 'formula_1', refText: `公式${label}` }
  const ctx = createRenderContext(labels, new Map(), {
    images: {},
    formulaOmml: { 'formula-1': '<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath>' },
  })
  const formula: IRFormula = { kind: 'formula', id: 'formula-1', latex: 'x=1', numbered: true, whereList: [] }
  return { xml: renderBlock(ctx, formula, { scopeKey: 'chapter-1' }), warnings: ctx.warnings }
}

function textContent(element: XmlElement): string {
  return element.children.map((child) => child.kind === 'text' ? child.text : textContent(child)).join('')
}

function paragraph(xml: string): XmlElement {
  const root = parseXml(`<w:root xmlns:w="${W_NS}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${xml}</w:root>`)
  return findChild(root, 'w:p')!
}

describe('renderFormula：编号标签', () => {
  it.each([
    { resolverLabel: '(1)', expected: '（1）' },
    { resolverLabel: '(A.1)', expected: '（A.1）' },
    { resolverLabel: '（1）', expected: '（1）' },
  ])('将 Resolver 的 $resolverLabel 输出为 $expected，并在编号 run 上显式指定宋体', ({ resolverLabel, expected }) => {
    const { xml, warnings } = renderFormula(resolverLabel)
    const runs = paragraph(xml).children.filter(
      (child): child is XmlElement => child.kind === 'element' && child.name === 'w:r',
    )
    const numberRun = runs.find((run) => textContent(run) === expected)

    expect(numberRun).toBeDefined()
    expect(textContent(numberRun!)).toBe(expected)
    const rPr = findChild(numberRun!, 'w:rPr')
    expect(rPr).toBeDefined()
    expect(findChild(rPr!, 'w:rFonts')?.attrs).toEqual(SONG_FONT_ATTRS)
    expect(warnings).toEqual([])
  })

  it('编号 label 缺失时保留原警告且不输出公式编号', () => {
    const { xml, warnings } = renderFormula()
    const paragraphXml = paragraph(xml)

    expect(warnings).toEqual([{
      code: 'label-missing',
      nodeId: 'formula-1',
      message: '公式 "formula-1" 需要编号但 labels 中没有 label，不写编号',
    }])
    expect(textContent(paragraphXml)).toContain('x=1')
    expect(textContent(paragraphXml)).not.toContain('（')
  })
})
