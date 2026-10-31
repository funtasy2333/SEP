import { describe, expect, it } from 'vitest'
import type { IRDoc } from '../ir/types'
import { getOutputSupportProblems } from './outputBoundary'
import { XML46687_TABLES_BOUNDARY } from './xml46687Parts/tables'
import { XML46687_DECLARED_DIFFERENCES, findDeclaredDifference, type Xml46687DeclaredDifference } from './xml46687Boundary'
import { expectDeclaredDifferences, expectReleased } from './__tests__/xml46687BoundaryKit'
import { baseDoc, expectOnlyUnknownField, pushBlock, titleOf, xml46687Paths, xmlPaths } from './__tests__/xml46687BoundaryDomainKit'

/**
 * XML46687 输出边界：T2.4b 的“表”域放行项（WP8.2 设计 §1.3.2～§1.3.4）。
 *
 * - 逐项正例：每个已声明差异各有一个最小文档，旧 XML 阻断、XML46687 放行；
 * - 富文档：全部本域声明项一起触发，差集恰等于声明集合（计算值），XML46687 零问题；
 * - shape 登记：`column/tableStyle/rowStyle/cellStyle/measure` 放行后“零问题”，对象里的未登记字段仍被精确报出；
 * - 仍阻断：`headerRowCount` 与前导表头行数不一致（与旧 XML 相同）、单元格 `style` 里的未登记字段。
 * 核心断言（差集等于全体声明集合、永久阻断清单）在 outputBoundaryXml46687.test.ts。
 */

const OWN = XML46687_TABLES_BOUNDARY.declared
const cellOf = (extra: Record<string, unknown> = {}) => ({ id: 'cell1', colspan: 1, rowspan: 1, header: false, content: [{ kind: 'paragraph', id: 'cell1.p', content: [{ text: '甲' }] }], ...extra })
const tableOf = (extra: Record<string, unknown> = {}, cell: Record<string, unknown> = {}, row: Record<string, unknown> = {}) => ({
  kind: 'table', id: 'table1', caption: [{ text: '表' }], orientation: 'portrait', headerRowCount: 0, notes: [],
  rows: [{ id: 'row1', cells: [cellOf(cell)], ...row }], ...extra,
})
const withTable = (extra: Record<string, unknown> = {}, cell: Record<string, unknown> = {}, row: Record<string, unknown> = {}): IRDoc => pushBlock(baseDoc(), tableOf(extra, cell, row))
const measure = { value: 2, unit: 'px' }

/** 声明项 → 恰好触发它的最小文档。键为 `${name}@${pathSuffix}`。 */
const INSTALLERS: Record<string, () => IRDoc> = {
  'array@.kind': () => pushBlock(baseDoc(), {kind:'array',id:'arr',columns:[{}],rows:[{id:'ar',cells:[cellOf()]}],columnGroups:[{start:0,count:1}]}),
  'alternativeGraphic@.alternativeGraphic': () => withTable({alternativeGraphic:{id:'alt',src:'a.png',contentType:'disp_table'}}),
  'columns@.columns': () => withTable({ columns: [{ width: { value: 40, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' }] }),
  'style@cells.style': () => withTable({}, { style: { textAlign: 'center', borderTop: measure, borderTopStyle: 'dashed', backgroundColor: '#EFEFEF' } }),
  'style@rows.style': () => withTable({}, {}, { style: { textAlign: 'center', verticalAlign: 'middle' } }),
  'style@.style': () => withTable({ style: { layout: 'fixed', borderWidth: measure } }),
  'width@cells.width': () => withTable({}, { width: { value: 30, unit: '%' } }),
  'width@.width': () => withTable({ width: { value: 66, unit: '%' } }),
  'unit@cells.unit': () => withTable({ headerRowCount: 1 }, { header: true, unit: 'mm' }),
  'unit@.unit': () => withTable({ unit: '单位为毫米' }),
  'cellType@.cellType': () => withTable({}, { cellType: 'number' }),
  'columnWidths@.columnWidths': () => withTable({}, { columnWidths: [70] }),
}
const keyOf = (entry: Xml46687DeclaredDifference): string => `${entry.name}@${entry.pathSuffix}`

/** 全部本域字段一起出现的富文档（单元格 `unit` 需要表头单元格：headerRowCount 与之保持一致）。 */
function richDoc(): IRDoc {
  const doc = baseDoc()
  pushBlock(doc, {
    kind: 'table', id: 'rich', alternativeGraphic:{id:'alt',src:'a.png',contentType:'disp_table'}, caption: [{ text: '表' }], orientation: 'portrait', headerRowCount: 1, notes: [], unit: '单位为毫米',
    width: { value: 66, unit: '%' }, style: { layout: 'fixed', borderModel: 'collapse', textAlign: 'left', verticalAlign: 'top', borderColor: '#000000', borderWidth: measure, backgroundColor: '#FFFFFF', cellPadding: measure },
    columns: [{ width: { value: 40, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' }, {}],
    rows: [
      { id: 'rich-h', style: { textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#EEEEEE', borderColor: '#000000', borderWidth: measure, borderTop: measure, borderRight: measure, borderBottom: measure, borderLeft: measure, height: measure }, cells: [
        cellOf({ id: 'rich-h1', header: true, unit: 'mm', cellType: 'text', width: { value: 30, unit: '%' }, columnWidths: [100, 120] }),
        cellOf({ id: 'rich-h2', header: true }),
      ] },
      { id: 'rich-b', cells: [
        cellOf({ id: 'rich-b1', style: {
          textAlign: 'right', verticalAlign: 'bottom', backgroundColor: '#D4D4D4',
          borderTop: measure, borderRight: measure, borderBottom: measure, borderLeft: measure,
          borderTopStyle: 'solid', borderRightStyle: 'none', borderBottomStyle: 'dashed', borderLeftStyle: 'dotted',
          paddingTop: measure, paddingRight: measure, paddingBottom: measure, paddingLeft: measure,
        } }),
        cellOf({ id: 'rich-b2' }),
      ] },
    ],
  })
  pushBlock(doc, {kind:'array',id:'arr',columns:[{}],rows:[{id:'ar',cells:[cellOf({id:'ac',content:[{kind:'paragraph',id:'acp',content:[{text:'甲'}]}]})]}],columnGroups:[{start:0,count:1}]})
  return doc
}

describe('[M-6.1-03] 表域放行项：逐项正例（旧 XML 阻断、XML46687 放行）', () => {
  it('本文件为每个本域声明项准备了安装器，也没有多余的安装器；本域声明项都登记在全局声明集合里，task 为 T2.4b', () => {
    expect(OWN.map(keyOf).sort()).toEqual(Object.keys(INSTALLERS).sort())
    for (const entry of OWN) {
      expect(entry.task).toBe('T2.4b')
      expect(XML46687_DECLARED_DIFFERENCES).toContain(entry)
    }
  })

  it.each(OWN.map((entry) => [titleOf(entry), entry] as const))('逐项正例 %s', (_title, entry) => {
    const doc = INSTALLERS[keyOf(entry)]!()
    expectReleased(doc, entry)
    expectDeclaredDifferences(doc, [entry])
  })

  it('[M-6.1-03] [M-6.3.3.1-01] [M-6.1-02] [M-6.2.5-02] [M-6.2.4-02] 声明项引用的矩阵行：列宽、单元格样式、表宽、单位、表头单位', () => {
    const ids = new Set(OWN.flatMap((entry) => entry.matrixIds))
    for (const id of ['M-6.1-03', 'M-6.3.3.1-01', 'M-6.3.4-01', 'M-6.1-02', 'M-6.2.5-02', 'M-6.2.4-02', 'M-6.2.2-02']) expect(ids, id).toContain(id)
  })

  it('富文档：全部本域声明项一起触发，差集恰等于声明集合，XML46687 零问题', () => {
    const doc = richDoc()
    const before = JSON.stringify(doc)
    expectDeclaredDifferences(doc, OWN)
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
    expect(xmlPaths(doc).length).toBeGreaterThanOrEqual(OWN.length)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('路径后缀“先特异、后一般”：cells.style / rows.style / .style 各自命中自己的声明项，.unit 同时覆盖表与图', () => {
    const doc = richDoc()
    const rowStyle = findDeclaredDifference(doc, 'doc.body[0].children[1].rows[0].style')
    const cellStyle = findDeclaredDifference(doc, 'doc.body[0].children[1].rows[1].cells[0].style')
    const tableStyle = findDeclaredDifference(doc, 'doc.body[0].children[1].style')
    expect([rowStyle?.pathSuffix, cellStyle?.pathSuffix, tableStyle?.pathSuffix]).toEqual(['rows.style', 'cells.style', '.style'])
    expect(findDeclaredDifference(doc, 'doc.body[0].children[1].rows[0].cells[0].unit')?.pathSuffix).toBe('cells.unit')
    expect(findDeclaredDifference(doc, 'doc.body[0].children[1].unit')?.pathSuffix).toBe('.unit')
    expect(findDeclaredDifference(doc, 'doc.body[0].children[2].unit')?.name).toBe('unit')
    expect(findDeclaredDifference(doc, 'doc.body[0].children[1].rows[0].cells[0].width')?.pathSuffix).toBe('cells.width')
    expect(findDeclaredDifference(doc, 'doc.body[0].children[1].width')?.pathSuffix).toBe('.width')
  })
})

describe('shape 登记：放行后零问题，对象里的未登记字段被精确报出', () => {
  const T = 'doc.body[0].children[1]'

  it('column / measure：columns 的每一项（width、textAlign、verticalAlign）与 width 的 value、unit 合法', () => {
    expect(xml46687Paths(withTable({ columns: [{ width: { value: 40, unit: '%' }, textAlign: 'left', verticalAlign: 'top' }, {}] }))).toEqual([])
    expectOnlyUnknownField(withTable({ columns: [{ zzz: 1 }] }), `${T}.columns[0].zzz`)
    expectOnlyUnknownField(withTable({ columns: [{ width: { value: 1, unit: '%', zzz: 1 } }] }), `${T}.columns[0].width.zzz`)
  })

  it('tableStyle：全部合法字段零问题；borderWidth / cellPadding 按 measure 校验；未登记字段被报', () => {
    expect(xml46687Paths(withTable({ style: { layout: 'fixed', borderModel: 'collapse', textAlign: 'left', verticalAlign: 'top', borderColor: '#000', borderWidth: measure, backgroundColor: '#FFF', cellPadding: measure } }))).toEqual([])
    expectOnlyUnknownField(withTable({ style: { zzz: 1 } }), `${T}.style.zzz`)
    expectOnlyUnknownField(withTable({ style: { borderWidth: { ...measure, zzz: 1 } } }), `${T}.style.borderWidth.zzz`)
    expectOnlyUnknownField(withTable({ style: { cellPadding: { ...measure, zzz: 1 } } }), `${T}.style.cellPadding.zzz`)
  })

  it('table.width 按 measure 校验', () => {
    expectOnlyUnknownField(withTable({ width: { value: 66, unit: '%', zzz: 1 } }), `${T}.width.zzz`)
  })

  it('rowStyle：全部合法字段零问题（含 borderTop 等 measure）；未登记字段被报', () => {
    const style = { textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#EEE', borderColor: '#000', borderWidth: measure, borderTop: measure, borderRight: measure, borderBottom: measure, borderLeft: measure, height: measure }
    expect(xml46687Paths(withTable({}, {}, { style }))).toEqual([])
    expectOnlyUnknownField(withTable({}, {}, { style: { zzz: 1 } }), `${T}.rows[0].style.zzz`)
    expectOnlyUnknownField(withTable({}, {}, { style: { height: { ...measure, zzz: 1 } } }), `${T}.rows[0].style.height.zzz`)
  })

  it('cellStyle：全部合法字段（含 border*Style、padding*）零问题；borderTop 等按 measure 校验；未登记字段（如分边颜色）被报', () => {
    const style = {
      textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#EEE',
      borderTop: measure, borderRight: measure, borderBottom: measure, borderLeft: measure,
      borderTopStyle: 'solid', borderRightStyle: 'dashed', borderBottomStyle: 'dotted', borderLeftStyle: 'none',
      paddingTop: measure, paddingRight: measure, paddingBottom: measure, paddingLeft: measure,
    }
    expect(xml46687Paths(withTable({}, { style }))).toEqual([])
    expectOnlyUnknownField(withTable({}, { style: { borderTopColor: '#f00' } }), `${T}.rows[0].cells[0].style.borderTopColor`)
    expectOnlyUnknownField(withTable({}, { style: { paddingLeft: { ...measure, zzz: 1 } } }), `${T}.rows[0].cells[0].style.paddingLeft.zzz`)
    expectOnlyUnknownField(withTable({}, { width: { value: 1, unit: '%', zzz: 1 } }), `${T}.rows[0].cells[0].width.zzz`)
  })
})

describe('仍阻断 / 与旧 XML 相同', () => {
  it('headerRowCount 与前导表头行数不一致仍被报（与旧 XML 逐字相同）；放行的字段并存时不改变这一结论', () => {
    const doc = withTable({ headerRowCount: 1, unit: '单位为毫米', columns: [{ width: { value: 40, unit: '%' } }] })
    expect(xml46687Paths(doc)).toEqual(['doc.body[0].children[1].headerRowCount'])
    expect(getOutputSupportProblems(doc, 'XML').map((problem) => problem.path)).toContain('doc.body[0].children[1].headerRowCount')
  })

  it('表头与单位等字段合法并存、headerRowCount 一致时零问题', () => {
    const doc = pushBlock(baseDoc(), {
      kind: 'table', id: 'hdr', caption: [], orientation: 'portrait', headerRowCount: 1, notes: [], unit: '单位',
      rows: [{ id: 'r', cells: [cellOf({ id: 'c', header: true, unit: 'mm' })] }, { id: 'r2', cells: [cellOf({ id: 'c2' })] }],
    })
    expect(getOutputSupportProblems(doc, 'XML46687')).toEqual([])
  })

  it('旧 XML 对本域字段仍全部阻断（保留旧断言）：columns、style、unit、width、cellType、columnWidths 各报一条', () => {
    const doc = richDoc()
    const blocked = xmlPaths(doc)
    for (const suffix of ['.columns', '.unit', '.width', '.style', 'cells.cellType', 'cells.columnWidths']) {
      expect(blocked.some((path) => path.replace(/\[\d+\]/g, '').endsWith(suffix)), suffix).toBe(true)
    }
  })

  it('HTML 与 DOCX 的结论不受影响：这些字段对它们的边界没有放行（DOCX 仅放行 columnWidths）', () => {
    const doc = withTable({ columns: [{ width: { value: 40, unit: '%' } }] }, { columnWidths: [70] })
    expect(getOutputSupportProblems(doc, 'DOCX').map((problem) => problem.path)).toEqual(['doc.body[0].children[1].columns'])
    expect(getOutputSupportProblems(doc, 'HTML').map((problem) => problem.path).sort()).toEqual(['doc.body[0].children[1].columns', 'doc.body[0].children[1].rows[0].cells[0].columnWidths'])
  })
})
