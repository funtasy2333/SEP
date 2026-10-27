/**
 * 公式（WP8.2 设计 §2.8、§4.5）——T2.4b 实现。T2.4a-1 只提供分派点与空的放行常量。
 *
 * - `renderFormula(block, at, ctx)`：块公式 `disp-formula`（`mml:math[@display="block"]` 的 `id` 与 `display` 由 P3/本函数负责，
 *   `id` 一律由 `ids.ts` 的 `assignMathIds` 后置赋值）；
 * - `renderInlineFormula(formula, at, ctx)`：行内公式 `inline-formula/mml:math`（无 `display`）。容器是否允许公式已由 inline.ts 判定
 *   （纯文本容器报 `formula-in-text-only`）；
 * - 放行常量 `XML46687_FORMULAS_BOUNDARY`：公式/公式注/行内公式的额外字段与 shape（`inlineFormula` 加 `mathml`、`source`，
 *   并取消边界对行内公式 `latex` 必填的要求只需在此登记字段，`outputBoundary.ts` 已对 XML46687 放行行内公式）。
 */

import type { IRFormula, IRInlineFormula } from '../../ir/types'
import type { XmlElement } from '../../xml46687/tree'
import type { Xml46687BoundaryContribution } from '../xml46687Boundary'
import { notImplemented, type RenderContext, type Site } from './context'

export const XML46687_FORMULAS_BOUNDARY: Xml46687BoundaryContribution = {
  declared: [],
}

export function renderFormula(_block: IRFormula, _at: Site, _ctx: RenderContext): XmlElement[] {
  return notImplemented('renderFormula (设计 §2.8)', 'T2.4b')
}

export function renderInlineFormula(_formula: IRInlineFormula, _at: Site, _ctx: RenderContext): XmlElement {
  return notImplemented('renderInlineFormula (设计 §2.8)', 'T2.4b')
}
