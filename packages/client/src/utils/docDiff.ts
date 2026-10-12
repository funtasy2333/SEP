/**
 * 文档差异比对工具
 * 将 ProseMirror JSON 文档转为结构化文本，然后进行逐行 diff
 */

import { diffLines, type Change } from 'diff'
import { semanticLabels } from './semanticLabels'
import type { PMJsonNode } from '@ses/shared'

/** 差异行类型 */
export type DiffLineType = 'added' | 'removed' | 'unchanged'

/** 差异行 */
export interface DiffLine {
  type: DiffLineType
  text: string
  /** 左侧行号（旧版本） */
  oldLineNo?: number
  /** 右侧行号（新版本） */
  newLineNo?: number
}

/** 差异统计 */
export interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

/** 差异结果 */
export interface DiffResult {
  lines: DiffLine[]
  stats: DiffStats
}

/**
 * 将 ProseMirror JSON 文档转为可读的结构化纯文本
 * 保留标题层级和缩进，方便 diff
 */
export function docToText(doc: Record<string, unknown>): string {
  const lines: string[] = []
  const content = doc.content as Array<Record<string, unknown>> | undefined
  if (!content) return ''

  const ctx = semanticLabels(doc as unknown as PMJsonNode)

  for (const node of content) {
    nodeToText(node, lines, 0, ctx)
  }

  return lines.join('\n')
}

type NumberingContext = ReturnType<typeof semanticLabels>

function nodeToText(
  node: Record<string, unknown>,
  lines: string[],
  depth: number,
  ctx: NumberingContext,
) {
  const type = node.type as string
  const attrs = (node.attrs || {}) as Record<string, unknown>
  const content = node.content as Array<Record<string, unknown>> | undefined
  const indent = '  '.repeat(depth)

  switch (type) {
    case 'foreword':
      lines.push(`${indent}[前言]`)
      if (content) content.forEach(c => nodeToText(c, lines, depth + 1, ctx))
      lines.push('')
      break

    case 'introduction':
      lines.push(`${indent}[引言]`)
      if (content) content.forEach(c => nodeToText(c, lines, depth + 1, ctx))
      lines.push('')
      break

    case 'chapter': {
      const title = extractTitle(content, 'chapterTitle')
      lines.push(`${indent}${ctx.labelFor(node as unknown as PMJsonNode)} ${title}`)
      if (content) {
        for (const c of content) {
          if ((c.type as string) !== 'chapterTitle') {
            nodeToText(c, lines, depth + 1, ctx)
          }
        }
      }
      lines.push('')
      break
    }

    case 'clause': {
      const numStr = ctx.labelFor(node as unknown as PMJsonNode)
      const hasTitle = attrs.hasTitle !== false
      const title = extractTitle(content, 'clauseTitle')
      if (hasTitle) {
        lines.push(`${indent}${numStr} ${title}`)
      } else {
        lines.push(`${indent}${numStr} [无题条] ${title}`)
      }
      if (content) {
        for (const c of content) {
          if ((c.type as string) !== 'clauseTitle') {
            nodeToText(c, lines, depth + 1, ctx)
          }
        }
      }
      break
    }

    case 'termDef': {
      const numStr = ctx.labelFor(node as unknown as PMJsonNode)
      const termName = extractTitle(content, 'termName')
      const termNameEn = extractTitle(content, 'termNameEn')
      const termDef = extractTitle(content, 'termDefinition')
      lines.push(`${indent}${numStr} ${termName}`)
      if (termNameEn) lines.push(`${indent}  ${termNameEn}`)
      if (termDef) lines.push(`${indent}  ${termDef}`)
      if (content) {
        for (const c of content) {
          const ct = c.type as string
          if (!['termName', 'termNameEn', 'termDefinition'].includes(ct)) {
            nodeToText(c, lines, depth + 1, ctx)
          }
        }
      }
      break
    }

    case 'appendix': {
      const appendixLabel = ctx.labelFor(node as unknown as PMJsonNode)
      const normative = attrs.normative ? '（规范性）' : '（资料性）'
      const title = extractTitle(content, 'appendixTitle')
      lines.push(`${indent}${appendixLabel}${normative}`)
      lines.push(`${indent}${title}`)
      if (content) {
        for (const c of content) {
          const ct = c.type as string
          if (ct !== 'appendixLabel' && ct !== 'appendixTitle') {
            nodeToText(c, lines, depth + 1, ctx)
          }
        }
      }
      lines.push('')
      break
    }

    case 'bibliography': {
      const title = extractTitle(content, 'bibliographyTitle')
      lines.push(`${indent}[${title || '参考文献'}]`)
      if (content) {
        for (const c of content) {
          if ((c.type as string) === 'bibEntry') {
            lines.push(`${indent}  ${ctx.labelFor(c as unknown as PMJsonNode)} ${extractText(c)}`)
          }
        }
      }
      lines.push('')
      break
    }

    case 'stdParagraph':
    case 'paragraph': {
      const text = extractText(node)
      if (text) lines.push(`${indent}${text}`)
      break
    }

    case 'note': {
      const text = extractText(node)
      lines.push(`${indent}注：${text}`)
      break
    }

    case 'example': {
      const text = extractText(node)
      lines.push(`${indent}示例：${text}`)
      break
    }

    case 'stdTable': {
      const caption = extractTitle(content, 'tableCaption')
      lines.push(`${indent}[表] ${caption}`)
      // 表格内容简化为行
      if (content) {
        for (const c of content) {
          if ((c.type as string) === 'table') {
            tableToText(c, lines, depth + 1)
          }
        }
      }
      break
    }

    case 'figure': {
      const caption = extractTitle(content, 'figureCaption')
      lines.push(`${indent}[图] ${caption}`)
      break
    }

    case 'formula': {
      const formulaContent = extractTitle(content, 'formulaContent')
      lines.push(`${indent}[公式] ${formulaContent}`)
      break
    }

    case 'stdList': {
      if (content) {
        for (const c of content) {
          if ((c.type as string) === 'stdListItem') {
            lines.push(`${indent}— ${extractText(c)}`)
          }
        }
      }
      break
    }

    default: {
      // 其他文本节点
      const text = extractText(node)
      if (text) lines.push(`${indent}${text}`)
      if (content) content.forEach(c => nodeToText(c, lines, depth, ctx))
      break
    }
  }
}

/** 从 content 数组中提取指定类型节点的文本 */
function extractTitle(
  content: Array<Record<string, unknown>> | undefined,
  typeName: string,
): string {
  if (!content) return ''
  const node = content.find(c => (c.type as string) === typeName)
  return node ? extractText(node) : ''
}

/** 从节点中递归提取纯文本 */
function extractText(node: Record<string, unknown>): string {
  if (node.text) return node.text as string
  const content = node.content as Array<Record<string, unknown>> | undefined
  if (!content) return ''
  return content.map(c => extractText(c)).join('')
}

/** 表格转文本 */
function tableToText(
  node: Record<string, unknown>,
  lines: string[],
  depth: number,
) {
  const content = node.content as Array<Record<string, unknown>> | undefined
  if (!content) return
  const indent = '  '.repeat(depth)
  for (const row of content) {
    if ((row.type as string) === 'tableRow') {
      const cells: string[] = []
      const rowContent = row.content as Array<Record<string, unknown>> | undefined
      if (rowContent) {
        for (const cell of rowContent) {
          cells.push(extractText(cell))
        }
      }
      lines.push(`${indent}| ${cells.join(' | ')} |`)
    }
  }
}

/**
 * 比对两个 ProseMirror JSON 文档的差异
 */
export function diffDocuments(
  oldDoc: Record<string, unknown>,
  newDoc: Record<string, unknown>,
): DiffResult {
  const oldText = docToText(oldDoc)
  const newText = docToText(newDoc)

  const changes: Change[] = diffLines(oldText, newText)
  const lines: DiffLine[] = []
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 }

  let oldLineNo = 1
  let newLineNo = 1

  for (const change of changes) {
    const changeLines = change.value.split('\n')
    // 最后一个空行由换行符产生，跳过
    if (changeLines[changeLines.length - 1] === '') {
      changeLines.pop()
    }

    for (const text of changeLines) {
      if (change.added) {
        lines.push({ type: 'added', text, newLineNo: newLineNo++ })
        stats.added++
      } else if (change.removed) {
        lines.push({ type: 'removed', text, oldLineNo: oldLineNo++ })
        stats.removed++
      } else {
        lines.push({ type: 'unchanged', text, oldLineNo: oldLineNo++, newLineNo: newLineNo++ })
        stats.unchanged++
      }
    }
  }

  return { lines, stats }
}
