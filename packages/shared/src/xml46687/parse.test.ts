import { describe, expect, it } from 'vitest'
import { parseXml46687, XML46687_PARSE_LIMITS } from './parse'

const failure = (xml: string, code: string) => {
  const result = parseXml46687(xml)
  expect(result.tree).toBeNull()
  expect(result.problems[0]).toMatchObject({ code, severity: 'error', xml: { line: expect.any(Number), column: expect.any(Number), path: expect.any(String) } })
  expect(result.problems[0].message).toMatch(/[\u3400-\u9fff]/)
}

describe('严格 XML 解析', () => {
  it('按 URI 解析命名空间、保留属性和混合内容并定位节点', () => {
    const result = parseXml46687('<?xml version="1.0" encoding="UTF-8"?>\r\n<r xmlns="urn:r" xmlns:a="urn:x" id="1" a:id="2" xml:space="preserve">\n 甲&amp;<![CDATA[乙]]><!--注--><a:x/>\n</r>')
    expect(result.problems).toEqual([])
    const root = result.tree!.root
    expect(root.name).toEqual({ ns: 'urn:r', local: 'r' })
    expect(root.attrs).toEqual(expect.arrayContaining([
      { name: { ns: null, local: 'id' }, value: '1' },
      { name: { ns: 'urn:x', local: 'id', prefix: 'a' }, value: '2' },
      { name: { ns: 'http://www.w3.org/XML/1998/namespace', local: 'space', prefix: 'xml' }, value: 'preserve' },
    ]))
    expect(root.position).toEqual({ line: 2, column: 1, path: '/r[1]' })
    expect(root.children[0]).toMatchObject({ type: 'text', value: '\n 甲&乙', position: { line: 2, column: 71 } })
    expect(root.children[1]).toMatchObject({ type: 'comment', value: '注', position: { line: 3 } })
    expect(root.children[2]).toMatchObject({ type: 'element', name: { ns: 'urn:x', local: 'x', prefix: 'a' }, position: { path: '/r[1]/x[1]' } })
    expect(JSON.parse(JSON.stringify(result.tree))).toEqual(result.tree)
  })
  it('恢复嵌套命名空间并按同名兄弟编号', () => {
    const root = parseXml46687('<r xmlns:p="u1"><p:x/><a xmlns:p="u2"><p:x/></a><p:x/></r>').tree!.root
    expect(root.children[0]).toMatchObject({ name: { ns: 'u1' }, position: { path: '/r[1]/x[1]' } })
    expect(root.children[1]).toMatchObject({ children: [{ name: { ns: 'u2' } }] })
    expect(root.children[2]).toMatchObject({ name: { ns: 'u1' }, position: { path: '/r[1]/x[2]' } })
  })
  it('不同命名空间的同名兄弟具有唯一定位路径', () => {
    const root = parseXml46687('<r xmlns:x="u1" xmlns:y="u2"><x:a/><y:a/></r>').tree!.root
    expect(root.children[0].position!.path).toBe('/r[1]/a[1]')
    expect(root.children[1].position!.path).toBe('/r[1]/a[2]')
  })
  it('跨行实体错误定位到引用开始', () => {
    const result = parseXml46687('<r>one\n two &bad;</r>')
    expect(result.problems[0]).toMatchObject({ code: 'xml-forbidden-entity', xml: { line: 2, column: 6, path: '/r[1]' } })
  })
  it('处理数值引用、空白及 XML 换行和属性归一', () => {
    const root = parseXml46687('\ufeff<r a="x\r\ny&#xA;z"> \r甲&#x1F600;&#13;\r\n</r>').tree!.root
    expect(root.attrs[0].value).toBe('x y\nz')
    expect(root.children[0]).toMatchObject({ type: 'text', value: ' \n甲😀\r\n' })
  })
  it.each([
    ['<mml:x/>', 'xml-namespace'], ['<r xmlns:p="u" xmlns:q="u" p:a="1" q:a="2"/>', 'xml-namespace'],
    ['<r xmlns:xml="bad"/>', 'xml-namespace'], ['<r xmlns:p=""/>', 'xml-namespace'],
    ['<r xmlns:xmlns="u"/>', 'xml-namespace'], ['<r a:b:c="1"/>', 'xml-syntax'],
    ['<r a="1" a="2"/>', 'xml-namespace'], ['<r><x></r>', 'xml-syntax'],
    ['<r/>text', 'xml-syntax'], ['<r><!--a--b--></r>', 'xml-syntax'], ['<r>]]></r>', 'xml-syntax'],
    ['<r>\u0001</r>', 'xml-syntax'], ['<r>&#0;</r>', 'xml-syntax'], ['<r>&#xD800;</r>', 'xml-syntax'],
    ['<!DOCTYPE r><r/>', 'xml-forbidden-doctype'], ['<!ENTITY x "x"><r/>', 'xml-forbidden-entity'],
    ['<r>&foo;</r>', 'xml-forbidden-entity'], ['<r><?target x?></r>', 'xml-forbidden-pi'],
    ['<?xml version="1.1"?><r/>', 'xml-encoding'], ['<?xml version="1.0" encoding="ISO-8859-1"?><r/>', 'xml-encoding'],
    ['<r/><?xml version="1.0"?>', 'xml-forbidden-pi'],
  ])('拒绝非法输入 %s', (xml, code) => failure(xml, code))
  it.each([
    ['<?XML version="1.0"?><r/>', 'xml-forbidden-pi'],
    ['<?xml VERSION="1.0"?><r/>', 'xml-encoding'],
    ['<r/> &amp;', 'xml-syntax'],
    ['<r xmlns:xml="http://www.w3.org/XML/1998/namespace" xmlns:a="http://www.w3.org/XML/1998/namespace"/>', 'xml-namespace'],
    ['<r xmlns="http://www.w3.org/2000/xmlns/"/>', 'xml-namespace'],
    ['<r xmlns:p="u" p:2x="a"/>', 'xml-syntax'],
  ])('拒绝额外的 XML 边界错误 %s', (xml, code) => failure(xml, code))
  it('根外注释也计入总节点预算', () => {
    failure('<!-- -->'.repeat(XML46687_PARSE_LIMITS.maxNodes) + '<r/>', 'xml-limit')
  })
  it('在输入、深度、文本和节点增长前拒绝超限', () => {
    failure(' '.repeat(XML46687_PARSE_LIMITS.maxInputBytes + 1), 'xml-limit')
    failure('<x>'.repeat(129) + '</x>'.repeat(129), 'xml-limit')
    failure('<r>' + 'x'.repeat(XML46687_PARSE_LIMITS.maxTextBytes) + '<![CDATA[y]]></r>', 'xml-limit')
    failure('<r>' + 'x'.repeat(XML46687_PARSE_LIMITS.maxTextBytes) + '<!--c-->y</r>', 'xml-limit')
    failure('<r>' + '<x/>'.repeat(XML46687_PARSE_LIMITS.maxNodes) + '</r>', 'xml-limit')
  })
})
