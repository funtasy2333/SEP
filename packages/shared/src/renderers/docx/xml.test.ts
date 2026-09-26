import { describe, expect, it } from 'vitest'
import {
  abstractNum,
  childOrderOf,
  docDefaults,
  escapeXmlAttr,
  escapeXmlText,
  joinOrderedChildren,
  localNameOf,
  num,
  numbering,
  numPr,
  pBdr,
  pPr,
  rankMapFor,
  sectPr,
  styles,
  wrapElement,
} from './xml'

describe('escapeXmlText / escapeXmlAttr', () => {
  it('转义 & < >', () => {
    expect(escapeXmlText('A & B < C > D')).toBe('A &amp; B &lt; C &gt; D')
  })

  it('属性值额外转义双引号', () => {
    expect(escapeXmlAttr('say "hi" & bye')).toBe('say &quot;hi&quot; &amp; bye')
  })

  it('两个函数都静默删除 XML 1.0 不允许的字符（审查第 2 条）', () => {
    // U+0000、U+000B：控制字符；U+FFFE：noncharacter；\uD800：孤立代理项
    const dirty = 'A\u0000B\u000BC￾D\uD800E'
    expect(escapeXmlText(dirty)).toBe('ABCDE')
    expect(escapeXmlAttr(dirty)).toBe('ABCDE')
  })

  it('保留 TAB/LF/CR（XML 1.0 合法字符），escapeXmlText 原样保留', () => {
    expect(escapeXmlText('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  it('escapeXmlAttr 把 \\t \\n \\r 编码成数字字符引用，避免属性值规范化吃掉', () => {
    expect(escapeXmlAttr('a\tb\nc\rd')).toBe('a&#9;b&#10;c&#13;d')
  })

  it('合法的增补平面字符（正确配对代理对）不受影响', () => {
    expect(escapeXmlText('x\u{1F600}y')).toBe('x\u{1F600}y')
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

  it('容器名撞上 Object.prototype 属性名时同样按未知容器处理（审查第 1 条）', () => {
    expect(() => joinOrderedChildren('constructor', [])).toThrow(/未知容器/)
    expect(() => joinOrderedChildren('toString', [])).toThrow(/未知容器/)
    expect(() => joinOrderedChildren('hasOwnProperty', [])).toThrow(/未知容器/)
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

describe('WP7.2 补的 6 个容器', () => {
  it('numPr：ilvl 在前，numId 在后（附录 B 顺序，与调用方传入顺序无关）', () => {
    const out = numPr([
      ['numId', '<w:numId w:val="1"/>'],
      ['ilvl', '<w:ilvl w:val="0"/>'],
    ])
    expect(out).toBe('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
  })

  it('abstractNum：带 abstractNumId 属性，lvl 可重复', () => {
    const out = abstractNum(
      [
        ['multiLevelType', '<w:multiLevelType w:val="multilevel"/>'],
        ['lvl', '<w:lvl w:ilvl="0"/>'],
        ['lvl', '<w:lvl w:ilvl="1"/>'],
      ],
      { 'w:abstractNumId': 1 },
    )
    expect(out).toBe(
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"/><w:lvl w:ilvl="1"/></w:abstractNum>',
    )
  })

  it('numbering：abstractNum 在 num 之前，即使调用方顺序相反', () => {
    const out = numbering([
      ['num', '<w:num w:numId="1"/>'],
      ['abstractNum', '<w:abstractNum w:abstractNumId="1"/>'],
    ])
    expect(out).toBe('<w:numbering><w:abstractNum w:abstractNumId="1"/><w:num w:numId="1"/></w:numbering>')
  })

  it('styles：docDefaults 在 style 之前', () => {
    const out = styles([
      ['style', '<w:style w:styleId="SesNormal"/>'],
      ['docDefaults', '<w:docDefaults/>'],
    ])
    expect(out).toBe('<w:styles><w:docDefaults/><w:style w:styleId="SesNormal"/></w:styles>')
  })

  it('docDefaults：rPrDefault 在 pPrDefault 之前', () => {
    const out = docDefaults([
      ['pPrDefault', '<w:pPrDefault/>'],
      ['rPrDefault', '<w:rPrDefault/>'],
    ])
    expect(out).toBe('<w:docDefaults><w:rPrDefault/><w:pPrDefault/></w:docDefaults>')
  })

  it('pBdr：按 top/left/bottom/right/between/bar 排序', () => {
    const out = pBdr([
      ['bottom', '<w:bottom w:val="single"/>'],
      ['top', '<w:top w:val="single"/>'],
    ])
    expect(out).toBe('<w:pBdr><w:top w:val="single"/><w:bottom w:val="single"/></w:pBdr>')
  })

  it('元素名不在清单里的调用一律抛错（六个新容器都受 CHILD_ORDER 校验保护）', () => {
    expect(() => numPr([['notAThing', '<x/>']])).toThrow(/不在.*清单内/)
    expect(() => abstractNum([['notAThing', '<x/>']])).toThrow(/不在.*清单内/)
    expect(() => numbering([['notAThing', '<x/>']])).toThrow(/不在.*清单内/)
    expect(() => styles([['notAThing', '<x/>']])).toThrow(/不在.*清单内/)
    expect(() => docDefaults([['notAThing', '<x/>']])).toThrow(/不在.*清单内/)
    expect(() => pBdr([['notAThing', '<x/>']])).toThrow(/不在.*清单内/)
  })
})

describe('childOrderOf / rankMapFor / localNameOf', () => {
  it('childOrderOf 对未知容器返回 undefined', () => {
    expect(childOrderOf('notAContainer')).toBeUndefined()
  })

  it('childOrderOf / rankMapFor 对撞名 Object.prototype 属性的容器名返回 undefined（审查第 1 条）', () => {
    expect(childOrderOf('constructor')).toBeUndefined()
    expect(rankMapFor('constructor')).toBeUndefined()
    expect(childOrderOf('__proto__')).toBeUndefined()
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
