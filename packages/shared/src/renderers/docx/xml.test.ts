import { describe, expect, it } from 'vitest'
import {
  childOrderOf,
  escapeXmlAttr,
  escapeXmlText,
  joinOrderedChildren,
  localNameOf,
  num,
  pPr,
  rankMapFor,
  sectPr,
  wrapElement,
} from './xml'

describe('escapeXmlText / escapeXmlAttr', () => {
  it('转义 & < >', () => {
    expect(escapeXmlText('A & B < C > D')).toBe('A &amp; B &lt; C &gt; D')
  })

  it('属性值额外转义双引号', () => {
    expect(escapeXmlAttr('say "hi" & bye')).toBe('say &quot;hi&quot; &amp; bye')
  })
})

describe('wrapElement', () => {
  it('无内容时自闭合', () => {
    expect(wrapElement('w:b', '')).toBe('<w:b/>')
  })

  it('有内容时正常包裹', () => {
    expect(wrapElement('w:p', 'x')).toBe('<w:p>x</w:p>')
  })

  it('带属性', () => {
    expect(wrapElement('w:lvl', 'x', { 'w:ilvl': 0 })).toBe('<w:lvl w:ilvl="0">x</w:lvl>')
  })
})

describe('joinOrderedChildren', () => {
  it('按附录 B 顺序稳定排序，与调用方传入顺序无关', () => {
    const out = joinOrderedChildren('pPr', [
      ['jc', '<w:jc/>'],
      ['pStyle', '<w:pStyle/>'],
      ['numPr', '<w:numPr/>'],
    ])
    expect(out).toBe('<w:pStyle/><w:numPr/><w:jc/>')
  })

  it('同名元素允许重复，保持调用方相对顺序（tr+）', () => {
    const out = joinOrderedChildren('tbl', [
      ['tr', '<w:tr>1</w:tr>'],
      ['tblPr', '<w:tblPr/>'],
      ['tr', '<w:tr>2</w:tr>'],
      ['tblGrid', '<w:tblGrid/>'],
    ])
    expect(out).toBe('<w:tblPr/><w:tblGrid/><w:tr>1</w:tr><w:tr>2</w:tr>')
  })

  it('元素名不在清单里直接抛错', () => {
    expect(() => joinOrderedChildren('pPr', [['notAThing', '<x/>']])).toThrow(/不在.*清单内/)
  })

  it('容器名本身不认识也抛错', () => {
    expect(() => joinOrderedChildren('notAContainer', [])).toThrow(/未知容器/)
  })

  it('sectPr 的 headerReference/footerReference 任意顺序，仍排在 footnotePr 之前', () => {
    const a = joinOrderedChildren('sectPr', [
      ['type', '<w:type/>'],
      ['footerReference', '<w:footerReference w:type="default"/>'],
      ['headerReference', '<w:headerReference w:type="default"/>'],
    ])
    // 调用方给的是 footer 在前、header 在后：保持原相对顺序（同名次不重排）
    expect(a).toBe('<w:footerReference w:type="default"/><w:headerReference w:type="default"/><w:type/>')
  })
})

describe('9 个容器薄包装', () => {
  it('pPr 包一层标签', () => {
    expect(pPr([['pStyle', '<w:pStyle w:val="SesPara"/>']])).toBe('<w:pPr><w:pStyle w:val="SesPara"/></w:pPr>')
  })

  it('num 带 numId 属性，lvlOverride 可重复', () => {
    const out = num(
      [
        ['abstractNumId', '<w:abstractNumId w:val="1"/>'],
        ['lvlOverride', '<w:lvlOverride w:ilvl="0"/>'],
      ],
      { 'w:numId': 100 },
    )
    expect(out).toBe('<w:num w:numId="100"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"/></w:num>')
  })

  it('sectPr 无内容时自闭合', () => {
    expect(sectPr([])).toBe('<w:sectPr/>')
  })
})

describe('childOrderOf / rankMapFor / localNameOf', () => {
  it('childOrderOf 对未知容器返回 undefined', () => {
    expect(childOrderOf('notAContainer')).toBeUndefined()
  })

  it('rankMapFor 给出的名次表能查到已知子元素', () => {
    const rank = rankMapFor('rPr')
    expect(rank?.get('rStyle')).toBe(0)
    expect(rank?.has('oMath')).toBe(true)
  })

  it('localNameOf 去掉 w: 前缀，保留其他前缀', () => {
    expect(localNameOf('w:pPr')).toBe('pPr')
    expect(localNameOf('m:mathPr')).toBe('m:mathPr')
    expect(localNameOf('pPr')).toBe('pPr')
  })
})
