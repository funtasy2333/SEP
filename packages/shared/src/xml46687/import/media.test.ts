import { readFileSync } from 'node:fs'
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

  test('[M-6.4-01] 表保留跨行列网格、列宽、单元格与脚注', () => {
    const { tree, ctx } = setup('<table-wrap><label>表1</label><caption><title>示例</title></caption><table width="100%"><colgroup><col width="40%"/><col width="60%"/></colgroup><thead><tr><th rowspan="2">头</th><th>项</th></tr><tr><th>次</th></tr></thead><tbody><tr><td colspan="2" style="border-left: dashed 2px; background-color=#EFEFEF">值</td></tr></tbody></table><table-wrap-foot><p content-type="dimension">单位</p><fn id="f"><label>a</label><p>脚注</p></fn></table-wrap-foot></table-wrap>')
    const result = mapMediaBlock(tree.root, ctx)![0]!
    expect(result.kind).toBe('table')
    if (result.kind !== 'table') throw new Error('table')
    expect(result.columns).toEqual([{width: {value: 40, unit: '%'}}, {width: {value: 60, unit: '%'}}])
    expect(result.headerRowCount).toBe(2)
    expect(result.rows.map(r => r.cells.map(c => [c.colspan, c.rowspan]))).toEqual([[[1,2],[1,1]], [[1,1]], [[2,1]]])
    expect(result.rows[2]!.cells[0]!.style).toEqual({borderLeftStyle: 'dashed', borderLeft: {value: 2, unit: 'px'}, backgroundColor: '#EFEFEF'})
    expect(result.rows[2]!.cells[0]!.content[0]).toMatchObject({kind:'paragraph', content:[{text:'值'}]})
    expect(result.unit).toBe('单位')
    expect(result.footnotes![0]!.content).toEqual([{text: '脚注'}])
    expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
  })
  test('[M-5.8-01] array 保留列组与完整行', () => {
    const {tree, ctx} = setup('<array><table><colgroup><col width="40%"/><col width="60%"/></colgroup><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table></array>')
    const result = mapMediaBlock(tree.root, ctx)![0]!
    expect(result.kind).toBe('array')
    if (result.kind !== 'array') throw new Error('array')
    expect(result.columnGroups).toEqual([{start:0,count:2}])
    expect(result.rows[0]!.cells).toHaveLength(2)
    expect(ctx.problems).toEqual([])
  })

  test('[M-8.4-01] 05 样例保存多图、组合图和公式全部成员', () => {
    const xml = readFileSync('../../schemas/gbt46687.2/samples/valid/05-formulas-figures.xml', 'utf8')
    const resources = new Map(['icon_1','fig_1','fig_2','fig_2_b','fig_3','fig_4'].map(name => [name, {src:`data:${name}`, mediaType:'image/png', resourceId:`resource:${name}`}]))
    const {tree, ctx} = setup(xml, resources)
    const find = (name: string) => { const result: XmlElement[] = []; const visit = (e: XmlElement) => { if (e.name.local === name && e.name.ns === null) result.push(e); for (const c of e.children) if (c.type === 'element') visit(c) }; visit(tree.root); return result }
    const figs = find('fig').map(el => mapMediaBlock(el,ctx)![0]!).filter(x => x.kind === 'figure')
    expect(figs.map(f=>f.src)).toEqual(['data:fig_1','data:fig_2','data:fig_3','data:fig_4'])
    expect(figs[1]!.additionalGraphics![0]!.src).toBe('data:fig_2_b')
    expect(figs[0]!.legend!.items.map(x=>x.definition[0]!.text)).toEqual(['驱动及控制模块；','传感模块。'])
    expect(figs[0]!.notes[0]!.content[0]).toMatchObject({content:[{text:'图注位于图形之后。'}]})
    const group = mapMediaBlock(find('fig-group')[0]!,ctx)![0]!
    expect(group.kind).toBe('figureSet')
    if (group.kind !== 'figureSet') throw new Error('group')
    expect(group.figures.map(x=>x.src)).toEqual(['data:fig_3','data:fig_4'])
    expect(group.legend!.items[0]!.definition[0]!.text).toBe('组合图的共用说明。')
    const formulas = find('disp-formula').map(el=>mapMediaBlock(el,ctx)![0]!).filter(x=>x.kind === 'formula')
    expect(formulas).toHaveLength(2)
    expect(formulas[0]!.whereList).toHaveLength(3)
    expect(formulas[0]!.notes![0]!.content[0]!.text).toBe('公式注紧跟在公式之后。')
    expect(mapMediaInline(find('inline-graphic')[0]!,ctx)![0]!.image).toMatchObject({src:'data:icon_1',size:'S'})
    expect(ctx.problems.filter(p=>p.severity === 'error')).toEqual([])
  })
  test('[M-6.1-03] 08 样例替代图属于表', () => {
    const {tree,ctx} = setup(readFileSync('../../schemas/gbt46687.2/samples/valid/08-original-forms-vs-sts.xml','utf8'), new Map([['tab_1',{src:'table-image',mediaType:'image/png',resourceId:'image'}]]))
    const visit = (el: XmlElement): XmlElement | undefined => el.name.local === 'table-wrap' ? el : el.children.flatMap(c => c.type === 'element' ? [visit(c)] : []).find(Boolean)
    const result = mapMediaBlock(visit(tree.root)!,ctx)![0]!
    expect(result.kind).toBe('table')
    if (result.kind !== 'table') throw new Error('table')
    expect(result.alternativeGraphic).toMatchObject({src:'table-image',resourceId:'image',contentType:'disp_table'})
    expect(result.unit).toBe('单位为毫米')
    expect(ctx.problems.filter(p=>p.severity === 'error')).toEqual([])
  })
  test('[M-C.1-04] 09 样例保留数组与公式组', () => {
    const {tree,ctx} = setup(readFileSync('../../schemas/gbt46687.2/samples/valid/09-import-pending.xml','utf8'))
    const visit = (el: XmlElement, name: string): XmlElement | undefined => el.name.local === name ? el : el.children.flatMap(c => c.type === 'element' ? [visit(c,name)] : []).find(Boolean)
    const array = mapMediaBlock(visit(tree.root,'array')!,ctx)![0]!
    const group = mapMediaBlock(visit(tree.root,'disp-formula-group')!,ctx)![0]!
    expect(array.kind).toBe('array')
    if (array.kind !== 'array' || group.kind !== 'formulaGroup') throw new Error('array/group')
    expect(array.columnGroups).toEqual([{start:0,count:2}])
    expect(array.rows[0]!.cells.map(c=>(c.content[0] as {content:{text:string}[]}).content[0]!.text)).toEqual(['甲','按列对齐的文本'])
    expect(group.formulas.map(f=>f.numbered)).toEqual([false,false])
    expect(group.numbered).toBe(true)
    expect(ctx.problems.filter(p=>p.severity === 'error')).toEqual([])
  })
  test('[M-8.2-01] 缺少图资源报错', () => {
    const {tree,ctx} = setup('<fig xmlns:xlink="http://www.w3.org/1999/xlink"><graphic xlink:href="missing"/></fig>')
    expect(mapMediaBlock(tree.root,ctx)).toEqual([])
    expect(ctx.problems.some(p=>p.code === 'xml-resource-missing')).toBe(true)
  })

  test('[M-6.1-01] 嵌套表和有缺口的网格必须阻断', () => {
    for (const body of ['<tbody><tr><td><table><tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody>', '<tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></tbody>']) {
      const {tree,ctx} = setup(`<table-wrap><label>表1</label><table>${body}</table></table-wrap>`)
      mapMediaBlock(tree.root,ctx)
      expect(ctx.problems.some(p=>p.severity === 'error')).toBe(true)
    }
  })
  test('[M-8.1-02] 额外图缺资源同样阻断', () => {
    const {tree,ctx} = setup('<fig xmlns:xlink="http://www.w3.org/1999/xlink"><graphic xlink:href="a"/><graphic xlink:href="b"/></fig>',new Map([['a',{src:'A',mediaType:'image/png'}]]))
    mapMediaBlock(tree.root,ctx)
    expect(ctx.problems.some(p=>p.code === 'xml-resource-missing')).toBe(true)
  })

})
