/**
 * 封面（docs/wp7-docx-delivery.md §6；WP7.2 为占位，只有文件编号段）。
 *
 * §9 WP7.2 文档结构第 1 项：一个 P(SesCoverStdNo, `meta.stdCode`)；`stdCode` 缺失时输出空段
 * 并记 `cover-field-missing`。WP7.5 会替换封面节的其余内容，但必须保留这个段落——它是书眉
 * `STYLEREF` 的取值来源（§2.3）。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import { emitParagraph, warn, type RenderContext } from './body/context'
import { plainRun } from './body/inline'

export function renderCoverPlaceholder(ctx: RenderContext, stdCode: string | undefined): string {
  if (!stdCode) {
    warn(ctx, 'cover-field-missing', 'meta.stdCode 缺失，封面文件编号段输出空段')
    return emitParagraph(ctx, 'SesCoverStdNo', {})
  }
  return emitParagraph(ctx, 'SesCoverStdNo', { runsXml: plainRun(stdCode) })
}
