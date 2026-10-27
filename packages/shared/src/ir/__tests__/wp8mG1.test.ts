/**
 * WP8.M G1：规范性引用文件清单、正文 std / mixed-citation 引用、参考文献标题
 * （docs/wp8.m/design.md §4.1；矩阵 M-4.4.2.3-02/-03/-04、M-4.4.2.3.2-01、M-10.2-01/-02、M-10.1.7-01、M-4.5.3-02、M-E-06；
 *  约定 C-S-24、C-S-27、C-T-54、X-09、X-10、R-8）。
 *
 * 本文件覆盖 shared 侧的 IR / Resolver / PM↔IR 映射与诊断（PM 为纯 JSON 对象，不依赖 @tiptap）；
 * 输出边界与 HTML/DOCX 排版见 renderers/__tests__/wp8mG1.test.ts，生产 Schema 与保存重开见 client/src/extensions/wp8mG1.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { hasSemanticExtensions } from '../extensions'
import { collectFootnotes } from '../footnotes'
import { normalizeAuthoringFragment } from '../authoring'
import { IRToPmError, irFragmentToPm, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRChapter, IRDoc, IRInline, IRNormRefList } from '../types'
import { fullFixture } from './fixtures'
import { getOutputSupportProblems } from '../../renderers/outputBoundary'
import { renderHtml } from '../../renderers/html'
import { createG1IrDoc, createG1LegacyIrDoc, createG1PmDoc, g1NormRefList } from './wp8mG1Fixtures'

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function errors(doc: IRDoc) { return resolve(doc).problems.filter(problem => problem.severity === 'error') }
function normRefChapter(doc: IRDoc): IRChapter { return doc.body.find(chapter => chapter.id === 'g1-ch2')! }
function normRefList(doc: IRDoc): IRNormRefList { return normRefChapter(doc).children.find(child => child.kind === 'normRefList') as IRNormRefList }
function walkPm(node: PMJsonNode, fn: (node: PMJsonNode) => void): void { fn(node); node.content?.forEach(child => walkPm(child, fn)) }

describe('[M-4.4.2.3-02] Resolver：规范性引用清单只能是 norm-refs 章的直属块', () => {
  it('norm-refs 章内的清单：没有 error，清单块自身不产生标签', () => {
    const doc = createG1IrDoc()
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['g1-nrl']).toBeUndefined()
  })

  it('清单出现在其他类型的章（general、scope、terms）：报 unsupported-content error，节点为清单 id', () => {
    for (const secType of ['general', 'scope', 'terms'] as const) {
      const doc = createG1IrDoc()
      normRefChapter(doc).secType = secType
      const issues = errors(doc).filter(problem => problem.code === 'unsupported-content')
      expect(issues, secType).toEqual([expect.objectContaining({ nodeId: 'g1-nrl', message: expect.stringContaining('规范性引用文件') })])
    }
  })

  it('清单出现在条内、附录内、注内或前言：同样报 error（只认 norm-refs 章的直属位置）', () => {
    const inClause = createG1IrDoc()
    const list = normRefList(inClause)
    normRefChapter(inClause).children = [
      { kind: 'clause', id: 'g1-clause', level: 1, titled: true, title: [{ text: '条' }], children: [list] },
    ]
    expect(errors(inClause).filter(problem => problem.code === 'unsupported-content').map(problem => problem.nodeId)).toEqual(['g1-nrl'])

    const inAppendix = createG1IrDoc()
    inAppendix.appendices = [{ kind: 'appendix', id: 'g1-app', normative: false, title: [{ text: '附录' }], children: [normRefList(inAppendix)] }]
    normRefChapter(inAppendix).children = [{ kind: 'paragraph', id: 'g1-ch2-p', content: [{ text: '本文件没有规范性引用文件。' }] }]
    expect(errors(inAppendix).filter(problem => problem.code === 'unsupported-content').map(problem => problem.nodeId)).toEqual(['g1-nrl'])

    const inForeword = createG1IrDoc()
    inForeword.front.foreword.push(normRefList(inForeword))
    normRefChapter(inForeword).children = [{ kind: 'paragraph', id: 'g1-ch2-p', content: [{ text: '本文件没有规范性引用文件。' }] }]
    expect(errors(inForeword).filter(problem => problem.code === 'unsupported-content').map(problem => problem.nodeId)).toEqual(['g1-nrl'])
  })

  it('违规位置的清单仍登记 ID 与条目标签（不会因报错而丢失节点，也不出现 ext_ 占位）', () => {
    const doc = createG1IrDoc()
    normRefChapter(doc).secType = 'general'
    const { labels } = resolve(doc)
    expect(labels['g1-nr-1']).toMatchObject({ xmlId: 'ref_1' })
    expect(Object.values(labels).some(label => label.xmlId.startsWith('ext_'))).toBe(false)
  })

  it('文档里有多个清单：报 error（条目 xmlId 会重复、XML id 冲突），提示合并为一个清单；第一个清单不受影响', () => {
    const doc = createG1IrDoc()
    const second = clone(normRefList(doc))
    second.id = 'g1-nrl-2'
    second.entries.forEach((entry, index) => { entry.id = `g1-nr2-${index}` })
    // 第二个清单里的脚注 ID 也要唯一
    ;(second.entries[3] as { content: IRInline[] }).content[1]!.footnote!.id = 'g1-fn-nr2'
    normRefChapter(doc).children.push(second)
    const problems = resolve(doc).problems
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([
      expect.objectContaining({ code: 'unsupported-content', nodeId: 'g1-nrl-2', message: expect.stringContaining('多个规范性引用文件清单') }),
    ])
    expect(problems.find(problem => problem.nodeId === 'g1-nrl-2')!.message).toContain('合并为一个清单')
    // 两个清单分处不同的 norm-refs 章也一样（仍然是同一份文档里的第二个清单）
    const twoChapters = createG1IrDoc()
    twoChapters.body.push({ kind: 'chapter', id: 'g1-ch-extra', secType: 'norm-refs', title: [{ text: '规范性引用文件' }], children: [{ ...clone(second), id: 'g1-nrl-3', entries: second.entries.map(entry => ({ ...clone(entry), id: `${entry.id}-x` })) as IRNormRefList['entries'] }] })
    ;((twoChapters.body[3]!.children[0] as IRNormRefList).entries[3] as { content: IRInline[] }).content[1]!.footnote!.id = 'g1-fn-nr3'
    expect(errors(twoChapters).filter(problem => problem.code === 'unsupported-content').map(problem => problem.nodeId)).toEqual(['g1-nrl-3'])
  })

  it('只有一个清单：没有该 error（回归）', () => {
    expect(errors(createG1IrDoc()).filter(problem => problem.code === 'unsupported-content')).toEqual([])
  })

  it('条目或清单 ID 重复：duplicate-id；缺少 ID：missing-id', () => {
    const duplicated = createG1IrDoc()
    normRefList(duplicated).entries[1]!.id = 'g1-nr-1'
    expect(errors(duplicated).some(problem => problem.code === 'duplicate-id' && problem.nodeId === 'g1-nr-1')).toBe(true)
    const missing = createG1IrDoc()
    normRefList(missing).entries[0]!.id = ''
    expect(errors(missing).some(problem => problem.code === 'missing-id')).toBe(true)
  })
})

describe('[M-E-06] Resolver：条目 xmlId 为 ref_<清单内序号>（R-8、X-10），label 为空', () => {
  const { labels } = resolve(createG1IrDoc())

  it('四个条目依序为 ref_1…ref_4，label 为空（条目之前不给序号，GB/T 1.1—2020 8.6.3.1）', () => {
    expect(['g1-nr-1', 'g1-nr-2', 'g1-nr-3', 'g1-nr-4'].map(id => [labels[id]!.label, labels[id]!.xmlId])).toEqual([
      ['', 'ref_1'], ['', 'ref_2'], ['', 'ref_3'], ['', 'ref_4'],
    ])
  })

  it('refText：std 取文件编号纯文本；mixed 取内容纯文本前 40 个字符', () => {
    expect(labels['g1-nr-1']!.refText).toBe('GB/T 321')
    expect(labels['g1-nr-2']!.refText).toBe('GB/T 3102（所有部分）')
    expect(labels['g1-nr-4']!.refText).toBe('《中华人民共和国计量法》')
    const long = createG1IrDoc()
    normRefList(long).entries[3] = { kind: 'normRef', id: 'g1-nr-4', entryType: 'mixed', content: [{ text: '甲'.repeat(60) }] }
    expect(resolve(long).labels['g1-nr-4']!.refText).toBe('甲'.repeat(40))
  })

  it('序号取清单内位置：在清单头部插入条目，后面的 xmlId 顺延；与参考文献的 biblref_<n> 互不影响', () => {
    const doc = createG1IrDoc()
    normRefList(doc).entries.unshift({ kind: 'normRef', id: 'g1-nr-0', entryType: 'mixed', content: [{ text: '新条目' }] })
    const result = resolve(doc)
    expect(result.labels['g1-nr-0']!.xmlId).toBe('ref_1')
    expect(result.labels['g1-nr-1']!.xmlId).toBe('ref_2')
    expect(result.labels['g1-bib-1']!.xmlId).toBe('biblref_1')
    expect(result.labels['g1-bib-2']!.xmlId).toBe('biblref_2')
  })

  it('条目是合法的交叉引用目标（有标签）：crossRef 指向条目得到 refText，无 dangling-xref', () => {
    const doc = createG1IrDoc()
    const paragraph = doc.body[2]!.children[0] as { content: IRInline[] }
    paragraph.content.push({ text: '占位', marks: [{ type: 'crossRef', targetId: 'g1-nr-2' }] })
    const result = resolve(doc)
    expect(result.problems.filter(problem => problem.code === 'dangling-xref')).toEqual([])
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] 条目末尾标点：warning（GB/T 1.1—2020 10.3.4 “文件之后不加标点符号”）', () => {
  const PUNCTUATION = ['；', ';', '，', ',', '。', '.', '、']
  const trailing = (doc: IRDoc) => resolve(doc).problems.filter(problem => problem.code === 'trailing-punctuation')

  it('夹具的条目末尾都没有标点：不告警', () => {
    expect(trailing(createG1IrDoc())).toEqual([])
    expect(resolve(createG1IrDoc()).problems.filter(problem => problem.severity === 'warning' && problem.nodeId?.startsWith('g1-nr'))).toEqual([])
  })

  it.each(PUNCTUATION)('std 条目的文件名称以“%s”结尾：warning，节点为该条目，severity=warning（不是 error）', punctuation => {
    const doc = createG1IrDoc()
    const entry = normRefList(doc).entries[0]!
    if (entry.entryType !== 'std') throw new Error('夹具应为 std 条目')
    entry.title = [{ text: `优先数和优先数系${punctuation}` }]
    expect(trailing(doc)).toEqual([expect.objectContaining({ nodeId: 'g1-nr-1', severity: 'warning', message: expect.stringContaining(`“${punctuation}”`) })])
    expect(errors(doc)).toEqual([])
  })

  it.each(PUNCTUATION)('mixed 条目的内容以“%s”结尾：warning', punctuation => {
    const doc = createG1IrDoc()
    normRefList(doc).entries[3] = { kind: 'normRef', id: 'g1-nr-4', entryType: 'mixed', content: [{ text: `《中华人民共和国计量法》${punctuation}` }] }
    expect(trailing(doc)).toEqual([expect.objectContaining({ nodeId: 'g1-nr-4', severity: 'warning' })])
    expect(errors(doc)).toEqual([])
  })

  it('末尾空白不算：“名称；  ”仍告警，“名称 ”不告警；标点在句中不告警；括号、引号结尾不告警（只认列出的句读标点）', () => {
    const doc = createG1IrDoc()
    const entries = normRefList(doc).entries
    const set = (index: number, title: string) => {
      const entry = entries[index]!
      if (entry.entryType !== 'std') throw new Error('夹具应为 std 条目')
      entry.title = [{ text: title }]
    }
    set(0, '优先数；  ')
    set(1, '量和单位 ')
    set(2, '量和单位（Quantities and units）')
    expect(trailing(doc).map(problem => problem.nodeId)).toEqual(['g1-nr-1'])
    set(0, '优先数；和优先数系')
    set(1, '《量和单位》')
    expect(trailing(doc)).toEqual([])
  })

  it('跨 run 取最后一个字符；末尾的脚注原子不影响判断（标点在脚注引用之前）；std 的名称为空时看文件编号', () => {
    const doc = createG1IrDoc()
    const entries = normRefList(doc).entries
    const first = entries[0]!
    if (first.entryType !== 'std') throw new Error('夹具应为 std 条目')
    first.title = [{ text: '优先数和', marks: [{ type: 'bold' }] }, { text: '优先数系' }, { text: '；', marks: [{ type: 'bold' }] }]
    const second = entries[1]!
    if (second.entryType !== 'std') throw new Error('夹具应为 std 条目')
    second.title = []
    second.ref = [{ text: 'GB/T 3102（所有部分）,' }]
    expect(trailing(doc).map(problem => problem.nodeId)).toEqual(['g1-nr-1', 'g1-nr-2'])
  })

  it('不剥离、不阻断：渲染输出保留作者原文，HTML/DOCX 边界无问题，pmToIr/irToPm 往返不变', () => {
    const doc = createG1IrDoc()
    normRefList(doc).entries[3] = { kind: 'normRef', id: 'g1-nr-4', entryType: 'mixed', content: [{ text: '《中华人民共和国计量法》；' }] }
    expect(trailing(doc)).toHaveLength(1)
    expect(pmToIr(irToPm(doc)).doc).toEqual(doc)
    const { labels } = resolve(doc)
    expect(renderHtml(doc, labels, { variant: 'print' })).toContain('《中华人民共和国计量法》；</p>')
    expect(getOutputSupportProblems(doc, 'HTML')).toEqual([])
    expect(getOutputSupportProblems(doc, 'DOCX')).toEqual([])
  })

  it('只检查规范性引用条目：普通段落、参考文献条目以标点结尾不告警', () => {
    const doc = createG1IrDoc()
    ;(doc.body[0]!.children[0] as { content: IRInline[] }).content = [{ text: '本文件规定了引用的写法。' }]
    expect(trailing(doc)).toEqual([])
    expect(doc.bibliography[0]!.content[0]!.text.endsWith('.')).toBe(true)
  })
})

describe('[M-4.4.2.3-03] [M-4.4.2.3-04] 条目内行内内容与脚注', () => {
  it('非标准化文件条目内允许脚注，按文档顺序编号 1)；引用清单之后的正文脚注顺延', () => {
    const doc = createG1IrDoc()
    ;(doc.body[2]!.children[0] as { content: IRInline[] }).content.push({ text: '', footnote: { id: 'g1-fn-body', content: [{ text: '正文脚注。' }] } })
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['g1-fn-nr']).toMatchObject({ label: '1)', xmlId: 'fn_1' })
    expect(labels['g1-fn-body']).toMatchObject({ label: '2)', xmlId: 'fn_2' })
    expect(collectFootnotes(doc).map(footnote => footnote.id)).toEqual(['g1-fn-nr', 'g1-fn-body'])
  })

  it('标准化文件条目的文件编号、文件名称里的脚注同样允许并参与编号', () => {
    const doc = createG1IrDoc()
    const entry = normRefList(doc).entries[0]!
    if (entry.entryType !== 'std') throw new Error('夹具应为 std 条目')
    entry.title.push({ text: '', footnote: { id: 'g1-fn-title', content: [{ text: '名称脚注。' }] } })
    const { labels, problems } = resolve(doc)
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(labels['g1-fn-title']).toMatchObject({ label: '1)' })
    expect(labels['g1-fn-nr']).toMatchObject({ label: '2)' })
    expect(collectFootnotes(doc).map(footnote => footnote.id)).toEqual(['g1-fn-title', 'g1-fn-nr'])
  })

  it('条目内的交叉引用被登记：指向不存在的目标报 dangling-xref', () => {
    const doc = createG1IrDoc()
    const entry = normRefList(doc).entries[3]!
    if (entry.entryType !== 'mixed') throw new Error('夹具应为 mixed 条目')
    entry.content.push({ text: '见', marks: [{ type: 'crossRef', targetId: 'nowhere' }] })
    expect(errors(doc).some(problem => problem.code === 'dangling-xref')).toBe(true)
  })
})

describe('[M-4.4.2.3-02] [M-4.4.2.3-03] [M-4.4.2.3-04] pmToIr / irToPm：清单与条目', () => {
  const pmDoc = createG1PmDoc()

  it('pmToIr：std 条目 → ref + title 两段行内，mixed 条目 → content；无 warning、无 unsupportedContent', () => {
    const { doc, warnings } = pmToIr(pmDoc)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent).toBeUndefined()
    const list = normRefList(doc)
    expect(list).toMatchObject({ kind: 'normRefList', id: 'g1-nrl' })
    expect(list.entries.map(entry => [entry.id, entry.entryType])).toEqual([
      ['g1-nr-1', 'std'], ['g1-nr-2', 'std'], ['g1-nr-3', 'std'], ['g1-nr-4', 'mixed'],
    ])
    expect(list.entries[0]).toEqual({ kind: 'normRef', id: 'g1-nr-1', entryType: 'std', ref: [{ text: 'GB/T 321' }], title: [{ text: '优先数和优先数系' }] })
    expect(list.entries[1]).toMatchObject({ ref: [{ text: 'GB/T 3102（所有部分）' }], title: [{ text: '量和单位' }] })
    const mixed = list.entries[3]!
    if (mixed.entryType !== 'mixed') throw new Error('夹具应为 mixed 条目')
    expect(mixed.content[0]).toEqual({ text: '《中华人民共和国计量法》' })
    expect(mixed.content[1]!.footnote).toMatchObject({ id: 'g1-fn-nr', content: [{ text: '非标准化文件的脚注。' }] })
  })

  it('章角色：标题为“规范性引用文件”时 pmToIr 推断 secType=norm-refs（显式 secType 优先）', () => {
    const inferred = clone(pmDoc)
    walkPm(inferred, node => { if (node.type === 'chapter' && node.attrs?.nodeId === 'g1-ch2') delete node.attrs.secType })
    const { doc } = pmToIr(inferred)
    expect(normRefChapter(doc).secType).toBe('norm-refs')
    expect(errors(doc)).toEqual([])
    // 显式 general 优先于标题推断，于是清单位置不合法，由 Resolver 报 error
    const explicit = clone(pmDoc)
    walkPm(explicit, node => { if (node.type === 'chapter' && node.attrs?.nodeId === 'g1-ch2') node.attrs!.secType = 'general' })
    expect(errors(pmToIr(explicit).doc).filter(problem => problem.code === 'unsupported-content').map(problem => problem.nodeId)).toEqual(['g1-nrl'])
  })

  it('irToPm 往返：PM 文档与原文档逐节点相同（含条目 nodeId、子节点顺序），冷重开后 IR 深度相等', () => {
    const first = pmToIr(pmDoc).doc
    const emitted = irToPm(first)
    expect(emitted).toEqual(pmDoc)
    expect(pmToIr(JSON.parse(JSON.stringify(emitted)) as PMJsonNode).doc).toEqual(first)
  })

  it('IR 原生文档 → PM → IR 往返不变（IR 原生夹具与 PM 夹具是同一文档）', () => {
    const native = createG1IrDoc()
    expect(irToPm(native)).toEqual(pmDoc)
    expect(pmToIr(irToPm(native)).doc).toEqual(native)
  })

  it('空清单、条目缺少子节点：irToPm 明确报错（PM 要求至少一个条目）而不是静默输出', () => {
    const doc = createG1IrDoc()
    normRefList(doc).entries = []
    expect(() => irToPm(doc)).toThrow(IRToPmError)
    try { irToPm(doc) } catch (error) {
      expect((error as IRToPmError).diagnostics[0]).toMatchObject({ nodeId: 'g1-nrl', reason: expect.stringContaining('至少一个条目') })
    }
  })

  it('pmToIr：清单内的未知子节点、normRefStd 内多余/未知子节点 → unsupportedContent，不静默丢弃', () => {
    const bad = clone(pmDoc)
    walkPm(bad, node => {
      if (node.type === 'normRefList') node.content!.push({ type: 'stdParagraph', attrs: { nodeId: 'g1-stray' }, content: [{ type: 'text', text: '杂项' }] })
      if (node.type === 'normRefStd' && node.attrs?.nodeId === 'g1-nr-1') node.content!.push({ type: 'stdParagraph', attrs: { nodeId: 'g1-stray2' } })
    })
    const { doc, warnings } = pmToIr(bad)
    expect(warnings.length).toBeGreaterThan(0)
    expect(doc.unsupportedContent?.map(item => item.nodeType).sort()).toEqual(['stdParagraph', 'stdParagraph'])
  })

  it('pmToIr：缺少 nodeId 的条目用占位 ID，Resolver 报 missing-id', () => {
    const missing = clone(pmDoc)
    walkPm(missing, node => { if (node.type === 'normRefMixed') delete node.attrs
    })
    const { doc, warnings } = pmToIr(missing)
    expect(warnings.some(warning => warning.includes('normRefMixed'))).toBe(true)
    expect(errors(doc).some(problem => problem.code === 'missing-id')).toBe(true)
  })

  it('extensionVersion：含清单的文档为 1；不含任何 G1 结构的旧文档不写该字段', () => {
    expect(hasSemanticExtensions(createG1IrDoc())).toBe(true)
    const legacy = createG1LegacyIrDoc()
    expect(hasSemanticExtensions(legacy)).toBe(false)
    expect(hasSemanticExtensions(fullFixture())).toBe(false)
    expect(pmToIr(irToPm(legacy)).doc.extensionVersion).toBeUndefined()
    const onlyList = createG1LegacyIrDoc()
    onlyList.body[1]!.children.push(g1NormRefList())
    expect(hasSemanticExtensions(onlyList)).toBe(true)
  })
})

describe('[M-4.4.2.3.2-01] 清单只由 secType 与结构决定，不依赖章标题文本', () => {
  it('章标题不是“规范性引用文件”但 secType=norm-refs：清单合法（导出时恒写 content-type=norm-refs）', () => {
    const doc = createG1IrDoc()
    normRefChapter(doc).title = [{ text: 'Normative references' }]
    expect(errors(doc)).toEqual([])
  })

  it('没有清单的 norm-refs 章（引导语 + 普通段落）保持旧行为：无 error、无新字段', () => {
    const legacy = createG1LegacyIrDoc()
    expect(errors(legacy)).toEqual([])
    expect(pmToIr(irToPm(legacy)).doc).toEqual(legacy)
  })
})

describe('[M-10.2-01] [M-10.2-02] stdRef mark：正文引用标准化文件', () => {
  it('pmToIr：mark 映射为 { type: "stdRef" }，被标记的文本即 std-ref 内容；可与 bold、crossRef 叠加，顺序保持', () => {
    const { doc, warnings } = pmToIr(createG1PmDoc())
    expect(warnings).toEqual([])
    const chapter = doc.body[2]!
    const p1 = chapter.children[0] as { content: IRInline[] }
    expect(p1.content[1]).toEqual({ text: 'GB/T 3102.1', marks: [{ type: 'stdRef' }] })
    const p2 = chapter.children[1] as { content: IRInline[] }
    expect(p2.content[1]).toEqual({ text: 'GB/T 321', marks: [{ type: 'bold' }, { type: 'stdRef' }] })
    expect(p2.content[4]).toEqual({ text: '2', marks: [{ type: 'crossRef', targetId: 'g1-ch2', targetKind: 'chapter' }, { type: 'stdRef' }] })
  })

  it('列项、注内的 stdRef 同样映射', () => {
    const { doc } = pmToIr(createG1PmDoc())
    const list = doc.body[2]!.children[2] as { items: { content: { content: IRInline[] }[] }[] }
    expect(list.items[0]!.content[0]!.content[1]).toEqual({ text: 'GB/T 321', marks: [{ type: 'stdRef' }] })
    const note = doc.body[2]!.children[3] as { content: { content: IRInline[] }[] }
    expect(note.content[0]!.content[1]).toEqual({ text: 'GB/T 3102', marks: [{ type: 'stdRef' }] })
  })

  it('irToPm：输出同名 PM mark，叠加时顺序保持（bold 在前、stdRef 在后）', () => {
    const emitted = irToPm(createG1IrDoc())
    const found: PMJsonNode[] = []
    walkPm(emitted, node => { if (node.type === 'text' && node.marks?.some(mark => mark.type === 'stdRef')) found.push(node) })
    expect(found.map(node => node.text)).toEqual(['GB/T 3102.1', 'GB/T 321', '2', 'GB/T 321', 'GB/T 3102'])
    expect(found[1]!.marks).toEqual([{ type: 'bold' }, { type: 'stdRef' }])
  })

  it('空文本上的 stdRef 没有生产 PM 载体，irToPm 报错而不是丢失标记', () => {
    const doc = createG1IrDoc()
    ;(doc.body[2]!.children[0] as { content: IRInline[] }).content.push({ text: '', marks: [{ type: 'stdRef' }] })
    expect(() => irToPm(doc)).toThrow(IRToPmError)
  })

  it('不带 targetId 等属性：stdRef 是纯文本标记，不参与交叉引用检查（Resolver 不产生 xref）', () => {
    const { problems } = resolve(createG1IrDoc())
    expect(problems.filter(problem => ['dangling-xref', 'dangling-typed-ref'].includes(problem.code))).toEqual([])
  })
})

describe('[M-10.1.7-01] mixedCitation mark：正文引用非标准化文件', () => {
  it('pmToIr / irToPm 往返：mark 映射为 { type: "mixedCitation" }', () => {
    const { doc } = pmToIr(createG1PmDoc())
    expect((doc.body[2]!.children[0] as { content: IRInline[] }).content[3]).toEqual({ text: '《中华人民共和国计量法》', marks: [{ type: 'mixedCitation' }] })
    const emitted = irToPm(doc)
    const found: PMJsonNode[] = []
    walkPm(emitted, node => { if (node.type === 'text' && node.marks?.some(mark => mark.type === 'mixedCitation')) found.push(node) })
    expect(found.map(node => node.text)).toEqual(['《中华人民共和国计量法》'])
  })

  it('同一 run 同时带 stdRef 与 mixedCitation：生产 PM 中两个 mark 互斥，irToPm 报错（不静默删一个）', () => {
    const doc = createG1IrDoc()
    ;(doc.body[2]!.children[0] as { content: IRInline[] }).content.push({ text: '冲突引用', marks: [{ type: 'stdRef' }, { type: 'mixedCitation' }] })
    let thrown: unknown
    try { irToPm(doc) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(IRToPmError)
    expect((thrown as IRToPmError).diagnostics.map(diagnostic => diagnostic.reason)).toEqual([expect.stringContaining('stdRef 与 mixedCitation')])
  })

  it('一个 mark 类型在同一 run 重复：沿用既有的重复标记诊断', () => {
    const doc = createG1IrDoc()
    ;(doc.body[2]!.children[0] as { content: IRInline[] }).content.push({ text: '重复', marks: [{ type: 'stdRef' }, { type: 'stdRef' }] })
    expect(() => irToPm(doc)).toThrow(IRToPmError)
  })

  it('extensionVersion：仅出现这两种 mark 之一的文档也被识别为语义扩展', () => {
    for (const type of ['stdRef', 'mixedCitation'] as const) {
      const doc = createG1LegacyIrDoc()
      ;(doc.body[2]!.children[0] as { content: IRInline[] }).content[0] = { text: '引用', marks: [{ type }] }
      expect(hasSemanticExtensions(doc), type).toBe(true)
      expect(pmToIr(irToPm(doc)).doc.extensionVersion, type).toBe(1)
    }
  })
})

describe('[M-4.5.3-02] 参考文献标题 bibliographyTitle', () => {
  function pmWithTitle(...title: PMJsonNode[]): PMJsonNode {
    const pm = clone(createG1PmDoc())
    walkPm(pm, node => { if (node.type === 'bibliographyTitle') node.content = title })
    return pm
  }
  const text = (value: string, marks?: PMJsonNode['marks']): PMJsonNode => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })

  it('自定义标题：写入 doc.bibliographyTitle，extensionVersion=1；irToPm 输出自定义标题而不是“参考文献”', () => {
    const { doc } = pmToIr(createG1PmDoc())
    expect(doc.bibliographyTitle).toEqual([{ text: '参考书目' }])
    expect(doc.extensionVersion).toBe(1)
    const bibliography = irToPm(doc).content!.find(node => node.type === 'bibliography')!
    expect(bibliography.content![0]).toEqual({ type: 'bibliographyTitle', content: [{ type: 'text', text: '参考书目' }] })
  })

  it('默认标题：单个无格式的“参考文献”不写字段（旧文档与默认标题的 IR 与 extensionVersion 都不变）', () => {
    const { doc } = pmToIr(pmWithTitle(text('参考文献')))
    expect('bibliographyTitle' in doc).toBe(false)
    const legacy = pmToIr(irToPm(createG1LegacyIrDoc())).doc
    expect(legacy.extensionVersion).toBeUndefined()
    expect('bibliographyTitle' in legacy).toBe(false)
    const bibliography = irToPm(legacy).content!.find(node => node.type === 'bibliography')!
    expect(bibliography.content![0]).toEqual({ type: 'bibliographyTitle', content: [{ type: 'text', text: '参考文献' }] })
  })

  it('空标题节点等同默认；与默认只差空白、带格式、拆成多段的标题都算自定义并保留', () => {
    expect('bibliographyTitle' in pmToIr(pmWithTitle()).doc).toBe(false)
    expect(pmToIr(pmWithTitle(text('参考文献 '))).doc.bibliographyTitle).toEqual([{ text: '参考文献 ' }])
    expect(pmToIr(pmWithTitle(text('参考文献', [{ type: 'bold' }]))).doc.bibliographyTitle).toEqual([{ text: '参考文献', marks: [{ type: 'bold' }] }])
    expect(pmToIr(pmWithTitle(text('参考'), text('文献', [{ type: 'italic' }]))).doc.bibliographyTitle).toHaveLength(2)
  })

  it('往返：自定义标题（含格式）PM → IR → PM 不变', () => {
    const pm = pmWithTitle(text('参考', [{ type: 'bold' }]), text('书目'))
    const doc = pmToIr(pm).doc
    expect(irToPm(doc)).toEqual(pm)
  })

  it('Resolver：标题不产生标签；IR 标题内的脚注报 invalid-footnote（标题中不能插入条文脚注）', () => {
    const doc = createG1IrDoc()
    const clean = resolve(doc)
    expect(clean.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(Object.keys(clean.labels).some(id => id.includes('bibliographyTitle'))).toBe(false)

    doc.bibliographyTitle = [{ text: '参考书目', footnote: { id: 'g1-fn-bib-title', content: [{ text: '不允许' }] } }]
    expect(errors(doc).filter(problem => problem.code === 'invalid-footnote')).toEqual([
      expect.objectContaining({ nodeId: 'doc.bibliographyTitle', message: expect.stringContaining('标题') }),
    ])
    // 标题里的脚注只被收集一次（既不漏收，也不被通用扫描重复收集）
    expect(collectFootnotes(doc).filter(footnote => footnote.id === 'g1-fn-bib-title')).toHaveLength(1)
  })

  it('PM 标题含脚注：沿用 unmappedFootnotes 路径报 invalid-footnote，且不写入 doc.bibliographyTitle（输出被阻断，PM 不受影响）', () => {
    const pm = pmWithTitle(text('参考书目'), { type: 'footnoteRef', attrs: { nodeId: 'g1-title-fn', content: [text('非法标题说明')] } })
    const { doc } = pmToIr(pm)
    expect(doc.bibliographyTitle).toBeUndefined()
    expect(doc.unmappedFootnotes?.map(item => [item.container, item.nodeId])).toEqual([['bibliographyTitle', 'g1-title-fn']])
    expect(errors(doc).some(problem => problem.code === 'invalid-footnote' && problem.nodeId === 'g1-title-fn')).toBe(true)
  })

  it('标题只在有参考文献条目时有意义：自定义标题而没有条目 → irToPm 报错', () => {
    const doc = createG1IrDoc()
    doc.bibliography = []
    expect(() => irToPm(doc)).toThrow(IRToPmError)
  })

  it('标题内容不影响文献编号：biblref_<n> 与 [n] 仍按引用顺序', () => {
    const result = resolve(createG1IrDoc())
    expect(result.labels['g1-bib-1']).toMatchObject({ label: '[1]', xmlId: 'biblref_1' })
    expect(result.bibliographyOrder).toEqual(['g1-bib-1', 'g1-bib-2'])
  })
})

describe('[M-4.4.2.3-02] [M-10.2-01] [M-10.1.7-01] 写作片段：模型已支持但本阶段没有写作入口，给出准确提示', () => {
  const chapter = { parent: 'chapter' } as const

  it('kind=normRefList 报 unsupported-kind（而不是笼统的“未知的 kind”），提示模型已支持', () => {
    const result = normalizeAuthoringFragment([{ kind: 'normRefList', entries: [] }], chapter, { generateId: () => 'gen-1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([expect.objectContaining({ code: 'unsupported-kind', path: 'fragment[0].kind' })])
    expect(result.issues[0]!.reason).toContain('规范性引用文件清单')
    expect(result.issues[0]!.reason).toContain('模型已支持')
  })

  it('mark stdRef / mixedCitation 报 unsupported-field（写作入口留后续交互任务），不静默丢弃也不当作未知类型', () => {
    for (const type of ['stdRef', 'mixedCitation']) {
      const result = normalizeAuthoringFragment([{ kind: 'paragraph', content: [{ text: 'GB/T 321', marks: [{ type }] }] }], chapter, { generateId: () => 'gen-2' })
      expect(result.ok, type).toBe(false)
      if (result.ok) continue
      expect(result.issues[0], type).toMatchObject({ code: 'unsupported-field', path: 'fragment[0].content[0].marks[0]' })
      expect(result.issues[0]!.reason).toContain('模型已支持')
    }
  })

  it('片段投影不创建 normRefList：irFragmentToPm 拒绝（FRAGMENT_BLOCK_KINDS 未增加，符合“不做插入”）', () => {
    expect(() => irFragmentToPm([g1NormRefList()], chapter)).toThrow(IRToPmError)
  })
})
