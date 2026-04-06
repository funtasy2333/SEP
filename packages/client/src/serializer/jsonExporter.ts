/**
 * JSON 语义导出器
 * 将 ProseMirror 文档导出为语义增强的 JSON 格式
 *
 * 在 ProseMirror 原始 JSON 基础上：
 * 1. 添加自动计算的编号（章号、条号、图号、表号等）
 * 2. 添加层级路径信息
 * 3. 添加语义化的类型标注
 */

import type { Node as PMNode } from '@tiptap/pm/model'

export interface SemanticJsonNode {
  /** 节点语义类型 */
  type: string
  /** 语义属性 */
  attrs?: Record<string, unknown>
  /** 子节点 */
  content?: SemanticJsonNode[]
  /** 文本内容 */
  text?: string
  /** 行内标记 */
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  /** 自动生成的编号 */
  number?: string
  /** 节点在文档中的路径（如 "1.2.3"） */
  path?: string
}

/**
 * 将 ProseMirror 文档导出为语义增强 JSON
 */
export function exportSemanticJson(doc: PMNode): SemanticJsonNode {
  const context = {
    chapterCount: 0,
    appendixCount: 0,
    clauseCounters: [0, 0, 0, 0, 0],
    currentPrefix: '',
  }

  return processNode(doc, context, '')
}

interface NumberingContext {
  chapterCount: number
  appendixCount: number
  clauseCounters: number[]
  currentPrefix: string
}

function processNode(node: PMNode, ctx: NumberingContext, parentPath: string): SemanticJsonNode {
  const result: SemanticJsonNode = {
    type: node.type.name,
  }

  // 复制属性
  if (node.attrs && Object.keys(node.attrs).length > 0) {
    const attrs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node.attrs)) {
      if (value != null) attrs[key] = value
    }
    if (Object.keys(attrs).length > 0) {
      result.attrs = attrs
    }
  }

  // 处理文本节点
  if (node.isText) {
    result.text = node.text || ''
    if (node.marks && node.marks.length > 0) {
      result.marks = node.marks.map(mark => {
        const m: { type: string; attrs?: Record<string, unknown> } = { type: mark.type.name }
        if (mark.attrs && Object.keys(mark.attrs).length > 0) {
          const markAttrs: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(mark.attrs)) {
            if (v != null) markAttrs[k] = v
          }
          if (Object.keys(markAttrs).length > 0) m.attrs = markAttrs
        }
        return m
      })
    }
    return result
  }

  // 根据节点类型添加编号和路径
  switch (node.type.name) {
    case 'chapter': {
      ctx.chapterCount++
      ctx.clauseCounters.fill(0)
      ctx.currentPrefix = String(ctx.chapterCount)
      result.number = String(ctx.chapterCount)
      result.path = String(ctx.chapterCount)
      break
    }
    case 'appendix': {
      ctx.appendixCount++
      ctx.clauseCounters.fill(0)
      const letter = String.fromCharCode(64 + ctx.appendixCount)
      ctx.currentPrefix = letter
      result.number = letter
      result.path = `附录${letter}`
      break
    }
    case 'clause': {
      const level = (node.attrs.level as number) || 1
      ctx.clauseCounters[level - 1]++
      for (let i = level; i < 5; i++) ctx.clauseCounters[i] = 0
      const numParts = [ctx.currentPrefix, ...ctx.clauseCounters.slice(0, level)]
      const numStr = numParts.join('.')
      result.number = numStr
      result.path = numStr
      break
    }
    case 'termDef': {
      const level = (node.attrs.level as number) || 1
      ctx.clauseCounters[level - 1]++
      for (let i = level; i < 5; i++) ctx.clauseCounters[i] = 0
      const numParts = [ctx.currentPrefix, ...ctx.clauseCounters.slice(0, level)]
      const numStr = numParts.join('.')
      result.number = numStr
      result.path = numStr
      break
    }
    case 'foreword':
      result.path = '前言'
      break
    case 'introduction':
      result.path = '引言'
      break
    case 'bibliography':
      result.path = '参考文献'
      break
  }

  // 递归处理子节点
  if (node.content && node.content.size > 0) {
    result.content = []
    const currentPath = result.path || parentPath
    node.forEach((child) => {
      result.content!.push(processNode(child, ctx, currentPath))
    })
  }

  return result
}
