/**
 * 规范性引用文件清单渲染（docs/wp7-docx-delivery.md §5.12a，WP8.M G1；GB/T 1.1—2020 10.3.4）。
 *
 * 每项一段，样式 SesPara（宋体五号、首行缩进 2 字 = 420 twips、回行顶格）——10.3.4 的“空两个汉字起排，
 * 回行时顶格编排”与段的版式完全相同，不新增样式（styles.xml 对没有该清单的文档保持不变）。
 * 标准化文件条目：文件编号 + 一个汉字（U+3000）的间隔 + 文件名称；间隔是版式要求，不入 IR 内容。
 * 非标准化文件条目：保持原有格式，原样输出。文件之后不加标点：渲染器不追加任何字符，也不剥离作者内容。
 * 条目之前不给序号（8.6.3.1），因此没有编号追踪（numbered）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRNormRef, IRNormRefList } from '../../../ir/types'
import { emitParagraph, type RenderContext } from './context'
import { plainRun, renderInlines } from './inline'

/** 一个汉字的间隙（10.3.4：文件编号或“（所有部分）”与文件名称之间） */
const IDEOGRAPHIC_SPACE = '　'

function entryRuns(ctx: RenderContext, entry: IRNormRef): string {
  if (entry.entryType === 'mixed') return renderInlines(entry.content, ctx.labels)
  const ref = renderInlines(entry.ref, ctx.labels)
  const title = renderInlines(entry.title, ctx.labels)
  // 任一段为空时不输出多余的间隔（既不以空格开头，也不以空格结尾）
  return ref && title ? ref + plainRun(IDEOGRAPHIC_SPACE) + title : ref + title
}

export function renderNormRefList(ctx: RenderContext, list: IRNormRefList): string {
  return list.entries.map((entry) => emitParagraph(ctx, 'SesPara', { runsXml: entryRuns(ctx, entry) })).join('')
}
