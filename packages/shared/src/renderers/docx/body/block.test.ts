/**
 * body/block.ts 单元测试：公式编号在 DOCX 中的显示文本、直接字体格式和缺失 label 警告。
 */

import { describe, expect, it } from 'vitest'
import type { IRFormula, IRTable, IRTableRow, NodeId, ResolvedLabel } from '../../../ir/types'
import { findChild, parseXml, type XmlElement } from '../__tests__/helpers/xmlTree'
import { renderBlock } from './block'
import { createRenderContext } from './context'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const SONG_FONT_ATTRS = {
  'w:ascii': '宋体',
  'w:eastAsia': '宋体',
  'w:hAnsi': '宋体',
  'w:cs': '宋体',
}

function renderFormula(label?: string): { xml: string; warnings: ReturnType<typeof createRenderContext>['warnings'] } {
  const labels: Record<NodeId, ResolvedLabel> = {}
  if (label !== undefined) labels['formula-1'] = { label, xmlId: 'formula_1', refText: `公式${label}` }
  const ctx = createRenderContext(labels, new Map(), {
    images: {},
    formulaOmml: { 'formula-1': '<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath>' },
  })
  const formula: IRFormula = { kind: 'formula', id: 'formula-1', latex: 'x=1', numbered: true, whereList: [] }
  return { xml: renderBlock(ctx, formula, { scopeKey: 'chapter-1' }), warnings: ctx.warnings }
}

function textContent(element: XmlElement): string {
  return element.children.map((child) => child.kind === 'text' ? child.text : textContent(child)).join('')
}

function paragraph(xml: string): XmlElement {
  const root = parseXml(`<w:root xmlns:w="${W_NS}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${xml}</w:root>`)
  return findChild(root, 'w:p')!
}

function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === 'element' && child.name === name)
}

function descendants(element: XmlElement, name: string): XmlElement[] {
  return [
    ...(element.name === name ? [element] : []),
    ...element.children.flatMap((child) => child.kind === 'element' ? descendants(child, name) : []),
  ]
}

function tableCell(id: string, text: string, options: { header?: boolean; rowspan?: number } = {}): IRTableRow['cells'][number] {
  return {
    id, colspan: 1, rowspan: options.rowspan ?? 1, header: options.header ?? false,
    content: [{ kind: 'paragraph', id: `${id}-p`, content: [{ text }] }],
  }
}

function tableWithHeaderRowspan(): IRTable {
  const header: IRTableRow = {
    id: 'header-row',
    cells: [
      tableCell('merged-header', '分类', { header: true, rowspan: 3 }),
      tableCell('header-name', '名称', { header: true }),
      tableCell('header-value', '取值', { header: true }),
    ],
  }
  const bodyRows: IRTableRow[] = Array.from({ length: 64 }, (_, index) => ({
    id: `body-row-${index + 1}`,
    // The merged header occupies column 1 in the next two rows. Later rows have all columns.
    cells: index < 2
      ? [
        tableCell(`body-name-${index + 1}`, index === 0 ? '长内容'.repeat(2500) : `名称-${index + 1}`),
        tableCell(`body-value-${index + 1}`, `取值-${index + 1}`),
      ]
      : [
        tableCell(`body-category-${index + 1}`, `分类-${index + 1}`),
        tableCell(`body-name-${index + 1}`, `名称-${index + 1}`),
        tableCell(`body-value-${index + 1}`, `取值-${index + 1}`),
      ],
  }))
  return {
    kind: 'table', id: 'table-rowspan', caption: [{ text: '跨界表头' }], orientation: 'portrait',
    headerRowCount: 1, rows: [header, ...bodyRows], notes: [],
  }
}

describe('renderFormula：编号标签', () => {
  it.each([
    { resolverLabel: '(1)', expected: '（1）' },
    { resolverLabel: '(A.1)', expected: '（A.1）' },
    { resolverLabel: '（1）', expected: '（1）' },
  ])('将 Resolver 的 $resolverLabel 输出为 $expected，并在编号 run 上显式指定宋体', ({ resolverLabel, expected }) => {
    const { xml, warnings } = renderFormula(resolverLabel)
    const runs = paragraph(xml).children.filter(
      (child): child is XmlElement => child.kind === 'element' && child.name === 'w:r',
    )
    const numberRun = runs.find((run) => textContent(run) === expected)

    expect(numberRun).toBeDefined()
    expect(textContent(numberRun!)).toBe(expected)
    const rPr = findChild(numberRun!, 'w:rPr')
    expect(rPr).toBeDefined()
    expect(findChild(rPr!, 'w:rFonts')?.attrs).toEqual(SONG_FONT_ATTRS)
    expect(warnings).toEqual([])
  })

  it('编号 label 缺失时保留原警告且不输出公式编号', () => {
    const { xml, warnings } = renderFormula()
    const paragraphXml = paragraph(xml)

    expect(warnings).toEqual([{
      code: 'label-missing',
      nodeId: 'formula-1',
      message: '公式 "formula-1" 需要编号但 labels 中没有 label，不写编号',
    }])
    expect(textContent(paragraphXml)).toContain('x=1')
    expect(textContent(paragraphXml)).not.toContain('（')
  })
})

describe('renderTable：表头 rowspan 跨越 headerRowCount', () => {
  it('首段保留合并覆盖行，续段截断重放表头的 rowspan 并保留首行数据列', () => {
    const ctx = createRenderContext({
      'table-rowspan': { label: '表1', xmlId: 'table_1', refText: '表1' },
    })
    const xml = renderBlock(ctx, tableWithHeaderRowspan(), { scopeKey: 'chapter-1' })
    const root = parseXml(`<w:root xmlns:w="${W_NS}">${xml}</w:root>`)
    const tables = descendants(root, 'w:tbl')

    expect(tables.length).toBeGreaterThan(1)

    const firstTableRows = childElements(tables[0]!, 'w:tr')
    expect(firstTableRows.length).toBeGreaterThanOrEqual(4) // caption, header, and both covered data rows
    const firstHeaderCells = childElements(firstTableRows[1]!, 'w:tc')
    expect(findChild(findChild(firstHeaderCells[0]!, 'w:tcPr')!, 'w:vMerge')?.attrs).toEqual({ 'w:val': 'restart' })
    for (const row of firstTableRows.slice(2, 4)) {
      expect(findChild(findChild(childElements(row, 'w:tc')[0]!, 'w:tcPr')!, 'w:vMerge')?.attrs).toEqual({})
    }

    const continuationRows = childElements(tables[1]!, 'w:tr')
    const continuationHeaderCells = childElements(continuationRows[1]!, 'w:tc')
    expect(findChild(findChild(continuationHeaderCells[0]!, 'w:tcPr')!, 'w:vMerge')).toBeUndefined()
    const firstContinuationDataCells = childElements(continuationRows[2]!, 'w:tc')
    expect(firstContinuationDataCells).toHaveLength(3)
    expect(textContent(firstContinuationDataCells[0]!)).toMatch(/^分类-/)
  })
})
