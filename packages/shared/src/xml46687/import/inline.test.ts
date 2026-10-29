import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { createImportContext } from './context'
import { mapCoreInline, readInlineChildren } from './inline'

it('[M-5.5-01] [M-5.5-02] 保留混合空白和变量嵌套样式', () => {
  const tree = parseXml46687('<p> a <named-content content-type="variable">x<sup>2</sup></named-content> z<br/></p>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  expect(readInlineChildren(tree.root, ctx)).toEqual([
    { text: ' a ' }, { text: 'x', marks: [{ type: 'variable' }] },
    { text: '2', marks: [{ type: 'variable' }, { type: 'sup' }] }, { text: ' z' }, { text: '\n' },
  ])
  expect(ctx.problems).toEqual([])
})
