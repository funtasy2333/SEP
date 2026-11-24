import type { PMJsonNode } from '@ses/shared'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'

/** 横页版心宽度：252 mm（96 dpi 下 1 in = 25.4 mm = 96 px → 252 * 96 / 25.4 ≈ 952.44px，与 DOCX mmToTwips(252) = 14287 twips，1px = 15 twips 对齐）。 */
export const LANDSCAPE_PAGE_MM = 252
export const LANDSCAPE_PAGE_PX = (LANDSCAPE_PAGE_MM * 96) / 25.4 // ≈ 952.4409
export const LANDSCAPE_TARGET_WIDTH_PX = 952
/** 纵向主编辑纸面内 .tableWrapper 可用宽度（810px - 72px*2 padding - 2px border - 2px wrapper padding = 662px）；
 *  662 * 15 = 9930 twips >= 9355 twips (165mm)，DOCX 导出会自动按比例等分占满 165mm 版心。 */
export const PORTRAIT_TARGET_WIDTH_PX = 662
export const LANDSCAPE_PX_PER_MM = 96 / 25.4 // ≈ 3.779527559
export const MIN_COL_WIDTH_PX = 25

export const EXPAND_LANDSCAPE_TABLE_EVENT = 'ses:expand-landscape-table'

export interface ExpandLandscapeTableDetail {
  pos?: number
  nodeId?: string
}

export function dispatchExpandLandscapeTable(detail: ExpandLandscapeTableDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ExpandLandscapeTableDetail>(EXPAND_LANDSCAPE_TABLE_EVENT, { detail }))
}

/** 判断选区或文档位置对应的 stdTable 是否按横页生效（自身 orientation === 'landscape' 或位于横向 appendix 内）。 */
export function isEffectiveLandscapeStdTable(doc: PMNode, pos: number): boolean {
  const node = pos >= 0 && pos < doc.content.size ? doc.nodeAt(pos) : null
  if (!node || node.type.name !== 'stdTable') return false
  if (node.attrs.orientation === 'landscape') return true
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const ancestor = $pos.node(depth)
    if (ancestor.type.name === 'appendix' && ancestor.attrs.orientation === 'landscape') {
      return true
    }
  }
  return false
}

/** 获取当前选区所属的最内层 stdTable 及其位置；若光标不在 stdTable 内则返回 null。 */
export function findActiveStdTableLocation(state: EditorState): { node: PMNode; pos: number } | null {
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type.name === 'stdTable') {
    return { node: selection.node, pos: selection.from }
  }
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'stdTable') {
      return { node, pos: $from.before(depth) }
    }
  }
  return null
}

/** 在文档中按 nodeId 定位 stdTable（找不到时可选按 pos 兜底核对）。 */
export function findStdTableByTarget(
  doc: PMNode,
  target: { nodeId?: string | null; pos?: number | null },
): { node: PMNode; pos: number } | null {
  if (target.nodeId) {
    let found: { node: PMNode; pos: number } | null = null
    doc.descendants((node, pos) => {
      if (node.type.name === 'stdTable' && node.attrs.nodeId === target.nodeId) {
        found = { node, pos }
        return false
      }
      return true
    })
    if (found) return found
  }
  if (typeof target.pos === 'number' && target.pos >= 0 && target.pos < doc.content.size) {
    const node = doc.nodeAt(target.pos)
    if (node?.type.name === 'stdTable') {
      if (!target.nodeId || !node.attrs.nodeId || node.attrs.nodeId === target.nodeId) {
        return { node, pos: target.pos }
      }
    }
  }
  return null
}

export interface LandscapeModalSessionData {
  /** 子编辑器根 doc JSON（含一个无 tableCaption/tableCaptionEn 的 stdTable 节点）。 */
  modalDoc: PMJsonNode
  /** 原始中文/英文表题 JSON（不进入弹窗编辑器，只读留存用于回合并）。 */
  captionNodes: PMJsonNode[]
  /** 表题纯文本摘要，用于弹窗标题栏展示。 */
  captionText: string
}

const MODAL_EXCLUDED_CHILD_TYPES = new Set(['tableCaption', 'tableCaptionEn'])

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 从主文档中的 `stdTable` JSON 提取弹窗子编辑器的初始内容与只读表题元数据。
 * 表题节点（tableCaption / tableCaptionEn）不会进入弹窗编辑器。
 */
export function extractStdTableForModal(stdTableJson: PMJsonNode): LandscapeModalSessionData {
  if (stdTableJson.type !== 'stdTable') {
    throw new Error(`Expected stdTable node, got ${stdTableJson.type}`)
  }
  const children = stdTableJson.content ?? []
  const captionNodes: PMJsonNode[] = []
  const modalChildren: PMJsonNode[] = []
  let captionCnText = ''
  for (const child of children) {
    if (MODAL_EXCLUDED_CHILD_TYPES.has(child.type)) {
      captionNodes.push(cloneJson(child))
      if (child.type === 'tableCaption') {
        captionCnText = collectPlainText(child).trim()
      }
    } else {
      modalChildren.push(cloneJson(child))
    }
  }
  const modalStdTable: PMJsonNode = {
    type: 'stdTable',
    ...(stdTableJson.attrs ? { attrs: cloneJson(stdTableJson.attrs) } : {}),
    content: modalChildren,
  }
  return {
    modalDoc: {
      type: 'doc',
      content: [modalStdTable],
    },
    captionNodes,
    captionText: captionCnText,
  }
}

function collectPlainText(node: PMJsonNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return ' '
  return (node.content ?? []).map(collectPlainText).join('')
}

/**
 * 将弹窗子编辑器的 `stdTable`（不含表题）与主文档原表的表题（tableCaption / tableCaptionEn）合并，
 * 返回可直接写回主文档的完整 `stdTable` JSON。
 */
export function mergeModalStdTable(
  originalStdTableJson: PMJsonNode,
  modalDocJson: PMJsonNode,
): PMJsonNode {
  const modalStdTable = modalDocJson.content?.find(child => child.type === 'stdTable')
  if (!modalStdTable) {
    throw new Error('Modal document does not contain a stdTable node')
  }
  const preservedCaptions = (originalStdTableJson.content ?? [])
    .filter(child => MODAL_EXCLUDED_CHILD_TYPES.has(child.type))
    .map(child => cloneJson(child))
  // 确保符合主 schema：tableCaption 是必选首节点
  if (!preservedCaptions.some(child => child.type === 'tableCaption')) {
    preservedCaptions.unshift({ type: 'tableCaption' })
  }
  const bodyChildren = (modalStdTable.content ?? [])
    .filter(child => !MODAL_EXCLUDED_CHILD_TYPES.has(child.type))
    .map(child => cloneJson(child))

  return {
    type: 'stdTable',
    attrs: {
      ...(originalStdTableJson.attrs ? cloneJson(originalStdTableJson.attrs) : {}),
      ...(modalStdTable.attrs ? cloneJson(modalStdTable.attrs) : {}),
    },
    content: [...preservedCaptions, ...bodyChildren],
  }
}

/**
 * 用弹窗编辑结果（ProseMirror JSON）合并回主编辑器中的 `stdTable` 节点（单次事务，支持整步 Ctrl+Z 撤销）。
 */
export function buildMergedStdTableNode(
  originalNode: PMNode,
  modalDocJson: PMJsonNode,
): PMNode {
  const mergedJson = mergeModalStdTable(originalNode.toJSON() as PMJsonNode, modalDocJson)
  const schema = originalNode.type.schema
  const nextNode = schema.nodeFromJSON(mergedJson)
  nextNode.check()
  return nextNode
}

/** 计算网格内每一列的显式 `colwidth`（若有缺失则为 null）。 */
export function getStdTableGridColwidths(stdTable: PMNode): {
  colCount: number
  widths: Array<number | null>
} | null {
  let grid: PMNode | null = null
  stdTable.forEach((child) => {
    if (!grid && child.type.name === 'table') grid = child
  })
  if (!grid) return null
  const tableGrid = grid as PMNode
  let map: TableMap
  try {
    map = TableMap.get(tableGrid)
  } catch {
    return null
  }
  const widths: Array<number | null> = Array(map.width).fill(null)
  tableGrid.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset) => {
      const colwidth = cell.attrs.colwidth as unknown
      if (!Array.isArray(colwidth)) return
      const rect = map.findCell(rowOffset + 1 + cellOffset)
      for (let col = rect.left; col < rect.right; col += 1) {
        const w = colwidth[col - rect.left]
        if (typeof w === 'number' && Number.isFinite(w) && w > 0 && widths[col] === null) {
          widths[col] = w
        }
      }
    })
  })
  return { colCount: map.width, widths }
}

/** 将整数目标总宽（如 952px）按权重分配为整数数组，保证总和精确等于 targetTotal。 */
export function distributeColumnWidthsByWeights(
  weights: number[],
  targetTotalPx = LANDSCAPE_TARGET_WIDTH_PX,
  minColWidthPx = MIN_COL_WIDTH_PX,
): number[] {
  const count = weights.length
  if (count === 0) return []
  const effectiveMin = count * minColWidthPx > targetTotalPx
    ? Math.max(1, Math.floor(targetTotalPx / count))
    : minColWidthPx
  const sanitized = weights.map(w => (Number.isFinite(w) && w > 0 ? w : 1))
  const weightSum = sanitized.reduce((a, b) => a + b, 0) || count
  const exact = sanitized.map(w => Math.max(effectiveMin, (targetTotalPx * w) / weightSum))

  // 若某些列被抬高到 effectiveMin 导致总和超出 targetTotalPx，先按超出余量从宽列回收
  let widths = exact.map(v => Math.max(effectiveMin, Math.round(v)))
  let diff = targetTotalPx - widths.reduce((a, b) => a + b, 0)
  if (diff > 0) {
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i)
    for (let k = 0; diff > 0; k += 1, diff -= 1) {
      const idx = order[k % order.length]!.i
      widths[idx]! += 1
    }
  } else if (diff < 0) {
    // 从最宽的列扣减，但不能低于 effectiveMin
    while (diff < 0) {
      let reduced = false
      const order = widths
        .map((w, i) => ({ w, i }))
        .sort((a, b) => b.w - a.w || a.i - b.i)
      for (const item of order) {
        if (diff === 0) break
        if (widths[item.i]! > effectiveMin) {
          widths[item.i]! -= 1
          diff += 1
          reduced = true
        }
      }
      if (!reduced) break
    }
  }
  return widths
}

export interface BuildColwidthOptions {
  /** 指定目标 table 网格节点位置（缺省时向后兼容，取文档首个 table）。 */
  tablePos?: number
  /** 指定所属 stdTable 节点位置；配合 clearNominalColumns 在恢复自动列宽时同步清除 attrs.columns。 */
  stdTablePos?: number
  /** 当 columnWidths === null 时是否同步清空 stdTable.attrs.columns（默认 false 以保持原单测兼容，调用方按需开启）。 */
  clearNominalColumns?: boolean
}

export interface ActiveTableGridLocation {
  tableNode: PMNode
  tablePos: number
  stdTableNode?: PMNode
  stdTablePos?: number
  isLandscape: boolean
}

function findChildTableGrid(stdTable: PMNode, stdTablePos: number): { tableNode: PMNode; tablePos: number } | null {
  let tableNode: PMNode | null = null
  let tablePos = -1
  stdTable.forEach((child, offset) => {
    if (!tableNode && child.type.name === 'table') {
      tableNode = child
      tablePos = stdTablePos + 1 + offset
    }
  })
  return tableNode && tablePos >= 0 ? { tableNode, tablePos } : null
}

/** 定位当前选区所在或选中的表格网格及所属 stdTable（支持表题/表注/表脚注/单元格/NodeSelection 与裸 table）。 */
export function findActiveTableGrid(state: EditorState): ActiveTableGridLocation | null {
  const { selection } = state
  if (selection instanceof NodeSelection) {
    if (selection.node.type.name === 'stdTable') {
      const child = findChildTableGrid(selection.node, selection.from)
      if (!child) return null
      return {
        tableNode: child.tableNode,
        tablePos: child.tablePos,
        stdTableNode: selection.node,
        stdTablePos: selection.from,
        isLandscape: isEffectiveLandscapeStdTable(state.doc, selection.from),
      }
    }
    if (selection.node.type.name === 'table') {
      let stdTableNode: PMNode | undefined
      let stdTablePos: number | undefined
      for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
        const ancestor = selection.$from.node(depth)
        if (ancestor.type.name === 'stdTable') {
          stdTableNode = ancestor
          stdTablePos = selection.$from.before(depth)
          break
        }
      }
      return {
        tableNode: selection.node,
        tablePos: selection.from,
        ...(stdTableNode !== undefined && stdTablePos !== undefined ? { stdTableNode, stdTablePos } : {}),
        isLandscape: stdTablePos !== undefined ? isEffectiveLandscapeStdTable(state.doc, stdTablePos) : false,
      }
    }
  }

  let tableNode: PMNode | undefined
  let tablePos: number | undefined
  let stdTableNode: PMNode | undefined
  let stdTablePos: number | undefined
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth)
    if (!tableNode && node.type.name === 'table') {
      tableNode = node
      tablePos = selection.$from.before(depth)
    } else if (!stdTableNode && node.type.name === 'stdTable') {
      stdTableNode = node
      stdTablePos = selection.$from.before(depth)
      break
    }
  }

  if (stdTableNode && stdTablePos !== undefined) {
    if (!tableNode || tablePos === undefined) {
      const child = findChildTableGrid(stdTableNode, stdTablePos)
      if (!child) return null
      tableNode = child.tableNode
      tablePos = child.tablePos
    }
    return {
      tableNode,
      tablePos,
      stdTableNode,
      stdTablePos,
      isLandscape: isEffectiveLandscapeStdTable(state.doc, stdTablePos),
    }
  }

  if (tableNode && tablePos !== undefined) {
    return {
      tableNode,
      tablePos,
      isLandscape: false,
    }
  }

  return null
}

/**
 * 仅移除 `stdTable.attrs.columns` 各列中的名义宽度字段（`width` / `widthUnit`），
 * 保留 `textAlign`、`verticalAlign` 等独立列对齐元数据；若所有列均不再包含有效字段则返回 `null`。
 */
function stripNominalColumnWidths(columns: unknown): unknown {
  if (!Array.isArray(columns)) return null
  let hasRemainingMetadata = false
  const stripped = columns.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (key === 'width' || key === 'widthUnit') continue
      if (value !== undefined && value !== null) {
        next[key] = value
        hasRemainingMetadata = true
      }
    }
    return next
  })
  return hasRemainingMetadata ? stripped : null
}

/** 为网格中的所有单元格统一写入每列的 `colwidth`（或传 null 清空全部 `colwidth`）。 */
export function buildColwidthTransaction(
  state: EditorState,
  columnWidths: number[] | null,
  options?: BuildColwidthOptions,
): Transaction | null {
  let tablePos = -1
  let tableNode: PMNode | null = null
  if (typeof options?.tablePos === 'number') {
    if (options.tablePos >= 0 && options.tablePos < state.doc.content.size) {
      const candidate = state.doc.nodeAt(options.tablePos)
      if (candidate?.type.name === 'table') {
        tablePos = options.tablePos
        tableNode = candidate
      }
    }
  } else {
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'table' && !tableNode) {
        tablePos = pos
        tableNode = node
        return false
      }
      return true
    })
  }
  if (!tableNode || tablePos < 0) return null
  const grid = tableNode as PMNode
  const map = TableMap.get(grid)
  if (columnWidths !== null && columnWidths.length !== map.width) return null

  const tr = state.tr
  const tableStart = tablePos + 1
  const visited = new Set<number>()
  grid.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset) => {
      const cellOffsetInTable = rowOffset + 1 + cellOffset
      if (visited.has(cellOffsetInTable)) return
      visited.add(cellOffsetInTable)
      const rect = map.findCell(cellOffsetInTable)
      const nextColwidth = columnWidths === null
        ? null
        : columnWidths.slice(rect.left, rect.right)
      const current = cell.attrs.colwidth as number[] | null
      const same = (current === null && nextColwidth === null) || (
        Array.isArray(current) && Array.isArray(nextColwidth)
        && current.length === nextColwidth.length
        && current.every((v, idx) => v === nextColwidth[idx])
      )
      if (!same) {
        tr.setNodeMarkup(tableStart + cellOffsetInTable, undefined, {
          ...cell.attrs,
          colwidth: nextColwidth,
        })
      }
    })
  })

  if (
    columnWidths === null
    && options?.clearNominalColumns
    && typeof options.stdTablePos === 'number'
    && options.stdTablePos >= 0
    && options.stdTablePos < tr.doc.content.size
  ) {
    const stdTable = tr.doc.nodeAt(options.stdTablePos)
    if (stdTable?.type.name === 'stdTable' && stdTable.attrs.columns !== null && stdTable.attrs.columns !== undefined) {
      const nextColumns = stripNominalColumnWidths(stdTable.attrs.columns)
      if (JSON.stringify(nextColumns) !== JSON.stringify(stdTable.attrs.columns)) {
        tr.setNodeAttribute(options.stdTablePos, 'columns', nextColumns)
      }
    }
  }

  return tr.docChanged ? tr : null
}

/** 按当前激活表格的生效版面方向（横页 952px / 纵向 662px）均分列宽，返回单步事务。 */
export function buildActiveTableEvenWidthTransaction(state: EditorState): Transaction | null {
  const active = findActiveTableGrid(state)
  if (!active) return null
  let map: TableMap
  try {
    map = TableMap.get(active.tableNode)
  } catch {
    return null
  }
  if (map.width === 0) return null
  const targetWidthPx = active.isLandscape ? LANDSCAPE_TARGET_WIDTH_PX : PORTRAIT_TARGET_WIDTH_PX
  const weights = Array<number>(map.width).fill(1)
  const widths = distributeColumnWidthsByWeights(weights, targetWidthPx)
  return buildColwidthTransaction(state, widths, { tablePos: active.tablePos })
}

/** 清除当前激活表格全部固定列宽（colwidth）及名义列宽（stdTable.attrs.columns），恢复自动列宽。 */
export function buildActiveTableAutoWidthTransaction(state: EditorState): Transaction | null {
  const active = findActiveTableGrid(state)
  if (!active) return null
  return buildColwidthTransaction(state, null, {
    tablePos: active.tablePos,
    ...(active.stdTablePos !== undefined ? { stdTablePos: active.stdTablePos, clearNominalColumns: true } : {}),
  })
}

/** 根据当前表格的 `colwidth`、名义 `columns` 比例或 DOM 实测列宽，返回可用于「铺满横页」的权重数组。 */
export function resolveCurrentColumnWeights(
  stdTable: PMNode,
  domTable?: HTMLTableElement | null,
): number[] {
  const info = getStdTableGridColwidths(stdTable)
  if (!info || info.colCount === 0) return []
  const { colCount, widths } = info

  // 1. 优先用 DOM 中每一列的实际宽度作为比例参考
  if (domTable) {
    const domWidths = Array.from(
      domTable.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'),
      col => {
        const inlineWidth = col.style.width
        if (inlineWidth && inlineWidth.endsWith('px')) {
          const parsed = Number.parseFloat(inlineWidth)
          if (Number.isFinite(parsed) && parsed > 0) return parsed
        }
        const rectWidth = col.getBoundingClientRect().width
        return Number.isFinite(rectWidth) && rectWidth > 0 ? rectWidth : 0
      },
    )
    if (domWidths.length === colCount && domWidths.every(w => w > 0)) {
      return domWidths
    }
  }

  // 2. 若全部列都有 explicit colwidth，直接用它们
  if (widths.every((w): w is number => typeof w === 'number' && w > 0)) {
    return widths
  }

  // 3. 若有部分 colwidth 或名义 columns 宽度，组合推算
  const columns = Array.isArray(stdTable.attrs.columns) ? stdTable.attrs.columns as Array<{ width?: unknown; widthUnit?: unknown }> : null
  const avg = LANDSCAPE_TARGET_WIDTH_PX / colCount
  return widths.map((w, idx) => {
    if (typeof w === 'number' && w > 0) return w
    const nominal = columns?.[idx]
    if (nominal && typeof nominal.width === 'number' && Number.isFinite(nominal.width) && nominal.width > 0) {
      if (nominal.widthUnit === 'mm') return nominal.width * LANDSCAPE_PX_PER_MM
      if (nominal.widthUnit === '%') return (nominal.width / 100) * LANDSCAPE_TARGET_WIDTH_PX
      return nominal.width
    }
    return avg
  })
}

/** 检查编辑器内表格总宽（px）及与 252mm 横页版心的比例。 */
export function computeTableWidthMetrics(
  stdTable: PMNode,
  domTable?: HTMLTableElement | null,
): {
  totalPx: number
  totalMm: number
  percent: number
  isCustomColwidth: boolean
  exceedsPage: boolean
} {
  const info = getStdTableGridColwidths(stdTable)
  let isCustomColwidth = false
  let totalPx = LANDSCAPE_TARGET_WIDTH_PX

  if (info && info.widths.every((w): w is number => typeof w === 'number' && w > 0)) {
    isCustomColwidth = true
    totalPx = info.widths.reduce((sum, w) => sum + w, 0)
  } else if (domTable) {
    const colRects = Array.from(
      domTable.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'),
      col => col.getBoundingClientRect().width,
    )
    const measuredSum = colRects.reduce((sum, w) => sum + (Number.isFinite(w) && w > 0 ? w : 0), 0)
    const tableWidth = measuredSum > 0
      ? measuredSum
      : (domTable.offsetWidth || domTable.getBoundingClientRect().width || LANDSCAPE_TARGET_WIDTH_PX)
    if (tableWidth > 0) {
      totalPx = tableWidth
    }
    if (info && info.widths.some(w => typeof w === 'number' && w > 0)) {
      isCustomColwidth = true
    }
  } else if (info && info.widths.some(w => typeof w === 'number' && w > 0)) {
    isCustomColwidth = true
    const avg = LANDSCAPE_TARGET_WIDTH_PX / Math.max(1, info.colCount)
    totalPx = info.widths.reduce<number>((sum, w) => sum + (w ?? avg), 0)
  }

  const totalMm = totalPx / LANDSCAPE_PX_PER_MM
  const percent = (totalPx / LANDSCAPE_TARGET_WIDTH_PX) * 100
  return {
    totalPx,
    totalMm,
    percent,
    isCustomColwidth,
    exceedsPage: totalMm > LANDSCAPE_PAGE_MM + 0.5,
  }
}

export function pxToMmRounded(px: number): number {
  return Math.round((px / LANDSCAPE_PX_PER_MM) * 10) / 10
}

/** 构造用于写入 `Fragment` 的空函数占位防止未使用警告（保留向后兼容导出）。 */
export function sanitizeStdTableContentFragment(fragment: Fragment): Fragment {
  return fragment
}
