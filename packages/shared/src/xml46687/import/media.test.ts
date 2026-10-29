import { describe, expect, test } from 'vitest'
import { parseXml46687 } from '../parse'
import { createImportContext } from './context'
import { mapCoreInline } from './inline'
import { mapMediaBlock, mapMediaInline } from './media'
import type { XmlElement } from '../tree'

function setup(xml: string, resources = new Map<string, {src: string; mediaType: string; resourceId?: string}>()) {
  const parsed = parseXml46687(xml)
  expect(parsed.problems).toEqual([])
  const tree = parsed.tree!
  const ids = new Map<string, string>()
  const visit = (el: XmlElement) => { ids.set(el.position!.path, `n${ids.size}`); for (const child of el.children) if (child.type === 'element') visit(child) }
  visit(tree.root)
  const ctx = createImportContext(tree, { nodeIdsByPath: ids, resources }, { inline: (el, context) => mapCoreInline(el, context) ?? mapMediaInline(el, context), block: mapMediaBlock })
  return { tree, ctx }
}

describe('媒体映射', () => {
  test('[M-7.1-05] 按 URI 保留原生 MathML 字符与独立命名空间', () => {
    const { tree, ctx } = setup('<inline-formula xmlns:q="http://www.w3.org/1998/Math/MathML"><q:math id="m"><q:mi> a&#x2264;<![CDATA[ b]]></q:mi></q:math></inline-formula>')
    const result = mapMediaInline(tree.root, ctx)!
    expect(result[0]!.formula!.mathml).toContain('xmlns:mml="http://www.w3.org/1998/Math/MathML"')
    expect(result[0]!.formula!.mathml).toContain(' a≤ b')
    expect(result[0]!.formula!.mathml).not.toContain('id="m"')
    expect(ctx.problems).toEqual([])
  })
  test('[M-7.4-02] 拒绝危险 MathML 属性及会被输出器删除的 TeX 注释', () => {
    for (const body of ['<q:mi onclick="bad()">x</q:mi>', '<q:semantics><q:mi>x</q:mi><q:annotation encoding="TeX">x</q:annotation></q:semantics>']) {
      const { tree, ctx } = setup(`<inline-formula xmlns:q="http://www.w3.org/1998/Math/MathML"><q:math id="m">${body}</q:math></inline-formula>`)
      mapMediaInline(tree.root, ctx)
      expect(ctx.problems.some(p => p.severity === 'error')).toBe(true)
    }
  })
  test('[M-8.1-01] 多个 graphic 按原顺序属于同一图并检查每个资源', () => {
    const xml = '<fig xmlns:xlink="http://www.w3.org/1999/xlink"><caption><title>标题</title></caption><graphic xlink:href="a" content-type="image"/><graphic xlink:href="b" specific-use="size:M"/></fig>'
    const { tree, ctx } = setup(xml, new Map([['a', {src: 'a-data', mediaType: 'image/png'}], ['b', {src: 'b-data', mediaType: 'image/png', resourceId: 'rb'}]]))
    const figure = mapMediaBlock(tree.root, ctx)![0]!
    expect(figure.kind).toBe('figure')
    if (figure.kind !== 'figure') throw new Error('figure')
    expect(figure.src).toBe('a-data')
    expect(figure.primaryGraphic).toEqual({contentType: 'image'})
    expect(figure.additionalGraphics).toEqual([{id: 'n4', src: 'b-data', resourceId: 'rb', specificUse: 'size:M'}])
    expect(ctx.problems).toEqual([])
  })
  test('[M-8.5-01] 图组保存共用图例与子图归属', () => {
    const { tree, ctx } = setup('<fig-group xmlns:xlink="http://www.w3.org/1999/xlink"><legend><title>说明</title><def-list list-content="figure"><def-item><term>1</term><def><p>驱动</p></def></def-item></def-list></legend><fig><graphic xlink:href="a"/></fig><fig><graphic xlink:href="b"/></fig></fig-group>', new Map([['a', {src: 'A', mediaType: 'image/png'}], ['b', {src: 'B', mediaType: 'image/png'}]]))
    const result = mapMediaBlock(tree.root, ctx)![0]!
    expect(result.kind).toBe('figureSet')
    if (result.kind !== 'figureSet') throw new Error('figureSet')
    expect(result.legend!.items[0]!.definition).toEqual([{text: '驱动'}])
    expect(result.figures.map(f => f.src)).toEqual(['A', 'B'])
    expect(ctx.problems).toEqual([])
  })
  test('[M-C.1-05] 公式组与成员的编号状态独立', () => {
    const { tree, ctx } = setup('<disp-formula-group xmlns:m="http://www.w3.org/1998/Math/MathML"><label>(1)</label><disp-formula><m:math id="m1"><m:mi>a</m:mi></m:math></disp-formula><disp-formula><m:math id="m2"><m:mi>b</m:mi></m:math></disp-formula></disp-formula-group>')
    const result = mapMediaBlock(tree.root, ctx)![0]!
    expect(result.kind).toBe('formulaGroup')
    if (result.kind !== 'formulaGroup') throw new Error('formulaGroup')
    expect(result.numbered).toBe(true)
    expect(result.formulas.map(f => f.numbered)).toEqual([false, false])
    expect(result.formulas.map(f => f.mathml)).toHaveLength(2)
    expect(ctx.problems).toEqual([])
  })

})
