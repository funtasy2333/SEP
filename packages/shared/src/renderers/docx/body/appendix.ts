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
import type { BlockCtx } from './block'
import { emitParagraph, type RenderContext } from './context'
import { breakRun, plainRun, renderInlines } from './inline'

/**
 * @param letter 本附录的字母（Resolver 已算好，如 "A"、"B"），用于 A5/A6 按附录分配实例的 lvlText
 *
 * SesAppendix 是 A2 L0 的属主样式（styles.ts 已写了样式级 numPr），这里不再重复写段落级
 * numPr——两者指向同一个 (numId, ilvl) 属于多余的直接格式（#34 审查，对照 SesChapter 的段落
 * 同样不写 numPr）。`numbered` 仍要传，emitParagraph 才会把这段记入 §4.7 的追踪。
 */
export function renderAppendix(ctx: RenderContext, appendix: IRAppendix, letter: string): string {
  const kindText = appendix.normative ? '（规范性）' : '（资料性）'
  const runs = breakRun() + plainRun(kindText) + breakRun() + renderInlines(appendix.title, ctx.labels)
  let out = emitParagraph(ctx, 'SesAppendix', {
    runsXml: runs,
    numbered: { nodeId: appendix.id, kind: 'appendix' },
  })
  const bctx: BlockCtx = { scopeKey: appendix.id, appendix: { id: appendix.id, letter } }
  out += renderAppendixChildren(ctx, appendix.children, bctx)
  return out
}
