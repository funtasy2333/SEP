import { describe, expect, it } from 'vitest'
import { MATHML_NS, XLINK_NS, type XmlElement, type XmlNode } from '../../xml46687/tree'
import { writeXml } from '../../xml46687/writer'
import { MathMlParseError, parseMathMl, parseMathMlDetailed } from '../xml46687Parts/mathml'
import { XML46687_NAMESPACES, preserveSpace } from '../xml46687Parts/context'

/**
 * MathML 片段解析器（WP8.2 设计 §4.5）：严格、纯 TS、无 DOM；统一成 `mml:` 前缀；拒绝 DOCTYPE/实体声明/PI/命名实体/事件属性/危险协议；
 * 去掉 TeX 注释并展开 `semantics`。解析失败抛 `MathMlParseError`（带字符偏移与行列），管线里转成 `mathml-invalid`。
 * 管线级的测试（根属性重写、`mml_m<k>`、`mathml-missing`/`mathml-invalid`）在 xml46687.formulas.test.ts。
 */

const NS = `xmlns="${MATHML_NS}"`

/** 把解析结果写成紧凑文本（`mml` 前缀，不缩进），便于断言。 */
function show(root: XmlElement): string {
  const text = writeXml({ root }, { namespaces: XML46687_NAMESPACES, indent: null, preserveSpace })
  return text.replace(/^[\s\S]*?\n/, '').replace(/ xmlns:\w+="[^"]*"/g, '').trim()
}
const parse = (source: string): string => show(parseMathMl(source))

function failure(source: string): MathMlParseError {
  try {
    parseMathMl(source)
  } catch (error) {
    expect(error).toBeInstanceOf(MathMlParseError)
    return error as MathMlParseError
  }
  throw new Error(`期望解析失败：${source}`)
}

describe('接受的写法与统一的 mml: 前缀', () => {
  it('[M-7.4-01] mml: 前缀（根上不带命名空间声明：mml、xlink 预先绑定）→ 结果元素全在 MathML 命名空间，前缀提示为 mml', () => {
    const root = parseMathMl('<mml:math><mml:mi>x</mml:mi><mml:mo>+</mml:mo><mml:mn>1</mml:mn></mml:math>')
    expect(root.name).toEqual({ ns: MATHML_NS, local: 'math', prefix: 'mml' })
    expect(root.children.map((child) => child.type === 'element' ? `${child.name.local}@${child.name.ns}` : child.type)).toEqual([
      `mi@${MATHML_NS}`, `mo@${MATHML_NS}`, `mn@${MATHML_NS}`,
    ])
    expect(show(root)).toBe('<mml:math><mml:mi>x</mml:mi><mml:mo>+</mml:mo><mml:mn>1</mml:mn></mml:math>')
  })

  it('[M-7.4-01] 默认命名空间写法 <math xmlns="…MathML">（KaTeX 的输出常是这种形式）→ 统一成 mml: 前缀', () => {
    expect(parse(`<math ${NS}><mrow><mi>a</mi><mo>=</mo><mn>2</mn></mrow></math>`)).toBe('<mml:math><mml:mrow><mml:mi>a</mml:mi><mml:mo>=</mml:mo><mml:mn>2</mml:mn></mml:mrow></mml:math>')
  })

  it('[M-7.4-01] 其他前缀（m:）加声明、子元素重新声明默认命名空间、显式声明 mml 前缀，均接受并统一', () => {
    expect(parse(`<m:math xmlns:m="${MATHML_NS}"><m:mi>x</m:mi></m:math>`)).toBe('<mml:math><mml:mi>x</mml:mi></mml:math>')
    expect(parse(`<mml:math xmlns:mml="${MATHML_NS}"><mi ${NS}>x</mi></mml:math>`)).toBe('<mml:math><mml:mi>x</mml:mi></mml:math>')
  })

  it('[M-7.4-04] [M-7.4-05] [M-7.4-06] [M-7.4-07] [M-7.4-08] [M-7.4-09] [M-7.4-10] [M-7.4-11] 内部元素与属性按字符串保真：mrow、mi、mn、mo、mfrac、msub、msup、mspace 及 mathvariant、width 等属性原样保留，次序不变', () => {
    const source = `<mml:math display="block" alttext="E"><mml:mrow><mml:mi mathvariant="italic">E</mml:mi><mml:mo stretchy="false">=</mml:mo>`
      + `<mml:mfrac><mml:msup><mml:mi>v</mml:mi><mml:mn>2</mml:mn></mml:msup><mml:msub><mml:mi>a</mml:mi><mml:mn>0</mml:mn></mml:msub></mml:mfrac><mml:mspace width="1em"/></mml:mrow></mml:math>`
    expect(parse(source)).toBe(source.replace('<mml:mspace width="1em"/>', '<mml:mspace width="1em"/>'))
  })

  it('属性：无命名空间的原样；xlink:href、xml:lang 带命名空间；根上的 id 与 display 由本解析器保留（重写在 formulas.ts 与 ids.ts）', () => {
    const root = parseMathMl(`<mml:math id="m1" display="inline" xml:lang="zh" xlink:href="#eq1"><mml:mi>x</mml:mi></mml:math>`)
    expect(root.attrs.map((attr) => `${attr.name.ns ?? ''}|${attr.name.local}=${attr.value}`)).toEqual([
      '|id=m1', '|display=inline', 'http://www.w3.org/XML/1998/namespace|lang=zh', `${XLINK_NS}|href=#eq1`,
    ])
  })

  it('字符引用：五个预定义实体与十进制/十六进制数字引用（&#x2264; → ≤）；属性值里同理', () => {
    const root = parseMathMl(`<mml:math alttext="a&lt;b &amp; c&#x3E;d"><mml:mo>&lt;&gt;&amp;&quot;&apos;&#8804;&#x2265;</mml:mo></mml:math>`)
    expect(root.attrs[0]!.value).toBe('a<b & c>d')
    expect(root.children[0]).toMatchObject({ children: [{ type: 'text', value: `<>&"'≤≥` }] })
  })

  it('CDATA 归一为文本；注释被丢弃；根元素前后允许空白与注释；允许开头的 BOM', () => {
    expect(parse('﻿<!-- 公式 -->\n<mml:math><mml:mtext><![CDATA[a < b & c]]></mml:mtext><!-- 注释 --></mml:math>\n')).toBe('<mml:math><mml:mtext>a &lt; b &amp; c</mml:mtext></mml:math>')
  })

  it('空元素写法（<mml:mspace/>、<mml:math/>）与带空白的结束标签 </mml:mi >', () => {
    expect(parse('<mml:math><mml:mspace/><mml:mi>x</mml:mi ></mml:math>')).toBe('<mml:math><mml:mspace/><mml:mi>x</mml:mi></mml:math>')
    expect(parse('<mml:math/>')).toBe('<mml:math/>')
  })

  it('元素之间仅由缩进产生的空白被丢弃；令牌元素（mi、mn、mo、mtext、ms）与 annotation 的文本逐字保留，含仅空白的 mtext', () => {
    const pretty = `<mml:math>\n  <mml:mrow>\n    <mml:mi>x</mml:mi>\n    <mml:mtext> a  b </mml:mtext>\n    <mml:mtext> </mml:mtext>\n  </mml:mrow>\n</mml:math>`
    expect(parse(pretty)).toBe('<mml:math><mml:mrow><mml:mi>x</mml:mi><mml:mtext> a  b </mml:mtext><mml:mtext> </mml:mtext></mml:mrow></mml:math>')
  })

  it('行结束符归一化（\\r\\n、\\r → \\n）；属性值里的字面 TAB/LF 规范化为空格，但字符引用解码后不再规范化', () => {
    const root = parseMathMl('<mml:math alttext="a\tb\r\nc&#9;d"><mml:mtext>x\r\ny</mml:mtext></mml:math>')
    expect(root.attrs[0]!.value).toBe('a b c\td')
    expect(root.children[0]).toMatchObject({ children: [{ type: 'text', value: 'x\ny' }] })
  })

  it('解析结果是纯数据：JSON 往返相等，没有 undefined 字段', () => {
    const root = parseMathMl(`<math ${NS}><semantics><mrow><mi>x</mi></mrow><annotation encoding="MathML-Content">c</annotation></semantics></math>`)
    expect(JSON.parse(JSON.stringify(root))).toEqual(root)
  })
})

describe('TeX 注释与 semantics（§4.5-5）', () => {
  const katex = (tex: string, encoding = 'application/x-tex') =>
    `<math ${NS}><semantics><mrow><mi>x</mi></mrow><annotation encoding="${encoding}">${tex}</annotation></semantics></math>`

  it('[M-7.4-16] 去掉 encoding 为 TeX 的 annotation，semantics 只剩一个子元素时展开；返回被去掉的个数（info mathml-annotation-removed 由 formulas.ts 报）', () => {
    const parsed = parseMathMlDetailed(katex('x^{2}'))
    expect(parsed.removedAnnotations).toBe(1)
    expect(show(parsed.root)).toBe('<mml:math><mml:mrow><mml:mi>x</mml:mi></mml:mrow></mml:math>')
    expect(show(parsed.root)).not.toMatch(/x\^|annotation|semantics/)
  })

  it('TeX 编码的判定：application/x-tex、TeX、LaTeX、application/x-latex（大小写不敏感，去首尾空白）；annotation-xml 同理', () => {
    for (const encoding of ['application/x-tex', 'TeX', 'LaTeX', 'latex', ' application/x-latex ', 'text/x-tex']) {
      expect(parseMathMlDetailed(katex('t', encoding)).removedAnnotations, encoding).toBe(1)
    }
    const xml = `<math ${NS}><semantics><mi>x</mi><annotation-xml encoding="TeX"><mi>t</mi></annotation-xml></semantics></math>`
    expect(parseMathMlDetailed(xml).removedAnnotations).toBe(1)
    expect(show(parseMathMlDetailed(xml).root)).toBe('<mml:math><mml:mi>x</mml:mi></mml:math>')
  })

  it('其他注释原样保留：非 TeX 编码的 annotation / annotation-xml、没有 encoding 的 annotation；此时 semantics 不展开', () => {
    const source = `<math ${NS}><semantics><mi>x</mi><annotation encoding="MathML-Content">c</annotation><annotation-xml encoding="MathML-Content"><ci>x</ci></annotation-xml></semantics></math>`
    const parsed = parseMathMlDetailed(source)
    expect(parsed.removedAnnotations).toBe(0)
    expect(show(parsed.root)).toBe('<mml:math><mml:semantics><mml:mi>x</mml:mi><mml:annotation encoding="MathML-Content">c</mml:annotation><mml:annotation-xml encoding="MathML-Content"><mml:ci>x</mml:ci></mml:annotation-xml></mml:semantics></mml:math>')
    expect(parse(`<math ${NS}><semantics><mi>x</mi><annotation>无编码</annotation></semantics></math>`)).toContain('<mml:annotation>无编码</mml:annotation>')
  })

  it('混合：TeX 注释被去掉、另一条注释保留，semantics 仍有两个子元素，不展开', () => {
    const source = `<math ${NS}><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation><annotation encoding="text/plain">ex</annotation></semantics></math>`
    expect(parse(source)).toBe('<mml:math><mml:semantics><mml:mi>x</mml:mi><mml:annotation encoding="text/plain">ex</mml:annotation></mml:semantics></mml:math>')
  })

  it('嵌套的 semantics 自底向上展开；根下没有 semantics 的公式不受影响', () => {
    const source = `<math ${NS}><mrow><semantics><semantics><mi>a</mi><annotation encoding="TeX">a</annotation></semantics><annotation encoding="TeX">a</annotation></semantics><mo>+</mo><mi>b</mi></mrow></math>`
    const parsed = parseMathMlDetailed(source)
    expect(parsed.removedAnnotations).toBe(2)
    expect(show(parsed.root)).toBe('<mml:math><mml:mrow><mml:mi>a</mml:mi><mml:mo>+</mml:mo><mml:mi>b</mml:mi></mml:mrow></mml:math>')
    expect(parseMathMlDetailed(`<mml:math><mml:mi>x</mml:mi></mml:math>`).removedAnnotations).toBe(0)
  })

  it('[M-7.4-14] [M-7.4-15] tex-math 与 alternatives 不在 MathML 命名空间（STS 元素），解析器拒绝；输出绝不含它们', () => {
    expect(failure('<mml:math><tex-math>x</tex-math></mml:math>').reason).toContain('没有命名空间')
    expect(failure('<mml:math><alternatives><mml:mi>x</mml:mi></alternatives></mml:math>').reason).toContain('<alternatives>')
  })
})

describe('拒绝的写法（mathml-invalid）', () => {
  it('DOCTYPE 与实体声明（<!ENTITY …>、内部子集）', () => {
    expect(failure('<!DOCTYPE math><mml:math><mml:mi>x</mml:mi></mml:math>').reason).toContain('DOCTYPE')
    expect(failure('<!DOCTYPE math [<!ENTITY a "b">]><mml:math><mml:mi>&a;</mml:mi></mml:math>').reason).toContain('DOCTYPE')
    expect(failure('<mml:math><!ENTITY a "b"><mml:mi>x</mml:mi></mml:math>').reason).toContain('声明')
    expect(failure('<mml:math><!ELEMENT a ANY></mml:math>').reason).toContain('声明')
  })

  it('处理指令（含 XML 声明）', () => {
    expect(failure('<?xml version="1.0"?><mml:math/>').reason).toContain('处理指令')
    expect(failure('<mml:math><?php echo 1 ?></mml:math>').reason).toContain('处理指令')
  })

  it('命名实体（&InvisibleTimes;、&nbsp;）与裸 &、没有分号的引用', () => {
    for (const bad of ['&InvisibleTimes;', '&nbsp;', '&Amp;']) {
      const error = failure(`<mml:math><mml:mo>${bad}</mml:mo></mml:math>`)
      expect(error.reason).toContain('命名实体')
      expect(error.reason).toContain(bad)
    }
    expect(failure('<mml:math><mml:mo>a & b</mml:mo></mml:math>').reason).toContain('&')
    expect(failure('<mml:math><mml:mo>&amp</mml:mo></mml:math>').reason).toContain('分号')
    expect(failure('<mml:math alttext="&copy;"/>').reason).toContain('命名实体')
  })

  it('非法的数字字符引用：&#0;、代理项 &#xD800;、超出范围 &#x110000;、&#x;', () => {
    for (const bad of ['&#0;', '&#xD800;', '&#x110000;', '&#1;']) expect(failure(`<mml:math><mml:mo>${bad}</mml:mo></mml:math>`).reason, bad).toContain('不是合法的 XML 字符')
    expect(failure('<mml:math><mml:mo>&#x;</mml:mo></mml:math>').reason).toContain('不是合法的 XML 字符')
  })

  it('事件属性 on*（V-10）：onclick、ONLOAD、带命名空间的 xlink:onclick、任何以 on 开头的属性名', () => {
    for (const attr of ['onclick="a()"', 'ONLOAD="a()"', 'onmouseover=\'a()\'', 'xlink:onclick="a()"']) {
      expect(failure(`<mml:math><mml:mi ${attr}>x</mml:mi></mml:math>`).reason, attr).toContain('事件属性')
    }
    expect(failure('<mml:math onclick="x"/>').reason).toContain('onclick')
  })

  it('href/src/altimg 的危险协议（V-11）：javascript:、data:、vbscript:（大小写与空白变体），以及含控制字符的取值（java&#9;script:）', () => {
    for (const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
      for (const attr of ['href', 'altimg', 'src', 'xlink:href']) {
        expect(failure(`<mml:math ${attr}="${value}"/>`).reason, `${attr}=${value}`).toMatch(/协议/)
      }
    }
    expect(failure('<mml:math href="java&#9;script:alert(1)"/>').reason).toContain('控制字符')
    expect(failure('<mml:math altimg="a&#10;b"/>').reason).toContain('控制字符')
  })

  it('允许的 URL：相对地址、片段、http、https、mailto、ftp', () => {
    for (const value of ['#eq1', 'figures/x.png', 'http://example.org/a', 'https://example.org/', 'mailto:a@b.cn', 'ftp://example.org/x']) {
      expect(() => parseMathMl(`<mml:math href="${value}"><mml:mi>x</mml:mi></mml:math>`), value).not.toThrow()
    }
  })

  it('[M-7.4-12] 无前缀且无默认命名空间的 MathML 元素（7.4 示例 p30 的 <mtext>,或</mtext> 笔误）、非 MathML 命名空间的元素、未声明的前缀', () => {
    expect(failure('<mml:math><mtext>,或</mtext></mml:math>').reason).toContain('<mtext>')
    expect(failure('<mml:math><mtext>,或</mtext></mml:math>').reason).toContain('没有命名空间')
    expect(failure('<math xmlns="http://www.w3.org/1999/xhtml"><mi>x</mi></math>').reason).toContain('不在 MathML 命名空间')
    expect(failure('<mml:math xmlns:s="http://www.w3.org/2000/svg"><s:svg/></mml:math>').reason).toContain('<s:svg>')
    expect(failure('<foo:math><foo:mi>x</foo:mi></foo:math>').reason).toContain('前缀 foo 没有声明')
  })

  it('根元素必须是 math；不接受根为其他 MathML 元素、没有根、多个根', () => {
    expect(failure('<mml:mi>x</mml:mi>').reason).toContain('根元素必须是 math')
    expect(failure('').reason).toContain('没有找到根元素')
    expect(failure('  <!-- 仅注释 -->  ').reason).toContain('没有找到根元素')
    expect(failure('<mml:math/><mml:math/>').reason).toContain('根元素之后')
  })

  it('命名空间属性：只接受 xlink 与 xml；其他命名空间的属性、未声明前缀的属性拒绝', () => {
    expect(failure('<mml:math xmlns:x="urn:other" x:a="1"/>').reason).toContain('不受支持的命名空间')
    expect(failure('<mml:math y:a="1"/>').reason).toContain('前缀 y 没有声明')
  })

  it('命名空间声明的合法性：不得声明 xmlns 前缀、xml 前缀只能绑定 XML 命名空间、前缀不能绑定到空 URI 或保留 URI', () => {
    expect(failure('<mml:math xmlns:xmlns="urn:x"/>').reason).toContain('xmlns')
    expect(failure('<mml:math xmlns:xml="urn:x"/>').reason).toContain('xml 前缀')
    expect(failure('<mml:math xmlns:p=""/>').reason).toContain('不能为空')
    expect(failure('<mml:math xmlns:p="http://www.w3.org/2000/xmlns/"/>').reason).toContain('保留值')
  })

  it('良构性：结束标签不匹配、没有结束标签、多余的结束标签、文本在根元素之外', () => {
    expect(failure('<mml:math><mml:mi>x</mml:mn></mml:math>').reason).toContain('不匹配')
    expect(failure('<mml:math><mml:mi>x</mml:mi>').reason).toContain('没有结束标签')
    expect(failure('<mml:math/></mml:math>').reason).toContain('多余的结束标签')
    expect(failure('x<mml:math/>').reason).toContain('根元素之前')
    expect(failure('<mml:math/>x').reason).toContain('根元素之后')
    expect(failure('<mml:math><mml:mi>x').reason).toContain('没有结束标签')
  })

  it('良构性：属性——重复、命名空间展开后同名、无引号、缺 =、值里含 <、属性之间缺空白、非法名称', () => {
    expect(failure('<mml:math a="1" a="2"/>').reason).toContain('重复')
    expect(() => parseMathMl('<mml:math xmlns:p="urn:x" xmlns:q="urn:x"/>')).not.toThrow() // 两个前缀绑定同一 URI 本身合法
    expect(failure(`<mml:math xlink:href="#a" xmlns:l="${XLINK_NS}" l:href="#b"/>`).reason).toContain('重复')
    expect(failure('<mml:math a=1/>').reason).toContain('引号')
    expect(failure('<mml:math a/>').reason).toContain('缺少 =')
    expect(failure('<mml:math a="<"/>').reason).toContain('<')
    expect(failure('<mml:math a="1"b="2"/>').reason).toContain('空白')
    expect(failure('<mml:math 1a="1"/>').reason).toContain('不是合法的 XML 名称')
    expect(failure('<mml:math a="1').reason).toContain('结束引号')
  })

  it('良构性：非法的元素名、未结束的标签、/ 之后不是 >', () => {
    expect(failure('<1math/>').reason).toContain('不是合法的 XML 名称')
    expect(failure('<mml:math').reason).toContain('没有以 > 结束')
    expect(failure('<mml:math / >').reason).toContain('/ 之后')
  })

  it('良构性：注释内的 --、未结束的注释与 CDATA、文本里的 ]]>、CDATA 在元素外、XML 不允许的控制字符', () => {
    expect(failure('<mml:math><!-- a -- b --></mml:math>').reason).toContain('--')
    expect(failure('<mml:math><!-- a').reason).toContain('注释没有结束')
    expect(failure('<mml:math><![CDATA[a</mml:math>').reason).toContain('CDATA 没有结束')
    expect(failure('<![CDATA[a]]><mml:math/>').reason).toContain('CDATA 只能出现在元素内')
    expect(failure('<mml:math><mml:mo>a]]>b</mml:mo></mml:math>').reason).toContain(']]>')
    expect(failure('<mml:math><mml:mo>a\u0001b</mml:mo></mml:math>').reason).toContain('U+0001')
    expect(failure('<mml:math alttext="\u0002"/>').reason).toContain('U+0002')
    expect(failure('<mml:math><mml:mo>\ud800</mml:mo></mml:math>').reason).toContain('U+D800')
  })

  it('嵌套深度上限 256：更深的输入给出明确错误，不会让后续递归栈溢出；恰好 256 层可以', () => {
    const nest = (depth: number): string => `<mml:math>${'<mml:mrow>'.repeat(depth - 1)}${'</mml:mrow>'.repeat(depth - 1)}</mml:math>`
    expect(() => parseMathMl(nest(256))).not.toThrow()
    expect(failure(nest(257)).reason).toContain('256')
  })
})

describe('错误位置', () => {
  it('错误带字符偏移与从 1 起的行列：多行输入的位置落在出错的标签上', () => {
    const error = failure('<mml:math>\n  <mml:mi>x</mml:mn>\n</mml:math>')
    expect(error.line).toBe(2)
    expect(error.column).toBe(12)
    expect(error.offset).toBe('<mml:math>\n  <mml:mi>x'.length)
    expect(error.message).toBe(`${error.reason}（第 2 行第 12 列，字符偏移 ${error.offset}）`)
  })

  it('CRLF 输入的行号按归一化后的换行计；单行输入第 1 行', () => {
    expect(failure('<mml:math>\r\n<mml:mo>&nbsp;</mml:mo></mml:math>').line).toBe(2)
    expect(failure('<mml:math><mml:mo>&nbsp;</mml:mo></mml:math>')).toMatchObject({ line: 1, column: 19 })
  })

  it('命名实体的位置指向 & 本身；属性错误的位置指向属性名', () => {
    expect(failure('<mml:math><mml:mo>ab&nbsp;</mml:mo></mml:math>').offset).toBe('<mml:math><mml:mo>ab'.length)
    expect(failure('<mml:math a="1" onclick="x"/>').offset).toBe('<mml:math a="1" '.length)
  })
})

describe('输出可写（与写出器的契约）', () => {
  it('解析结果写出时命名空间前缀 mml 由根上的声明承担；xlink:href 属性用 xlink 前缀', () => {
    const root = parseMathMl(`<m:math xmlns:m="${MATHML_NS}" xmlns:l="${XLINK_NS}" l:href="#a"><m:mi>x</m:mi></m:math>`)
    const text = writeXml({ root }, { namespaces: XML46687_NAMESPACES, indent: null, preserveSpace })
    expect(text).toContain(' xlink:href="#a"><mml:mi>x</mml:mi></mml:math>')
    expect(text).toMatch(/^<\?xml[^>]*\?>\n<mml:math xmlns:mml="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/)
  })

  it('解析不修改输入字符串，同一输入多次解析结果相等', () => {
    const source = `<math ${NS}><semantics><mi>x</mi><annotation encoding="TeX">x</annotation></semantics></math>`
    const first = parseMathMl(source)
    expect(parseMathMl(source)).toEqual(first)
    expect(source).toContain('annotation')
  })
})

describe('鲁棒性：任意截断/替换/删除字符后只会成功或抛 MathMlParseError', () => {
  const sample = `<math ${NS} display="block"><semantics><mrow><mi mathvariant="italic">x</mi><mo>&#x2264;</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mspace width="1em"/></mrow>`
    + `<annotation encoding="application/x-tex">x\\le\\frac12</annotation></semantics><!-- c --></math>`

  it('逐位截断、删除、换成特殊字符：不抛其他类型的异常（无 TypeError、无无限循环）', () => {
    const specials = ['<', '>', '&', '"', "'", '/', '=', ' ', ':', ';', '\u0001', '\ud800']
    for (let index = 0; index <= sample.length; index += 1) {
      const variants = [sample.slice(0, index), sample.slice(0, index) + sample.slice(index + 1), ...specials.map((char) => sample.slice(0, index) + char + sample.slice(index + 1))]
      for (const variant of variants) {
        try {
          parseMathMl(variant)
        } catch (error) {
          expect(error, JSON.stringify(variant)).toBeInstanceOf(MathMlParseError)
          expect((error as MathMlParseError).offset).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

/** 遍历计数辅助：确认规范化后树里没有 annotation / semantics 元素。 */
function names(node: XmlNode, out: string[] = []): string[] {
  if (node.type === 'element') { out.push(node.name.local); node.children.forEach((child) => names(child, out)) }
  return out
}

describe('KaTeX 风格的真实输入', () => {
  it('KaTeX 输出的 <math xmlns=…><semantics><mrow>…</mrow><annotation encoding="application/x-tex">…</annotation></semantics></math> 规范化后只剩 mrow 内容，无 annotation / semantics', () => {
    const katexOutput = `<math xmlns="${MATHML_NS}"><semantics><mrow><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">\\frac{1}{2}+x^{2}</annotation></semantics></math>`
    const root = parseMathMl(katexOutput)
    expect(names(root)).toEqual(['math', 'mrow', 'mfrac', 'mn', 'mn', 'mo', 'msup', 'mi', 'mn'])
  })
})
