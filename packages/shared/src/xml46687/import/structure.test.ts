import { expect, it } from 'vitest'
import { irToPm } from '../../ir/irToPm'
import { pmToIr } from '../../ir/pmToIr'
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
  expect(list.items[0]!.content[0]!.id).toBe('n2')
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

it('[M-5.6-01] [M-5.6-02] [M-5.6-03] [M-5.6-05] 保留注、示例、警告的多块内容', () => {
  const { tree, ctx } = setup('<non-normative-note><label>注：</label><p>一</p><p>二</p></non-normative-note>')
  expect(mapCoreBlock(tree.root, ctx)).toMatchObject([{ kind: 'note', content: [{ kind: 'paragraph', content: [{ text: '一' }] }, { kind: 'paragraph', content: [{ text: '二' }] }] }])
  expect(ctx.problems).toEqual([])
})

it('[M-4.2-07] [M-4.2-08] [M-4.5.2-06] 附录异写和条的标题保留', () => {
  const { tree, ctx } = setup('<standard><front><std-meta/></front><body/><back><app-group><app content-type="inform_annex"><title>附录</title><sec><title><italic>条</italic></title><p>内容</p></sec></app></app-group></back></standard>')
  const doc = mapStructure(tree, ctx)!
  expect(doc.appendices[0]).toMatchObject({ normative: false, title: [{ text: '附录' }], children: [{ kind: 'clause', title: [{ text: '条', marks: [{ type: 'italic' }] }] }] })
  expect(ctx.problems.some(p => p.severity === 'warning' && p.xml?.path.includes('app[1]'))).toBe(true)
})

it('[M-4.4.2.1-04] 没有跨域处理器时引用内容明确报错', () => {
  const { tree, ctx } = setup('<p>前<xref ref-type="sec" rid="missing">引用</xref>后</p>')
  mapCoreBlock(tree.root, ctx)
  expect(ctx.problems.some(p => p.code === 'xml-unsupported' && p.xml?.path.includes('xref'))).toBe(true)
})

it('[M-5.9-01] [M-5.9-02] [M-5.9-03] 摘录保留正文并提示无法表达的来源和权限', () => {
  const { tree, ctx } = setup('<disp-quote><p>正文</p><attrib specific-use="source">来源</attrib><permissions><copyright-statement>版权</copyright-statement></permissions></disp-quote>')
  expect(mapCoreBlock(tree.root, ctx)).toMatchObject([{ kind: 'quote', content: [{ kind: 'paragraph', content: [{ text: '正文' }] }] }])
  expect(ctx.problems.filter(p => p.severity === 'error')).toEqual([])
  expect(ctx.problems.filter(p => p.severity === 'warning')).toHaveLength(2)
})

it('[M-4.4.2.1-01] 章中子条之后的正文以位置错误阻断', () => {
  const { tree, ctx } = setup('<standard><front><std-meta/></front><body><sec><title>章</title><sec><title>条</title><p>内容</p></sec><p>悬置</p></sec></body></standard>')
  const doc = mapStructure(tree, ctx)!
  expect(doc.body[0]?.children.map(c => c.kind)).toEqual(['clause', 'paragraph'])
  expect(ctx.problems.some(p => p.severity === 'error' && p.xml?.path.endsWith('/p[1]'))).toBe(true)
})

it('[M-5.7-01] [M-5.7-02] [M-5.7-03] [M-5.7-04] [M-5.7-05] [M-5.7-06] 五种列项类型和身份均保留', () => {
  const cases = [['alpha-lower', 'alpha'], ['arabic', 'number'], ['roman-lower', 'roman'], ['dash', 'dash'], ['bullet', 'dot']] as const
  for (const [xmlType, expected] of cases) {
    const { tree, ctx } = setup(`<list list-type="${xmlType}"><list-item><p>文本</p></list-item></list>`)
    const list = mapCoreBlock(tree.root, ctx)?.[0]
    expect(list).toMatchObject({ kind: 'list', listType: expected, items: [{ id: 'n1', content: [{ id: 'n1.p0', content: [{ text: '文本' }] }] }] })
    expect(ctx.problems).toEqual([])
  }
})

it('[M-5.6-02] [M-5.6-03] 示例与警告保留各自种类和正文', () => {
  for (const [xml, kind] of [['<non-normative-example><p>例</p></non-normative-example>', 'example'], ['<non-normative-note content-type="warning"><p>注意</p></non-normative-note>', 'warning']] as const) {
    const { tree, ctx } = setup(xml)
    expect(mapCoreBlock(tree.root, ctx)?.[0]).toMatchObject({ kind, content: [{ kind: 'paragraph' }] })
    expect(ctx.problems).toEqual([])
  }
})

it('[M-5.10-01] 代码块保留换行和空格', () => {
  const { tree, ctx } = setup('<code xml:space="preserve">  x\n    y\n</code>')
  expect(mapCoreBlock(tree.root, ctx)?.[0]).toMatchObject({ kind: 'code', text: '  x\n    y\n' })
  expect(ctx.problems).toEqual([])
})

it('[M-4.1-07] [M-4.2-01] [M-4.2-02] [M-4.2-03] 最小整文保留元数据、前置正文和章', () => {
  const { tree, ctx } = setup('<standard><front><std-meta><title-wrap xml:lang="zh"><full>标准</full></title-wrap><std-ref type="dated">GB/T 1</std-ref></std-meta><sec sec-type="foreword"><title>前言</title><p>前言正文</p></sec><sec sec-type="intro"><title>引言</title><p>引言正文</p></sec></front><body><sec sec-type="scope"><title>范围</title><p>范围正文</p></sec></body></standard>')
  const doc = mapStructure(tree, ctx)!
  expect(doc.meta.title).toBe('标准')
  expect(doc.front.foreword).toMatchObject([{ kind: 'paragraph', content: [{ text: '前言正文' }] }])
  expect(doc.front.introduction).toMatchObject([{ kind: 'paragraph', content: [{ text: '引言正文' }] }])
  expect(doc.body).toMatchObject([{ secType: 'scope', title: [{ text: '范围' }], children: [{ kind: 'paragraph', content: [{ text: '范围正文' }] }] }])
  expect(ctx.problems).toEqual([])
})

it('[M-4.3.3-01] 前言自定义标题无法表达时明确报告', () => {
  const { tree, ctx } = setup('<standard><front><std-meta/><sec sec-type="foreword"><title>自定义前言</title><p>正文</p></sec></front><body/></standard>')
  mapStructure(tree, ctx)
  expect(ctx.problems.some(p => p.severity === 'error' && p.xml?.path.includes('title'))).toBe(true)
})

it('[M-4.5.3-02] 带样式的默认文本仍须保留标题格式', () => {
  const { tree, ctx } = setup('<standard><front><std-meta/></front><body/><back><ref-list content-type="bibl"><title><italic>参考文献</italic></title></ref-list></back></standard>')
  const doc = mapStructure(tree, ctx)!
  expect(doc.bibliographyTitle).toEqual([{ text: '参考文献', marks: [{ type: 'italic' }] }])
})

it('[M-4.2-04] [M-4.2-05] [M-4.2-06] [M-4.4.2.2-01] sec-type 决定章角色而非 XML id', () => {
  const { tree, ctx } = setup('<standard><front><std-meta/></front><body><sec id="sec_3" sec-type="scope"><title>范围</title></sec><sec id="sec_1" sec-type="norm_refs"><title>引用</title></sec><sec id="sec_9" sec-type="terms"><title>术语</title></sec><sec id="sec_2" sec-type="other"><title>一般</title></sec></body></standard>')
  const doc = mapStructure(tree, ctx)!
  expect(doc.body.map(c => c.secType)).toEqual(['scope', 'norm-refs', 'terms', 'general'])
  expect(ctx.problems.filter(p => p.severity === 'warning' && p.xml?.path.includes('/body[1]/sec')).length).toBe(2)
})

it('[M-4.5.2-01] [M-4.5.2-02] [M-4.5.2-04] [M-4.5.2-05] 规范性附录保留标题及类型', () => {
  const { tree, ctx } = setup('<standard><front><std-meta><std-ref type="dated">GB/T 1</std-ref></std-meta></front><body/><back><app-group><app content-type="normative"><label>附录 A</label><annex-type>（规范性）</annex-type><title>规范内容</title><p>正文</p></app></app-group></back></standard>')
  const doc = mapStructure(tree, ctx)!
  expect(doc.appendices).toMatchObject([{ normative: true, title: [{ text: '规范内容' }], children: [{ kind: 'paragraph', content: [{ text: '正文' }] }] }])
  expect(ctx.problems).toEqual([])
})


it('[M-5.7-11] 混合嵌套列表经生产 IR 转换后保留每个段落身份', () => {
  const { tree, ctx } = setup('<standard><front><std-meta><std-ref type="dated">GB/T 1</std-ref></std-meta></front><body><sec><title>章</title><list list-type="bullet"><list-item><p>甲</p></list-item><list-item><p>乙</p><list list-type="dash"><list-item><p>丙</p></list-item></list></list-item></list></sec></body></standard>')
  const doc = mapStructure(tree, ctx)!
  const list = doc.body[0]!.children[0]!
  const restored = pmToIr(irToPm(doc)).doc.body[0]!.children[0]
  if (restored?.kind !== 'list' || list.kind !== 'list') throw new Error('list expected')
  expect(restored.items).toEqual(list.items)
  expect(restored.level).toBe(2)
  expect(ctx.problems).toEqual([])
})
