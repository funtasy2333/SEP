/**
 * 表（WP8.2 设计 §2.6）——T2.4b 实现。T2.4a-1 只提供分派点与空的放行常量。
 *
 * T2.4b 只替换本文件的函数体与常量，不再改 `dispatch.ts`、`xml46687.ts`、`outputBoundary.ts`：
 * - 渲染入口 `renderTable(block, at, ctx)`：`at.path` 是表自身的 IR 路径，`at.nodeId` 是表 id；通过 `ctx` 调用
 *   `renderInlines`（题名、单元格、脚注）、`renderBlock(s)`（单元格内的段落/列项、表注）、`registerPendingId`（表注 `note_<n>`）、
 *   `emitRef`、`report`/`reportMerged`、`xmlIdOf`；表脚注上标 `xref[@ref-type="table-fn"]` 已由 inline.ts 写出；
 * - 放行常量 `XML46687_TABLES_BOUNDARY`：`fields`（kind/shape → 额外字段）、`shapes`（childShape 登记）、`marks`、
 *   `declared`（已声明差异，`task: 'T2.4b'`），由 `xml46687Boundary.ts` 汇总。
 */

import type { IRTable } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { notImplemented, type RenderContext, type Site } from './context'

export const XML46687_TABLES_BOUNDARY: Xml46687BoundaryContribution = {
  declared: [],
}

export function renderTable(_block: IRTable, _at: Site, _ctx: RenderContext): XmlElement[] {
  return notImplemented('renderTable (设计 §2.6)', 'T2.4b')
}
