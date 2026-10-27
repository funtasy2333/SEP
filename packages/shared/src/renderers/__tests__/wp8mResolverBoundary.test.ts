/**
 * WP8.M M-Z-a：Resolver 的 `unsupported-content` error 统一阻断非 JSON 出口
 * （docs/wp8.m/design.md §7.1「主导人决定（2026-10-26）」）。
 *
 * 规则：Resolver 产生的 `code === 'unsupported-content' && severity === 'error'` 问题，对 HTML、DOCX、XML、XML46687
 * 四种格式一律报 `unsupported-output`（路径 `resolver.problems[unsupported-content]`，带 nodeId 与 Resolver 原文案）。
 * 其余 error 代码（dangling-xref 等）与 warning 保持既有口径，不阻断。
 *
 * Resolver 中 unsupported-content 的产生点（resolve.ts）：
 *   ① visitInlines：行内图位置非法（M-8.3-02，G3）                         → 本规则新增阻断
 *   ② visitBlock normRefList：清单不在 norm-refs 章（M-4.4.2.3-02，G1）     → 本规则新增阻断
 *   ③ visitBlock normRefList：文档内出现多个清单（M-4.4.2.3-02，G1）       → 本规则新增阻断
 *   ④ visitTermEntry：术语 tailOrder 无效                                 → 边界早已按 `.tailOrder` 路径阻断，这里不重复报
 *   ⑤ 对 doc.unsupportedContent（pmToIr 诊断，含引言悬置段 M-4.3.4-02）的重述 → 边界早已按原路径阻断，这里不重复报
 */

import { describe, expect, it } from 'vitest'
import { pmToIr } from '../../ir/pmToIr'
import { resolve } from '../../ir/resolve'
import type { IRChapter, IRDoc, IRInline, IRNormRefList, IRParagraph } from '../../ir/types'
import { fullFixture } from '../../ir/__tests__/fixtures'
import { createG1IrDoc } from '../../ir/__tests__/wp8mG1Fixtures'
import { g3IrDoc, inlineImage } from '../../ir/__tests__/wp8mG3Fixtures'
import { renderDocx } from '../docx'
import { renderHtml } from '../html'
import { UnsupportedOutputError, getOutputSupportProblems, type OutputBoundaryFormat, type OutputSupportProblem } from '../outputBoundary'

const FORMATS: OutputBoundaryFormat[] = ['HTML', 'DOCX', 'XML', 'XML46687']
const RESOLVER_PATH = 'resolver.problems[unsupported-content]'
const docxOptions = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-26T08:00:00.000Z' }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
const resolverProblems = (doc: IRDoc, format: OutputBoundaryFormat): OutputSupportProblem[] =>
  getOutputSupportProblems(doc, format).filter(problem => problem.path === RESOLVER_PATH)
const resolverErrors = (doc: IRDoc, code: string) => resolve(doc).problems.filter(problem => problem.code === code && problem.severity === 'error')

function normRefChapter(doc: IRDoc): IRChapter { return doc.body.find(chapter => chapter.id === 'g1-ch2')! }
function normRefList(doc: IRDoc): IRNormRefList { return normRefChapter(doc).children.find(child => child.kind === 'normRefList') as IRNormRefList }

describe('[M-4.4.2.3-02] Resolver unsupported-content 阻断非 JSON 出口：清单不在 norm-refs 章', () => {
  const misplaced = (): IRDoc => {
    const doc = createG1IrDoc()
    normRefChapter(doc).secType = 'general'
    return doc
  }

  it('Resolver 本身报 unsupported-content error（前提）；合法位置的同一文档没有该 error，四种格式的该路径也没有问题', () => {
    expect(resolverErrors(misplaced(), 'unsupported-content').map(problem => problem.nodeId)).toEqual(['g1-nrl'])
    expect(resolverErrors(createG1IrDoc(), 'unsupported-content')).toEqual([])
    for (const format of FORMATS) expect(resolverProblems(createG1IrDoc(), format), format).toEqual([])
  })

  it.each(FORMATS)('%s：报一条 unsupported-output，带清单 nodeId、固定路径与 Resolver 原文案', format => {
    const problems = resolverProblems(misplaced(), format)
    const original = resolverErrors(misplaced(), 'unsupported-content')[0]!
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ code: 'unsupported-output', nodeId: 'g1-nrl', path: RESOLVER_PATH })
    expect(problems[0]!.message).toContain(original.message)
    expect(problems[0]!.message.startsWith(format)).toBe(true)
  })

  it('清单位于条、附录、前言中：同样阻断，且每个位置恰好一条', () => {
    const inClause = createG1IrDoc()
    const list = normRefList(inClause)
    normRefChapter(inClause).children = [{ kind: 'clause', id: 'g1-clause', level: 1, titled: true, title: [{ text: '条' }], children: [list] }]
    const inAppendix = createG1IrDoc()
    inAppendix.appendices = [{ kind: 'appendix', id: 'g1-app', normative: false, title: [{ text: '附录' }], children: [normRefList(inAppendix)] }]
    normRefChapter(inAppendix).children = [{ kind: 'paragraph', id: 'g1-ch2-p', content: [{ text: '本文件没有规范性引用文件。' }] }]
    const inForeword = createG1IrDoc()
    inForeword.front.foreword.push(normRefList(inForeword))
    normRefChapter(inForeword).children = [{ kind: 'paragraph', id: 'g1-ch2-p', content: [{ text: '本文件没有规范性引用文件。' }] }]
    for (const [name, doc] of [['条', inClause], ['附录', inAppendix], ['前言', inForeword]] as const) {
      for (const format of FORMATS) expect(resolverProblems(doc, format).map(problem => problem.nodeId), `${name} ${format}`).toEqual(['g1-nrl'])
    }
  })

  it('renderHtml / renderDocx 对该文档抛 UnsupportedOutputError（渲染前的统一入口），不再静默输出', () => {
    const doc = misplaced()
    const { labels } = resolve(doc)
    expect(() => renderHtml(doc, labels, { variant: 'screen' })).toThrow(UnsupportedOutputError)
    expect(() => renderDocx(doc, labels, docxOptions)).toThrow(UnsupportedOutputError)
  })
})

describe('[M-4.4.2.3-02] Resolver unsupported-content 阻断非 JSON 出口：多个清单', () => {
  function withSecondList(): IRDoc {
    const doc = createG1IrDoc()
    const second = clone(normRefList(doc))
    second.id = 'g1-nrl-2'
    second.entries.forEach((entry, index) => { entry.id = `g1-nr2-${index}` })
    ;(second.entries[3] as { content: IRInline[] }).content[1]!.footnote!.id = 'g1-fn-nr2'
    normRefChapter(doc).children.push(second)
    return doc
  }

  it('第二个清单被阻断（nodeId 为第二个清单），第一个清单不受影响；消息提示合并为一个清单', () => {
    const doc = withSecondList()
    expect(resolverErrors(doc, 'unsupported-content').map(problem => problem.nodeId)).toEqual(['g1-nrl-2'])
    for (const format of FORMATS) {
      const problems = resolverProblems(doc, format)
      expect(problems.map(problem => problem.nodeId), format).toEqual(['g1-nrl-2'])
      expect(problems[0]!.message, format).toContain('合并为一个清单')
    }
  })

  it('清单既不在 norm-refs 章又不止一个：两条各自独立（位置一条、数量一条）', () => {
    const doc = withSecondList()
    // 把第二个清单放进非 norm-refs 的章：位置非法 + 数量超限
    normRefChapter(doc).children = normRefChapter(doc).children.filter(child => child.kind !== 'normRefList' || child.id !== 'g1-nrl-2')
    doc.body[2]!.children.push({ ...clone(normRefList(doc)), id: 'g1-nrl-2', entries: clone(normRefList(doc)).entries.map((entry, index) => ({ ...entry, id: `g1-nr2-${index}` })) as IRNormRefList['entries'] })
    ;((doc.body[2]!.children.at(-1) as IRNormRefList).entries[3] as { content: IRInline[] }).content[1]!.footnote!.id = 'g1-fn-nr2'
    for (const format of FORMATS) expect(resolverProblems(doc, format).map(problem => problem.nodeId), format).toEqual(['g1-nrl-2', 'g1-nrl-2'])
  })
})

describe('[M-4.3.4-02] Resolver unsupported-content 阻断非 JSON 出口：引言悬置段', () => {
  const pmDoc = (): Parameters<typeof pmToIr>[0] => ({
    type: 'doc',
    attrs: { extensionVersion: 1 },
    content: [
      {
        type: 'introduction',
        content: [
          { type: 'stdParagraph', attrs: { nodeId: 'lead' }, content: [{ type: 'text', text: '导语' }] },
          { type: 'clause', attrs: { nodeId: 'c1', level: 1 }, content: [
            { type: 'clauseTitle', content: [{ type: 'text', text: '背景' }] },
            { type: 'stdParagraph', attrs: { nodeId: 'c1-p' }, content: [{ type: 'text', text: '条文。' }] },
          ] },
          { type: 'stdParagraph', attrs: { nodeId: 'hanging' }, content: [{ type: 'text', text: '悬置段' }] },
        ],
      },
      { type: 'chapter', attrs: { nodeId: 'ch1' }, content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'ch1-p' }, content: [{ type: 'text', text: '正文。' }] },
      ] },
    ],
  })

  it('pmToIr 把条之后的段落记入 unsupportedContent，Resolver 重述为 unsupported-content error（前提）', () => {
    const { doc } = pmToIr(pmDoc())
    expect(doc.unsupportedContent?.map(item => item.nodeId)).toEqual(['hanging'])
    expect(resolverErrors(doc, 'unsupported-content').map(problem => problem.nodeId)).toEqual(['hanging'])
  })

  it.each(FORMATS)('%s：悬置段只被阻断一次（来自 unsupportedContent 的原路径），Resolver 的重述不再重复报告', format => {
    const { doc } = pmToIr(pmDoc())
    const problems = getOutputSupportProblems(doc, format).filter(problem => problem.nodeId === 'hanging')
    expect(problems).toHaveLength(1)
    expect(problems[0]!.path).toBe('doc.content[0].content[2]')
    expect(resolverProblems(doc, format)).toEqual([])
  })

  it('术语 tailOrder 无效同理：只按 `.tailOrder` 路径报一次，不再多一条 Resolver 重述', () => {
    const doc = clone(pmToIr(fullFixture()).doc)
    const term = {
      kind: 'termEntry' as const, id: 'tail-term', term: [{ text: '术语' }], definition: [{ kind: 'paragraph' as const, id: 'tail-term.def0', content: [{ text: '定义。' }] }],
      notes: [], examples: [], tailOrder: [{ kind: 'note' as const, index: 0 }],
    }
    doc.body = [{ kind: 'chapter', id: 'tail-ch', secType: 'terms', title: [{ text: '术语和定义' }], children: [term] }]
    doc.appendices = []
    expect(resolverErrors(doc, 'unsupported-content').map(problem => problem.nodeId)).toEqual(['tail-term'])
    for (const format of FORMATS) {
      expect(resolverProblems(doc, format), format).toEqual([])
      expect(getOutputSupportProblems(doc, format).filter(problem => problem.path.endsWith('.tailOrder')), format).toHaveLength(1)
    }
  })
})

describe('[M-8.3-02] Resolver unsupported-content 阻断非 JSON 出口：行内图非法位置', () => {
  const inTitle = (): IRDoc => {
    const doc = g3IrDoc()
    doc.body[0]!.title = [inlineImage()]
    return doc
  }

  it('段落内的行内图不产生 Resolver 问题（该路径无条目）；其自身仍由 image 字段阻断（G3 既有口径，不变）', () => {
    const doc = g3IrDoc()
    expect(resolverErrors(doc, 'unsupported-content')).toEqual([])
    for (const format of FORMATS) {
      expect(resolverProblems(doc, format), format).toEqual([])
      expect(getOutputSupportProblems(doc, format).some(problem => problem.path.endsWith('.image')), format).toBe(true)
    }
  })

  it.each(FORMATS)('%s：行内图在章标题里：除 image 字段阻断外，另有一条 Resolver 位置阻断（nodeId 为章，带原文案）', format => {
    const doc = inTitle()
    const original = resolverErrors(doc, 'unsupported-content')
    expect(original.map(problem => problem.nodeId)).toEqual([doc.body[0]!.id])
    const problems = resolverProblems(doc, format)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ code: 'unsupported-output', nodeId: doc.body[0]!.id })
    expect(problems[0]!.message).toContain(original[0]!.message)
  })

  it('图题、脚注、术语条目内的行内图：各自被 Resolver 位置规则阻断', () => {
    const caption = g3IrDoc()
    const figure = caption.body[1]!.children.find(child => child.kind === 'figure')!
    if (figure.kind !== 'figure') throw new Error('夹具应含图')
    figure.caption = [inlineImage()]
    const footnote = g3IrDoc()
    ;(footnote.body[0]!.children[0] as IRParagraph).content.push({ text: '', footnote: { id: 'g3-fn-i', content: [inlineImage()] } })
    const term = g3IrDoc()
    term.body[1]!.children.push({
      kind: 'termEntry', id: 'g3-term', term: [{ text: '术语' }],
      definition: [{ kind: 'paragraph', id: 'g3-term.def0', content: [{ text: '定义', }, inlineImage()] }], notes: [], examples: [],
    })
    for (const [name, doc] of [['图题', caption], ['脚注', footnote], ['术语条目', term]] as const) {
      expect(resolverErrors(doc, 'unsupported-content').length, name).toBeGreaterThan(0)
      for (const format of FORMATS) expect(resolverProblems(doc, format).length, `${name} ${format}`).toBe(resolverErrors(doc, 'unsupported-content').length)
    }
  })
})

describe('Resolver 其他 error / warning 不受影响：仍保持既有导出口径', () => {
  it('dangling-xref（error）：不产生 unsupported-output（HTML/DOCX/XML/XML46687 与此前一致）', () => {
    const doc = createG1IrDoc()
    ;(doc.body[0]!.children[0] as IRParagraph).content.push({ text: '见', marks: [{ type: 'crossRef', targetId: 'no-such-target' }] })
    const problems = resolve(doc).problems
    expect(problems.some(problem => problem.code === 'dangling-xref' && problem.severity === 'error')).toBe(true)
    for (const format of ['HTML', 'DOCX'] as const) {
      expect(getOutputSupportProblems(doc, format), format).toEqual([])
    }
    for (const format of FORMATS) expect(resolverProblems(doc, format), format).toEqual([])
  })

  it('warning（尾部标点 trailing-punctuation）：不阻断', () => {
    const doc = createG1IrDoc()
    const first = normRefList(doc).entries[0]!
    if (first.entryType !== 'std') throw new Error('夹具应为 std 条目')
    first.title = [{ text: '优先数和优先数系；' }]
    expect(resolve(doc).problems.some(problem => problem.code === 'trailing-punctuation' && problem.severity === 'warning')).toBe(true)
    for (const format of ['HTML', 'DOCX'] as const) expect(getOutputSupportProblems(doc, format), format).toEqual([])
  })

  it('既有文档 fixture（fullFixture）与 G1 合法文档：Resolver 没有 unsupported-content error，四种格式不新增任何 Resolver 路径问题', () => {
    const existing = pmToIr(fullFixture()).doc
    expect(resolverErrors(existing, 'unsupported-content')).toEqual([])
    for (const doc of [existing, createG1IrDoc()]) {
      for (const format of FORMATS) expect(resolverProblems(doc, format), format).toEqual([])
    }
  })
})
