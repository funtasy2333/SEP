import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import { collectFootnotes } from '../footnotes'
import type { IRFigure, IRFormula, IRInline, IRTable } from '../types'
import { renderHtml } from '../../renderers/html'
import { renderDocx } from '../../renderers/docx'
import * as fx from './fixtures'

const fn = (id: string, value = '脚注说明'): PMJsonNode => ({ type: 'footnoteRef', attrs: { nodeId: id, content: [fx.text(value, [{ type: 'bold' }])] } })
const ref = (id: string): PMJsonNode => ({ type: 'tableFootnoteRef', attrs: { targetId: id } })
function table(id: string, refs: string[], definitions = refs, legacy = false): PMJsonNode {
  const cell = fx.tableCell('tableHeader', '尺寸')
  cell.content![0]!.content!.push(...refs.map(ref))
  const node = fx.stdTable(id, '尺寸表', [fx.tableRow(cell)], legacy ? { footnote: '旧表注' } : {})
  node.content!.push({ type: 'tableNoteRow', content: [fx.note(`${id}-note1`, '注的第一条'), fx.note(`${id}-note2`, '注的第二条')] },
    { type: 'tableFootnoteRow', content: definitions.map(key => ({ type: 'tableFootnoteEntry', attrs: { nodeId: key }, content: [fx.text(`${key}的说明`)] })) })
  return node
}
const docOf = (...blocks: PMJsonNode[]) => pmToIr(fx.standardDoc({}, fx.chapter('chapter', '技术要求', ...blocks))).doc

describe('脚注 IR 关联与 GB/T 1.1 编号', () => {
  it('前言、引言、正文及附录连续编号，移动/删除后不持久化死编号，保留 marks', () => {
    const pm = fx.standardDoc({},
      { type: 'foreword', attrs: { nodeId: 'front' }, content: [fx.para('p0', fx.text('前言'), fn('f0'))] },
      { type: 'introduction', attrs: { nodeId: 'intro' }, content: [fx.para('p1', fn('f1'))] },
      fx.chapter('chapter', '技术要求', fx.para('p2', fx.text('正文'), fn('f2'))),
      fx.appendix('appendix', false, '说明', fx.para('p3', fn('f3'))))
    const result = pmToIr(pm)
    expect(result.warnings).toEqual([])
    const before = JSON.stringify(result.doc)
    const resolved = resolve(result.doc)
    expect(['f0', 'f1', 'f2', 'f3'].map(id => resolved.labels[id]?.label)).toEqual(['1)', '2)', '3)', '4)'])
    expect(collectFootnotes(result.doc).map(note => note.id)).toEqual(['f0', 'f1', 'f2', 'f3'])
    expect(collectFootnotes(result.doc)[0]!.content[0]!.marks).toEqual([{ type: 'bold' }])
    expect(JSON.stringify(result.doc)).toBe(before)
    result.doc.front.foreword = []
    expect(resolve(result.doc).labels.f1?.label).toBe('1)')
    expect(resolve(result.doc)).toEqual(resolve(JSON.parse(JSON.stringify(result.doc))))
  })

  it('表注与表脚注分开，旧 tableFootnote 仍是表注；按首次引用而非定义存储顺序编号', () => {
    const doc = docOf(table('t1', ['b', 'a', 'b'], ['a', 'b'], true), table('t2', ['c']))
    const t = doc.body[0]!.children[0] as IRTable
    expect(t.notes).toHaveLength(3)
    expect(t.notes[0]!.content[0]).toMatchObject({ kind: 'paragraph', content: [{ text: '旧表注' }] })
    expect(t.footnotes?.map(note => note.id)).toEqual(['a', 'b'])
    const { labels, problems } = resolve(doc)
    expect(labels.b?.label).toBe('a')
    expect(labels.a?.label).toBe('b')
    expect(labels.c?.label).toBe('a')
    expect(labels['t1-note1']?.label).toBe('注2：')
    expect(problems.filter(problem => problem.code.includes('footnote'))).toEqual([])
    expect(collectFootnotes(doc)).toEqual([])
  })

  it('跨表引用不能被另一张表中同名目标意外接收，缺失目标和无上标定义明确报错', () => {
    const doc = docOf(table('one', ['outside'], ['unused']), table('two', ['outside']))
    const problems = resolve(doc).problems
    expect(problems.filter(problem => problem.code === 'dangling-footnote')).toHaveLength(1)
    expect(problems.filter(problem => problem.code === 'unreferenced-footnote')).toHaveLength(1)
    expect(resolve(docOf(fx.para('p', ref('outside')))).problems.some(p => p.code === 'dangling-footnote')).toBe(true)
  })

  it('插入、重排或删除引用后基于稳定 ID 重派表脚注上标，附录表也从 a 开始', () => {
    const pm = table('table', ['one', 'two'])
    const first = resolve(docOf(pm))
    expect(first.labels.one?.label).toBe('a')
    const changed = structuredClone(pm)
    changed.content!.find(node => node.type === 'table')!.content![0]!.content![0]!.content![0]!.content = [ref('two'), ref('one')]
    expect(resolve(docOf(changed)).labels.two?.label).toBe('a')
    const app = pmToIr(fx.standardDoc({}, fx.appendix('app', false, '附录', pm))).doc
    expect(resolve(app).labels.one?.label).toBe('a')
  })

  it('超过26条的表脚注继续使用小写字母，数字脚注与表注计数互不影响', () => {
    const ids = Array.from({ length: 27 }, (_, i) => `entry-${i}`)
    const { labels } = resolve(docOf(fx.para('paragraph', fn('body-fn')), table('table', ids)))
    expect(labels['entry-25']?.label).toBe('z')
    expect(labels['entry-26']?.label).toBe('aa')
    expect(labels['body-fn']?.label).toBe('1)')
    expect(labels['table-note1']?.label).toBe('注1：')
  })

  it('术语定义/注中的条文脚注、嵌套脚注和空脚注保留数据并报告不合法', () => {
    const term = fx.termDef('term', '术语', { extra: [fx.para('term-p', fn('term-fn'))] })
    const nested = fn('outer'); nested.attrs!.content = [fx.text('外层'), fn('inner')]
    const blank = fn('blank', '  ')
    const doc = docOf(term, fx.para('p', nested, blank))
    expect(resolve(doc).problems.filter(p => p.code === 'invalid-footnote')).toHaveLength(3)
    expect(collectFootnotes(doc).map(f => f.id)).toEqual(['term-fn', 'outer', 'blank'])
  })

  it('表脚注定义 ID 重复会报错，而同一脚注的多次引用不会报 duplicate-id', () => {
    expect(resolve(docOf(table('t', ['a', 'a']))).problems.some(p => p.code === 'duplicate-id')).toBe(true)
    expect(resolve(docOf(table('t', ['a', 'a']))).problems.some(p => p.code === 'invalid-footnote')).toBe(true)
    expect(resolve(docOf(table('t', ['a', 'a'], ['a']))).problems.some(p => p.code === 'duplicate-id')).toBe(false)
  })

  it('按最终参考文献顺序连续编号，重复条文脚注 ID 阻止错误导出', () => {
    const bib = fx.bibliography(['first', '文献甲'], ['second', '文献乙'])
    bib.content![1]!.content!.push(fn('bib-first'))
    bib.content![2]!.content!.push(fn('bib-second'))
    const doc = pmToIr(fx.standardDoc({}, fx.chapter('chapter', '正文', fx.para('paragraph', fx.xref('乙', 'second'))), bib)).doc
    const resolved = resolve(doc)
    expect(resolved.labels['bib-second']?.label).toBe('1)')
    expect(resolved.labels['bib-first']?.label).toBe('2)')
    expect(collectFootnotes(doc, resolved.bibliographyOrder).map(note => note.id)).toEqual(['bib-second', 'bib-first'])
    expect(resolve(docOf(fx.para('p', fn('same'), fn('same')))).problems.some(p => p.code === 'invalid-footnote')).toBe(true)
  })
})


describe('导入/粘贴的条文脚注位置校验', () => {
  it.each(['chapter-title', 'clause-title', 'appendix-title', 'figure-caption', 'figure-caption-en', 'figure-note', 'figure-note-list', 'formula-term', 'formula-definition'])(
    '%s 中的脚注保留数据但阻断 HTML/DOCX 渲染', (location) => {
      const doc = docOf(fx.para('body', fx.text('合法正文'), fn('valid-fn')))
      const inline: IRInline = { text: '', footnote: { id: 'forbidden-fn', content: [{ text: '应当保留的导入说明' }] } }
      const chapter = doc.body[0]!
      if (location === 'chapter-title') chapter.title.push(inline)
      else if (location === 'clause-title') chapter.children.push({ kind: 'clause', id: 'clause', level: 1, titled: true, title: [inline], children: [] })
      else if (location === 'appendix-title') doc.appendices.push({ kind: 'appendix', id: 'app', normative: false, title: [inline], children: [] })
      else if (location.startsWith('figure')) {
        const figure: IRFigure = { kind: 'figure', id: 'fig', src: '', orientation: 'portrait', caption: [], notes: [] }
        if (location === 'figure-caption') figure.caption = [inline]
        else if (location === 'figure-caption-en') figure.captionEn = [inline]
        else {
          const paragraph = { kind: 'paragraph' as const, id: 'fig-note-p', content: [inline] }
          figure.notes.push({ kind: 'note', id: 'fig-note', content: location === 'figure-note' ? [paragraph] : [
            { kind: 'list', id: 'fig-list', listType: 'dash', level: 1, items: [{ id: 'fig-item', content: [paragraph] }] },
          ] })
        }
        chapter.children.push(figure)
      } else {
        const formula: IRFormula = { kind: 'formula', id: 'formula', latex: 'x', numbered: true, whereList: [{
          id: 'where', term: location === 'formula-term' ? [inline] : [{ text: 'x' }],
          definition: location === 'formula-definition' ? [inline] : [{ text: '变量' }],
        }] }
        chapter.children.push(formula)
      }
      const before = JSON.stringify(doc)
      const result = resolve(doc)
      expect(result.problems.filter(p => p.code === 'invalid-footnote')).toHaveLength(1)
      expect(JSON.stringify(doc)).toBe(before)
      expect(resolve(doc)).toEqual(result)
      expect(() => renderHtml(doc, result.labels, { variant: 'print' })).toThrow('脚注关联无效')
      expect(() => renderDocx(doc, result.labels, { formulaOmml: {}, images: {}, stage: 'approval_draft', createdAt: '2026-10-03T00:00:00Z' })).toThrow('脚注关联无效')
    },
  )

  it('普通段落、列项、注和示例保留合法脚注，图的限制不泄漏到后续正文', () => {
    const list = fx.stdList('list', 'dash', ['item', '列项'])
    list.content![0]!.content!.push(fn('list-fn'))
    const note = fx.note('note', '注'); note.content!.push(fn('note-fn'))
    const example = fx.example('example', '示例'); example.content!.push(fn('example-fn'))
    const doc = docOf(fx.figure('fig', '', '图题'), fx.para('p', fn('body-fn')), list, note, example)
    const result = resolve(doc)
    expect(result.problems.filter(p => p.code.includes('footnote'))).toEqual([])
    expect(['body-fn', 'list-fn', 'note-fn', 'example-fn'].map(id => result.labels[id]?.label)).toEqual(['1)', '2)', '3)', '4)'])
  })
})


describe('公式主体脚注不在转换为 LaTeX 时丢失', () => {
  it.each(['only', 'mixed', 'nested'])('%s 公式主体保留脚注并阻断渲染', (scenario) => {
    const formula = fx.formula('formula-body', '')
    const footnote = fn('formula-fn')
    if (scenario === 'nested') footnote.attrs!.content = [fx.text('外层说明'), fn('nested-formula-fn')]
    formula.content![0]!.content = scenario === 'only' ? [footnote] : [fx.text('x'), footnote, fx.text('+1')]
    const pm = fx.standardDoc({}, fx.chapter('chapter', '正文', formula))
    const before = JSON.stringify(pm)
    const { doc } = pmToIr(pm)
    expect(JSON.stringify(pm)).toBe(before)
    expect(collectFootnotes(doc)).toContainEqual({ id: 'formula-fn', content: scenario === 'nested'
      ? [{ text: '外层说明' }, { text: '', footnote: { id: 'nested-formula-fn', content: [{ text: '脚注说明', marks: [{ type: 'bold' }] }] } }]
      : [{ text: '脚注说明', marks: [{ type: 'bold' }] }] })
    const result = resolve(doc)
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-footnote', nodeId: 'formula-body', severity: 'error' }))
    expect(() => renderHtml(doc, result.labels, { variant: 'print' })).toThrow('脚注关联无效')
    expect(() => renderDocx(doc, result.labels, { formulaOmml: {}, images: {}, stage: 'approval_draft', createdAt: '2026-10-03T00:00:00Z' })).toThrow('脚注关联无效')
  })
})


it('IR 表内公式的脚注上标即使目标有效也不能在降为纯 LaTeX 时丢失', () => {
  const node = table('table-formula', ['target'])
  const formula = fx.formula('math-with-ref', 'x')
  formula.content![0]!.content!.push(ref('target'))
  const doc = docOf(node, formula)
  const irTable = doc.body[0]!.children[0] as IRTable
  // 单元格 PM 转换只支持段落/列表；这里明确测试渲染入口直接接收 IR 的边界。
  irTable.rows[0]!.cells[0]!.content.push(doc.body[0]!.children.pop() as IRFormula)
  const result = resolve(doc)
  expect(result.problems.filter(p => p.code === 'invalid-footnote')).toEqual([
    expect.objectContaining({ nodeId: 'math-with-ref', severity: 'error' }),
  ])
  expect(result.problems.filter(p => p.code === 'dangling-footnote' || p.code === 'unreferenced-footnote')).toEqual([])
  expect(() => renderHtml(doc, result.labels, { variant: 'print' })).toThrow('脚注关联无效')
  expect(() => renderDocx(doc, result.labels, { formulaOmml: {}, images: {}, stage: 'approval_draft', createdAt: '2026-10-03T00:00:00Z' })).toThrow('脚注关联无效')
})

it('正常公式保留既有 IR 契约及 LaTeX 文本', () => {
  const doc = docOf(fx.formula('plain-math', '  x+1  '))
  expect(doc.body[0]!.children[0]).toEqual({ kind: 'formula', id: 'plain-math', latex: 'x+1', numbered: true, whereList: [] })
  expect(resolve(doc).problems.filter(p => p.code.includes('footnote'))).toEqual([])
})


describe('转换遗漏的脚注必须保留为阻断诊断', () => {
  it.each(['bibliography-title', 'appendix-label', 'untitled-clause', 'unknown-block', 'overwritten-bibliography'])(
    '%s 不静默丢失脚注，所有渲染出口报错', (scenario) => {
      const note = fn('unmapped-fn')
      let pm: PMJsonNode
      if (scenario === 'bibliography-title') {
        const bib = fx.bibliography(['entry', '文献'])
        bib.content![0]!.content!.push(note)
        pm = fx.standardDoc({}, bib)
      } else if (scenario === 'appendix-label') {
        const app = fx.appendix('app', true, '附录')
        app.content![0]!.content!.push(note)
        pm = fx.standardDoc({}, app)
      } else if (scenario === 'untitled-clause') {
        const clause = fx.clause('cl', 1, null)
        clause.content![0]!.content = [note]
        pm = fx.standardDoc({}, fx.chapter('ch', '章', clause))
      } else if (scenario === 'overwritten-bibliography') {
        const bib = fx.bibliography(['first', '第一组文献'])
        bib.content![1]!.content!.push(note)
        pm = fx.standardDoc({}, bib, fx.bibliography(['last', '末组文献']))
      } else pm = fx.standardDoc({}, fx.chapter('ch', '章', { type: 'unsupported', content: [note] }))
      const before = JSON.stringify(pm)
      const converted = pmToIr(pm)
      expect(JSON.stringify(pm)).toBe(before)
      expect(pmToIr(structuredClone(pm))).toEqual(converted)
      expect(collectFootnotes(converted.doc)).toContainEqual({ id: 'unmapped-fn', content: [{ text: '脚注说明', marks: [{ type: 'bold' }] }] })
      const result = resolve(converted.doc)
      expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-footnote', nodeId: 'unmapped-fn', severity: 'error' }))
      expect(() => renderHtml(converted.doc, result.labels, { variant: 'print' })).toThrow('脚注关联无效')
      expect(() => renderDocx(converted.doc, result.labels, { formulaOmml: {}, images: {}, stage: 'approval_draft', createdAt: '2026-10-03T00:00:00Z' })).toThrow('脚注关联无效')
    },
  )
})


it('未映射的表脚注上标也触发渲染入口检查，不能只检查条文脚注集合', () => {
  const bib = fx.bibliography(['entry', '文献'])
  bib.content![0]!.content!.push(ref('target'))
  const doc = pmToIr(fx.standardDoc({}, fx.chapter('ch', '正文', table('t', ['target'])), bib)).doc
  expect(collectFootnotes(doc)).toEqual([])
  const result = resolve(doc)
  expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-footnote', severity: 'error' }))
  expect(() => renderHtml(doc, result.labels, { variant: 'print' })).toThrow('脚注关联无效')
  expect(() => renderDocx(doc, result.labels, { formulaOmml: {}, images: {}, stage: 'approval_draft', createdAt: '2026-10-03T00:00:00Z' })).toThrow('脚注关联无效')
})
