/**
 * render.ts / renderDocxTraced 单元测试（docs/wp7-docx-delivery.md §9 WP7.2「测试」）。
 *
 * warning：每个 code 至少一例（cover-field-missing、clause-too-deep、list-format-fallback、
 * list-too-deep、label-missing——后两项已由 numbering fixture 覆盖，这里补齐前三项与
 * label-missing 的其余触发点）；空文档能生成并通过全部检查。
 */

import { describe, expect, it } from 'vitest'
import type { IRChapter, IRClause, IRDoc, IRNote, IRTable, NodeId, ResolvedLabel } from '../../ir/types'
import { renderDocxTraced } from './render'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from './__tests__/helpers/checks'
import { docxOutline } from './__tests__/helpers/outline'

const OPTS = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-09-25T08:00:00.000Z' }

function emptyDoc(overrides: Partial<IRDoc> = {}): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [],
    appendices: [],
    bibliography: [],
    ...overrides,
  }
}

describe('warning：cover-field-missing', () => {
  it('meta.stdCode 缺失时记一条（无 nodeId）', () => {
    const doc = emptyDoc({ meta: { standardType: 'gb', title: '有标题' } })
    const { pkg } = renderDocxTraced(doc, {}, OPTS)
    const w = pkg.warnings.filter((x) => x.code === 'cover-field-missing')
    expect(w).toHaveLength(1)
    expect(w[0].nodeId).toBeUndefined()
  })

  it('meta.title 缺失时另记一条', () => {
    const doc = emptyDoc({ meta: { standardType: 'gb', stdCode: 'GB/T 1—2026' } })
    const { pkg } = renderDocxTraced(doc, {}, OPTS)
    const w = pkg.warnings.filter((x) => x.code === 'cover-field-missing')
    expect(w).toHaveLength(1)
  })

  it('两者都缺失时记两条', () => {
    const doc = emptyDoc()
    const { pkg } = renderDocxTraced(doc, {}, OPTS)
    expect(pkg.warnings.filter((x) => x.code === 'cover-field-missing')).toHaveLength(2)
  })

  it('两者都不缺失时不记', () => {
    const doc = emptyDoc({ meta: { standardType: 'gb', title: '标题', stdCode: 'GB/T 1—2026' } })
    const { pkg } = renderDocxTraced(doc, {}, OPTS)
    expect(pkg.warnings.filter((x) => x.code === 'cover-field-missing')).toHaveLength(0)
  })
})

describe('warning：clause-too-deep', () => {
  it('条嵌套深度超过 5 时记一条，按 5 级输出（不中断渲染）', () => {
    // 章 → 条(1) → 条(2) → … → 条(6)：第 6 层超出 A1 的 L5 上限
    let leaf: IRClause = { kind: 'clause', id: 'cl-6', level: 6, titled: true, title: [{ text: '第六层' }], children: [] }
    for (let lvl = 5; lvl >= 1; lvl--) {
      leaf = { kind: 'clause', id: `cl-${lvl}`, level: lvl, titled: true, title: [{ text: `第${lvl}层` }], children: [leaf] }
    }
    const chapter: IRChapter = { kind: 'chapter', id: 'ch1', secType: 'general', title: [{ text: '章一' }], children: [leaf] }
    const doc = emptyDoc({ body: [chapter] })
    const labels: Record<NodeId, ResolvedLabel> = {}
    const { pkg } = renderDocxTraced(doc, labels, OPTS)
    const w = pkg.warnings.filter((x) => x.code === 'clause-too-deep')
    expect(w).toHaveLength(1)
    expect(w[0].nodeId).toBe('cl-6')
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(docxOutline(pkg)).toContain('SesClause5') // 第六层被夹到第 5 级样式输出，没有 SesClause6
  })
})

describe('warning：label-missing', () => {
  it('注在 labels 中没有 label 时记一条，按单条处理', () => {
    const note: IRNote = { kind: 'note', id: 'note-x', content: [{ kind: 'paragraph', id: 'note-x-p', content: [{ text: '注内容' }] }] }
    const chapter: IRChapter = { kind: 'chapter', id: 'ch1', secType: 'general', title: [{ text: '章一' }], children: [note] }
    const doc = emptyDoc({ body: [chapter] })
    const { pkg, numbered } = renderDocxTraced(doc, {}, OPTS)
    const w = pkg.warnings.filter((x) => x.code === 'label-missing')
    expect(w).toHaveLength(1)
    expect(w[0].nodeId).toBe('note-x')
    expect(numbered.find((n) => n.nodeId === 'note-x')?.kind).toBe('note')
    expect(docxOutline(pkg)).toContain('SesNote') // 按单条处理，用 SesNote 不是 SesNoteN
  })

  it('编号公式在 labels 中没有 label 时记一条，不写编号', () => {
    const chapter: IRChapter = {
      kind: 'chapter', id: 'ch1', secType: 'general', title: [{ text: '章一' }],
      children: [{ kind: 'formula', id: 'f-x', latex: 'x=1', numbered: true, whereList: [] }],
    }
    const doc = emptyDoc({ body: [chapter] })
    const { pkg } = renderDocxTraced(doc, {}, OPTS)
    const w = pkg.warnings.filter((x) => x.code === 'label-missing')
    expect(w).toHaveLength(1)
    expect(w[0].nodeId).toBe('f-x')
  })
})

describe('空文档（无章、无附录、无参考文献、无前言引言）', () => {
  it('能生成并通过全部检查', () => {
    const doc = emptyDoc({ meta: { standardType: 'gb', title: '空文档', stdCode: 'GB/T 0—2026' } })
    const { pkg, numbered } = renderDocxTraced(doc, {}, OPTS)
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
    expect(numbered).toEqual([])
    expect(pkg.warnings.filter((w) => w.code === 'cover-field-missing')).toHaveLength(0)
    // 仍然只有封面、目次、正文三节（无前言引言附录参考文献）
    const sectionLines = docxOutline(pkg).split('\n').filter((l) => l.startsWith('§'))
    expect(sectionLines).toHaveLength(3)
  })
})


describe('不可测公式后的标题同页链', () => {
  it('不写任何强制分页：两条标题与表题的 keepNext 链完整保留，短表整体保留且不告警', () => {
    const table: IRTable = { kind: 'table', id: 'forced-table', orientation: 'portrait',
      caption: [{ text: '公式后短表' }], headerRowCount: 0, notes: [], rows: [{ id: 'row', cells: [
        { id: 'cell', colspan: 1, rowspan: 1, header: false, content: [
          { kind: 'paragraph', id: 'cell-p', content: [{ text: '短表内容' }] },
        ] },
      ] }] }
    const clause: IRClause = { kind: 'clause', id: 'forced-heading', level: 1, titled: true,
      title: [{ text: '第一条标题' }], children: [{ kind: 'clause', id: 'forced-child', level: 2,
        titled: true, title: [{ text: '第二条标题' }], children: [table] }] }
    const doc = emptyDoc({ body: [{ kind: 'chapter', id: 'chapter', secType: 'general',
      title: [{ text: '章标题' }], children: [
        { kind: 'clause', id: 'earlier-heading', level: 1, titled: true, title: clause.title,
          children: [{ kind: 'paragraph', id: 'earlier-p', content: [{ text: '先前同名标题正文' }] }] },
        { kind: 'formula', id: 'formula', latex: 'x=1', numbered: false, whereList: [] }, clause,
      ] }] })
    const { pkg } = renderDocxTraced(doc, {}, OPTS)
    const paragraphs = [...pkg.parts['word/document.xml'].matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map(m => m[1]!)
    const sameTitles = paragraphs.filter(p => p.includes('SesClause1') && p.includes('第一条标题'))
    expect(sameTitles).toHaveLength(2)
    expect(sameTitles[0]).not.toContain('<w:pageBreakBefore/>')
    const first = sameTitles[1]!
    const second = paragraphs.find(p => p.includes('SesClause2') && p.includes('第二条标题'))!
    const caption = paragraphs.find(p => p.includes('SesTblCap'))!
    expect(first).not.toContain('<w:pageBreakBefore/>')
    expect(second).not.toContain('<w:pageBreakBefore/>')
    expect(caption).not.toContain('<w:pageBreakBefore/>')
    expect(pkg.parts['word/document.xml']).not.toContain('pageBreakBefore')
    expect(pkg.parts['word/document.xml']).not.toContain('<!--ses-')
    // 短表不会跨页：既无旧的 table-flow-estimate-unavailable，也无自然分页告警。
    expect(pkg.warnings.filter(w => w.code.startsWith('table-'))).toEqual([])
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertWellFormed(pkg)).not.toThrow()
  })
})
