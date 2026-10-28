import { describe, expect, it } from 'vitest'
import type { IRDoc } from '../ir/types'
import { getOutputSupportProblems } from './outputBoundary'
import { XML46687_FIGURES_BOUNDARY } from './xml46687Parts/figures'
import { XML46687_DECLARED_DIFFERENCES, findDeclaredDifference, type Xml46687DeclaredDifference } from './xml46687Boundary'
import { expectDeclaredDifferences, expectReleased } from './__tests__/xml46687BoundaryKit'
import { baseDoc, expectOnlyUnknownField, para, pushBlock, pushRun, titleOf, xml46687Paths, xmlPaths } from './__tests__/xml46687BoundaryDomainKit'

/**
 * XML46687 输出边界：T2.4b 的“图与行内图”域放行项（WP8.2 设计 §1.3.2～§1.3.4）。
 *
 * - 逐项正例：每个已声明差异各有一个最小文档，旧 XML 阻断、XML46687 放行；
 * - 富文档：全部本域声明项一起触发，差集恰等于声明集合（计算值），XML46687 零问题；
 * - shape 登记：`legend`（items 复用 where）、`figureDescription`、`inlineImage`、`resource`、`measure` 放行后零问题，未登记字段被精确报出；
 * - 仍阻断：`figure.groups`（D-T-11、D-M-12）、图例/图注里的行内样式。
 * 核心断言（差集等于全体声明集合、永久阻断清单）在 outputBoundaryXml46687.test.ts。
 */

const OWN = XML46687_FIGURES_BOUNDARY.declared
const measure = { value: 40, unit: 'mm' }
const figureOf = (extra: Record<string, unknown> = {}) => ({ kind: 'figure', id: 'fig1', caption: [{ text: '图' }], orientation: 'portrait', src: 'fig1.png', notes: [], ...extra })
const withFigure = (extra: Record<string, unknown> = {}): IRDoc => pushBlock(baseDoc(), figureOf(extra))
const item = (id: string) => ({ id, term: [{ text: '1' }], definition: [{ text: '部件' }] })
const resource = { id: 'res1', mediaType: 'image/png', name: 'a.png', encoding: 'dataUrl', data: 'data:image/png;base64,AAAA' }

/** 声明项 → 恰好触发它的最小文档。键为 `${name}@${pathSuffix}`。 */
const INSTALLERS: Record<string, () => IRDoc> = {
  'legend@.legend': () => withFigure({ legend: { id: 'lg1', title: [{ text: '标引序号说明：' }], items: [item('li1')] } }),
  'examples@.examples': () => withFigure({ examples: [{ kind: 'example', id: 'ex1', content: [para('ex1.p0', '图中示例')] }] }),
  'image@.image': () => pushRun(baseDoc(), { text: '', image: { src: 'inline.png', resourceId: 'res1', alt: '箭头', size: 'M' } }),
  'resourceId@.resourceId': () => withFigure({ resourceId: 'res1' }),
  'descriptions@.descriptions': () => withFigure({ descriptions: [{ id: 'd1', content: [{ text: '说明段' }] }] }),
  'alt@.alt': () => withFigure({ alt: '替代文字' }),
  'title@.title': () => withFigure({ title: '悬停提示' }),
  'imageWidth@.imageWidth': () => withFigure({ imageWidth: measure }),
  'imageHeight@.imageHeight': () => withFigure({ imageHeight: measure }),
  'resources@doc.resources': () => { const doc = baseDoc(); (doc as IRDoc & { resources?: unknown }).resources = [resource]; return doc },
}
const keyOf = (entry: Xml46687DeclaredDifference): string => `${entry.name}@${entry.pathSuffix}`

function richDoc(): IRDoc {
  const doc = pushRun(baseDoc(), { text: '', image: { src: 'inline.png', alt: '箭头', size: 'S' } })
  pushBlock(doc, figureOf({
    unit: '单位为毫米', resourceId: 'res1', alt: '替代文字', title: '悬停提示', imageWidth: measure, imageHeight: measure,
    legend: { id: 'lg1', title: [{ text: '标引序号说明：' }], items: [item('li1'), item('li2')] },
    descriptions: [{ id: 'd1', content: [{ text: '说明段' }] }],
    notes: [{ kind: 'note', id: 'n1', content: [para('n1.p0', '图注')] }],
    examples: [{ kind: 'example', id: 'ex1', content: [para('ex1.p0', '图中示例')] }],
  }))
  ;(doc as IRDoc & { resources?: unknown }).resources = [resource]
  return doc
}

describe('[M-8.5-01] 图域放行项：逐项正例（旧 XML 阻断、XML46687 放行）', () => {
  it('本文件为每个本域声明项准备了安装器，也没有多余的安装器；本域声明项都登记在全局声明集合里，task 为 T2.4b', () => {
    expect(OWN.map(keyOf).sort()).toEqual(Object.keys(INSTALLERS).sort())
    for (const entry of OWN) {
      expect(entry.task).toBe('T2.4b')
      expect(XML46687_DECLARED_DIFFERENCES).toContain(entry)
    }
  })

  it.each(OWN.map((entry) => [titleOf(entry), entry] as const))('逐项正例 %s', (_title, entry) => {
    const doc = INSTALLERS[keyOf(entry)]!()
    expectReleased(doc, entry)
    expectDeclaredDifferences(doc, [entry])
  })

  it('[M-8.4-03] [M-8.3-02] [M-8.2-12] [M-8.2-08] 声明项引用的矩阵行：图中示例、行内图、说明段、图的资源', () => {
    const ids = new Set(OWN.flatMap((entry) => entry.matrixIds))
    for (const id of ['M-8.5-01', 'M-8.5-06', 'M-8.4-03', 'M-8.3-02', 'M-8.2-12', 'M-8.2-08']) expect(ids, id).toContain(id)
  })

  it('富文档：全部本域声明项一起触发，差集恰等于声明集合，XML46687 零问题', () => {
    const doc = richDoc()
    const before = JSON.stringify(doc)
    expectDeclaredDifferences(doc, OWN)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(xmlPaths(doc).length).toBeGreaterThanOrEqual(OWN.length)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('figure.unit 与 table.unit 的路径后缀相同，共用 tables.ts 里的 .unit 声明项（matrixIds 含 M-8.6-01）', () => {
    const doc = withFigure({ unit: '单位为毫米' })
    const declared = findDeclaredDifference(doc, 'doc.body[0].children[1].unit')
    expect(declared).toMatchObject({ kind: 'field', name: 'unit', pathSuffix: '.unit' })
    expect(declared!.matrixIds).toContain('M-8.6-01')
    expectReleased(doc, declared!)
  })
})

describe('shape 登记：放行后零问题，对象里的未登记字段被精确报出', () => {
  const F = 'doc.body[0].children[1]'

  it('legend：id、title、items 合法，items 按 where 校验（id、term、definition）；图例里的未登记字段与图例项的未登记字段被报', () => {
    expect(xml46687Paths(withFigure({ legend: { id: 'lg', title: [{ text: 't' }], items: [item('i1'), item('i2')] } }))).toEqual([])
    expectOnlyUnknownField(withFigure({ legend: { id: 'lg', items: [item('i1')], zzz: 1 } }), `${F}.legend.zzz`)
    expectOnlyUnknownField(withFigure({ legend: { id: 'lg', items: [{ ...item('i1'), zzz: 1 }] } }), `${F}.legend.items[0].zzz`)
  })

  it('图例内容按行内字段表校验：行内样式（颜色）仍被报，路径落在 legend.items 内（D-S-06 永久阻断）', () => {
    const styled = withFigure({ legend: { id: 'lg', items: [{ ...item('i1'), definition: [{ text: '红', style: { color: '#f00' } }] }] } })
    expect(xml46687Paths(styled)).toEqual([`${F}.legend.items[0].definition[0].style`])
  })

  it('figureDescription：id、content 合法，content 按行内字段表校验；未登记字段被报', () => {
    expect(xml46687Paths(withFigure({ descriptions: [{ id: 'd', content: [{ text: 'x', marks: [{ type: 'bold' }] }] }] }))).toEqual([])
    expectOnlyUnknownField(withFigure({ descriptions: [{ id: 'd', content: [], zzz: 1 }] }), `${F}.descriptions[0].zzz`)
  })

  it('imageWidth / imageHeight 按 measure 校验', () => {
    expectOnlyUnknownField(withFigure({ imageWidth: { ...measure, zzz: 1 } }), `${F}.imageWidth.zzz`)
    expectOnlyUnknownField(withFigure({ imageHeight: { ...measure, zzz: 1 } }), `${F}.imageHeight.zzz`)
  })

  it('inlineImage：src、resourceId、alt、size 合法；未登记字段被报', () => {
    expect(xml46687Paths(pushRun(baseDoc(), { text: '', image: { src: 'a.png', resourceId: 'r', alt: 'x', size: 'L' } }))).toEqual([])
    expectOnlyUnknownField(pushRun(baseDoc(), { text: '', image: { src: 'a.png', zzz: 1 } as never }), 'doc.body[0].children[0].content[1].image.zzz')
  })

  it('resource：id、mediaType、name、encoding、data 合法；未登记字段被报', () => {
    const ok = baseDoc() as IRDoc & { resources?: unknown }
    ok.resources = [resource]
    expect(xml46687Paths(ok)).toEqual([])
    const bad = baseDoc() as IRDoc & { resources?: unknown }
    bad.resources = [{ ...resource, zzz: 1 }]
    expectOnlyUnknownField(bad, 'doc.resources[0].zzz')
  })

  it('图中示例（kind 为 example）按 example 字段表校验：未登记字段被报', () => {
    expectOnlyUnknownField(withFigure({ examples: [{ kind: 'example', id: 'ex', content: [], zzz: 1 }] }), `${F}.examples[0].zzz`)
  })
})

describe('仍阻断 / 与旧 XML 相同', () => {
  it('figure.groups 仍被阻断（D-T-11、D-M-12，路径精确）；与放行的字段并存时只报 groups', () => {
    const doc = withFigure({ unit: '单位', legend: { id: 'lg', items: [item('i1')] }, groups: [{ id: 'g1', descriptions: [], resourceRefs: [] }] })
    expect(xml46687Paths(doc)).toEqual(['doc.body[0].children[1].groups'])
    expect(xmlPaths(doc)).toContain('doc.body[0].children[1].groups')
  })

  it('图注（figure.notes）本来就在四种格式里放行；注内的行内图自本任务起对 XML46687 放行', () => {
    const doc = withFigure({ notes: [{ kind: 'note', id: 'n1', content: [{ kind: 'paragraph', id: 'n1.p0', content: [{ text: '', image: { src: 'a.png' } }] }] }] })
    expect(xml46687Paths(doc)).toEqual([])
    expect(xmlPaths(doc)).toEqual(['doc.body[0].children[1].notes[0].content[0].content[0].image'])
  })

  it('旧 XML 对本域字段仍全部阻断（保留旧断言）：legend、examples、image、unit、alt、title、宽高、resourceId、descriptions、doc.resources', () => {
    const blocked = xmlPaths(richDoc()).map((path) => path.replace(/\[\d+\]/g, ''))
    for (const suffix of ['.legend', '.examples', '.image', '.unit', '.alt', '.title', '.imageWidth', '.imageHeight', '.resourceId', '.descriptions', 'doc.resources']) {
      expect(blocked.some((path) => path.endsWith(suffix)), suffix).toBe(true)
    }
  })

  it('HTML 与 DOCX 的结论不受影响：图例、示例、行内图对它们仍阻断', () => {
    const doc = richDoc()
    for (const format of ['HTML', 'DOCX'] as const) {
      const found = getOutputSupportProblems(doc, format).map((problem) => problem.path.replace(/\[\d+\]/g, ''))
      for (const suffix of ['.legend', '.examples', '.image']) expect(found.some((path) => path.endsWith(suffix)), `${format} ${suffix}`).toBe(true)
    }
  })
})
