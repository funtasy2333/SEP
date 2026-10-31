import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseXml46687 } from '../parse'
import { getXmlAttr, XLINK_NS } from '../tree'
import type { XmlElement } from '../tree'
import { mapXml46687 } from './facade'

it('[M-7.4-13] 行间公式替代图按已定约定提示并保留 MathML', () => {
  const file = resolve(process.cwd(), '../../schemas/gbt46687.2/samples/valid/05-formulas-figures.xml')
  const original = readFileSync(file, 'utf8')
  const xml = original.replace('</disp-formula>', '<graphic content-type="disp-formula" xlink:href="formula-image.png"/></disp-formula>')
  const parsed = parseXml46687(xml)
  expect(parsed.problems).toEqual([])
  const tree = parsed.tree!
  const nodeIdsByPath = new Map<string, string>()
  const resources = new Map<string, {src: string; mediaType: string}>()
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII='
  function visit(el: XmlElement) {
    nodeIdsByPath.set(el.position!.path, `node-${nodeIdsByPath.size}`)
    if (el.name.ns === null && ['graphic', 'inline-graphic'].includes(el.name.local)) {
      const href = getXmlAttr(el, XLINK_NS, 'href')
      if (href) resources.set(href, {src:png,mediaType:'image/png'})
    }
    for (const child of el.children) if (child.type === 'element') visit(child)
  }
  visit(tree.root)
  const result = mapXml46687(tree, {nodeIdsByPath,resources})
  expect(result.problems.filter(p => p.severity === 'error'), JSON.stringify(result.problems)).toEqual([])
  expect(result.ir).not.toBeNull()
  expect(JSON.stringify(result.ir)).toContain('<mml:mfrac>')
  expect(result.problems.some(p => p.severity === 'warning' && p.message.includes('formula-image.png'))).toBe(true)
})
