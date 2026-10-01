import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from '@tiptap/pm/model'
import { serializeToXml, toXmlListType } from './xmlSerializer'

function node(name: string, attrs: Record<string, unknown> = {}, children: PMNode[] = [], value = ''): PMNode {
  return {
    type: { name }, attrs, isText: name === 'text', text: value, marks: [],
    forEach: (visit: (child: PMNode) => void) => children.forEach(visit),
  } as unknown as PMNode
}

describe('XML 列项导出类型', () => {
  it('旧罗马列项导出为阿拉伯数字类型，不再产生罗马类型', () => {
    expect(toXmlListType('roman')).toBe('arabic')
    expect(toXmlListType('romanUpper')).toBe('arabic')
    expect(toXmlListType('numeric')).toBe('arabic')
    expect(toXmlListType('alpha')).toBe('alpha-lower')
    expect(toXmlListType('dash')).toBe('dash')
    expect(toXmlListType('dot')).toBe('bullet')
  })

  it('间隔号与数字列项导出标准 list-type，不写编辑器专用 level 属性', () => {
    const item = node('stdListItem', {}, [node('text', {}, [], '内容')])
    const chapter = node('chapter', {}, [
      node('stdList', { listType: 'dot', level: 2 }, [item]),
      node('stdList', { listType: 'numeric', level: 2 }, [item]),
    ])
    const xml = serializeToXml(node('doc', {}, [chapter]))
    expect(xml).toContain('<list list-type="bullet">')
    expect(xml).toContain('<label>·</label>')
    expect(xml).toContain('<list list-type="arabic">')
    expect(xml).not.toMatch(/<list[^>]*\blevel=/)
  })
})

describe('XML 文档类型序列化', () => {
  it('编辑器 doc 根无 attrs 时，从 schema-backed coverPage 写回 std-type', () => {
    const cover = node('coverPage', { standardType: 'local' }, [node('paragraph')])
    const xml = serializeToXml(node('doc', {}, [cover]))
    expect(xml).toContain('<std-type>local</std-type>')
  })
})
