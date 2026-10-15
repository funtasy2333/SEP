/**
 * DOCX 渲染器入口（docs/wp7-docx-delivery.md §1.3 定稿接口）。
 *
 * 只导出 renderDocx、DocxRenderOptions、DocxPackage。渲染细节（`renderDocxTraced`、
 * `NumberedParagraphTrace`，§4.7 一致性测试用）留在 render.ts，不经这里导出。
 *
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import type { IRDoc, NodeId, ResolvedLabel } from '../../ir/types'
import { renderDocxTraced } from './render'
import type { DocxPackage, DocxRenderOptions, TableContinuation } from './types'

export type { DocxPackage, DocxRenderOptions, TableContinuation }

/** `renderDocx` = `renderDocxTraced(...).pkg`（§1.2） */
export function renderDocx(doc: IRDoc, labels: Record<NodeId, ResolvedLabel>, opts: DocxRenderOptions): DocxPackage {
  return renderDocxTraced(doc, labels, opts).pkg
}
