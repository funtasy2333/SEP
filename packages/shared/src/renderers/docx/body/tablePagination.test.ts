import { describe, expect, it } from 'vitest'
import type { IRTable, IRTableRow } from '../../../ir/types'
import { renderBlock } from './block'
import { createRenderContext } from './context'
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
  it('小表保持一段，长表逐页分段且每个数据行恰好出现一次', () => {
    const short = paginateTable(table([row(1), row(2)]))
    expect(short.bodySegments).toHaveLength(1)
    expect(short.startOnNewPage).toBe(false)

    const rows = Array.from({ length: 64 }, (_, index) => row(index + 1))
    const paginated = paginateTable(table(rows))
    expect(paginated.bodySegments.length).toBeGreaterThan(1)
    expect(paginated.bodySegments).toHaveLength(2)
    const lengths = paginated.bodySegments.map((segment) => segment.length)
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1)
    expect(paginated.startOnNewPage).toBe(true)
    expect(paginated.oversizedGroup).toBe(false)
    expect(paginated.bodySegments.flat().map((item) => item.id)).toEqual(rows.map((item) => item.id))
  })

  it('跨行合并覆盖的行留在同一表段', () => {
    const rows = Array.from({ length: 60 }, (_, index) => row(index + 1))
    rows[18]!.cells[0]!.rowspan = 2
    const paginated = paginateTable(table(rows))
    const segment = paginated.bodySegments.find((part) => part.some((item) => item.id === 'row-19'))
    expect(segment?.some((item) => item.id === 'row-20')).toBe(true)
  })

  it('高低不同行交错时，均衡切分不把末段挤过单页预算', () => {
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
    expect((xml.match(/<w:br w:type="page"\/>/g) ?? [])).toHaveLength(segments - 1)
    expect(ctx.numbered.filter((item) => item.kind === 'table')).toEqual([{ nodeId: 'table', kind: 'table' }])
  })
})
