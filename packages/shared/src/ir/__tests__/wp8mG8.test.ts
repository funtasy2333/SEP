/**
 * WP8.M G8：表的列模型 `IRTable.columns` 与单元格分边边框样式 `IRCellStyle.border*Style`（设计 §4.8）——shared 层。
 *
 * 覆盖 pmToIr / irToPm 双向映射与诊断、`hasSemanticExtensions`、Resolver 无变化、写作入口的明确拒绝，
 * 以及旧文档（无 columns / 无边框样式）的 IR 与 PM 投影不变。生产 Schema、同步插件、HTML 往返与保存重开见 client 的
 * wp8mG8.test.ts，输出边界见 renderers/__tests__/wp8mG8Boundary.test.ts。
 *
 * 两套列宽的关系（避免矛盾的列宽来源）：`columns[i].width` 是源文档给出的名义列宽（XML `col/@width`），
 * 单元格 `columnWidths` 是编辑器拖拽得到的 CSS px。二者独立保存、互不推导；这里的用例钉住“互不干扰”。
 */

import { describe, expect, it } from 'vitest'
import { buildTableGrid } from '../../renderers/docx/body/tableGrid'
import { normalizeAuthoringFragment } from '../authoring'
import { hasSemanticExtensions } from '../extensions'
import { IRToPmError, irToPm } from '../irToPm'
import { pmToIr, type PMJsonNode } from '../pmToIr'
import { resolve } from '../resolve'
import {
  CELL_BORDER_STYLES, columnAlignProblem, columnWidthProblem, isCellBorderStyle, tableGridWidth,
} from '../tableColumns'
import type { IRBlock, IRDoc, IRTable } from '../types'
import { fullFixture } from './fixtures'
import {
  G8_DOTTED_STYLE, G8_MERGED_COLUMNS, G8_MERGED_COLUMNS_PM, G8_P24_STYLE, G8_TWO_COLUMNS, G8_TWO_COLUMNS_PM,
  g8IrDoc, g8LegacyTable, g8MergedTable, g8PmDoc, g8TwoColumnTable, pmG8Cell, pmG8MergedTable, pmG8Row, pmG8Table,
  pmG8TwoColumnTable,
} from './wp8mG8Fixtures'

function tablesOf(doc: IRDoc): IRTable[] {
  const found: IRTable[] = []
  const visit = (blocks: ReadonlyArray<{ kind: string }>): void => {
    for (const block of blocks as IRBlock[]) {
      if (block.kind === 'table') found.push(block)
      else if ('children' in block) visit(block.children as IRBlock[])
    }
  }
  for (const chapter of doc.body) visit(chapter.children)
  return found
}

function stdTables(node: PMJsonNode, out: PMJsonNode[] = []): PMJsonNode[] {
  if (node.type === 'stdTable') out.push(node)
  node.content?.forEach(child => stdTables(child, out))
  return out
}

function cells(table: PMJsonNode): PMJsonNode[] {
  return table.content!.find(child => child.type === 'table')!.content!.flatMap(row => row.content ?? [])
}

describe('[M-6.1-03] pmToIr：stdTable.columns → IRTable.columns', () => {
  it('两列表：名义宽度、水平/垂直对齐逐项映射，未给出的属性不写键', () => {
    const { doc, warnings } = pmToIr(g8PmDoc())
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    const [two, merged] = tablesOf(doc)
    expect(two!.columns).toEqual(G8_TWO_COLUMNS)
    expect('textAlign' in two!.columns![1]!).toBe(false)
    expect(merged!.columns).toEqual(G8_MERGED_COLUMNS)
    expect(merged!.columns![1]).toEqual({})
  })

  it('columns 为 null / 缺省：IR 不出现 columns 键（旧表格不变）', () => {
    for (const columns of ['缺省', null]) {
      const table = pmG8TwoColumnTable(null)
      if (columns === '缺省') delete table.attrs!.columns
      const { doc } = pmToIr(g8PmDoc([table]))
      expect('columns' in tablesOf(doc)[0]!, String(columns)).toBe(false)
      expect(doc.unsupportedContent ?? []).toEqual([])
    }
  })

  it('网格列数按 colspan / rowspan 展开计算（合并单元格表 3 列），与 DOCX 渲染器的网格一致', () => {
    const [two, merged] = tablesOf(pmToIr(g8PmDoc()).doc)
    expect(tableGridWidth(two!.rows)).toBe(2)
    expect(tableGridWidth(merged!.rows)).toBe(3)
    expect(tableGridWidth(two!.rows)).toBe(buildTableGrid(two!).columnCount)
    expect(tableGridWidth(merged!.rows)).toBe(buildTableGrid(merged!).columnCount)
  })

  it('含 columns 的文档判定为语义扩展（extensionVersion=1）；不含者保持原判定', () => {
    expect(pmToIr(g8PmDoc()).doc.extensionVersion).toBe(1)
    // 只有 columns 一项新内容（去掉单元格边框样式）也必须被判定，否则旧版软件会静默读错。
    const onlyColumns = g8PmDoc([pmG8Table('only-col', '仅列模型', [
      pmG8Row('only-col.r0', pmG8Cell('tableCell', 'only-col.r0c0', 'a'), pmG8Cell('tableCell', 'only-col.r0c1', 'b')),
    ], G8_TWO_COLUMNS_PM)])
    expect(pmToIr(onlyColumns).doc.extensionVersion).toBe(1)
    const without = g8PmDoc([pmG8Table('no-col', '无列模型', [
      pmG8Row('no-col.r0', pmG8Cell('tableCell', 'no-col.r0c0', 'a'), pmG8Cell('tableCell', 'no-col.r0c1', 'b')),
    ])])
    expect(pmToIr(without).doc.extensionVersion).toBeUndefined()
  })

  it('列数与网格不符：整体不进 IR，记为 unsupportedContent（带节点 id 与原因），不静默丢弃', () => {
    for (const columns of [[G8_TWO_COLUMNS_PM[0]], [...G8_TWO_COLUMNS_PM, G8_TWO_COLUMNS_PM[1]], []]) {
      const { doc } = pmToIr(g8PmDoc([pmG8TwoColumnTable(columns)]))
      expect('columns' in tablesOf(doc)[0]!, String(columns.length)).toBe(false)
      expect(doc.unsupportedContent).toEqual([expect.objectContaining({
        nodeId: 'g8-tbl-2col', nodeType: 'stdTable', reason: expect.stringContaining('与表格网格列数 2 不符'),
      })])
    }
  })

  it('合并单元格：2 项（按首行 colspan 之和的错误算法会得 2）仍判为与 3 列网格不符', () => {
    const { doc } = pmToIr(g8PmDoc([pmG8MergedTable(G8_MERGED_COLUMNS_PM.slice(0, 2))]))
    expect(doc.unsupportedContent).toEqual([expect.objectContaining({ reason: expect.stringContaining('与表格网格列数 3 不符') })])
  })

  it('取值非法：每项各自记 unsupportedContent，合法的字段保留', () => {
    const columns = [
      { width: 0, widthUnit: '%', textAlign: null, verticalAlign: null },
      { width: 60, widthUnit: null, textAlign: null, verticalAlign: null },
    ]
    let result = pmToIr(g8PmDoc([pmG8TwoColumnTable(columns)])).doc
    expect(result.unsupportedContent!.map(item => item.reason)).toEqual([
      expect.stringContaining('第1列宽度必须是有限正数'),
      expect.stringContaining('第2列宽度必须带单位'),
    ])
    expect(tablesOf(result)[0]!.columns).toEqual([{}, {}])

    result = pmToIr(g8PmDoc([pmG8TwoColumnTable([
      { width: 40, widthUnit: '%', textAlign: 'char', verticalAlign: 'center' },
      { width: 60, widthUnit: '%', textAlign: 'left', verticalAlign: 'baseline' },
    ])])).doc
    expect(result.unsupportedContent!.map(item => item.reason)).toEqual([
      expect.stringContaining('第1列水平对齐「char」'),
      expect.stringContaining('第1列垂直对齐「center」'),
    ])
    expect(tablesOf(result)[0]!.columns).toEqual([
      { width: { value: 40, unit: '%' } },
      { width: { value: 60, unit: '%' }, textAlign: 'left', verticalAlign: 'baseline' },
    ])
  })

  it('单位必须是字母 / % 记号，含符号的单位（可能夹带 CSS / XML 语法）被拒绝', () => {
    for (const unit of ['}', '%;color:red', 'p x', '', 'a'.repeat(9), '1%']) {
      const columns = [{ width: 10, widthUnit: unit, textAlign: null, verticalAlign: null }, G8_TWO_COLUMNS_PM[1]]
      const { doc } = pmToIr(g8PmDoc([pmG8TwoColumnTable(columns)]))
      expect(doc.unsupportedContent?.length, JSON.stringify(unit)).toBe(1)
      expect(tablesOf(doc)[0]!.columns![0], JSON.stringify(unit)).toEqual({})
    }
  })

  it('非数组 / 非对象 / 含未知属性（如 col/@style）：明确记录而不是忽略', () => {
    let doc = pmToIr(g8PmDoc([pmG8TwoColumnTable('40%,60%')])).doc
    expect(doc.unsupportedContent).toEqual([expect.objectContaining({ reason: expect.stringContaining('必须是数组') })])
    expect('columns' in tablesOf(doc)[0]!).toBe(false)

    doc = pmToIr(g8PmDoc([pmG8TwoColumnTable([null, G8_TWO_COLUMNS_PM[1]])])).doc
    expect(doc.unsupportedContent).toEqual([expect.objectContaining({ reason: expect.stringContaining('第1列必须是对象') })])

    doc = pmToIr(g8PmDoc([pmG8TwoColumnTable([{ ...G8_TWO_COLUMNS_PM[0], style: 'width:1px' }, G8_TWO_COLUMNS_PM[1]])])).doc
    expect(doc.unsupportedContent).toEqual([expect.objectContaining({ reason: expect.stringContaining('不受支持的属性「style」') })])
  })

  it('与单元格 colwidth（px）互相独立：同时存在时各自保留，互不推导', () => {
    const pm = g8PmDoc()
    for (const cell of cells(stdTables(pm)[0]!)) cell.attrs!.colwidth = [150]
    const { doc } = pmToIr(pm)
    const [two] = tablesOf(doc)
    expect(two!.columns).toEqual(G8_TWO_COLUMNS) // 名义宽度没有被 px 改写
    expect(two!.rows.flatMap(row => row.cells).every(cell => cell.columnWidths?.[0] === 150)).toBe(true)
  })
})

describe('[M-6.1-03] irToPm：IRTable.columns → stdTable.columns', () => {
  it('写成四个键齐全的数组（缺省为 null）；无 columns 的表不写该属性', () => {
    const pm = irToPm(g8IrDoc([g8TwoColumnTable(), g8MergedTable(), g8LegacyTable()]))
    const [two, merged, legacy] = stdTables(pm)
    expect(two!.attrs!.columns).toEqual(G8_TWO_COLUMNS_PM)
    expect(merged!.attrs!.columns).toEqual(G8_MERGED_COLUMNS_PM)
    expect('columns' in legacy!.attrs!).toBe(false)
  })

  it('往返：IR → PM → IR 逐项相等（含 {} 占位项），且经 JSON 序列化后仍相等', () => {
    const original = g8IrDoc()
    const pm = JSON.parse(JSON.stringify(irToPm(original))) as PMJsonNode
    const { doc, warnings } = pmToIr(pm)
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    const [two, merged] = tablesOf(doc)
    expect(two!.columns).toEqual(tablesOf(original)[0]!.columns)
    expect(merged!.columns).toEqual(tablesOf(original)[1]!.columns)
    expect(two!.rows).toEqual(tablesOf(original)[0]!.rows)
    // 再投影一次得到相同的 PM（稳定）。
    expect(irToPm(doc)).toEqual(irToPm(original))
  })

  it('PM → IR → PM：生产 PM 的 columns 与单元格边框样式属性原样保留', () => {
    const source = g8PmDoc()
    const rewritten = irToPm(pmToIr(source).doc)
    const [sourceTwo, sourceMerged] = stdTables(source)
    const [rewrittenTwo, rewrittenMerged] = stdTables(rewritten)
    expect(rewrittenTwo!.attrs!.columns).toEqual(sourceTwo!.attrs!.columns)
    expect(rewrittenMerged!.attrs!.columns).toEqual(sourceMerged!.attrs!.columns)
    const styleKeys = ['borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle']
    cells(sourceTwo!).forEach((cell, index) => {
      const after = cells(rewrittenTwo!)[index]!
      for (const key of styleKeys) expect(after.attrs![key] ?? null, `${index}.${key}`).toEqual(cell.attrs![key] ?? null)
    })
  })

  it('项数与网格列数不符 → IRToPmError（带表 id 与路径），不写不合法的 columns', () => {
    const table = g8TwoColumnTable({ columns: [G8_TWO_COLUMNS[0]!] })
    expect(() => irToPm(g8IrDoc([table]))).toThrow(IRToPmError)
    try {
      irToPm(g8IrDoc([table]))
    } catch (error) {
      const diagnostics = (error as IRToPmError).diagnostics
      expect(diagnostics).toEqual([expect.objectContaining({
        nodeId: 'g8-tbl-2col', reason: expect.stringContaining('与表格网格列数 2 不符'), path: expect.stringContaining('.columns'),
      })])
    }
    // 空数组同样不符（网格至少 1 列）。
    expect(() => irToPm(g8IrDoc([g8TwoColumnTable({ columns: [] })]))).toThrow(IRToPmError)
  })

  it('宽度 / 对齐取值非法 → IRToPmError', () => {
    const bad = [
      { width: { value: -1, unit: '%' } },
      { width: { value: 10, unit: 'a;b' } },
    ]
    const table = g8TwoColumnTable({ columns: bad })
    try {
      irToPm(g8IrDoc([table]))
      throw new Error('应当抛出 IRToPmError')
    } catch (error) {
      expect(error).toBeInstanceOf(IRToPmError)
      expect((error as IRToPmError).diagnostics.map(item => item.path)).toEqual([
        expect.stringContaining('columns[0].width'), expect.stringContaining('columns[1].width'),
      ])
    }
    expect(() => irToPm(g8IrDoc([g8TwoColumnTable({ columns: [{ textAlign: 'start' }, {}] })]))).toThrow(IRToPmError)
    expect(() => irToPm(g8IrDoc([g8TwoColumnTable({ columns: [{}, { verticalAlign: 'center' }] })]))).toThrow(IRToPmError)
  })

  it('与单元格 columnWidths（px）互相独立：写入 colwidth，不影响 columns；反之亦然', () => {
    const withBoth = irToPm(g8IrDoc([g8TwoColumnTable({ columnWidths: true })]))
    const [table] = stdTables(withBoth)
    expect(table!.attrs!.columns).toEqual(G8_TWO_COLUMNS_PM)
    expect(cells(table!).slice(2).map(cell => cell.attrs!.colwidth)).toEqual([[151], [226]])
    const onlyPx = irToPm(g8IrDoc([g8TwoColumnTable({ columns: null, columnWidths: true })]))
    expect('columns' in stdTables(onlyPx)[0]!.attrs!).toBe(false)
    expect(cells(stdTables(onlyPx)[0]!).slice(2).map(cell => cell.attrs!.colwidth)).toEqual([[151], [226]])
  })
})

describe('[M-6.3.3.1-01] 单元格分边边框样式 border*Style', () => {
  it('pmToIr：四边样式连同既有边框宽度一起映射（p24 示例：左 solid 1px、上 solid 5px、右 none、下 dashed 3px）', () => {
    const { doc, warnings } = pmToIr(g8PmDoc())
    expect(warnings).toEqual([])
    expect(doc.unsupportedContent ?? []).toEqual([])
    const body = tablesOf(doc)[0]!.rows[1]!.cells
    expect(body[0]!.style).toEqual(G8_P24_STYLE)
    expect(body[1]!.style).toEqual(G8_DOTTED_STYLE)
    // 右边只有样式、没有宽度：不凭空补宽度。
    expect(body[0]!.style!.borderRight).toBeUndefined()
    expect(body[0]!.style!.borderRightStyle).toBe('none')
    // 表头单元格没有样式：不出现 style 键。
    expect('style' in tablesOf(doc)[0]!.rows[0]!.cells[0]!).toBe(false)
  })

  it('四个取值 solid / dashed / dotted / none 全部接受', () => {
    expect([...CELL_BORDER_STYLES]).toEqual(['solid', 'dashed', 'dotted', 'none'])
    for (const style of CELL_BORDER_STYLES) {
      expect(isCellBorderStyle(style)).toBe(true)
      const pm = g8PmDoc()
      cells(stdTables(pm)[0]!)[0]!.attrs!.borderTopStyle = style
      const { doc } = pmToIr(pm)
      expect(doc.unsupportedContent ?? []).toEqual([])
      expect(tablesOf(doc)[0]!.rows[0]!.cells[0]!.style).toEqual({ borderTopStyle: style })
    }
  })

  it('取值不在集合内 → unsupportedContent（带单元格 id 与原因），该值不进 IR', () => {
    for (const value of ['double', 'groove', 'hidden', 'DASHED', 5, true]) {
      const pm = g8PmDoc()
      cells(stdTables(pm)[0]!)[0]!.attrs!.borderLeftStyle = value
      const { doc } = pmToIr(pm)
      expect(doc.unsupportedContent, String(value)).toEqual([expect.objectContaining({
        nodeId: 'g8-tbl-2col.r0c0', nodeType: 'tableHeader',
        reason: expect.stringContaining(`边框样式「borderLeftStyle」的取值「${String(value)}」`),
      })])
      expect('style' in tablesOf(doc)[0]!.rows[0]!.cells[0]!, String(value)).toBe(false)
    }
  })

  it('空字符串 / null 视为未设置（与其他样式标量一致），不报告', () => {
    const pm = g8PmDoc()
    const header = cells(stdTables(pm)[0]!)[0]!
    header.attrs!.borderLeftStyle = ''
    header.attrs!.borderTopStyle = null
    const { doc } = pmToIr(pm)
    expect(doc.unsupportedContent ?? []).toEqual([])
    expect('style' in tablesOf(doc)[0]!.rows[0]!.cells[0]!).toBe(false)
  })

  it('含边框样式的文档判定为语义扩展；单独一个边框样式（无其他新内容）也被识别', () => {
    const onlyStyle = g8PmDoc([pmG8Table('only-style', '仅边框样式', [
      pmG8Row('only-style.r0', pmG8Cell('tableCell', 'only-style.r0c0', 'a', { borderTopStyle: 'dashed' })),
    ])])
    expect(pmToIr(onlyStyle).doc.extensionVersion).toBe(1)
    expect(hasSemanticExtensions({ kind: 'table', rows: [{ cells: [{ style: { borderTopStyle: 'dashed' } }] }] })).toBe(true)
  })

  it('irToPm：样式与宽度同写入单元格属性（border<Side> + Unit + Style）；非法 IR 取值 → IRToPmError', () => {
    const pm = irToPm(g8IrDoc())
    const first = cells(stdTables(pm)[0]!)[2]!
    expect(first.attrs).toMatchObject({
      borderLeft: 1, borderLeftUnit: 'px', borderLeftStyle: 'solid',
      borderTop: 5, borderTopUnit: 'px', borderTopStyle: 'solid',
      borderRightStyle: 'none',
      borderBottom: 3, borderBottomUnit: 'px', borderBottomStyle: 'dashed',
    })
    expect('borderRight' in first.attrs! && first.attrs!.borderRight !== undefined).toBe(false)

    const table = g8TwoColumnTable()
    table.rows[1]!.cells[0]!.style = { borderBottomStyle: 'wavy' }
    try {
      irToPm(g8IrDoc([table]))
      throw new Error('应当抛出 IRToPmError')
    } catch (error) {
      expect(error).toBeInstanceOf(IRToPmError)
      expect((error as IRToPmError).diagnostics).toEqual([expect.objectContaining({
        nodeId: 'g8-tbl-2col.r1c0', path: expect.stringContaining('style.borderBottomStyle'),
        reason: expect.stringContaining('「wavy」'),
      })])
    }
  })

  it('往返：IR → PM → IR 单元格样式逐项相等', () => {
    const original = g8IrDoc()
    const { doc } = pmToIr(JSON.parse(JSON.stringify(irToPm(original))) as PMJsonNode)
    for (const [index, table] of tablesOf(doc).entries()) {
      expect(table.rows).toEqual(tablesOf(original)[index]!.rows)
    }
  })

  it('既有单元格样式（背景、对齐、内边距、边框宽度）与新增样式共存，互不覆盖', () => {
    const table = g8TwoColumnTable({ columns: null })
    table.rows[1]!.cells[0]!.style = {
      ...G8_P24_STYLE, textAlign: 'center', verticalAlign: 'middle', backgroundColor: '#EFEFEF',
      paddingLeft: { value: 2, unit: 'mm' },
    }
    const { doc } = pmToIr(irToPm(g8IrDoc([table])))
    expect(tablesOf(doc)[0]!.rows[1]!.cells[0]!.style).toEqual(table.rows[1]!.cells[0]!.style)
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] 旧文档与既有行为不变', () => {
  it('字节锁定 fixture 的 IR 不含任何新字段，其 PM 投影不出现 columns / 边框样式', () => {
    const doc = pmToIr(fullFixture()).doc
    const json = JSON.stringify(doc)
    expect(json).not.toContain('"columns"')
    expect(json).not.toMatch(/border(Top|Right|Bottom|Left)Style/)
    const projected = JSON.stringify(irToPm(doc))
    expect(projected).not.toContain('"columns"')
    expect(projected).not.toMatch(/border(Top|Right|Bottom|Left)Style/)
  })

  it('hasSemanticExtensions：columns 非空才算；空数组 / 缺省不触发（不误标旧文档）', () => {
    expect(hasSemanticExtensions({ kind: 'table', columns: [{ width: { value: 1, unit: '%' } }] })).toBe(true)
    expect(hasSemanticExtensions({ kind: 'table', columns: [{}] })).toBe(true)
    expect(hasSemanticExtensions({ kind: 'table', columns: [] })).toBe(false)
    expect(hasSemanticExtensions({ kind: 'table', rows: [] })).toBe(false)
  })

  it('旧式表格往返后字节相同：没有 columns 键、没有边框样式属性', () => {
    const original = g8IrDoc([g8LegacyTable()])
    const pm = irToPm(original)
    expect(JSON.stringify(pm)).not.toContain('columns')
    expect(JSON.stringify(pm)).not.toMatch(/border(Top|Right|Bottom|Left)Style/)
    expect(pmToIr(pm).doc.extensionVersion).toBeUndefined()
  })
})

describe('[M-6.1-03][M-6.3.3.1-01] Resolver 与写作入口', () => {
  it('Resolver 对 columns / 边框样式无任何改动：标签与问题与去掉这些字段后完全相同', () => {
    const withFields = g8IrDoc()
    const stripped = structuredClone(withFields)
    for (const table of tablesOf(stripped)) {
      delete table.columns
      for (const cell of table.rows.flatMap(row => row.cells)) delete cell.style
    }
    const a = resolve(withFields)
    const b = resolve(stripped)
    expect(a.labels).toEqual(b.labels)
    expect(a.problems).toEqual(b.problems)
    expect(Object.values(a.labels).some(label => label.xmlId.startsWith('ext_'))).toBe(false)
  })

  it('写作片段不能写 columns：给出“暂不支持字段”而不是“未知字段”', () => {
    const result = normalizeAuthoringFragment([{
      kind: 'table', caption: '带列宽的表', rows: [['a']],
      columns: [{ width: { value: 100, unit: '%' } }],
    }], { parent: 'chapter' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual([expect.objectContaining({
        code: 'unsupported-field', path: 'fragment[0].columns', reason: expect.stringContaining('暂不支持字段「columns」'),
      })])
    }
  })
})

describe('共用校验函数', () => {
  it('columnWidthProblem / columnAlignProblem 的边界', () => {
    expect(columnWidthProblem(40, '%')).toBeNull()
    expect(columnWidthProblem(12.5, 'mm')).toBeNull()
    expect(columnWidthProblem(0, '%')).not.toBeNull()
    expect(columnWidthProblem(Number.NaN, '%')).not.toBeNull()
    expect(columnWidthProblem(Number.POSITIVE_INFINITY, '%')).not.toBeNull()
    expect(columnWidthProblem('40', '%')).not.toBeNull()
    expect(columnWidthProblem(40, undefined)).not.toBeNull()
    expect(columnAlignProblem(undefined, undefined)).toBeNull()
    expect(columnAlignProblem('justify', 'baseline')).toBeNull()
    expect(columnAlignProblem('middle', undefined)).not.toBeNull()
    expect(columnAlignProblem(undefined, 'left')).not.toBeNull()
  })

  it('tableGridWidth：rowspan 占位推到下一行、异常跨度不抛错也不耗尽内存', () => {
    expect(tableGridWidth([])).toBe(0)
    expect(tableGridWidth([{ cells: [] }])).toBe(0)
    expect(tableGridWidth([
      { cells: [{ colspan: 1, rowspan: 2 }, { colspan: 1, rowspan: 1 }] },
      { cells: [{ colspan: 2, rowspan: 1 }] },
    ])).toBe(3)
    expect(tableGridWidth([{ cells: [{ colspan: 0, rowspan: -3 }, { colspan: 1.5, rowspan: Number.NaN }] }])).toBe(2)
    const started = Date.now()
    expect(tableGridWidth([{ cells: [{ colspan: 1e9, rowspan: 1e9 }] }])).toBe(1000)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
