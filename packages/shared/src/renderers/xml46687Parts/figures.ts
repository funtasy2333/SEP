/**
 * 图与行内图（WP8.2 设计 §2.7）——T2.4b 实现。T2.4a-1 只提供分派点与空的放行常量。
 *
 * - `renderFigure(block, at, ctx)`：块图；`graphic/@xlink:href` = `labels[图].xmlId`，资源清单核对由 `ids.ts` 的 P4 统一做；
 * - `renderInlineImage(image, at, ctx)`：行内图 `inline-graphic`；`href` 取 `ctx.imageRefs` 里路径等于 `at.path` 的那一项
 *   （`collectXml46687ImageRefs` 给出 `inl_<k>`，`at.path` 是该 run 的 IR 路径 + `.image`，去掉 `.image` 即 run 路径）；
 *   由 inline.ts 在 run 的原子位置调用，容器是否允许行内图已由 inline.ts 判定；
 * - 放行常量 `XML46687_FIGURES_BOUNDARY`（图/行内图/资源的字段、shape 与已声明差异，`task: 'T2.4b'`）。
 */

import type { IRFigure, IRInlineImage } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { notImplemented, type RenderContext, type Site } from './context'

export const XML46687_FIGURES_BOUNDARY: Xml46687BoundaryContribution = {
  declared: [],
}

export function renderFigure(_block: IRFigure, _at: Site, _ctx: RenderContext): XmlElement[] {
  return notImplemented('renderFigure (设计 §2.7)', 'T2.4b')
}

export function renderInlineImage(_image: IRInlineImage, _at: Site, _ctx: RenderContext): XmlElement {
  return notImplemented('renderInlineImage (设计 §2.7)', 'T2.4b')
}
