import { describe, expect, it } from 'vitest'
import {
  MATHML_NS,
  XLINK_NS,
  findXmlChild,
  findXmlChildren,
  getXmlAttr,
  isXmlElement,
  qname,
  xmlAttr,
  xmlComment,
  xmlElement,
  xmlNameIs,
  xmlPi,
  xmlText,
  xmlTextContent,
  type XmlDocument,
} from './tree'

describe('xml46687 纯数据树：构造辅助', () => {
  it('只导出 XLink 与 MathML 两个通用命名空间常量', () => {
    expect(XLINK_NS).toBe('http://www.w3.org/1999/xlink')
    expect(MATHML_NS).toBe('http://www.w3.org/1998/Math/MathML')
  })

  it('qname 不产生 undefined 字段，prefix 仅在给出时出现', () => {
    expect(qname(null, 'a')).toStrictEqual({ ns: null, local: 'a' })
    expect(qname(MATHML_NS, 'math', 'mml')).toStrictEqual({ ns: MATHML_NS, local: 'math', prefix: 'mml' })
    expect('prefix' in qname(null, 'a')).toBe(false)
  })

  it('xmlElement 接受 XmlName 或字符串（无命名空间的本地名），字符串子节点转文本节点', () => {
    const el = xmlElement('p', [xmlAttr('id', 'p1')], ['甲', xmlElement(qname(MATHML_NS, 'math', 'mml')), xmlText('乙')])
    expect(el).toStrictEqual({
      type: 'element',
      name: { ns: null, local: 'p' },
      attrs: [{ name: { ns: null, local: 'id' }, value: 'p1' }],
      children: [
        { type: 'text', value: '甲' },
        { type: 'element', name: { ns: MATHML_NS, local: 'math', prefix: 'mml' }, attrs: [], children: [] },
        { type: 'text', value: '乙' },
      ],
    })
  })

  it('attrs 与 children 缺省为空数组，且每次调用互不共享', () => {
    const a = xmlElement('a')
    const b = xmlElement('a')
    expect(a.attrs).toEqual([])
    expect(a.children).toEqual([])
    expect(a.attrs).not.toBe(b.attrs)
    expect(a.children).not.toBe(b.children)
  })

  it('注释、处理指令、文本构造出规定形状的数据', () => {
    expect(xmlText('x')).toStrictEqual({ type: 'text', value: 'x' })
    expect(xmlComment('c')).toStrictEqual({ type: 'comment', value: 'c' })
    expect(xmlPi('t', 'd')).toStrictEqual({ type: 'pi', target: 't', data: 'd' })
  })

  it('整棵树可 JSON.stringify 往返且无损（含 doctype 与 position）', () => {
    const doc: XmlDocument = {
      doctype: { name: 'standard', publicId: '-//X//DTD//EN', systemId: 'x.dtd' },
      root: {
        ...xmlElement(qname(null, 'standard'), [xmlAttr(qname(XLINK_NS, 'href', 'xlink'), 'a.png')], [
          xmlComment('注释'), xmlPi('pi', 'data'), xmlText('文本'),
          xmlElement('sec', [], ['内']),
        ]),
        position: { path: '/standard[1]', line: 1, column: 1 },
      },
    }
    expect(JSON.parse(JSON.stringify(doc))).toStrictEqual(doc)
  })
})

describe('xml46687 纯数据树：只读查询', () => {
  const tree = xmlElement('root', [
    xmlAttr('id', 'r'),
    xmlAttr(qname(XLINK_NS, 'href', 'xlink'), 'h'),
  ], [
    xmlElement(qname(MATHML_NS, 'math', 'mml'), [], ['m']),
    xmlElement('sec', [], ['第一', xmlComment('不计入'), xmlElement('b', [], ['粗']), xmlPi('p', '不计入'), '末']),
    xmlElement('sec', [], ['第二']),
    xmlElement(qname(MATHML_NS, 'sec')),
    '尾',
  ])

  it('isXmlElement 区分元素与其它节点', () => {
    expect(isXmlElement(tree)).toBe(true)
    expect(isXmlElement(xmlText('x'))).toBe(false)
    expect(isXmlElement(xmlComment('x'))).toBe(false)
    expect(isXmlElement(xmlPi('t', 'x'))).toBe(false)
  })

  it('xmlNameIs / findXmlChild(ren) 按 ns+local 精确匹配，null 表示无命名空间', () => {
    expect(xmlNameIs(qname(null, 'sec'), null, 'sec')).toBe(true)
    expect(xmlNameIs(qname(MATHML_NS, 'sec', 'mml'), null, 'sec')).toBe(false)
    expect(xmlNameIs(qname(MATHML_NS, 'sec', 'mml'), MATHML_NS, 'sec')).toBe(true)
    expect(findXmlChildren(tree, null, 'sec')).toHaveLength(2)
    expect(findXmlChildren(tree, MATHML_NS, 'sec')).toHaveLength(1)
    expect(findXmlChildren(tree, null, 'nope')).toEqual([])
    expect(findXmlChild(tree, null, 'sec')).toBe(tree.children[1])
    expect(findXmlChild(tree, MATHML_NS, 'math')).toBe(tree.children[0])
    expect(findXmlChild(tree, null, 'nope')).toBeUndefined()
  })

  it('findXmlChild(ren) 只看直接子元素，不下钻', () => {
    expect(findXmlChild(tree, null, 'b')).toBeUndefined()
  })

  it('getXmlAttr 按 ns+local 取属性值', () => {
    expect(getXmlAttr(tree, null, 'id')).toBe('r')
    expect(getXmlAttr(tree, XLINK_NS, 'href')).toBe('h')
    expect(getXmlAttr(tree, null, 'href')).toBeUndefined()
    expect(getXmlAttr(tree, XLINK_NS, 'id')).toBeUndefined()
  })

  it('xmlTextContent 拼接后代文本，忽略注释与处理指令', () => {
    const sec = findXmlChild(tree, null, 'sec')!
    expect(xmlTextContent(sec)).toBe('第一粗末')
    expect(xmlTextContent(tree)).toBe('m第一粗末第二尾')
    expect(xmlTextContent(xmlText('孤'))).toBe('孤')
    expect(xmlTextContent(xmlComment('c'))).toBe('')
    expect(xmlTextContent(xmlPi('t', 'd'))).toBe('')
  })

  it('查询不修改输入', () => {
    const before = JSON.stringify(tree)
    findXmlChild(tree, null, 'sec'); findXmlChildren(tree, null, 'sec'); getXmlAttr(tree, null, 'id'); xmlTextContent(tree)
    expect(JSON.stringify(tree)).toBe(before)
  })
})
