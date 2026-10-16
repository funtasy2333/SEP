/**
 * 长表续页的回归：页位置已知时自动续表（拆段）；页位置未知（前置公式等）与嵌套表退回自然排法，
 * 即 B1「位置未知不再强制换页」。设计见 docs/wp7-docx-delivery.md §5.9。
 * 导出选项「续表方式」已于 2026-10-16 撤回，自然排法不再有任何选项入口。
 */
import { describe, expect, it } from 'vitest'
import type { IRDoc, IRTable, IRTableRow } from '../../../ir/types'
import { resolve } from '../../../ir/resolve'
import { footnoteFixture } from '../../__tests__/footnoteFixture'
import { assertChildOrder, assertNumberingIntegrity, assertWellFormed } from '../__tests__/helpers/checks'
import { assertNumberingConsistency } from '../__tests__/helpers/consistency'
import { findChild, parseXml, type XmlElement } from '../__tests__/helpers/xmlTree'
import { renderDocxTraced } from '../render'
import { styleSpecs } from '../styles'
import { LANDSCAPE_END, LANDSCAPE_START, renderBlock, renderBlocks } from './block'
import { createRenderContext } from './context'
import { SMALL_TABLE_MM } from './tablePagination'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const LABELS = {
  table: { label: '表3', xmlId: 'table_3', refText: '表3' },
  second: { label: '表4', xmlId: 'table_4', refText: '表4' },
  'appendix-table': { label: '表A.1', xmlId: 'table_a_1', refText: '表A.1' },
}

function row(index: number, description = '用于检查自然分页与表头重复。'): IRTableRow {
  return {
    id: `row-${index}`,
    cells: [
      { id: `name-${index}`, colspan: 1, rowspan: 1, header: false,
        content: [{ kind: 'paragraph', id: `name-p-${index}`, content: [{ text: `项目 ${index}` }] }] },
      { id: `description-${index}`, colspan: 1, rowspan: 1, header: false,
        content: [{ kind: 'paragraph', id: `description-p-${index}`, content: [{ text: description }] }] },
    ],
  }
}

function table(rows: IRTableRow[], overrides: Partial<IRTable> = {}): IRTable {
  return {
    kind: 'table', id: 'table', caption: [{ text: '连续记录表' }], orientation: 'portrait',
    headerRowCount: 1,
    rows: [{
      id: 'header',
      cells: [{ id: 'header-1', colspan: 1, rowspan: 1, header: true,
        content: [{ kind: 'paragraph', id: 'header-p-1', content: [{ text: '表头一' }] }] },
      { id: 'header-2', colspan: 1, rowspan: 1, header: true,
        content: [{ kind: 'paragraph', id: 'header-p-2', content: [{ text: '表头二' }] }] }],
    }, ...rows],
    notes: [],
    ...overrides,
  }
}

const longRows = () => Array.from({ length: 70 }, (_, index) => row(index + 1, '短记录'))
const withNote = (ir: IRTable): IRTable => ({
  ...ir,
  notes: [{ kind: 'note', id: 'table-note', content: [{ kind: 'paragraph', id: 'table-note-p', content: [{ text: '表注仅在表末。' }] }] }],
})

function context() {
  const ctx = createRenderContext(LABELS, new Map(), { images: {}, formulaOmml: {} })
  ctx.pageFlow.startSection()
  return ctx
}

/** 页位置未知的上下文：OMML 公式的物理高度不可估算，其后的表退回自然排法（且位置未知向后传播）。 */
function unknownPositionContext() {
  const ctx = context()
  ctx.pageFlow.recordParagraph('SesFormula', '<m:oMath/>', false)
  return ctx
}

const parse = (xml: string): XmlElement => parseXml(`<w:root xmlns:w="${W_NS}">${xml}</w:root>`)
const elements = (element: XmlElement, name: string): XmlElement[] =>
  element.children.filter((child): child is XmlElement => child.kind === 'element' && child.name === name)
const hasKeepNext = (rowElement: XmlElement): boolean =>
  JSON.stringify(rowElement).includes('"name":"w:keepNext"')
const rowText = (rowElement: XmlElement): string => JSON.stringify(rowElement)

describe('页位置未知：自然排法（table-flow-natural-fallback）', () => {
  it('长表整表输出：单个 w:tbl，无硬分页、无续表题，表题在表外并带 keepNext', () => {
    const ctx = unknownPositionContext()
    const xml = renderBlock(ctx, withNote(table(longRows())), { scopeKey: 'chapter' })
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(xml).not.toContain('w:type="page"')
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml).not.toContain('SesTblCapCont')
    expect(xml).not.toContain('（续）')
    expect(xml.match(/项目 \d+/g)).toHaveLength(70)
    expect(xml.match(/表注仅在表末/g)).toHaveLength(1)

    const root = parse(xml)
    expect(root.children.map((child) => child.kind === 'element' ? child.name : '#text')).toEqual(['w:p', 'w:tbl'])
    // 表题是独立段落，位于 w:tbl 之前，使用现有表题样式；该样式本身带 keepNext，与首个表头行相连。
    expect(xml.indexOf('w:val="SesTblCap"')).toBeLessThan(xml.indexOf('<w:tbl>'))
    expect(styleSpecs().find((spec) => spec.id === 'SesTblCap')?.keepNext).toBe(true)
    expect(styleSpecs().find((spec) => spec.id === 'SesAppTblCap')?.keepNext).toBe(true)
    expect(ctx.numbered.filter((item) => item.kind === 'table')).toEqual([{ nodeId: 'table', kind: 'table' }])
  })

  it('表头行从第 1 行起连续设置 tblHeader；表题不在表内，表注只在末行', () => {
    const ir = table(longRows(), { headerRowCount: 2 })
    ir.rows.splice(1, 0, { ...ir.rows[0]!, id: 'header-b' })
    const xml = renderBlock(unknownPositionContext(), withNote(ir), { scopeKey: 'chapter' })
    const rows = elements(findChild(parse(xml), 'w:tbl')!, 'w:tr')
    const headerFlags = rows.map((tr) => findChild(findChild(tr, 'w:trPr')!, 'w:tblHeader') !== undefined)
    expect(headerFlags.slice(0, 3)).toEqual([true, true, false])
    expect(headerFlags.slice(2).every((flag) => !flag)).toBe(true)
    expect(rows).toHaveLength(2 + 70 + 1) // 两个表头行 + 数据行 + 表注行
    expect(rowText(rows[0]!)).not.toContain('连续记录表')
    expect(rowText(rows[rows.length - 1]!)).toContain('表注仅在表末')
    expect(rows.every((tr) => findChild(findChild(tr, 'w:trPr')!, 'w:cantSplit') !== undefined)).toBe(true)
  })

  it('长表只保护表头、合并行组与表尾：中间数据行不加 keepNext，Word 可在任意行边界跨页', () => {
    const rows = longRows()
    rows[9]!.cells[0]!.rowspan = 3
    rows[10]!.cells.splice(0, 1)
    rows[11]!.cells.splice(0, 1)
    const xml = renderBlock(unknownPositionContext(), withNote(table(rows)), { scopeKey: 'chapter' })
    const trs = elements(findChild(parse(xml), 'w:tbl')!, 'w:tr')
    expect(hasKeepNext(trs[0]!)).toBe(true) // 表头行与首个数据行相连
    expect(hasKeepNext(trs[1]!)).toBe(false) // 首个数据行可与第二行分页
    expect(hasKeepNext(trs[30]!)).toBe(false)
    // 数据第 10 行起的三行属同一合并组：前两行与下一行相连，组末行不连。
    expect([10, 11, 12].map((n) => hasKeepNext(trs[n]!))).toEqual([true, true, false])
    // 末个数据行与表注行相连，表注行本身是最后一行。
    expect(hasKeepNext(trs[70]!)).toBe(true)
    expect(hasKeepNext(trs[71]!)).toBe(false)
    expect(trs).toHaveLength(72)
  })

  it(`小表（不高于 ${SMALL_TABLE_MM} mm）整体保留：keepNext 连到末行，整表一个 w:tbl，不告警`, () => {
    const ctx = unknownPositionContext()
    const xml = renderBlock(ctx, table([row(1), row(2)]), { scopeKey: 'chapter' })
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    const trs = elements(findChild(parse(xml), 'w:tbl')!, 'w:tr')
    expect(trs.map(hasKeepNext)).toEqual([true, true, false])
    expect(ctx.warnings).toEqual([])
  })

  it('每张可能跨页的表给出带 Resolver 表号的 table-flow-natural-fallback；小表不告警', () => {
    const ctx = unknownPositionContext()
    renderBlock(ctx, table(longRows()), { scopeKey: 'chapter' })
    renderBlock(ctx, { ...table([row(1)]), id: 'second' }, { scopeKey: 'chapter' })
    expect(ctx.warnings).toEqual([expect.objectContaining({
      code: 'table-flow-natural-fallback', nodeId: 'table', label: '表3', message: expect.stringContaining('表3'),
    })])
    expect(ctx.warnings[0]!.message).toContain('「表3（续）」')
  })

  it('位置未知向后传播：前一张自然分页表之后的长表同样不拆分，各自告警', () => {
    const ctx = unknownPositionContext()
    renderBlock(ctx, table(longRows()), { scopeKey: 'chapter' })
    const xml = renderBlock(ctx, { ...table(longRows()), id: 'second' }, { scopeKey: 'chapter' })
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(xml).not.toContain('w:type="page"')
    expect(ctx.warnings.map((w) => [w.code, w.nodeId, w.label])).toEqual([
      ['table-flow-natural-fallback', 'table', '表3'],
      ['table-flow-natural-fallback', 'second', '表4'],
    ])
  })

  it('附录表使用附录表题样式与附录实例，编号属主只出现一次', () => {
    const ctx = unknownPositionContext()
    const xml = renderBlock(ctx, { ...table(longRows()), id: 'appendix-table' },
      { scopeKey: 'appendix', appendix: { id: 'appendix', letter: 'A' } })
    expect(xml).toContain('w:val="SesAppTblCap"')
    expect(xml).not.toContain('SesAppTblCapCont')
    expect(xml.indexOf('w:val="SesAppTblCap"')).toBeLessThan(xml.indexOf('<w:tbl>'))
    expect(ctx.numbered.filter((item) => item.kind === 'table')).toEqual([{ nodeId: 'appendix-table', kind: 'table' }])
    expect(ctx.warnings[0]).toMatchObject({ code: 'table-flow-natural-fallback', label: '表A.1' })
  })

  it('横排长表：表题与整张表都位于横排节标记之内，不拆分', () => {
    const ctx = context()
    // 横排元素从新页开始、页位置重新已知；先在横排节内放一个公式使位置未知，其后的横排长表即退回自然排法。
    ctx.pageFlow.withElement(true, () => ctx.pageFlow.recordParagraph('SesFormula', '<m:oMath/>', false))
    const xml = renderBlock(ctx, table(longRows(), { orientation: 'landscape' }), { scopeKey: 'chapter' })
    expect(xml.startsWith(LANDSCAPE_START)).toBe(true)
    expect(xml.endsWith(LANDSCAPE_END)).toBe(true)
    const inner = xml.slice(LANDSCAPE_START.length, xml.length - LANDSCAPE_END.length)
    expect(inner.startsWith('<w:p>')).toBe(true)
    expect(inner).toContain('w:val="SesTblCap"')
    expect(inner.match(/<w:tbl>/g)).toHaveLength(1)
    expect(inner).not.toContain('w:type="page"')
    expect(inner).not.toContain('pageBreakBefore')
    expect(ctx.warnings).toEqual([expect.objectContaining({ code: 'table-flow-natural-fallback', label: '表3' })])
  })

  it('相邻顶层表之间由表题段隔开，不会出现 </w:tbl><w:tbl>，也不会被 Word 合并', () => {
    const ctx = unknownPositionContext()
    const xml = renderBlocks(ctx, [table(longRows()), { ...table(longRows()), id: 'second' }], { scopeKey: 'chapter' })
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2)
    expect(xml).not.toContain('</w:tbl><w:tbl>')
    expect(xml).toMatch(/<\/w:tbl><w:p><w:pPr><w:pStyle w:val="SesTblCap"\/>/)
  })

  it('表头单元格合并跨入数据行时给出带表号的告警，仍整表输出', () => {
    const ir = table(longRows())
    ir.rows[0]!.cells[0]!.rowspan = 3
    ir.rows[1]!.cells.splice(0, 1)
    ir.rows[2]!.cells.splice(0, 1)
    const ctx = unknownPositionContext()
    const xml = renderBlock(ctx, ir, { scopeKey: 'chapter' })
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(ctx.warnings.find((w) => w.code === 'table-header-rowspan-pagination'))
      .toMatchObject({ nodeId: 'table', label: '表3' })
  })

  it('嵌套表格同样整表输出，且不推进外层页流', () => {
    const ctx = context()
    const before = ctx.pageFlow.availableMm
    const xml = ctx.pageFlow.suspend(() => renderBlock(ctx, table(longRows()), { scopeKey: 'cell' }))
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(xml).not.toContain('w:type="page"')
    expect(ctx.pageFlow.availableMm).toBe(before)
    expect(ctx.warnings.filter((w) => w.code.startsWith('table-flow'))).toEqual([])
  })
})

describe('页位置已知：自动续表', () => {
  it('长表拆成多个 w:tbl，续段之间硬分页并写续表题', () => {
    const xml = renderBlock(context(), withNote(table(longRows())), { scopeKey: 'chapter' })
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBeGreaterThan(1)
    expect(xml).toContain('SesTblCapCont')
    expect(xml).toContain('（续）')
    expect(xml).toContain('w:type="page"')
    expect(xml.match(/表注仅在表末/g)).toHaveLength(1)
  })
})

describe('B1：位置已知时不写强制分页', () => {
  it('旧页余量放不下首段：首段整段 keepNext 让 Word 推移，表题不写 pageBreakBefore，页流仍记为新页起排', () => {
    const ctx = context()
    ctx.pageFlow.placeTable([225], false) // 旧页只剩约 13 mm
    const xml = renderBlock(ctx, withNote(table(longRows())), { scopeKey: 'chapter' })
    const tables = elements(parse(xml), 'w:tbl')
    expect(tables.length).toBeGreaterThan(1)
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml.match(/w:type="page"/g)).toHaveLength(tables.length - 1)
    // 首段：除最后一行外每行都与下一行相连，整段作为同页链被 Word 推到下一页。
    const first = elements(tables[0]!, 'w:tr')
    expect(first.slice(0, -1).every(hasKeepNext)).toBe(true)
    expect(ctx.warnings.map((w) => w.code)).not.toContain('table-flow-natural-fallback')
    expect(ctx.pageFlow.estimateUnavailable).toBe(false)
  })

  it('页流记账与输出一致：末段高度之后的余量与拆段数', () => {
    const ctx = context()
    const budget = ctx.pageFlow.beforeTable()
    expect(budget.positionUnknown).toBe(false)
    const xml = renderBlock(ctx, table(longRows()), { scopeKey: 'chapter' })
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBeGreaterThan(1)
    expect(ctx.pageFlow.availableMm).toBeGreaterThan(0)
    expect(ctx.pageFlow.availableMm).toBeLessThan(238)
  })

  it('分页风险告警带 Resolver 表号', () => {
    const huge = table([row(1, '多行内容。'.repeat(1000)), row(2)])
    const ctx = context()
    renderBlock(ctx, huge, { scopeKey: 'chapter' })
    expect(ctx.warnings.find((w) => w.code === 'table-row-too-tall'))
      .toMatchObject({ nodeId: 'table', label: '表3', message: expect.stringContaining('表3') })
  })

  it('表号缺失时告警退回节点 id 而不自行编号', () => {
    const ctx = createRenderContext({})
    ctx.pageFlow.startSection()
    ctx.pageFlow.recordParagraph('SesFormula', '<m:oMath/>', false)
    renderBlock(ctx, table(longRows()), { scopeKey: 'chapter' })
    const fallback = ctx.warnings.find((w) => w.code === 'table-flow-natural-fallback')!
    expect(fallback.label).toBeUndefined()
    expect(fallback.message).toContain('表格 "table"')
  })
})

describe('整份文档：自动续表与位置未知回退', () => {
  const OPTIONS = { formulaOmml: {}, images: {}, stage: 'approval_draft' as const, createdAt: '2026-10-15T00:00:00.000Z' }

  /** 同一份行结构复用时给所有节点 id 加前缀，保持文档内 id 唯一。 */
  function unique(id: string, caption: string, rows: IRTableRow[], overrides: Partial<IRTable> = {}): IRTable {
    const base = table(rows, { caption: [{ text: caption }], ...overrides })
    return {
      ...base, id,
      rows: base.rows.map((tr) => ({
        ...tr, id: `${id}-${tr.id}`,
        cells: tr.cells.map((cell) => ({
          ...cell, id: `${id}-${cell.id}`,
          content: cell.content.map((block) => ({ ...block, id: `${id}-${block.id}` })),
        })),
      })),
    }
  }

  function document(): IRDoc {
    return {
      schemaVersion: 1,
      meta: { standardType: 'gb', stdCode: 'GB/T 12345—2026', title: '续表方式' },
      front: { foreword: [], introduction: [] },
      body: [{ kind: 'chapter', id: 'chapter-1', secType: 'general', title: [{ text: '正文' }], children: [
        { kind: 'paragraph', id: 'p-1', content: [{ text: '表前正文。' }] },
        unique('table-a', '第一张长表', longRows()),
        unique('table-b', '紧邻的第二张长表', longRows()),
        unique('landscape-table', '横排长表', longRows(), { orientation: 'landscape' }),
        unique('table-c', '短表', [row(1), row(2)]),
      ] }],
      appendices: [{ kind: 'appendix', id: 'appendix-1', normative: true, title: [{ text: '附录表' }], children: [
        unique('table-app', '附录长表', longRows()),
      ] }],
      bibliography: [],
    }
  }

  /** 在正文章与附录的首张表之前各放一个公式：公式高度不可估算，其后的竖排表都退回自然排法。 */
  function documentWithUnknownPositions(): IRDoc {
    const doc = document()
    const formula = (id: string): IRDoc['body'][number]['children'][number] =>
      ({ kind: 'formula', id, latex: 'x=1', numbered: false, whereList: [] })
    doc.body[0]!.children.splice(1, 0, formula('formula-body'))
    doc.appendices[0]!.children.splice(0, 0, formula('formula-appendix'))
    return doc
  }

  it('位置未知：竖排表整份文档不写强制分页、整表输出，告警带 Resolver 表号；横排节重新拆分；文件合法、编号与 Resolver 一致', () => {
    const doc = documentWithUnknownPositions()
    const { labels } = resolve(doc)
    const { pkg, numbered } = renderDocxTraced(doc, labels, OPTIONS)
    const xml = pkg.parts['word/document.xml']!
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml).not.toContain('SesAppTblCapCont')
    expect(xml).not.toContain('<!--ses-')
    expect(xml).not.toContain('</w:tbl><w:tbl>')
    // 唯一的拆段来自横排长表（横排节从新页起排，页位置重新已知）：每个续段一个续表题、一次硬分页。
    const continuations = xml.match(/SesTblCapCont/g)?.length ?? 0
    expect(continuations).toBeGreaterThan(0)
    expect(xml.match(/w:type="page"/g)).toHaveLength(continuations)
    // 竖排四张表（含短表与附录表）各一个 w:tbl，横排长表为 continuations + 1 个。
    expect(xml.match(/<w:tbl>/g)).toHaveLength(4 + continuations + 1)
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
    expect(() => assertNumberingConsistency(pkg, numbered, labels, new Map())).not.toThrow()
    const fallback = pkg.warnings.filter((w) => w.code === 'table-flow-natural-fallback')
    expect(fallback.map((w) => w.nodeId)).toEqual(['table-a', 'table-b', 'table-app'])
    expect(fallback.map((w) => w.label)).toEqual(
      ['table-a', 'table-b', 'table-app'].map((id) => labels[id]!.label))
    expect(fallback.every((w) => /^表[0-9A-Z.]+$/.test(w.label!))).toBe(true)
  })

  it('split（缺省）：同一份文档按估算拆分并写续表题，已知位置的表没有自然分页告警', () => {
    const doc = document()
    const { labels } = resolve(doc)
    const { pkg, numbered } = renderDocxTraced(doc, labels, OPTIONS)
    const xml = pkg.parts['word/document.xml']!
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml).toContain('SesTblCapCont')
    expect(xml).toContain('SesAppTblCapCont')
    expect(xml.match(/w:type="page"/g)!.length).toBeGreaterThanOrEqual(3)
    expect(pkg.warnings.map((w) => w.code)).not.toContain('table-flow-natural-fallback')
    expect(() => assertNumberingConsistency(pkg, numbered, labels, new Map())).not.toThrow()
  })

  it('位置未知：自然排法下表脚注与表注只在表末输出一次，不被拆分', () => {
    const doc = footnoteFixture()
    doc.body[0]!.children.unshift({ kind: 'formula', id: 'formula-1', latex: 'x=1', numbered: false, whereList: [] })
    const { labels } = resolve(doc)
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)
    const xml = pkg.parts['word/document.xml']!
    // 自然排法的表题在 w:tbl 之外（拆分排法放在表内首行）。
    expect(xml.indexOf('w:val="SesTblCap"')).toBeLessThan(xml.indexOf('<w:tbl>'))
    expect(xml.match(/表注内容/g)).toHaveLength(1)
    expect(xml.match(/<w:t[^>]*>定义A<\/w:t>/g)).toHaveLength(1)
    expect(xml.match(/<w:t[^>]*>定义B<\/w:t>/g)).toHaveLength(1)
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
  })

  it('split：公式之后的长表退回自然分页，告警带表号，文档中不出现强制分页', () => {
    const doc = document()
    doc.body[0]!.children.splice(1, 0, { kind: 'formula', id: 'formula-1', latex: 'x=1', numbered: false, whereList: [] })
    const { labels } = resolve(doc)
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)
    const xml = pkg.parts['word/document.xml']!
    expect(xml).not.toContain('pageBreakBefore')
    const fallback = pkg.warnings.filter((w) => w.code === 'table-flow-natural-fallback')
    expect(fallback.map((w) => w.nodeId)).toEqual(['table-a', 'table-b'])
    expect(fallback.map((w) => w.label)).toEqual([labels['table-a']!.label, labels['table-b']!.label])
    // 横排长表所在的横排节从新页开始，页位置重新已知；附录是新节，同样已知。
    expect(xml.match(/SesTblCapCont/g)).toBeTruthy()
    expect(xml).toContain('SesAppTblCapCont')
  })
})
