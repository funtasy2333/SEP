/**
 * DOCX 公式与「式中」渲染（docs/wp7-docx-delivery.md §5.10）。
 *
 * OMML 由调用方在 client 侧生成并注入；本模块保持 shared 的同构、无浏览器依赖约束。
 */

import type { IRFormula, NodeId } from '../../../ir/types'
import { RPR_SONG } from '../numbering'
import { pPr } from '../xml'
import { emitParagraph, warn, type RenderContext } from './context'
import { plainRun, renderInlines, tabRun } from './inline'

const TWIPS_PER_CHAR = 210
const HANGING_INDENT_TWIPS = 420

function fullWidthFormulaLabel(label: string): string {
  const wrapped = /^(?:\((.*)\)|（(.*)）)$/.exec(label)
  const inner = wrapped ? (wrapped[1] ?? wrapped[2]) : label
  return `（${inner}）`
}

/** ASCII 字符按半个汉字估算，其余 Unicode 码点按一个汉字估算（§5.10）。 */
function symbolWidth(inlines: IRFormula['whereList'][number]['term']): number {
  let width = 0
  for (const run of inlines) {
    for (const char of run.text) width += /^[\x00-\x7f]$/.test(char) ? 0.5 : 1
  }
  return width
}

function whereItemParagraph(
  ctx: RenderContext,
  item: IRFormula['whereList'][number],
  tabPosition: number,
): string {
  const leftIndent = tabPosition + HANGING_INDENT_TWIPS
  const ppr = pPr([
    ['pStyle', '<w:pStyle w:val="SesWhereItem"/>'],
    ['tabs', `<w:tabs><w:tab w:val="left" w:pos="${tabPosition}"/></w:tabs>`],
    ['ind', `<w:ind w:left="${leftIndent}" w:hanging="${tabPosition}"/>`],
  ])
  return `<w:p>${ppr}${renderInlines(item.term, ctx.labels)}${tabRun()}${plainRun('——')}${renderInlines(item.definition, ctx.labels)}</w:p>`
}

/**
 * 返回公式及其「式中」段落 XML。`formulaOmml` 缺失或为空时按 LaTeX 源码降级并记 warning。
 * 本函数不创建编号：公式编号来自 Resolver 的 labels，按 §4.5 以文字输出。
 */
export function renderFormula(
  ctx: RenderContext,
  formula: IRFormula,
  formulaOmml?: string,
): string {
  let runs = tabRun()
  if (formulaOmml) {
    runs += formulaOmml
  } else {
    runs += plainRun(formula.latex)
    warn(ctx, 'formula-missing-omml', `公式 "${formula.id}" 缺少 OMML，已回退为 LaTeX 源码文本`, formula.id)
  }

  if (formula.numbered) {
    const label = ctx.labels[formula.id]?.label
    if (label === undefined) {
      warn(ctx, 'label-missing', `公式 "${formula.id}" 需要编号但 labels 中没有 label，不写编号`, formula.id)
    } else {
      runs += tabRun() + plainRun(fullWidthFormulaLabel(label), RPR_SONG)
    }
  }

  let out = emitParagraph(ctx, 'SesFormula', { runsXml: runs })
  if (formula.whereList.length > 0) {
    out += emitParagraph(ctx, 'SesWhereLabel', { runsXml: plainRun('式中：') })
    const maxSymbolWidth = Math.max(...formula.whereList.map((item) => symbolWidth(item.term)), 0)
    const tabPosition = HANGING_INDENT_TWIPS + Math.ceil(maxSymbolWidth * TWIPS_PER_CHAR) + TWIPS_PER_CHAR
    for (const item of formula.whereList) out += whereItemParagraph(ctx, item, tabPosition)
  }
  return out
}

/** 便于调用方按 IRFormula.id 查找 OMML；与宿主资源表类型保持一致。 */
export type FormulaOmmlMap = Record<NodeId, string>
