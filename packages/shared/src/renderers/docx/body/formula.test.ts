import { describe, expect, it } from 'vitest'
import type { IRFormula, ResolvedLabel } from '../../../ir/types'
import { createRenderContext } from './context'
import { renderFormula } from './formula'

const FORMULA: IRFormula = {
  kind: 'formula',
  id: 'f-a1',
  latex: String.raw`x < 0`,
  numbered: true,
  whereList: [
    {
      id: 'f-a1.w0',
      term: [{ text: 'x' }],
      definition: [{ text: '变量取值；满足条件时使用。' }],
    },
    {
      id: 'f-a1.w1',
      term: [{ text: 'n' }],
      definition: [{ text: '样本数。' }],
    },
  ],
}

const LABELS: Record<string, ResolvedLabel> = {
  'f-a1': { label: '(A.1)', xmlId: 'formula_A.1', refText: '公式(A.1)' },
}

describe('DOCX 公式段', () => {
  it('写入 OMML、中文括号编号、式中条目和悬挂缩进', () => {
    const ctx = createRenderContext(LABELS)
    const xml = renderFormula(ctx, FORMULA, '<m:oMath xmlns:m="urn:m"><m:r><m:t>x</m:t></m:r></m:oMath>')

    expect(xml).toContain('<w:pStyle w:val="SesFormula"/>')
    expect(xml).toContain('<m:oMath xmlns:m="urn:m">')
    expect(xml).toContain('<w:t xml:space="preserve">（A.1）</w:t>')
    expect(xml).toContain('<w:pStyle w:val="SesWhereLabel"/>')
    expect(xml).toContain('<w:t xml:space="preserve">式中：</w:t>')
    expect(xml).toContain('<w:pStyle w:val="SesWhereItem"/>')
    expect(xml).toContain('<w:tab w:val="left" w:pos="735"/>')
    expect(xml).toContain('<w:ind w:left="1155" w:hanging="735"/>')
    expect(xml).toContain('——')
    expect(ctx.warnings).toEqual([])
  })

  it('OMML 缺失时写 LaTeX 文本并记录公式降级告警', () => {
    const ctx = createRenderContext(LABELS)
    const xml = renderFormula(ctx, { ...FORMULA, whereList: [] })

    expect(xml).toContain('<w:t xml:space="preserve">x &lt; 0</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">（A.1）</w:t>')
    expect(ctx.warnings).toEqual([{
      code: 'formula-missing-omml',
      nodeId: 'f-a1',
      message: '公式 "f-a1" 缺少 OMML，已回退为 LaTeX 源码文本',
    }])
  })

  it('未编号公式不输出第二个制表位或编号', () => {
    const ctx = createRenderContext({})
    const xml = renderFormula(ctx, { ...FORMULA, numbered: false, whereList: [] }, '<m:oMath/>')

    expect(xml.match(/<w:tab\/>/g)).toHaveLength(1)
    expect(xml).not.toContain('（A.1）')
    expect(ctx.warnings).toEqual([])
  })

  it('编号公式缺少 label 时省略编号并记 label-missing', () => {
    const ctx = createRenderContext({})
    const xml = renderFormula(ctx, { ...FORMULA, whereList: [] }, '<m:oMath/>')

    expect(xml.match(/<w:tab\/>/g)).toHaveLength(1)
    expect(ctx.warnings).toEqual([{
      code: 'label-missing',
      nodeId: 'f-a1',
      message: '公式 "f-a1" 需要编号但 labels 中没有 label，不写编号',
    }])
  })
})
