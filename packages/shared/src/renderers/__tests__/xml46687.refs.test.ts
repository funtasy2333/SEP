import { describe, expect, it } from 'vitest'
import { g1NormRefList } from '../../ir/__tests__/wp8mG1Fixtures'
import type { IRBibEntry, IRBlock, IRClauseChild, IRDoc, IRIndex, IRInline, IRNormRef, IRNormRefList } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { site } from '../xml46687Parts/context'
import { createRenderSession } from '../xml46687Parts/dispatch'
import { EMPTY_OPTIONS, appendix, bodyOf, chapter, clause, codesOf, deepFreeze, exportDoc, find, labelsOf, makeDoc, para, renderOk, run } from './xml46687Kit'
import { shouldSkipValidation, stsCompatWithPython, validateWithPython } from './xml46687PythonValidation'

/**
 * 规范性引用文件、参考文献、索引（WP8.2 设计 §2.10、§2.11 索引）。
 * 整条管线（`exportXml46687`）渲染；规范性引用文件章是第 2 章。`back` 内的 `ref-list[bibl]`、`index` 取 `</body>` 之后的片段。
 */

const std = (id: string, ref: string, title: string): IRNormRef => ({ kind: 'normRef', id, entryType: 'std', ref: [{ text: ref }], title: [{ text: title }] })
const mixed = (id: string, content: string): IRNormRef => ({ kind: 'normRef', id, entryType: 'mixed', content: [{ text: content }] })
const normRefs = (id: string, ...entries: IRNormRef[]): IRNormRefList => ({ kind: 'normRefList', id, entries })

/** 范围、规范性引用文件（第 2 章，引导语 + 清单）、其他章。 */
function refsDoc(list: IRNormRefList | undefined, rest: Partial<IRDoc> = {}, extra: ReturnType<typeof chapter>[] = []): IRDoc {
  return makeDoc([
    chapter('ch-scope', '范围', [para('scope-p', '范围。')], 'scope'),
    chapter('ch-refs', '规范性引用文件', [para('refs-p', '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。'), ...(list ? [list] : [])], 'norm-refs'),
    ...extra,
  ], rest)
}

function bib(id: string, content: string, extra: Partial<IRBibEntry> = {}): IRBibEntry {
  return { kind: 'bibEntry', id, content: [{ text: content }], ...extra }
}

const compact = (xml: string): string => xml.replace(/>\s+</g, '><')
const bodyXml = (doc: IRDoc): string => compact(bodyOf(renderOk(doc).xml))
/** `</body>` 之后、`</standard>` 之前的 back 片段（紧凑）。 */
const backXml = (doc: IRDoc): string => {
  const xml = compact(renderOk(doc).xml)
  return xml.slice(xml.indexOf('</body>') + '</body>'.length, xml.indexOf('</standard>'))
}
const refList = (xml: string): string => /<ref-list content-type="norm-refs">[\s\S]*?<\/ref-list>/.exec(xml)![0]
const bibList = (xml: string): string => /<ref-list id="sec_bibl" content-type="bibl">[\s\S]*?<\/ref-list>/.exec(xml)![0]
const indexXml = (xml: string): string => /<index id="sec_index">[\s\S]*?<\/index>/.exec(xml)![0]

describe('规范性引用文件清单 ref-list[@content-type="norm-refs"]（设计 §2.10）', () => {
  it('[M-4.4.2.3-02] [M-4.4.2.3.2-01] [M-F-09] ref-list 是 norm-refs 章的块，在引导语 p 之后；content-type 恒为 norm-refs；ref-list 不写 id', () => {
    const doc = refsDoc(normRefs('nrl', std('nr1', 'GB/T 321', '优先数和优先数系')))
    const xml = bodyXml(doc)
    expect(xml).toContain('<sec id="sec_2" sec-type="norm-refs"><label>2</label><title>规范性引用文件</title><p>下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。</p><ref-list content-type="norm-refs">')
    expect(xml).not.toMatch(/<ref-list [^>]*id=/)
    expect(xml).not.toContain('norm_refs')
  })

  it('[M-4.4.2.3-03] [M-E-06] 标准化文件：ref[@id=ref_<n>] > std > std-ref + title；两者之间不写逗号文本节点；条目没有 label', () => {
    const doc = refsDoc(normRefs('nrl', std('nr1', 'GB/T 321', '优先数和优先数系'), std('nr2', 'GB/T 3102（所有部分）', '量和单位')))
    expect(refList(bodyXml(doc))).toBe(
      '<ref-list content-type="norm-refs">'
      + '<ref id="ref_1"><std><std-ref>GB/T 321</std-ref><title>优先数和优先数系</title></std></ref>'
      + '<ref id="ref_2"><std><std-ref>GB/T 3102（所有部分）</std-ref><title>量和单位</title></std></ref>'
      + '</ref-list>',
    )
    expect(refList(bodyXml(doc))).not.toContain('<label>')
  })

  it('[M-4.4.2.3-04] 非标准化文件：ref > mixed-citation，保持原有格式（行内格式、换行 break）；规范性引用里的 mixed-citation 不写 xlink:type', () => {
    const entry: IRNormRef = { kind: 'normRef', id: 'nr1', entryType: 'mixed', content: [{ text: '《中华人民共和国计量法》', marks: [{ type: 'italic' }] }, { text: '\n第二行' }] }
    const xml = refList(bodyXml(refsDoc(normRefs('nrl', entry))))
    expect(xml).toBe('<ref-list content-type="norm-refs"><ref id="ref_1"><mixed-citation><italic>《中华人民共和国计量法》</italic><break/>第二行</mixed-citation></ref></ref-list>')
  })

  it('[M-E-06] 条目 id ref_<n> 恒输出（D-X-11），n 为清单内序号，std 与 mixed 混排', () => {
    const doc = refsDoc(normRefs('nrl', std('nr1', 'GB/T 1', '甲'), mixed('nr2', '乙文件'), std('nr3', 'ISO 80000（所有部分）', '丙')))
    expect([...refList(bodyXml(doc)).matchAll(/<ref id="([^"]*)">/g)].map(match => match[1])).toEqual(['ref_1', 'ref_2', 'ref_3'])
  })

  it('std-ref 是纯文本容器：mark 被丢弃并给 mark-dropped-in-text-only（warning）；title 内格式如实输出', () => {
    const entry: IRNormRef = { kind: 'normRef', id: 'nr1', entryType: 'std', ref: [{ text: 'GB/T 1', marks: [{ type: 'bold' }] }], title: [{ text: '名称', marks: [{ type: 'bold' }] }] }
    const { xml, problems } = renderOk(refsDoc(normRefs('nrl', entry)))
    expect(compact(xml)).toContain('<std><std-ref>GB/T 1</std-ref><title><bold>名称</bold></title></std>')
    expect(find(problems, 'mark-dropped-in-text-only')).toHaveLength(1)
  })

  it('xml-normref-outside（error）：清单不在 norm-refs 章（范围章、术语章）——整条管线里 Resolver 的 unsupported-content 经输出边界先拦截，渲染器的检查是再保险（直接渲染块验证）', () => {
    const entries = [std('nr1', 'GB/T 1', '甲')]
    const inScope = makeDoc([chapter('ch1', '范围', [normRefs('nrl', ...entries)], 'scope')])
    const inTerms = makeDoc([chapter('ch1', '术语和定义', [normRefs('nrl', ...entries)], 'terms')])
    for (const doc of [inScope, inTerms]) {
      const result = exportDoc(doc)
      expect(result.xml).toBeNull()
      expect(codesOf(result.problems)).toEqual(['unsupported-output'])
      const session = createRenderSession(doc, labelsOf(doc), EMPTY_OPTIONS)
      session.ctx.scope.chapter = doc.body[0]
      expect(session.ctx.renderBlock(doc.body[0]!.children[0] as IRNormRefList, site('doc.body[0].children[0]', 'nrl'))).toEqual([])
      expect(find(session.ctx.problems, 'xml-normref-outside')).toMatchObject([{ severity: 'error', nodeId: 'nrl', path: 'doc.body[0].children[0]' }])
    }
    // 引言/附录等没有当前章时同样拒绝
    const doc = refsDoc(normRefs('nrl', ...entries))
    const session = createRenderSession(doc, labelsOf(doc), EMPTY_OPTIONS)
    expect(session.ctx.renderBlock(doc.body[1]!.children[1] as IRNormRefList, site('doc.appendices[0].children[0]', 'nrl'))).toEqual([])
    expect(codesOf(session.ctx.problems, 'error')).toEqual(['xml-normref-outside'])
  })

  it('xml-normref-incomplete（error）：std 条目的文件编号或名称为空；mixed 条目没有内容', () => {
    const cases: Array<[string, IRNormRef]> = [
      ['编号为空', { kind: 'normRef', id: 'nr1', entryType: 'std', ref: [], title: [{ text: '名称' }] }],
      ['名称为空', { kind: 'normRef', id: 'nr1', entryType: 'std', ref: [{ text: 'GB/T 1' }], title: [{ text: '  ' }] }],
      ['mixed 无内容', { kind: 'normRef', id: 'nr1', entryType: 'mixed', content: [] }],
    ]
    for (const [name, entry] of cases) {
      const result = exportDoc(refsDoc(normRefs('nrl', entry)))
      expect(result.xml, name).toBeNull()
      expect(find(result.problems, 'xml-normref-incomplete'), name).toMatchObject([{ severity: 'error', nodeId: 'nr1', path: 'doc.body[1].children[1].entries[0]' }])
    }
  })

  it('没有条目的清单整体省略并给 empty-content（warning）', () => {
    const { xml, problems } = renderOk(refsDoc(normRefs('nrl')))
    expect(xml).not.toContain('ref-list')
    expect(find(problems, 'empty-content')).toMatchObject([{ severity: 'warning', nodeId: 'nrl' }])
  })

  it('xml-label-missing（error）：Resolver 没有给条目 xmlId（ref_<n>）', () => {
    const doc = refsDoc(normRefs('nrl', std('nr1', 'GB/T 1', '甲')))
    const labels = { ...labelsOf(doc) }
    delete labels.nr1
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-label-missing').some(problem => problem.nodeId === 'nr1')).toBe(true)
  })

  it('没有清单的 norm-refs 章（引导语段落）照常按 p 输出', () => {
    const xml = bodyXml(refsDoc(undefined))
    expect(xml).toContain('<sec id="sec_2" sec-type="norm-refs"><label>2</label><title>规范性引用文件</title><p>下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。</p></sec>')
    expect(xml).not.toContain('ref-list')
  })
})

describe('未结构化的规范性引用文件章（C-S-24，主导决定 2026-10-27）', () => {
  const normRefsChapter = (...children: IRClauseChild[]): IRDoc => makeDoc([
    chapter('ch-scope', '范围', [para('scope-p', '范围。')], 'scope'),
    chapter('ch-refs', '规范性引用文件', children, 'norm-refs'),
  ])

  it('normref-unstructured（warning）：norm-refs 章没有 normRefList 且块数 ≥ 2 → 照常按 p 输出，并给 warning（nodeId=章，path=doc.body[n]）', () => {
    const doc = normRefsChapter(para('refs-p0', '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。'), para('refs-p1', 'GB/T 321 优先数和优先数系'), para('refs-p2', 'GB/T 3102（所有部分） 量和单位'))
    const { xml, problems } = renderOk(doc)
    expect(compact(bodyOf(xml))).toContain('<p>下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。</p><p>GB/T 321 优先数和优先数系</p><p>GB/T 3102（所有部分） 量和单位</p>')
    expect(compact(xml)).not.toContain('ref-list')
    const warnings = find(problems, 'normref-unstructured')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ severity: 'warning', nodeId: 'ch-refs', path: 'doc.body[1]' })
    expect(warnings[0]!.message).toContain('3 个块')
  })

  it('块数恰为 2 也报（引导语 + 一个条目段落）；块里的注、示例同样计数，子条不计', () => {
    const two = renderOk(normRefsChapter(para('p0', '引导语。'), para('p1', 'GB/T 1 名称')))
    expect(find(two.problems, 'normref-unstructured')).toHaveLength(1)
    const note = { kind: 'note' as const, id: 'n1', content: [para('n1.p', '注')] }
    expect(find(renderOk(normRefsChapter(para('p0', '引导语。'), note)).problems, 'normref-unstructured')).toHaveLength(1)
    // 子条不计块数：一个块 + 一个子条 = 1 个块，不报
    expect(find(renderOk(normRefsChapter(para('p0', '引导语。'), clause('c1', 1, '条', [para('c1.p', '条')]))).problems, 'normref-unstructured')).toEqual([])
  })

  it('单个引导段（如“本文件没有规范性引用文件。”）不报；有 normRefList 的章（引导语 + 清单共 2 个块）不报；其他章的多个段落不报', () => {
    expect(find(renderOk(normRefsChapter(para('p0', '本文件没有规范性引用文件。'))).problems, 'normref-unstructured')).toEqual([])
    const structured = renderOk(refsDoc(normRefs('nrl', std('nr1', 'GB/T 1', '甲'))))
    expect(find(structured.problems, 'normref-unstructured')).toEqual([])
    const scope = makeDoc([chapter('ch-scope', '范围', [para('p0', '一。'), para('p1', '二。'), para('p2', '三。')], 'scope')])
    expect(find(renderOk(scope).problems, 'normref-unstructured')).toEqual([])
  })

  it('没有参考文献时同样检查（检查挂在 back 阶段必经的入口，不依赖是否有文献）；有参考文献时也只报一次', () => {
    const doc = normRefsChapter(para('p0', '引导语。'), para('p1', 'GB/T 1 名称'))
    expect(find(renderOk(doc).problems, 'normref-unstructured')).toHaveLength(1)
    doc.bibliography = [bib('b1', '文献一')]
    expect(find(renderOk(doc).problems, 'normref-unstructured')).toHaveLength(1)
  })
})

describe('条文脚注在 mixed-citation 内（主导决定 2026-10-27）', () => {
  const footnoteRun = (id: string, text: string): IRInline => ({ text: '', footnote: { id, content: [{ text }] } })
  /** WP8.M 夹具 g1-nr-4 的形态：mixed 条目 = 文字 + 一个空文字的脚注 run；再加正文脚注与参考文献脚注，核对编号次序。 */
  function footnoteDoc(): IRDoc {
    return refsDoc(g1NormRefList(), {
      bibliography: [
        bib('bf1', '', { content: [{ text: '张伯奥.中医内科学[M].' }, footnoteRun('fn-bib', '文献的脚注。')] }),
      ],
    }, [chapter('ch-body', '技术要求', [para('body-p', '正文', { text: '带脚注', footnote: { id: 'fn-body', content: [{ text: '正文脚注的内容。' }] } }, '。', run('文献', { type: 'bibRef', targetId: 'bf1' }))])])
  }
  const doc = footnoteDoc()
  const labels = labelsOf(doc)

  it('[M-4.4.2.3-04] 规范性引用的 mixed 条目里的脚注：xref[fn] 紧随 fn，写在 mixed-citation 内（WP8.M 夹具 g1-fn-nr 的形态）', () => {
    const { xml, problems } = renderOk(doc)
    expect(codesOf(problems, 'error')).toEqual([])
    expect(refList(compact(bodyOf(xml)))).toContain(
      '<ref id="ref_4"><mixed-citation>《中华人民共和国计量法》<xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label><sup>1)</sup></label><p>非标准化文件的脚注。</p></fn></mixed-citation></ref>',
    )
  })

  it('[M-4.5.3-06] 参考文献的 mixed-citation 里的脚注同样允许；脚注编号按 Resolver 的次序（规范性引用章 → 正文 → 参考文献）', () => {
    expect([labels['g1-fn-nr']!.xmlId, labels['fn-body']!.xmlId, labels['fn-bib']!.xmlId]).toEqual(['fn_1', 'fn_2', 'fn_3'])
    const { xml } = renderOk(doc)
    expect(bibList(backXml(doc))).toContain(
      '<mixed-citation xlink:type="simple">张伯奥.中医内科学[M].<xref ref-type="fn" rid="fn_3">3)</xref><fn id="fn_3"><label><sup>3)</sup></label><p>文献的脚注。</p></fn></mixed-citation>',
    )
    expect(compact(xml).match(/<fn id=/g)).toHaveLength(3)
  })

  it('标准化文件的 std 条目里没有脚注的合法位置：std-ref（纯文本）、title 里的脚注报 xml-footnote-position（error）；规范性引用与参考文献都一样', () => {
    const inRef: IRNormRef = { kind: 'normRef', id: 'nr1', entryType: 'std', ref: [{ text: 'GB/T 1', footnote: { id: 'fn-a', content: [{ text: '甲' }] } }], title: [{ text: '名称' }] }
    const inTitle: IRNormRef = { kind: 'normRef', id: 'nr2', entryType: 'std', ref: [{ text: 'GB/T 2' }], title: [{ text: '名称' }, footnoteRun('fn-b', '乙')] }
    const result = exportDoc(refsDoc(normRefs('nrl', inRef, inTitle)))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-footnote-position')).toMatchObject([
      { severity: 'error', nodeId: 'fn-a', path: 'doc.body[1].children[1].entries[0].ref[0].footnote' },
      { severity: 'error', nodeId: 'fn-b', path: 'doc.body[1].children[1].entries[1].title[1].footnote' },
    ])
    const stdBib = bib('bs', '', {
      entryType: 'standard',
      fields: [
        { id: 'f1', name: 'std-ref', value: [{ text: 'GB/T 1' }] },
        { id: 'f2', name: 'title', value: [{ text: '名称' }, footnoteRun('fn-c', '丙')] },
      ],
    })
    const bibResult = exportDoc(makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], { bibliography: [stdBib] }))
    expect(bibResult.xml).toBeNull()
    expect(find(bibResult.problems, 'xml-footnote-position')).toMatchObject([{ severity: 'error', nodeId: 'fn-c', path: 'doc.bibliography[0].fields[1].value[1].footnote' }])
  })

  it('stdRef 正文引用上的脚注不报错：脚注落在 std 之后、p 之内', () => {
    const body = makeDoc([chapter('ch1', '范围', [para('p1', '见', { text: 'GB/T 1', marks: [{ type: 'stdRef' }], footnote: { id: 'fn-s', content: [{ text: '丁' }] } }, '。')], 'scope')])
    const { xml, problems } = renderOk(body)
    expect(codesOf(problems, 'error')).toEqual([])
    expect(compact(bodyOf(xml))).toContain('<p>见<std><std-ref>GB/T 1</std-ref></std><xref ref-type="fn" rid="fn_1">1)</xref><fn id="fn_1"><label><sup>1)</sup></label><p>丁</p></fn>。</p>')
  })

  describe.skipIf(shouldSkipValidation())('python3 -I scripts/xml46687/validate.py --json --profile export', () => {
    it('规范性引用与参考文献里 mixed-citation 的脚注：valid:true，errors:[]（fn 有 id，xref[fn] 的 rid 可解析）', () => {
      const xml = exportXml46687(doc, labels, EMPTY_OPTIONS).xml!
      const result = validateWithPython(xml, 'export')
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
    })

    it('同一份导出按 import 档校验也通过；sts_compat.py 零未解释偏差', () => {
      const xml = exportXml46687(doc, labels, EMPTY_OPTIONS).xml!
      expect(validateWithPython(xml, 'import').errors).toEqual([])
      const compat = stsCompatWithPython(xml)
      expect(compat.status, compat.stdout).toBe(0)
    })
  })
})

describe('参考文献 back/ref-list[@content-type="bibl"]（设计 §2.10）', () => {
  const citing = (...ids: string[]): IRBlock => para('cite-p', '参见', ...ids.flatMap((id, index): Array<string | ReturnType<typeof run>> => [index > 0 ? '、' : '', run(`文献${id}`, { type: 'bibRef', targetId: id })]))
  const withBib = (bibliography: IRBibEntry[], rest: Partial<IRDoc> = {}, blocks: IRClauseChild[] = []): IRDoc =>
    makeDoc([chapter('ch1', '范围', [para('p1', '正文'), ...blocks], 'scope')], { bibliography, ...rest })

  it('[M-4.5.3-01] [M-4.2-09] [M-D-02] [M-E-03] [M-F-11] ref-list[@content-type="bibl"][@id="sec_bibl"] 在 back 内、app-group 之后、index 之前；没有文献时不写', () => {
    const doc = withBib([bib('b1', '文献一')], {
      appendices: [appendix('app', false, '附录', [para('app-p', '附录正文')])],
      index: { id: 'idx', groups: [{ id: 'g', entries: [{ id: 'e', term: [{ text: '索引词' }], targets: ['ch1'], seeAlso: [] }] }] },
    })
    const xml = backXml(doc)
    expect(xml.indexOf('<app-group>')).toBeLessThan(xml.indexOf('<ref-list id="sec_bibl"'))
    expect(xml.indexOf('<ref-list id="sec_bibl"')).toBeLessThan(xml.indexOf('<index id="sec_index">'))
    expect(compact(renderOk(withBib([])).xml)).not.toContain('sec_bibl')
    expect(compact(renderOk(withBib([])).xml)).not.toContain('<back>')
  })

  it('[M-4.5.3-02] title 缺省为“参考文献”；有 bibliographyTitle 时替换（行内格式如实输出）', () => {
    expect(bibList(backXml(withBib([bib('b1', '文献一')])))).toContain('<ref-list id="sec_bibl" content-type="bibl"><title>参考文献</title>')
    const custom = withBib([bib('b1', '文献一')], { bibliographyTitle: [{ text: '参考', marks: [{ type: 'bold' }] }, { text: '书目' }] })
    expect(bibList(backXml(custom))).toContain('<title><bold>参考</bold>书目</title>')
    expect(backXml(custom)).not.toContain('参考文献')
  })

  it('[M-4.5.3-03] [M-4.5.3.1-01] [M-E-05] [M-4.5.3-04] [M-4.5.3.1-02] ref[@id=biblref_<n>] 按 xmlId 尾号升序输出（不信任数组序）；label 取 Resolver（[n]）', () => {
    // 数组序 A、B、C；按首次引用 C、A → Resolver 编号 C=[1]、A=[2]、B=[3]
    const doc = withBib([bib('A', '文献甲'), bib('B', '文献乙'), bib('C', '文献丙')], {}, [citing('C', 'A')])
    const labels = labelsOf(doc)
    expect([labels.C!.xmlId, labels.A!.xmlId, labels.B!.xmlId]).toEqual(['biblref_1', 'biblref_2', 'biblref_3'])
    const xml = bibList(backXml(doc))
    expect([...xml.matchAll(/<ref id="([^"]*)"><label>([^<]*)<\/label>.*?<mixed-citation[^>]*>([^<]*)</g)].map(match => [match[1], match[2], match[3]])).toEqual([
      ['biblref_1', '[1]', '文献丙'], ['biblref_2', '[2]', '文献甲'], ['biblref_3', '[3]', '文献乙'],
    ])
  })

  it('[M-4.5.3-05] [M-4.5.3.1-03] [M-4.5.3.1-04] [M-4.5.3.1-05] 标准化文件：entryType=standard 且 fields 有非空 std-ref 与 title → std > std-ref + title（两者之间不写逗号文本）', () => {
    const entry = bib('b1', 'GB/T 15657—2021 中医病证分类与代码', {
      entryType: 'standard',
      fields: [
        { id: 'f1', name: 'title', value: [{ text: '中医病证分类与代码' }] },
        { id: 'f2', name: 'std-ref', value: [{ text: 'GB/T 15657—2021' }] },
      ],
    })
    expect(bibList(backXml(withBib([entry])))).toContain('<ref id="biblref_1"><label>[1]</label><std><std-ref>GB/T 15657—2021</std-ref><title>中医病证分类与代码</title></std></ref>')
  })

  it('[M-4.5.3-06] [M-4.5.3.1-06] [M-4.5.3-07] [M-4.5.3.3-01] 非标准化文件：mixed-citation 保持原有格式，参考文献里的 mixed-citation 带 xlink:type="simple"，换行写 break', () => {
    const entry: IRBibEntry = { kind: 'bibEntry', id: 'b1', content: [{ text: '张伯奥.', marks: [{ type: 'bold' }] }, { text: '中医内科学[M].\n北京：人民卫生出版社，2020.' }] }
    expect(bibList(backXml(withBib([entry])))).toContain(
      '<ref id="biblref_1"><label>[1]</label><mixed-citation xlink:type="simple"><bold>张伯奥.</bold>中医内科学[M].<break/>北京：人民卫生出版社，2020.</mixed-citation></ref>',
    )
  })

  it('[M-4.5.3-08] [M-4.5.3.3-02] 外部链接：uri 接在内容之后，文字取 href，不写 xlink:type', () => {
    const entry = bib('b1', 'Example Corp. Interface specification [EB/OL]. ', { externalLink: { href: 'https://example.org/spec' } })
    const { xml, problems } = renderOk(withBib([entry]))
    expect(bibList(compact(xml))).toContain('<mixed-citation xlink:type="simple">Example Corp. Interface specification [EB/OL]. <uri>https://example.org/spec</uri></mixed-citation>')
    expect(compact(xml)).not.toMatch(/<uri [^>]*xlink:type/)
    expect(find(problems, 'link-attr-not-expressed')).toEqual([])
  })

  it('link-attr-not-expressed（warning）：显示文字与地址不同、title/target/rel 非空时没有对应属性', () => {
    const entry = bib('b1', '文献', { externalLink: { href: 'https://example.org/', displayText: '在线来源', title: '提示', target: '_blank', rel: 'noopener' } })
    const { xml, problems } = renderOk(withBib([entry]))
    expect(compact(xml)).toContain('<uri>https://example.org/</uri>')
    expect(find(problems, 'link-attr-not-expressed').map(problem => problem.severity)).toEqual(['warning', 'warning', 'warning', 'warning'])
  })

  it('xml-link-protocol（error，V-11）：外部链接协议不在白名单或地址为空', () => {
    for (const href of ['javascript:alert(1)', '  ']) {
      const result = exportDoc(withBib([bib('b1', '文献', { externalLink: { href } })]))
      expect(result.xml, href).toBeNull()
      expect(find(result.problems, 'xml-link-protocol'), href).toMatchObject([{ severity: 'error', nodeId: 'b1' }])
    }
  })

  it('bib-std-incomplete（warning）：entryType=standard 但缺非空的 std-ref 或 title → 按 mixed-citation 输出其文字', () => {
    const onlyTitle = bib('b1', '标准机器语言表达', { entryType: 'standard', fields: [{ id: 'f1', name: 'title', value: [{ text: '标准机器语言表达' }] }] })
    const { xml, problems } = renderOk(withBib([onlyTitle]))
    expect(bibList(compact(xml))).toContain('<mixed-citation xlink:type="simple">标准机器语言表达</mixed-citation>')
    expect(bibList(compact(xml))).not.toContain('<std>')
    expect(find(problems, 'bib-std-incomplete')).toMatchObject([{ severity: 'warning', nodeId: 'b1' }])
    expect(find(problems, 'bib-std-incomplete')[0]!.message).toContain('std-ref')
    const emptyRef = bib('b2', '文献', { entryType: 'standard', fields: [{ id: 'f2', name: 'std-ref', value: [{ text: ' ' }] }, { id: 'f3', name: 'title', value: [{ text: '名称' }] }] })
    expect(find(renderOk(withBib([emptyRef])).problems, 'bib-std-incomplete')).toHaveLength(1)
  })

  it('bib-field-not-expressed（warning，聚合）：其余字段、标识符无 XML 表达；std 形式的外链也没有 uri 位置', () => {
    const complete = bib('b1', '正文', {
      entryType: 'standard',
      fields: [
        { id: 'f1', name: 'std-ref', value: [{ text: 'GB/T 1' }] },
        { id: 'f2', name: 'title', value: [{ text: '名称' }] },
        { id: 'f3', name: 'author', value: [{ text: '作者' }] },
      ],
      identifiers: [{ id: 'i1', scheme: 'DOI', value: '10.1/x' }],
      externalLink: { href: 'https://example.org/' },
    })
    const plain = bib('b2', '文献二', { fields: [{ id: 'f4', name: 'publisher', value: [{ text: '出版社' }] }] })
    const { xml, problems } = renderOk(withBib([complete, plain]))
    expect(compact(xml)).not.toMatch(/作者|出版社|10\.1\/x|<uri>/)
    const merged = find(problems, 'bib-field-not-expressed')
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ severity: 'warning', nodeId: 'b1' })
    expect(merged[0]!.message).toContain('共 2 处')
    expect(merged[0]!.message).toMatch(/字段 author.*标识符 DOI.*外部链接/)
    expect(merged[0]!.message).toContain('字段 publisher')
  })

  it('[M-10.1.6-01] bibRef 的 xref[@ref-type="bibr"]：rid=biblref_<n>，内容取 run 自己的文本（D-X-10），不是 refText', () => {
    const doc = withBib([bib('b1', '文献一')], {}, [para('cite2', '见', run('GB/T 15657', { type: 'bibRef', targetId: 'b1' }), '。')])
    const xml = bodyXml(doc)
    expect(xml).toContain('<xref ref-type="bibr" rid="biblref_1">GB/T 15657</xref>')
    expect(xml).not.toContain('>[1]</xref>')
  })

  it('[M-10.1.6-02] 引用目标 ref/@id 与 xref/@rid 一致（P4 收尾检查通过）；被引用的文献排在前面', () => {
    const doc = withBib([bib('b1', '文献一'), bib('b2', '文献二')], {}, [citing('b2')])
    const { xml } = renderOk(doc)
    expect(compact(xml)).toContain('rid="biblref_1"')
    expect(bibList(backXml(doc))).toContain('<ref id="biblref_1"><label>[1]</label><mixed-citation xlink:type="simple">文献二</mixed-citation></ref>')
  })

  it('empty-content（warning）：条目没有任何文字内容时写出空的 mixed-citation', () => {
    const { xml, problems } = renderOk(withBib([bib('b1', '')]))
    expect(bibList(compact(xml))).toContain('<mixed-citation xlink:type="simple"/>')
    expect(find(problems, 'empty-content')).toMatchObject([{ severity: 'warning', nodeId: 'b1' }])
  })

  it('xml-label-missing（error）：labels 里缺 biblref_<n> 形式的 xmlId（旧的 bib_<n>、无尾号、无 label）', () => {
    const doc = withBib([bib('b1', '文献一')])
    const base = labelsOf(doc)
    for (const broken of [{ ...base.b1!, xmlId: 'bib_1' }, { ...base.b1!, xmlId: 'biblref_' }, { ...base.b1!, label: '' }]) {
      const result = exportXml46687(doc, { ...base, b1: broken }, EMPTY_OPTIONS)
      expect(result.xml).toBeNull()
      expect(find(result.problems, 'xml-label-missing')).toMatchObject([{ severity: 'error', nodeId: 'b1', path: 'doc.bibliography[0]' }])
    }
    const missing = { ...base }
    delete missing.b1
    expect(find(exportXml46687(doc, missing, EMPTY_OPTIONS).problems, 'xml-label-missing').some(problem => problem.nodeId === 'b1')).toBe(true)
  })

  it('formula-in-text-only（error）：std-ref 是纯文本，不能放行内公式', () => {
    const entry = bib('b1', '文献', {
      entryType: 'standard',
      fields: [{ id: 'f1', name: 'std-ref', value: [{ text: '', formula: { id: 'fx', latex: 'x' } }] }, { id: 'f2', name: 'title', value: [{ text: '名称' }] }],
    })
    const result = exportDoc(withBib([entry]))
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'formula-in-text-only')).toHaveLength(1)
  })
})

describe('索引 index（设计 §2.11）', () => {
  const clauses: IRClauseChild[] = [clause('c-a', 1, '甲条', [para('c-a-p', '甲')]), clause('c-b', 1, '乙条', [para('c-b-p', '乙')])]
  const docWith = (index: IRBlock | IRIndex, rest: Partial<IRDoc> = {}, extra: IRClauseChild[] = []): IRDoc =>
    makeDoc([chapter('ch1', '技术要求', [...extra, ...clauses])], { index: index as IRIndex, ...rest })
  const entryOf = (id: string, term: string, targets: string[] = [], seeAlso: string[] = []): IRIndex['groups'][number]['entries'][number] => ({ id, term: [{ text: term }], targets, seeAlso })

  it('[M-4.5.4-01] [M-E-03] index[@id="sec_index"] 在 back 内、参考文献之后；没有索引时不写', () => {
    const doc = docWith({ id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '索引词', ['c-a'])] }] }, { bibliography: [bib('b1', '文献')] })
    const xml = backXml(doc)
    expect(xml).toMatch(/^<back><ref-list id="sec_bibl".*<\/ref-list><index id="sec_index">.*<\/index><\/back>$/)
    expect(compact(renderOk(makeDoc([chapter('ch1', '范围', [para('p', '正文')], 'scope')])).xml)).not.toContain('<index')
  })

  it('[M-4.5.4-02] index-title-group/title 取 IRIndex.title（可选）', () => {
    const titled = docWith({ id: 'idx', title: [{ text: '主题', marks: [{ type: 'bold' }] }, { text: '索引' }], groups: [{ id: 'g', entries: [entryOf('e1', '词', ['c-a'])] }] })
    expect(indexXml(backXml(titled))).toContain('<index id="sec_index"><index-title-group><title><bold>主题</bold>索引</title></index-title-group><index-div>')
    const untitled = docWith({ id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '词', ['c-a'])] }] })
    expect(indexXml(backXml(untitled))).toMatch(/^<index id="sec_index"><index-div><index-entry/)
  })

  it('[M-4.5.4-03] index-div 一组一个，分组标题（label）写成 index-title-group/title；无标题的分组不写 index-title-group', () => {
    const doc = docWith({ id: 'idx', groups: [
      { id: 'g1', label: [{ text: 'B' }], entries: [entryOf('e1', '必备要素', ['c-a'])] },
      { id: 'g2', entries: [entryOf('e2', '无标题组词条', ['c-b'])] },
    ] })
    const xml = indexXml(backXml(doc))
    expect(xml).toContain('<index-div><index-title-group><title>B</title></index-title-group><index-entry id="df_1">')
    expect(xml).toContain('</index-div><index-div><index-entry id="df_2">')
  })

  it('[M-4.5.4-04] [M-4.5.4-05] [M-4.5.4-06] index-entry[@id=df_<k>]（全文索引条目的文档序，从 1 起）> term + see-entry（每个目标一个，纯文本编号取 refText，无 rid）', () => {
    const doc = docWith({ id: 'idx', groups: [
      { id: 'g1', label: [{ text: 'A' }], entries: [
        entryOf('e1', '甲', ['c-a', 'c-b']),
        { id: 'e2', term: [{ text: '乙', marks: [{ type: 'bold' }] }, { text: '词' }], targets: ['ch1'], seeAlso: [] },
      ] },
      { id: 'g2', label: [{ text: 'B' }], entries: [entryOf('e3', '丙', [])] },
    ] })
    const xml = indexXml(backXml(doc))
    expect(xml).toContain('<index-entry id="df_1"><term>甲</term><see-entry>1.1</see-entry><see-entry>1.2</see-entry></index-entry>')
    expect(xml).toContain('<index-entry id="df_2"><term><bold>乙</bold>词</term><see-entry>第1章</see-entry></index-entry>')
    expect(xml).toContain('<index-entry id="df_3"><term>丙</term></index-entry>')
    expect(xml).not.toMatch(/see-entry [^>]*rid=/)
  })

  it('[M-4.5.4-06] 指向文献、术语等有真实编号的目标：see-entry 文本取 Resolver 的 refText', () => {
    const doc = docWith(
      { id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '文献词', ['b1'])] }] },
      { bibliography: [bib('b1', '文献一')] },
    )
    expect(indexXml(backXml(doc))).toContain('<see-entry>[1]</see-entry>')
  })

  it('指向索引整体的 xref 用常量 id sec_index（V-8 的 sec 目标含 index）', () => {
    const doc = docWith(
      { id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '词', ['c-a'])] }] },
      {},
      [para('ref-p', '见', run('索引', { type: 'crossRef', targetId: 'idx', targetKind: 'index' }), '。')],
    )
    expect(bodyXml(doc)).toContain('<xref ref-type="sec" rid="sec_index">索引</xref>')
  })

  it('index-seealso-not-expressed（warning）：seeAlso（参见）无写法，未导出；target 照常写 see-entry', () => {
    const doc = docWith({ id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '词', ['c-a'], ['c-b'])] }] })
    const { xml, problems } = renderOk(doc)
    expect(indexXml(compact(xml))).toContain('<index-entry id="df_1"><term>词</term><see-entry>1.1</see-entry></index-entry>')
    expect(find(problems, 'index-seealso-not-expressed')).toMatchObject([{ severity: 'warning', nodeId: 'e1' }])
  })

  it('xml-xref-target-unsupported（error）：目标存在但没有真实编号（段落、规范性引用条目、索引条目）', () => {
    const doc = docWith({ id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '词', ['c-a-p']), entryOf('e2', '词二', ['e1'])] }] })
    const result = exportDoc(doc)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-xref-target-unsupported')).toMatchObject([
      { severity: 'error', nodeId: 'e1', path: 'doc.index.groups[0].entries[0].targets[0]' },
      { severity: 'error', nodeId: 'e2', path: 'doc.index.groups[0].entries[1].targets[0]' },
    ])
    const normRef = makeDoc([
      chapter('ch-refs', '规范性引用文件', [normRefs('nrl', std('nr1', 'GB/T 1', '甲'))], 'norm-refs'),
    ], { index: { id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '词', ['nr1'])] }] } })
    expect(find(exportDoc(normRef).problems, 'xml-xref-target-unsupported')).toHaveLength(1)
  })

  it('xml-xref-target-missing（error）：目标在文档中不存在（Resolver 另报 dangling-index-target）', () => {
    const doc = docWith({ id: 'idx', groups: [{ id: 'g', entries: [entryOf('e1', '词', ['nowhere'])] }] })
    const result = exportDoc(doc)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-xref-target-missing')).toMatchObject([{ severity: 'error', nodeId: 'e1', path: 'doc.index.groups[0].entries[0].targets[0]' }])
  })

  it('empty-content（warning）：分组里没有条目则省略该分组；全部为空则整体省略索引', () => {
    const partial = docWith({ id: 'idx', groups: [{ id: 'g1', label: [{ text: 'A' }], entries: [] }, { id: 'g2', label: [{ text: 'B' }], entries: [entryOf('e1', '词', ['c-a'])] }] })
    const first = renderOk(partial)
    expect(indexXml(compact(first.xml))).not.toContain('<title>A</title>')
    expect(find(first.problems, 'empty-content')).toMatchObject([{ severity: 'warning', nodeId: 'g1' }])
    const none = renderOk(docWith({ id: 'idx', groups: [{ id: 'g1', entries: [] }] }))
    expect(compact(none.xml)).not.toContain('<index')
    expect(find(none.problems, 'empty-content').map(problem => problem.nodeId)).toEqual(['g1', 'idx'])
  })

  it('df_ 计数只在被写出的条目上前进（被省略的空分组不占号）', () => {
    const doc = docWith({ id: 'idx', groups: [
      { id: 'g1', entries: [] },
      { id: 'g2', entries: [entryOf('e1', '一', ['c-a']), entryOf('e2', '二', ['c-b'])] },
    ] })
    expect([...indexXml(backXml(doc)).matchAll(/id="(df_\d+)"/g)].map(match => match[1])).toEqual(['df_1', 'df_2'])
  })
})

/** 域快照夹具：规范性引用（std + mixed）、参考文献（std、mixed、uri、换行）、索引（两组、see-entry）、对文献与索引的引用。 */
function goldenDoc(): IRDoc {
  const bibliography: IRBibEntry[] = [
    bib('g-b1', 'GB/T 15657—2021 中医病证分类与代码', {
      entryType: 'standard',
      fields: [{ id: 'g-f1', name: 'std-ref', value: [{ text: 'GB/T 15657—2021' }] }, { id: 'g-f2', name: 'title', value: [{ text: '中医病证分类与代码' }] }],
    }),
    { kind: 'bibEntry', id: 'g-b2', content: [{ text: '张伯奥.中医内科学[M].\n北京：人民卫生出版社，2020.' }] },
    bib('g-b3', 'Example Corp. Interface specification [EB/OL]. ', { externalLink: { href: 'https://example.org/spec' } }),
  ]
  const index: IRIndex = {
    id: 'g-idx', title: [{ text: '索引' }],
    groups: [
      { id: 'g-g1', label: [{ text: 'B' }], entries: [{ id: 'g-e1', term: [{ text: '必备要素' }], targets: ['g-c-a', 'g-c-b'], seeAlso: [] }] },
      { id: 'g-g2', label: [{ text: 'W' }], entries: [{ id: 'g-e2', term: [{ text: '文献' }], targets: ['g-b2'], seeAlso: [] }, { id: 'g-e3', term: [{ text: '范围' }], targets: ['ch-scope'], seeAlso: [] }] },
    ],
  }
  return makeDoc([
    chapter('ch-scope', '范围', [
      para('scope-p', '本文件引用', run('GB/T 15657', { type: 'bibRef', targetId: 'g-b1' }), '和', run('《中医内科学》', { type: 'bibRef', targetId: 'g-b2' }), '，索引见', run('索引', { type: 'crossRef', targetId: 'g-idx', targetKind: 'index' }), '。'),
    ], 'scope'),
    chapter('ch-refs', '规范性引用文件', [
      para('refs-p', '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。'),
      normRefs('g-nrl',
        std('g-nr1', 'GB/T 321', '优先数和优先数系'),
        std('g-nr2', 'GB/T 3102（所有部分）', '量和单位'),
        { kind: 'normRef', id: 'g-nr3', entryType: 'mixed', content: [{ text: '《中华人民共和国计量法》' }] },
      ),
    ], 'norm-refs'),
    chapter('ch-tech', '技术要求', [
      clause('g-c-a', 1, '总体要求', [para('g-c-a-p', '总体要求。')]),
      clause('g-c-b', 1, '具体要求', [para('g-c-b-p', '具体要求。')]),
    ]),
  ], {
    bibliography,
    bibliographyTitle: [{ text: '参考书目' }],
    appendices: [appendix('g-app', false, '示例', [para('g-app-p', '附录正文。')])],
    index,
  })
}

describe('域快照与外部校验', () => {
  const doc = goldenDoc()
  const labels = labelsOf(doc)

  it('XML 文件快照（toMatchFileSnapshot）：规范性引用、参考文献、索引', async () => {
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(codesOf(result.problems, 'error')).toEqual([])
    await expect(result.xml).toMatchFileSnapshot('__snapshots__/xml46687.refs.xml')
  })

  it('问题集合恰为预期（防止告警悄悄增多）：只有标准类型的 info', () => {
    expect(exportXml46687(doc, labels, EMPTY_OPTIONS).problems.map(problem => `${problem.severity} ${problem.code}`)).toEqual(['info meta-not-expressed'])
  })

  it('导出幂等：连续两次逐字节相同', () => {
    const first = exportXml46687(doc, labels, EMPTY_OPTIONS).xml
    expect(exportXml46687(doc, labels, EMPTY_OPTIONS).xml).toBe(first)
  })

  it('不修改输入（设计 §7.3）：递归冻结的 doc 与 labels 副本导出不抛错，输出与未冻结时逐字节相同', () => {
    const frozenDoc = deepFreeze(structuredClone(doc))
    const frozenLabels = deepFreeze(structuredClone(labels))
    expect(exportXml46687(frozenDoc, frozenLabels, EMPTY_OPTIONS).xml).toBe(exportXml46687(doc, labels, EMPTY_OPTIONS).xml)
  })

  it('独立复算 id 与 rid（不复用渲染器的检查函数）：id 唯一，xref/@rid 都能解析', () => {
    const xml = exportXml46687(doc, labels, EMPTY_OPTIONS).xml!
    const ids = [...xml.matchAll(/ id="([^"]*)"/g)].map(match => match[1]!)
    expect(new Set(ids).size).toBe(ids.length)
    for (const match of xml.matchAll(/<xref [^>]*? rid="([^"]*)"/g)) expect(ids, match[1]).toContain(match[1])
    expect(ids).toEqual(expect.arrayContaining(['ref_1', 'ref_2', 'ref_3', 'sec_bibl', 'biblref_1', 'biblref_2', 'biblref_3', 'sec_index', 'df_1', 'df_2', 'df_3']))
    expect(xml).not.toMatch(/\b(?:id|rid|target)="ext_/)
  })

  describe.skipIf(shouldSkipValidation())('python3 -I scripts/xml46687/validate.py --json --profile export', () => {
    it('valid:true，errors:[]', () => {
      const result = validateWithPython(exportXml46687(doc, labels, EMPTY_OPTIONS).xml!, 'export')
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
    })

    it('sts_compat.py：退出码 0，零未解释偏差', () => {
      const result = stsCompatWithPython(exportXml46687(doc, labels, EMPTY_OPTIONS).xml!)
      expect(result.status, result.stdout).toBe(0)
    })
  })
})

it('[M-4.5.4-06] 索引源显示文本保留格式和顺序', () => {
  const index: IRIndex = {id:'idx',groups:[{id:'g',entries:[{id:'e',term:[{text:'术语'}],targets:[],seeAlso:[],sourceReferences:[{type:'see',content:[{text:'5.'},{text:'1',marks:[{type:'bold'}]}]},{type:'see',content:[{text:'5.2'}]}]}]}]}
  const doc = makeDoc([chapter('c','范围',[para('p','正文')],'scope')],{index})
  expect(compact(renderOk(doc).xml)).toContain('<term>术语</term><see-entry>5.<bold>1</bold></see-entry><see-entry>5.2</see-entry>')
})

it('[M-4.5.4-06] 索引 sourceReferences 中无法表达的类型不得静默丢弃', () => {
  const index: IRIndex = {id:'idx',groups:[{id:'g',entries:[{id:'e',term:[{text:'词'}],targets:[],seeAlso:[],sourceReferences:[{type:'seeAlso',content:[{text:'其他'}]}]}]}]}
  const doc = makeDoc([chapter('c','范围',[para('p','正文')],'scope')],{index})
  expect(exportDoc(doc).xml).toBeNull()
})
