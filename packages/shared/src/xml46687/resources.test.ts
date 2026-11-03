import { describe, expect, it } from 'vitest'
import { collectXml46687ImageRefs, type ResourceManifest, type Xml46687ImageRef } from './resources'
import { resolve } from '../ir/resolve'
import type { IRBlock, IRChapterChild, IRClause, IRDoc, IRInline, IRParagraph, NodeId, ResolvedLabel } from '../ir/types'
import { createWp8mIrDoc } from '../ir/__tests__/wp8mFixtures'
import { g3IrDoc } from '../ir/__tests__/wp8mG3Fixtures'

const img = (src: string, extra: Partial<NonNullable<IRInline['image']>> = {}): IRInline => ({ text: '', image: { src, ...extra } })
const t = (text: string): IRInline => ({ text })
const para = (id: NodeId, ...content: IRInline[]): IRParagraph => ({ kind: 'paragraph', id, content })
const fig = (id: NodeId, src: string, extra: Record<string, unknown> = {}): IRBlock =>
  ({ kind: 'figure', id, caption: [t('图题')], orientation: 'portrait', src, notes: [], ...extra }) as IRBlock
const label = (xmlId: string): ResolvedLabel => ({ label: xmlId, xmlId, refText: xmlId })

interface DocParts {
  foreword?: IRBlock[]
  introduction?: IRBlock[]
  introductionClauses?: IRClause[]
  chapters?: IRChapterChild[][]
  appendices?: IRChapterChild[][]
}

function makeDoc(parts: DocParts = {}): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: {
      foreword: parts.foreword ?? [],
      introduction: parts.introduction ?? [],
      ...(parts.introductionClauses ? { introductionClauses: parts.introductionClauses } : {}),
    },
    body: (parts.chapters ?? []).map((children, index) => ({
      kind: 'chapter' as const, id: `ch${index + 1}`, secType: 'general' as const, title: [t(`章${index + 1}`)], children,
    })),
    appendices: (parts.appendices ?? []).map((children, index) => ({
      kind: 'appendix' as const, id: `app${index + 1}`, normative: true, title: [t(`附录${index + 1}`)], children,
    })),
    bibliography: [],
  }
}

/** 按 `JSON.stringify` 的独立计数：任何位置的行内图载荷都以 `"image":{` 出现。 */
const countInlineImagesInJson = (value: unknown): number => (JSON.stringify(value).match(/"image":\{/g) ?? []).length

const summary = (refs: Xml46687ImageRef[]) => refs.map((ref) => `${ref.kind}:${ref.href}@${ref.ownerId}`)

describe('collectXml46687ImageRefs：块图', () => {
  it('附加图和表替代图各自保留归属、资源键及确定性 href', () => {
    const doc = makeDoc({ chapters: [[
      fig('f1', 'main.png', { additionalGraphics: [{ id: 'g2', src: 'extra.png', resourceId: 'shared' }, { id: 'g3', src: 'other.png', resourceId: 'shared' }] }),
      { kind: 'table', id: 't1', caption: [], orientation: 'portrait', headerRowCount: 0, rows: [], notes: [],
        alternativeGraphic: { id: 'a1', src: 'alt.png', resourceId: 'shared' } },
    ]] })
    expect(collectXml46687ImageRefs(doc, { f1: label('fig_1'), t1: label('table_1') })).toEqual([
      { href: 'fig_1', key: 'main.png', kind: 'figure', ownerId: 'f1', path: 'doc.body[0].children[0]' },
      { href: 'fig_1_g1', key: 'shared', kind: 'figure-extra', ownerId: 'g2', path: 'doc.body[0].children[0].additionalGraphics[0]' },
      { href: 'fig_1_g2', key: 'shared', kind: 'figure-extra', ownerId: 'g3', path: 'doc.body[0].children[0].additionalGraphics[1]' },
      { href: 'table_1_alt', key: 'shared', kind: 'table-alternative', ownerId: 'a1', path: 'doc.body[0].children[1].alternativeGraphic' },
    ])
  })
  it('href 取所属 fig 的 xmlId，key 取 resourceId，缺省回退 src，ownerId 为图自身', () => {
    const doc = makeDoc({
      chapters: [[fig('f1', 'data:image/png;base64,AAAA', { resourceId: 'res-1' }), fig('f2', 'pics/b.png')]],
    })
    expect(collectXml46687ImageRefs(doc, { f1: label('fig_1'), f2: label('fig_2') })).toEqual([
      { href: 'fig_1', key: 'res-1', kind: 'figure', ownerId: 'f1', path: 'doc.body[0].children[0]' },
      { href: 'fig_2', key: 'pics/b.png', kind: 'figure', ownerId: 'f2', path: 'doc.body[0].children[1]' },
    ])
  })

  it('附录图使用附录图号的 xmlId，path 指向附录', () => {
    const doc = makeDoc({
      chapters: [[para('p1', t('正文'))]],
      appendices: [[para('ap1', t('附录正文')), fig('fa1', 'a.svg')]],
    })
    expect(collectXml46687ImageRefs(doc, { fa1: label('fig_A.1') })).toEqual([
      { href: 'fig_A.1', key: 'a.svg', kind: 'figure', ownerId: 'fa1', path: 'doc.appendices[0].children[1]' },
    ])
  })

  it('图在 labels 中缺条目或 xmlId 为空时不生成条目、不抛错，其余图照常收集', () => {
    const doc = makeDoc({ chapters: [[fig('f1', 'a.png'), fig('f2', 'b.png'), fig('f3', 'c.png')]] })
    const labels = { f2: label('fig_2'), f3: { label: '图3', xmlId: '', refText: '图3' } }
    let refs: Xml46687ImageRef[] = []
    expect(() => { refs = collectXml46687ImageRefs(doc, labels) }).not.toThrow()
    expect(summary(refs)).toEqual(['figure:fig_2@f2'])
  })

  it('图的 id 与 Object.prototype 上的名字重合时不会误取原型属性', () => {
    const doc = makeDoc({ chapters: [[fig('constructor', 'a.png'), fig('toString', 'b.png')]] })
    expect(collectXml46687ImageRefs(doc, {})).toEqual([])
  })

  it('嵌套在表格单元格里的图同样收集', () => {
    const nested = {
      kind: 'table', id: 't1', caption: [t('表')], orientation: 'portrait', headerRowCount: 0, notes: [],
      rows: [{ id: 'r1', cells: [{ id: 'c1', colspan: 1, rowspan: 1, header: false, content: [fig('f-in-cell', 'cell.png')] }] }],
    } as unknown as IRBlock
    const doc = makeDoc({ chapters: [[nested]] })
    expect(collectXml46687ImageRefs(doc, { 'f-in-cell': label('fig_9') })).toEqual([
      { href: 'fig_9', key: 'cell.png', kind: 'figure', ownerId: 'f-in-cell', path: 'doc.body[0].children[0].rows[0].cells[0].content[0]' },
    ])
  })

  it('其他对象的 kind 字段恰为 "figure"（如变量 mark 的 kind）不被当成图', () => {
    const doc = makeDoc({
      chapters: [[para('p1', { text: 'x', marks: [{ type: 'variable', kind: 'figure', name: 'f' }] })]],
    })
    expect(collectXml46687ImageRefs(doc, { p1: label('fig_1') })).toEqual([])
  })
})

describe('collectXml46687ImageRefs：行内图', () => {
  it('[M-8.3-02] href 为 inl_<k>，k 从 1 起按段落内 run 顺序，key 取 resourceId、缺省回退 src，ownerId 为所在段落', () => {
    const doc = makeDoc({
      chapters: [[para('p1', t('前'), img('a.png', { size: 'S' }), t('中'), img('data:image/png;base64,BBBB', { resourceId: 'res-b' }), t('后'))]],
    })
    expect(collectXml46687ImageRefs(doc, {})).toEqual([
      { href: 'inl_1', key: 'a.png', kind: 'inline', ownerId: 'p1', path: 'doc.body[0].children[0].content[1]' },
      { href: 'inl_2', key: 'res-b', kind: 'inline', ownerId: 'p1', path: 'doc.body[0].children[0].content[3]' },
    ])
  })

  it('段落、列项（含嵌套）、注、示例、单元格、表注、图注、图中注与示例、图例中的行内图都被收集（通用深度遍历）', () => {
    const innerPara = (id: NodeId, src: string): IRParagraph => para(id, t('内'), img(src))
    const chapter: IRBlock[] = [
      para('p-body', img('body.png')),
      {
        kind: 'list', id: 'l1', listType: 'dash',
        items: [
          { id: 'l1-i1', content: [innerPara('l1-i1-p', 'list.png')] },
          { id: 'l1-i2', content: [{ kind: 'list', id: 'l1-nested', listType: 'number', items: [{ id: 'l1-n1', content: [innerPara('l1-n1-p', 'nested.png')] }] }] },
        ],
      },
      { kind: 'note', id: 'n1', content: [innerPara('n1-p', 'note.png')] },
      { kind: 'example', id: 'e1', content: [innerPara('e1-p', 'example.png')] },
      {
        kind: 'table', id: 't1', caption: [t('表题'), img('table-caption.png')], orientation: 'portrait', headerRowCount: 0,
        rows: [{ id: 'r1', cells: [{ id: 'c1', colspan: 1, rowspan: 1, header: false, content: [innerPara('c1-p', 'cell.png')] }] }],
        notes: [{ kind: 'note', id: 'tn1', content: [innerPara('tn1-p', 'table-note.png')] }],
      },
      {
        kind: 'figure', id: 'f1', caption: [t('图题'), img('figure-caption.png')], orientation: 'portrait', src: 'main.png',
        notes: [{ kind: 'note', id: 'fn1', content: [innerPara('fn1-p', 'figure-note.png')] }],
        legend: { id: 'lg1', title: [img('legend-title.png')], items: [{ id: 'lg1-i1', term: [img('legend-term.png')], definition: [img('legend-def.png')] }] },
        examples: [{ kind: 'example', id: 'fe1', content: [innerPara('fe1-p', 'figure-example.png')] }],
      },
      { kind: 'quote', id: 'q1', content: [innerPara('q1-p', 'quote.png')] },
      { kind: 'warning', id: 'w1', content: [innerPara('w1-p', 'warning.png')] },
      { kind: 'defList', id: 'dl1', items: [{ id: 'dl1-i1', term: [t('术语')], definition: [img('deflist.png')] }] },
      { kind: 'formula', id: 'fm1', latex: 'x', numbered: false, whereList: [{ id: 'fm1-w1', term: [img('where.png')], definition: [t('量')] }] },
      para('p-footnote', { text: '带脚注', footnote: { id: 'fnote1', content: [t('注'), img('footnote.png')] } }),
    ]
    const doc = makeDoc({ chapters: [chapter] })
    const refs = collectXml46687ImageRefs(doc, { f1: label('fig_1') })

    expect(refs.map((ref) => `${ref.href}=${ref.key}`)).toEqual([
      'inl_1=body.png', 'inl_2=list.png', 'inl_3=nested.png', 'inl_4=note.png', 'inl_5=example.png',
      'inl_6=table-caption.png', 'inl_7=cell.png', 'inl_8=table-note.png',
      'fig_1=main.png', 'inl_9=figure-caption.png', 'inl_10=figure-note.png', 'inl_11=legend-title.png',
      'inl_12=legend-term.png', 'inl_13=legend-def.png', 'inl_14=figure-example.png',
      'inl_15=quote.png', 'inl_16=warning.png', 'inl_17=deflist.png', 'inl_18=where.png', 'inl_19=footnote.png',
    ])
    // 与实现无关的独立计数：JSON 里有多少个行内图载荷，就必须收集到多少个
    expect(refs.filter((ref) => ref.kind === 'inline')).toHaveLength(countInlineImagesInJson(doc.body))
    // ownerId：最近一层带 id 的祖先
    const owners = Object.fromEntries(refs.map((ref) => [ref.key, ref.ownerId]))
    expect(owners).toMatchObject({
      'body.png': 'p-body', 'list.png': 'l1-i1-p', 'nested.png': 'l1-n1-p', 'note.png': 'n1-p', 'example.png': 'e1-p',
      'table-caption.png': 't1', 'cell.png': 'c1-p', 'table-note.png': 'tn1-p',
      'figure-caption.png': 'f1', 'figure-note.png': 'fn1-p', 'legend-title.png': 'lg1', 'legend-term.png': 'lg1-i1',
      'legend-def.png': 'lg1-i1', 'figure-example.png': 'fe1-p', 'quote.png': 'q1-p', 'warning.png': 'w1-p',
      'deflist.png': 'dl1-i1', 'where.png': 'fm1-w1', 'footnote.png': 'fnote1',
    })
  })

  it('术语条目与条标题里的行内图也被收集（位置是否合法由 Resolver 与输出边界判定）', () => {
    const doc = makeDoc({
      chapters: [[
        {
          kind: 'clause', id: 'cl1', level: 1, titled: true, title: [t('条'), img('clause-title.png')],
          children: [{
            kind: 'termEntry', id: 'te1', term: [t('术语'), img('term.png')], definition: [para('te1-d', img('definition.png'))],
            notes: [{ kind: 'note', id: 'te1-n', content: [para('te1-n-p', img('term-note.png'))] }], examples: [],
          }],
        },
      ]],
    })
    expect(collectXml46687ImageRefs(doc, {}).map((ref) => `${ref.href}=${ref.key}@${ref.ownerId}`)).toEqual([
      'inl_1=clause-title.png@cl1', 'inl_2=term.png@te1', 'inl_3=definition.png@te1-d', 'inl_4=term-note.png@te1-n-p',
    ])
  })

  it('重复资源：相同 src 或 resourceId 的多处引用各得各的 href；同一资源的块图与行内图互不影响', () => {
    const doc = makeDoc({
      chapters: [[
        para('p1', img('same.png'), t(' '), img('same.png'), t(' '), img('data:ignored', { resourceId: 'res-1' })),
        para('p2', img('x', { resourceId: 'res-1' })),
        fig('f1', 'same.png', { resourceId: 'res-1' }),
        fig('f2', 'same.png', { resourceId: 'res-1' }),
      ]],
    })
    const refs = collectXml46687ImageRefs(doc, { f1: label('fig_1'), f2: label('fig_2') })
    expect(refs.map((ref) => `${ref.href}=${ref.key}`)).toEqual([
      'inl_1=same.png', 'inl_2=same.png', 'inl_3=res-1', 'inl_4=res-1', 'fig_1=res-1', 'fig_2=res-1',
    ])
    expect(new Set(refs.map((ref) => ref.href)).size).toBe(refs.length)
  })
})

describe('collectXml46687ImageRefs：顺序', () => {
  it('文档序为前言、引言、引言条、各章、各附录；块图不占 inl 序号', () => {
    const doc = makeDoc({
      foreword: [para('fw', img('foreword.png'))],
      introduction: [para('in', img('intro.png')), fig('fig-in', 'intro-fig.png')],
      introductionClauses: [{
        kind: 'clause', id: 'ic1', level: 1, titled: true, title: [t('引言条')],
        children: [para('ic1-p', img('intro-clause.png'))],
      }],
      chapters: [
        [fig('fig-1', 'ch1-fig.png'), para('ch1-p', img('ch1.png'))],
        [para('ch2-p', img('ch2.png'))],
      ],
      appendices: [[fig('fig-a', 'app-fig.png'), para('app-p', img('app.png'))]],
    })
    const refs = collectXml46687ImageRefs(doc, { 'fig-in': label('fig_0'), 'fig-1': label('fig_1'), 'fig-a': label('fig_A.1') })
    expect(summary(refs)).toEqual([
      'inline:inl_1@fw', 'inline:inl_2@in', 'figure:fig_0@fig-in', 'inline:inl_3@ic1-p',
      'figure:fig_1@fig-1', 'inline:inl_4@ch1-p', 'inline:inl_5@ch2-p', 'figure:fig_A.1@fig-a', 'inline:inl_6@app-p',
    ])
    expect(refs.map((ref) => ref.path)).toEqual([
      'doc.front.foreword[0].content[0]', 'doc.front.introduction[0].content[0]', 'doc.front.introduction[1]',
      'doc.front.introductionClauses[0].children[0].content[0]',
      'doc.body[0].children[0]', 'doc.body[0].children[1].content[0]', 'doc.body[1].children[0].content[0]',
      'doc.appendices[0].children[0]', 'doc.appendices[0].children[1].content[0]',
    ])
  })

  it('没有任何图时返回空数组；缺 introductionClauses 字段的旧文档也能处理', () => {
    expect(collectXml46687ImageRefs(makeDoc({ chapters: [[para('p1', t('无图'))]] }), {})).toEqual([])
    expect(collectXml46687ImageRefs(makeDoc(), {})).toEqual([])
  })
})

describe('collectXml46687ImageRefs：纯函数', () => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value)
      for (const child of Object.values(value)) deepFreeze(child)
    }
    return value
  }

  it('不修改输入，重复调用结果相同，结果可 JSON 往返', () => {
    const doc = makeDoc({ chapters: [[para('p1', img('a.png')), fig('f1', 'b.png', { resourceId: 'res-b' })]] })
    const labels = { f1: label('fig_1') }
    const before = JSON.stringify({ doc, labels })
    deepFreeze(doc)
    deepFreeze(labels)
    const first = collectXml46687ImageRefs(doc, labels)
    const second = collectXml46687ImageRefs(doc, labels)
    expect(second).toEqual(first)
    expect(JSON.stringify({ doc, labels })).toBe(before)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })

  it('返回的条目可直接组装成 ResourceManifest 并 JSON 往返', () => {
    const doc = makeDoc({ chapters: [[para('p1', img('data:image/png;base64,AAAA')), fig('f1', 'b.svg')]] })
    const manifest: ResourceManifest = {
      version: 1,
      entries: collectXml46687ImageRefs(doc, { f1: label('fig_1') }).map((ref) => ({
        href: ref.href,
        key: ref.key,
        fileName: `${ref.href}.${ref.kind === 'figure' ? 'svg' : 'png'}`,
        mediaType: ref.kind === 'figure' ? 'image/svg+xml' : 'image/png',
        source: ref.kind === 'figure' ? 'src' : 'dataUrl',
      })),
    }
    expect(manifest.entries.map((entry) => entry.fileName)).toEqual(['inl_1.png', 'fig_1.svg'])
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  })
})

describe('collectXml46687ImageRefs：真实夹具', () => {
  it('WP8.M G3 夹具（Resolver 标签）：行内图与块图按文档序、各得各的 href', () => {
    const doc = g3IrDoc()
    const refs = collectXml46687ImageRefs(doc, resolve(doc).labels)
    expect(summary(refs)).toEqual([
      'inline:inl_1@g3-scope-p',
      'inline:inl_2@g3-ch-p', 'inline:inl_3@g3-ch-p',
      'figure:fig_1@g3-fig-1', 'figure:fig_2@g3-fig-2',
      'inline:inl_4@g3-list-i1.p0', 'inline:inl_5@g3-note.p0', 'inline:inl_6@g3-tab-r1c1-p',
      'figure:fig_A.1@g3-fig-a1',
    ])
    expect(refs.find((ref) => ref.href === 'inl_2')?.key).toBe('g3-res-1')
  })

  it.each([
    ['WP8.M 全要素 IR', createWp8mIrDoc],
    ['WP8.M G3 夹具', g3IrDoc],
  ])('%s：收集到的行内图数量等于文档中行内图载荷的独立计数', (_name, make) => {
    const doc = make()
    const refs = collectXml46687ImageRefs(doc, resolve(doc).labels)
    const sections = [doc.front.foreword, doc.front.introduction, doc.front.introductionClauses ?? [], doc.body, doc.appendices]
    const expected = countInlineImagesInJson(sections)
    expect(expected).toBeGreaterThan(0)
    expect(refs.filter((ref) => ref.kind === 'inline')).toHaveLength(expected)
    expect(refs.filter((ref) => ref.kind === 'inline').map((ref) => ref.href)).toEqual(
      Array.from({ length: expected }, (_, index) => `inl_${index + 1}`),
    )
  })
})
