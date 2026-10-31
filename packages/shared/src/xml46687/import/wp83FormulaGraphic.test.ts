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
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
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
  expect(result.problems).toContainEqual(expect.objectContaining({
    code:'xml-normalized', severity:'warning', matrixId:'M-7.4-13',
    message:expect.stringContaining('formula-image.png'),
    xml:expect.objectContaining({line:62, column:7, path:expect.stringContaining('/disp-formula[1]/graphic[1]')}),
  }))
})

it('[M-7.4-13] 只接受有资源且类型正确的公式备选图', async () => {
  const {createImportContext} = await import('./context')
  const {mapMediaBlock} = await import('./media')
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII='
  const prefix = '<disp-formula xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:x="http://www.w3.org/1999/xlink">'
  const math = '<m:math id="m"><m:mi>x</m:mi></m:math>'
  const cases = [
    {body:`${math}<graphic content-type="image" x:href="a"/>`,resource:true},
    {body:`${math}<graphic content-type="disp-formula" x:href="a" surprise="lost"/>`,resource:true},
    {body:`${math}<graphic content-type="disp-formula" x:href="a"><unknown>lost</unknown></graphic>`,resource:true},
    {body:`${math}<graphic content-type="disp-formula" x:href="a"/>`,resource:false},
    {body:'<graphic content-type="disp-formula" x:href="a"/>',resource:true},
  ]
  for (const testCase of cases) {
    const tree = parseXml46687(`${prefix}${testCase.body}</disp-formula>`).tree!
    const ids = new Map<string,string>()
    const visit = (el: XmlElement) => { ids.set(el.position!.path,`n${ids.size}`); for (const child of el.children) if (child.type === 'element') visit(child) }
    visit(tree.root)
    const resources = testCase.resource ? new Map([['a',{src,mediaType:'image/png'}]]) : new Map()
    const ctx = createImportContext(tree,{nodeIdsByPath:ids,resources},{})
    mapMediaBlock(tree.root,ctx)
    expect(ctx.problems.some(problem=>problem.severity === 'error'),testCase.body).toBe(true)
  }
})
