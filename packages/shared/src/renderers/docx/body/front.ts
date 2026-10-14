/**
 * 目次标题、前言、引言、正文首页名称（docs/wp7-docx-delivery.md §5.1、§5.14、§9 WP7.2 文档结构）。
 *
 * 作用域键（§5.7）用与 Resolver 完全相同的字面量：'front.foreword' / 'front.introduction'
 * （resolve.ts 的 visitBlock(..., 'front.foreword', ...) 等）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRBlock } from '../../../ir/types'
import { renderBlocks } from './block'
import { emitParagraph, warn, type RenderContext } from './context'
import type { DocxBookmark } from '../types'
import { plainRun, spacingRpr, wrapTitleAtSeparator } from './inline'

const SP = '　'
const SPACING_640 = spacingRpr(640)

/** 目次节标题「目次」（WP7.3 在其后加目次域），「目」的 run 带字距 */
export function renderTocTitle(ctx: RenderContext): string {
  return emitParagraph(ctx, 'SesTocTitle', { runsXml: plainRun('目', SPACING_640) + plainRun('次') })
}

export function renderForeword(ctx: RenderContext, blocks: readonly IRBlock[], bookmark?: DocxBookmark): string {
  let out = emitParagraph(ctx, 'SesFrontTitle', { runsXml: plainRun('前', SPACING_640) + plainRun('言'), bookmark })
  out += renderBlocks(ctx, blocks as IRBlock[], { scopeKey: 'front.foreword' })
  return out
}

export function renderIntroduction(ctx: RenderContext, blocks: readonly IRBlock[], bookmark?: DocxBookmark): string {
  let out = emitParagraph(ctx, 'SesFrontTitle', { runsXml: plainRun('引', SPACING_640) + plainRun('言'), bookmark })
  out += renderBlocks(ctx, blocks as IRBlock[], { scopeKey: 'front.introduction' })
  return out
}

/**
 * 正文首页名称（§5.1）：只输出中文名称。多元素之间的全角空格由编辑器/pmToIr 保证，这里只做
 * 首尾清理与半角空格规范化（连续 U+0020 → 一个 U+3000）。meta.title 缺失时输出空段并记
 * cover-field-missing（保持版面位置）。
 */
export function renderBodyTitle(ctx: RenderContext, title: string | undefined): string {
  if (!title) {
    warn(ctx, 'cover-field-missing', 'meta.title 缺失，正文首页名称输出空段')
    return emitParagraph(ctx, 'SesBodyTitle', {})
  }
  const normalized = title.trim().replace(/ +/g, SP)
  return emitParagraph(ctx, 'SesBodyTitle', { runsXml: plainRun(wrapTitleAtSeparator(normalized, 28)) })
}
