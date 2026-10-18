import { describe, expect, it } from 'vitest'
import type { IRTable, IRTableRow } from '../../../ir/types'
import { findChild, parseXml, type XmlElement } from '../__tests__/helpers/xmlTree'
import { assertChildOrder } from '../__tests__/helpers/checks'
import { createRenderContext } from './context'
import { renderTableGrid, tableCellParagraphStyle, type IRTableCell } from './table'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function cell(id: string, text: string, span: Partial<IRTableCell> = {}): IRTableCell {
  return {
    id, colspan: 1, rowspan: 1, header: false,
    content: text === '' ? [] : [{ kind: 'paragraph', id: `${id}-p`, content: [{ text }] }],
    ...span,
  }
}

function table(overrides: Partial<IRTable> = {}): IRTable {
  const rows: IRTableRow[] = [
    {
      id: 'row-1',
      cells: [
        cell('merged', '合并表头', { colspan: 2, rowspan: 2, header: true }),
        cell('header-3', '列 3', { header: true }),
      ],
    },
    { id: 'row-2', cells: [cell('number-cell', '12.5')] },
  ]
  return {
    kind: 'table', id: 'table-1', caption: [], orientation: 'portrait', headerRowCount: 1,
    rows, notes: [], ...overrides,
  }
}

function render(tableIr: IRTable, notesXml?: string, footnotesXml?: string, strongTopBorder?: boolean): { xml: string; rendered: Array<{ cell: IRTableCell; style: string; row: number; col: number; header: boolean }> } {
  const rendered: Array<{ cell: IRTableCell; style: string; row: number; col: number; header: boolean }> = []
  const ctx = createRenderContext({})
  const xml = renderTableGrid(ctx, tableIr, {
    notesXml,
    footnotesXml,
    strongTopBorder,
    renderCell: (cellArg, style, meta) => {
      rendered.push({ cell: cellArg, style, row: meta.rowIndex, col: meta.columnIndex, header: meta.header })
      if (cellArg.content.length === 0) return ''
      return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${cellArg.id}</w:t></w:r></w:p>`
    },
  })
  return { xml, rendered }
}

function root(xml: string): XmlElement {
  return parseXml(`<w:root xmlns:w="${W_NS}">${xml}</w:root>`)
}

function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === 'element' && child.name === name)
}

describe('renderTableGrid', () => {
  it('扩展 colspan + rowspan 并在续行补齐带 gridSpan 的 vMerge 占位格', () => {
    const result = render(table())
    const tblEl = findChild(root(result.xml), 'w:tbl')!
    const rows = childrenNamed(tblEl, 'w:tr')
    expect(rows).toHaveLength(2)
    const firstRowCells = childrenNamed(rows[0]!, 'w:tc')
    const mergedPr = findChild(firstRowCells[0]!, 'w:tcPr')!
    expect(findChild(mergedPr, 'w:gridSpan')?.attrs).toEqual({ 'w:val': '2' })
    expect(findChild(mergedPr, 'w:vMerge')?.attrs).toEqual({ 'w:val': 'restart' })

    const secondRowCells = childrenNamed(rows[1]!, 'w:tc')
    expect(secondRowCells).toHaveLength(2)
    const continuationPr = findChild(secondRowCells[0]!, 'w:tcPr')!
    expect(findChild(continuationPr, 'w:gridSpan')?.attrs).toEqual({ 'w:val': '2' })
    expect(findChild(continuationPr, 'w:vMerge')).toBeDefined()
    expect(findChild(continuationPr, 'w:vMerge')?.attrs).toEqual({})
    expect(childrenNamed(secondRowCells[0]!, 'w:p')).toHaveLength(1)
    expect(result.rendered.map(({ cell: renderedCell, row, col, style, header }) => ({
      id: renderedCell.id, row, col, style, header,
    }))).toEqual([
      { id: 'merged', row: 0, col: 0, style: 'SesTableCenter', header: true },
      { id: 'header-3', row: 0, col: 2, style: 'SesTableCenter', header: true },
      { id: 'number-cell', row: 1, col: 2, style: 'SesTableCenter', header: false },
    ])
  })

  it('按表宽生成等分 tblGrid、写 5000 pct 表宽和重复表头', () => {
    const result = render(table())
    const tblEl = findChild(root(result.xml), 'w:tbl')!
    const tblPr = findChild(tblEl, 'w:tblPr')!
    expect(findChild(tblPr, 'w:tblW')?.attrs).toEqual({ 'w:w': '5000', 'w:type': 'pct' })
    expect(findChild(tblPr, 'w:tblLayout')?.attrs).toEqual({ 'w:type': 'fixed' })
    const grid = findChild(tblEl, 'w:tblGrid')!
    const gridWidths = childrenNamed(grid, 'w:gridCol').map((col) => Number(col.attrs['w:w']))
    expect(gridWidths).toHaveLength(3)
    expect(gridWidths.reduce((sum, width) => sum + width, 0)).toBe(9355)
    expect(childrenNamed(childrenNamed(tblEl, 'w:tr')[0]!, 'w:trPr')).toHaveLength(1)
    expect(findChild(findChild(childrenNamed(tblEl, 'w:tr')[0]!, 'w:trPr')!, 'w:tblHeader')).toBeDefined()
  })

  it('多个表头行都会重复，只有表头末行画粗下边框', () => {
    const result = render(table({
      headerRowCount: 2,
      rows: [
        { id: 'h1', cells: [cell('h1c', '分组', { header: true })] },
        { id: 'h2', cells: [cell('h2c', '单位', { header: true })] },
        { id: 'body', cells: [cell('bodyc', '12')] },
      ],
    }))
    const rows = childrenNamed(findChild(root(result.xml), 'w:tbl')!, 'w:tr')
    expect(rows.map((row) => findChild(findChild(row, 'w:trPr')!, 'w:tblHeader') !== undefined)).toEqual([true, true, false])
    expect(rows.every((row) => findChild(findChild(row, 'w:trPr')!, 'w:cantSplit') !== undefined)).toBe(true)
    expect(findChild(findChild(childrenNamed(rows[0]!, 'w:tc')[0]!, 'w:tcPr')!, 'w:tcBorders')).toBeUndefined()
    expect(findChild(findChild(childrenNamed(rows[1]!, 'w:tc')[0]!, 'w:tcPr')!, 'w:tcBorders')).toBeDefined()
  })

  it('表格内没有表题行：第 1 行即首个表头行，tblHeader 只设在前 headerRowCount 行，逐行跨页', () => {
    const xml = render(table()).xml
    const rows = childrenNamed(findChild(root(xml), 'w:tbl')!, 'w:tr')
    expect(rows).toHaveLength(2) // 表头行 + 一个数据行；没有跨满全宽的表题行
    expect(rows.map((row) => findChild(findChild(row, 'w:trPr')!, 'w:tblHeader') !== undefined)).toEqual([true, false])
    expect(rows.every((row) => findChild(findChild(row, 'w:trPr')!, 'w:cantSplit') !== undefined)).toBe(true)
    // 第 1 行的单元格是正常表头格，而不是 gridSpan 跨满全表的无边框表题格。
    expect(childrenNamed(rows[0]!, 'w:tc')).toHaveLength(2)
    expect(xml).not.toContain('w:val="nil"')
    expect(xml).not.toContain('SesTblCap')
  })

  it('strongTopBorder 给第 1 行（首个表头行）写粗上边框，使跨页重复的表头保留外框；缺省不写', () => {
    const topBorder = (xml: string) => {
      const rows = childrenNamed(findChild(root(xml), 'w:tbl')!, 'w:tr')
      return childrenNamed(rows[0]!, 'w:tc').map((tc) => {
        const borders = findChild(findChild(tc, 'w:tcPr')!, 'w:tcBorders')
        return borders ? findChild(borders, 'w:top')?.attrs : undefined
      })
    }
    const strong = topBorder(render(table(), undefined, undefined, true).xml)
    expect(strong).toHaveLength(2)
    expect(strong.every((attrs) => attrs?.['w:sz'] === '6' && attrs['w:val'] === 'single')).toBe(true)
    // 缺省时首行没有上边框覆盖（沿用 tblBorders 外框）。
    const plain = topBorder(render(table(), undefined, undefined, false).xml)
    expect(plain.every((attrs) => attrs === undefined)).toBe(true)
  })

  it('给表头末行加粗下边框，并把表注附加为跨满全表且带粗上边框的末行', () => {
    const note = '<w:p><w:pPr><w:pStyle w:val="SesTableNote"/></w:pPr><w:r><w:t>表注</w:t></w:r></w:p>'
    const result = render(table(), note)
    const tblEl = findChild(root(result.xml), 'w:tbl')!
    const rows = childrenNamed(tblEl, 'w:tr')
    expect(rows).toHaveLength(3)
    const lastHeaderCellPr = findChild(childrenNamed(rows[0]!, 'w:tc')[1]!, 'w:tcPr')!
    expect(findChild(lastHeaderCellPr, 'w:tcBorders')?.children[0]).toMatchObject({
      kind: 'element', name: 'w:bottom', attrs: { 'w:sz': '6' },
    })
    const noteCells = childrenNamed(rows[2]!, 'w:tc')
    expect(noteCells).toHaveLength(1)
    const notePr = findChild(noteCells[0]!, 'w:tcPr')!
    expect(findChild(notePr, 'w:gridSpan')?.attrs).toEqual({ 'w:val': '3' })
    expect(findChild(notePr, 'w:tcBorders')?.children[0]).toMatchObject({
      kind: 'element', name: 'w:top', attrs: { 'w:sz': '6' },
    })
    expect(noteCells[0]!.children.some((child) => child.kind === 'element' && child.name === 'w:p')).toBe(true)
  })

  it('表脚注在表注之后另成全宽末行，左单元格边距为零以便 9pt 缩进对齐表框', () => {
    const note = '<w:p><w:pPr><w:pStyle w:val="SesTableNote"/></w:pPr><w:r><w:t>表注</w:t></w:r></w:p>'
    const footnote = '<w:p><w:pPr><w:pStyle w:val="SesTableFootnote"/></w:pPr><w:r><w:t>a</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>表脚注内容</w:t></w:r></w:p>'
    const xml = render(table(), note, footnote).xml
    const rows = childrenNamed(findChild(root(xml), 'w:tbl')!, 'w:tr')
    expect(rows).toHaveLength(4)
    const noteCell = childrenNamed(rows[2]!, 'w:tc')[0]!
    const footnoteCell = childrenNamed(rows[3]!, 'w:tc')[0]!
    const notePr = findChild(noteCell, 'w:tcPr')!
    const footnotePr = findChild(footnoteCell, 'w:tcPr')!
    expect(findChild(notePr, 'w:gridSpan')?.attrs).toEqual({ 'w:val': '3' })
    expect(findChild(notePr, 'w:tcMar')).toBeUndefined()
    expect(findChild(footnotePr, 'w:gridSpan')?.attrs).toEqual({ 'w:val': '3' })
    expect(findChild(findChild(footnotePr, 'w:tcMar')!, 'w:left')?.attrs).toEqual({ 'w:w': '0', 'w:type': 'dxa' })
    expect(xml.indexOf('表注')).toBeLessThan(xml.indexOf('表脚注内容'))
  })

  it.each(['absent', 'whitespace', 'empty-callback', 'with-notes'])('表脚注上边框按实际前置表注决定粗细：%s', (scenario) => {
    const note = '<w:p><w:r><w:t>表注</w:t></w:r></w:p>'
    const footnote = '<w:p><w:pPr><w:pStyle w:val="SesTableFootnote"/></w:pPr><w:r><w:t>表脚注</w:t></w:r></w:p>'
    const notesXml = scenario === 'with-notes' ? note : scenario === 'whitespace' ? '  \n  ' : scenario === 'empty-callback' ? () => ' \n ' : undefined
    const xml = renderTableGrid(createRenderContext({}), table(), {
      notesXml, footnotesXml: footnote, renderCell: () => '<w:p/>',
    })
    const tbl = findChild(root(xml), 'w:tbl')!
    const rows = childrenNamed(tbl, 'w:tr')
    expect(rows).toHaveLength(scenario === 'with-notes' ? 4 : 3)
    const finalCellPr = findChild(childrenNamed(rows[rows.length - 1]!, 'w:tc')[0]!, 'w:tcPr')!
    expect(findChild(findChild(finalCellPr, 'w:tcBorders')!, 'w:top')?.attrs).toMatchObject({
      'w:val': 'single', 'w:sz': scenario === 'with-notes' ? '2' : '6',
    })
    expect(findChild(finalCellPr, 'w:gridSpan')?.attrs).toEqual({ 'w:val': '3' })
    expect(findChild(findChild(finalCellPr, 'w:tcMar')!, 'w:left')?.attrs).toEqual({ 'w:w': '0', 'w:type': 'dxa' })
    assertChildOrder({ parts: { 'word/document.xml': `<w:document xmlns:w="${W_NS}"><w:body>${xml}</w:body></w:document>` }, binaries: {}, warnings: [] })
  })

  it('横排表的 tblGrid 占满 252 mm 版心', () => {
    const result = render(table({ orientation: 'landscape', rows: [{ id: 'r', cells: [cell('a', '一'), cell('b', '二')] }] }))
    const grid = findChild(findChild(root(result.xml), 'w:tbl')!, 'w:tblGrid')!
    expect(childrenNamed(grid, 'w:gridCol').map((col) => Number(col.attrs['w:w'])).reduce((a, b) => a + b, 0)).toBe(14287)
  })

  it('续表片段可沿用原表列数，缺少的列用空格补齐', () => {
    const ir = table({ rows: [{ id: 'narrow', cells: [cell('only', '文字')] }] })
    const ctx = createRenderContext({})
    const xml = renderTableGrid(ctx, ir, {
      columnCount: 3,
      renderCell: () => '<w:p><w:pPr><w:pStyle w:val="SesTableText"/></w:pPr></w:p>',
    })
    const tblEl = findChild(root(xml), 'w:tbl')!
    expect(childrenNamed(findChild(tblEl, 'w:tblGrid')!, 'w:gridCol')).toHaveLength(3)
    expect(childrenNamed(childrenNamed(tblEl, 'w:tr')[0]!, 'w:tc')).toHaveLength(3)
  })

  it('符合 DOCX 附录 B 的表格子元素顺序', () => {
    const xml = render(table()).xml
    assertChildOrder({
      parts: {
        'word/document.xml': `<w:document xmlns:w="${W_NS}"><w:body>${xml}</w:body></w:document>`,
      },
      binaries: {},
      warnings: [],
    })
  })

  it('空单元格输出一字线，空内容和数字按居中段落处理', () => {
    expect(tableCellParagraphStyle(cell('empty', ''))).toBe('SesTableCenter')
    expect(tableCellParagraphStyle(cell('decimal', '1.25 ± 0.2'))).toBe('SesTableCenter')
    expect(tableCellParagraphStyle(cell('words', '材料名称'))).toBe('SesTableText')
    const rendered = render(table({ rows: [{ id: 'r', cells: [cell('empty', '')] }] }))
    expect(rendered.xml).toContain('—')
    const uneven = render(table({ rows: [
      { id: 'wide', cells: [cell('a', '一'), cell('b', '二')] },
      { id: 'short', cells: [cell('c', '三')] },
    ] }))
    expect(uneven.xml).toContain('<w:pStyle w:val="SesTableCenter"/></w:pPr><w:r><w:t xml:space="preserve">—</w:t>')
  })

  it('IR 没有行时仍生成带单行占位的合法 w:tbl', () => {
    const rendered = render(table({ rows: [], headerRowCount: 0 }))
    const tblEl = findChild(root(rendered.xml), 'w:tbl')!
    expect(childrenNamed(tblEl, 'w:tr')).toHaveLength(1)
    expect(childrenNamed(childrenNamed(tblEl, 'w:tr')[0]!, 'w:tc')).toHaveLength(1)
    expect(rendered.rendered).toEqual([])
  })

  it('拒绝非正整数跨度和超出末行的 rowspan', () => {
    expect(() => render(table({ rows: [{ id: 'bad', cells: [cell('zero', 'x', { colspan: 0 })] }] }))).toThrow(/colspan/)
    expect(() => render(table({ rows: [{ id: 'bad', cells: [cell('too-long', 'x', { rowspan: 2 })] }] }))).toThrow(/末行/)
  })
})

describe('自定义列宽到Word网格', () => {
  const gridWidths = (xml: string) => childrenNamed(findChild(findChild(root(xml), 'w:tbl')!, 'w:tblGrid')!, 'w:gridCol').map(c => Number(c.attrs['w:w']))
  it('保留局部70px列宽，其余列平分剩余版心宽度', () => {
    const ir = table({ rows: [{ id: 'r', cells: [cell('a', '序号', { columnWidths: [70] }), cell('b', '内容'), cell('c', '说明')] }] })
    const before = JSON.stringify(ir), xml = render(ir).xml
    expect(gridWidths(xml)).toEqual([1050, 4153, 4152])
    expect(findChild(findChild(findChild(root(xml), 'w:tbl')!, 'w:tblPr')!, 'w:tblW')?.attrs).toEqual({ 'w:w': '9355', 'w:type': 'dxa' })
    expect(JSON.stringify(ir)).toBe(before)
  })
  it('所有列已指定时保留总宽，并将合并格及纵向续格宽度设为覆盖列之和', () => {
    const ir = table({ rows: [
      { id: 'r1', cells: [cell('merge', '合并', { colspan: 2, rowspan: 2, columnWidths: [100, 200] }), cell('last', '末列', { columnWidths: [300] })] },
      { id: 'r2', cells: [cell('last2', '续行', { columnWidths: [300] })] },
    ] })
    const xml = render(ir).xml
    expect(gridWidths(xml)).toEqual([1500, 3000, 4500])
    const el = findChild(root(xml), 'w:tbl')!
    expect(findChild(findChild(el, 'w:tblPr')!, 'w:tblW')?.attrs).toEqual({ 'w:w': '9000', 'w:type': 'dxa' })
    for (const row of childrenNamed(el, 'w:tr')) {
      expect(findChild(findChild(childrenNamed(row, 'w:tc')[0]!, 'w:tcPr')!, 'w:tcW')?.attrs['w:w']).toBe('4500')
    }
  })
  it('超出版心的完整列宽按比例适配横排，网格与表宽一致', () => {
    const ir = table({ orientation: 'landscape', rows: [{ id: 'r', cells: [cell('a', '甲', { columnWidths: [400] }), cell('b', '乙', { columnWidths: [800] }), cell('c', '丙', { columnWidths: [1200] })] }] })
    expect(gridWidths(render(ir).xml)).toEqual([2381, 4762, 7144])
  })
})
