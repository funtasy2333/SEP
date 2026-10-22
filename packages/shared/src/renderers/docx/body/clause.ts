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
import { emitParagraph, formulaSink, warn, type RenderContext } from './context'
import { renderInlines } from './inline'
import { renderTermEntry } from './termEntry'

/** 渲染一组「同一容器直属」的子节点（章/条/附录的 children）：条与术语条目的级别 = containerDepth + 1 */
function renderContainerChildren(ctx: RenderContext, children: readonly (IRClauseChild | IRChapterChild)[], bctx: BlockCtx, containerDepth: number, inTermsChapter: boolean): string {
  const childLevel = containerDepth + 1
  let out = ''
  for (const child of children) {
    if (child.kind === 'clause') out += renderClause(ctx, child, bctx, childLevel, inTermsChapter)
    else if (child.kind === 'termEntry') out += renderTermEntry(ctx, child, bctx, childLevel, inTermsChapter)
    else out += renderBlock(ctx, child, bctx)
  }
  return out
}

export function renderClause(ctx: RenderContext, clause: IRClause, bctx: BlockCtx, rawLevel: number, inTermsChapter = false): string {
  let level = rawLevel
  if (level > 5) {
    warn(ctx, 'clause-too-deep', `条 "${clause.id}" 的编号级别超过 5（嵌套深度 ${rawLevel}），按 5 级输出`, clause.id)
    level = 5
  }
  const isAppendix = !!bctx.appendix
  // 引言中的条（WP8.M G6）：A17 按需实例，显示 0.1、0.1.1……，不占用章条 A1 的计数器
  const isIntroduction = !!bctx.introduction
  const numId = isIntroduction ? ctx.numbering.allocIntroClauseInstance()
    : isAppendix ? ABSTRACT_NUM_ID.appendixClause : ABSTRACT_NUM_ID.chapter
  const numbered = { nodeId: clause.id, kind: 'clause' as const }

  // §5.7：条的直属块作用域 = 该条自己的 id（不是外层章/条的 id），条内注/示例分组据此独立计数
  const innerBctx: BlockCtx = { ...bctx, scopeKey: clause.id }

  if (clause.titled) {
    const styleId = isAppendix ? `SesAppClause${level}` : `SesClause${level}`
    // 引言条沿用 SesClause{L} 的字体字号（五号黑体）与缩进，只把段落级 numPr 改指向 A17 实例
    let out = emitParagraph(ctx, styleId, {
      runsXml: renderInlines(clause.title, ctx.labels), numbered,
      ...(isIntroduction ? { numPr: { numId, ilvl: level } } : {}),
    })
    out += renderContainerChildren(ctx, clause.children, innerBctx, level, inTermsChapter)
    return out
  }

  // 无标题条（§5.3、GB/T 1.1 5.3.3.6）
  const noTitleStyleId = isAppendix ? `SesAppNoTitle${level}` : `SesNoTitle${level}`
  const numPr = { numId, ilvl: level }
  const [first, ...rest] = clause.children
  if (first && first.kind === 'paragraph') {
    let out = emitParagraph(ctx, noTitleStyleId, { numPr, runsXml: renderInlines(first.content, ctx.labels, formulaSink(ctx)), numbered })
    out += renderContainerChildren(ctx, rest, innerBctx, level, inTermsChapter)
    return out
  }
  let out = emitParagraph(ctx, noTitleStyleId, { numPr, numbered })
  out += renderContainerChildren(ctx, clause.children, innerBctx, level, inTermsChapter)
  return out
}

/**
 * 引言中的条（8.4）：引言本身不编号，直属条的级别为 1（容器深度 0 + 1），编号 0.1、0.2…，子条 0.1.1…；
 * 作用域键沿用引言的 'front.introduction'（与 Resolver 一致），条内的注/示例以条自己的 id 分组。
 */
export function renderIntroductionClauses(ctx: RenderContext, clauses: readonly IRClause[]): string {
  const bctx: BlockCtx = { scopeKey: 'front.introduction', introduction: true }
  return clauses.map(clause => renderClause(ctx, clause, bctx, 1)).join('')
}

export function renderChapter(ctx: RenderContext, chapter: IRChapter): string {
  let out = emitParagraph(ctx, 'SesChapter', {
    runsXml: renderInlines(chapter.title, ctx.labels),
    numbered: { nodeId: chapter.id, kind: 'chapter' },
  })
  const bctx: BlockCtx = { scopeKey: chapter.id }
  out += renderContainerChildren(ctx, chapter.children, bctx, 0, chapter.secType === 'terms')
  return out
}

/** 附录的直属子节点渲染入口（§5.11 用）：与章相同的机制，只是从 containerDepth=0 开始、bctx.appendix 已设置 */
export function renderAppendixChildren(ctx: RenderContext, children: readonly IRClauseChild[], bctx: BlockCtx): string {
  return renderContainerChildren(ctx, children, bctx, 0, false)
}
