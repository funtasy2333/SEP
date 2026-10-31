import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import type { XmlElement } from '../tree'
import { createImportContext } from './context'
import { mapCoreInline, readInlineChildren } from './inline'

it('[M-5.5-01] [M-5.5-02] 保留混合空白和变量嵌套样式', () => {
  const tree = parseXml46687('<p> a <named-content content-type="variable">x<sup>2</sup></named-content> z<break/></p>').tree!
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

it('[M-5.1-01] [M-5.1-02] [M-5.1-03] [M-5.1-04] [M-5.1-05] [M-5.10-02] 样式映射并提示等宽文字规范化', () => {
  const tree = parseXml46687('<p><bold>粗</bold><italic>斜</italic><underline>下</underline><strike>删</strike><monospace>等宽</monospace><inline-code>代码</inline-code></p>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  expect(readInlineChildren(tree.root, ctx).map(x => x.marks?.[0]?.type)).toEqual(['bold', 'italic', 'underline', 'strike', 'code', 'code'])
  expect(ctx.problems.some(p => p.severity === 'warning' && p.xml?.path.includes('monospace'))).toBe(true)
})

it('[M-5.1-06] [M-5.1-07] [M-5.1-08] 保留上下标与文字中的空格制表符', () => {
  const tree = parseXml46687('<p> x\t<sup>2</sup><sub>i</sub> </p>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  expect(readInlineChildren(tree.root, ctx)).toEqual([{ text: ' x\t' }, { text: '2', marks: [{ type: 'sup' }] }, { text: 'i', marks: [{ type: 'sub' }] }, { text: ' ' }])
  expect(ctx.problems).toEqual([])
})

it('[M-4.5.3-07] 接受 break，未登记的 br 由上下文报告', () => {
  const tree = parseXml46687('<p><break/><br/></p>').tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); el.children.forEach(c => { if (c.type === 'element') visit(c) }) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources: new Map() }, { inline: mapCoreInline })
  expect(readInlineChildren(tree.root, ctx)).toEqual([{ text: '\n' }])
  expect(ctx.problems.some(p => p.code === 'xml-unsupported' && p.xml?.path.includes('/br[1]'))).toBe(true)
})
