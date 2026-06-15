/**
 * HTML 语义化导出器（薄壳）。
 *
 * Phase 5.5 / WP4 起，HTML 渲染逻辑迁至 @ses/shared 的同构渲染器：
 *   ProseMirror 文档 → pmToIr → resolve → renderHtml
 * 本文件仅负责把 Tiptap/ProseMirror 文档转为纯 JSON 并调用 shared 渲染器，
 * 保留原 `exportSemanticHtml(doc): string` 签名与导出菜单行为不变。
 *
 * 编号、版式、语义标签等一律由 shared 决定（单一可信源）；客户端不再持有任何编号逻辑。
 */

import type { Node as PMNode } from '@tiptap/pm/model'
import { pmToIr, resolve, renderHtml, type PMJsonNode } from '@ses/shared'

/**
 * 将 ProseMirror 文档导出为语义 HTML（screen 变体，含交叉引用内部链接）。
 *
 * 打印/PDF 用的 print 变体由出件管线（WP5）直接调用 shared 的 renderHtml(variant:'print')，
 * 不经由本函数。
 */
export function exportSemanticHtml(doc: PMNode): string {
  const pmJson = doc.toJSON() as PMJsonNode
  const { doc: ir } = pmToIr(pmJson)
  const { labels } = resolve(ir)
  return renderHtml(ir, labels, { variant: 'screen' })
}
