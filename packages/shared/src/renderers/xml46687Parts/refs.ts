/**
 * 规范性引用文件、参考文献与索引（WP8.2 设计 §2.10、§2.11 索引）——T2.4c 实现。T2.4a-1 只提供分派点与空的放行常量。
 *
 * - `renderNormRefList(block, at, ctx)`：`ref-list[@content-type="norm-refs"]`（只能在 `ctx.scope.chapter?.secType === 'norm-refs'` 的章内，
 *   否则 `xml-normref-outside`）；条目 `ref/@id` 取 `labels[条目].xmlId`（`ref_<n>`）；
 * - `renderBibliography(ctx)`：`back/ref-list[@content-type="bibl"][@id="sec_bibl"]`（常量 id）；没有文献时返回 null；
 *   条目按 `labels[条目].xmlId` 的尾号升序，不信任数组序；
 * - `renderIndex(ctx)`：`back/index[@id="sec_index"]`；条目 `df_<k>` 用 `ctx.nextCount('df')`；没有索引时返回 null；
 * - 放行常量 `XML46687_REFS_BOUNDARY`：`doc.bibliographyTitle`、`doc.index`、`normRefList`（kind）、文献字段的 shape 与已声明差异（`task: 'T2.4c'`）。
 *
 * 桩的行为：遇到这些内容就抛“未实现”，不静默丢弃。
 */

import type { IRNormRefList } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { notImplemented, type RenderContext, type Site } from './context'

export const XML46687_REFS_BOUNDARY: Xml46687BoundaryContribution = {
  declared: [],
}

export function renderNormRefList(_block: IRNormRefList, _at: Site, _ctx: RenderContext): XmlElement[] {
  return notImplemented('renderNormRefList (设计 §2.10)', 'T2.4c')
}

export function renderBibliography(ctx: RenderContext): XmlElement | null {
  if (ctx.doc.bibliography.length === 0) return null
  return notImplemented('renderBibliography (设计 §2.10)', 'T2.4c')
}

export function renderIndex(ctx: RenderContext): XmlElement | null {
  if (ctx.doc.index === undefined) return null
  return notImplemented('renderIndex (设计 §2.11)', 'T2.4c')
}
