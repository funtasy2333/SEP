import { describe, expect, it } from 'vitest'
import type { IRTable, IRTableRow } from '../../../ir/types'
import { renderBlock } from './block'
import { createRenderContext, emitParagraph } from './context'
import { paginateTable } from './tablePagination'

function row(index: number, description = '用于检查跨页表题与标题行重复。'): IRTableRow {
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

function table(rows: IRTableRow[]): IRTable {
  return {
    kind: 'table', id: 'table', caption: [{ text: '跨页表' }], orientation: 'portrait',
    headerRowCount: 1,
    rows: [{
      id: 'header',
      cells: [{ id: 'header-cell', colspan: 2, rowspan: 1, header: true,
        content: [{ kind: 'paragraph', id: 'header-p', content: [{ text: '表头' }] }] }],
    }, ...rows],
    notes: [],
  }
}

describe('paginateTable', () => {
  it('小表保持一段，长表优先填满前页且每个数据行恰好出现一次', () => {
    const short = paginateTable(table([row(1), row(2)]))
    expect(short.bodySegments).toHaveLength(1)
    expect(short.startOnNewPage).toBe(false)

    const rows = Array.from({ length: 64 }, (_, index) => row(index + 1))
    const paginated = paginateTable(table(rows))
    expect(paginated.bodySegments.length).toBeGreaterThan(1)
    expect(paginated.bodySegments).toHaveLength(2)
    const lengths = paginated.bodySegments.map((segment) => segment.length)
    expect(lengths[0]).toBeGreaterThan(lengths[1]!)
    expect(paginated.startOnNewPage).toBe(true)
    expect(paginated.oversizedGroup).toBe(false)
    expect(paginated.bodySegments.flat().map((item) => item.id)).toEqual(rows.map((item) => item.id))
  })

  it('70条短记录和合并行、表注、两条脚注用两页，前页至少容纳40条记录', () => {
    const merged = [row(0), row(-1), row(-2), row(-3)]
    merged[2]!.cells[0]!.rowspan = 2
    const records = Array.from({ length: 70 }, (_, index) => row(index + 1, '数据保持，表注与定义只在末段出现。'))
    const ir = table([...merged, ...records])
    ir.notes = [{ kind: 'note', id: 'note', content: [{ kind: 'paragraph', id: 'note-p', content: [{ text: '测试表注内容。' }] }] }]
    ir.footnotes = [{ id: 'a', content: [{ text: '定义B：首次引用应为上标a。' }] },
      { id: 'b', content: [{ text: '定义A：第二次首次引用；重复调用只保留本条定义。' }] }]
    const result = paginateTable(ir)
    expect(result.bodySegments).toHaveLength(2)
    expect(result.bodySegments[0]!.filter(item => records.includes(item)).length).toBeGreaterThanOrEqual(40)
    expect(result.bodySegments.flat()).toEqual([...merged, ...records])
  })

  it('末页表脚注的空间只从末页扣除，不削减前页容量', () => {
    const ir = table(Array.from({ length: 110 }, (_, index) => row(index + 1)))
    const plain = paginateTable(ir)
    ir.footnotes = Array.from({ length: 8 }, (_, index) => ({ id: `fn-${index}`, content: [{ text: '短脚注' }] }))
    const withFootnotes = paginateTable(ir)
    expect(withFootnotes.bodySegments).toHaveLength(3)
    expect(withFootnotes.bodySegments[0]).toEqual(plain.bodySegments[0])
    expect(withFootnotes.bodySegments[1]).toEqual(plain.bodySegments[1])
    expect(withFootnotes.bodySegments.flat()).toEqual(ir.rows.slice(1))
  })

  it('单元格显式换行计入行高，不能按一行文字挤入同一页', () => {
    const plain = table(Array.from({ length: 30 }, (_, index) => row(index + 1, '甲乙丙丁')))
    const multiline = table(Array.from({ length: 30 }, (_, index) => row(index + 1, '甲\n乙\n丙\n丁')))
    expect(paginateTable(plain).bodySegments).toHaveLength(1)
    expect(paginateTable(multiline).bodySegments.length).toBeGreaterThan(1)
  })

  it('公式使页位置未知后，短表整体保留且不写强制分页、不告警；位置继续未知', () => {
    const ir = table([row(1), row(2)])
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    ctx.pageFlow.startSection()
    ctx.pageFlow.recordParagraph('SesFormula', '<m:oMath/>', false)
    const xml = renderBlock(ctx, ir, { scopeKey: 'chapter' })
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml).not.toContain('w:type="page"')
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(ctx.warnings.filter(warning => warning.code.startsWith('table-'))).toEqual([])
    // 没有任何强制分页能重新锚定页位置：直到下一节或横竖切换前都保持未知。
    expect(ctx.pageFlow.availableMm).toBeUndefined()
    expect(ctx.pageFlow.estimateUnavailable).toBe(true)
    const known = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    known.pageFlow.startSection()
    expect(renderBlock(known, ir, { scopeKey: 'chapter' })).not.toContain('<w:pageBreakBefore/>')
  })

  it('公式使页位置未知后，长表整表退回自然分页：单表、无硬分页、无续表题，并带表号告警', () => {
    const labels = {
      table: { label: '表1', xmlId: 'table_1', refText: '表1' },
      'second-table': { label: '表2', xmlId: 'table_2', refText: '表2' },
    }
    const rows = Array.from({ length: 70 }, (_, i) => row(i + 1, '短记录'))
    const ctx = createRenderContext(labels)
    ctx.pageFlow.startSection()
    ctx.pageFlow.recordParagraph('SesFormula', '<m:oMath/>', false)
    const xml = renderBlock(ctx, table(rows), { scopeKey: 'chapter' })
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml).not.toContain('w:type="page"')
    expect(xml).not.toContain('SesTblCapCont')
    expect(xml).not.toContain('（续）')
    expect(xml.match(/项目 \d+/g)).toHaveLength(70)
    expect(ctx.warnings.filter(warning => warning.code === 'table-flow-natural-fallback')).toEqual([
      expect.objectContaining({ nodeId: 'table', label: '表1', message: expect.stringContaining('表1') }),
    ])
    expect(ctx.warnings.map(warning => warning.code)).not.toContain('table-flow-estimate-unavailable')
    // 位置继续未知：同节后续长表同样退回自然分页，各自带自己的表号。
    const second = { ...table(rows), id: 'second-table' }
    const secondXml = renderBlock(ctx, second, { scopeKey: 'chapter' })
    expect(secondXml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(ctx.warnings.filter(warning => warning.code === 'table-flow-natural-fallback').map(warning => warning.label))
      .toEqual(['表1', '表2'])
    // 位置已知的同一张长表仍按估算拆分并写“（续）”。
    const known = createRenderContext(labels)
    known.pageFlow.startSection()
    const knownXml = renderBlock(known, table(rows), { scopeKey: 'chapter' })
    expect(knownXml.match(/<w:tbl>/g)!.length).toBeGreaterThan(1)
    expect(knownXml).toContain('（续）')
    expect(known.warnings.map(warning => warning.code)).not.toContain('table-flow-natural-fallback')
  })

  it('完整短表能放入旧页时，不因首行额外10mm余量将标题链移页', () => {
    const ir = table([row(1), row(2)])
    const result = paginateTable(ir, { firstPageHeightMm: 24, firstPageReservedMm: 11 })
    expect(result.segmentHeightsMm[0]).toBeCloseTo(21.2)
    expect(result.startOnNewPage).toBe(false)
    expect(result.bodySegments).toEqual([ir.rows.slice(1)])
  })
  it('留在旧页的标题和短表不会虚增后续长表余量', () => {
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    ctx.pageFlow.startSection()
    ctx.pageFlow.recordParagraph('SesClause1', '<w:r><w:t>表前条标题</w:t></w:r>', true)
    const reserved = ctx.pageFlow.beforeTable().firstPageReservedMm!
    // Arrange exactly 24mm after the heading on the current page.
    const near = createRenderContext(ctx.labels); near.pageFlow.startSection()
    near.pageFlow.placeTable([238 - reserved - 24], false)
    near.pageFlow.recordParagraph('SesClause1', '<w:r><w:t>表前条标题</w:t></w:r>', true)
    renderBlock(near, table([row(1), row(2)]), { scopeKey: 'chapter' })
    expect(near.pageFlow.availableMm).toBeCloseTo(24 - 21.2)
    // 相邻表之间没有分隔空段（下一张表前面就是它自己的表题段，其高度计入表段高度），所以后表的首段预算
    // 就是旧页真实余量；标题和短表不会被记到下一页，余量既不缩水也不虚增。
    const nextBudget = near.pageFlow.beforeTable()
    expect(nextBudget.firstPageHeightMm).toBeCloseTo(24 - 21.2)
    const long = table(Array.from({ length: 93 }, (_, i) => row(i + 1, '短记录')))
    expect(paginateTable(long, nextBudget).bodySegments).toHaveLength(2)
  })
  it('允许跨页的脚注正文位置未知时，后续长表退回自然分页而不写强制分页', () => {
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    ctx.pageFlow.startSection(); ctx.pageFlow.setFootnoteHeights(new Map([[1, 12]]))
    ctx.pageFlow.placeTable([200], false)
    const runs = Array.from({ length: 12 }, (_, i) => `<w:r><w:t>脚注正文第${i+1}行</w:t></w:r>`)
      .join('<w:r><w:br/></w:r>') + '<w:r><w:footnoteReference w:id="1"/></w:r>'
    const paragraph = emitParagraph(ctx, 'SesPara', { runsXml: runs })
    expect(paragraph).not.toContain('<w:keepLines')
    expect(paragraph).not.toContain('<w:pageBreakBefore')
    expect(ctx.pageFlow.availableMm).toBeUndefined()
    const ir = table(Array.from({ length: 70 }, (_, i) => row(i+1, '短记录')))
    const xml = renderBlock(ctx, ir, { scopeKey: 'chapter' })
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml).not.toContain('w:type="page"')
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(ctx.warnings.map(w => w.code)).toContain('table-flow-natural-fallback')
    expect(ctx.warnings.map(w => w.code)).not.toContain('table-flow-estimate-unavailable')
    expect(xml.match(/项目 \d+/g)).toHaveLength(70)
    // 没有强制分页重新锚定，页位置继续未知。
    expect(ctx.pageFlow.availableMm).toBeUndefined()
    expect(ctx.pageFlow.estimateUnavailable).toBe(true)
  })
  it('标题与可跨页长正文后的表格退回自然分页，不猜测旧页余量也不写强制分页', () => {
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    ctx.pageFlow.startSection(); ctx.pageFlow.placeTable([180], false)
    emitParagraph(ctx, 'SesChapter', { runsXml: '<w:r><w:t>章标题</w:t></w:r>', numbered: { nodeId: 'chapter', kind: 'chapter' } })
    const runs = Array.from({ length: 12 }, (_, i) => `<w:r><w:t>链末正文第${i + 1}行</w:t></w:r>`)
      .join('<w:r><w:br/></w:r>')
    const paragraph = emitParagraph(ctx, 'SesPara', { runsXml: runs })
    expect(paragraph).not.toContain('<w:keepLines')
    expect(paragraph).not.toContain('<w:pageBreakBefore')
    const xml = renderBlock(ctx, table(Array.from({ length: 70 }, (_, i) => row(i + 1, '短记录'))), { scopeKey: 'chapter' })
    expect(xml).not.toContain('pageBreakBefore')
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1)
    expect(ctx.warnings.map(w => w.code)).toContain('table-flow-natural-fallback')
    expect(xml.match(/项目 \d+/g)).toHaveLength(70)
    expect(ctx.pageFlow.availableMm).toBeUndefined()
  })
  it.each([12, 2])('直接接表的%s行可拆分标题在首段移页时不写任何强制分页，由 keepNext 让 Word 自然推移', count => {
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    ctx.pageFlow.startSection(); ctx.pageFlow.placeTable([count === 12 ? 180 : 200], false)
    const heading = emitParagraph(ctx, 'SesChapter', {
      runsXml: Array.from({ length: count }, (_, i) => `<w:r><w:t>长标题第${i + 1}行</w:t></w:r>`).join('<w:r><w:br/></w:r>'),
      numbered: { nodeId: 'long-chapter', kind: 'chapter' },
    })
    const ir = table(Array.from({ length: count === 12 ? 70 : 2 }, (_, i) => row(i + 1, '短记录')))
    const xml = heading + renderBlock(ctx, ir, { scopeKey: 'chapter' })
    // 链首与表题都不写 pageBreakBefore（只有长表的续表题段换页）；链仍是 keepNext（标题、表题、表格行），页位置保持已知。
    expect(xml.slice(0, xml.indexOf('<w:tbl>'))).not.toContain('pageBreakBefore')
    expect(xml.match(/<w:pageBreakBefore\/>/g)?.length ?? 0).toBe(xml.match(/w:pStyle w:val="SesTblCapCont"/g)?.length ?? 0)
    expect(xml).not.toContain('<!--ses-')
    expect(xml.match(/项目 \d+/g)).toHaveLength(count === 12 ? 70 : 2)
    expect(ctx.warnings.map(w => w.code)).not.toContain('table-flow-natural-fallback')
    expect(ctx.pageFlow.availableMm).toBeDefined()
  })
  it('嵌套表格不参与外层页流：整表输出、不拆分，也不影响外层待定标题链', () => {
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    ctx.pageFlow.startSection()
    const heading = emitParagraph(ctx, 'SesChapter', {
      runsXml: '<w:r><w:t>第一行标题</w:t><w:br/><w:t>第二行标题</w:t></w:r>',
      numbered: { nodeId: 'chapter', kind: 'chapter' },
    })
    const remaining = ctx.pageFlow.availableMm
    const nested = ctx.pageFlow.suspend(() => renderBlock(ctx, table(Array.from({ length: 70 }, (_, i) => row(i + 1, '短记录'))), { scopeKey: 'cell' }))
    expect(heading).not.toContain('pageBreakBefore')
    // 单元格内不能出现整页硬分页：嵌套的长表保持一个 w:tbl。
    expect(nested.match(/<w:tbl>/g)).toHaveLength(1)
    expect(nested).not.toContain('w:type="page"')
    expect(nested).not.toContain('pageBreakBefore')
    expect(ctx.pageFlow.availableMm).toBe(remaining)
  })
  it('标题与短表一起移页后，后续余量包含标题高度', () => {
    const ir=table([row(1),row(2)])
    const contexts=[createRenderContext({table:{label:'表1',xmlId:'table_1',refText:'表1'}}),createRenderContext({table:{label:'表1',xmlId:'table_1',refText:'表1'}})]
    const [near,fresh]=contexts
    for(const ctx of contexts)ctx.pageFlow.startSection()
    near!.pageFlow.placeTable([200],false)
    for(const ctx of contexts){
      ctx.pageFlow.recordParagraph('SesChapter','<w:r><w:t>表前章标题</w:t></w:r>',true)
      ctx.pageFlow.recordParagraph('SesClause1','<w:r><w:t>表前条标题</w:t></w:r>',true)
      expect(renderBlock(ctx,ir,{scopeKey:'chapter'})).not.toContain('<w:pageBreakBefore/>')
    }
    expect(near!.pageFlow.availableMm).toBeCloseTo(fresh!.pageFlow.availableMm!,6)
    expect(near!.pageFlow.availableMm).toBeLessThan(200)
  })
  it('标题链移到新页的长表首段为标题预留空间，续段恢复完整预算', () => {
    const ctx=createRenderContext({table:{label:'表1',xmlId:'table_1',refText:'表1'}})
    ctx.pageFlow.startSection();ctx.pageFlow.placeTable([200],false)
    ctx.pageFlow.recordParagraph('SesChapter','<w:r><w:t>章标题</w:t></w:r>',true)
    ctx.pageFlow.recordParagraph('SesClause1','<w:r><w:t>条标题</w:t></w:r>',true)
    const xml=renderBlock(ctx,table(Array.from({length:110},(_,i)=>row(i+1,'短记录'))),{scopeKey:'chapter'})
    // 首段之前（表题段）不写 pageBreakBefore；每个续表题段各一个。
    expect(xml.slice(0, xml.indexOf('<w:tbl>'))).not.toContain('<w:pageBreakBefore/>')
    expect(xml.match(/<w:pageBreakBefore\/>/g)?.length ?? 0).toBe((xml.match(/<w:tbl>/g)?.length ?? 0) - 1)
    const counts=[...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(m=>(m[1]!.match(/<w:t(?:[^>]*)>项目 \d+<\/w:t>/g)??[]).length)
    expect(counts[0]).toBeLessThan(counts[1]!)
    expect(counts.reduce((a,b)=>a+b,0)).toBe(110)
  })
  it('高表头与表尾组合放不下时保留数据且明确警告，不虚构末段数据预算', () => {
    const ir = table([row(1)])
    const header = ir.rows[0]!
    ir.rows = [...Array.from({ length: 6 }, (_, index) => ({ ...header, id: `header-${index}`,
      cells: header.cells.map(cell => ({ ...cell, id: `${cell.id}-${index}`, content: [
        { kind: 'paragraph' as const, id: `header-p-${index}`, content: [{ text: '表头\n第二行' }] },
      ] })) })), ...ir.rows.slice(1)]
    ir.headerRowCount = 6
    ir.notes = [{ kind: 'note', id: 'note', content: [{ kind: 'paragraph', id: 'note-p', content: [
      { text: Array.from({ length: 46 }, () => '表注').join('\n') },
    ] }] }]
    const result = paginateTable(ir)
    expect(result.footerTooTall).toBe(true)
    expect(result.oversizedGroup).toBe(false)
    expect(result.finalSegmentOverflow).toBe(false)
    expect(result.bodySegments.flat()).toEqual(ir.rows.slice(6))
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    renderBlock(ctx, ir, { scopeKey: 'chapter' })
    expect(ctx.warnings.map(warning => warning.code)).toContain('table-footer-too-tall')
  })

  it('普通末行只因表尾占用而放不下时，独立提示末段组合风险，不归咎于行过高', () => {
    const ir = table([row(1)])
    ir.notes = [{ kind: 'note', id: 'note', content: [{ kind: 'paragraph', id: 'p', content: [
      { text: Array.from({ length: 50 }, () => '表注').join('\n') },
    ] }] }]
    const result = paginateTable(ir)
    expect(result.footerTooTall).toBe(false)
    expect(result.oversizedGroup).toBe(false)
    expect(result.finalSegmentOverflow).toBe(true)
    const ctx = createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } })
    renderBlock(ctx, ir, { scopeKey: 'chapter' })
    expect(ctx.warnings.map(warning => warning.code)).toContain('table-final-segment-too-tall')
    expect(ctx.warnings.map(warning => warning.code)).not.toContain('table-row-too-tall')
  })

  it('末页不足30mm时使用实际余量切分，能够排入的组合不应溢出', () => {
    const ir = table(Array.from({ length: 10 }, (_, index) => row(index + 1)))
    const header = ir.rows[0]!
    ir.rows = [...Array.from({ length: 6 }, (_, index) => ({ ...header, id: `header-${index}`,
      cells: header.cells.map(cell => ({ ...cell, content: [
        { kind: 'paragraph' as const, id: `header-p-${index}`, content: [{ text: '表头\n第二行' }] },
      ] })) })), ...ir.rows.slice(1)]
    ir.headerRowCount = 6
    ir.notes = [{ kind: 'note', id: 'note', content: [{ kind: 'paragraph', id: 'note-p', content: [
      { text: Array.from({ length: 36 }, () => '表注').join('\n') },
    ] }] }]
    const result = paginateTable(ir)
    expect(result.segmentHeightsMm.every(height => height <= 225)).toBe(true)
    expect(result.bodySegments[result.bodySegments.length - 1]!.length).toBeLessThanOrEqual(2)
    expect(result.footerTooTall).toBe(false)
    expect(result.oversizedGroup).toBe(false)
    expect(result.bodySegments.flat()).toEqual(ir.rows.slice(6))
  })

  it('首段按正文页140mm余量切分，不再整体移到下一页', () => {
    const rows = Array.from({ length: 70 }, (_, index) => row(index + 1))
    const result = paginateTable(table(rows), { firstPageHeightMm: 140 })
    expect(result.startOnNewPage).toBe(false)
    expect(result.bodySegments).toHaveLength(2)
    expect(result.bodySegments[0]!.length).toBeGreaterThanOrEqual(25)
    expect(result.bodySegments[0]!.length).toBeLessThanOrEqual(29)
    expect(result.bodySegments.flat()).toEqual(rows)
  })

  it('余量不足放下表题表头及首组时，完整首组移至下一页且不生成空续段', () => {
    const rows = Array.from({ length: 70 }, (_, index) => row(index + 1))
    const result = paginateTable(table(rows), { firstPageHeightMm: 10 })
    expect(result.startOnNewPage).toBe(true)
    expect(result.bodySegments[0]!.length).toBeGreaterThanOrEqual(40)
    expect(result.bodySegments.every(segment => segment.length > 0)).toBe(true)
    expect(result.bodySegments.flat()).toEqual(rows)
  })

  it('整表虽能放入完整一页，仍可利用正文页余量起排', () => {
    const rows = Array.from({ length: 30 }, (_, index) => row(index + 1))
    const result = paginateTable(table(rows), { firstPageHeightMm: 100 })
    expect(result.startOnNewPage).toBe(false)
    expect(result.bodySegments).toHaveLength(2)
    expect(result.bodySegments[0]!.length).toBeLessThan(30)
    expect(result.bodySegments.flat()).toEqual(rows)
  })

  it('表头跨到数据行的合并组不能被首段余量切断', () => {
    const ir = table(Array.from({ length: 70 }, (_, index) => row(index + 1)))
    ir.rows[0]!.cells[0]!.rowspan = 3
    const result = paginateTable(ir, { firstPageHeightMm: 28 })
    expect(result.startOnNewPage).toBe(true)
    expect(result.bodySegments[0]!.slice(0, 2).map(r => r.id)).toEqual(['row-1', 'row-2'])
  })

  it('只剩一个不可分组且表尾放不下时，不生成只有表头表注的续段', () => {
    const ir = table([row(1), row(2)])
    ir.rows[1]!.cells[0]!.rowspan = 2
    ir.notes = [{ kind: 'note', id: 'note', content: [{ kind: 'paragraph', id: 'p', content: [{ text: '表注' }] }] }]
    ir.footnotes = [{ id: 'fn1', content: [{ text: '脚注'.repeat(100) }] }, { id: 'fn2', content: [{ text: '脚注'.repeat(100) }] }]
    const result = paginateTable(ir, { firstPageHeightMm: 40 })
    expect(result.bodySegments).toHaveLength(1)
    expect(result.bodySegments[0]).toEqual(ir.rows.slice(1))
    expect(result.startOnNewPage).toBe(true)
  })

  it('正文页先排26条时，一条短表注不会把最后一条记录挤到第三页', () => {
    const ir = table(Array.from({ length: 70 }, (_, index) => row(index + 1)))
    ir.notes = [{ kind: 'note', id: 'note', content: [{ kind: 'paragraph', id: 'p', content: [{ text: '表注仅在末段。' }] }] }]
    const result = paginateTable(ir, { firstPageHeightMm: 139 })
    expect(result.bodySegments).toHaveLength(2)
    expect(result.bodySegments[1]!.length).toBeGreaterThan(35)
  })

  it('仅超出一页少量时，末段至少保留三行，不能只剩一条记录', () => {
    const result = paginateTable(table(Array.from({ length: 49 }, (_, index) => row(index + 1))))
    expect(result.bodySegments).toHaveLength(2)
    expect(result.bodySegments[result.bodySegments.length - 1]!.length).toBeGreaterThanOrEqual(3)
  })

  it('较长表题占用首段空间，不能按单行表题塞入同样数量的记录', () => {
    const normal = table(Array.from({ length: 70 }, (_, index) => row(index + 1)))
    const long = { ...normal, caption: [{ text: '长表题'.repeat(40) }] }
    const brief = paginateTable(normal, { firstPageHeightMm: 140 })
    const titled = paginateTable(long, { firstPageHeightMm: 140 })
    expect(titled.bodySegments[0]!.length).toBeLessThan(brief.bodySegments[0]!.length)
    expect(titled.bodySegments.flat()).toEqual(normal.rows.slice(1))
  })

  it('跨行合并覆盖的行留在同一表段', () => {
    const rows = Array.from({ length: 60 }, (_, index) => row(index + 1))
    rows[18]!.cells[0]!.rowspan = 2
    const paginated = paginateTable(table(rows))
    const segment = paginated.bodySegments.find((part) => part.some((item) => item.id === 'row-19'))
    expect(segment?.some((item) => item.id === 'row-20')).toBe(true)
  })

  it('高低不同行交错时，切分不把末段挤过单页预算', () => {
    const uneven = [row(1, 'x'.repeat(1530)), row(2, 'x'.repeat(400)),
      row(3, 'x'.repeat(2580)), row(4, 'x'.repeat(660))]
    const segments = paginateTable(table(uneven)).bodySegments
    expect(segments.map((part) => part.map((item) => item.id))).toEqual([
      ['row-1', 'row-2'], ['row-3'], ['row-4'],
    ])
  })

  it('单组内容超出单页预算时显式标记人工分页风险', () => {
    const huge = row(1, '多行内容。'.repeat(1000))
    const paginated = paginateTable(table([huge, row(2)]))
    expect(paginated.oversizedGroup).toBe(true)
    expect(paginated.bodySegments[0]?.[0]?.id).toBe('row-1')
  })

  it('只有表头的超高表格也保留一段空数据行', () => {
    const headerOnly = table([])
    headerOnly.rows[0]!.cells[0]!.content = [{
      kind: 'paragraph', id: 'tall-header', content: [{ text: '很长的表头'.repeat(500) }],
    }]
    const paginated = paginateTable(headerOnly)
    expect(paginated.bodySegments).toEqual([[]])
    expect(renderBlock(createRenderContext({ table: { label: '表1', xmlId: 'table_1', refText: '表1' } }),
      headerOnly, { scopeKey: 'chapter' })).toContain('<w:tbl>')
  })

  it('续段另起页并写相同表号和表题加“（续）”，编号属主只出现一次', () => {
    const ir = table(Array.from({ length: 64 }, (_, index) => row(index + 1)))
    const ctx = createRenderContext({
      table: { label: '表3', xmlId: 'table_3', refText: '表3' },
    })
    const xml = renderBlock(ctx, ir, { scopeKey: 'chapter' })
    const segments = (xml.match(/<w:tbl>/g) ?? []).length
    expect(segments).toBeGreaterThan(1)
    expect((xml.match(/w:pStyle w:val="SesTblCap"/g) ?? [])).toHaveLength(1)
    expect((xml.match(/w:pStyle w:val="SesTblCapCont"/g) ?? [])).toHaveLength(segments - 1)
    expect((xml.match(/表3　/g) ?? [])).toHaveLength(segments - 1)
    expect((xml.match(/（续）/g) ?? [])).toHaveLength(segments - 1)
    // 续段另起页由续表题段的 pageBreakBefore 实现，不再有 w:br page 的空分隔段。
    expect((xml.match(/<w:pStyle w:val="SesTblCapCont"\/><w:pageBreakBefore\/>/g) ?? [])).toHaveLength(segments - 1)
    expect((xml.match(/<w:pageBreakBefore\/>/g) ?? [])).toHaveLength(segments - 1)
    expect(xml).not.toContain('w:type="page"')
    expect(xml).not.toContain('SesNormal')
    expect(ctx.numbered.filter((item) => item.kind === 'table')).toEqual([{ nodeId: 'table', kind: 'table' }])
  })
})

it('窄自定义列的折行会减少每段数据行数，所有续表沿用原列宽', () => {
  const ir = table(Array.from({length:40},(_,i)=>row(i+1,'长文字重复'.repeat(6))))
  const equal=paginateTable(ir)
  // 只有首个数据行带列宽；续段表头及其他行均不携带该数据。
  ir.rows[1]!.cells[0]!.columnWidths=[400]
  ir.rows[1]!.cells[1]!.columnWidths=[70]
  const narrow=paginateTable(ir)
  expect(narrow.bodySegments.length).toBeGreaterThan(equal.bodySegments.length)
  expect(narrow.bodySegments.flat()).toEqual(ir.rows.slice(1))
  const ctx=createRenderContext({table:{label:'表1',xmlId:'table_1',refText:'表1'}})
  const xml=renderBlock(ctx,ir,{scopeKey:'chapter'})
  const grids=[...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)].map(m=>m[1])
  expect(grids.length).toBeGreaterThan(1)
  expect(new Set(grids).size).toBe(1)
  expect(grids[0]).toBe('<w:gridCol w:w="6000"/><w:gridCol w:w="1050"/>')
})
