/**
 * WP8.M G8 测试 fixture：表的列模型 `IRTable.columns`（M-6.1-03，含导入时 `colgroup` 展开后的形态 M-C.1-02）与
 * 单元格分边边框样式 `IRCellStyle.border*Style`（M-6.3.3.1-01）。
 *
 * - IR 原生构造器（`g8IrDoc` 等）：映射、Resolver、输出边界测试共用。
 * - PM JSON 构造器（`g8PmDoc` 等）：shared 层 pmToIr / irToPm 测试用的纯对象文档（不依赖 Tiptap）。
 *
 * 不修改字节锁定的 fixtures.ts；这里只复用它的 PM 构造器。
 */

import type { PMJsonNode } from '../pmToIr'
import type { IRCellStyle, IRChapter, IRDoc, IRTable, IRTableColumn } from '../types'
import { chapter as pmChapter, para as pmPara, text as pmText } from './fixtures'

/** GB/T 46687.2—2026 6.1 p22 示例：两列 `<col align="center" valign="middle" width="50%"/>`；这里取 40% / 60%。 */
export const G8_TWO_COLUMNS: IRTableColumn[] = [
  { width: { value: 40, unit: '%' }, textAlign: 'center', verticalAlign: 'middle' },
  { width: { value: 60, unit: '%' } },
]

/** 三列网格（首行 colspan=2 的表头、首列 rowspan=2 的单元格）：第 2 列没有名义宽度，用 `{}` 占位。 */
export const G8_MERGED_COLUMNS: IRTableColumn[] = [
  { width: { value: 20, unit: '%' } },
  {},
  { width: { value: 50, unit: '%' }, textAlign: 'right', verticalAlign: 'bottom' },
]

/** 6.3.3.1 p24 示例的四边：左 solid 1px、上 solid 5px、右 none、下 dashed 3px（另给一个 dotted 供取值覆盖）。 */
export const G8_P24_STYLE: IRCellStyle = {
  borderLeft: { value: 1, unit: 'px' }, borderLeftStyle: 'solid',
  borderTop: { value: 5, unit: 'px' }, borderTopStyle: 'solid',
  borderRightStyle: 'none',
  borderBottom: { value: 3, unit: 'px' }, borderBottomStyle: 'dashed',
}

export const G8_DOTTED_STYLE: IRCellStyle = {
  borderTop: { value: 2, unit: 'px' }, borderTopStyle: 'dotted',
  borderRight: { value: 2, unit: 'px' }, borderRightStyle: 'dotted',
  borderBottom: { value: 2, unit: 'px' }, borderBottomStyle: 'dotted',
  borderLeft: { value: 2, unit: 'px' }, borderLeftStyle: 'dotted',
}

interface IrCellOptions {
  header?: boolean
  colspan?: number
  rowspan?: number
  style?: IRCellStyle
  columnWidths?: number[]
}

type IrCell = IRTable['rows'][number]['cells'][number]

/** 单元格 id 取 `<行 id>c<序号>`、段落 id 取 `<单元格 id>.p0`：与 pmToIr 对缺 nodeId 的派生约定一致。 */
function irCell(rowId: string, index: number, text: string, options: IrCellOptions = {}): IrCell {
  const id = `${rowId}c${index}`
  return {
    id,
    colspan: options.colspan ?? 1,
    rowspan: options.rowspan ?? 1,
    header: options.header ?? false,
    content: [{ kind: 'paragraph', id: `${id}.p0`, content: [{ text }] }],
    ...(options.style ? { style: structuredClone(options.style) } : {}),
    ...(options.columnWidths ? { columnWidths: [...options.columnWidths] } : {}),
  }
}

function irRow(tableId: string, index: number, cells: (rowId: string) => IrCell[]): IRTable['rows'][number] {
  const id = `${tableId}.r${index}`
  return { id, cells: cells(id) }
}

/** 两列表：表头行 + 一行数据；数据行第 1 格四边齐全（p24 示例），第 2 格四边 dotted。 */
export function g8TwoColumnTable(options: { columns?: IRTableColumn[] | null; columnWidths?: boolean } = {}): IRTable {
  const columns = options.columns === null ? undefined : options.columns ?? G8_TWO_COLUMNS
  return {
    kind: 'table',
    id: 'g8-tbl-2col',
    caption: [{ text: '两列表' }],
    orientation: 'portrait',
    headerRowCount: 1,
    rows: [
      irRow('g8-tbl-2col', 0, row => [
        irCell(row, 0, '项目', { header: true }),
        irCell(row, 1, '要求', { header: true }),
      ]),
      irRow('g8-tbl-2col', 1, row => [
        irCell(row, 0, '甲', { style: G8_P24_STYLE, ...(options.columnWidths ? { columnWidths: [151] } : {}) }),
        irCell(row, 1, '乙', { style: G8_DOTTED_STYLE, ...(options.columnWidths ? { columnWidths: [226] } : {}) }),
      ]),
    ],
    notes: [],
    ...(columns ? { columns: structuredClone(columns) } : {}),
  }
}

/**
 * 三列网格表（合并单元格）：
 *   row0：[表头 colspan=2][表头]
 *   row1：[rowspan=2][单元格][单元格]
 *   row2：             [单元格][单元格]
 */
export function g8MergedTable(options: { columns?: IRTableColumn[] | null } = {}): IRTable {
  const columns = options.columns === null ? undefined : options.columns ?? G8_MERGED_COLUMNS
  return {
    kind: 'table',
    id: 'g8-tbl-merged',
    caption: [{ text: '合并单元格表' }],
    orientation: 'portrait',
    headerRowCount: 1,
    rows: [
      irRow('g8-tbl-merged', 0, row => [
        irCell(row, 0, '合并表头', { header: true, colspan: 2 }),
        irCell(row, 1, '单列表头', { header: true }),
      ]),
      irRow('g8-tbl-merged', 1, row => [
        irCell(row, 0, '跨行', { rowspan: 2 }),
        irCell(row, 1, 'b1'),
        irCell(row, 2, 'c1'),
      ]),
      irRow('g8-tbl-merged', 2, row => [
        irCell(row, 0, 'b2'),
        irCell(row, 1, 'c2'),
      ]),
    ],
    notes: [],
    ...(columns ? { columns: structuredClone(columns) } : {}),
  }
}

/** 不带 columns 与边框样式的旧式两列表（回归用：新字段不应出现在其 IR / PM 里）。 */
export function g8LegacyTable(): IRTable {
  return {
    kind: 'table',
    id: 'g8-tbl-legacy',
    caption: [{ text: '旧式表' }],
    orientation: 'portrait',
    headerRowCount: 1,
    rows: [
      irRow('g8-tbl-legacy', 0, row => [irCell(row, 0, '项', { header: true }), irCell(row, 1, '值', { header: true })]),
      irRow('g8-tbl-legacy', 1, row => [irCell(row, 0, 'x'), irCell(row, 1, 'y')]),
    ],
    notes: [],
  }
}

function baseDoc(body: IRChapter[]): IRDoc {
  return {
    schemaVersion: 1,
    meta: { standardType: 'gb', title: 'G8 列宽与边框样式测试', stdCode: 'GB/T 99999—2026' },
    front: { foreword: [], introduction: [] },
    body,
    appendices: [],
    bibliography: [],
  }
}

/** 含 columns 与分边边框样式的 IR 文档（两列表 + 合并单元格表）。 */
export function g8IrDoc(tables: IRTable[] = [g8TwoColumnTable(), g8MergedTable()]): IRDoc {
  return baseDoc([{
    kind: 'chapter', id: 'g8-ch', secType: 'general', title: [{ text: '表的版式' }],
    children: [
      { kind: 'paragraph', id: 'g8-intro', content: [{ text: '见下表。' }] },
      ...tables,
    ],
  }])
}

// ---------- PM JSON（shared 层纯对象） ----------

/** PM 单元格：nodeId 与 IR 的 `<行 id>c<序号>` 对齐；`attrs` 追加/覆盖默认的 colspan / rowspan。 */
export function pmG8Cell(kind: 'tableCell' | 'tableHeader', nodeId: string, text: string, attrs: Record<string, unknown> = {}): PMJsonNode {
  return {
    type: kind,
    attrs: { nodeId, colspan: 1, rowspan: 1, ...attrs },
    content: [{ type: 'paragraph', attrs: { nodeId: `${nodeId}.p0` }, content: [pmText(text)] }],
  }
}

export function pmG8Row(nodeId: string, ...cells: PMJsonNode[]): PMJsonNode {
  return { type: 'tableRow', attrs: { nodeId }, content: cells }
}

/** 生产 PM 的 `stdTable`；`columns` 缺省不写属性（等同旧文档），`null` 与缺省等价。 */
export function pmG8Table(
  nodeId: string,
  caption: string,
  rows: PMJsonNode[],
  columns?: unknown,
  extraAttrs: Record<string, unknown> = {},
): PMJsonNode {
  return {
    type: 'stdTable',
    attrs: { nodeId, orientation: 'portrait', headerRowCount: 1, ...(columns === undefined ? {} : { columns }), ...extraAttrs },
    content: [
      { type: 'tableCaption', content: [pmText(caption)] },
      { type: 'table', content: rows },
    ],
  }
}

/** G8_TWO_COLUMNS 的生产 PM 形态（四个键齐全，缺省为 null）。 */
export const G8_TWO_COLUMNS_PM = [
  { width: 40, widthUnit: '%', textAlign: 'center', verticalAlign: 'middle' },
  { width: 60, widthUnit: '%', textAlign: null, verticalAlign: null },
]

/** G8_MERGED_COLUMNS 的生产 PM 形态。 */
export const G8_MERGED_COLUMNS_PM = [
  { width: 20, widthUnit: '%', textAlign: null, verticalAlign: null },
  { width: null, widthUnit: null, textAlign: null, verticalAlign: null },
  { width: 50, widthUnit: '%', textAlign: 'right', verticalAlign: 'bottom' },
]

/** 与 `g8TwoColumnTable()` 同构的 PM 表（无 colwidth）。 */
export function pmG8TwoColumnTable(columns: unknown = G8_TWO_COLUMNS_PM): PMJsonNode {
  return pmG8Table('g8-tbl-2col', '两列表', [
    pmG8Row('g8-tbl-2col.r0',
      pmG8Cell('tableHeader', 'g8-tbl-2col.r0c0', '项目'),
      pmG8Cell('tableHeader', 'g8-tbl-2col.r0c1', '要求')),
    pmG8Row('g8-tbl-2col.r1',
      pmG8Cell('tableCell', 'g8-tbl-2col.r1c0', '甲', {
        borderLeft: 1, borderLeftUnit: 'px', borderLeftStyle: 'solid',
        borderTop: 5, borderTopUnit: 'px', borderTopStyle: 'solid',
        borderRightStyle: 'none',
        borderBottom: 3, borderBottomUnit: 'px', borderBottomStyle: 'dashed',
      }),
      pmG8Cell('tableCell', 'g8-tbl-2col.r1c1', '乙', {
        borderTop: 2, borderTopUnit: 'px', borderTopStyle: 'dotted',
        borderRight: 2, borderRightUnit: 'px', borderRightStyle: 'dotted',
        borderBottom: 2, borderBottomUnit: 'px', borderBottomStyle: 'dotted',
        borderLeft: 2, borderLeftUnit: 'px', borderLeftStyle: 'dotted',
      })),
  ], columns)
}

/** 与 `g8MergedTable()` 同构的 PM 表。 */
export function pmG8MergedTable(columns: unknown = G8_MERGED_COLUMNS_PM): PMJsonNode {
  return pmG8Table('g8-tbl-merged', '合并单元格表', [
    pmG8Row('g8-tbl-merged.r0',
      pmG8Cell('tableHeader', 'g8-tbl-merged.r0c0', '合并表头', { colspan: 2 }),
      pmG8Cell('tableHeader', 'g8-tbl-merged.r0c1', '单列表头')),
    pmG8Row('g8-tbl-merged.r1',
      pmG8Cell('tableCell', 'g8-tbl-merged.r1c0', '跨行', { rowspan: 2 }),
      pmG8Cell('tableCell', 'g8-tbl-merged.r1c1', 'b1'),
      pmG8Cell('tableCell', 'g8-tbl-merged.r1c2', 'c1')),
    pmG8Row('g8-tbl-merged.r2',
      pmG8Cell('tableCell', 'g8-tbl-merged.r2c0', 'b2'),
      pmG8Cell('tableCell', 'g8-tbl-merged.r2c1', 'c2')),
  ], columns)
}

/** 生产 PM 文档：一章，含引导段与给定的表。 */
export function g8PmDoc(tables: PMJsonNode[] = [pmG8TwoColumnTable(), pmG8MergedTable()]): PMJsonNode {
  return {
    type: 'doc',
    content: [pmChapter('g8-ch', '表的版式', pmPara('g8-intro', pmText('见下表。')), ...tables)],
  }
}
