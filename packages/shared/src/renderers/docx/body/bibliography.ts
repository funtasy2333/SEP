/**
 * 参考文献渲染（docs/wp7-docx-delivery.md §5.12）。
 *
 * 按 Resolver 赋的序号输出：`renderDocx` 拿不到 `bibliographyOrder`，按 `labels[id].xmlId`
 * （`bib_<n>`）中的 n 升序排列 `doc.bibliography`，没有 label 的排在最后并保持原顺序。
 * content 里已写了编号前缀（如「[9] 」）时先剥掉，避免排成「[1]　[9] ……」。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRBibEntry, IRInline, NodeId } from '../../../ir/types'
import type { DocxBookmark } from '../types'
import { emitParagraph, type RenderContext } from './context'
import { plainRun, renderInlines, spacingRpr } from './inline'

const BIB_PREFIX_RE = /^\s*[[［]\d+[\]］]\s*/

/**
 * 剥离已写死的编号前缀（§5.12）：
 * 1. 各 run 的 text 拼成一串，匹配前缀正则；不匹配原样返回；
 * 2. 按匹配长度 L 从 run 序列开头删掉共 L 个字符：完全落在前缀内的 run 整个去掉；跨过前缀末尾的
 *    run 只保留前缀之后的部分（marks 不变）；其后的 run 原样保留；
 * 3. 前缀范围内有 crossRef run 时不剥离，原样输出。
 */
export function stripBibPrefix(content: IRInline[]): IRInline[] {
  const concatenated = content.map((r) => r.text).join('')
  const match = BIB_PREFIX_RE.exec(concatenated)
  if (!match) return content
  const prefixLen = match[0].length

  const out: IRInline[] = []
  let offset = 0
  let crossRefInPrefix = false
  for (const run of content) {
    const runStart = offset
    const runEnd = offset + run.text.length
    offset = runEnd
    const overlapsPrefix = runStart < prefixLen
    if (overlapsPrefix && (run.marks ?? []).some((m) => m.type === 'crossRef')) {
      crossRefInPrefix = true
    }
    if (runEnd <= prefixLen) continue // 完全落在前缀内：去掉
    if (runStart >= prefixLen) {
      out.push(run) // 完全在前缀之后：原样保留
    } else {
      out.push({ text: run.text.slice(prefixLen - runStart), marks: run.marks }) // 跨过前缀末尾：只保留之后的部分
    }
  }
  return crossRefInPrefix ? content : out
}

/** bib_<n> 中的 n；没有 label 时排到最后（保持原顺序，用 Number.MAX_SAFE_INTEGER 兜底） */
function bibSeq(ctx: RenderContext, id: NodeId): number {
  const m = /(\d+)$/.exec(ctx.labels[id]?.xmlId ?? '')
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

/** 「参考文献」标题：参、考、文三个 run 各带 spacing 210，献不带（§3.3） */
function bibTitleRuns(): string {
  const spacing = spacingRpr(210)
  return plainRun('参', spacing) + plainRun('考', spacing) + plainRun('文', spacing) + plainRun('献')
}

/**
 * 自定义参考文献标题（M-4.5.3-02）。纯文本标题与默认标题同一版式：逐字加 1 个字宽的字符间距、最后一个字不加（§3.3）；
 * 带格式/脚注/引用的标题按行内渲染，不加字距（字符间距与 marks 的叠加没有定义）。
 */
function customBibTitleRuns(ctx: RenderContext, title: readonly IRInline[]): string {
  const plain = title.every((run) => !run.marks?.length && !run.style && !run.formula && !run.footnote)
  if (!plain) return renderInlines([...title], ctx.labels)
  const chars = [...title.map((run) => run.text).join('')]
  const spacing = spacingRpr(210)
  return chars.map((char, index) => plainRun(char, index < chars.length - 1 ? spacing : '')).join('')
}

export function renderBibliography(
  ctx: RenderContext, entries: readonly IRBibEntry[], titleBookmark?: DocxBookmark, title?: readonly IRInline[],
): string {
  if (entries.length === 0) return ''
  const titleRuns = title?.length ? customBibTitleRuns(ctx, title) : bibTitleRuns()
  let out = emitParagraph(ctx, 'SesBibTitle', { runsXml: titleRuns, bookmark: titleBookmark })

  // 没有 label 的排在最后并保持原顺序：Array.prototype.sort 是稳定排序（ES2019+），
  // MAX_SAFE_INTEGER 相同的条目之间天然保持原始相对顺序。
  const ordered = [...entries].sort((a, b) => bibSeq(ctx, a.id) - bibSeq(ctx, b.id))
  for (const entry of ordered) {
    const content = stripBibPrefix(entry.content)
    out += emitParagraph(ctx, 'SesBibEntry', {
      runsXml: renderInlines(content, ctx.labels),
      numbered: { nodeId: entry.id, kind: 'bibEntry' },
    })
  }
  return out
}
