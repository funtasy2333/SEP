import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { createImportContext } from './context'
import { mapCoreInline } from './inline'
import { mapCoreBlock, mapStructure } from './structure'

function setup(xml: string) {
  const tree = parseXml46687(xml).tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline, block: mapCoreBlock })
  return { tree, ctx }
}

it('[M-5.7-10] [M-5.7-11] 保留简单列项派生段落 ID 与嵌套列表层次', () => {
  const { tree, ctx } = setup('<list list-type="bullet"><list-item><p>甲</p></list-item><list-item><p>乙</p><list list-type="dash"><list-item><p>丙</p></list-item></list></list-item></list>')
  const [list] = mapCoreBlock(tree.root, ctx)!
  expect(list?.kind).toBe('list')
  if (list?.kind !== 'list') throw new Error('list expected')
  expect(list.items[0]!.content[0]!.id).toBe(`${list.items[0]!.id}.p0`)
  expect(list.items[1]!.content.map(b => b.kind)).toEqual(['paragraph', 'list'])
  expect(ctx.problems).toEqual([])
})

it('[M-4.3.4-02] [M-4.3.4-03] [M-4.4.2.5-01] 构造引言条、无标题条并阻止悬置正文', () => {
  const { tree, ctx } = setup('<standard><front><std-meta/><sec sec-type="intro"><title>引言</title><p>前文</p><sec><title><italic>条</italic></title><sec><p>内文</p></sec></sec><p>悬置</p></sec></front><body><sec><title>章</title><sec><p>内容</p></sec></sec></body></standard>')
  const doc = mapStructure(tree, ctx)!
  expect(doc.front.introductionClauses?.[0]?.title).toEqual([{ text: '条', marks: [{ type: 'italic' }] }])
  expect(doc.front.introductionClauses?.[0]?.children[0]).toMatchObject({ kind: 'clause', titled: false, level: 2 })
  expect(doc.body[0]?.children[0]).toMatchObject({ kind: 'clause', titled: false, level: 1 })
  expect(ctx.problems.some(p => p.severity === 'error' && p.xml?.path.includes('p[2]'))).toBe(true)
})

it('[M-4.2-03] 未知根级内容必须报告，不得静默丢弃', () => {
  const { tree, ctx } = setup('<standard><front><std-meta/></front><body/><unexpected>丢失</unexpected></standard>')
  mapStructure(tree, ctx)
  expect(ctx.problems.some(p => p.severity === 'error' && p.xml?.path.includes('unexpected'))).toBe(true)
})
