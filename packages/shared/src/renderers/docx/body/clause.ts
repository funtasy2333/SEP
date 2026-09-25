/**
 * 章、条渲染（docs/wp7-docx-delivery.md §5.2、§5.3）。
 *
 * 条的编号级别取嵌套深度（章的直属条为 1，其子条为 2……），不用 `IRClause.level`
 * （那只用来报 heading-skip，§4.4）。附录中的条把 SesClause/SesNoTitle 换成
 * SesAppClause/SesAppNoTitle、A1 换成 A2（由 `bctx.appendix` 是否存在决定）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRChapter, IRChapterChild, IRClause, IRClauseChild } from '../../../ir/types'
import { ABSTRACT_NUM_ID } from '../numbering'
import { renderBlock, type BlockCtx } from './block'
import { emitParagraph, warn, type RenderContext } from './context'
import { renderInlines } from './inline'
import { renderTermEntry } from './termEntry'

/** 渲染一组「同一容器直属」的子节点（章/条/附录的 children）：条与术语条目的级别 = containerDepth + 1 */
function renderContainerChildren(ctx: RenderContext, children: readonly (IRClauseChild | IRChapterChild)[], bctx: BlockCtx, containerDepth: number): string {
  const childLevel = containerDepth + 1
  let out = ''
  for (const child of children) {
    if (child.kind === 'clause') out += renderClause(ctx, child, bctx, childLevel)
    else if (child.kind === 'termEntry') out += renderTermEntry(ctx, child, bctx, childLevel)
    else out += renderBlock(ctx, child, bctx)
  }
  return out
}

export function renderClause(ctx: RenderContext, clause: IRClause, bctx: BlockCtx, rawLevel: number): string {
  let level = rawLevel
  if (level > 5) {
    warn(ctx, 'clause-too-deep', `条 "${clause.id}" 的编号级别超过 5（嵌套深度 ${rawLevel}），按 5 级输出`, clause.id)
    level = 5
  }
  const isAppendix = !!bctx.appendix
  const numId = isAppendix ? ABSTRACT_NUM_ID.appendixClause : ABSTRACT_NUM_ID.chapter
  const numbered = { nodeId: clause.id, kind: 'clause' as const }

  // §5.7：条的直属块作用域 = 该条自己的 id（不是外层章/条的 id），条内注/示例分组据此独立计数
  const innerBctx: BlockCtx = { ...bctx, scopeKey: clause.id }

  if (clause.titled) {
    const styleId = isAppendix ? `SesAppClause${level}` : `SesClause${level}`
    let out = emitParagraph(ctx, styleId, { runsXml: renderInlines(clause.title, ctx.labels), numbered })
    out += renderContainerChildren(ctx, clause.children, innerBctx, level)
    return out
  }

  // 无标题条（§5.3、GB/T 1.1 5.3.3.6）
  const noTitleStyleId = isAppendix ? `SesAppNoTitle${level}` : `SesNoTitle${level}`
  const numPr = { numId, ilvl: level }
  const [first, ...rest] = clause.children
  if (first && first.kind === 'paragraph') {
    let out = emitParagraph(ctx, noTitleStyleId, { numPr, runsXml: renderInlines(first.content, ctx.labels), numbered })
    out += renderContainerChildren(ctx, rest, innerBctx, level)
    return out
  }
  let out = emitParagraph(ctx, noTitleStyleId, { numPr, numbered })
  out += renderContainerChildren(ctx, clause.children, innerBctx, level)
  return out
}

export function renderChapter(ctx: RenderContext, chapter: IRChapter): string {
  let out = emitParagraph(ctx, 'SesChapter', {
    runsXml: renderInlines(chapter.title, ctx.labels),
    numbered: { nodeId: chapter.id, kind: 'chapter' },
  })
  const bctx: BlockCtx = { scopeKey: chapter.id }
  out += renderContainerChildren(ctx, chapter.children, bctx, 0)
  return out
}

/** 附录的直属子节点渲染入口（§5.11 用）：与章相同的机制，只是从 containerDepth=0 开始、bctx.appendix 已设置 */
export function renderAppendixChildren(ctx: RenderContext, children: readonly IRClauseChild[], bctx: BlockCtx): string {
  return renderContainerChildren(ctx, children, bctx, 0)
}
