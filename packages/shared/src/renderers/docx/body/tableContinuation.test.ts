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
import { createRenderContext, emitParagraph } from './context'
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
/** 顶层（块级）子元素名序列，如 ['w:p', 'w:tbl', 'w:p', 'w:tbl']。 */
const topLevel = (xml: string): string[] =>
  parse(xml).children.map((child) => child.kind === 'element' ? child.name : '#text')
/** 「表题段 + 首段表格，然后每个续段为续表题段 + 表格」的顶层结构。 */
const splitStructure = (segments: number): string[] =>
  ['w:p', 'w:tbl', ...Array.from({ length: segments - 1 }, () => ['w:p', 'w:tbl']).flat()]
/**
 * 文档中 pageBreakBefore 的统计：全部、位于续表题段（SesTblCapCont/SesAppTblCapCont）上的，以及续表题段总数。
 * 续表只在续表题段上换页：三者必须相等；首段之前（表题、前置标题链）不得有任何 pageBreakBefore。
 */
function pageBreakStats(xml: string) {
  return {
    all: xml.match(/<w:pageBreakBefore\/>/g)?.length ?? 0,
    onContinuationCaption: xml.match(/<w:pStyle w:val="Ses(?:App)?TblCapCont"\/><w:pageBreakBefore\/>/g)?.length ?? 0,
    continuationCaptions: xml.match(/<w:pStyle w:val="Ses(?:App)?TblCapCont"\/>/g)?.length ?? 0,
  }
}
/** 表后紧跟一个只含 SesNormal 样式的空段（旧版为隔开相邻表而插入）。 */
const EMPTY_SEPARATOR = /<\/w:tbl><w:p><w:pPr><w:pStyle w:val="SesNormal"\/><\/w:pPr><\/w:p>/
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
  it('长表拆成多个 w:tbl：表题在首段之前，每个续段前是带 pageBreakBefore 的续表题段，没有分页符空段', () => {
    const xml = renderBlock(context(), withNote(table(longRows())), { scopeKey: 'chapter' })
    const segments = (xml.match(/<w:tbl>/g) ?? []).length
    expect(segments).toBeGreaterThan(1)
    // 结构：表题段、首段表格，然后每个续段为「续表题段 + 表格」；表格之间不再有 w:br page 的空 SesNormal 段。
    expect(topLevel(xml)).toEqual(splitStructure(segments))
    expect(xml).not.toContain('w:type="page"')
    expect(xml).not.toContain('w:br')
    expect(xml).not.toContain('SesNormal')
    expect(xml.startsWith('<w:p><w:pPr><w:pStyle w:val="SesTblCap"/></w:pPr>')).toBe(true) // 首段表题没有 pageBreakBefore
    expect(xml.match(/w:pStyle w:val="SesTblCap"/g)).toHaveLength(1)
    expect(xml).toContain('（续）')
    // pPr 子元素顺序：pStyle 在前，pageBreakBefore 随后（附录 B）。
    expect(xml).toContain('<w:p><w:pPr><w:pStyle w:val="SesTblCapCont"/><w:pageBreakBefore/></w:pPr>')
    expect(pageBreakStats(xml)).toEqual({ all: segments - 1, onContinuationCaption: segments - 1, continuationCaptions: segments - 1 })
    expect(xml.match(/表注仅在表末/g)).toHaveLength(1)
  })

  it('表题与续表题都不在表内；tblHeader 只在每段前 headerRowCount 行，从第 1 行起连续，首行粗上边框', () => {
    const ir = table(longRows(), { headerRowCount: 2 })
    ir.rows.splice(1, 0, { ...ir.rows[0]!, id: 'header-b' })
    const xml = renderBlock(context(), withNote(ir), { scopeKey: 'chapter' })
    const tables = elements(parse(xml), 'w:tbl')
    expect(tables.length).toBeGreaterThan(1)
    tables.forEach((tbl, index) => {
      const rows = elements(tbl, 'w:tr')
      const flags = rows.map((tr) => findChild(findChild(tr, 'w:trPr')!, 'w:tblHeader') !== undefined)
      expect(flags.slice(0, 2)).toEqual([true, true])
      expect(flags.slice(2).every((flag) => !flag)).toBe(true) // 数据行、表注行都没有 tblHeader
      expect(rows.every((tr) => findChild(findChild(tr, 'w:trPr')!, 'w:cantSplit') !== undefined)).toBe(true)
      // 第 1 行就是列标题（每个续段重放表头）；表题/续表题文字不在任何表格行内。
      expect(rowText(rows[0]!)).toContain('表头一')
      expect(rowText(tbl)).not.toContain('连续记录表')
      expect(rowText(tbl)).not.toContain('（续）')
      const borders = findChild(findChild(findChild(rows[0]!, 'w:tc')!, 'w:tcPr')!, 'w:tcBorders')!
      expect(findChild(borders, 'w:top')?.attrs).toMatchObject({ 'w:val': 'single', 'w:sz': '6' })
      expect(rowText(tbl).includes('表注仅在表末')).toBe(index === tables.length - 1)
    })
    // 表题 + 各续表题各一次，全部在表外段落。
    expect(xml.match(/连续记录表/g)).toHaveLength(tables.length)
  })

  it('附录表：表题用 SesAppTblCap，续表题用 SesAppTblCapCont + pageBreakBefore，附录实例只分配一次', () => {
    const ctx = context()
    const xml = renderBlock(ctx, { ...table(longRows()), id: 'appendix-table' },
      { scopeKey: 'appendix', appendix: { id: 'appendix', letter: 'A' } })
    const segments = (xml.match(/<w:tbl>/g) ?? []).length
    expect(segments).toBeGreaterThan(1)
    expect(topLevel(xml)).toEqual(splitStructure(segments))
    expect(xml.match(/w:pStyle w:val="SesAppTblCap"/g)).toHaveLength(1)
    expect(xml).toContain('<w:p><w:pPr><w:pStyle w:val="SesAppTblCapCont"/><w:pageBreakBefore/></w:pPr>')
    expect(xml).not.toContain('SesTblCapCont')
    expect(pageBreakStats(xml)).toEqual({ all: segments - 1, onContinuationCaption: segments - 1, continuationCaptions: segments - 1 })
    // 续表题文字：附录表号 + 全角空格、原表题、（续）；表号来自 Resolver labels。
    expect(xml.match(/<w:t xml:space="preserve">表A\.1　<\/w:t>/g)).toHaveLength(segments - 1)
    expect(xml.match(/<w:t xml:space="preserve">（续）<\/w:t>/g)).toHaveLength(segments - 1)
    expect(ctx.numbered.filter((item) => item.kind === 'table')).toEqual([{ nodeId: 'appendix-table', kind: 'table' }])
    expect(styleSpecs().find((spec) => spec.id === 'SesAppTblCapCont')?.keepNext).toBe(true)
    expect(styleSpecs().find((spec) => spec.id === 'SesTblCapCont')?.keepNext).toBe(true)
  })

  it('横排长表：表题、各续表题段、各段表格与表注都在横排节标记之内', () => {
    const xml = renderBlock(context(), withNote(table(longRows(), { orientation: 'landscape' })), { scopeKey: 'chapter' })
    expect(xml.startsWith(LANDSCAPE_START)).toBe(true)
    expect(xml.endsWith(LANDSCAPE_END)).toBe(true)
    const inner = xml.slice(LANDSCAPE_START.length, xml.length - LANDSCAPE_END.length)
    expect(inner).not.toContain('<!--SES:landscape')
    const segments = (inner.match(/<w:tbl>/g) ?? []).length
    expect(segments).toBeGreaterThan(1)
    expect(topLevel(inner)).toEqual(splitStructure(segments))
    expect(inner).not.toContain('w:type="page"')
    expect(pageBreakStats(inner)).toEqual({ all: segments - 1, onContinuationCaption: segments - 1, continuationCaptions: segments - 1 })
    expect(inner.match(/表注仅在表末/g)).toHaveLength(1)
  })

  it('首段表题之前（含前置 keepNext 标题）不写 pageBreakBefore，只有续表题段换页', () => {
    const ctx = context()
    // 表前是 keepNext 的章标题：它与表题段（keepNext）、首段表格行形成同页链，由 Word 自然推移。
    const heading = emitParagraph(ctx, 'SesChapter', {
      runsXml: '<w:r><w:t>章标题</w:t></w:r>', numbered: { nodeId: 'chapter', kind: 'chapter' },
    })
    const xml = heading + renderBlock(ctx, table(longRows()), { scopeKey: 'chapter' })
    expect(xml.slice(0, xml.indexOf('<w:tbl>'))).not.toContain('pageBreakBefore')
    const stats = pageBreakStats(xml)
    expect(stats.all).toBe(stats.continuationCaptions)
    expect(stats.all).toBe(stats.onContinuationCaption)
    expect(stats.all).toBeGreaterThan(0)
  })
})

describe('相邻顶层表：表题段把两表隔开，不输出空段', () => {
  const second = (overrides: Partial<IRTable> = {}): IRTable => ({ ...table([row(1)]), id: 'second', ...overrides })

  it('页位置已知：长表 + 长表 + 短表连续输出，任意 w:tbl 之前都紧邻表题/续表题段，没有空 SesNormal', () => {
    const xml = renderBlocks(context(), [
      withNote(table(longRows())), { ...withNote(table(longRows())), id: 'second' }, { ...table([row(1)]), id: 'third' },
    ], { scopeKey: 'chapter' })
    expect(xml).not.toContain('</w:tbl><w:tbl>')
    expect(xml).not.toMatch(EMPTY_SEPARATOR)
    expect(xml).not.toContain('SesNormal')
    expect(xml).not.toContain('w:type="page"')
    const seq = topLevel(xml)
    expect(seq.filter((name) => name === 'w:tbl').length).toBeGreaterThan(3)
    seq.forEach((name, index) => {
      if (name === 'w:tbl') expect(seq[index - 1]).toBe('w:p')
      if (name === 'w:p') expect(seq[index + 1]).toBe('w:tbl') // 除表题/续表题外没有别的段落
    })
    // 表注之后紧接下一张表的表题（无 pageBreakBefore）：</w:tbl> 后第一个元素就是 SesTblCap 段。
    expect(xml).toContain('表注仅在表末。')
    expect(xml.match(/<\/w:tbl><w:p><w:pPr><w:pStyle w:val="SesTblCap"\/><\/w:pPr>/g)).toHaveLength(2)
    const stats = pageBreakStats(xml)
    expect(stats.all).toBe(stats.continuationCaptions)
    expect(stats.all).toBe(stats.onContinuationCaption)
  })

  it('无题（题注为空）的表同样输出自己的表题段，仍把相邻两表隔开', () => {
    const ctx = context()
    const xml = renderBlocks(ctx, [
      table([row(1)], { caption: [] }), second({ caption: [] }),
    ], { scopeKey: 'chapter' })
    expect(xml).not.toContain('</w:tbl><w:tbl>')
    expect(xml).not.toMatch(EMPTY_SEPARATOR)
    expect(xml).toContain('</w:tbl><w:p><w:pPr><w:pStyle w:val="SesTblCap"/></w:pPr></w:p><w:tbl>')
    expect(topLevel(xml)).toEqual(['w:p', 'w:tbl', 'w:p', 'w:tbl'])
    expect(ctx.numbered.filter((item) => item.kind === 'table').map((item) => item.nodeId)).toEqual(['table', 'second'])
  })

  it('单元格内嵌套的相邻表：每张嵌套表同样先输出自己的表题段，单元格内也不出现 </w:tbl><w:tbl>', () => {
    const outer = table([row(1)])
    const nested = (id: string): IRTable => ({ ...table([row(1)]), id })
    outer.rows[1]!.cells[1]!.content = [nested('inner-a'), nested('inner-b')]
    const xml = renderBlock(context(), outer, { scopeKey: 'chapter' })
    expect(xml.match(/<w:tbl>/g)).toHaveLength(3)
    expect(xml).not.toContain('</w:tbl><w:tbl>')
    expect(xml).not.toMatch(EMPTY_SEPARATOR)
    expect(xml.match(/w:pStyle w:val="SesTblCap"/g)).toHaveLength(3)
  })

  it('横排相邻表：表题、表、表注都在同一个横排节内，之间没有空段', () => {
    const xml = renderBlocks(context(), [
      table([row(1)], { orientation: 'landscape' }), second({ orientation: 'landscape' }),
    ], { scopeKey: 'chapter' })
    expect(xml.startsWith(LANDSCAPE_START)).toBe(true)
    expect(xml.endsWith(LANDSCAPE_END)).toBe(true)
    const text = xml.replaceAll(LANDSCAPE_START, '').replaceAll(LANDSCAPE_END, '')
    expect(text).not.toContain('</w:tbl><w:tbl>')
    expect(text).not.toMatch(EMPTY_SEPARATOR)
    expect(topLevel(text)).toEqual(['w:p', 'w:tbl', 'w:p', 'w:tbl'])
  })
})

describe('B1：位置已知时首段之前不写强制分页', () => {
  it('旧页余量放不下首段：首段整段 keepNext 让 Word 推移，表题不写 pageBreakBefore，页流仍记为新页起排', () => {
    const ctx = context()
    ctx.pageFlow.placeTable([225], false) // 旧页只剩约 13 mm
    const xml = renderBlock(ctx, withNote(table(longRows())), { scopeKey: 'chapter' })
    const tables = elements(parse(xml), 'w:tbl')
    expect(tables.length).toBeGreaterThan(1)
    // 首段（表题段与首个 w:tbl）之前、之内都没有 pageBreakBefore；只有每个续表题段换页，没有 w:br page。
    expect(xml.slice(0, xml.indexOf('<w:tbl>'))).not.toContain('pageBreakBefore')
    expect(pageBreakStats(xml)).toEqual({
      all: tables.length - 1, onContinuationCaption: tables.length - 1, continuationCaptions: tables.length - 1,
    })
    expect(xml).not.toContain('w:type="page"')
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
    expect(xml).not.toContain('SesAppTblCapCont')
    expect(xml).not.toContain('<!--ses-')
    expect(xml).not.toContain('</w:tbl><w:tbl>')
    expect(xml).not.toMatch(EMPTY_SEPARATOR)
    // 唯一的拆段来自横排长表（横排节从新页起排，页位置重新已知）：每个续段一个续表题段，
    // pageBreakBefore 只出现在续表题段上（自然分页的竖排表之前没有任何强制分页），没有 w:br page。
    const continuations = xml.match(/SesTblCapCont/g)?.length ?? 0
    expect(continuations).toBeGreaterThan(0)
    expect(pageBreakStats(xml)).toEqual({ all: continuations, onContinuationCaption: continuations, continuationCaptions: continuations })
    expect(xml).not.toContain('w:type="page"')
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
    expect(xml).toContain('SesTblCapCont')
    expect(xml).toContain('SesAppTblCapCont')
    // 续表题段各自换页（至少 3 个），其余位置没有任何 pageBreakBefore；不再有 w:br page 与空分隔段。
    const stats = pageBreakStats(xml)
    expect(stats.all).toBeGreaterThanOrEqual(3)
    expect(stats.all).toBe(stats.continuationCaptions)
    expect(stats.all).toBe(stats.onContinuationCaption)
    expect(xml).not.toContain('w:type="page"')
    // 相邻的第一/第二张长表由表题段隔开：不出现 </w:tbl><w:tbl>，也不出现普通空段。
    expect(xml).not.toContain('</w:tbl><w:tbl>')
    expect(xml).not.toMatch(EMPTY_SEPARATOR)
    expect(pkg.warnings.map((w) => w.code)).not.toContain('table-flow-natural-fallback')
    expect(() => assertWellFormed(pkg)).not.toThrow()
    expect(() => assertChildOrder(pkg)).not.toThrow()
    expect(() => assertNumberingIntegrity(pkg)).not.toThrow()
    expect(() => assertNumberingConsistency(pkg, numbered, labels, new Map())).not.toThrow()
  })

  it('位置未知：自然排法下表脚注与表注只在表末输出一次，不被拆分', () => {
    const doc = footnoteFixture()
    doc.body[0]!.children.unshift({ kind: 'formula', id: 'formula-1', latex: 'x=1', numbered: false, whereList: [] })
    const { labels } = resolve(doc)
    const { pkg } = renderDocxTraced(doc, labels, OPTIONS)
    const xml = pkg.parts['word/document.xml']!
    // 自然排法与拆分排法一样，表题都在 w:tbl 之外。
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
    // 自然分页的竖排表前后没有强制分页；pageBreakBefore 只出现在横排/附录长表的续表题段上。
    const stats = pageBreakStats(xml)
    expect(stats.all).toBe(stats.continuationCaptions)
    expect(stats.all).toBe(stats.onContinuationCaption)
    expect(xml).not.toContain('w:type="page"')
    const fallback = pkg.warnings.filter((w) => w.code === 'table-flow-natural-fallback')
    expect(fallback.map((w) => w.nodeId)).toEqual(['table-a', 'table-b'])
    expect(fallback.map((w) => w.label)).toEqual([labels['table-a']!.label, labels['table-b']!.label])
    // 横排长表所在的横排节从新页开始，页位置重新已知；附录是新节，同样已知。
    expect(xml.match(/SesTblCapCont/g)).toBeTruthy()
    expect(xml).toContain('SesAppTblCapCont')
  })
})
