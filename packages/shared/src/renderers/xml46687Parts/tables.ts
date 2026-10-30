/**
 * 表（WP8.2 设计 §2.6）。
 *
 * 结构（C-T-01、C-T-02）：`table-wrap[@id][@orientation]` ＞ `label`、`caption/title`、`table`（`col`*、`thead`?、`tbody`）、
 * `table-wrap-foot`?（顺序：`p[@content-type="dimension"]`、`non-normative-note`*、`fn`*）。
 *
 * - XHTML 表模型：前 `headerRowCount` 行放 `thead`（单元格 `th`），其余放 `tbody`；`colspan/rowspan` 仅大于 1 才写；不写 `scope`、`border/frame/rules`；
 * - `col`（`IRTable.columns`，6.1）：只取名义列宽（百分数 `N%`），不由单元格的拖拽 px 列宽反推；非百分数 → warning `table-width-not-expressed` 并省略 `width`；
 *   全部为空对象则不写任何 `col`，任一列非空则每列一个 `col`（含空 `col`，保持位置）；
 * - 单元格：`align/valign` 取 6.3.2 的取值；`style` 写 `border-left/top/right/bottom: <样式> <宽度>px` 与 `background-color`，
 *   **只写与表级默认不同的边**（D-X-17）；单段、无 `unit` 的单元格行内直出，其余逐块写 `p`/`list`，表头单元格的 `unit` 写成最后一个无属性的 `p`（6.2.4）；
 * - 单元格内出现 `paragraph`、`list` 之外的块（含嵌套表，C-T-13）→ error `xml-cell-content`；非表头单元格带 `unit` → error `cell-unit-unsupported`（D-X-03）；
 * - 表注经 `ctx.renderBlock` 渲染（`label` 取 Resolver，`id` 仅被引用时写）；表脚注 `fn[@id=table-fn_<表号>.<k>]` 按字母序（`orderTableFootnotes`）输出，总是带 id；
 * - IR 有数据而 XML 无表达的：表宽/列宽/样式 → warning（聚合）；`cellType/width` → info `cell-attr-not-expressed`；拖拽 px 列宽 → info `px-width-ignored`（D-X-03）。
 */

import type { IRArray, IRCellStyle, IRMeasure, IRTable, IRTableRow } from '../../ir/types'
import type { XmlElement, XmlNode } from '../../xml46687/tree'
import { orderTableFootnotes } from '../footnotes'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { el, inlineHasContent, sub, type RenderContext, type Site } from './context'

/**
 * 放行（设计 §1.3.2～§1.3.3）：`table.columns/unit/width/style`、`row.style`、`cell.style/cellType/width/unit/columnWidths`。
 * 无 `kind` 的对象类型登记 shape：`column`、`tableStyle`、`rowStyle`、`cellStyle`、`measure`。
 * 路径后缀按“先特异、后一般”排列（`findDeclaredDifference` 取第一个匹配）：`cells.style/rows.style` 在 `.style` 之前，`cells.unit` 在 `.unit` 之前，
 * `cells.width` 在 `.width` 之前。`.unit` 同时覆盖 `table.unit` 与 `figure.unit`（二者路径后缀相同）。
 */
export const XML46687_TABLES_BOUNDARY: Xml46687BoundaryContribution = {
  fields: {
    table: ['columns', 'unit', 'width', 'style', 'alternativeGraphic'],
    array: ['kind', 'id', 'columns', 'rows', 'columnGroups'],
    columnGroup: ['start', 'count'],
    row: ['style'],
    cell: ['style', 'cellType', 'width', 'unit', 'columnWidths'],
    column: ['width', 'textAlign', 'verticalAlign'],
    tableStyle: ['layout', 'borderModel', 'textAlign', 'verticalAlign', 'borderColor', 'borderWidth', 'backgroundColor', 'cellPadding'],
    rowStyle: ['textAlign', 'verticalAlign', 'backgroundColor', 'borderColor', 'borderWidth', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'height'],
    cellStyle: [
      'textAlign', 'verticalAlign', 'backgroundColor',
      'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    ],
    measure: ['value', 'unit'],
  },
  shapes: [
    { parent: 'table', key: 'columns', shape: 'column' },
    { parent: 'table', key: 'alternativeGraphic', shape: 'graphic' },
    { parent: 'array', key: 'columns', shape: 'column' },
    { parent: 'array', key: 'columnGroups', shape: 'columnGroup' },
    { parent: 'table', key: 'width', shape: 'measure' },
    { parent: 'table', key: 'style', shape: 'tableStyle' },
    { parent: 'row', key: 'style', shape: 'rowStyle' },
    { parent: 'cell', key: 'style', shape: 'cellStyle' },
    { parent: 'cell', key: 'width', shape: 'measure' },
    { parent: 'column', key: 'width', shape: 'measure' },
    ...['borderWidth', 'cellPadding'].map((key) => ({ parent: 'tableStyle', key, shape: 'measure' })),
    ...['borderWidth', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'height'].map((key) => ({ parent: 'rowStyle', key, shape: 'measure' })),
    ...['borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
      .map((key) => ({ parent: 'cellStyle', key, shape: 'measure' })),
  ],
  declared: [
    { pathSuffix: '.kind', kind: 'kind', name: 'array', matrixIds: ['M-5.8-01','M-C.1-04'], task: 'T2.4b', reason: '数组保留列组与行' },
    { pathSuffix: '.alternativeGraphic', kind: 'field', name: 'alternativeGraphic', matrixIds: ['M-6.1-03'], task: 'T2.4b', reason: '表替代图关联表资源' },
    { pathSuffix: '.columns', kind: 'field', name: 'columns', matrixIds: ['M-6.1-03'], task: 'T2.4b', reason: '名义列宽写成 table 内 thead 之前的 col/@width（6.1；非百分数 warning 省略）' },
    { pathSuffix: 'cells.style', kind: 'field', name: 'style', matrixIds: ['M-6.3.3.1-01', 'M-6.3.4-01', 'M-6.3.2-01', 'M-6.3.2-02'], task: 'T2.4b', reason: '单元格边框与背景色写成 td/th 的 @style，对齐写成 @align/@valign（6.3；D-X-17 只写与表级默认不同的边）' },
    { pathSuffix: 'rows.style', kind: 'field', name: 'style', matrixIds: ['M-6.2.2-02', 'M-6.3.2-01', 'M-6.3.2-02'], task: 'T2.4b', reason: '行的对齐写成 tr/@align、tr/@valign；其余行样式放行并报 table-style-not-expressed（D-X-04）' },
    { pathSuffix: '.style', kind: 'field', name: 'style', matrixIds: ['M-6.1-01'], task: 'T2.4b', reason: '表级样式无 XML 表达（导出的 table 不带 border/frame/rules）：放行并报 table-style-not-expressed（D-X-04）' },
    { pathSuffix: 'cells.width', kind: 'field', name: 'width', matrixIds: ['M-6.4-01'], task: 'T2.4b', reason: '单元格宽度无 XML 属性：放行并报 cell-attr-not-expressed（info，D-X-03）' },
    { pathSuffix: '.width', kind: 'field', name: 'width', matrixIds: ['M-6.1-01', 'M-6.1-02'], task: 'T2.4b', reason: '表宽仅 33%/66%/100% 写成 table/@width，其余 warning 省略（6.1）' },
    { pathSuffix: 'cells.unit', kind: 'field', name: 'unit', matrixIds: ['M-6.2.4-02'], task: 'T2.4b', reason: '表头单元格的单位写成 th 内第二个 p；非表头单元格带 unit 是 error cell-unit-unsupported（6.2.4，D-X-03）' },
    { pathSuffix: '.unit', kind: 'field', name: 'unit', matrixIds: ['M-6.2.5-02', 'M-8.6-01'], task: 'T2.4b', reason: '表的通用单位写成 table-wrap-foot/p[@content-type="dimension"]（6.2.5）；图的单位写成 caption/p[@content-type="dimension"]（8.6）' },
    { pathSuffix: '.cellType', kind: 'field', name: 'cellType', matrixIds: ['M-6.4-01'], task: 'T2.4b', reason: '单元格类型无 XML 属性：放行并报 cell-attr-not-expressed（info，D-X-03）' },
    { pathSuffix: '.columnWidths', kind: 'field', name: 'columnWidths', matrixIds: ['M-6.1-03'], task: 'T2.4b', reason: '编辑器拖拽得到的 px 列宽无 XML 表达：放行并报 px-width-ignored（info，D-X-03；col 只取名义列宽 columns）' },
  ],
}

// ---------------------------------------------------------------------------
// 取值与警告
// ---------------------------------------------------------------------------

/** 6.3.2 的取值集合（附录 D 另有的 `char`/`baseline` 不导出）。 */
const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify'])
const VALIGN_VALUES = new Set(['top', 'middle', 'bottom'])
const EDGE_STYLES = new Set(['solid', 'dashed', 'dotted', 'none'])
/** 表宽仅这三个页面宽度比例写入 `table/@width`（6.1）。 */
const TABLE_WIDTH_PERCENTS = new Set([33, 66, 100])
/** 6.3.1：默认边框是 1 像素实线。 */
const DEFAULT_BORDER_PX = 1

const STYLE_TITLE = '表的样式在 GB/T 46687.2 中无法完整表达，已省略'
const WIDTH_TITLE = '表宽或列宽在 GB/T 46687.2 中无法表达，已省略'
const CELL_ATTR_TITLE = '单元格的 cellType、width 在 GB/T 46687.2 中没有对应属性，未导出'
const PX_TITLE = '编辑器拖拽得到的列宽（px）不由 XML 表达（col 只取名义列宽 columns），已忽略'

/** 正数的最短十进制写法（至多 4 位小数，无多余 0）；不是有限正数返回 undefined。 */
function formatNumber(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  const text = value.toFixed(4).replace(/\.?0+$/, '')
  return text === '' || text === '0' ? undefined : text
}

interface TableScope {
  ctx: RenderContext
  /** 面向用户的表名（“表1”），用于警告消息。 */
  name: string
  /** 表级默认边框宽度（px）：`table.style.borderWidth` 为合法 px 值时取它，否则 1（D-X-17）。 */
  defaultBorderPx: number
}

function styleWarning(scope: TableScope, detail: string, at: Site): void {
  scope.ctx.reportMerged('table-style-not-expressed', 'warning', STYLE_TITLE, `${scope.name} ${detail}`, at)
}

function widthWarning(scope: TableScope, detail: string, at: Site): void {
  scope.ctx.reportMerged('table-width-not-expressed', 'warning', WIDTH_TITLE, `${scope.name} ${detail}`, at)
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/** 对齐取值：在集合内原样返回；缺省返回 undefined；集合外 warning 并省略。 */
function alignValue(scope: TableScope, value: string | undefined, allowed: ReadonlySet<string>, what: string, at: Site): string | undefined {
  if (!isPresent(value)) return undefined
  if (allowed.has(value!)) return value
  styleWarning(scope, `${what}「${value}」不在 6.3.2 的取值（${[...allowed].join('、')}）内`, at)
  return undefined
}

function pxWidth(measure: IRMeasure | undefined): number | undefined {
  if (!measure || String(measure.unit).trim().toLowerCase() !== 'px') return undefined
  return Number.isFinite(measure.value) && measure.value >= 1 && measure.value <= 5 ? measure.value : undefined
}

// ---------------------------------------------------------------------------
// 单元格样式（6.3.3、6.3.4）
// ---------------------------------------------------------------------------

/** CSS 次序：左、上、右、下（6.3.3.1）。 */
const EDGES = [
  ['left', 'borderLeft', 'borderLeftStyle'],
  ['top', 'borderTop', 'borderTopStyle'],
  ['right', 'borderRight', 'borderRightStyle'],
  ['bottom', 'borderBottom', 'borderBottomStyle'],
] as const
const PADDINGS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const

/** `td/th` 的 `@style`：边框与背景色；与表级默认相同的边省略（D-X-17）。空返回 undefined。 */
function cellStyleAttribute(scope: TableScope, style: IRCellStyle, cellName: string, at: Site): string | undefined {
  const parts: string[] = []
  for (const [side, widthKey, styleKey] of EDGES) {
    const measure = style[widthKey]
    const styleName = style[styleKey]
    const hasStyle = isPresent(styleName)
    if (!measure && !hasStyle) continue
    const name = hasStyle ? styleName! : 'solid'
    if (!EDGE_STYLES.has(name)) {
      styleWarning(scope, `${cellName}的${side}边框样式「${name}」不在 6.3.3.2 的取值（solid、dashed、dotted）内，该边框未导出`, at)
      continue
    }
    if (name === 'none') { parts.push(`border-${side}: none`); continue }
    let width = scope.defaultBorderPx
    if (measure) {
      const px = pxWidth(measure)
      if (px === undefined) {
        styleWarning(scope, `${cellName}的${side}边框宽度 ${measure.value}${measure.unit} 不是 1～5 px，该边框未导出`, at)
        continue
      }
      width = px
    }
    if (name === 'solid' && width === scope.defaultBorderPx) continue
    parts.push(`border-${side}: ${name} ${formatNumber(width)}px`)
  }
  const background = style.backgroundColor
  if (isPresent(background)) {
    if (/^#[0-9A-Fa-f]{6}$/.test(background!)) parts.push(`background-color: ${background!.toUpperCase()}`)
    else if (background!.trim().toLowerCase() === 'none') parts.push('background-color: none')
    else styleWarning(scope, `${cellName}的背景色「${background}」不是 # 加 6 位十六进制或 none，已省略`, at)
  }
  if (PADDINGS.some((key) => style[key] !== undefined)) styleWarning(scope, `${cellName}的内边距无 XML 表达，已省略`, at)
  return parts.length > 0 ? parts.join('; ') : undefined
}

// ---------------------------------------------------------------------------
// 单元格、行
// ---------------------------------------------------------------------------

type Cell = IRTableRow['cells'][number]

function renderCell(cell: Cell, cellName: string, cellSite: Site, scope: TableScope): XmlElement {
  const { ctx } = scope
  const style = cell.style
  const unit = typeof cell.unit === 'string' && cell.unit.trim() !== '' ? cell.unit : undefined
  if (unit !== undefined && !cell.header) {
    ctx.report('cell-unit-unsupported', 'error', `${scope.name}的${cellName}不是表头单元格却带有单位「${unit}」：GB/T 46687.2 只规定了表头单元格的单位（th 内第二个 p，6.2.4），不能导出。`, sub(cellSite, '.unit'))
  }

  const blocks = cell.content
  const only = blocks.length === 1 ? blocks[0]! : undefined
  let children: XmlNode[]
  if (only && only.kind === 'paragraph' && !(unit !== undefined && cell.header)) {
    // 单段、无单位：行内内容直接写在 td/th 里，不套 p（C-T-11）
    children = ctx.renderInlines(only.content, sub(cellSite, '.content[0].content', only.id), 'inline')
  } else {
    const out: XmlElement[] = []
    blocks.forEach((block, index) => {
      const blockSite = sub(cellSite, `.content[${index}]`, block.id)
      if (block.kind === 'paragraph' || block.kind === 'list') {
        out.push(...ctx.renderBlock(block, blockSite))
      } else if (block.kind === 'table') {
        ctx.report('xml-cell-content', 'error', `${scope.name}的${cellName}里有嵌套表：GB/T 46687.2 6.1 规定不使用嵌套表，不能导出。`, blockSite)
      } else {
        ctx.report('xml-cell-content', 'error', `${scope.name}的${cellName}里只能放段落和列项（6.5），不能放「${block.kind}」。`, blockSite)
      }
    })
    if (unit !== undefined && cell.header) out.push(el('p', undefined, [unit]))
    children = out
  }

  const align = alignValue(scope, style?.textAlign, ALIGN_VALUES, `${cellName}的水平对齐`, sub(cellSite, '.style.textAlign'))
  const valign = alignValue(scope, style?.verticalAlign, VALIGN_VALUES, `${cellName}的垂直对齐`, sub(cellSite, '.style.verticalAlign'))
  return el(cell.header ? 'th' : 'td', {
    colspan: cell.colspan > 1 ? cell.colspan : undefined,
    rowspan: cell.rowspan > 1 ? cell.rowspan : undefined,
    align,
    valign,
    style: style ? cellStyleAttribute(scope, style, cellName, sub(cellSite, '.style')) : undefined,
  }, children)
}

function renderRow(row: IRTableRow, rowIndex: number, rowSite: Site, scope: TableScope): XmlElement {
  const style = row.style
  let align: string | undefined
  let valign: string | undefined
  if (style) {
    const rowName = `第 ${rowIndex + 1} 行`
    align = alignValue(scope, style.textAlign, ALIGN_VALUES, `${rowName}的水平对齐`, sub(rowSite, '.style.textAlign'))
    valign = alignValue(scope, style.verticalAlign, VALIGN_VALUES, `${rowName}的垂直对齐`, sub(rowSite, '.style.verticalAlign'))
    const others = (Object.keys(style) as Array<keyof typeof style>)
      .filter((key) => key !== 'textAlign' && key !== 'verticalAlign' && isPresent(style[key]))
    if (others.length > 0) styleWarning(scope, `${rowName}的样式（${others.join('、')}）无 XML 表达，已省略`, sub(rowSite, '.style'))
  }
  if (row.cells.length === 0) {
    scope.ctx.report('xml-table-empty', 'error', `${scope.name} 第 ${rowIndex + 1} 行没有任何单元格（XHTML 表的 tr 至少需要一个 th 或 td）。`, sub(rowSite, '.cells'))
  }
  const cells = row.cells.map((cell, cellIndex) =>
    renderCell(cell, `第 ${rowIndex + 1} 行第 ${cellIndex + 1} 个单元格`, sub(rowSite, `.cells[${cellIndex}]`, cell.id), scope))
  return el('tr', { align, valign }, cells)
}

// ---------------------------------------------------------------------------
// 列、表
// ---------------------------------------------------------------------------

function renderCols(block: Pick<IRTable, 'columns'>, at: Site, scope: TableScope, force = false): XmlElement[] {
  const columns = block.columns
  if (!columns || columns.length === 0) return []
  const nonEmpty = columns.some((column) => column && (column.width !== undefined || isPresent(column.textAlign) || isPresent(column.verticalAlign)))
  if (!nonEmpty && !force) return []
  return columns.map((column, index) => {
    const columnSite = sub(at, `.columns[${index}]`)
    const columnName = `第 ${index + 1} 列`
    let width: string | undefined
    if (column.width) {
      const percent = String(column.width.unit).trim() === '%' ? formatNumber(column.width.value) : undefined
      if (percent !== undefined && column.width.value <= 100) width = `${percent}%`
      else widthWarning(scope, `${columnName}的宽度 ${column.width.value}${column.width.unit} 不是 0～100 的百分数（col 只接受百分数，不由 px 换算），已省略`, sub(columnSite, '.width'))
    }
    return el('col', {
      width,
      align: alignValue(scope, column.textAlign, ALIGN_VALUES, `${columnName}的水平对齐`, sub(columnSite, '.textAlign')),
      valign: alignValue(scope, column.verticalAlign, VALIGN_VALUES, `${columnName}的垂直对齐`, sub(columnSite, '.verticalAlign')),
    })
  })
}

/** 表脚注 `fn`：`label/sup` 放字母（Resolver 的 refText），`p` 放正文；按字母序。 */
function renderFootnotes(block: IRTable, at: Site, ctx: RenderContext): XmlElement[] {
  const footnotes = block.footnotes ?? []
  if (footnotes.length === 0) return []
  let ordered = footnotes
  try {
    ordered = orderTableFootnotes(footnotes, ctx.labels as Parameters<typeof orderTableFootnotes>[1])
  } catch (error) {
    ctx.report('xml-label-missing', 'error', `表脚注的 Resolver 标签无效，无法排序：${error instanceof Error ? error.message.replace(/^render: /, '') : String(error)}`, sub(at, '.footnotes'))
  }
  return ordered.map((footnote): XmlElement => {
    const footnoteSite = sub(at, `.footnotes[${footnotes.indexOf(footnote)}]`, footnote.id)
    const xmlId = ctx.xmlIdOf(footnote.id, footnoteSite, '表脚注')
    const label = ctx.labelOf(footnote.id)
    return el('fn', { id: xmlId }, [
      label && label.refText !== '' ? el('label', undefined, [el('sup', undefined, [label.refText])]) : null,
      el('p', undefined, ctx.renderInlines(footnote.content, sub(footnoteSite, '.content'), 'inline')),
    ])
  })
}

export function renderTable(block: IRTable, at: Site, ctx: RenderContext): XmlElement[] {
  const xmlId = ctx.xmlIdOf(block.id, at, '表')
  const label = ctx.labelOf(block.id)
  if (label && label.label === '') ctx.report('xml-label-missing', 'error', '表在 labels 中没有编号文本（Resolver 应给出“表1”）。', at)

  const tableStyle = block.style
  const borderWidth = pxWidth(tableStyle?.borderWidth)
  const scope: TableScope = { ctx, name: label?.label ? label.label : '表', defaultBorderPx: borderWidth ?? DEFAULT_BORDER_PX }

  // 题名
  if (!inlineHasContent(block.caption)) ctx.report('caption-empty', 'warning', '表没有表题，已写出空的 caption/title（V-17 要求 caption/title 存在）。', sub(at, '.caption'))
  if (block.captionEn && inlineHasContent(block.captionEn)) {
    ctx.report('caption-en-not-expressed', 'warning', '英文表题在 GB/T 46687.2 中没有写法（caption 内只有一个 title），未导出。', sub(at, '.captionEn'))
  }

  // 表宽与表级样式
  let width: string | undefined
  if (block.width) {
    if (String(block.width.unit).trim() === '%' && TABLE_WIDTH_PERCENTS.has(block.width.value)) width = `${block.width.value}%`
    else widthWarning(scope, `的宽度 ${block.width.value}${block.width.unit} 不是 33%、66% 或 100%，已省略`, sub(at, '.width'))
  }
  if (tableStyle) {
    const keys = (Object.keys(tableStyle) as Array<keyof typeof tableStyle>).filter((key) => isPresent(tableStyle[key]))
    if (keys.length > 0) styleWarning(scope, `的表级样式（${keys.join('、')}）无 XML 表达（导出的 table 不带 border/frame/rules），已省略`, sub(at, '.style'))
  }

  // 单元格上的无表达数据（聚合，按表一条）
  let attrCells = 0
  let pxCells = 0
  let firstPx: Site | undefined
  for (const [rowIndex, row] of block.rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      if (isPresent(cell.cellType) || cell.width !== undefined) attrCells += 1
      if (Array.isArray(cell.columnWidths) && cell.columnWidths.length > 0) {
        pxCells += 1
        firstPx ??= sub(at, `.rows[${rowIndex}].cells[${cellIndex}].columnWidths`, cell.id)
      }
    }
  }
  if (attrCells > 0) ctx.reportMerged('cell-attr-not-expressed', 'info', CELL_ATTR_TITLE, `${scope.name} 有 ${attrCells} 个单元格`, at)
  if (pxCells > 0 && firstPx) ctx.reportMerged('px-width-ignored', 'info', PX_TITLE, `${scope.name} 有 ${pxCells} 个单元格`, firstPx)

  // 行：前 headerRowCount 行进 thead（输出边界已保证它等于“前导全表头行数”）
  const headerRows = Math.max(0, Math.min(block.headerRowCount, block.rows.length))
  const rowElements = block.rows.map((row, index) => renderRow(row, index, sub(at, `.rows[${index}]`, row.id), scope))
  const head = rowElements.slice(0, headerRows)
  const body = rowElements.slice(headerRows)
  if (body.length === 0) {
    ctx.report('xml-table-empty', 'error', '表没有表体行（rows 为空或全部是表头行）：XHTML 表要求至少一个 tbody 行。', at)
  }
  const table = el('table', { width }, [
    ...renderCols(block, at, scope),
    head.length > 0 ? el('thead', undefined, head) : null,
    el('tbody', undefined, body),
  ])

  // 表脚：单位、表注、表脚注
  const unit = typeof block.unit === 'string' && block.unit.trim() !== '' ? block.unit : undefined
  const foot: XmlElement[] = []
  if (unit !== undefined) foot.push(el('p', { 'content-type': 'dimension' }, [unit]))
  block.notes.forEach((note, index) => foot.push(...ctx.renderBlock(note, sub(at, `.notes[${index}]`, note.id))))
  foot.push(...renderFootnotes(block, at, ctx))

  return [el('table-wrap', { id: xmlId, orientation: block.orientation === 'landscape' ? 'landscape' : undefined }, [
    label && label.label !== '' ? el('label', undefined, [label.label]) : null,
    el('caption', undefined, [el('title', undefined, ctx.renderInlines(block.caption, sub(at, '.caption'), 'inline'))]),
    table,
    foot.length > 0 ? el('table-wrap-foot', undefined, foot) : null,
    block.alternativeGraphic ? renderAlternativeGraphic(block.alternativeGraphic, sub(at, '.alternativeGraphic', block.alternativeGraphic.id), ctx) : null,
  ])]
}

function renderAlternativeGraphic(graphic: NonNullable<IRTable['alternativeGraphic']>, at: Site, ctx: RenderContext): XmlElement {
  const ref = ctx.imageRefs.find(entry => entry.kind === 'table-alternative' && entry.path === at.path && entry.ownerId === graphic.id)
  if (!ref) ctx.report('resource-missing', 'error', '表替代图缺少资源引用。', at)
  if (graphic.contentType !== undefined && graphic.contentType !== 'disp_table') ctx.report('xml-write-failed','error','表替代图 content-type 必须为 disp_table。',at)
  if (graphic.specificUse !== undefined && !['size:T','size:S','size:M','size:L'].includes(graphic.specificUse)) ctx.report('xml-write-failed','error','表替代图 specific-use 无效。',at)
  return el('graphic', {'content-type':graphic.contentType ?? 'disp_table','specific-use':graphic.specificUse,'xlink:href':ref?.href})
}

export function renderArray(block: IRArray, at: Site, ctx: RenderContext): XmlElement[] {
  const scope: TableScope = {ctx,name:'数组',defaultBorderPx:DEFAULT_BORDER_PX}
  const columns = renderCols(block, at, scope, true)
  const groups = block.columnGroups ?? []
  const grouped: XmlElement[] = []
  let cursor = 0
  for (const group of groups) {
    if (!Number.isInteger(group.start) || !Number.isInteger(group.count) || group.start < cursor || group.count < 1 || group.start + group.count > columns.length) {
      ctx.report('xml-write-failed','error','数组列组区间无效或重叠。',sub(at,'.columnGroups'))
      continue
    }
    grouped.push(...columns.slice(cursor,group.start),el('colgroup',undefined,columns.slice(group.start,group.start+group.count)))
    cursor = group.start + group.count
  }
  grouped.push(...columns.slice(cursor))
  if (!block.rows.length) ctx.report('xml-table-empty','error','数组必须包含表体行。',at)
  const spans: number[] = []
  for (const row of block.rows) {
    let position = 0
    for (const cell of row.cells) {
      while ((spans[position] ?? 0) > 0) position++
      if (!Number.isInteger(cell.colspan) || cell.colspan < 1 || !Number.isInteger(cell.rowspan) || cell.rowspan < 1 || position + cell.colspan > block.columns.length) { ctx.report('xml-cell-content','error','数组单元格跨度无效。',sub(at,'.rows',cell.id)); continue }
      for (let i=position; i<position+cell.colspan; i++) { if ((spans[i] ?? 0) > 0) ctx.report('xml-cell-content','error','数组单元格跨度重叠。',sub(at,'.rows',cell.id)); spans[i] = cell.rowspan }
      position += cell.colspan
    }
    if (Array.from({length:block.columns.length},(_,i)=>(spans[i] ?? 0) > 0).some(used=>!used)) ctx.report('xml-cell-content','error','数组网格列数不一致。',sub(at,'.rows',row.id))
    for (let i=0;i<spans.length;i++) if (spans[i]) spans[i]!--
  }
  if (spans.some(span=>span>0)) ctx.report('xml-cell-content','error','数组行跨度超出表体。',at)
  const rows = block.rows.map((row,i) => renderRow(row,i,sub(at,`.rows[${i}]`,row.id),scope))
  return [el('array',undefined,[el('table',undefined,[...grouped,el('tbody',undefined,rows)])])]
}
