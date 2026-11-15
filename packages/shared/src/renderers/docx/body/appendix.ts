/**
 * 附录渲染（docs/wp7-docx-delivery.md §5.11）。
 *
 * 附录编号、性质、标题各占一段。编号「附录A」仍由 A2 L0 生成（字距见 §3.3）；
 * 后两行改用不带编号的居中样式，避免 Word 将它们偏移到编号悬挂区的右侧。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRAppendix, IRClauseChild } from '../../../ir/types'
import { renderAppendixChildren } from './clause'
import type { BlockCtx } from './block'
import { emitParagraph, type RenderContext } from './context'
import { plainRun, renderInlines } from './inline'

/**
 * 横向附录中的表、图按横排版心计算列宽、图宽与分页预算（与 HTML/PDF 中占满横页版心一致）。
 * 只改渲染用的副本，不改传入的 IR。
 */
function landscapeChildren(children: readonly IRClauseChild[]): IRClauseChild[] {
  return children.map((child) => {
    if (child.kind === 'clause') return { ...child, children: landscapeChildren(child.children) }
    if (child.kind === 'table' || child.kind === 'figure') return { ...child, orientation: 'landscape' }
    return child
  })
}

/**
 * @param letter 本附录的字母（Resolver 已算好，如 "A"、"B"），用于 A5/A6 按附录分配实例的 lvlText
 *
 * SesAppendix 是 A2 L0 的属主样式（styles.ts 已写了样式级 numPr），这里不再重复写段落级
 * numPr——两者指向同一个 (numId, ilvl) 属于多余的直接格式（#34 审查，对照 SesChapter 的段落
 * 同样不写 numPr）。`numbered` 仍要传，emitParagraph 才会把这段记入 §4.7 的追踪。
 */
export function renderAppendix(ctx: RenderContext, appendix: IRAppendix, letter: string): string {
  const kindText = appendix.normative ? '（规范性）' : '（资料性）'
  let out = emitParagraph(ctx, 'SesAppendix', {
    numbered: { nodeId: appendix.id, kind: 'appendix' },
  })
  out += emitParagraph(ctx, 'SesAppendixKind', { runsXml: plainRun(kindText) })
  out += emitParagraph(ctx, 'SesAppendixTitle', { runsXml: renderInlines(appendix.title, ctx.labels) })
  // 横向附录（#75）整节已是横页：内部横排图表不得再插分节标记，否则会拆出新节并在其后回到竖页。
  const bctx: BlockCtx = {
    scopeKey: appendix.id,
    appendix: { id: appendix.id, letter },
    ...(appendix.orientation === 'landscape' ? { suppressLandscape: true, maxWidthMm: 252 } : {}),
  }
  out += renderAppendixChildren(ctx, appendix.orientation === 'landscape' ? landscapeChildren(appendix.children) : appendix.children, bctx)
  return out
}
