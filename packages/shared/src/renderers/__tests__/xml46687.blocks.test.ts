import { describe, expect, it } from 'vitest'
import { resolve } from '../../ir/resolve'
import type { IRBlock, IRDoc, IRList } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { site } from '../xml46687Parts/context'
import { createRenderSession } from '../xml46687Parts/dispatch'
import { stubMathMl, stubOptions } from './xml46687StubKit'
import { shouldSkipValidation, validateWithPython } from './xml46687PythonValidation'
import { EMPTY_OPTIONS, bodyOf, chapter, codesOf, exportDoc, find, labelsOf, makeDoc, para, renderOk, renderRuns, run } from './xml46687Kit'

/**
 * 列项、注、示例、警告、摘录、代码（WP8.2 设计 §2.4、§2.5）。
 * 整条管线（`exportXml46687`）渲染，断言 `<body>` 内的片段与问题。
 */

const docWith = (blocks: IRBlock[], rest: Partial<IRDoc> = {}): IRDoc => makeDoc([chapter('ch1', '范围', blocks, 'scope')], rest)
const list = (id: string, listType: IRList['listType'], items: Array<[string, string]>): IRList => ({
  kind: 'list', id, listType, items: items.map(([itemId, text]) => ({ id: itemId, content: [para(`${itemId}.p0`, text)] })),
})
/** 去掉 sec 外壳，只留块的 XML。 */
const blocksOf = (doc: IRDoc): string => {
  const body = bodyOf(renderOk(doc).xml)
  return body.replace(/^\s*<sec[^>]*>\s*<label>[^<]*<\/label>\s*<title>[^<]*<\/title>/, '').replace(/<\/sec>\s*$/, '').replace(/>\s+</g, '><').trim()
}

describe('列项 list（设计 §2.4）', () => {
  it.each([
    ['[M-5.7-02] alpha → alpha-lower', 'alpha', 'alpha-lower'],
    ['[M-5.7-03] number → arabic', 'number', 'arabic'],
    ['[M-5.7-04] roman → roman-lower', 'roman', 'roman-lower'],
    ['[M-5.7-05] dash → dash', 'dash', 'dash'],
    ['[M-5.7-06] dot → bullet', 'dot', 'bullet'],
  ] as const)('%s', (_title, listType, expected) => {
    const xml = blocksOf(docWith([list('l1', listType, [['i1', '项一'], ['i2', '项二']])]))
    expect(xml).toContain(`<list list-type="${expected}">`)
    expect(xml.match(/<list-item>/g)).toHaveLength(2)
  })

  it('[M-5.7-01] list 是 p 的兄弟块，不放进 p；list 不写 id（M-E-22）', () => {
    const xml = blocksOf(docWith([para('p0', '引导语：'), list('l1', 'dash', [['i1', '项一']]), para('p2', '后文')]))
    expect(xml).toBe('<p>引导语：</p><list list-type="dash"><list-item><p>项一</p></list-item></list><p>后文</p>')
    expect(xml).not.toMatch(/<list [^>]*id=/)
  })

  it('[M-5.7-09] 有序项必写 label，取 computeOrderedListMarkers 的标记并把末尾全角“）”转半角（a）→a)）；无序项不写 label', () => {
    const xml = blocksOf(docWith([list('la', 'alpha', [['a1', '甲'], ['a2', '乙']]), list('ln', 'number', [['n1', '一']]), list('lr', 'roman', [['r1', '壹'], ['r2', '贰']]), list('ld', 'dash', [['d1', '横']])]))
    expect(xml).toContain('<list-item><label>a)</label><p>甲</p></list-item>')
    expect(xml).toContain('<list-item><label>b)</label><p>乙</p></list-item>')
    expect(xml).toContain('<list-item><label>1)</label><p>一</p></list-item>')
    expect(xml).toContain('<list-item><label>ii)</label><p>贰</p></list-item>')
    expect(xml).toContain('<list list-type="dash"><list-item><p>横</p></list-item></list>')
    expect(xml).not.toContain('）')
  })

  it('[M-5.7-08] [M-5.7-10] list-item 的文本在无属性的 p 里；嵌套 list 接在同一 list-item 内 p 之后', () => {
    const nested: IRList = list('inner', 'number', [['n1', '内一'], ['n2', '内二']])
    const outer: IRList = { kind: 'list', id: 'outer', listType: 'alpha', items: [{ id: 'o1', content: [para('o1.p0', '外一'), nested] }, { id: 'o2', content: [para('o2.p0', '外二')] }] }
    const xml = blocksOf(docWith([outer]))
    expect(xml).toBe(
      '<list list-type="alpha-lower"><list-item><label>a)</label><p>外一</p>'
      + '<list list-type="arabic"><list-item><label>1)</label><p>内一</p></list-item><list-item><label>2)</label><p>内二</p></list-item></list>'
      + '</list-item><list-item><label>b)</label><p>外二</p></list-item></list>',
    )
  })

  it('[M-10.1.5-02] list-item 仅被引用时写 id（li_<k>）；没有被引用的不写', () => {
    const referencing = para('ref-p', '见', run('b', { type: 'crossRef', targetId: 'a2', targetKind: 'listItem' }))
    const xml = blocksOf(docWith([referencing, list('la', 'alpha', [['a1', '甲'], ['a2', '乙'], ['a3', '丙']])]))
    expect(xml).toContain('<xref ref-type="list" rid="li_1">')
    expect(xml).toContain('<list-item id="li_1"><label>b)</label><p>乙</p></list-item>')
    expect(xml).toContain('<list-item><label>a)</label><p>甲</p></list-item>')
    expect(xml).toContain('<list-item><label>c)</label><p>丙</p></list-item>')
    expect(xml.match(/ id="/g)).toHaveLength(1)
  })

  it('xml-list-type-unsupported（D-X-09）：boxed、romanUpper 没有对应的 list-type，error', () => {
    for (const listType of ['boxed', 'romanUpper'] as const) {
      const result = exportDoc(docWith([list('l1', listType, [['i1', '项']])]))
      expect(result.xml).toBeNull()
      expect(codesOf(result.problems, 'error')).toEqual(['xml-list-type-unsupported'])
      expect(result.problems.find(problem => problem.code === 'xml-list-type-unsupported')).toMatchObject({ nodeId: 'l1', path: 'doc.body[0].children[0]' })
    }
  })

  it('xml-list-empty：没有任何列项的列表，error', () => {
    const result = exportDoc(docWith([list('l1', 'alpha', [])]))
    expect(codesOf(result.problems, 'error')).toEqual(['xml-list-empty'])
  })

  it('list-marker-missing：同一有序列表内只有部分列项有标记（不一致）时，对没有标记的列项报 error，列表类型不变', () => {
    const doc = docWith([list('la', 'alpha', [['a1', '甲'], ['a2', '乙'], ['a3', '丙']])])
    const session = createRenderSession(doc, labelsOf(doc), EMPTY_OPTIONS)
    // 默认策略不会出现“部分有标记”；这里模拟自定义策略：a2 的标记为空串
    ;(session.ctx.orderedMarkers as Record<string, string>)['a2'] = ''
    const rendered = session.ctx.renderBlock(doc.body[0]!.children[0] as IRBlock, site('doc.body[0].children[0]', 'la'))
    session.flushMerged()
    expect(rendered).toHaveLength(1)
    expect(rendered[0]!.attrs.map((attr) => `${attr.name.local}=${attr.value}`)).toEqual(['list-type=alpha-lower'])
    expect(find(session.ctx.problems, 'list-marker-missing')).toHaveLength(1)
    expect(find(session.ctx.problems, 'list-marker-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'a2', path: 'doc.body[0].children[0].items[1]' })
    expect(find(session.ctx.problems, 'list-type-normalized')).toHaveLength(0)
  })

  it('empty-content：列项没有内容时给 warning 并写出空 p', () => {
    const empty: IRList = { kind: 'list', id: 'l1', listType: 'dash', items: [{ id: 'i1', content: [] }] }
    const doc = docWith([empty])
    expect(blocksOf(doc)).toContain('<list-item><p/></list-item>')
    expect(find(renderOk(doc).problems, 'empty-content')).toHaveLength(1)
  })
})

describe('注、示例（设计 §2.5）', () => {
  const note = (id: string, text: string): IRBlock => ({ kind: 'note', id, content: [para(`${id}.p0`, text)] })
  const example = (id: string, text: string): IRBlock => ({ kind: 'example', id, content: [para(`${id}.p0`, text)] })

  it('[M-5.6-01] [M-5.6-04] 注：non-normative-note，label 取 Resolver（单条“注：”、多条“注1：”“注2：”），内容是 p', () => {
    expect(blocksOf(docWith([note('n1', '唯一的注')]))).toBe('<non-normative-note><label>注：</label><p>唯一的注</p></non-normative-note>')
    const xml = blocksOf(docWith([note('n1', '甲'), note('n2', '乙')]))
    expect(xml).toBe('<non-normative-note><label>注1：</label><p>甲</p></non-normative-note><non-normative-note><label>注2：</label><p>乙</p></non-normative-note>')
  })

  it('[M-5.6-02] [M-5.6-04] 示例：non-normative-example，label “示例：”“示例1：”', () => {
    expect(blocksOf(docWith([example('e1', '唯一的示例')]))).toBe('<non-normative-example><label>示例：</label><p>唯一的示例</p></non-normative-example>')
    expect(blocksOf(docWith([example('e1', '甲'), example('e2', '乙')]))).toContain('<label>示例2：</label>')
  })

  it('[M-5.6-01] [M-5.6-02] id 仅被引用时写（note_<n>、example_<n>）；前向引用（注在引用之前）同样成立', () => {
    const ref = (id: string, kind: 'note' | 'example') => para(`ref-${id}`, '见', run('引用', { type: 'crossRef', targetId: id, targetKind: kind }))
    const doc = docWith([note('n1', '甲'), note('n2', '乙'), example('e1', '例'), ref('n2', 'note'), ref('e1', 'example')])
    const xml = blocksOf(doc)
    expect(xml).toContain('<non-normative-note><label>注1：</label><p>甲</p></non-normative-note>')
    expect(xml).toContain('<non-normative-note id="note_2"><label>注2：</label><p>乙</p></non-normative-note>')
    expect(xml).toContain('<non-normative-example id="example_1"><label>示例：</label><p>例</p></non-normative-example>')
    expect(xml).toContain('rid="note_2"')
    expect(xml).toContain('rid="example_1"')
  })

  it('[M-5.6-05] 注/示例内可含多个段落与列项（WP8.M G7）；旧规范形（单段、id 为 ${id}.p0）输出与多块形相同', () => {
    const multi: IRBlock = { kind: 'note', id: 'multi', content: [para('multi.a', '第一段'), list('l1', 'dash', [['i1', '项']]), para('multi.b', '第二段')] }
    expect(blocksOf(docWith([multi]))).toBe(
      '<non-normative-note><label>注：</label><p>第一段</p><list list-type="dash"><list-item><p>项</p></list-item></list><p>第二段</p></non-normative-note>',
    )
  })

  it('[M-5.6-06] [M-5.6-04] 表注、图注、公式注：各在 table-wrap-foot / fig / disp-formula 内写成 non-normative-note，label 取 Resolver（多条时“注1：”“注2：”，作用域各自独立），id 仅被引用时写', () => {
    const tableNote = (id: string, text: string): IRBlock & { kind: 'note' } => ({ kind: 'note', id, content: [para(`${id}.p0`, text)] })
    const table: IRBlock = {
      kind: 'table', id: 't1', caption: [{ text: '表题' }], orientation: 'portrait', headerRowCount: 0, footnotes: [],
      rows: [{ id: 't1.r0', cells: [{ id: 't1.r0c0', colspan: 1, rowspan: 1, header: false, content: [para('t1.r0c0.p0', '值')] }] }],
      notes: [tableNote('n-t1', '表注一'), tableNote('n-t2', '表注二（被引用）')],
    }
    const figure: IRBlock = {
      kind: 'figure', id: 'fig1', caption: [{ text: '图题' }], orientation: 'portrait', src: 'fig.png',
      notes: [tableNote('n-f1', '图注一'), tableNote('n-f2', '图注二（被引用）')],
    }
    const formula: IRBlock = {
      kind: 'formula', id: 'f1', latex: 'x', numbered: true, whereList: [],
      notes: [{ id: 'n-m1', content: [{ text: '公式注一' }] }, { id: 'n-m2', content: [{ text: '公式注二（被引用）' }] }],
    }
    const refs = para('refs', '见',
      run('x', { type: 'crossRef', targetId: 'n-t2', targetKind: 'note' }), run('y', { type: 'crossRef', targetId: 'n-f2', targetKind: 'note' }),
      run('z', { type: 'crossRef', targetId: 'n-m2', targetKind: 'note' }))
    const doc = docWith([table, figure, formula, refs])
    const labels = labelsOf(doc)
    const result = exportXml46687(doc, labels, stubOptions(doc, { f1: stubMathMl() }))
    expect(codesOf(result.problems, 'error')).toEqual([])
    const xml = result.xml!.replace(/>\s+</g, '><')
    const idOf = (id: string): string => labels[id]!.xmlId
    const noteXml = (label: string, text: string, id?: string): string =>
      `<non-normative-note${id ? ` id="${id}"` : ''}><label>${label}</label><p>${text}</p></non-normative-note>`
    // 表注：table-wrap-foot 内，在单位段之后
    expect(/<table-wrap-foot>[\s\S]*?<\/table-wrap-foot>/.exec(xml)![0]).toBe(
      `<table-wrap-foot>${noteXml('注1：', '表注一')}${noteXml('注2：', '表注二（被引用）', idOf('n-t2'))}</table-wrap-foot>`,
    )
    // 图注：fig 内，在 graphic 之后
    expect(/<fig [\s\S]*?<\/fig>/.exec(xml)![0]).toContain(`<graphic content-type="image" xlink:href="fig_1"/>${noteXml('注1：', '图注一')}${noteXml('注2：', '图注二（被引用）', idOf('n-f2'))}</fig>`)
    // 公式注：disp-formula 内，在 mml:math 之后（R-10：Resolver 给公式注 label 与 note_<n>）
    expect(/<disp-formula [\s\S]*?<\/disp-formula>/.exec(xml)![0]).toContain(`</mml:math>${noteXml('注1：', '公式注一')}${noteXml('注2：', '公式注二（被引用）', idOf('n-m2'))}</disp-formula>`)
    // 被引用的三个注各有 xref，没被引用的三个不带 id
    for (const id of ['n-t2', 'n-f2', 'n-m2']) expect(xml).toContain(`rid="${idOf(id)}"`)
    expect(xml.match(/<non-normative-note id=/g)).toHaveLength(3)
  })

  it('xml-note-content（D-X-12）：注/示例/警告内容里出现段落、列项之外的块（如代码）是 error', () => {
    const code: IRBlock = { kind: 'code', id: 'c1', text: 'x' }
    for (const holder of [
      { kind: 'note', id: 'n1', content: [code] },
      { kind: 'example', id: 'e1', content: [code] },
      { kind: 'warning', id: 'w1', content: [code] },
    ] as IRBlock[]) {
      const result = exportDoc(docWith([holder]))
      expect(result.xml, holder.kind).toBeNull()
      expect(codesOf(result.problems, 'error'), holder.kind).toEqual(['xml-note-content'])
      expect(result.problems.find(problem => problem.code === 'xml-note-content')).toMatchObject({ nodeId: 'c1' })
    }
  })

  it('empty-content：没有内容的注写出空 p 并给 warning（V-17 要求注有正文）', () => {
    const doc = docWith([{ kind: 'note', id: 'n1', content: [] }])
    expect(blocksOf(doc)).toBe('<non-normative-note><label>注：</label><p/></non-normative-note>')
    expect(find(renderOk(doc).problems, 'empty-content')).toHaveLength(1)
  })

  it('xml-label-missing：注在 labels 里没有标签时是 error', () => {
    const doc = docWith([note('n1', '注')])
    const labels = { ...labelsOf(doc) }
    delete labels['n1']
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(codesOf(result.problems, 'error')).toContain('xml-label-missing')
  })
})

describe('警告、摘录、代码（设计 §2.5）', () => {
  it('[M-5.6-03] 警告：non-normative-note[@content-type="warning"]，label “警告：”为常量，不写 id（不读 Resolver 的 ext_ 占位）', () => {
    const xml = blocksOf(docWith([{ kind: 'warning', id: 'w1', content: [para('w1.p0', '当心')] }]))
    expect(xml).toBe('<non-normative-note content-type="warning"><label>警告：</label><p>当心</p></non-normative-note>')
  })

  it('[M-5.9-01] [M-5.9-02] 摘录：disp-quote/p，不写 id', () => {
    const xml = blocksOf(docWith([{ kind: 'quote', id: 'q1', content: [para('q1.a', '第一段'), para('q1.b', '第二段')] }]))
    expect(xml).toBe('<disp-quote><p>第一段</p><p>第二段</p></disp-quote>')
  })

  it('xml-quote-content：摘录里出现非段落块是 error', () => {
    const result = exportDoc(docWith([{ kind: 'quote', id: 'q1', content: [list('l1', 'dash', [['i1', '项']])] }]))
    expect(codesOf(result.problems, 'error')).toEqual(['xml-quote-content'])
  })

  it('[M-5.10-01] 代码块：code，文本原样（空白、换行保留，& < > 转义）；language 非空给 warning code-language-not-expressed', () => {
    const { xml, problems } = renderOk(docWith([{ kind: 'code', id: 'c1', language: 'ts', text: 'if (a < b) {\n  return a & b\n}' }]))
    expect(xml).toContain('<code>if (a &lt; b) {\n  return a &amp; b\n}</code>')
    expect(find(problems, 'code-language-not-expressed')).toHaveLength(1)
    expect(find(problems, 'code-language-not-expressed')[0]).toMatchObject({ severity: 'warning', nodeId: 'c1' })
    expect(codesOf(renderOk(docWith([{ kind: 'code', id: 'c2', text: 'x' }])).problems)).not.toContain('code-language-not-expressed')
  })

  it('警告/摘录/代码对象不带任何 id 属性', () => {
    const xml = blocksOf(docWith([
      { kind: 'warning', id: 'w1', content: [para('w1.p0', 'a')] },
      { kind: 'quote', id: 'q1', content: [para('q1.p0', 'b')] },
      { kind: 'code', id: 'c1', text: 'c' },
    ]))
    expect(xml).not.toContain(' id=')
    expect(xml).not.toContain('ext_')
  })
})

describe('渲染时无标识的有序列项按显示形态导出（设计 §2.4；主导决定 2026-10-27）', () => {
  const item = (id: string, text: string, ...nested: IRList[]): IRList['items'][number] => ({ id, content: [para(`${id}.p0`, text), ...nested] })
  const listOf = (id: string, listType: IRList['listType'], ...items: IRList['items']): IRList => ({ kind: 'list', id, listType, items })

  /** 二层 alpha：外层 alpha，内层 alpha 在 HTML/DOCX 中显示为间隔号。 */
  const secondLevelAlpha = (): IRDoc => docWith([listOf('outer', 'alpha', item('o1', '外一', listOf('inner', 'alpha', item('n1', '内一'), item('n2', '内二'))), item('o2', '外二'))])
  /** 二层 roman。 */
  const secondLevelRoman = (): IRDoc => docWith([listOf('outer', 'alpha', item('o1', '外一', listOf('inner', 'roman', item('n1', '内一'), item('n2', '内二'))))])
  /** 三层 number：一、二层 number 有标记（1)、1)），三层没有。 */
  const thirdLevelNumber = (): IRDoc => docWith([
    listOf('l1', 'number', item('a1', '一层', listOf('l2', 'number', item('b1', '二层', listOf('l3', 'number', item('c1', '三层一'), item('c2', '三层二')))))),
  ])

  it('[M-5.7-09] [M-5.7-06] 二层 alpha：内层导出为 bullet、列项不写 label，warning list-type-normalized，导出成功', () => {
    const doc = secondLevelAlpha()
    const { xml, problems } = renderOk(doc)
    expect(blocksOf(doc)).toBe(
      '<list list-type="alpha-lower"><list-item><label>a)</label><p>外一</p>'
      + '<list list-type="bullet"><list-item><p>内一</p></list-item><list-item><p>内二</p></list-item></list>'
      + '</list-item><list-item><label>b)</label><p>外二</p></list-item></list>',
    )
    expect(xml).not.toMatch(/<list list-type="bullet">(?:(?!<\/list>)[\s\S])*<label>/)
    const normalized = find(problems, 'list-type-normalized')
    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({ severity: 'warning', nodeId: 'inner', path: 'doc.body[0].children[0].items[0].content[1]' })
    expect(normalized[0]!.message).toContain('alpha')
    expect(normalized[0]!.message).toContain('嵌套第 2 层')
    expect(normalized[0]!.message).toContain('与 HTML/DOCX 显示一致')
    expect(find(problems, 'list-marker-missing')).toHaveLength(0)
    expect(codesOf(problems, 'error')).toEqual([])
  })

  it('[M-5.7-09] [M-5.7-06] 二层 roman：内层同样导出为 bullet 且不写 label', () => {
    const doc = secondLevelRoman()
    expect(blocksOf(doc)).toBe(
      '<list list-type="alpha-lower"><list-item><label>a)</label><p>外一</p>'
      + '<list list-type="bullet"><list-item><p>内一</p></list-item><list-item><p>内二</p></list-item></list>'
      + '</list-item></list>',
    )
    const normalized = find(renderOk(doc).problems, 'list-type-normalized')
    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({ severity: 'warning', nodeId: 'inner' })
    expect(normalized[0]!.message).toContain('roman')
    expect(normalized[0]!.message).toContain('嵌套第 2 层')
  })

  it('[M-5.7-09] [M-5.7-06] 三层 number：前两层照常写 label，第三层导出为 bullet；消息说明嵌套第 3 层', () => {
    const doc = thirdLevelNumber()
    expect(blocksOf(doc)).toBe(
      '<list list-type="arabic"><list-item><label>1)</label><p>一层</p>'
      + '<list list-type="arabic"><list-item><label>1)</label><p>二层</p>'
      + '<list list-type="bullet"><list-item><p>三层一</p></list-item><list-item><p>三层二</p></list-item></list>'
      + '</list-item></list></list-item></list>',
    )
    const normalized = find(renderOk(doc).problems, 'list-type-normalized')
    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({ severity: 'warning', nodeId: 'l3' })
    expect(normalized[0]!.message).toContain('number')
    expect(normalized[0]!.message).toContain('嵌套第 3 层')
  })

  it('list-type-normalized 按类聚合：同一文档多处合并为一条，列出个数与各处的原 listType、深度', () => {
    const doc = docWith([secondLevelAlpha().body[0]!.children[0] as IRBlock, listOf('x', 'alpha', item('x1', '外', listOf('y', 'roman', item('y1', '内'))))])
    const normalized = find(renderOk(doc).problems, 'list-type-normalized')
    expect(normalized).toHaveLength(1)
    expect(normalized[0]!.message).toContain('共 2 处')
    expect(normalized[0]!.message).toContain('alpha')
    expect(normalized[0]!.message).toContain('roman')
  })

  it('不影响本来就有标记的列表：第一层 alpha/number/roman 与二层 number 照常写 label，无 list-type-normalized', () => {
    const doc = docWith([listOf('outer', 'alpha', item('o1', '外一', listOf('inner', 'number', item('n1', '内一'))))])
    const { problems } = renderOk(doc)
    expect(find(problems, 'list-type-normalized')).toHaveLength(0)
    expect(blocksOf(doc)).toContain('<list list-type="arabic"><list-item><label>1)</label><p>内一</p></list-item></list>')
  })

  it('无序列表（dash/dot）不触发 list-type-normalized，也不写 label', () => {
    const doc = docWith([listOf('l1', 'dash', item('i1', '甲')), listOf('l2', 'dot', item('i2', '乙'))])
    expect(find(renderOk(doc).problems, 'list-type-normalized')).toHaveLength(0)
  })

  describe('被引用的无标识列项（二层 alpha 项）', () => {
    const referencing = (): IRDoc => docWith([
      para('ref-p', '见', run('b）', { type: 'crossRef', targetId: 'n2', targetKind: 'listItem' })),
      ...secondLevelAlpha().body[0]!.children as IRBlock[],
    ])

    it('Resolver 本就报 dangling-xref（没有编号）；渲染器报 error xml-xref-target-unsupported，不导出 XML，且不写 xref', () => {
      const doc = referencing()
      expect(resolve(doc).problems.filter((problem) => problem.code === 'dangling-xref')).toHaveLength(1)
      const result = exportDoc(doc)
      expect(result.xml).toBeNull()
      expect(codesOf(result.problems, 'error')).toEqual(['xml-xref-target-unsupported'])
      const problem = find(result.problems, 'xml-xref-target-unsupported')[0]!
      expect(problem.message).toContain('没有标识')
      expect(problem.message).toContain('n2')
      // 内层列表仍按显示形态规范化，不额外报 list-marker-missing
      expect(find(result.problems, 'list-type-normalized')).toHaveLength(1)
      expect(find(result.problems, 'list-marker-missing')).toHaveLength(0)
    })

    it('该 run 回退为作者原文（不生成 xref、不补写 id，不输出不存在的 b）标识）', () => {
      const doc = referencing()
      const { xml, problems } = renderRuns(doc, [run('见'), run('b）', { type: 'crossRef', targetId: 'n2', targetKind: 'listItem' })])
      expect(xml).toBe('见b）')
      expect(codesOf(problems, 'error')).toEqual(['xml-xref-target-unsupported'])
    })
  })

  describe.skipIf(shouldSkipValidation())('外部校验：python3 -I scripts/xml46687/validate.py --json --profile export', () => {
    it.each([
      ['二层 alpha', secondLevelAlpha],
      ['二层 roman', secondLevelRoman],
      ['三层 number', thirdLevelNumber],
    ] as const)('%s：valid:true，errors:[]（无序列项不带 label，V-5）', (_name, build) => {
      const { xml } = renderOk(build())
      const result = validateWithPython(xml, 'export')
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
    })
  })
})
