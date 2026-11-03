/**
 * Canonical inline payload checks shared by both PM→IR import and IR→PM projection.
 * This module intentionally uses structural JSON checks only; it does not depend on
 * ProseMirror schemas or either converter at runtime.
 */

const CANONICAL_FOOTNOTE_MARKS = new Set(['bold', 'italic', 'underline', 'subscript', 'superscript'])

type FootnotePmNode = {
  type: string
  attrs?: unknown
  marks?: unknown
  content?: unknown
  text?: unknown
}

function isFootnotePmNode(value: unknown): value is FootnotePmNode {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === 'string'
}

function unsupportedFootnoteAttrs(attrs: unknown): string | undefined {
  if (attrs == null) return undefined
  if (typeof attrs !== 'object' || Array.isArray(attrs)) return '无效的格式属性结构'
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'content' || key === 'text') return `属性字段「${key}」`
    if (value !== null && typeof value === 'object') return `属性「${key}」包含暂不支持的嵌套数据`
  }
  return undefined
}

function unsupportedFootnoteMarks(marks: unknown): string | undefined {
  if (marks == null) return undefined
  if (!Array.isArray(marks)) return '无效的格式标记'
  for (const value of marks) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') {
      return '无效的格式标记'
    }
    const mark = value as Record<string, unknown> & { type: string }
    const extraKey = Object.keys(mark).find(key => key !== 'type' && key !== 'attrs')
    if (extraKey) return `格式标记包含不支持字段「${extraKey}」`
    const attrsReason = unsupportedFootnoteAttrs(mark.attrs)
    if (attrsReason) return `格式标记${attrsReason}`
    if (CANONICAL_FOOTNOTE_MARKS.has(mark.type)) continue
    if (mark.type === 'crossRef') {
      const attrs = (mark.attrs ?? {}) as Record<string, unknown>
      const targetId = attrs.targetId ?? attrs.refId
      if (typeof targetId === 'string' && targetId.length > 0) {
        if (Object.prototype.hasOwnProperty.call(attrs, 'refType') && typeof attrs.refType !== 'string') return '交叉引用类型无效'
        if (Object.prototype.hasOwnProperty.call(attrs, 'refText') && attrs.refText !== null && typeof attrs.refText !== 'string') return '交叉引用文本无效'
        continue
      }
      return '缺少目标的交叉引用'
    }
    return `格式「${mark.type}」`
  }
  return undefined
}

export function unsupportedFootnoteAtomMarks(marks: unknown): string | undefined {
  if (marks == null || (Array.isArray(marks) && marks.length === 0)) return undefined
  return '上标格式标记（请先取消上标的附加格式）'
}

/** 脚注负载只接受能由各导出器无损表示的 PM 行内形状。 */
export function unsupportedFootnoteContent(content: readonly unknown[]): string | undefined {
  for (const value of content) {
    if (!isFootnotePmNode(value)) return '无效的行内节点'
    const node = value
    if (node.type === 'text') {
      const extraKey = Object.keys(node).find(key => !['type', 'text', 'marks'].includes(key))
      if (extraKey) return `文本节点包含不支持字段「${extraKey}」`
      if (typeof node.text !== 'string') return '无效的文本内容'
      const marksReason = unsupportedFootnoteMarks(node.marks)
      if (marksReason) return marksReason
      continue
    }
    if (node.type === 'hardBreak') {
      const extraKey = Object.keys(node).find(key => !['type', 'marks'].includes(key))
      if (extraKey) return `换行节点包含不支持字段「${extraKey}」`
      if (node.marks != null && !(Array.isArray(node.marks) && node.marks.length === 0)) return '换行格式标记'
      continue
    }
    if (node.type === 'tableFootnoteRef') return '表脚注引用不能嵌入脚注内容'
    if (node.type === 'footnoteRef') {
      const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
        ? node.attrs as Record<string, unknown>
        : undefined
      const nested = Array.isArray(attrs?.content) ? attrs.content : []
      const reason = unsupportedFootnoteContent(nested)
      if (reason) return reason
      continue
    }
    return `节点「${node.type}」`
  }
  return undefined
}

/** Shared definitions have one nonempty body and cannot contain another footnote atom. */
export function unsupportedSharedFootnoteContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return '内容不是数组'
  if (content.some(item => isFootnotePmNode(item) && ['footnoteRef', 'sharedFootnoteRef', 'sharedFootnoteDefinition'].includes(item.type))) return '不能嵌套脚注'
  if (!content.some(item => isFootnotePmNode(item) && item.type === 'text' && typeof item.text === 'string' && item.text.trim())) return '正文不能为空'
  return unsupportedFootnoteContent(content)
}
