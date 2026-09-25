/**
 * 附录渲染（docs/wp7-docx-delivery.md §5.11）。
 *
 * P(SesAppendix, `<w:br/>` + 「（规范性）」或「（资料性）」+ `<w:br/>` + title)：编号「附录A」由
 * A2 L0 生成（字距见 §3.3），三行在同一段落，目次里会合成一行（spike 已验证）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRAppendix } from '../../../ir/types'
import { renderAppendixChildren } from './clause'
import { ABSTRACT_NUM_ID } from '../numbering'
import type { BlockCtx } from './block'
import { emitParagraph, type RenderContext } from './context'
import { breakRun, plainRun, renderInlines } from './inline'

/** @param letter 本附录的字母（Resolver 已算好，如 "A"、"B"），用于 A5/A6 按附录分配实例的 lvlText */
export function renderAppendix(ctx: RenderContext, appendix: IRAppendix, letter: string): string {
  const kindText = appendix.normative ? '（规范性）' : '（资料性）'
  const runs = breakRun() + plainRun(kindText) + breakRun() + renderInlines(appendix.title, ctx.labels)
  let out = emitParagraph(ctx, 'SesAppendix', {
    numPr: { numId: ABSTRACT_NUM_ID.appendixClause, ilvl: 0 },
    runsXml: runs,
    numbered: { nodeId: appendix.id, kind: 'appendix' },
  })
  const bctx: BlockCtx = { scopeKey: appendix.id, appendix: { id: appendix.id, letter } }
  out += renderAppendixChildren(ctx, appendix.children, bctx)
  return out
}
