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

  it('带前缀的元素名与属性名', () => {
    const tree = parseXml('<w:p xml:space="preserve" w:val="x"/>')
    expect(tree.name).toBe('w:p')
    expect(tree.attrs).toEqual({ 'xml:space': 'preserve', 'w:val': 'x' })
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
    const tree = parseXml('<w:p><w:pPr><w:pStyle w:val="SesPara"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>')
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
