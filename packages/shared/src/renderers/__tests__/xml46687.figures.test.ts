import { describe, expect, it } from 'vitest'
import type { IRBlock, IRDefItem, IRDoc, IRExample, IRFigure, IRInline, IRNote } from '../../ir/types'
import type { ResourceManifest } from '../../xml46687/resources'
import { exportXml46687, renderXml46687 } from '../xml46687'
import {
  EMPTY_OPTIONS, appendix, chapter, codesOf, deepFreeze, find, labelsOf, makeDoc, para, renderRuns, run,
} from './xml46687Kit'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'
import { stubManifest, stubOptions } from './xml46687StubKit'

/**
 * 图与行内图（WP8.2 设计 §2.7）：fig 的结构与子元素次序、graphic、图例、说明段、图注与图中示例、单位、行内图 inline-graphic，
 * 以及 alt/title/宽高等无表达数据的 warning。整条管线渲染，断言 `<fig>` 内的片段（相邻元素间的缩进空白去掉）与问题。
 */

const figure = (id: string, caption: string, extra: Partial<IRFigure> = {}): IRFigure => ({
  kind: 'figure', id, caption: caption === '' ? [] : [{ text: caption }], orientation: 'portrait', src: `${id}.png`, notes: [], ...extra,
})
const note = (id: string, text: string): IRNote => ({ kind: 'note', id, content: [para(`${id}.p0`, text)] })
const example = (id: string, text: string): IRExample => ({ kind: 'example', id, content: [para(`${id}.p0`, text)] })
const item = (id: string, term: string | IRInline[], definition: string | IRInline[]): IRDefItem => ({
  id, term: typeof term === 'string' ? [{ text: term }] : term, definition: typeof definition === 'string' ? [{ text: definition }] : definition,
})
const image = (extra: Partial<NonNullable<IRInline['image']>> = {}): IRInline => ({ text: '', image: { src: 'inline.png', ...extra } })

const docWith = (blocks: IRBlock[], rest: Partial<IRDoc> = {}): IRDoc => makeDoc([chapter('ch1', '范围', blocks, 'scope')], rest)
const norm = (xml: string): string => xml.replace(/>\s+</g, '><')

/** 导出（资源清单由文档里的图片引用生成）。 */
function exportOk(doc: IRDoc, options = stubOptions(doc)) {
  const result = exportXml46687(doc, labelsOf(doc), options)
  const errors = result.problems.filter((problem) => problem.severity === 'error')
  if (result.xml === null || errors.length > 0) {
    throw new Error(`期望导出成功，但有 error：\n${errors.map((problem) => `${problem.code} ${problem.path}: ${problem.message}`).join('\n')}`)
  }
  return { xml: norm(result.xml), problems: result.problems }
}
/** 渲染并取出第 n 个 `<fig>`。 */
function figXml(blocks: IRBlock[], index = 0) {
  const { xml, problems } = exportOk(docWith(blocks))
  return { xml: [...xml.matchAll(/<fig [\s\S]*?<\/fig>/g)].map((match) => match[0])[index]!, problems, whole: xml }
}

describe('fig 的结构（设计 §2.7）', () => {
  it('[M-8.2-01] [M-8.2-04] [M-8.2-05] [M-8.2-06] [M-8.2-08] [M-8.2-09] fig ＞ label、caption/title、graphic；graphic 的 href 是所属 fig 的 xmlId（无文件夹、无扩展名）', () => {
    const { xml } = figXml([figure('f1', '系统结构示意')])
    expect(xml).toBe('<fig id="fig_1"><label>图1</label><caption><title>系统结构示意</title></caption><graphic content-type="image" xlink:href="fig_1"/></fig>')
  })

  it('[M-8.2-02] [M-8.2-09] id 与 href 来自 Resolver：正文图 fig_1、fig_2，附录图 fig_A.1；各 id 全文唯一', () => {
    const doc = makeDoc(
      [chapter('ch1', '范围', [figure('f1', '甲'), figure('f2', '乙')], 'scope')],
      { appendices: [appendix('app-a', false, '附录', [figure('f3', '丙')])] },
    )
    const { xml } = exportOk(doc)
    expect([...xml.matchAll(/<fig id="([^"]*)"/g)].map((match) => match[1])).toEqual(['fig_1', 'fig_2', 'fig_A.1'])
    expect([...xml.matchAll(/xlink:href="([^"]*)"/g)].map((match) => match[1])).toEqual(['fig_1', 'fig_2', 'fig_A.1'])
    expect(xml).toContain('<label>图A.1</label>')
  })

  it('[M-8.2-10] graphic 写 content-type="image"，不写 specific-use（IR 没有尺寸档位）', () => {
    const { xml } = figXml([figure('f1', '图', { imageWidth: { value: 40, unit: 'mm' } })])
    expect(xml).toContain('<graphic content-type="image" xlink:href="fig_1"/>')
    expect(xml).not.toContain('specific-use')
  })

  it('[M-8.2-03] 横向图写 orientation="landscape"，纵向（默认）不写', () => {
    expect(figXml([figure('f1', '图', { orientation: 'landscape' })]).xml).toContain('<fig id="fig_1" orientation="landscape">')
    expect(figXml([figure('f1', '图')]).xml).toContain('<fig id="fig_1">')
  })

  it('图题内的行内格式如实输出；图题为空时给 warning caption-empty，仍写出 <caption><title/></caption>（schema 要求）', () => {
    const rich = figXml([figure('f1', '', { caption: [{ text: 'V' }, { text: 'o', marks: [{ type: 'sub' }] }, { text: '输出' }] })])
    expect(rich.xml).toContain('<title>V<sub>o</sub>输出</title>')
    const empty = figXml([figure('f1', '')])
    expect(empty.xml).toContain('<caption><title/></caption>')
    expect(find(empty.problems, 'caption-empty')).toHaveLength(1)
    expect(find(empty.problems, 'caption-empty')[0]).toMatchObject({ severity: 'warning', nodeId: 'f1', path: 'doc.body[0].children[0].caption' })
  })

  it('[M-8.2-07] 英文图题在 GB/T 46687.2 中没有写法：warning caption-en-not-expressed，不导出', () => {
    const { xml, problems } = figXml([figure('f1', '图', { captionEn: [{ text: 'System' }] })])
    expect(xml).not.toContain('System')
    expect(find(problems, 'caption-en-not-expressed')).toHaveLength(1)
    expect(find(problems, 'caption-en-not-expressed')[0]).toMatchObject({ severity: 'warning', path: 'doc.body[0].children[0].captionEn' })
  })

  it('[M-8.6-01] 图中单位写成 caption 内 title 之后的 p[@content-type="dimension"]（表放 table-wrap-foot，图放 caption），不写 id；空白单位不写', () => {
    expect(figXml([figure('f1', '抽芯铆钉', { unit: '单位为毫米' })]).xml).toContain(
      '<caption><title>抽芯铆钉</title><p content-type="dimension">单位为毫米</p></caption>',
    )
    expect(figXml([figure('f1', '图', { unit: '  ' })]).xml).not.toContain('dimension')
  })

  it('[M-8.2-12] 图形与图题之间的说明段写成 graphic 之后的 p（inline 容器），不写 id', () => {
    const { xml } = figXml([figure('f1', '图', { descriptions: [
      { id: 'd1', content: [{ text: '第一段说明' }] },
      { id: 'd2', content: [{ text: '第二段', marks: [{ type: 'bold' }] }] },
    ] })])
    expect(xml).toContain('<graphic content-type="image" xlink:href="fig_1"/><p>第一段说明</p><p><bold>第二段</bold></p></fig>')
  })

  it('[M-8.2-11] 图注：graphic 之后的 non-normative-note，label 取 Resolver（单条“注：”，多条“注1：”“注2：”，作用域是本图）', () => {
    expect(figXml([figure('f1', '图', { notes: [note('n1', '唯一的图注')] })]).xml).toContain(
      '<graphic content-type="image" xlink:href="fig_1"/><non-normative-note><label>注：</label><p>唯一的图注</p></non-normative-note></fig>',
    )
    const two = figXml([figure('f1', '图', { notes: [note('n1', '甲'), note('n2', '乙')] })]).xml
    expect(two).toContain('<label>注1：</label><p>甲</p>')
    expect(two).toContain('<label>注2：</label><p>乙</p>')
  })

  it('[M-8.4-03] 图中示例：non-normative-example 接在图注之后（D-M-09：注在前、示例在后），label 取 Resolver', () => {
    const { xml } = figXml([figure('f1', '图', { examples: [example('e1', '图中示例')], notes: [note('n1', '图注')] })])
    expect(xml.indexOf('non-normative-note')).toBeLessThan(xml.indexOf('non-normative-example'))
    expect(xml).toContain('<non-normative-example><label>示例：</label><p>图中示例</p></non-normative-example></fig>')
  })

  it('[M-8.2-11] [M-8.4-03] 图注与图中示例的 id 仅被引用时写（note_<n>、example_<n>）；没有被引用的不写', () => {
    const referencing = para('ref', '见', run('注', { type: 'crossRef', targetId: 'n2', targetKind: 'note' }), run('例', { type: 'crossRef', targetId: 'e1', targetKind: 'example' }))
    const { whole } = figXml([figure('f1', '图', { notes: [note('n1', '甲'), note('n2', '乙')], examples: [example('e1', '例')] }), referencing])
    expect(whole).toContain('<non-normative-note><label>注1：</label><p>甲</p></non-normative-note>')
    expect(whole).toMatch(/<non-normative-note id="note_\d+"><label>注2：<\/label>/)
    expect(whole).toMatch(/<non-normative-example id="example_\d+">/)
    expect(whole.match(/<non-normative-(?:note|example) id=/g)).toHaveLength(2)
  })

  it('完整次序：label、caption（title、单位）、legend、graphic、说明段、图注、图中示例', () => {
    const { xml } = figXml([figure('f1', '图', {
      unit: '单位为毫米', legend: { id: 'lg', items: [item('li1', '1', '部件')] },
      descriptions: [{ id: 'd1', content: [{ text: '说明' }] }], notes: [note('n1', '注')], examples: [example('e1', '例')],
    })])
    const order = ['<label>', '<caption>', '<legend>', '<graphic ', '<p>说明</p>', '<non-normative-note>', '<non-normative-example>'].map((tag) => xml.indexOf(tag))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('图例 legend（M-8.5-01～06）', () => {
  it('[M-8.5-01] [M-8.5-02] [M-8.5-03] [M-8.5-04] [M-8.5-05] [M-8.5-06] legend ＞ title、def-list[@list-content="figure"] ＞ def-item ＞ term、def/p；legend 在 graphic 之前；legend/def-list/def-item/p 都不写 id', () => {
    const { xml } = figXml([figure('f1', '图', { legend: {
      id: 'lg', title: [{ text: '标引序号说明：' }],
      items: [item('li1', '1', '驱动及控制模块；'), item('li2', '2', '传感模块。')],
    } })])
    expect(xml).toBe(
      '<fig id="fig_1"><label>图1</label><caption><title>图</title></caption>'
      + '<legend><title>标引序号说明：</title><def-list list-content="figure">'
      + '<def-item><term>1</term><def><p>驱动及控制模块；</p></def></def-item>'
      + '<def-item><term>2</term><def><p>传感模块。</p></def></def-item></def-list></legend>'
      + '<graphic content-type="image" xlink:href="fig_1"/></fig>',
    )
    expect(xml.match(/ id="/g)).toHaveLength(1)
  })

  it('[M-8.5-02] 图例标题可选：IR 没有标题（或标题为空）时不写 title', () => {
    for (const title of [undefined, []]) {
      const { xml } = figXml([figure('f1', '图', { legend: { id: 'lg', ...(title ? { title } : {}), items: [item('li1', '1', '部件')] } })])
      expect(xml).toContain('<legend><def-list list-content="figure">')
    }
  })

  it('[M-8.5-05] [M-8.5-06] 图例项的符号用 term 容器、含义用 inline 容器：上下标、格式、交叉引用如实输出', () => {
    const { xml } = figXml([
      figure('f1', '图', { legend: { id: 'lg', items: [
        item('li1', [{ text: 'V' }, { text: 'o', marks: [{ type: 'sub' }] }], [{ text: '输出电压', marks: [{ type: 'bold' }] }, { text: '，见' }, run('图A.1', { type: 'crossRef', targetId: 'f2', targetKind: 'figure' })]),
      ] } }),
      figure('f2', '另一幅图'),
    ])
    expect(xml).toContain('<term>V<sub>o</sub></term>')
    expect(xml).toContain('<def><p><bold>输出电压</bold>，见<xref ref-type="fig" rid="fig_2">图2</xref></p></def>')
  })

  it('empty-content（warning）：图例项没有含义时写出空的 p（def 至少需要一个 p）', () => {
    const { xml, problems } = figXml([figure('f1', '图', { legend: { id: 'lg', items: [item('li1', '1', [])] } })])
    expect(xml).toContain('<def-item><term>1</term><def><p/></def></def-item>')
    expect(find(problems, 'empty-content')).toHaveLength(1)
    expect(find(problems, 'empty-content')[0]).toMatchObject({ severity: 'warning', nodeId: 'li1' })
  })

  it('xml-list-empty（error）：图例没有任何项（def-list 至少需要一个 def-item）', () => {
    const doc = docWith([figure('f1', '图', { legend: { id: 'lg', items: [] } })])
    const result = exportXml46687(doc, labelsOf(doc), stubOptions(doc))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-list-empty')).toHaveLength(1)
    expect(find(result.problems, 'xml-list-empty')[0]).toMatchObject({ severity: 'error', nodeId: 'f1', path: 'doc.body[0].children[0].legend.items' })
  })

  it('xml-xref-target-unsupported（error）：对图例项的引用（图例项不可被引用，C-T-31）', () => {
    const doc = docWith([figure('f1', '图', { legend: { id: 'lg', items: [item('li1', '1', '部件')] } }), para('p', '见', run('项', { type: 'crossRef', targetId: 'li1' }))])
    const result = exportXml46687(doc, labelsOf(doc), stubOptions(doc))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-xref-target-unsupported')).toHaveLength(1)
    expect(find(result.problems, 'xml-xref-target-unsupported')[0]!.message).toContain('图例项')
  })
})

describe('行内图 inline-graphic（M-8.3-02、M-8.3-01）', () => {
  const paragraphWith = (id: string, ...runs: IRInline[]): IRBlock => ({ kind: 'paragraph', id, content: runs })

  it('[M-8.3-02] [M-8.3-01] inline-graphic[@xlink:href=inl_<k>] 是空元素；size S/M/L 写成 specific-use="size:S|M|L"，没有尺寸则不写', () => {
    const { xml } = exportOk(docWith([paragraphWith('p1', { text: '图标' }, image({ size: 'S' }), { text: '与' }, image({ size: 'M' }), { text: '和' }, image({ size: 'L' }), image())]))
    expect(xml).toContain('<p>图标<inline-graphic xlink:href="inl_1" specific-use="size:S"/>与<inline-graphic xlink:href="inl_2" specific-use="size:M"/>和'
      + '<inline-graphic xlink:href="inl_3" specific-use="size:L"/><inline-graphic xlink:href="inl_4"/></p>')
  })

  it('[M-8.3-02] k 按 IR 文档序计数，与块图交错也不占序号；同一资源被引用多次也各得各的 href', () => {
    const doc = docWith([
      paragraphWith('p1', image({ resourceId: 'shared' })),
      figure('f1', '图'),
      paragraphWith('p2', image({ resourceId: 'shared' }), image({ src: 'other.png' })),
    ])
    const { xml } = exportOk(doc)
    expect([...xml.matchAll(/<inline-graphic xlink:href="([^"]*)"/g)].map((match) => match[1])).toEqual(['inl_1', 'inl_2', 'inl_3'])
    expect(xml).toContain('xlink:href="fig_1"')
  })

  it('[M-8.3-02] 列项、注、单元格、图注里的段落中的行内图同样写出，href 按文档序', () => {
    const doc = docWith([
      { kind: 'list', id: 'l1', listType: 'dash', items: [{ id: 'li', content: [paragraphWith('li.p', image())] }] },
      { kind: 'note', id: 'n1', content: [paragraphWith('n1.p', image())] },
      { kind: 'table', id: 't1', caption: [{ text: '表' }], orientation: 'portrait', headerRowCount: 0, notes: [], rows: [{ id: 'r', cells: [{ id: 'c', colspan: 1, rowspan: 1, header: false, content: [paragraphWith('c.p', image())] }] }] },
      figure('f1', '图', { notes: [{ kind: 'note', id: 'fn1', content: [paragraphWith('fn1.p', image())] }] }),
    ])
    const { xml } = exportOk(doc)
    expect([...xml.matchAll(/<inline-graphic xlink:href="([^"]*)"/g)].map((match) => match[1])).toEqual(['inl_1', 'inl_2', 'inl_3', 'inl_4'])
  })

  it('[M-8.3-02] 图与行内图的 alt、title、宽高在 STS 中没有对应属性：聚合 warning figure-attr-not-expressed（共 N 处）', () => {
    const { problems, xml } = exportOk(docWith([
      figure('f1', '图', { alt: '系统结构', title: '悬停提示', imageWidth: { value: 40, unit: 'mm' } }),
      paragraphWith('p1', image({ alt: '箭头' })),
    ]))
    expect(xml).not.toMatch(/alt=|title="|系统结构|箭头/)
    const warnings = find(problems, 'figure-attr-not-expressed')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ severity: 'warning' })
    expect(warnings[0]!.message).toContain('共 4 处')
  })

  it('formula-in-text-only（error）：纯文本容器里的行内图（图的内容会丢失）', () => {
    const doc = docWith([figure('f1', '图'), paragraphWith('p1', image())])
    const { problems } = renderRuns(doc, [image()], 'text')
    expect(find(problems, 'formula-in-text-only')).toHaveLength(1)
    expect(find(problems, 'formula-in-text-only')[0]).toMatchObject({ severity: 'error', path: 'doc.test.content[0].image' })
  })
})

describe('错误与资源清单（设计 §3.4、§4.3）', () => {
  it('xml-label-missing（error）：Resolver 没有给出图的标签（缺 xmlId）或编号文本为空', () => {
    const doc = docWith([figure('f1', '图')])
    const missing = labelsOf(doc)
    delete missing.f1
    const result = exportXml46687(doc, missing, stubOptions(doc))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-label-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'f1', path: 'doc.body[0].children[0]' })
    const blank = labelsOf(doc)
    blank.f1 = { ...blank.f1!, label: '' }
    expect(find(exportXml46687(doc, blank, stubOptions(doc)).problems, 'xml-label-missing')).toHaveLength(1)
  })

  it('resource-missing（error）：资源清单里没有图的 href（fig_1）或行内图的 href（inl_1）', () => {
    const doc = docWith([figure('f1', '图'), { kind: 'paragraph', id: 'p1', content: [image()] }])
    const empty = exportXml46687(doc, labelsOf(doc), EMPTY_OPTIONS)
    expect(empty.xml).toBeNull()
    expect(find(empty.problems, 'resource-missing').map((problem) => problem.message.includes('fig_1') || problem.message.includes('inl_1'))).toEqual([true, true])
    expect(find(empty.problems, 'resource-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'f1' })
  })

  it('resource-mismatch（error）：清单条目的资源键与图的资源键不一致', () => {
    const doc = docWith([figure('f1', '图', { resourceId: 'res-1' })])
    const manifest: ResourceManifest = { version: 1, entries: [{ href: 'fig_1', key: 'other', fileName: 'fig_1.png', mediaType: 'image/png', source: 'resource' }] }
    const result = exportXml46687(doc, labelsOf(doc), { mathml: {}, resources: manifest })
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'resource-mismatch')).toHaveLength(1)
  })

  it('resource-unused（info）：清单里多出文档没有用到的条目', () => {
    const doc = docWith([figure('f1', '图')])
    const manifest = stubManifest(doc)
    manifest.entries.push({ href: 'spare', key: 'spare.png', fileName: 'spare.png', mediaType: 'image/png', source: 'resource' })
    const result = exportXml46687(doc, labelsOf(doc), { mathml: {}, resources: manifest })
    expect(result.xml).not.toBeNull()
    expect(find(result.problems, 'resource-unused')).toHaveLength(1)
    expect(find(result.problems, 'resource-unused')[0]).toMatchObject({ severity: 'info' })
  })
})

describe('确定性与不修改输入', () => {
  const rich = (): IRDoc => docWith([
    figure('f1', '图', {
      unit: '单位为毫米', legend: { id: 'lg', title: [{ text: '说明：' }], items: [item('li', '1', '部件')] },
      descriptions: [{ id: 'd', content: [{ text: '说明段' }] }], notes: [note('n', '注')], examples: [example('e', '例')],
    }),
    { kind: 'paragraph', id: 'p1', content: [{ text: '行内' }, image({ size: 'M' })] },
  ])

  it('同一输入两次导出逐字节相同；深冻结的输入不被修改、不抛错', () => {
    const doc = rich()
    const first = renderXml46687(doc, labelsOf(doc), stubOptions(doc))
    expect(renderXml46687(doc, labelsOf(doc), stubOptions(doc))).toBe(first)
    const frozen = deepFreeze(rich())
    const before = JSON.stringify(frozen)
    expect(renderXml46687(frozen, labelsOf(frozen), stubOptions(frozen))).toBe(first)
    expect(JSON.stringify(frozen)).toBe(before)
  })
})

/** 域黄金样例：图的主要写法一次出齐（图题与单位、图例、说明段、图注、图中示例、横向图、附录图、行内图三种尺寸）。 */
function domainDoc(): IRDoc {
  const main = figure('fig-main', '系统结构示意', {
    unit: '单位为毫米',
    legend: { id: 'fig-main-lg', title: [{ text: '标引序号说明：' }], items: [
      item('fig-main-lg1', '1', '驱动及控制模块；'),
      item('fig-main-lg2', '2', [{ text: '传感模块，见' }, run('图A.1', { type: 'crossRef', targetId: 'fig-app', targetKind: 'figure' }), { text: '。' }]),
      item('fig-main-lg3', [{ text: 'V' }, { text: 'o', marks: [{ type: 'sub' }] }], [{ text: '输出电压', marks: [{ type: 'bold' }] }, { text: '。' }]),
    ] },
    descriptions: [{ id: 'fig-main-d1', content: [{ text: '图形与图题之间的说明段落。' }] }],
    notes: [note('fig-main-n1', '图注一。'), note('fig-main-n2', '图注二。')],
    examples: [example('fig-main-e1', '图中示例。')],
    alt: '系统结构', title: '悬停提示',
  })
  const wide = figure('fig-wide', '横向图', { orientation: 'landscape' })
  const appendixFigure = figure('fig-app', '附录中的图', { notes: [note('fig-app-n1', '附录图注。')] })
  return makeDoc(
    [
      chapter('ch1', '范围', [
        para('scope-p', '见', run('图1', { type: 'crossRef', targetId: 'fig-main', targetKind: 'figure' }), '，图注', run('注2', { type: 'crossRef', targetId: 'fig-main-n2', targetKind: 'note' }), '。'),
        { kind: 'paragraph', id: 'scope-icons', content: [{ text: '状态图标' }, image({ size: 'S', alt: '就绪' }), { text: '、' }, image({ size: 'M' }), { text: '、' }, image({ size: 'L' }), { text: '、' }, image()] },
      ], 'scope'),
      chapter('ch2', '图', [main, wide], 'general'),
    ],
    { appendices: [appendix('app-a', false, '附录', [appendixFigure])] },
  )
}

describe('域黄金样例：图', () => {
  const doc = domainDoc()
  const labels = labelsOf(doc)
  const options = stubOptions(doc)

  it('XML 文件快照（toMatchFileSnapshot，便于直接喂给 validate.py）', async () => {
    await expect(renderXml46687(doc, labels, options)).toMatchFileSnapshot('__snapshots__/xml46687.figures.xml')
  })

  it('问题集合恰为预期（防止告警悄悄增多）：没有 error；alt/title 聚合 warning、标准类型 info', () => {
    const { problems } = exportXml46687(doc, labels, options)
    expect(codesOf(problems, 'error')).toEqual([])
    expect(problems.map((problem) => `${problem.severity} ${problem.code}`)).toEqual(['info meta-not-expressed', 'warning figure-attr-not-expressed'])
  })

  it('fig 总带 id，graphic 的 href 恰是各 fig 的 id；行内图 href 为 inl_1～inl_4', () => {
    const xml = renderXml46687(doc, labels, options)
    expect([...xml.matchAll(/<graphic [^>]*xlink:href="([^"]*)"/g)].map((match) => match[1])).toEqual(['fig_1', 'fig_2', 'fig_A.1'])
    expect([...xml.matchAll(/<fig id="([^"]*)"/g)].map((match) => match[1])).toEqual(['fig_1', 'fig_2', 'fig_A.1'])
    expect([...xml.matchAll(/<inline-graphic xlink:href="([^"]*)"/g)].map((match) => match[1])).toEqual(['inl_1', 'inl_2', 'inl_3', 'inl_4'])
  })
})

describe.skipIf(shouldSkipValidation())('外部校验：python3 -I scripts/xml46687/validate.py --json --profile export', () => {
  it('域黄金样例：valid:true，errors:[]，warnings:[]', () => {
    const doc = domainDoc()
    const result = validateWithPython(renderXml46687(doc, labelsOf(doc), stubOptions(doc)), 'export')
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('sts_compat.py（与官方 NISO STS 1.2 DTD 对照）：退出码 0，零未解释偏差', () => {
    const doc = domainDoc()
    const result = stsCompatWithPython(renderXml46687(doc, labelsOf(doc), stubOptions(doc)))
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('未解释偏差 0 个')
  })
})
