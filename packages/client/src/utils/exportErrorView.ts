import type { ExportGuardFailure } from '@ses/io'

/** 导出对话框中错误提示的显示形态：一行概述，加上逐条列出的明细（可为空）。 */
export interface ExportErrorView {
  summary: string
  items: string[]
}

/**
 * 导出前检查未通过时，把 @ses/io 的失败信息整理成对话框显示形态：概述一行，明细逐条一行。
 *
 * 概述或明细缺失时退回 `detail`（连成一段的原文），保证任何情况下都有可读的提示；
 * 明细逐条去掉首尾空白并丢弃空条目，不做合并或截断（条数多时由对话框内部滚动承载）。
 */
export function exportErrorViewOf(
  failure: Pick<ExportGuardFailure, 'summary' | 'items' | 'detail'>,
): ExportErrorView {
  const items = failure.items.map((item) => item.trim()).filter(Boolean)
  const summary = failure.summary.trim()
  if (!summary || !items.length) return { summary: failure.detail, items: [] }
  return { summary, items }
}

/** 只有一段文字的错误（导出失败、服务器转换失败等）：没有明细。 */
export function exportErrorViewOfText(text: string): ExportErrorView {
  return { summary: text, items: [] }
}
