/**
 * 术语条目渲染（docs/wp7-docx-delivery.md §5.4）。
 *
 * 顺序：编号 → 术语 → 定义 → 示例 → 注 → 来源（8.7.3.1、9.11.1；HTML/PDF 渲染器把来源放在
 * 注、示例之前，PDF 已冻结、不回改，这里按本规格新顺序实现）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRTermEntry } from '../../../ir/types'
import { ABSTRACT_NUM_ID } from '../numbering'
import { renderBlocks, type BlockCtx } from './block'
import { emitParagraph, warn, type RenderContext } from './context'
import { plainRun, renderInlines } from './inline'

const SP = '　'

/**
 * @param level 已经算好的编号级别（= 父节点深度 + 1，由调用方按 §4.4 统一计算并做 5 级上限处理；
 *   这里只负责渲染，不重复计算——章/条的级别推导集中在 clause.ts，避免两处逻辑跑偏）。
 */
export function renderTermEntry(ctx: RenderContext, entry: IRTermEntry, bctx: BlockCtx, level: number, inTermsChapter: boolean): string {
  const clampedLevel = Math.min(level, 5)
  if (level > 5) {
    warn(ctx, 'clause-too-deep', `术语条目 "${entry.id}" 的编号级别超过 5（${level}），按 5 级输出`, entry.id)
  }
  const numId = bctx.appendix ? ABSTRACT_NUM_ID.appendixClause : ABSTRACT_NUM_ID.chapter

  // 术语和定义章遵照 10.3.5：编号独占一行，术语另行空两个汉字起排。
  // 其他章节/附录中的测试用术语条目按用户验收要求与编号同排。
  const termRuns = renderInlines(entry.term, ctx.labels)
  const termEnRuns = entry.termEn && entry.termEn.length > 0 ? plainRun(SP) + renderInlines(entry.termEn, ctx.labels) : ''
  let out = emitParagraph(ctx, 'SesTermNum', {
    numPr: { numId, ilvl: clampedLevel },
    numbered: { nodeId: entry.id, kind: 'termEntry' },
    runsXml: inTermsChapter ? undefined : termRuns + termEnRuns,
  })

  if (inTermsChapter) out += emitParagraph(ctx, 'SesTermHead', { runsXml: termRuns + termEnRuns })

  // ③–⑥ 定义 → 示例 → 注 → 来源；作用域键统一为本术语条目的 id（§5.7）
  const innerBctx: BlockCtx = { ...bctx, scopeKey: entry.id }
  out += renderBlocks(ctx, entry.definition, innerBctx)
  out += renderBlocks(ctx, entry.examples, innerBctx)
  out += renderBlocks(ctx, entry.notes, innerBctx)

  if (entry.source && entry.source.length > 0) {
    out += emitParagraph(ctx, 'SesTermSource', { runsXml: renderInlines(entry.source, ctx.labels) })
  }
  return out
}
