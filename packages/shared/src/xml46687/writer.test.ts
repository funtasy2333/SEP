import { describe, expect, it } from 'vitest'
import {
  MATHML_NS,
  XLINK_NS,
  qname,
  xmlAttr,
  xmlComment,
  xmlElement,
  xmlPi,
  xmlText,
  type XmlDocument,
  type XmlElement,
  type XmlNode,
} from './tree'
import { XmlWriteError, writeXml, type XmlWriteOptions } from './writer'

const DECL = '<?xml version="1.0" encoding="UTF-8"?>'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const NONE: XmlWriteOptions = { namespaces: {} }

const doc = (root: XmlElement): XmlDocument => ({ root })
const write = (root: XmlElement, options: XmlWriteOptions = NONE): string => writeXml(doc(root), options)
const body = (root: XmlElement, options: XmlWriteOptions = NONE): string => {
  const out = write(root, options)
  expect(out.startsWith(`${DECL}\n`)).toBe(true)
  expect(out.endsWith('\n')).toBe(true)
  return out.slice(DECL.length + 1, -1)
}
function thrown(fn: () => unknown): XmlWriteError {
  try { fn() } catch (error) {
    expect(error).toBeInstanceOf(XmlWriteError)
    return error as XmlWriteError
  }
  throw new Error('期望抛出 XmlWriteError，但没有抛出')
}

describe('writeXml 基础输出', () => {
  it('以 XML 声明开头，每个顶层部分独占一行并以换行结尾', () => {
    expect(write(xmlElement('a'))).toBe(`${DECL}\n<a/>\n`)
  })

  it('空元素输出 <x/>，空字符串文本节点不产生内容', () => {
    expect(body(xmlElement('x'))).toBe('<x/>')
    expect(body(xmlElement('x', [], [xmlText('')]))).toBe('<x/>')
    expect(body(xmlElement('x', [], [xmlText(''), xmlText('')]), { namespaces: {}, indent: null })).toBe('<x/>')
  })

  it('文本转义 & < >，]]> 安全，CR 以字符引用保留，LF 与 TAB 原样', () => {
    expect(body(xmlElement('t', [], ['a&b<c>d ]]> e\r\nf\tg "q" \'s\'']))).toBe(
      '<t>a&amp;b&lt;c&gt;d ]]&gt; e&#13;\nf\tg "q" \'s\'</t>',
    )
    // 看似 CDATA 的文本只是普通文本
    expect(body(xmlElement('t', [], ['<![CDATA[x]]>']))).toBe('<t>&lt;![CDATA[x]]&gt;</t>')
  })

  it('属性转义 & < > " 以及 TAB/LF/CR 用字符引用，单引号原样', () => {
    expect(body(xmlElement('a', [xmlAttr('v', 'a&b<c>d"e\tf\ng\rh\'i')]))).toBe(
      '<a v="a&amp;b&lt;c&gt;d&quot;e&#9;f&#10;g&#13;h\'i"/>',
    )
  })

  it('属性按 attrs 数组顺序输出，不重排', () => {
    expect(body(xmlElement('a', [xmlAttr('z', '1'), xmlAttr('a', '2'), xmlAttr('m', '3')]))).toBe('<a z="1" a="2" m="3"/>')
  })

  it('合法的边界字符原样写出（含代理对）', () => {
    const valid = '\t\n \uD7FF\uE000\uFFFD\u{10000}\u{10FFFF}😀'
    const out = body(xmlElement('a', [xmlAttr('v', '\u{1F600}')], [valid]), { namespaces: {}, indent: null })
    expect(out).toContain('\u{10000}\u{10FFFF}😀')
    expect(out).toContain('v="\u{1F600}"')
  })
})

describe('writeXml 非法字符', () => {
  const illegal = [0x0, 0x1, 0x8, 0xb, 0xc, 0xe, 0x1f, 0xfffe, 0xffff]
  it.each(illegal)('文本中的码点 %i 抛 XmlWriteError，信息含元素路径', (code) => {
    const root = xmlElement('standard', [], [xmlElement('body', [], [xmlElement('p', [], [`a${String.fromCharCode(code)}b`])])])
    const error = thrown(() => write(root))
    expect(error.path).toBe('/standard[1]/body[1]/p[1]/text()[1]')
    expect(error.message).toContain('/standard[1]/body[1]/p[1]/text()[1]')
    expect(error.message).toContain(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
  })

  it('孤立的高、低代理项抛错；成对的代理项合法', () => {
    expect(() => write(xmlElement('a', [], ['\uD800']))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [], ['x\uDC00']))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [], ['\uD800x']))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [], ['􏿿']))).not.toThrow()
  })

  it('属性值、注释、处理指令数据、DOCTYPE、命名空间 URI 中的非法字符同样抛错并带路径', () => {
    const attrError = thrown(() => write(xmlElement('a', [], [xmlElement('b', [xmlAttr('v', 'x\u0001')])])))
    expect(attrError.path).toBe('/a[1]/b[1]/@v')
    expect(thrown(() => write(xmlElement('a', [], [xmlComment('x\u0002')]))).path).toBe('/a[1]/comment()[1]')
    expect(thrown(() => write(xmlElement('a', [], [xmlPi('t', 'x\u0003')]))).path).toBe("/a[1]/processing-instruction('t')[1]")
    expect(() => writeXml({ doctype: { name: 'a', systemId: 'x\u0004.dtd' }, root: xmlElement('a') }, NONE)).toThrow(XmlWriteError)
    expect(() => write(xmlElement(qname('urn:x\u0005', 'a')), { namespaces: { '': 'urn:x\u0005' } })).toThrow(XmlWriteError)
  })
})

describe('writeXml 命名空间', () => {
  const options: XmlWriteOptions = {
    namespaces: { xlink: XLINK_NS, mml: MATHML_NS, '': 'urn:default', ali: 'urn:ali' },
  }

  it('全部在根元素声明：默认命名空间最先，其余按前缀字典序，未使用的也声明', () => {
    expect(body(xmlElement(qname('urn:default', 'root')), options)).toBe(
      `<root xmlns="urn:default" xmlns:ali="urn:ali" xmlns:mml="${MATHML_NS}" xmlns:xlink="${XLINK_NS}"/>`,
    )
  })

  it('声明顺序与 namespaces 字典的书写顺序无关', () => {
    const a = body(xmlElement(qname('urn:default', 'r')), { namespaces: { b: 'urn:b', a: 'urn:a', '': 'urn:default' } })
    const b = body(xmlElement(qname('urn:default', 'r')), { namespaces: { '': 'urn:default', a: 'urn:a', b: 'urn:b' } })
    expect(a).toBe(b)
    expect(a).toBe('<r xmlns="urn:default" xmlns:a="urn:a" xmlns:b="urn:b"/>')
  })

  it('命名空间声明写在根元素属性之前；非根元素不再声明', () => {
    const root = xmlElement(qname(null, 'root'), [xmlAttr('id', 'r')], [xmlElement(qname(MATHML_NS, 'math', 'mml'), [], ['x'])])
    expect(body(root, { namespaces: { mml: MATHML_NS }, indent: null })).toBe(
      `<root xmlns:mml="${MATHML_NS}" id="r"><mml:math>x</mml:math></root>`,
    )
  })

  it('元素使用未声明的命名空间抛错，信息含元素路径', () => {
    const root = xmlElement('a', [], [xmlElement(qname(MATHML_NS, 'math', 'mml'))])
    const error = thrown(() => write(root, { namespaces: { xlink: XLINK_NS } }))
    expect(error.path).toBe('/a[1]/math[1]')
    expect(error.message).toContain(MATHML_NS)
  })

  it('属性使用未声明的命名空间抛错', () => {
    const root = xmlElement('a', [xmlAttr(qname(XLINK_NS, 'href', 'xlink'), 'x')])
    const error = thrown(() => write(root, { namespaces: { mml: MATHML_NS } }))
    expect(error.path).toBe('/a[1]/@href')
  })

  it('属性无前缀即无命名空间：命名空间属性不能借用默认命名空间', () => {
    const root = xmlElement(qname('urn:d', 'a'), [xmlAttr(qname('urn:d', 'x'), '1')])
    expect(() => write(root, { namespaces: { '': 'urn:d' } })).toThrow(XmlWriteError)
    expect(body(xmlElement(qname('urn:d', 'a'), [xmlAttr('x', '1')]), { namespaces: { '': 'urn:d' } })).toBe('<a xmlns="urn:d" x="1"/>')
  })

  it('前缀提示匹配时使用；不匹配则忽略；无提示时默认命名空间优先、其次字典序最小', () => {
    const shared = { namespaces: { b: 'urn:s', a: 'urn:s', '': 'urn:s' } }
    expect(body(xmlElement(qname('urn:s', 'e', 'b')), shared)).toContain('<b:e')
    expect(body(xmlElement(qname('urn:s', 'e', 'zz')), shared)).toMatch(/^<e /)
    expect(body(xmlElement(qname('urn:s', 'e')), shared)).toMatch(/^<e /)
    const noDefault = { namespaces: { b: 'urn:s', a: 'urn:s' } }
    expect(body(xmlElement(qname('urn:s', 'e')), noDefault)).toMatch(/^<a:e /)
    expect(body(xmlElement(qname('urn:s', 'e', 'b')), noDefault)).toMatch(/^<b:e /)
    // 属性不能用默认前缀，提示为 '' 时也只能落到非空前缀
    expect(body(xmlElement(qname('urn:s', 'r'), [xmlAttr(qname('urn:s', 'x', ''), '1')]), shared)).toContain(' a:x="1"')
  })

  it('声明了默认命名空间时，无命名空间元素无法表示，抛错', () => {
    expect(() => write(xmlElement(qname('urn:d', 'a'), [], [xmlElement('plain')]), { namespaces: { '': 'urn:d' } })).toThrow(XmlWriteError)
    expect(() => write(xmlElement('plain'), { namespaces: { '': 'urn:d' } })).toThrow(XmlWriteError)
  })

  it('xml 前缀是内建的：xml:lang 无需声明，也不会输出 xmlns:xml', () => {
    const root = xmlElement('a', [xmlAttr(qname(XML_NAMESPACE, 'lang', 'xml'), 'zh')])
    expect(body(root)).toBe('<a xml:lang="zh"/>')
    expect(body(root, { namespaces: { xml: XML_NAMESPACE } })).toBe('<a xml:lang="zh"/>')
  })

  it('保留的前缀与 URI 被拒绝：xmlns、xml 绑定错误 URI、他前缀绑定 xml 命名空间、空 URI、非法前缀', () => {
    const root = xmlElement('a')
    expect(() => write(root, { namespaces: { xmlns: 'urn:x' } })).toThrow(XmlWriteError)
    expect(() => write(root, { namespaces: { xml: 'urn:x' } })).toThrow(XmlWriteError)
    expect(() => write(root, { namespaces: { x: XML_NAMESPACE } })).toThrow(XmlWriteError)
    expect(() => write(root, { namespaces: { x: 'http://www.w3.org/2000/xmlns/' } })).toThrow(XmlWriteError)
    expect(() => write(root, { namespaces: { x: '' } })).toThrow(XmlWriteError)
    expect(() => write(root, { namespaces: { '': '' } })).toThrow(XmlWriteError)
    expect(() => write(root, { namespaces: { '1x': 'urn:x' } })).toThrow(XmlWriteError)
    expect(() => write(root, { namespaces: { 'a:b': 'urn:x' } })).toThrow(XmlWriteError)
  })

  it('元素与属性的本地名必须是合法 NCName；不得手写 xmlns 属性', () => {
    for (const local of ['', 'a b', '1a', 'a:b', '-a', 'a<b']) {
      expect(() => write(xmlElement(qname(null, local)))).toThrow(XmlWriteError)
      expect(() => write(xmlElement('a', [xmlAttr(qname(null, local), 'v')]))).toThrow(XmlWriteError)
    }
    expect(() => write(xmlElement('a', [xmlAttr('xmlns', 'urn:x')]))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [xmlAttr(qname('http://www.w3.org/2000/xmlns/', 'x', 'xmlns'), 'urn:x')]), { namespaces: {} })).toThrow(XmlWriteError)
    // 非 ASCII 的合法名称
    expect(body(xmlElement('标准', [xmlAttr('属性', '1')]))).toBe('<标准 属性="1"/>')
    expect(body(xmlElement('_a-b.c1'))).toBe('<_a-b.c1/>')
  })

  it('MathML 与 XLink 的典型用法', () => {
    const root = xmlElement('p', [], [
      '见',
      xmlElement(qname(null, 'ext-link'), [xmlAttr(qname(XLINK_NS, 'href', 'xlink'), 'https://example.org/?a=1&b=2')], ['链接']),
      xmlElement(qname(MATHML_NS, 'math', 'mml'), [], [xmlElement(qname(MATHML_NS, 'mi', 'mml'), [], ['x'])]),
    ])
    expect(body(root, { namespaces: { xlink: XLINK_NS, mml: MATHML_NS }, indent: null })).toBe(
      `<p xmlns:mml="${MATHML_NS}" xmlns:xlink="${XLINK_NS}">见<ext-link xlink:href="https://example.org/?a=1&amp;b=2">链接</ext-link><mml:math><mml:mi>x</mml:mi></mml:math></p>`,
    )
  })
})

describe('writeXml 重复属性', () => {
  it('同一元素 ns+local 相同的属性抛错，信息含属性路径', () => {
    const root = xmlElement('a', [], [xmlElement('b', [xmlAttr('id', '1'), xmlAttr('id', '2')])])
    const error = thrown(() => write(root))
    expect(error.path).toBe('/a[1]/b[1]/@id')
  })

  it('命名空间属性重复也抛错（即便前缀提示不同）', () => {
    const root = xmlElement('a', [
      xmlAttr(qname(XLINK_NS, 'href', 'x1'), '1'),
      xmlAttr(qname(XLINK_NS, 'href', 'x2'), '2'),
    ])
    expect(() => write(root, { namespaces: { x1: XLINK_NS, x2: XLINK_NS } })).toThrow(XmlWriteError)
  })

  it('local 相同但 ns 不同不算重复', () => {
    const root = xmlElement('a', [xmlAttr('href', '1'), xmlAttr(qname(XLINK_NS, 'href', 'xlink'), '2')])
    expect(body(root, { namespaces: { xlink: XLINK_NS } })).toBe(`<a xmlns:xlink="${XLINK_NS}" href="1" xlink:href="2"/>`)
  })
})

describe('writeXml 缩进', () => {
  it('默认两个空格；纯元素内容逐级缩进，空元素自闭合', () => {
    const root = xmlElement('standard', [], [
      xmlElement('front', [], [xmlElement('title', [], ['题名'])]),
      xmlElement('body', [], [xmlElement('sec', [xmlAttr('id', 's1')], [xmlElement('p', [], ['正文'])]), xmlElement('sec')]),
    ])
    expect(body(root)).toBe([
      '<standard>',
      '  <front>',
      '    <title>题名</title>',
      '  </front>',
      '  <body>',
      '    <sec id="s1">',
      '      <p>正文</p>',
      '    </sec>',
      '    <sec/>',
      '  </body>',
      '</standard>',
    ].join('\n'))
  })

  it('自定义缩进字符串；空串表示逐行但不缩进', () => {
    const root = xmlElement('a', [], [xmlElement('b', [], [xmlElement('c')])])
    expect(body(root, { namespaces: {}, indent: '\t' })).toBe('<a>\n\t<b>\n\t\t<c/>\n\t</b>\n</a>')
    expect(body(root, { namespaces: {}, indent: '' })).toBe('<a>\n<b>\n<c/>\n</b>\n</a>')
  })

  it('indent: null 不插入任何缩进或换行（顶层声明与结尾换行除外），且保留空白文本节点', () => {
    const root = xmlElement('a', [], [' ', xmlElement('b', [], [xmlElement('c')]), '\n  ', xmlElement('d')])
    expect(body(root, { namespaces: {}, indent: null })).toBe('<a> <b><c/></b>\n  <d/></a>')
  })

  it('缩进字符串只能由空格与制表符组成', () => {
    expect(() => write(xmlElement('a'), { namespaces: {}, indent: 'x' })).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a'), { namespaces: {}, indent: '\n' })).toThrow(XmlWriteError)
  })

  it('混合内容不被改变：含文本节点的元素内部原样串联，其后代也不缩进', () => {
    const root = xmlElement('body', [], [
      xmlElement('p', [], [
        '开头', xmlElement('b', [], [xmlElement('i', [], ['粗斜']), xmlElement('u')]), ' 中间 ', xmlComment('c'), xmlElement('x'), '结尾',
      ]),
      xmlElement('p', [], [xmlElement('b', [], ['只有元素'])]),
    ])
    expect(body(root)).toBe([
      '<body>',
      '  <p>开头<b><i>粗斜</i><u/></b> 中间 <!--c--><x/>结尾</p>',
      '  <p>',
      '    <b>只有元素</b>',
      '  </p>',
      '</body>',
    ].join('\n'))
  })

  it('任一非空文本节点即视为混合内容，即使它位于元素之后或是 NBSP', () => {
    expect(body(xmlElement('p', [], [xmlElement('a'), xmlElement('b'), 'z']))).toBe('<p><a/><b/>z</p>')
    expect(body(xmlElement('p', [], [xmlElement('a'), '\u00A0', xmlElement('b')]))).toBe('<p><a/>\u00A0<b/></p>')
  })

  it('行内元素之间的仅空白文本是内容：缩进模式下原样保留，不丢失也不被换行替代', () => {
    const root = xmlElement('body', [], [xmlElement('p', [], [xmlElement('b', [], ['a']), ' ', xmlElement('i', [], ['b'])])])
    expect(body(root)).toBe('<body>\n  <p><b>a</b> <i>b</i></p>\n</body>')
    // 制表、换行、回车同样保留（CR 以字符引用写出）
    expect(body(xmlElement('p', [], [xmlElement('b'), ' \t\r\n', xmlElement('i')]))).toBe('<p><b/> \t&#13;\n<i/></p>')
  })

  it('含仅空白文本的元素整体原样串联，其后代不缩进；不含文本节点的祖先仍缩进', () => {
    const root = xmlElement('root', [], [
      xmlElement('a', [], ['\n  ', xmlElement('b'), ' \t', xmlElement('c', [], [xmlElement('d'), xmlElement('e')]), '\n']),
      xmlElement('f', [], [xmlElement('g')]),
    ])
    expect(body(root)).toBe('<root>\n  <a>\n  <b/> \t<c><d/><e/></c>\n</a>\n  <f>\n    <g/>\n  </f>\n</root>')
  })

  it('已排版的树（如解析自缩进过的源文件）写出后保持原样，不改动其中的空白', () => {
    const root = xmlElement('a', [], ['\n  ', xmlElement('b', [], ['\n    ', xmlElement('c'), '\n  ']), '\n'])
    expect(body(root)).toBe('<a>\n  <b>\n    <c/>\n  </b>\n</a>')
    expect(body(root, { namespaces: {}, indent: null })).toBe('<a>\n  <b>\n    <c/>\n  </b>\n</a>')
  })

  it('只含文本的元素（包括仅空白文本）不做布局，文本原样保留', () => {
    expect(body(xmlElement('a', [], [xmlElement('b', [], ['  ']), xmlElement('c', [], [' x ']), xmlElement('d', [], ['\n'])]))).toBe(
      '<a>\n  <b>  </b>\n  <c> x </c>\n  <d>\n</d>\n</a>',
    )
  })

  it('preserveSpace 返回 true 的元素及其后代即使不含文本也不缩进，自身仍按父级布局缩进', () => {
    const calls: string[] = []
    const root = xmlElement('a', [], [
      xmlElement('pre', [], [xmlElement('b', [], [xmlElement('c'), xmlElement('d')])]),
      xmlElement('other', [], [xmlElement('pre', [], [xmlElement('x'), xmlElement('y')]), xmlElement('z')]),
    ])
    const out = body(root, {
      namespaces: {},
      preserveSpace: (el) => { calls.push(el.name.local); return el.name.local === 'pre' },
    })
    expect(out).toBe([
      '<a>',
      '  <pre><b><c/><d/></b></pre>',
      '  <other>',
      '    <pre><x/><y/></pre>',
      '    <z/>',
      '  </other>',
      '</a>',
    ].join('\n'))
    // 判定函数只对仍可缩进的元素调用，保留空白区域内部不再询问
    expect(calls).toEqual(['a', 'pre', 'other', 'pre', 'z'])
  })

  it('preserveSpace 不影响不缩进模式；缺省时不起作用', () => {
    const root = xmlElement('a', [], [xmlElement('b')])
    expect(body(root, { namespaces: {}, indent: null, preserveSpace: () => true })).toBe('<a><b/></a>')
    expect(body(root, { namespaces: {} })).toBe('<a>\n  <b/>\n</a>')
  })
})

describe('writeXml 注释与处理指令', () => {
  it('纯元素内容中注释、处理指令各占一行；混合内容中原样', () => {
    const root = xmlElement('a', [], [xmlComment(' 注 '), xmlPi('xml-stylesheet', 'href="a.css"'), xmlElement('b'), xmlPi('empty', '')])
    expect(body(root)).toBe('<a>\n  <!-- 注 -->\n  <?xml-stylesheet href="a.css"?>\n  <b/>\n  <?empty?>\n</a>')
    expect(body(xmlElement('p', [], ['x', xmlComment('c'), xmlPi('t', 'd')]))).toBe('<p>x<!--c--><?t d?></p>')
  })

  it('注释内容含 -- 或以 - 结尾时抛错', () => {
    const error = thrown(() => write(xmlElement('a', [], [xmlComment('x -- y')])))
    expect(error.path).toBe('/a[1]/comment()[1]')
    expect(() => write(xmlElement('a', [], [xmlComment('x-')]))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [], [xmlComment('-')]))).toThrow(XmlWriteError)
    expect(body(xmlElement('a', [], [xmlComment('a-b - c')]))).toBe('<a>\n  <!--a-b - c-->\n</a>')
    expect(body(xmlElement('a', [], [xmlComment('')]))).toBe('<a>\n  <!---->\n</a>')
  })

  it('注释与处理指令数据中的回车（CR、CRLF）抛错：读回时会被规范化为换行，无法无损表示', () => {
    for (const value of ['a\rb', 'a\r\nb', '\r']) {
      const comment = thrown(() => write(xmlElement('a', [], [xmlComment(value)])))
      expect(comment.path).toBe('/a[1]/comment()[1]')
      expect(comment.message).toContain('回车')
      const pi = thrown(() => write(xmlElement('a', [], ['x', xmlPi('t', `d${value}`)])))
      expect(pi.path).toBe("/a[1]/processing-instruction('t')[1]")
      expect(pi.message).toContain('回车')
    }
    // 不含回车的换行照常写出；文本与属性中的回车仍以字符引用保留
    expect(body(xmlElement('a', [], [xmlComment('a\nb')]), { namespaces: {}, indent: null })).toBe('<a><!--a\nb--></a>')
    expect(body(xmlElement('a', [], [xmlPi('t', 'x\ny')]), { namespaces: {}, indent: null })).toBe('<a><?t x\ny?></a>')
    expect(body(xmlElement('a', [xmlAttr('v', 'a\rb')], ['c\rd']), { namespaces: {}, indent: null })).toBe('<a v="a&#13;b">c&#13;d</a>')
  })

  it('处理指令的 target 不得为 xml（任意大小写），且必须是合法名称', () => {
    for (const target of ['xml', 'XML', 'Xml']) expect(() => write(xmlElement('a', [], [xmlPi(target, 'd')]))).toThrow(XmlWriteError)
    for (const target of ['', 'a b', '1a', 'a:b']) expect(() => write(xmlElement('a', [], [xmlPi(target, 'd')]))).toThrow(XmlWriteError)
    expect(body(xmlElement('a', [], [xmlPi('xmlx', 'd')]), { namespaces: {}, indent: null })).toBe('<a><?xmlx d?></a>')
  })

  it('处理指令数据不得含 ?>，且不得以空白开头（否则读回时丢失）', () => {
    expect(() => write(xmlElement('a', [], [xmlPi('t', 'x?>y')]))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [], [xmlPi('t', ' x')]))).toThrow(XmlWriteError)
    expect(body(xmlElement('a', [], [xmlPi('t', 'x ? > y ?')]), { namespaces: {}, indent: null })).toBe('<a><?t x ? > y ??></a>')
  })
})

describe('writeXml DOCTYPE', () => {
  const root = xmlElement('standard')
  const withDoctype = (doctype: XmlDocument['doctype']): string => writeXml({ doctype, root }, NONE)

  it('PUBLIC 标识符：公共标识符与系统标识符都加引号', () => {
    expect(withDoctype({ name: 'standard', publicId: '-//GB//DTD standard 1.0//EN', systemId: 'standard.dtd' })).toBe(
      `${DECL}\n<!DOCTYPE standard PUBLIC "-//GB//DTD standard 1.0//EN" "standard.dtd">\n<standard/>\n`,
    )
  })

  it('仅 SYSTEM 与仅名称', () => {
    expect(withDoctype({ name: 'standard', systemId: 'a.dtd' })).toBe(`${DECL}\n<!DOCTYPE standard SYSTEM "a.dtd">\n<standard/>\n`)
    expect(withDoctype({ name: 'standard' })).toBe(`${DECL}\n<!DOCTYPE standard>\n<standard/>\n`)
  })

  it('系统标识符含双引号时改用单引号；两种引号并存时抛错', () => {
    expect(withDoctype({ name: 's', systemId: 'a"b.dtd' })).toContain("<!DOCTYPE s SYSTEM 'a\"b.dtd'>")
    expect(() => withDoctype({ name: 's', systemId: `a"b'c.dtd` })).toThrow(XmlWriteError)
  })

  it('公共标识符不得缺少系统标识符，且只能含 PubidChar', () => {
    expect(() => withDoctype({ name: 's', publicId: '-//X//EN' })).toThrow(XmlWriteError)
    expect(() => withDoctype({ name: 's', publicId: 'a<b', systemId: 'x.dtd' })).toThrow(XmlWriteError)
    expect(() => withDoctype({ name: 's', publicId: 'a"b', systemId: 'x.dtd' })).toThrow(XmlWriteError)
    expect(() => withDoctype({ name: 's', publicId: '中文', systemId: 'x.dtd' })).toThrow(XmlWriteError)
    // 公共标识符含单引号时必须用双引号，合法
    expect(withDoctype({ name: 's', publicId: "-//A's//EN", systemId: 'x.dtd' })).toContain(`PUBLIC "-//A's//EN" "x.dtd"`)
  })

  it('公共标识符与系统标识符中的回车（CR、CRLF）抛错：读回时会被规范化为换行，无法无损表示', () => {
    for (const value of ['a\rb', 'a\r\nb', '\r']) {
      const publicId = thrown(() => withDoctype({ name: 's', publicId: `-//A${value}//EN`, systemId: 'x.dtd' }))
      expect(publicId.path).toBe('/!DOCTYPE')
      expect(publicId.message).toContain('回车')
      const systemId = thrown(() => withDoctype({ name: 's', systemId: `x${value}.dtd` }))
      expect(systemId.path).toBe('/!DOCTYPE')
      expect(systemId.message).toContain('回车')
      expect(thrown(() => withDoctype({ name: 's', publicId: '-//A//EN', systemId: `x${value}.dtd` })).message).toContain('回车')
    }
    // 不含回车的标识符照常写出
    expect(withDoctype({ name: 's', systemId: 'a\nb.dtd' })).toContain('SYSTEM "a\nb.dtd"')
  })

  it('无法用字符引用保真的其它输出位置同样拒绝回车；可用字符引用的位置保留为 &#13;', () => {
    const compact: XmlWriteOptions = { namespaces: {}, indent: null }
    // 名称类位置：本就必须是合法名称，含回车被拒绝
    expect(() => write(xmlElement(qname(null, 'a\r')))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [xmlAttr(qname(null, 'b\r'), '1')]))).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a', [], [xmlPi('t\r', 'd')]))).toThrow(XmlWriteError)
    expect(() => withDoctype({ name: 's\r' })).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a'), { namespaces: { 'p\r': 'urn:x' } })).toThrow(XmlWriteError)
    expect(() => write(xmlElement('a'), { namespaces: {}, indent: '\r' })).toThrow(XmlWriteError)
    // 文本、属性值、命名空间 URI（均为属性值）可用字符引用，保留为 &#13;
    expect(body(xmlElement(qname('urn:a\rb', 'r'), [xmlAttr('v', 'x\ry')], ['t\r\nu']), { namespaces: { '': 'urn:a\rb' }, indent: null })).toBe(
      '<r xmlns="urn:a&#13;b" v="x&#13;y">t&#13;\nu</r>',
    )
  })

  it('DOCTYPE 名称必须是合法名称；不缩进模式同样换行分隔顶层部分', () => {
    expect(() => withDoctype({ name: 'a b' })).toThrow(XmlWriteError)
    expect(writeXml({ doctype: { name: 'standard', systemId: 'a.dtd' }, root: xmlElement('standard', [], [xmlElement('x')]) }, { namespaces: {}, indent: null })).toBe(
      `${DECL}\n<!DOCTYPE standard SYSTEM "a.dtd">\n<standard><x/></standard>\n`,
    )
  })
})

describe('writeXml 错误路径', () => {
  it('路径形如 /standard[1]/body[1]/sec[3]：按同名兄弟元素计数', () => {
    const root = xmlElement('standard', [], [
      xmlElement('front'),
      xmlElement('body', [], [xmlElement('sec'), xmlElement('sec'), xmlElement('sec', [xmlAttr('bad', 'x\u0001')])]),
    ])
    expect(thrown(() => write(root)).path).toBe('/standard[1]/body[1]/sec[3]/@bad')
  })

  it('ns 不同的同名元素分别计数；使用实际写出的限定名', () => {
    const root = xmlElement('a', [], [
      xmlElement('x'),
      xmlElement(qname(MATHML_NS, 'x', 'mml')),
      xmlElement(qname(MATHML_NS, 'x', 'mml'), [], ['\u0001']),
    ])
    const error = thrown(() => write(root, { namespaces: { mml: MATHML_NS } }))
    expect(error.path).toBe('/a[1]/mml:x[2]/text()[1]')
  })

  it('文本、注释、处理指令按各自类型计数', () => {
    const root = xmlElement('a', [], ['ok', xmlElement('b'), 'ok2', xmlComment('c'), xmlComment('d--')])
    expect(thrown(() => write(root)).path).toBe('/a[1]/comment()[2]')
    expect(thrown(() => write(xmlElement('a', [], ['ok', xmlElement('b'), '\u0001']))).path).toBe('/a[1]/text()[2]')
  })

  it('未知节点类型（运行时数据损坏）抛错', () => {
    const broken = xmlElement('a', [], [{ type: 'cdata', value: 'x' } as unknown as XmlNode])
    expect(thrown(() => write(broken)).path).toBe('/a[1]/node()[1]')
  })

  it('XmlWriteError 是 Error 子类，带 name 与 path 字段', () => {
    const error = thrown(() => write(xmlElement('a', [], ['\u0001'])))
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('XmlWriteError')
    expect(error.path).toBe('/a[1]/text()[1]')
    expect(Object.keys(error)).toContain('path')
  })
})

describe('writeXml 纯函数性质', () => {
  const root = (): XmlElement => xmlElement(qname('urn:d', 'standard'), [xmlAttr('id', 'x')], [
    xmlComment(' c '),
    xmlElement(qname(MATHML_NS, 'math', 'mml'), [], [xmlElement(qname(MATHML_NS, 'mi', 'mml'), [], ['x'])]),
    xmlElement(qname('urn:d', 'p'), [xmlAttr(qname(XLINK_NS, 'href', 'xlink'), '&')], ['混合', xmlElement(qname('urn:d', 'b'), [], ['内容']), '<>']),
  ])
  const options: XmlWriteOptions = { namespaces: { '': 'urn:d', mml: MATHML_NS, xlink: XLINK_NS } }

  it('同一输入两次输出逐字节相同，且不修改输入', () => {
    const input = doc(root())
    const before = JSON.stringify(input)
    const first = writeXml(input, options)
    const second = writeXml(input, options)
    expect(second).toBe(first)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('结构相同的独立构造的树输出相同', () => {
    expect(writeXml(doc(root()), options)).toBe(writeXml(doc(root()), options))
  })

  it('经 JSON 往返后的树输出与原树逐字节相同', () => {
    const input = doc(root())
    const revived = JSON.parse(JSON.stringify(input)) as XmlDocument
    expect(writeXml(revived, options)).toBe(writeXml(input, options))
    expect(writeXml(revived, { ...options, indent: null })).toBe(writeXml(input, { ...options, indent: null }))
  })

  it('position 仅作诊断信息，不影响输出', () => {
    const plain = root()
    const positioned: XmlElement = { ...root(), position: { path: '/standard[1]', line: 3, column: 5 } }
    expect(writeXml(doc(positioned), options)).toBe(writeXml(doc(plain), options))
  })

  it('选项缺省时的缩进为两个空格', () => {
    const input = doc(xmlElement('a', [], [xmlElement('b')]))
    expect(writeXml(input, NONE)).toBe(writeXml(input, { namespaces: {}, indent: '  ' }))
    expect(writeXml(input, NONE)).toBe(`${DECL}\n<a>\n  <b/>\n</a>\n`)
  })
})
