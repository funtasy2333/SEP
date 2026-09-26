/**
 * body/inline.ts 单元测试（docs/wp7-docx-delivery.md §9 WP7.2「测试」runs 一项）。
 *
 * 各 mark、crossRef（有 label / 无 label）、文字中间的 \n、XML 特殊字符、正文首页名称的
 * 空格规则。
 */

import { describe, expect, it } from 'vitest'
import type { NodeId, ResolvedLabel } from '../../../ir/types'
import { breakRun, plainRun, renderInlines, renderRun, spacingRpr, tabRun } from './inline'
import { renderBodyTitle } from './front'
import { createRenderContext } from './context'
import { parseXml } from '../__tests__/helpers/xmlTree'

const NO_LABELS: Record<NodeId, ResolvedLabel> = {}

function wrapParagraph(runsXml: string) {
  return parseXml(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${runsXml}</w:p>`)
}

describe('renderRun：marks → rPr', () => {
  it('bold → b/bCs', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'bold' }] }, NO_LABELS)
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:bCs/>')
  })

  it('italic → i/iCs', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'italic' }] }, NO_LABELS)
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('<w:iCs/>')
  })

  it('underline → u val=single', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'underline' }] }, NO_LABELS)
    expect(xml).toContain('<w:u w:val="single"/>')
  })

  it('sub → vertAlign subscript', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'sub' }] }, NO_LABELS)
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>')
  })

  it('sup → vertAlign superscript', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'sup' }] }, NO_LABELS)
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>')
  })

  it('多个 mark 叠加在同一个 rPr 里', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }] }, NO_LABELS)
    const tree = wrapParagraph(xml)
    const runs = tree.children.filter((c) => c.kind === 'element' && c.name === 'w:r')
    expect(runs).toHaveLength(1) // 一个 run，rPr 里同时有 b 和 i
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:i/>')
  })

  it('无 mark 时不写 rPr', () => {
    const xml = renderRun({ text: 'x' }, NO_LABELS)
    expect(xml).not.toContain('<w:rPr>')
  })

  it('同一 mark 类型重复出现时只输出一次（#34 审查：避免产出两个 w:b 不符合 schema）', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }, NO_LABELS)
    expect((xml.match(/<w:b\/>/g) ?? []).length).toBe(1)
    expect((xml.match(/<w:bCs\/>/g) ?? []).length).toBe(1)
  })

  it('sub 与 sup 同时出现时只保留先出现的那个（都落在 vertAlign 上，先 sub 后 sup 时取 sub）', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'sub' }, { type: 'sup' }] }, NO_LABELS)
    expect((xml.match(/<w:vertAlign/g) ?? []).length).toBe(1)
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>')
    expect(xml).not.toContain('superscript')
  })

  it('sub 与 sup 同时出现，先 sup 后 sub 时取 sup', () => {
    const xml = renderRun({ text: 'x', marks: [{ type: 'sup' }, { type: 'sub' }] }, NO_LABELS)
    expect((xml.match(/<w:vertAlign/g) ?? []).length).toBe(1)
    expect(xml).toContain('<w:vertAlign w:val="superscript"/>')
    expect(xml).not.toContain('subscript')
  })
})

describe('renderRun / renderInlines：crossRef（§4.6）', () => {
  it('有 label 时输出 labels[targetId].refText，不加颜色不加下划线', () => {
    const labels: Record<NodeId, ResolvedLabel> = { target1: { label: '4.1', xmlId: 'sec_4.1', refText: '4.1（引用文本）' } }
    const xml = renderRun({ text: '原文', marks: [{ type: 'crossRef', targetId: 'target1' }] }, labels)
    expect(xml).toContain('4.1（引用文本）')
    expect(xml).not.toContain('原文')
    expect(xml).not.toContain('color')
    expect(xml).not.toContain('<w:u ')
  })

  it('目标没有 label 时输出该 run 的原文', () => {
    const xml = renderRun({ text: '原文占位', marks: [{ type: 'crossRef', targetId: 'missing-target' }] }, NO_LABELS)
    expect(xml).toContain('原文占位')
  })

  it('crossRef 与其他 mark 同时出现：文字换成 refText，其余 mark 照常作用', () => {
    const labels: Record<NodeId, ResolvedLabel> = { t2: { label: '5', xmlId: 'sec_5', refText: '第5章' } }
    const xml = renderRun({ text: 'x', marks: [{ type: 'bold' }, { type: 'crossRef', targetId: 't2' }] }, labels)
    expect(xml).toContain('第5章')
    expect(xml).toContain('<w:b/>')
  })

  it('renderInlines 拼接多个 run', () => {
    const xml = renderInlines([{ text: 'A' }, { text: 'B', marks: [{ type: 'bold' }] }], NO_LABELS)
    expect(xml).toContain('A')
    expect(xml).toContain('B')
    expect(xml).toContain('<w:b/>')
  })

  it('inline 数组为空时返回空串', () => {
    expect(renderInlines([], NO_LABELS)).toBe('')
  })
})

describe('文本中的 \\n 拆成 <w:br/>（§5.5）', () => {
  it('单个换行拆成两个 run，中间一个 br run', () => {
    const xml = renderRun({ text: '第一行\n第二行' }, NO_LABELS)
    const tree = wrapParagraph(xml)
    const runs = tree.children.filter((c) => c.kind === 'element' && c.name === 'w:r')
    expect(runs).toHaveLength(3) // 文本、br、文本
    expect(xml).toContain('第一行')
    expect(xml).toContain('<w:br/>')
    expect(xml).toContain('第二行')
    // br 出现在两段文字之间
    expect(xml.indexOf('第一行')).toBeLessThan(xml.indexOf('<w:br/>'))
    expect(xml.indexOf('<w:br/>')).toBeLessThan(xml.indexOf('第二行'))
  })

  it('连续换行只产生 br，不产生空的 <w:t>', () => {
    const xml = renderRun({ text: 'A\n\nB' }, NO_LABELS)
    expect((xml.match(/<w:br\/>/g) ?? []).length).toBe(2)
    expect(xml).not.toContain('<w:t xml:space="preserve"></w:t>')
  })

  it('换行的 run 带同样的 rPr', () => {
    const xml = renderRun({ text: 'A\nB', marks: [{ type: 'bold' }] }, NO_LABELS)
    const brSegment = xml.split('<w:br/>')[0]
    expect(brSegment).toContain('<w:b/>') // br 前那个 run（文本 A）带 rPr
    const afterBr = xml.split('<w:br/>')[1]
    expect(afterBr).toContain('<w:b/>') // br 自身那个 run 也带 rPr
  })
})

describe('XML 特殊字符转义', () => {
  it('& < > 在 w:t 里正确转义', () => {
    const xml = renderRun({ text: 'A & B < C > D' }, NO_LABELS)
    expect(xml).toContain('A &amp; B &lt; C &gt; D')
    expect(xml).not.toContain('A & B')
  })

  it('w:t 一律写 xml:space="preserve"', () => {
    const xml = renderRun({ text: '  带前后空格  ' }, NO_LABELS)
    expect(xml).toContain('<w:t xml:space="preserve">  带前后空格  </w:t>')
  })
})

describe('plainRun / tabRun / breakRun / spacingRpr', () => {
  it('plainRun 输出纯文本 run，可选 rPr', () => {
    expect(plainRun('文字')).toContain('文字')
    expect(plainRun('文字')).not.toContain('<w:rPr>')
    const withRpr = plainRun('文字', spacingRpr(640))
    expect(withRpr).toContain('<w:spacing w:val="640"/>')
  })

  it('tabRun / breakRun', () => {
    expect(tabRun()).toBe('<w:r><w:tab/></w:r>')
    expect(breakRun()).toBe('<w:r><w:br/></w:r>')
  })
})

describe('正文首页名称的空格规则（§5.1）', () => {
  it('去掉首尾空白，连续半角空格替换为一个全角空格', () => {
    const ctx = createRenderContext(NO_LABELS)
    const xml = renderBodyTitle(ctx, '  标准化文件   编辑系统  ')
    expect(xml).toContain('标准化文件　编辑系统')
    expect(xml).not.toContain('  ')
    expect(ctx.warnings).toHaveLength(0)
  })

  it('meta.title 缺失时输出空段并记 cover-field-missing', () => {
    const ctx = createRenderContext(NO_LABELS)
    const xml = renderBodyTitle(ctx, undefined)
    expect(xml).toBe('<w:p><w:pPr><w:pStyle w:val="SesBodyTitle"/></w:pPr></w:p>')
    expect(ctx.warnings).toEqual([{ code: 'cover-field-missing', message: 'meta.title 缺失，正文首页名称输出空段' }])
  })

  it('单个空格也会被规范为全角空格', () => {
    const ctx = createRenderContext(NO_LABELS)
    const xml = renderBodyTitle(ctx, '标准 系统')
    expect(xml).toContain('标准　系统')
  })
})
