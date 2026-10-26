/**
 * WP8.M G3：图——图例 legend、行内图 inline-graphic、图注、图中示例——shared 层（IR、PM 映射、Resolver、扩展判定）。
 * 矩阵行：M-8.5-01～06、M-8.3-02、M-8.2-11、M-8.4-03。
 * 输出边界与排版见 renderers/__tests__/wp8mG3Boundary.test.ts、wp8mG3Render.test.ts；写作层见 wp8mG3Authoring.test.ts。
 */

import { describe, expect, it } from 'vitest'
import { normalizeAuthoringFragment } from '../authoring'
import { hasSemanticExtensions } from '../extensions'
import { remapExternalIds } from '../externalIds'
import { collectFootnotes } from '../footnotes'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import type { IRBlock, IRDoc, IRFigure, IRInline, IRParagraph } from '../types'
import * as fx from './fixtures'
import {
  G3_INLINE_PNG, g3Example, g3Figure, g3Figure1, g3IrDoc, g3Legend, g3Note, g3PmDoc,
  inlineImage, legendItem, para, pmFigure, pmInlineImage, pmLegend, pmLegendItem, pmFigureNote,
} from './wp8mG3Fixtures'

const errors = (doc: IRDoc) => resolve(doc).problems.filter(problem => problem.severity === 'error')

function figures(doc: IRDoc): IRFigure[] {
  const found: IRFigure[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const row = value as Record<string, unknown>
    if (row.kind === 'figure') found.push(row as unknown as IRFigure)
    for (const child of Object.values(row)) visit(child)
  }
  visit(doc.body)
  visit(doc.appendices)
  return found
}

function figureById(doc: IRDoc, id: string): IRFigure {
  const found = figures(doc).find(figure => figure.id === id)
  if (!found) throw new Error(`找不到图 ${id}`)
  return found
}

function findPm(node: PMJsonNode, type: string, nodeId?: string): PMJsonNode {
  let found: PMJsonNode | undefined
  const visit = (current: PMJsonNode): void => {
    if (current.type === type && (nodeId === undefined || current.attrs?.nodeId === nodeId)) found ??= current
    current.content?.forEach(visit)
  }
  visit(node)
  if (!found) throw new Error(`找不到 ${type}${nodeId ? `#${nodeId}` : ''}`)
  return found
}

function allPm(node: PMJsonNode, type: string, out: PMJsonNode[] = []): PMJsonNode[] {
  if (node.type === type) out.push(node)
  node.content?.forEach(child => allPm(child, type, out))
  return out
}

/** 取 IR 中第 index 章的 children。 */
const chapterChildren = (doc: IRDoc, index: number): IRBlock[] => doc.body[index]!.children as IRBlock[]

describe('[M-8.5-01] IR figure.legend：PM ↔ IR 映射', () => {
  it('pmToIr：figureLegend 读成 IRFigure.legend，无警告、无 unsupportedContent，语义扩展版本 1', () => {
    const { doc, warnings } = pmToIr(g3PmDoc())
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect(doc.extensionVersion).toBe(1)
    const legend = figureById(doc, 'g3-fig-1').legend!
    expect(legend.id).toBe('g3-legend-1')
    expect(legend.items.map(item => item.id)).toEqual(['g3-lg-1', 'g3-lg-2', 'g3-lg-3'])
    expect(figureById(doc, 'g3-fig-2').legend).toBeUndefined()
  })

  it('irToPm：legend → PM figureLegend（figureLegendTitle? + whereItem+），容器与项带 nodeId，位于 caption 之后、note 之前', () => {
    const pm = irToPm(g3IrDoc())
    const figure = findPm(pm, 'figure', 'g3-fig-1')
    expect(figure.content!.map(child => child.type)).toEqual(['figureImage', 'figureCaption', 'figureLegend', 'note', 'note', 'example'])
    const legend = findPm(figure, 'figureLegend')
    expect(legend.attrs).toEqual({ nodeId: 'g3-legend-1' })
    expect(legend.content!.map(child => [child.type, child.attrs])).toEqual([
      ['figureLegendTitle', undefined],
      ['whereItem', { nodeId: 'g3-lg-1' }],
      ['whereItem', { nodeId: 'g3-lg-2' }],
      ['whereItem', { nodeId: 'g3-lg-3' }],
    ])
    // 项复用公式“式中”、缩略语的 whereItem / whereTerm / whereDefinition（P8）
    expect(legend.content![1]!.content!.map(child => child.type)).toEqual(['whereTerm', 'whereDefinition'])
  })

  it('IR → PM → IR 两轮 + JSON 往返后 IR 与 PM 都深度相等；PM → IR → PM 也稳定', () => {
    const first = pmToIr(irToPm(g3IrDoc())).doc
    const second = pmToIr(JSON.parse(JSON.stringify(irToPm(first))) as PMJsonNode).doc
    expect(second).toEqual(first)
    expect(irToPm(second)).toEqual(irToPm(first))
    const fromPm = pmToIr(g3PmDoc()).doc
    expect(pmToIr(irToPm(fromPm)).doc).toEqual(fromPm)
  })

  it('生产 PM 文档与手写 IR 文档描述同一份图（图例、图注、图中示例、行内图的 id 与文本一致）', () => {
    const summary = (doc: IRDoc) => figures(doc).map(figure => [
      figure.id,
      figure.legend ? [figure.legend.id, figure.legend.title?.map(run => run.text).join('') ?? null, figure.legend.items.map(item => [item.id, item.term.map(run => run.text).join(''), item.definition.map(run => run.text).join('')])] : null,
      figure.notes.map(note => [note.id, note.content.map(block => block.id)]),
      (figure.examples ?? []).map(example => [example.id, example.content.map(block => block.id)]),
    ])
    expect(summary(pmToIr(g3PmDoc()).doc)).toEqual(summary(g3IrDoc()))
  })

  it('空图例（items 为空）：IR → PM 报带路径与节点 id 的 IRToPmError（生产 Schema 要求 whereItem+）', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-1').legend!.items = []
    let caught: unknown
    try { irToPm(doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    const diagnostics = (caught as IRToPmError).diagnostics
    expect(diagnostics.map(item => item.nodeId)).toEqual(['g3-legend-1'])
    expect(diagnostics[0]!.path).toMatch(/\.legend\.items$/)
  })

  it('figureLegend 内出现非 whereItem 子节点：按未知内容报告，不静默丢弃', () => {
    const pm = g3PmDoc()
    findPm(pm, 'figureLegend', 'g3-legend-1').content!.push({ type: 'stdParagraph', attrs: { nodeId: 'stray' }, content: [{ type: 'text', text: '游离段落' }] })
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent?.some(item => item.nodeType === 'stdParagraph')).toBe(true)
    expect(figureById(doc, 'g3-fig-1').legend!.items).toHaveLength(3)
  })

  it('一个图里出现两个 figureLegend：报 unsupportedContent（IR 只允许一个图例）', () => {
    const pm = g3PmDoc()
    const figure = findPm(pm, 'figure', 'g3-fig-1')
    figure.content!.splice(3, 0, pmLegend('g3-legend-dup', null, pmLegendItem('g3-lg-dup', 'x', 'y')))
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent?.some(item => item.nodeType === 'figureLegend' && /多个figureLegend/.test(item.reason))).toBe(true)
  })

  it('旧文档的图不受影响：fullFixture 转出的 IR 没有 legend / examples 字段，extensionVersion 不变', () => {
    const { doc } = pmToIr(fx.fullFixture())
    const json = JSON.stringify(doc)
    expect(json).not.toContain('"legend"')
    for (const figure of figures(doc)) {
      expect(Object.keys(figure)).not.toContain('legend')
      expect(Object.keys(figure)).not.toContain('examples')
      expect(figure.notes).toEqual([])
    }
    expect(hasSemanticExtensions(doc)).toBe(doc.extensionVersion === 1)
  })
})

describe('[M-8.5-02] 图例标题 title', () => {
  it('有标题：IRLegend.title ↔ figureLegendTitle（无属性，仅行内内容）往返相等', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-1').legend!.title = [{ text: '图例：' }, { text: 'V', marks: [{ type: 'italic' }] }]
    const pm = irToPm(doc)
    const title = findPm(findPm(pm, 'figureLegend', 'g3-legend-1'), 'figureLegendTitle')
    expect(title.attrs).toBeUndefined()
    expect(title.content!.map(child => child.text)).toEqual(['图例：', 'V'])
    expect(figureById(pmToIr(pm).doc, 'g3-fig-1').legend!.title).toEqual([{ text: '图例：' }, { text: 'V', marks: [{ type: 'italic' }] }])
  })

  it('无标题：不输出 figureLegendTitle；往返后仍无 title 字段', () => {
    const pm = irToPm(g3IrDoc())
    const legend = findPm(pm, 'figureLegend', 'g3-legend-a1')
    expect(legend.content!.map(child => child.type)).toEqual(['whereItem'])
    const legendBack = figureById(pmToIr(pm).doc, 'g3-fig-a1').legend!
    expect(Object.keys(legendBack)).not.toContain('title')
  })

  it('空标题节点或空数组标题等价于没有标题（不丢信息：空标题无内容）', () => {
    const pm = g3PmDoc()
    findPm(pm, 'figureLegend', 'g3-legend-a1').content!.unshift({ type: 'figureLegendTitle' })
    const { doc } = pmToIr(pm)
    expect(Object.keys(figureById(doc, 'g3-fig-a1').legend!)).not.toContain('title')
    const ir = g3IrDoc()
    figureById(ir, 'g3-fig-1').legend!.title = []
    expect(findPm(irToPm(ir), 'figureLegend', 'g3-legend-1').content!.map(child => child.type)).not.toContain('figureLegendTitle')
  })

  it('标题里的条文脚注：Resolver 报 invalid-footnote（图中不能插入条文脚注）', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-1').legend!.title = [{ text: '', footnote: { id: 'g3-fn-t', content: [{ text: '脚注' }] } }]
    expect(errors(doc).map(problem => problem.code)).toContain('invalid-footnote')
    expect(errors(doc).find(problem => problem.code === 'invalid-footnote')!.message).toContain('图中不能插入条文脚注')
  })
})

describe('[M-8.5-03][M-8.5-04][M-8.5-05][M-8.5-06] 图例的 def-list / def-item / term / def：复用 IRDefItem 与 whereItem 项节点（P8）', () => {
  it('图例项与公式“式中”项同形 { id, term, definition }，PM 侧共用 whereItem > whereTerm + whereDefinition', () => {
    const pm = irToPm(g3IrDoc())
    const item = findPm(findPm(pm, 'figureLegend', 'g3-legend-1'), 'whereItem', 'g3-lg-2')
    expect(item.content!.map(child => child.type)).toEqual(['whereTerm', 'whereDefinition'])
    expect(item.content![0]!.content![0]!.text).toBe('2')
    const back = figureById(pmToIr(pm).doc, 'g3-fig-1').legend!.items[1]!
    expect(Object.keys(back).sort()).toEqual(['definition', 'id', 'term'])
  })

  it('项内行内内容（下标、加粗、引用图A.1）往返无损；引用保留 targetKind', () => {
    const items = figureById(pmToIr(g3PmDoc()).doc, 'g3-fig-1').legend!.items
    expect(items[1]!.definition).toEqual([
      { text: '控制器，见' },
      { text: '图A.1', marks: [{ type: 'crossRef', targetId: 'g3-fig-a1', targetKind: 'figure' }] },
    ])
    expect(items[2]!.term).toEqual([{ text: 'V' }, { text: 'o', marks: [{ type: 'sub' }] }])
    expect(items[2]!.definition).toEqual([{ text: '输出电压', marks: [{ type: 'bold' }] }])
  })

  it('空术语或空释义的项照常保留（不静默丢弃），往返后仍是空数组', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-1').legend!.items.push(legendItem('g3-lg-empty', '', ''))
    const back = figureById(pmToIr(irToPm(doc)).doc, 'g3-fig-1').legend!.items
    expect(back.map(item => item.id)).toEqual(['g3-lg-1', 'g3-lg-2', 'g3-lg-3', 'g3-lg-empty'])
    expect(back[3]).toEqual({ id: 'g3-lg-empty', term: [], definition: [] })
  })

  it('Resolver：图例项不赋 label / xmlId（C-T-31：不带 id、不可被引用），容器同样没有', () => {
    const { labels, problems } = resolve(g3IrDoc())
    expect(problems.filter(problem => problem.severity === 'error')).toEqual([])
    for (const id of ['g3-legend-1', 'g3-lg-1', 'g3-lg-2', 'g3-lg-3', 'g3-legend-a1', 'g3-lg-a1']) expect(labels[id], id).toBeUndefined()
  })

  it('不可被引用：无类型的 crossRef 指向图例项 → dangling-xref「没有编号」；带 figure 类型 → dangling-typed-ref', () => {
    for (const targetId of ['g3-lg-1', 'g3-legend-1']) {
      const untyped = g3IrDoc()
      chapterChildren(untyped, 0).push(para('g3-ref-p', { text: '见', marks: [{ type: 'crossRef', targetId }] }))
      const problem = errors(untyped).find(item => item.code === 'dangling-xref')
      expect(problem, targetId).toBeDefined()
      expect(problem!.message).toContain('没有编号')

      const typed = g3IrDoc()
      chapterChildren(typed, 0).push(para('g3-ref-p', { text: '见', marks: [{ type: 'crossRef', targetId, targetKind: 'figure' }] }))
      expect(errors(typed).map(item => item.code), targetId).toContain('dangling-typed-ref')
    }
  })

  it('项内的条文脚注沿用「图」的禁止规则 → invalid-footnote', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-1').legend!.items[0]!.definition = [{ text: '', footnote: { id: 'g3-fn-d', content: [{ text: '脚注' }] } }]
    const problem = errors(doc).find(item => item.code === 'invalid-footnote')
    expect(problem?.message).toContain('图中不能插入条文脚注')
    expect(problem?.nodeId).toBe('g3-lg-1')
  })

  it('图例内容被 collectFootnotes 看见（脚注核对不会漏掉图例里的脚注）', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-1').legend!.items[0]!.definition = [{ text: '', footnote: { id: 'g3-fn-d', content: [{ text: '脚注' }] } }]
    expect(collectFootnotes(doc).map(note => note.id)).toContain('g3-fn-d')
  })
})

describe('[M-8.2-11] 图注：IRFigure.notes 由生产 figure 内的 note 子节点保存', () => {
  it('irToPm：notes → figure 内 note 节点（位于 figureLegend 之后、example 之前），nodeId 保留，行内内容为单段', () => {
    const pm = irToPm(g3IrDoc())
    const figure = findPm(pm, 'figure', 'g3-fig-1')
    const notes = figure.content!.filter(child => child.type === 'note')
    expect(notes.map(note => [note.attrs, note.content!.map(run => run.text)])).toEqual([
      [{ nodeId: 'g3-fig1-n1' }, ['图注一。']],
      [{ nodeId: 'g3-fig1-n2' }, ['图注二。']],
    ])
  })

  it('pmToIr：note 子节点 → IRFigure.notes，段落 id 派生为 `${id}.p0`；往返稳定', () => {
    const { doc } = pmToIr(g3PmDoc())
    expect(figureById(doc, 'g3-fig-1').notes).toEqual(g3Figure1().notes)
    expect(pmToIr(irToPm(doc)).doc).toEqual(doc)
  })

  it('标签作用域 = 本图：图1 的两条注为 注1：/注2：，图2 的唯一注为 注：，章内的注为 注：，互不影响；xmlId 按文档序 note_<n>', () => {
    const { labels } = resolve(g3IrDoc())
    expect(['g3-fig1-n1', 'g3-fig1-n2', 'g3-fig2-n1', 'g3-note', 'g3-figa1-n1'].map(id => [labels[id]!.label, labels[id]!.xmlId])).toEqual([
      ['注1：', 'note_1'], ['注2：', 'note_2'], ['注：', 'note_3'], ['注：', 'note_4'], ['注：', 'note_5'],
    ])
    expect(labels['g3-fig1-n1']!.refText).toBe('注1')
  })

  it('图注先于图编号遍历（沿用既有顺序）：图内注的作用域是图，不是外层章', () => {
    const doc = g3IrDoc()
    // 把图 2 的注挪到章里：章内 g3-note 与它们共用章作用域，应变成 注1：/注2：
    const fig2 = figureById(doc, 'g3-fig-2')
    const moved = fig2.notes.splice(0)
    chapterChildren(doc, 1).push(...moved)
    const { labels } = resolve(doc)
    expect(labels['g3-note']!.label).toBe('注1：')
    expect(labels['g3-fig2-n1']!.label).toBe('注2：')
  })

  it('图注里多块内容：IR → PM 报「只支持单段落」的 IRToPmError（图中的注沿用术语/表注的单段规则）', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-2').notes = [{ kind: 'note', id: 'g3-fig2-n1', content: [para('g3-fig2-n1.p0', { text: '一' }), para('g3-fig2-n1.p1', { text: '二' })] }]
    let caught: unknown
    try { irToPm(doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    const [diagnostic] = (caught as IRToPmError).diagnostics
    expect(diagnostic!.path).toMatch(/\.notes\.g3-fig2-n1$/)
    expect(diagnostic!.reason).toContain('只支持单段落')
  })

  it('图注段落 id 不是派生值：IR → PM 报错而不是静默改写 id', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-2').notes = [{ kind: 'note', id: 'g3-fig2-n1', content: [para('wrong-id', { text: '一' })] }]
    let caught: unknown
    try { irToPm(doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    expect((caught as IRToPmError).diagnostics[0]!.reason).toContain('g3-fig2-n1.p0')
  })

  it('图中的注内可放行内图；注内条文脚注沿用「图」的禁止规则', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-2').notes = [g3Note('g3-fig2-n1', { text: '注：' }, inlineImage())]
    expect(errors(doc)).toEqual([])
    figureById(doc, 'g3-fig-2').notes = [g3Note('g3-fig2-n1', { text: '', footnote: { id: 'g3-fn-n', content: [{ text: '脚注' }] } })]
    expect(errors(doc).map(problem => problem.code)).toContain('invalid-footnote')
  })
})

describe('[M-8.4-03] 图中示例：IRFigure.examples', () => {
  it('irToPm：examples → figure 内 example 节点，位于 note 之后；nodeId 保留', () => {
    const figure = findPm(irToPm(g3IrDoc()), 'figure', 'g3-fig-1')
    const examples = figure.content!.filter(child => child.type === 'example')
    expect(examples.map(example => [example.attrs, example.content!.map(run => run.text)])).toEqual([[{ nodeId: 'g3-fig1-e1' }, ['图中示例。']]])
    expect(figure.content!.map(child => child.type).slice(-3)).toEqual(['note', 'note', 'example'])
  })

  it('pmToIr：example 子节点 → IRFigure.examples（无示例的图不产生该字段）；往返稳定', () => {
    const { doc } = pmToIr(g3PmDoc())
    expect(figureById(doc, 'g3-fig-1').examples).toEqual(g3Figure1().examples)
    expect(Object.keys(figureById(doc, 'g3-fig-a1'))).not.toContain('examples')
    expect(pmToIr(irToPm(doc)).doc).toEqual(doc)
  })

  it('标签作用域 = 本图：图1 一个示例 示例：，图2 一个示例 示例：；多个示例时 示例1：/示例2：；xmlId 按文档序 example_<n>', () => {
    const { labels } = resolve(g3IrDoc())
    expect(['g3-fig1-e1', 'g3-fig2-e1'].map(id => [labels[id]!.label, labels[id]!.xmlId])).toEqual([['示例：', 'example_1'], ['示例：', 'example_2']])

    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-1').examples!.push(g3Example('g3-fig1-e2', { text: '第二个示例。' }))
    const two = resolve(doc).labels
    expect(['g3-fig1-e1', 'g3-fig1-e2', 'g3-fig2-e1'].map(id => two[id]!.label)).toEqual(['示例1：', '示例2：', '示例：'])
  })

  it('图内的注与示例各自独立计数（注数不影响示例标签）', () => {
    const { labels } = resolve(g3IrDoc())
    expect(labels['g3-fig1-n2']!.label).toBe('注2：')
    expect(labels['g3-fig1-e1']!.label).toBe('示例：')
  })

  it('图中示例里多块内容 / 非派生段落 id：IR → PM 报错（顺序固定在注之后，不保存交错顺序，D-M-09）', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-2').examples = [{ kind: 'example', id: 'g3-fig2-e1', content: [para('g3-fig2-e1.p0', { text: '一' }), para('g3-fig2-e1.p1', { text: '二' })] }]
    expect(() => irToPm(doc)).toThrow(IRToPmError)
  })

  it('示例里的条文脚注沿用「图」的禁止规则 → invalid-footnote', () => {
    const doc = g3IrDoc()
    figureById(doc, 'g3-fig-2').examples = [g3Example('g3-fig2-e1', { text: '', footnote: { id: 'g3-fn-e', content: [{ text: '脚注' }] } })]
    expect(errors(doc).map(problem => problem.code)).toContain('invalid-footnote')
    expect(collectFootnotes(doc).map(note => note.id)).toContain('g3-fn-e')
  })
})

describe('[M-8.3-02] 行内图 IRInline.image：PM inlineImage ↔ IR', () => {
  const paragraphOf = (doc: IRDoc, id: string): IRParagraph => {
    let found: IRParagraph | undefined
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return }
      if (!value || typeof value !== 'object') return
      const row = value as Record<string, unknown>
      if (row.kind === 'paragraph' && row.id === id) found = row as unknown as IRParagraph
      for (const child of Object.values(row)) visit(child)
    }
    visit(doc.body)
    if (!found) throw new Error(`找不到段落 ${id}`)
    return found
  }

  it('pmToIr：inlineImage → { text: "", image }；空 alt / 空 resourceId / 空 size 不进入 IR，无警告', () => {
    const { doc, warnings } = pmToIr(g3PmDoc())
    expect(warnings).toEqual([])
    expect(paragraphOf(doc, 'g3-ch-p').content).toEqual([
      { text: '资源图：' },
      { text: '', image: { src: G3_INLINE_PNG, resourceId: 'g3-res-1', alt: '图标', size: 'S' } },
      { text: '，无尺寸图：' },
      { text: '', image: { src: G3_INLINE_PNG } },
    ])
  })

  it('irToPm：image → PM inlineImage 原子（src、resourceId、alt、size 四个属性，无 nodeId）', () => {
    const pm = irToPm(g3IrDoc())
    const images = allPm(pm, 'inlineImage')
    expect(images.length).toBe(6) // 范围章 1 + 资源图段 2 + 列项 1 + 注 1 + 单元格 1
    expect(images[0]!.attrs).toEqual({ src: G3_INLINE_PNG, resourceId: null, alt: '箭头', size: 'M' })
    expect(images[1]!.attrs).toEqual({ src: G3_INLINE_PNG, resourceId: 'g3-res-1', alt: '图标', size: 'S' })
    expect(images[2]!.attrs).toEqual({ src: G3_INLINE_PNG, resourceId: null, alt: '', size: null })
    for (const image of images) expect(image.content).toBeUndefined()
  })

  it('往返：段落、列项、注、单元格里的行内图 IR ↔ PM 两轮后深度相等', () => {
    const first = pmToIr(irToPm(g3IrDoc())).doc
    const second = pmToIr(JSON.parse(JSON.stringify(irToPm(first))) as PMJsonNode).doc
    expect(second).toEqual(first)
    expect(JSON.stringify(first)).toContain('"image"')
    // 行内图的 resourceId 指向文档级资源：资源经 figureResource 顶层节点往返，不随行内图丢失
    expect(first.resources).toEqual(g3IrDoc().resources)
  })

  it('文字与图相邻时保持相邻 run，不合并也不丢失；首尾的图不会被 trim 当作空 run 丢弃', () => {
    const pm = g3PmDoc()
    findPm(pm, 'stdParagraph', 'g3-ch-p').content = [pmInlineImage({ size: 'L' })]
    const { doc } = pmToIr(pm)
    expect(paragraphOf(doc, 'g3-ch-p').content).toEqual([{ text: '', image: { src: G3_INLINE_PNG, size: 'L' } }])
  })

  it('PM 的 inlineImage 带行内格式标记：报 unsupportedContent（IR 无处保存），图本身仍保留', () => {
    const pm = g3PmDoc()
    const paragraph = findPm(pm, 'stdParagraph', 'g3-ch-p')
    paragraph.content![1] = { ...pmInlineImage({ size: 'S' }), marks: [{ type: 'bold' }] }
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent?.some(item => item.nodeType === 'inlineImage' && /行内格式标记/.test(item.reason))).toBe(true)
    expect(paragraphOf(doc, 'g3-ch-p').content[1]!.image).toBeDefined()
    expect(paragraphOf(doc, 'g3-ch-p').content[1]!.marks).toBeUndefined()
  })

  it('PM 的 inlineImage 尺寸档位无效（如 T、XL）：报 unsupportedContent，不静默改成别的档位', () => {
    for (const size of ['T', 'XL', 3]) {
      const pm = g3PmDoc()
      findPm(pm, 'stdParagraph', 'g3-ch-p').content![1] = pmInlineImage({ size })
      const { doc } = pmToIr(pm)
      expect(doc.unsupportedContent?.some(item => item.nodeType === 'inlineImage' && /尺寸档位/.test(item.reason)), String(size)).toBe(true)
      expect(Object.keys(paragraphOf(doc, 'g3-ch-p').content[1]!.image!)).not.toContain('size')
    }
  })

  it('IR 的 image run 带文字 / marks / style / 公式 / 脚注：IR → PM 报 IRToPmError，路径指向该 run', () => {
    const cases: [string, IRInline][] = [
      ['文字', { text: '多余', image: { src: G3_INLINE_PNG } }],
      ['marks', { text: '', marks: [{ type: 'bold' }], image: { src: G3_INLINE_PNG } }],
      ['style', { text: '', style: { color: '#f00' }, image: { src: G3_INLINE_PNG } }],
      ['公式', { text: '', formula: { id: 'g3-f', latex: 'x' }, image: { src: G3_INLINE_PNG } }],
      ['脚注', { text: '', footnote: { id: 'g3-fn', content: [{ text: 'n' }] }, image: { src: G3_INLINE_PNG } }],
    ]
    for (const [name, run] of cases) {
      const doc = g3IrDoc()
      ;(chapterChildren(doc, 0)[0] as IRParagraph).content = [run]
      let caught: unknown
      try { irToPm(doc) } catch (error) { caught = error }
      expect(caught, name).toBeInstanceOf(IRToPmError)
      expect((caught as IRToPmError).diagnostics.some(item => item.path.includes('content[0]') && item.reason.includes('行内图')), name).toBe(true)
    }
  })

  it('image run 上的 crossRef 标记也会被拒绝（无生产载体），不会随图丢失', () => {
    const doc = g3IrDoc()
    ;(chapterChildren(doc, 0)[0] as IRParagraph).content = [{ text: '', marks: [{ type: 'crossRef', targetId: 'g3-fig-1' }], image: { src: G3_INLINE_PNG } }]
    expect(() => irToPm(doc)).toThrow(IRToPmError)
  })

  it('脚注内容里放 inlineImage：footnotePayload 白名单判为不支持（IR → PM 报错）', () => {
    const doc = g3IrDoc()
    ;(chapterChildren(doc, 0)[0] as IRParagraph).content = [{ text: '', footnote: { id: 'g3-fn', content: [inlineImage()] } }]
    let caught: unknown
    try { irToPm(doc) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(IRToPmError)
    expect((caught as IRToPmError).diagnostics.some(item => /脚注内容无法完整保存/.test(item.reason))).toBe(true)
  })

  it('元数据存储的行内内容里出现 image：报 unsupportedContent（不静默丢弃）', () => {
    const pm = g3PmDoc()
    pm.attrs = { ...pm.attrs, titleParts: [{ id: 'tp', content: [{ text: 't', image: { src: G3_INLINE_PNG } }] }] }
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent?.some(item => item.nodeType === 'metadataInline' && /行内图/.test(item.reason))).toBe(true)
  })
})

describe('[M-8.3-02] 行内图的位置规则（Resolver）：只允许在段落内，且不在术语条目或脚注内', () => {
  const imageErrors = (doc: IRDoc) => errors(doc).filter(problem => problem.code === 'unsupported-content' && /行内图/.test(problem.message))

  it('允许：范围章段落、章内段落、列项内段落、注内段落、表格单元格内段落、附录段落——无任何 error', () => {
    expect(imageErrors(g3IrDoc())).toEqual([])
    expect(errors(g3IrDoc())).toEqual([])
    const appendix = g3IrDoc()
    ;(appendix.appendices[0]!.children[0] as IRParagraph).content.push(inlineImage())
    expect(errors(appendix)).toEqual([])
  })

  it('禁止：章标题、条标题、图题、图例标题 / 项、表题、术语名、术语定义、脚注、参考文献、索引——各报 unsupported-content', () => {
    const cases: [string, (doc: IRDoc) => void][] = [
      ['章标题', doc => { doc.body[0]!.title = [inlineImage()] }],
      ['图题', doc => { figureById(doc, 'g3-fig-1').caption = [inlineImage()] }],
      ['图例标题', doc => { figureById(doc, 'g3-fig-1').legend!.title = [inlineImage()] }],
      ['图例项术语', doc => { figureById(doc, 'g3-fig-1').legend!.items[0]!.term = [inlineImage()] }],
      ['图例项释义', doc => { figureById(doc, 'g3-fig-1').legend!.items[0]!.definition = [inlineImage()] }],
      ['表题', doc => { (chapterChildren(doc, 1).find(block => block.kind === 'table') as { caption: IRInline[] }).caption = [inlineImage()] }],
      ['脚注内容', doc => { (chapterChildren(doc, 0)[0] as IRParagraph).content.push({ text: '', footnote: { id: 'g3-fn-i', content: [inlineImage()] } }) }],
      ['参考文献', doc => { doc.bibliography = [{ kind: 'bibEntry', id: 'g3-bib', content: [inlineImage()] }] }],
    ]
    for (const [name, mutate] of cases) {
      const doc = g3IrDoc()
      mutate(doc)
      expect(imageErrors(doc).length, name).toBeGreaterThan(0)
    }
  })

  it('术语条目：术语名与定义段落里的行内图都不允许（inTerm）', () => {
    const doc = g3IrDoc()
    doc.body[1]!.children.push({
      kind: 'termEntry', id: 'g3-term', term: [t('术语')], definition: [para('g3-term.def0', t('定义'), inlineImage())], notes: [], examples: [],
    })
    expect(imageErrors(doc).map(problem => problem.nodeId)).toEqual(['g3-term.def0'])
    const named = g3IrDoc()
    named.body[1]!.children.push({
      kind: 'termEntry', id: 'g3-term', term: [inlineImage()], definition: [para('g3-term.def0', t('定义'))], notes: [], examples: [],
    })
    expect(imageErrors(named).map(problem => problem.nodeId)).toEqual(['g3-term'])
  })

  it('消息指向位置：脚注 / 术语条目 / 非段落各有明确原因', () => {
    const footnote = g3IrDoc()
    ;(chapterChildren(footnote, 0)[0] as IRParagraph).content.push({ text: '', footnote: { id: 'g3-fn-i', content: [inlineImage()] } })
    expect(imageErrors(footnote)[0]!.message).toContain('脚注')
    const title = g3IrDoc()
    title.body[0]!.title = [inlineImage()]
    expect(imageErrors(title)[0]!.message).toContain('标题、图表题')
  })

  it('dangling-resource：image.resourceId 指向不存在的资源 → 报错；存在则无问题', () => {
    const doc = g3IrDoc()
    expect(errors(doc).filter(problem => problem.code === 'dangling-resource')).toEqual([])
    doc.resources = []
    const problems = errors(doc).filter(problem => problem.code === 'dangling-resource')
    expect(problems.map(problem => problem.nodeId)).toEqual(['g3-ch-p'])
    expect(problems[0]!.message).toContain('image.resourceId')
  })

  it('外部 ID 重映射自动覆盖 image.resourceId（复用 resourceId 键，externalIds 无需修改，P8）', () => {
    const { doc, idMap, problems } = remapExternalIds(g3IrDoc(), 'ns')
    expect(problems).toEqual([])
    const mapped = idMap['g3-res-1']!
    expect(mapped).not.toBe('g3-res-1')
    expect(doc.resources![0]!.id).toBe(mapped)
    const run = (chapterChildren(doc, 1)[0] as IRParagraph).content[1]!
    expect(run.image!.resourceId).toBe(mapped)
    const dangling = remapExternalIds({ ...g3IrDoc(), resources: [] }, 'ns')
    expect(dangling.problems.some(problem => problem.code === 'dangling-resource')).toBe(true)
  })
})

const t = (text: string): IRInline => ({ text })

describe('hasSemanticExtensions：G3 新结构触发扩展版本，旧文档不被误标', () => {
  const plainFigureDoc = (figure: IRFigure): IRDoc => ({
    schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
    body: [{ kind: 'chapter', id: 'c', secType: 'general', title: [t('章')], children: [figure] }], appendices: [], bibliography: [],
  })

  it('[M-8.5-01] 图例 → 是；[M-8.2-11] 图注 → 是；[M-8.4-03] 图中示例 → 是；[M-8.3-02] 行内图 → 是', () => {
    expect(hasSemanticExtensions(plainFigureDoc(g3Figure('f', 'x', { legend: g3Legend('l', null, legendItem('i', 'a', 'b')) })))).toBe(true)
    expect(hasSemanticExtensions(plainFigureDoc(g3Figure('f', 'x', { notes: [g3Note('n', t('注'))] })))).toBe(true)
    expect(hasSemanticExtensions(plainFigureDoc(g3Figure('f', 'x', { examples: [g3Example('e', t('例'))] })))).toBe(true)
    const withImage = plainFigureDoc(g3Figure('f', 'x'))
    ;(withImage.body[0] as { children: unknown[] }).children.push(para('p', inlineImage()))
    expect(hasSemanticExtensions(withImage)).toBe(true)
  })

  it('旧图（只有图题 / 图片 / 空 notes）→ 否；空图例项数组、空 examples 数组不触发', () => {
    expect(hasSemanticExtensions(plainFigureDoc(g3Figure('f', 'x')))).toBe(false)
    expect(hasSemanticExtensions(plainFigureDoc(g3Figure('f', 'x', { examples: [] })))).toBe(false)
  })

  it('IRTermEntry.examples 是旧的必有字段：非空示例本身不触发（只有图上的 examples 才是 G3 扩展）', () => {
    const doc: IRDoc = {
      schemaVersion: 1, meta: { standardType: 'gb' }, front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'c', secType: 'terms', title: [t('术语')], children: [{
        kind: 'termEntry', id: 'te', term: [t('术语')], definition: [para('te.def0', t('定义'))], notes: [],
        examples: [{ kind: 'example', id: 'te.e1', content: [para('te.e1.p0', t('例'))] }],
      }] }], appendices: [], bibliography: [],
    }
    expect(hasSemanticExtensions(doc)).toBe(false)
  })

  it('irToPm 在含 G3 结构时写根属性 extensionVersion=1；不含时不写（旧文档 JSON 不变）', () => {
    expect(irToPm(g3IrDoc()).attrs).toEqual({ extensionVersion: 1 })
    expect(irToPm(plainFigureDoc(g3Figure('f', 'x'))).attrs).toBeUndefined()
  })

  it('旧 PM 图（fullFixture）→ IR 不带 extensionVersion；加一条图注后才带', () => {
    expect(pmToIr(fx.fullFixture()).doc.extensionVersion === 1).toBe(hasSemanticExtensions(pmToIr(fx.fullFixture()).doc))
    const pm: PMJsonNode = { type: 'doc', content: [fx.chapter('c', '章', pmFigure('fig', '图'))] }
    expect(pmToIr(pm).doc.extensionVersion).toBeUndefined()
    const withNote: PMJsonNode = { type: 'doc', content: [fx.chapter('c', '章', pmFigure('fig', '图', pmFigureNote('fn', fx.text('注'))))] }
    expect(pmToIr(withNote).doc.extensionVersion).toBe(1)
  })
})

describe('写作层（normalizeAuthoringFragment）：G3 结构本阶段不放开写作入口，给出专门提示而不是笼统的「未知字段」', () => {
  const normalize = (input: unknown) => normalizeAuthoringFragment(input, { parent: 'chapter' }, { generateId: (() => { let n = 0; return () => `a${++n}` })() })
  const issuesOf = (input: unknown) => {
    const result = normalize(input)
    if (result.ok) throw new Error('应当失败')
    return result.issues
  }
  const figureInput = { kind: 'figure', caption: '图', src: G3_INLINE_PNG }

  it('[M-8.5-01] 图例 legend：unsupported-field（IR 有、写作片段暂不支持），不是 unknown-field', () => {
    const issue = issuesOf([{ ...figureInput, legend: { items: [] } }]).find(item => item.path === 'fragment[0].legend')
    expect(issue?.code).toBe('unsupported-field')
  })

  it('[M-8.4-03] 图中示例 examples：unsupported-field', () => {
    const issue = issuesOf([{ ...figureInput, examples: [] }]).find(item => item.path === 'fragment[0].examples')
    expect(issue?.code).toBe('unsupported-field')
  })

  it('[M-8.2-11] 图注 notes 非空：仍拒绝（行为不变），提示改为「模型已支持，写作入口留后续交互任务」', () => {
    const issue = issuesOf([{ ...figureInput, notes: ['图中注'] }]).find(item => item.path === 'fragment[0].notes')
    expect(issue?.code).toBe('unsupported-field')
    expect(issue?.reason).toContain('模型已支持')
    expect(issue?.reason).not.toContain('没有保存图中注的节点')
  })

  it('[M-8.3-02] 行内图 image：unsupported-field，路径指向该行内片段', () => {
    const issue = issuesOf([{ kind: 'paragraph', content: [{ text: '', image: { src: G3_INLINE_PNG } }] }]).find(item => item.path.endsWith('.image'))
    expect(issue?.code).toBe('unsupported-field')
  })
})
