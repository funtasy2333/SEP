/**
 * 导出前检查（平台无关纯函数）：脚注校验与输出边界检查。
 *
 * 原先内联在 client 的 EditorView 中；抽出后 client 与服务端共用同一套判定和中文提示文本。
 * 提示文本与迁移前逐字一致：编辑器端用户看到的提示不变。
 */

import {
  getOutputSupportProblems,
  pmToIr,
  resolve,
  type IRDoc,
  type PMJsonNode,
} from '@ses/shared'
import type { PMJsonSource } from './docx'

/** 导出入口使用的格式标识；json 为语义 JSON，不做导出前检查。 */
export type ExportGuardFormat = 'docx' | 'pdf' | 'xml' | 'html' | 'json'

/** shared 输出边界检查接受的格式名。 */
export type OutputBoundaryFormat = 'DOCX' | 'HTML' | 'XML'

/** 问题来源：脚注校验，或输出边界（该格式不能无损输出的内容）。 */
export type ExportGuardSource = 'footnote' | 'output-boundary'

export interface ExportGuardProblem {
  source: ExportGuardSource
  /** 脚注校验为 IRProblem.code；输出边界为 'unsupported-output' */
  code: string
  /** 中文，面向最终用户 */
  message: string
  nodeId?: string
  /** 仅输出边界问题带有 IR 路径 */
  path?: string
}

export interface ExportGuardFailure {
  source: ExportGuardSource
  problems: ExportGuardProblem[]
  /** 导出详情文本（编辑器的 exportError）；等于 `summary` 之后接各条明细，文字与结构化字段加入前一致 */
  detail: string
  /** 简短提示文本（编辑器的 ElMessage.error） */
  message: string
  /**
   * 一行概述（不含明细），供编辑器对话框分行显示：先概述，再逐条列出 `items`。
   * 脚注失败为“脚注校验未通过，暂不能导出”；输出边界失败形如“导出被阻止：DOCX 暂未支持 15 处内容”。
   */
  summary: string
  /**
   * 逐条明细，每条一行：与 `detail` 同源（`detail` 即在概述后把各条用“；”连成一段），只是不连接。
   * 脚注问题按提示文字去重；输出边界问题每个问题一条，文末带【节点…，位置…】。
   */
  items: string[]
}

/** 会阻止导出的脚注问题类型（severity 同时须为 error）。 */
const FOOTNOTE_EXPORT_CODES: ReadonlySet<string> = new Set([
  'dangling-footnote',
  'unreferenced-footnote',
  'invalid-footnote',
])

function toPmJson(doc: PMJsonNode | PMJsonSource): PMJsonNode {
  const node = doc as PMJsonSource
  return typeof node.toJSON === 'function' ? node.toJSON() as PMJsonNode : doc as PMJsonNode
}

/** 导出格式 → 输出边界检查格式；json 不检查（返回 undefined），pdf 走 HTML 管线。 */
export function outputBoundaryFormatOf(format: ExportGuardFormat): OutputBoundaryFormat | undefined {
  if (format === 'json') return undefined
  return format === 'docx' ? 'DOCX' : format === 'xml' ? 'XML' : 'HTML'
}

/** 脚注校验：返回会阻止导出的脚注问题。 */
export function getFootnoteExportProblems(doc: IRDoc): ExportGuardProblem[] {
  return resolve(doc).problems
    .filter((problem) => problem.severity === 'error' && FOOTNOTE_EXPORT_CODES.has(problem.code))
    .map((problem) => ({
      source: 'footnote' as const,
      code: problem.code,
      message: problem.message,
      nodeId: problem.nodeId ?? undefined,
    }))
}

/** 脚注校验提示的概述（不含明细）。 */
const FOOTNOTE_EXPORT_SUMMARY = '脚注校验未通过，暂不能导出'

/** 脚注校验的逐条明细：按提示文字去重，保持问题出现的顺序；无问题时为空数组。 */
export function getFootnoteExportItems(problems: readonly ExportGuardProblem[]): string[] {
  return [...new Set(problems.map((problem) => problem.message))]
}

/** 脚注校验提示文本；无问题时返回空字符串。 */
export function formatFootnoteExportError(problems: readonly ExportGuardProblem[]): string {
  if (!problems.length) return ''
  return `${FOOTNOTE_EXPORT_SUMMARY}：${getFootnoteExportItems(problems).join('；')}`
}

/** 对 ProseMirror 文档（JSON 或带 toJSON() 的节点）做脚注校验，返回提示文本；通过时为空字符串。 */
export function getFootnoteExportError(doc: PMJsonNode | PMJsonSource): string {
  const { doc: irDoc } = pmToIr(toPmJson(doc))
  return formatFootnoteExportError(getFootnoteExportProblems(irDoc))
}

/** 输出边界检查：json 不检查；pdf 按 HTML 管线检查。 */
export function getOutputBoundaryProblems(doc: IRDoc, format: ExportGuardFormat): ExportGuardProblem[] {
  const boundaryFormat = outputBoundaryFormatOf(format)
  if (!boundaryFormat) return []
  return getOutputSupportProblems(doc, boundaryFormat).map((problem) => ({
    source: 'output-boundary' as const,
    code: problem.code,
    message: problem.message,
    nodeId: problem.nodeId,
    path: problem.path,
  }))
}

/** 输出边界问题的逐条明细：每个问题一条，文末带【节点…，位置…】；无问题时为空数组。 */
export function getOutputBoundaryItems(problems: readonly ExportGuardProblem[]): string[] {
  return problems.map((problem) => {
    const location = [
      problem.nodeId ? `节点 ${problem.nodeId}` : '',
      problem.path ? `位置 ${problem.path}` : '',
    ].filter(Boolean).join('，')
    return `${problem.message}${location ? `【${location}】` : ''}`
  })
}

/** 输出边界问题的导出详情文本；无问题时返回空字符串。 */
export function formatOutputBoundaryDetail(problems: readonly ExportGuardProblem[]): string {
  if (!problems.length) return ''
  return `导出被阻止：${getOutputBoundaryItems(problems).join('；')}`
}

/** 输出边界问题的一行概述，如“导出被阻止：DOCX 暂未支持 15 处内容”；无问题时返回空字符串。 */
export function formatOutputBoundarySummary(
  problems: readonly ExportGuardProblem[],
  format: ExportGuardFormat,
): string {
  if (!problems.length) return ''
  return `导出被阻止：${format.toUpperCase()} 暂未支持 ${problems.length} 处内容`
}

/** 输出边界问题的简短提示文本；无问题时返回空字符串。 */
export function formatOutputBoundaryMessage(problems: readonly ExportGuardProblem[]): string {
  if (!problems.length) return ''
  const firstProblem = problems[0]!
  return problems.length > 1
    ? `导出被阻止：${firstProblem.message}（另有 ${problems.length - 1} 项，详见导出详情）`
    : `导出被阻止：${firstProblem.message}`
}

/**
 * 导出前两道检查：先脚注校验，再输出边界检查；任一未通过即返回失败信息，全部通过返回 null。
 * json 格式两道检查都跳过。
 */
export function checkExportGuard(doc: PMJsonNode | PMJsonSource, format: ExportGuardFormat): ExportGuardFailure | null {
  if (format === 'json') return null
  const { doc: irDoc } = pmToIr(toPmJson(doc))

  const footnoteProblems = getFootnoteExportProblems(irDoc)
  if (footnoteProblems.length) {
    const text = formatFootnoteExportError(footnoteProblems)
    return {
      source: 'footnote',
      problems: footnoteProblems,
      detail: text,
      message: text,
      summary: FOOTNOTE_EXPORT_SUMMARY,
      items: getFootnoteExportItems(footnoteProblems),
    }
  }

  const outputProblems = getOutputBoundaryProblems(irDoc, format)
  if (outputProblems.length) {
    return {
      source: 'output-boundary',
      problems: outputProblems,
      detail: formatOutputBoundaryDetail(outputProblems),
      message: formatOutputBoundaryMessage(outputProblems),
      summary: formatOutputBoundarySummary(outputProblems, format),
      items: getOutputBoundaryItems(outputProblems),
    }
  }
  return null
}
