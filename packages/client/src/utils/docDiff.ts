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
      const subjectField = extractTitle(content, 'termSubjectField')
      lines.push(`${indent}${numStr} ${termName}`)
      if (termNameEn) lines.push(`${indent}  ${termNameEn}`)
      if (subjectField) lines.push(`${indent}  〈${subjectField}〉`)
      if (termDef) lines.push(`${indent}  ${termDef}`)
      if (content) {
        for (const c of content) {
          const ct = c.type as string
          if (!['termName', 'termNameEn', 'termSubjectField', 'termDefinition'].includes(ct)) {
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

    // WP8.M G7-b：块内容的注/示例。首个子块是段落时与标签同行（与单段注一致），其余子块缩进一级，
    // 这样只改注内某个段落或列项的版本也能在对比中看到。
    case 'noteBlock':
    case 'exampleBlock': {
      const label = node.type === 'noteBlock' ? '注：' : '示例：'
      const [first, ...rest] = content ?? []
      if (first && (first.type as string) === 'stdParagraph') {
        lines.push(`${indent}${label}${extractText(first)}`)
        rest.forEach(c => nodeToText(c, lines, depth + 1, ctx))
      } else {
        lines.push(`${indent}${label}`)
        for (const c of content ?? []) nodeToText(c, lines, depth + 1, ctx)
      }
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
      // WP8.M G3：图例、图注、图中示例也要进入对比文本，否则只改这些内容的版本看起来相同。
      for (const c of content ?? []) {
        if (c.type === 'figureLegend') {
          const legend = c.content as Array<Record<string, unknown>> | undefined
          lines.push(`${indent}  [图例] ${extractTitle(legend, 'figureLegendTitle')}`.trimEnd())
          for (const item of legend ?? []) {
            if (item.type !== 'whereItem') continue
            const cells = item.content as Array<Record<string, unknown>> | undefined
            lines.push(`${indent}    ${extractTitle(cells, 'whereTerm')}：${extractTitle(cells, 'whereDefinition')}`)
          }
        } else if (c.type === 'note') {
          lines.push(`${indent}  注：${extractText(c)}`)
        } else if (c.type === 'example') {
          lines.push(`${indent}  示例：${extractText(c)}`)
        }
      }
      break
    }

    case 'formula': {
      const formulaContent = extractTitle(content, 'formulaContent')
      lines.push(`${indent}[公式] ${formulaContent}`)
      // 式中（结构化与自由文本）和公式注也要进入对比文本，否则只改这些内容的版本看起来相同。
      for (const c of content ?? []) {
        if (c.type === 'formulaDescription') {
          const text = extractText(c)
          if (text) lines.push(`${indent}  ${text}`)
        } else if (c.type === 'formulaNote') {
          lines.push(`${indent}  注：${extractText(c)}`)
        } else if (c.type === 'whereList') {
          lines.push(`${indent}  式中：`)
          for (const item of (c.content as Array<Record<string, unknown>> | undefined) ?? []) {
            const cells = item.content as Array<Record<string, unknown>> | undefined
            lines.push(`${indent}    ${extractTitle(cells, 'whereTerm')}——${extractTitle(cells, 'whereDefinition')}`)
          }
        }
      }
      break
    }

    case 'defList': {
      // 缩略语表（WP8.M G2）：每项一行“缩略语：释义”（全角冒号，与打印排版一致）。
      // 不走默认分支，否则术语格与释义格各占一行并重复。
      lines.push(`${indent}[缩略语]`)
      for (const item of content ?? []) {
        const cells = item.content as Array<Record<string, unknown>> | undefined
        lines.push(`${indent}  ${extractTitle(cells, 'whereTerm')}：${extractTitle(cells, 'whereDefinition')}`)
      }
      break
    }

    case 'normRefList': {
      // 规范性引用文件清单（M-4.4.2.3-02/-03/-04）：每个条目一行，标准化文件为“文件编号　文件名称”（间隔与出件一致，
      // 一个汉字）；不能落入 default（会把整个清单拼成一行，并把子节点再输出一遍）。
      for (const entry of content ?? []) {
        const entryContent = entry.content as Array<Record<string, unknown>> | undefined
        if ((entry.type as string) === 'normRefStd') {
          const ref = extractTitle(entryContent, 'normRefStdRef')
          const title = extractTitle(entryContent, 'normRefStdTitle')
          lines.push(`${indent}${ref && title ? `${ref}　${title}` : ref + title}`)
        } else {
          lines.push(`${indent}${extractText(entry)}`)
        }
      }
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
  // 行内公式没有文字，按 LaTeX 源码输出，否则版本对比看不到公式改动。
  if (node.type === 'formulaInline') {
    const latex = (node.attrs as Record<string, unknown> | undefined)?.latex
    return typeof latex === 'string' && latex ? `$${latex}$` : ''
  }
  // 行内图（WP8.M G3）同样没有文字：以 [行内图 …] 记号输出其替代文字、尺寸档位与资源引用，改动才会出现在对比里。
  if (node.type === 'inlineImage') {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>
    const parts = [attrs.alt, attrs.size ? `size=${String(attrs.size)}` : '', attrs.resourceId ? `res=${String(attrs.resourceId)}` : '']
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
    return `[行内图${parts.length ? ' ' + parts.join(' ') : ''}]`
  }
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
