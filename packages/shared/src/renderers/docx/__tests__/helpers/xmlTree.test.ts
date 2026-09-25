import { describe, expect, it } from 'vitest'
import { parseXml } from './xmlTree'

describe('parseXml / 合法输入', () => {
  it('解析最简单的自闭合根元素', () => {
    const tree = parseXml('<a/>')
    expect(tree).toEqual({ kind: 'element', name: 'a', attrs: {}, children: [] })
  })

  it('跳过 XML 声明', () => {
    const tree = parseXml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a/>')
    expect(tree.name).toBe('a')
  })

  it('带前缀的元素名与属性名（前缀已声明）', () => {
    const tree = parseXml('<w:p xmlns:w="uri" xml:space="preserve" w:val="x"/>')
    expect(tree.name).toBe('w:p')
    expect(tree.attrs).toEqual({ 'xmlns:w': 'uri', 'xml:space': 'preserve', 'w:val': 'x' })
  })

  it('单引号与双引号属性值', () => {
    const tree = parseXml(`<a x="1" y='2'/>`)
    expect(tree.attrs).toEqual({ x: '1', y: '2' })
  })

  it('文本作为独立子节点，与子元素混排', () => {
    const tree = parseXml('<a>前<b/>后</a>')
    expect(tree.children).toEqual([
      { kind: 'text', text: '前' },
      { kind: 'element', name: 'b', attrs: {}, children: [] },
      { kind: 'text', text: '后' },
    ])
  })

  it('5 个预定义实体', () => {
    const tree = parseXml('<a>&amp;&lt;&gt;&apos;&quot;</a>')
    expect(tree.children).toEqual([{ kind: 'text', text: `&<>'"` }])
  })

  it('数字字符引用：十进制与十六进制', () => {
    const tree = parseXml('<a>&#20320;&#x597D;</a>')
    expect(tree.children).toEqual([{ kind: 'text', text: '你好' }])
  })

  it('属性值中的实体也会被解析', () => {
    const tree = parseXml('<a x="1 &amp; 2"/>')
    expect(tree.attrs.x).toBe('1 & 2')
  })

  it('嵌套元素与深层结构', () => {
    const tree = parseXml(
      '<w:p xmlns:w="uri"><w:pPr><w:pStyle w:val="SesPara"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    )
    expect(tree.children).toHaveLength(2)
    const pPr = tree.children[0]
    if (pPr.kind !== 'element') throw new Error('expected element')
    expect(pPr.name).toBe('w:pPr')
    expect(pPr.children).toEqual([{ kind: 'element', name: 'w:pStyle', attrs: { 'w:val': 'SesPara' }, children: [] }])
  })

  it('空文档（只有声明与空白）之后的根元素照常解析', () => {
    const tree = parseXml('<?xml version="1.0"?>\n  \n<root/>')
    expect(tree.name).toBe('root')
  })
})

describe('parseXml / 非法输入（§10.2 列出的每一种都必须抛错）', () => {
  it('标签不配对', () => {
    expect(() => parseXml('<a><b></c></a>')).toThrow(/标签不配对/)
  })

  it('标签未闭合（缺少结束标签）', () => {
    expect(() => parseXml('<a><b></a>')).toThrow()
  })

  it('标签未闭合（文件在根元素中间结束）', () => {
    expect(() => parseXml('<a><b>')).toThrow(/未闭合/)
  })

  it('文本中出现未转义的 <', () => {
    expect(() => parseXml('<a>1 < 2</a>')).toThrow()
  })

  it('文本中出现未转义的 &', () => {
    expect(() => parseXml('<a>A & B</a>')).toThrow()
  })

  it('属性值中出现未转义的 <', () => {
    expect(() => parseXml('<a x="1<2"/>')).toThrow(/未转义的 "<"/)
  })

  it('属性值中出现未转义的 &', () => {
    expect(() => parseXml('<a x="A & B"/>')).toThrow()
  })

  it('同一元素属性重复', () => {
    expect(() => parseXml('<a x="1" x="2"/>')).toThrow(/属性 "x" 重复/)
  })

  it('多个根元素', () => {
    expect(() => parseXml('<a/><b/>')).toThrow()
  })

  it('根元素之后还有内容', () => {
    expect(() => parseXml('<a/>尾随文本')).toThrow(/根元素之后还有内容/)
  })

  it('不支持注释', () => {
    expect(() => parseXml('<a><!-- x --></a>')).toThrow(/不支持注释/)
  })

  it('不支持 CDATA', () => {
    expect(() => parseXml('<a><![CDATA[x]]></a>')).toThrow(/不支持 CDATA/)
  })

  it('不支持 DTD', () => {
    expect(() => parseXml('<!DOCTYPE a><a/>')).toThrow(/不支持 DTD/)
  })

  it('不支持处理指令（XML 声明除外）', () => {
    expect(() => parseXml('<a><?pi data?></a>')).toThrow(/不支持处理指令/)
  })

  it('未知实体', () => {
    expect(() => parseXml('<a>&nbsp;</a>')).toThrow(/未知实体/)
  })

  it('空文档', () => {
    expect(() => parseXml('')).toThrow(/没有根元素/)
  })
})

describe('parseXml / 原型链查找（审查第 1 条）', () => {
  it('&constructor; 不是合法实体，抛错', () => {
    expect(() => parseXml('<a>&constructor;</a>')).toThrow(/未知实体/)
  })

  it('&toString; / &hasOwnProperty; / &__proto__; 同样抛错', () => {
    expect(() => parseXml('<a>&toString;</a>')).toThrow(/未知实体/)
    expect(() => parseXml('<a>&hasOwnProperty;</a>')).toThrow(/未知实体/)
    expect(() => parseXml('<a>&__proto__;</a>')).toThrow(/未知实体/)
  })
})

describe('parseXml / XML 1.0 不允许的字符（审查第 2 条）', () => {
  it('文本中的裸控制字符抛错：U+0000、U+000B', () => {
    expect(() => parseXml('<a>x\u0000y</a>')).toThrow(/不允许的字符/)
    expect(() => parseXml('<a>x\u000By</a>')).toThrow(/不允许的字符/)
  })

  it('属性值中的裸控制字符抛错', () => {
    expect(() => parseXml('<a x="p\u0000q"/>')).toThrow(/不允许的字符/)
  })

  it('数字字符引用指向禁用码点时抛错：&#0; &#11; &#xFFFE;', () => {
    expect(() => parseXml('<a>&#0;</a>')).toThrow(/不允许的字符/)
    expect(() => parseXml('<a>&#11;</a>')).toThrow(/不允许的字符/)
    expect(() => parseXml('<a>&#xFFFE;</a>')).toThrow(/不允许的字符/)
  })

  it('数字字符引用指向代理项码点时抛错：&#xD800;', () => {
    expect(() => parseXml('<a>&#xD800;</a>')).toThrow(/代理项/)
  })

  it('数字字符引用超出 Unicode 范围时给出解析错误，不泄漏 RangeError', () => {
    expect(() => parseXml('<a>&#x110000;</a>')).toThrow(/超出.*范围/)
    expect(() => parseXml('<a>&#x110000;</a>')).not.toThrow(RangeError)
  })

  it('源文本里的孤立代理项抛错', () => {
    expect(() => parseXml('<a>x\uD800y</a>')).toThrow(/孤立代理项/)
    expect(() => parseXml('<a>x\uDC00y</a>')).toThrow(/孤立代理项/)
  })

  it('合法的增补平面字符（正确配对的代理对）能正常解析', () => {
    const tree = parseXml('<a>x\u{1F600}y</a>') // 😀，合法代理对
    expect(tree.children).toEqual([{ kind: 'text', text: 'x\u{1F600}y' }])
  })
})

describe('parseXml / 命名空间前缀作用域（审查第 3 条）', () => {
  it('元素名前缀未声明时抛错', () => {
    expect(() => parseXml('<w:p/>')).toThrow(/前缀 "w" 没有声明/)
  })

  it('属性名前缀未声明时抛错', () => {
    expect(() => parseXml('<a r:id="1"/>')).toThrow(/前缀 "r" 没有声明/)
  })

  it('前缀在祖先元素上声明时，子元素使用无需重复声明', () => {
    const tree = parseXml('<a xmlns:w="uri"><w:p/></a>')
    const child = tree.children[0]
    if (child.kind !== 'element') throw new Error('expected element')
    expect(child.name).toBe('w:p')
  })

  it('前缀在元素自身声明时可用（含自身的属性）', () => {
    const tree = parseXml('<w:p xmlns:w="uri" w:val="x"/>')
    expect(tree.attrs['w:val']).toBe('x')
  })

  it('xml 前缀预定义，无需声明', () => {
    const tree = parseXml('<a xml:space="preserve"/>')
    expect(tree.attrs['xml:space']).toBe('preserve')
  })

  it('xmlns、xmlns:* 属性本身不受前缀检查约束', () => {
    expect(() => parseXml('<a xmlns:w="uri" xmlns="default-uri"/>')).not.toThrow()
  })

  it('不带前缀的属性不检查（即使没有默认命名空间声明）', () => {
    expect(() => parseXml('<a val="x"/>')).not.toThrow()
  })
})
