/**
 * 术语条目（含 G5 领域规则）与缩略语（WP8.2 设计 §1.2、§2.9、§2.12）——T2.4c 实现。T2.4a-1 只提供分派点与空的放行常量。
 *
 * - `renderTermEntry(entry, at, ctx)`：`term-sec`/`tbx:termEntry`；`at.path` 是条目的 IR 路径；术语条只能在 `ctx.scope.chapter?.secType === 'terms'`
 *   的章内（否则 `xml-term-outside-terms`）；条目内的注经 `registerPendingId` 登记（`nte_<术语号>-<k>`）；
 *   定义/示例/注/来源里的行内用 `ctx.renderInlines(..., 'tbx')`（含 `tbx:entailedTerm`），术语名用 `'inline'`，来源/领域/描述符取值用 `'text'`；
 * - `renderDefList(block, at, ctx)`：缩略语 `def-list[@list-content="abbreviation"]`（`def-item` 仅被引用时写 `abb_<k>`，经 `registerPendingId`）；
 * - 放行常量 `XML46687_TERMS_BOUNDARY`：`termEntry.languageSets/subjectField`、`defList`（kind）、术语描述符的 shape 与已声明差异（`task: 'T2.4c'`）。
 */

import type { IRDefList, IRTermEntry } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { notImplemented, type RenderContext, type Site } from './context'

export const XML46687_TERMS_BOUNDARY: Xml46687BoundaryContribution = {
  declared: [],
}

export function renderTermEntry(_entry: IRTermEntry, _at: Site, _ctx: RenderContext): XmlElement[] {
  return notImplemented('renderTermEntry (设计 §2.9)', 'T2.4c')
}

export function renderDefList(_block: IRDefList, _at: Site, _ctx: RenderContext): XmlElement[] {
  return notImplemented('renderDefList (设计 §2.12)', 'T2.4c')
}
