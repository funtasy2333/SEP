import { describe, expect, it } from 'vitest'
import type { IRBlock, IRDoc, IRList } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { EMPTY_OPTIONS, bodyOf, chapter, codesOf, exportDoc, find, labelsOf, makeDoc, para, renderOk, run } from './xml46687Kit'

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

  it('list-marker-missing：默认策略下没有标记的有序项（第二层 alpha）不能省略 label，error', () => {
    const inner = list('inner', 'alpha', [['n1', '内一']])
    const outer: IRList = { kind: 'list', id: 'outer', listType: 'alpha', items: [{ id: 'o1', content: [para('o1.p0', '外一'), inner] }] }
    const result = exportDoc(docWith([outer]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'list-marker-missing')).toHaveLength(1)
    expect(find(result.problems, 'list-marker-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'n1', path: 'doc.body[0].children[0].items[0].content[1].items[0]' })
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
