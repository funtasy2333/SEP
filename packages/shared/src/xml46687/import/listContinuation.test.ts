import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'
import type { IRList } from '../../ir/types'

/** issue #70 × WP8.3：由 list-item/label 恢复「继续前一列项编号」。 */

const minimal = readFileSync(resolvePath(process.cwd(), '../../schemas/gbt46687.2/samples/valid/01-minimal.xml'), 'utf8')

const list = (type: string, labels: (string | null)[]) => `<list list-type="${type}">${labels.map((label, index) =>
  `<list-item>${label === null ? '' : `<label>${label}</label>`}<p>项${index}</p></list-item>`).join('')}</list>`

function importLists(scopeContent: string): IRList[] {
  const xml = minimal.replace('<p>本文件给出一个只含必需结构的最小文档。</p>', `<p>引导。</p>${scopeContent}`)
  const parsed = parseXml46687(xml)
  expect(parsed.problems.filter(p => p.severity === 'error')).toEqual([])
  const tree = parsed.tree!
  const ids = new Map<string, string>()
  const visit = (element: XmlElement) => {
    ids.set(element.position!.path, `id${ids.size}`)
    for (const child of element.children) if (child.type === 'element') visit(child)
  }
  visit(tree.root)
  const result = mapXml46687(tree, { nodeIdsByPath: ids, resources: new Map() })
  expect(result.problems.filter(p => p.severity === 'error')).toEqual([])
  return result.ir!.body[0]!.children.filter((child): child is IRList => child.kind === 'list')
}

const continued = (lists: IRList[]) => lists.map(item => item.continueNumbering === true)

describe('XML 导入：由列项标号恢复继续编号', () => {
  it('中间隔着段落，后一组从 c) 起：恢复为继续编号；首组从 a) 起保持重新编号', () => {
    const lists = importLists(`${list('alpha-lower', ['a)', 'b)'])}<p>说明。</p>${list('alpha-lower', ['c)', 'd)'])}`)
    expect(continued(lists)).toEqual([false, true])
  })

  it('全角括号与空白也能识别；被接续的列表本身也可接续（逐级累加）', () => {
    const lists = importLists(`${list('alpha-lower', ['a）'])}<p>一</p>${list('alpha-lower', [' b） '])}<p>二</p>${list('alpha-lower', ['c)'])}`)
    expect(continued(lists)).toEqual([false, true, true])
  })

  it('标号从头开始、标号对不上接续序号、前面没有同类型列表、没有标号：都保持重新编号', () => {
    expect(continued(importLists(`${list('alpha-lower', ['a)'])}${list('alpha-lower', ['a)'])}`))).toEqual([false, false])
    expect(continued(importLists(`${list('alpha-lower', ['a)'])}${list('alpha-lower', ['e)'])}`))).toEqual([false, false])
    expect(continued(importLists(`${list('arabic', ['1)'])}${list('alpha-lower', ['b)'])}`))).toEqual([false, false])
    expect(continued(importLists(`${list('alpha-lower', ['a)'])}${list('alpha-lower', [null])}`))).toEqual([false, false])
  })

  it('无序列表不处理', () => {
    expect(continued(importLists(`${list('dash', [null])}<p>中</p>${list('dash', [null])}`))).toEqual([false, false])
  })
})
