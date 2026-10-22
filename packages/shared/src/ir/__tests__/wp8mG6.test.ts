/**
 * WP8.M G6：引言中的条（docs/wp8.m/design.md §4.6；矩阵 M-4.3.4-02、M-4.3.4-03；约定 C-S-10、X-05、R-7）。
 *
 * GB/T 1.1—2020 8.4：「引言不应给出章编号。当引言的内容需要分条时，应仅对条编号，编为 0.1、0.2 等。」
 * IR 用兄弟字段 `front.introductionClauses`（D-M-10）：块在前、条在后；条之后再出现正文块是悬置段，
 * pmToIr 报 unsupportedContent。本文件覆盖 IR/Resolver/PM 映射与诊断；输出边界与排版见 renderers/__tests__/wp8mG6.test.ts，
 * 生产 Schema 与保存重开见 client/src/extensions/wp8mG6.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { hasSemanticExtensions } from '../extensions'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRDoc } from '../types'
import { collectFootnotes } from '../footnotes'
import { createG6IrDoc, createG6IrDocWithoutClauses, introductionClauses } from './wp8mG6Fixtures'

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

function errors(doc: IRDoc) { return resolve(doc).problems.filter(problem => problem.severity === 'error') }

describe('[M-4.3.4-03] Resolver：引言中的条编号 0.n、xmlId sec_0.n', () => {
  const doc = createG6IrDoc()
  const { labels, problems } = resolve(doc)

  it('条标签为 0.1、0.1.1、0.2、0.3，xmlId 为 sec_0.n，refText 同标签', () => {
    expect(labels['intro-c1']).toEqual({ label: '0.1', xmlId: 'sec_0.1', refText: '0.1' })
    expect(labels['intro-c1-1']).toEqual({ label: '0.1.1', xmlId: 'sec_0.1.1', refText: '0.1.1' })
    expect(labels['intro-c2']).toEqual({ label: '0.2', xmlId: 'sec_0.2', refText: '0.2' })
    // 无标题条也占一个编号（与正文无题条一致）
    expect(labels['intro-c3']).toEqual({ label: '0.3', xmlId: 'sec_0.3', refText: '0.3' })
  })

  it('没有 error；引言只有条、没有正文块，不产生悬置段/层级跳级告警', () => {
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(problems.filter(problem => ['hanging-paragraph', 'heading-skip', 'empty-section'].includes(problem.code))).toEqual([])
  })

  it('引言条不影响正文章条编号：第 1 章仍是 1，其条仍是 1.1', () => {
    expect(labels['ch1']).toMatchObject({ label: '1', xmlId: 'sec_1' })
    expect(labels['ch1-c1']).toMatchObject({ label: '1.1', xmlId: 'sec_1.1' })
  })

  it('引言自身的 sec_0 / sec_intro 是渲染器常量（R-6、X-05），Resolver 不给引言赋 label', () => {
    expect(Object.keys(labels).filter(key => key.startsWith('front.'))).toEqual([])
    expect(Object.values(labels).some(label => label.xmlId === 'sec_0' || label.xmlId === 'sec_intro')).toBe(false)
  })

  it('图表从引言起连续编号并接续正文（9.7.2.1、9.8.2.1）；引言条内的注以该条为作用域', () => {
    expect(labels['intro-tab']).toMatchObject({ label: '表1', xmlId: 'tab_1' })
    expect(labels['intro-fig']).toMatchObject({ label: '图1', xmlId: 'fig_1' })
    expect(labels['body-tab']).toMatchObject({ label: '表2' })
    expect(labels['body-fig']).toMatchObject({ label: '图2' })
    expect(labels['intro-c1-1-note']).toMatchObject({ label: '注：', xmlId: 'note_1' })
  })

  it('脚注按文档顺序编号：引言条里的在前，正文的在后', () => {
    expect(labels['intro-fn1']).toMatchObject({ label: '1)' })
    expect(labels['body-fn1']).toMatchObject({ label: '2)' })
    expect(collectFootnotes(doc).map(footnote => footnote.id)).toEqual(['intro-fn1', 'body-fn1'])
  })

  it('正文对引言条的交叉引用取 Resolver 的 refText', () => {
    expect(labels['intro-c1']!.refText).toBe('0.1')
    expect(labels['intro-c1-1']!.refText).toBe('0.1.1')
    expect(problems.filter(problem => problem.code === 'dangling-xref' || problem.code === 'dangling-typed-ref')).toEqual([])
  })

  it('同一输入两次解析结果深度相等（纯函数），且不修改入参', () => {
    const before = JSON.stringify(doc)
    expect(resolve(doc)).toEqual(resolve(doc))
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('条的层级与深度不符时给出 heading-skip 警告（与正文条同一检查）', () => {
    const skipped = createG6IrDoc()
    skipped.front.introductionClauses![0]!.level = 2
    expect(resolve(skipped).problems.filter(problem => problem.code === 'heading-skip')).toEqual([
      expect.objectContaining({ nodeId: 'intro-c1', severity: 'warning' }),
    ])
  })

  it('引言既有正文块又有条：给 hanging-paragraph 警告（块仍按原路径登记 ID 与注作用域）', () => {
    const mixed = createG6IrDoc()
    mixed.front.introduction = [{ kind: 'paragraph', id: 'intro-lead', content: [{ text: '导语' }] }]
    const result = resolve(mixed)
    expect(result.problems.filter(problem => problem.code === 'hanging-paragraph')).toEqual([
      expect.objectContaining({ nodeId: 'front.introduction', severity: 'warning' }),
    ])
    expect(result.problems.filter(problem => problem.severity === 'error')).toEqual([])
  })

  it('引言条重复使用已有 ID 时报 duplicate-id（条同样经过 registerId）', () => {
    const duplicated = createG6IrDoc()
    duplicated.front.introductionClauses![1]!.id = 'intro-c1'
    expect(errors(duplicated).some(problem => problem.code === 'duplicate-id' && problem.nodeId === 'intro-c1')).toBe(true)
  })

  it('引言条内的脚注限制与正文条一致：条标题中的脚注报 invalid-footnote', () => {
    const bad = createG6IrDoc()
    bad.front.introductionClauses![0]!.title = [{ text: '背景', footnote: { id: 'intro-title-fn', content: [{ text: '不能放在标题里' }] } }]
    expect(errors(bad).some(problem => problem.code === 'invalid-footnote')).toBe(true)
  })
})

describe('[M-4.3.4-02] 无条的引言保持原样', () => {
  it('没有 introductionClauses（或为空数组）的引言：Resolver 结果完全相同，不产生 sec_0.n', () => {
    const legacy = createG6IrDocWithoutClauses()
    const empty = clone(legacy)
    empty.front.introductionClauses = []
    const { labels, problems, bibliographyOrder } = resolve(legacy)
    expect(resolve(empty)).toMatchObject({ labels, problems, bibliographyOrder })
    expect(Object.values(labels).some(label => label.xmlId.startsWith('sec_0'))).toBe(false)
    expect(labels['intro-p1']).toBeUndefined()
  })

  it('hasSemanticExtensions：仅当 introductionClauses 非空时为真；空数组/缺省不触发 extensionVersion', () => {
    const legacy = createG6IrDocWithoutClauses()
    expect(hasSemanticExtensions(legacy)).toBe(false)
    expect(hasSemanticExtensions({ ...legacy, front: { ...legacy.front, introductionClauses: [] } })).toBe(false)
    expect(hasSemanticExtensions(createG6IrDoc())).toBe(true)
    expect(hasSemanticExtensions({ front: { foreword: [], introduction: [], introductionClauses: introductionClauses() } })).toBe(true)
  })

  it('无条引言：irToPm 不写 extensionVersion，引言容器里只有块', () => {
    const pm = irToPm(createG6IrDocWithoutClauses())
    expect(pm.attrs).toBeUndefined()
    const introduction = pm.content!.find(node => node.type === 'introduction')!
    expect(introduction.content!.map(node => node.type)).toEqual(['stdParagraph'])
  })
})

describe('[M-4.3.4-02] IR ↔ PM 映射', () => {
  it('irToPm：引言容器里先块后条；只有条时也输出引言容器；条的 level/hasTitle 属性原样写出', () => {
    const pm = irToPm(createG6IrDoc())
    expect(pm.attrs).toEqual({ extensionVersion: 1 })
    const introduction = pm.content!.find(node => node.type === 'introduction')!
    expect(introduction.content!.map(node => node.type)).toEqual(['clause', 'clause', 'clause'])
    expect(introduction.content!.map(node => node.attrs)).toEqual([
      { nodeId: 'intro-c1', level: 1, hasTitle: true },
      { nodeId: 'intro-c2', level: 1, hasTitle: true },
      { nodeId: 'intro-c3', level: 1, hasTitle: false },
    ])
    const nested = introduction.content![0]!.content!.find(node => node.type === 'clause')!
    expect(nested.attrs).toEqual({ nodeId: 'intro-c1-1', level: 2, hasTitle: true })

    const mixed = createG6IrDoc()
    mixed.front.introduction = [{ kind: 'paragraph', id: 'intro-lead', content: [{ text: '导语' }] }]
    const mixedPm = irToPm(mixed).content!.find(node => node.type === 'introduction')!
    expect(mixedPm.content!.map(node => node.type)).toEqual(['stdParagraph', 'clause', 'clause', 'clause'])
  })

  it('IR → PM → IR 往返：introductionClauses 深度相等，extensionVersion 为 1，Resolver 无 error', () => {
    const original = createG6IrDoc()
    const pm = irToPm(original)
    const { doc, warnings } = pmToIr(pm)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.extensionVersion).toBe(1)
    expect(doc.front.introductionClauses).toEqual(original.front.introductionClauses)
    expect(doc.front.introduction).toEqual([])
    expect(errors(doc)).toEqual([])
    // JSON 往返无损，再投影一次结果不变
    const reparsed = JSON.parse(JSON.stringify(doc)) as IRDoc
    expect(reparsed).toEqual(doc)
    expect(pmToIr(irToPm(reparsed)).doc).toEqual(doc)
  })

  it('引言块 + 条的往返：块仍在 introduction，条在 introductionClauses，顺序不变', () => {
    const mixed = createG6IrDoc()
    mixed.front.introduction = [{ kind: 'paragraph', id: 'intro-lead', content: [{ text: '导语' }] }]
    const { doc, warnings } = pmToIr(irToPm(mixed))
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.front.introduction).toEqual(mixed.front.introduction)
    expect(doc.front.introductionClauses).toEqual(mixed.front.introductionClauses)
  })

  it('空 introductionClauses 数组与缺省等价：irToPm 不输出引言容器', () => {
    const doc = createG6IrDocWithoutClauses()
    doc.front = { foreword: [], introduction: [], introductionClauses: [] }
    expect(irToPm(doc).content!.some(node => node.type === 'introduction')).toBe(false)
  })
})

describe('[M-4.3.4-02] 悬置段诊断：条之后不能再有引言正文块', () => {
  const paragraph = (id: string, text: string): PMJsonNode => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [{ type: 'text', text }] })
  const clauseNode = (id: string): PMJsonNode => ({
    type: 'clause', attrs: { nodeId: id, level: 1, hasTitle: true },
    content: [{ type: 'clauseTitle', content: [{ type: 'text', text: '标题' }] }, paragraph(`${id}-p`, '条文')],
  })
  const docOf = (...introductions: PMJsonNode[][]): PMJsonNode => ({
    type: 'doc',
    content: [
      ...introductions.map((content, index) => ({ type: 'introduction', attrs: { nodeId: `intro-${index}` }, content })),
      { type: 'chapter', attrs: { nodeId: 'ch1' }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] }, paragraph('ch1-p', '正文')] },
    ],
  })

  it('条之后的段落：给出明确的 unsupportedContent（含节点 ID、路径与原因），块仍保留在 introduction', () => {
    const { doc } = pmToIr(docOf([paragraph('intro-lead', '导语'), clauseNode('c1'), paragraph('hanging', '悬置段')]))
    expect(doc.front.introduction.map(block => block.id)).toEqual(['intro-lead', 'hanging'])
    expect(doc.front.introductionClauses?.map(clause => clause.id)).toEqual(['c1'])
    expect(doc.unsupportedContent).toEqual([{
      nodeId: 'hanging',
      path: 'doc.content[0].content[2]',
      nodeType: 'stdParagraph',
      reason: expect.stringContaining('引言中条之后的正文块（悬置段）无法保存'),
    }])
    // Resolver 把它作为 error 报出，IR → PM 拒绝（不静默丢弃、不重排）
    expect(errors(doc).some(problem => problem.code === 'unsupported-content' && problem.message.includes('悬置段'))).toBe(true)
    expect(() => irToPm(doc)).toThrow(IRToPmError)
  })

  it('每个条后的块各记一条；条前的块与引言条本身不报', () => {
    const { doc } = pmToIr(docOf([paragraph('lead', '导语'), clauseNode('c1'), paragraph('h1', '一'), clauseNode('c2'), paragraph('h2', '二')]))
    expect(doc.unsupportedContent?.map(item => item.nodeId)).toEqual(['h1', 'h2'])
    expect(doc.front.introductionClauses?.map(clause => clause.id)).toEqual(['c1', 'c2'])
  })

  it('块在前、条在后：没有诊断', () => {
    const { doc } = pmToIr(docOf([paragraph('lead', '导语'), clauseNode('c1'), clauseNode('c2')]))
    expect(doc.unsupportedContent).toBeUndefined()
    expect(doc.front.introduction.map(block => block.id)).toEqual(['lead'])
    expect(doc.front.introductionClauses?.map(clause => clause.id)).toEqual(['c1', 'c2'])
  })

  it('多个 introduction 容器：沿用合并诊断；前一容器的条之后的块同样是悬置段，条按文档顺序合并', () => {
    const { doc } = pmToIr(docOf([clauseNode('c1')], [paragraph('later', '后一容器的块'), clauseNode('c2')]))
    expect(doc.front.introductionClauses?.map(clause => clause.id)).toEqual(['c1', 'c2'])
    expect(doc.unsupportedContent?.map(item => item.reason)).toEqual([
      expect.stringContaining('多个introduction容器合并'),
      expect.stringContaining('悬置段'),
    ])
    expect(doc.unsupportedContent?.map(item => item.nodeId)).toEqual(['intro-1', 'later'])
  })

  it('引言里原本无法表达的节点仍走 unknown 诊断，不因条的出现而丢失', () => {
    const { doc, warnings } = pmToIr(docOf([clauseNode('c1')], [{ type: 'bibliography', content: [] }]))
    expect(doc.unsupportedContent?.some(item => item.nodeType === 'bibliography')).toBe(true)
    expect(warnings.some(warning => warning.includes('bibliography'))).toBe(true)
  })

  it('引言条为无题条时 clauseTitle 不得有内容（与正文条同一诊断）', () => {
    const untitled = clauseNode('c1')
    untitled.attrs = { nodeId: 'c1', level: 1, hasTitle: false }
    const { doc } = pmToIr(docOf([untitled]))
    expect(doc.unsupportedContent?.some(item => item.nodeId === 'c1' && item.reason.includes('无题条'))).toBe(true)
  })
})
