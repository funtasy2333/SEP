import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'

const xml = readFileSync(resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')
function prepare(source: string) {
  const tree = parseXml46687(source).tree!
  const ids = new Map<string, string>()
  function visit(e: XmlElement) {
    ids.set(e.position!.path, `id${ids.size}`)
    for (const c of e.children) if (c.type === 'element') visit(c)
  }
  visit(tree.root)
  return { tree, options: { nodeIdsByPath: ids, resources: new Map() } }
}
it('将有效标准同步映射为 IR 且不修改树和分配表', () => {
  const { tree, options } = prepare(xml)
  const before = JSON.stringify(tree)
  const result = mapXml46687(tree, options)
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(result.ir?.body[0]?.children[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '本文件给出一个只含必需结构的最小文档。' }] })
  expect(JSON.stringify(tree)).toBe(before)
})
it('直接调用映射器也拒绝不合法的未知元素和缺少节点 ID', () => {
  const { tree, options } = prepare(xml.replace('<p>', '<unknown/><p>'))
  options.nodeIdsByPath.delete(tree.root.position!.path)
  const result = mapXml46687(tree, options)
  expect(result.ir).toBeNull()
  expect(result.problems.some(p => p.severity === 'error')).toBe(true)
})
