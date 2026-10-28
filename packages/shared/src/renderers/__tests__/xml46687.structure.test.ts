import { describe, expect, it } from 'vitest'
import type { IRClauseChild, IRDoc, IRNormRefList, IRTermEntry } from '../../ir/types'
import { exportXml46687 } from '../xml46687'
import { site } from '../xml46687Parts/context'
import { createRenderSession } from '../xml46687Parts/dispatch'
import {
  EMPTY_OPTIONS, appendix, bodyOf, chapter, clause, codesOf, exportDoc, find, labelsOf, makeDoc, para, renderOk, run,
} from './xml46687Kit'
import { shouldSkipValidation, validateWithPython } from './xml46687PythonValidation'

/**
 * 根、前置页、章、条、附录与后置页（WP8.2 设计 §2.1 根/前置页、§2.2）。
 * 元数据（std-meta）在 xml46687.meta.test.ts。
 */

/** 折叠元素间的缩进空白，便于断言片段。 */
const squash = (xml: string): string => xml.replace(/>\s+</g, '><').trim()
const section = (xml: string, tag: string, attrs = ''): string => {
  const match = new RegExp(`<${tag}${attrs}[\\s\\S]*?</${tag}>`).exec(xml)
  if (!match) throw new Error(`没有找到 <${tag}${attrs}`)
  return squash(match[0])
}

describe('根与处理信息（设计 §2.1）', () => {
  const { xml } = renderOk(makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')]))

  it('[M-4.1-03] 序言固定为 UTF-8 声明；根 standard 无默认命名空间，只在根上声明 mml、tbx、xlink；不写 DOCTYPE', () => {
    const lines = xml.split('\n')
    expect(lines[0]).toBe('<?xml version="1.0" encoding="UTF-8"?>')
    expect(lines[1]).toBe('<standard xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:tbx="urn:iso:std:iso:30042:ed-1" xmlns:xlink="http://www.w3.org/1999/xlink">')
    expect(xml).not.toContain('<!DOCTYPE')
    expect(xml).not.toMatch(/xmlns="/)
    expect(xml.endsWith('</standard>\n')).toBe(true)
  })

  it('[M-4.3.2-30] processing-meta 是 standard 的第一个子元素，六个固定属性', () => {
    expect(lines(xml)[2]).toBe('  <processing-meta base-tagset="interchange" mathml-version="3.0" table-model="xhtml" terminology-model="tbx" math-representation="mathml" tagset-family="sts">')
  })

  it('[M-4.3.2-31] processing-meta/custom-meta-group/custom-meta：基于XML的标准文档内容标记指南 / 2026', () => {
    expect(squash(xml)).toContain('<custom-meta-group><custom-meta><meta-name>基于XML的标准文档内容标记指南</meta-name><meta-value>2026</meta-value></custom-meta></custom-meta-group></processing-meta>')
  })

  it('[M-4.1-04] [M-4.1-05] [M-4.1-07] standard 的子元素依次是 processing-meta、front（std-meta 在前）、body；没有附录/文献/索引时没有 back', () => {
    const compact = squash(xml)
    expect(compact.indexOf('<processing-meta')).toBeLessThan(compact.indexOf('<front>'))
    expect(compact.indexOf('<front><std-meta>')).toBeGreaterThan(-1)
    expect(compact.indexOf('</front><body>')).toBeGreaterThan(-1)
    expect(compact).not.toContain('<back>')
  })
})

const lines = (xml: string): string[] => xml.split('\n')

describe('前言与引言（设计 §2.1，常量 id）', () => {
  const base = (front: Partial<IRDoc['front']>): IRDoc => makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], { front: { foreword: [], introduction: [], ...front } })

  it('[M-4.3.3-01] 前言：sec[@id="sec_foreword"][@sec-type="foreword"]，标题固定“前言”，没有 label；块按第 5 章', () => {
    const { xml } = renderOk(base({ foreword: [para('fw1', '前言正文'), { kind: 'note', id: 'fw-n', content: [para('fw-n.p0', '前言注')] }] }))
    expect(section(xml, 'sec', ' id="sec_foreword"')).toBe(
      '<sec id="sec_foreword" sec-type="foreword"><title>前言</title><p>前言正文</p><non-normative-note><label>注：</label><p>前言注</p></non-normative-note></sec>',
    )
  })

  it('[M-4.3.4-01] 引言（无条）：sec[@id="sec_intro"][@sec-type="intro"]，标题“引言”', () => {
    const { xml } = renderOk(base({ introduction: [para('in1', '引言正文')] }))
    expect(section(xml, 'sec', ' id="sec_intro"')).toBe('<sec id="sec_intro" sec-type="intro"><title>引言</title><p>引言正文</p></sec>')
  })

  it('[M-4.3.4-02] [M-4.3.4-03] 引言（有条）：id 为 sec_0，先写引言块，再写条（sec_0.1、sec_0.1.1，label 0.1…），条之后只有条', () => {
    const { xml } = renderOk(base({
      introduction: [para('in1', '引言正文')],
      introductionClauses: [
        clause('ic1', 1, '背景', [para('ic1-p', '背景正文'), clause('ic1-1', 2, '起因', [para('ic1-1-p', '起因正文')])]),
        clause('ic2', 1, null, [para('ic2-p', '无题条')]),
      ],
    }))
    expect(section(xml, 'sec', ' id="sec_0"')).toContain('<sec id="sec_0" sec-type="intro"><title>引言</title><p>引言正文</p><sec id="sec_0.1"><label>0.1</label><title>背景</title>')
    expect(squash(xml)).toContain('<sec id="sec_0.1.1"><label>0.1.1</label><title>起因</title><p>起因正文</p></sec>')
    expect(squash(xml)).toContain('<sec id="sec_0.2" sec-type="numbered-paragraph"><label>0.2</label><p>无题条</p></sec>')
    expect(xml).not.toContain('sec_intro')
  })

  it('引言只有条、没有引言块时仍输出引言节；前言、引言都为空时都不输出', () => {
    const onlyClauses = renderOk(base({ introductionClauses: [clause('ic1', 1, '背景', [para('ic1-p', '正文')])] })).xml
    expect(squash(onlyClauses)).toContain('<sec id="sec_0" sec-type="intro"><title>引言</title><sec id="sec_0.1">')
    const none = renderOk(base({})).xml
    expect(none).not.toContain('sec_foreword')
    expect(none).not.toContain('sec-type="intro"')
  })
})

describe('章、条（设计 §2.2）', () => {
  const tree = makeDoc([
    chapter('ch1', '范围', [para('p1', '范围正文')], 'scope'),
    chapter('ch2', '规范性引用文件', [para('p2', '引导语')], 'norm-refs'),
    chapter('ch3', '术语和定义', [para('p3', '术语引导语')], 'terms'),
    chapter('ch4', '技术要求', [
      clause('c41', 1, '总体要求', [para('p41', '条正文'), clause('c411', 2, '细则', [para('p411', '二级条')])]),
      clause('c42', 1, '其他', [para('p42', '其他正文')]),
    ]),
  ])
  const { xml } = renderOk(tree)

  it('[M-4.4.2.1-01] [M-4.4.2.1-02] [M-4.4.2.1-03] [M-5.2-01] [M-5.2-02] 章与条都是 sec：id 取 Resolver 的 xmlId，label 取 Resolver 的编号，title 为标题；条嵌套表示层级', () => {
    expect(squash(xml)).toContain(
      '<sec id="sec_4"><label>4</label><title>技术要求</title>'
      + '<sec id="sec_4.1"><label>4.1</label><title>总体要求</title><p>条正文</p>'
      + '<sec id="sec_4.1.1"><label>4.1.1</label><title>细则</title><p>二级条</p></sec></sec>'
      + '<sec id="sec_4.2"><label>4.2</label><title>其他</title><p>其他正文</p></sec></sec>',
    )
  })

  it('[M-4.4.2.2-01] [M-4.4.2.3-01] [M-4.4.2.4-01] [M-9.1-01] sec-type：scope、norm-refs、terms 原样；general 不写 sec-type', () => {
    const compact = squash(xml)
    expect(compact).toContain('<sec id="sec_1" sec-type="scope"><label>1</label>')
    expect(compact).toContain('<sec id="sec_2" sec-type="norm-refs"><label>2</label>')
    expect(compact).toContain('<sec id="sec_3" sec-type="terms"><label>3</label>')
    expect(compact).toContain('<sec id="sec_4"><label>4</label>')
  })

  it('[M-4.4.2.1-04] p 不带任何属性（IR 的 NodeId 不输出，不产生 p-<n> 形式的 id）', () => {
    expect(xml).toMatch(/<p>范围正文<\/p>/)
    expect(xml).not.toMatch(/<p [^>]*>/)
  })

  it('[M-5.2-02] 标题内的格式 mark 如实输出，不自动加 bold；label 只含文本', () => {
    const doc = makeDoc([{ kind: 'chapter', id: 'ch1', secType: 'scope', title: [{ text: '范围', marks: [{ type: 'italic' }] }, { text: '（试行）' }], children: [para('p1', '正文')] }])
    expect(squash(renderOk(doc).xml)).toContain('<label>1</label><title><italic>范围</italic>（试行）</title>')
  })

  it('[M-4.4.2.5-01] 无标题条：sec[@sec-type="numbered-paragraph"]，有 label，没有 title', () => {
    const doc = makeDoc([chapter('ch1', '技术要求', [clause('c1', 1, '总体', [clause('c11', 2, null, [para('p11', '无题条正文')])])])])
    expect(squash(renderOk(doc).xml)).toContain('<sec id="sec_1.1.1" sec-type="numbered-paragraph"><label>1.1.1</label><p>无题条正文</p></sec>')
  })

  it('title-ignored：无标题条（titled 为 false）带了标题文字时给 warning，标题不输出', () => {
    const odd = { ...clause('c11', 2, null, [para('p11', '正文')]), title: [{ text: '多余标题' }] }
    const doc = makeDoc([chapter('ch1', '技术要求', [clause('c1', 1, '总体', [odd])])])
    const { xml, problems } = renderOk(doc)
    expect(xml).not.toContain('多余标题')
    expect(find(problems, 'title-ignored')).toHaveLength(1)
    expect(find(problems, 'title-ignored')[0]).toMatchObject({ severity: 'warning', nodeId: 'c11' })
  })

  it('title-missing：章/条/附录的标题为空时给 warning 并写出空 <title/>（schema 要求章有 title）', () => {
    const doc = makeDoc([{ kind: 'chapter', id: 'ch1', secType: 'scope', title: [], children: [clause('c1', 1, '', [para('p1', '正文')])] }])
    const { xml, problems } = renderOk(doc)
    expect(squash(xml)).toContain('<sec id="sec_1" sec-type="scope"><label>1</label><title/>')
    expect(find(problems, 'title-missing').length).toBeGreaterThanOrEqual(2)
    expect(find(problems, 'title-missing').every(problem => problem.severity === 'warning')).toBe(true)
  })

  it('xml-label-missing：章/条在 labels 里没有编号时是 error，不拼接、不推算', () => {
    const doc = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')])
    const labels = { ...labelsOf(doc) }
    delete labels['ch1']
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-label-missing')).toHaveLength(1)
    expect(find(result.problems, 'xml-label-missing')[0]).toMatchObject({ severity: 'error', nodeId: 'ch1', path: 'doc.body[0]' })
  })

  it('xml-body-empty：没有章是 error（body 至少需要一个章）', () => {
    const result = exportDoc(makeDoc([]))
    expect(result.xml).toBeNull()
    expect(codesOf(result.problems, 'error')).toContain('xml-body-empty')
    expect(find(result.problems, 'xml-body-empty')[0]).toMatchObject({ path: 'doc.body' })
  })
})

describe('sec 内容三态（设计 §2.2）', () => {
  const note = { kind: 'note' as const, id: 'n1', content: [para('n1.p0', '尾部的注')] }
  const example = { kind: 'example' as const, id: 'e1', content: [para('e1.p0', '尾部的示例')] }

  it('[M-4.4.2.1-04] 块在前，然后是子条，最后是尾部的注与示例：尾部的注/示例允许出现在子条之后', () => {
    const doc = makeDoc([chapter('ch1', '技术要求', [para('p1', '前导段'), clause('c1', 1, '条', [para('p11', '条正文')]), note, example])])
    const { xml } = renderOk(doc)
    expect(squash(xml)).toContain(
      '<p>前导段</p><sec id="sec_1.1"><label>1.1</label><title>条</title><p>条正文</p></sec>'
      + '<non-normative-note><label>注：</label><p>尾部的注</p></non-normative-note><non-normative-example><label>示例：</label><p>尾部的示例</p></non-normative-example>',
    )
  })

  it('xml-block-after-subsec：子条之后出现段落、列项、代码等其他块是 error，路径与节点精确', () => {
    const late = para('p-late', '悬置的段落')
    const doc = makeDoc([chapter('ch1', '技术要求', [clause('c1', 1, '条', [para('p11', '条正文')]), late])])
    const result = exportDoc(doc)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-block-after-subsec')).toHaveLength(1)
    expect(find(result.problems, 'xml-block-after-subsec')[0]).toMatchObject({ severity: 'error', nodeId: 'p-late', path: 'doc.body[0].children[1]' })
  })

  it('引言块不会出现在引言条之后（IR 把二者分开存放，顺序天然成立）', () => {
    const doc = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], {
      front: { foreword: [], introduction: [para('in1', '引言块')], introductionClauses: [clause('ic1', 1, '条', [para('ic1-p', '条正文')])] },
    })
    expect(codesOf(exportDoc(doc).problems, 'error')).toEqual([])
  })
})

describe('sec 内容次序：尾部的注/示例/清单之后不能再出现子条/术语条（设计 §2.2，Codex 评审 PR #62，2026-10-28）', () => {
  const note = { kind: 'note' as const, id: 'n1', content: [para('n1.p0', '尾部的注')] }
  const example = { kind: 'example' as const, id: 'e1', content: [para('e1.p0', '尾部的示例')] }
  const normRefList: IRNormRefList = {
    kind: 'normRefList', id: 'nrl', entries: [{ kind: 'normRef', id: 'nr1', entryType: 'std', ref: [{ text: 'GB/T 321' }], title: [{ text: '优先数和优先数系' }] }],
  }
  const termEntry = (id: string): IRTermEntry => ({ kind: 'termEntry', id, term: [{ text: `术语${id}` }], definition: [para(`${id}.d0`, '定义。')], notes: [], examples: [] })
  const MESSAGE = '尾部的注/示例/清单之后不能再出现子条/术语条（sec 内容次序：块、子条、尾部注/示例/清单）'

  /** 把 `children` 放进指定类型的章（术语章里放 termEntry、norm-refs 章里放清单，其余放普通章）。 */
  const docOf = (children: IRClauseChild[], secType: Parameters<typeof chapter>[3] = 'general'): IRDoc =>
    makeDoc([chapter('ch1', '技术要求', children, secType)])

  it.each([
    ['[clause, note, clause]', docOf([clause('c1', 1, '条一', [para('c1.p', '条一正文')]), note, clause('c2', 1, '条二', [para('c2.p', '条二正文')])]), 'c2'],
    ['[clause, example, clause]', docOf([clause('c1', 1, '条一', [para('c1.p', '条一正文')]), example, clause('c2', 1, '条二', [para('c2.p', '条二正文')])]), 'c2'],
    ['[termEntry, note, termEntry]（术语章）', docOf([termEntry('t1'), note, termEntry('t2')], 'terms'), 't2'],
    ['[clause, note, termEntry]（术语章）', docOf([clause('c1', 1, '分组', [termEntry('t1')]), note, termEntry('t2')], 'terms'), 't2'],
    ['[clause, normRefList, clause]（规范性引用文件章）', docOf([clause('c1', 1, '条一', [para('c1.p', '条一正文')]), normRefList, clause('c2', 1, '条二', [para('c2.p', '条二正文')])], 'norm-refs'), 'c2'],
  ] as const)('%s：error xml-block-after-subsec，定位到尾部之后的那一条，xml 为 null', (_name, doc, nodeId) => {
    const result = exportDoc(doc)
    expect(result.xml).toBeNull()
    expect(codesOf(result.problems, 'error')).toEqual(['xml-block-after-subsec'])
    expect(find(result.problems, 'xml-block-after-subsec')).toMatchObject([{ severity: 'error', nodeId, path: 'doc.body[0].children[2]', message: expect.stringContaining(MESSAGE) }])
  })

  it('嵌套的条与附录同样适用；尾部之后的子条不输出（只输出尾部之前的内容）', () => {
    const inner = clause('c1', 1, '条', [clause('c1-1', 2, '子条一', [para('c1-1.p', '正文')]), note, clause('c1-2', 2, '子条二', [para('c1-2.p', '正文')])])
    const nested = exportDoc(docOf([inner]))
    expect(nested.xml).toBeNull()
    expect(find(nested.problems, 'xml-block-after-subsec')).toMatchObject([{ severity: 'error', nodeId: 'c1-2', path: 'doc.body[0].children[0].children[2]' }])

    const inAppendix = exportDoc(makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], {
      appendices: [appendix('app-a', false, '附录', [clause('a1', 1, '条一', [para('a1.p', '正文')]), example, clause('a2', 1, '条二', [para('a2.p', '正文')])])],
    }))
    expect(inAppendix.xml).toBeNull()
    expect(find(inAppendix.problems, 'xml-block-after-subsec')).toMatchObject([{ severity: 'error', nodeId: 'a2', path: 'doc.appendices[0].children[2]' }])

    const doc = docOf([clause('c1', 1, '条一', [para('c1.p', '条一正文')]), note, clause('c2', 1, '条二', [para('c2.p', '条二正文')])])
    const session = createRenderSession(doc, labelsOf(doc), EMPTY_OPTIONS)
    session.ctx.scope.chapter = doc.body[0]
    const elements = session.ctx.renderSectionContent(doc.body[0]!.children, site('doc.body[0].children'))
    expect(elements.map((element) => element.name.local)).toEqual(['sec', 'non-normative-note'])
  })

  it('尾部（注、示例）之后的每个子条各报一条，路径各自精确', () => {
    const doc = docOf([clause('c1', 1, '条一', [para('c1.p', '正文')]), note, example, clause('c2', 1, '条二', [para('c2.p', '正文')]), clause('c3', 1, '条三', [para('c3.p', '正文')])])
    const result = exportDoc(doc)
    expect(find(result.problems, 'xml-block-after-subsec').map((problem) => [problem.nodeId, problem.path])).toEqual([
      ['c2', 'doc.body[0].children[3]'], ['c3', 'doc.body[0].children[4]'],
    ])
  })

  it('合法次序不报：[clause, clause, note, example]、[段落, clause, note, example]、[termEntry, termEntry, note]、[clause, clause, normRefList]', () => {
    const legal: Array<[string, IRDoc]> = [
      ['[clause, clause, note, example]', docOf([clause('c1', 1, '条一', [para('c1.p', '正文')]), clause('c2', 1, '条二', [para('c2.p', '正文')]), note, example])],
      ['[para, clause, note, example]', docOf([para('p0', '前导段'), clause('c1', 1, '条一', [para('c1.p', '正文')]), note, example])],
      ['[termEntry, termEntry, note]', docOf([termEntry('t1'), termEntry('t2'), note], 'terms')],
      ['[clause, clause, normRefList]', docOf([clause('c1', 1, '条一', [para('c1.p', '正文')]), clause('c2', 1, '条二', [para('c2.p', '正文')]), normRefList], 'norm-refs')],
    ]
    for (const [name, doc] of legal) {
      const result = exportDoc(doc)
      expect(codesOf(result.problems, 'error'), name).toEqual([])
      expect(result.xml, name).not.toBeNull()
    }
  })

  describe.skipIf(shouldSkipValidation())('外部校验：合法次序的导出通过 validate.py --profile export', () => {
    it('[段落, clause, clause, note, example]、[clause, clause, normRefList]、[termEntry, termEntry, note, example]：valid:true，errors:[]', () => {
      const docs = [
        docOf([para('p0', '前导段'), clause('c1', 1, '条一', [para('c1.p', '正文')]), clause('c2', 1, '条二', [para('c2.p', '正文')]), note, example]),
        docOf([clause('c1', 1, '条一', [para('c1.p', '正文')]), clause('c2', 1, '条二', [para('c2.p', '正文')]), normRefList], 'norm-refs'),
        docOf([termEntry('t1'), termEntry('t2'), note, example], 'terms'),
      ]
      for (const doc of docs) {
        const result = validateWithPython(renderOk(doc).xml, 'export')
        expect(result.errors).toEqual([])
        expect(result.valid).toBe(true)
      }
    })
  })
})

describe('附录与后置页（设计 §2.2）', () => {
  const doc = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], {
    appendices: [
      appendix('app-a', false, '资料性附录', [clause('app-a-1', 1, '附录中的条', [para('app-a-1-p', '条正文')]), clause('app-a-2', 1, '第二条', [para('app-a-2-p', '第二条正文')])]),
      appendix('app-b', true, '规范性附录', [para('app-b-p', '附录正文')]),
    ],
  })
  const { xml } = renderOk(doc)

  it('[M-4.5.2-01] [M-4.5.2-02] app-group/app：id 取 Resolver（sec_A、sec_B），content-type 为 informative/normative', () => {
    const compact = squash(xml)
    expect(compact).toContain('<back><app-group><app id="sec_A" content-type="informative">')
    expect(compact).toContain('<app id="sec_B" content-type="normative">')
  })

  it('[M-4.5.2-03] app/label：“附录”与字母之间插入半角空格（“附录A”→“附录 A”）', () => {
    const compact = squash(xml)
    expect(compact).toContain('<label>附录 A</label>')
    expect(compact).toContain('<label>附录 B</label>')
  })

  it('[M-4.5.2-04] annex-type：（资料性）/（规范性），全角括号', () => {
    const compact = squash(xml)
    expect(compact).toContain('<annex-type>（资料性）</annex-type>')
    expect(compact).toContain('<annex-type>（规范性）</annex-type>')
  })

  it('[M-4.5.2-05] [M-4.5.2-06] 附录标题用 title；附录中的条沿用字母前缀（sec_A.1、label A.1）', () => {
    const compact = squash(xml)
    expect(compact).toContain('<label>附录 A</label><annex-type>（资料性）</annex-type><title>资料性附录</title><sec id="sec_A.1"><label>A.1</label><title>附录中的条</title>')
    expect(compact).toContain('<sec id="sec_A.2"><label>A.2</label>')
    expect(compact).toContain('<title>规范性附录</title><p>附录正文</p></app>')
  })

  it('附录的标题为空给 title-missing；附录标签不以“附录”开头（Resolver 契约被破坏）是 xml-label-missing', () => {
    const noTitle = makeDoc([chapter('ch1', '范围', [para('p1', '正文')], 'scope')], { appendices: [{ kind: 'appendix', id: 'app-a', normative: false, title: [], children: [para('a-p', '正文')] }] })
    expect(find(renderOk(noTitle).problems, 'title-missing')).toHaveLength(1)
    const labels = { ...labelsOf(doc) }
    labels['app-a'] = { ...labels['app-a']!, label: 'Annex A' }
    const result = exportXml46687(doc, labels, EMPTY_OPTIONS)
    expect(result.xml).toBeNull()
    expect(find(result.problems, 'xml-label-missing')).toHaveLength(1)
  })

  it('[M-4.1-03] 有附录时输出 back，且 back 在 body 之后', () => {
    const compact = squash(xml)
    expect(compact.indexOf('</body><back>')).toBeGreaterThan(-1)
  })
})

describe('整体容器', () => {
  it('bodyOf 工具：取 body 内片段', () => {
    const { xml } = renderOk(makeDoc([chapter('ch1', '范围', [para('p1', '甲', run('乙', { type: 'bold' }))], 'scope')]))
    expect(squash(bodyOf(xml))).toBe('<sec id="sec_1" sec-type="scope"><label>1</label><title>范围</title><p>甲<bold>乙</bold></p></sec>')
  })
})
