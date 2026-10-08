/**
 * pmToIr：ProseMirror JSON → Authoring IR 转换器（Phase 5.5 / WP3）。
 *
 * 输入为纯 JSON 对象（不依赖 @tiptap 包），按 `type` 字符串分发。
 * 未知节点类型不中断转换，收集进 warnings 返回。
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import { toIrStandardType } from './meta'
import { hasSemanticExtensions } from './extensions'
import type {
  IRAdoption,
  IRAppendix,
  IRBibEntry,
  IRBlock,
  IRCopyright,
  IRChapter,
  IRChapterChild,
  IRClause,
  IRClauseChild,
  IRDoc,
  IRDocMeta,
  IRExample,
  IRExternalLink,
  IRFigureDescription,
  IRFigureGroup,
  IRFigure,
  IRFormula,
  IRFormulaNote,
  IRIdentifier,
  IRIdentifierPart,
  IRIndex,
  IRIndexEntry,
  IRIndexGroup,
  IRInlineFormula,
  IRInlineStyle,
  IRInline,
  IRReferenceTargetKind,
  IRLanguage,
  IRList,
  IRMark,
  IRMeasure,
  IRNote,
  IROrganization,
  IRParagraph,
  IRResource,
  IRStandardReference,
  IRTableStyle,
  IRRowStyle,
  IRCellStyle,
  IRTable,
  IRTableRow,
  IRTermEntry,
  IRTermGroup,
  IRTermLanguageSet,
  IRTermVariant,
  IRTitlePart,
  IRUnsupportedContent,
  IRWarning,
  IRQuote,
  IRCodeBlock,
  NodeId,
} from './types'

/** ProseMirror JSON 节点（纯对象形态） */
export interface PMJsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMJsonNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

export interface PmToIrResult {
  doc: IRDoc
  /** 转换过程中遇到的非致命问题（未知节点类型、缺失 nodeId 等），中文描述 */
  warnings: string[]
}

/**
 * 缺失 nodeId 时的占位前缀。pmToIr 以 `__missing-<n>` 顺序补位保证树内字段完整且确定，
 * Resolver 据此前缀产出 `missing-id` problem。
 */
export const MISSING_ID_PREFIX = '__missing-'

// ---------- 内部转换上下文 ----------

class Ctx {
  warnings: string[] = []
  unsupportedContent: IRUnsupportedContent[] = []
  resources: IRResource[] = []
  paths = new WeakMap<object, string>()
  ownerIds = new WeakMap<object, string>()
  /** 原始 atom 与转换结果的关联，用于最终检查是否实际进入 IR 树。 */
  footnoteInlines = new WeakMap<PMJsonNode, IRInline>()
  /** 暂不支持的脚注负载保留为阻断诊断，避免导出时只写出部分内容。 */
  invalidFootnotePayloads: { nodeId: NodeId; reason: string }[] = []
  private missingSeq = 0
  private warnedUnknown = new Set<string>()

  /** 取节点 nodeId，缺失时生成确定性占位 ID 并记录警告 */
  id(node: PMJsonNode): NodeId {
    const id = node.attrs?.nodeId
    if (typeof id === 'string' && id.length > 0) return id
    this.missingSeq += 1
    this.warnings.push(`节点 ${node.type} 缺少 nodeId，已使用占位 ID`)
    return `${MISSING_ID_PREFIX}${this.missingSeq}`
  }

  unknown(type: string, where: string, node?: PMJsonNode): void {
    if (!this.warnedUnknown.has(`${where}:${type}`)) {
      this.warnedUnknown.add(`${where}:${type}`)
      this.warnings.push(`未知节点类型「${type}」（位于${where}），已跳过`)
    }
    this.unsupportedContent.push({
      nodeId: typeof node?.attrs?.nodeId === 'string' ? node.attrs.nodeId : node ? this.ownerIds.get(node) ?? null : null,
      path: node ? this.paths.get(node) ?? where : where,
      nodeType: type,
      reason: '当前Authoring IR没有与该生产节点对应的类型化字段',
    })
  }

  path(node: PMJsonNode | undefined, fallback: string): string {
    return node ? this.paths.get(node) ?? fallback : fallback
  }
}

function indexPmPaths(root: PMJsonNode, ctx: Ctx): void {
  const visit = (node: PMJsonNode, path: string, ownerId?: string): void => {
    ctx.paths.set(node, path)
    const nextOwnerId = typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : ownerId
    if (nextOwnerId) ctx.ownerIds.set(node, nextOwnerId)
    ;(node.content ?? []).forEach((child, index) => {
      if (isPmJsonNode(child)) visit(child, `${path}.content[${index}]`, nextOwnerId)
    })
    if (node.type === 'footnoteRef' && Array.isArray(node.attrs?.content)) {
      ;(node.attrs!.content as unknown[]).forEach((child, index) => {
        if (isPmJsonNode(child)) visit(child, `${path}.attrs.content[${index}]`, nextOwnerId)
      })
    }
  }
  visit(root, root.type)
}

// ---------- 行内内容 ----------

const MARK_MAP: Record<string, Extract<IRMark, { type: 'bold' | 'italic' | 'underline' | 'sub' | 'sup' | 'strike' | 'code' }>['type']> = {
  bold: 'bold',
  strong: 'bold',
  italic: 'italic',
  em: 'italic',
  underline: 'underline',
  subscript: 'sub',
  superscript: 'sup',
  strike: 'strike',
  code: 'code',
}

const CANONICAL_FOOTNOTE_MARKS = new Set(['bold', 'italic', 'underline', 'subscript', 'superscript'])

function isPmJsonNode(value: unknown): value is PMJsonNode {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === 'string'
}

/** 脚注负载只接受能由各导出器无损表示的 PM 行内形状。 */
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
      const targetId = attrs?.targetId ?? attrs?.refId
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

function unsupportedFootnoteAtomMarks(marks: unknown): string | undefined {
  if (marks == null || (Array.isArray(marks) && marks.length === 0)) return undefined
  return '上标格式标记（请先取消上标的附加格式）'
}

function unsupportedFootnoteContent(content: unknown[]): string | undefined {
  for (const value of content) {
    if (!isPmJsonNode(value)) return '无效的行内节点'
    const node = value as PMJsonNode & Record<string, unknown>
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
      const nested = Array.isArray(node.attrs?.content) ? node.attrs.content as PMJsonNode[] : []
      const reason = unsupportedFootnoteContent(nested)
      if (reason) return reason
      continue
    }
    return `节点「${node.type}」`
  }
  return undefined
}

interface ConvertedMarks {
  marks: IRMark[]
  style?: IRInlineStyle
}

const REF_KIND_MAP: Record<string, NonNullable<Extract<IRMark, { type: 'crossRef' }>['targetKind']>> = {
  chapter: 'chapter', clause: 'clause', appendix: 'appendix', figure: 'figure',
  table: 'table', formula: 'formula', note: 'note', example: 'example',
  bibEntry: 'bibliography', bibliography: 'bibliography', term: 'term',
  paragraph: 'paragraph', index: 'index',
}

function styleFromAttrs(attrs: Record<string, unknown> | undefined): IRInlineStyle | undefined {
  if (!attrs) return undefined
  const out: IRInlineStyle = {}
  const keys: (keyof IRInlineStyle)[] = [
    'fontFamily', 'fontSize', 'color', 'backgroundColor', 'letterSpacing', 'baseline', 'textTransform',
  ]
  for (const key of keys) {
    const value = attrs[key]
    if (typeof value === 'string' && value.length > 0) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function convertMarks(
  marks: PMJsonNode['marks'],
  ctx: Ctx,
  sourceNode?: PMJsonNode,
): ConvertedMarks | undefined {
  if (marks == null) return undefined
  if (!Array.isArray(marks)) {
    ctx.warnings.push('行内格式标记结构无效，已跳过')
    return undefined
  }
  if (marks.length === 0) return undefined
  const out: IRMark[] = []
  let style: IRInlineStyle | undefined
  for (const value of marks as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { type?: unknown }).type !== 'string') {
      ctx.warnings.push('行内格式标记结构无效，已跳过')
      continue
    }
    const m = value as { type: string; attrs?: Record<string, unknown> }
    const mapped = Object.prototype.hasOwnProperty.call(MARK_MAP, m.type) ? MARK_MAP[m.type] : undefined
    if (mapped) {
      out.push({ type: mapped })
    } else if (m.type === 'textStyle') {
      style = { ...style, ...styleFromAttrs(m.attrs) }
    } else if (m.type === 'variable') {
      out.push({
        type: 'variable',
        ...(typeof m.attrs?.kind === 'string' ? { kind: m.attrs.kind } : {}),
        ...(typeof m.attrs?.name === 'string' ? { name: m.attrs.name } : {}),
      })
    } else if (m.type === 'externalLink' || m.type === 'link') {
      const href = typeof m.attrs?.href === 'string' ? m.attrs.href : ''
      const link: IRExternalLink = {
        href,
        ...(typeof m.attrs?.title === 'string' ? { title: m.attrs.title } : {}),
        ...(typeof m.attrs?.target === 'string' ? { target: m.attrs.target } : {}),
        ...(typeof m.attrs?.rel === 'string' ? { rel: m.attrs.rel } : {}),
      }
      out.push({ type: 'externalLink', ...link })
    } else if (m.type === 'bibRef' || m.type === 'termRef') {
      const targetId = m.attrs?.targetId
      if (typeof targetId === 'string' && targetId.length > 0) {
        out.push({ type: m.type, targetId })
      } else {
        ctx.unknown(m.type, '行内标记', sourceNode ?? { type: m.type, attrs: m.attrs })
      }
    } else if (m.type === 'crossRef') {
      const refId = m.attrs?.targetId ?? m.attrs?.refId
      if (typeof refId === 'string' && refId.length > 0) {
        const attrs = m.attrs && typeof m.attrs === 'object' ? m.attrs : undefined
        const hasRefType = attrs !== undefined && Object.prototype.hasOwnProperty.call(attrs, 'refType')
        const refTypeValue = attrs?.refType
        const rawKind = typeof refTypeValue === 'string' ? refTypeValue : undefined
        const targetKind = rawKind && Object.prototype.hasOwnProperty.call(REF_KIND_MAP, rawKind) ? REF_KIND_MAP[rawKind] : undefined
        const ownerId = typeof sourceNode?.attrs?.nodeId === 'string'
          ? sourceNode.attrs.nodeId
          : sourceNode ? ctx.ownerIds.get(sourceNode) ?? null : null
        if (hasRefType && typeof refTypeValue !== 'string') {
          const actualType = refTypeValue === null ? 'null' : Array.isArray(refTypeValue) ? '数组' : typeof refTypeValue
          ctx.unsupportedContent.push({
            nodeId: ownerId,
            path: ctx.path(sourceNode, '行内标记'),
            nodeType: 'crossRef',
            reason: `crossRef.refType必须为字符串，实际值类型为${actualType}`,
          })
          ctx.warnings.push(`crossRef.refType必须为字符串，实际值类型为${actualType}；已保留引用目标`)
        }
        if (rawKind && !targetKind) {
          ctx.unsupportedContent.push({ nodeId: ownerId, path: ctx.path(sourceNode, '行内标记'), nodeType: 'crossRef', reason: `引用类型「${rawKind}」没有映射到IR目标类型` })
          ctx.warnings.push(`交叉引用类型「${rawKind}」没有IR映射`)
        }
        out.push({ type: 'crossRef', targetId: refId, ...(targetKind ? { targetKind } : {}) })
      } else {
        ctx.unknown(m.type, '行内标记', sourceNode ?? { type: m.type, attrs: m.attrs })
      }
    } else {
      ctx.unknown(m.type, '行内标记', sourceNode ?? { type: m.type, attrs: m.attrs })
    }
  }
  return out.length > 0 || style ? { marks: out, ...(style ? { style } : {}) } : undefined
}

/** 把 inline* 内容（text 节点序列）转为 IRInline[] */
function convertInlines(content: PMJsonNode[] | undefined, ctx: Ctx): IRInline[] {
  if (!content) return []
  const out: IRInline[] = []
  for (const value of content as unknown[]) {
    if (!isPmJsonNode(value)) {
      ctx.warnings.push('无效的行内节点结构，已跳过')
      continue
    }
    const child = value
    if (child.type === 'text') {
      if (typeof child.text !== 'string') {
        ctx.warnings.push('行内文本结构无效，已跳过')
        continue
      }
      if (!child.text) continue
      const inline: IRInline = { text: child.text }
      const converted = convertMarks(child.marks, ctx, child)
      if (converted?.marks.length) inline.marks = converted.marks
      if (converted?.style) inline.style = converted.style
      out.push(inline)
    } else if (child.type === 'hardBreak') {
      const inline: IRInline = { text: '\n' }
      const converted = convertMarks(child.marks, ctx, child)
      if (converted?.marks.length) inline.marks = converted.marks
      if (converted?.style) inline.style = converted.style
      out.push(inline)
    } else if (child.type === 'footnoteRef') {
      const raw = child.attrs?.content
      const content = Array.isArray(raw) ? raw as PMJsonNode[] : []
      const id = ctx.id(child)
      const unsupported = unsupportedFootnoteContent(content) ?? unsupportedFootnoteAtomMarks(child.marks)
      if (unsupported) ctx.invalidFootnotePayloads.push({ nodeId: id, reason: unsupported })
      const inline: IRInline = { text: '', footnote: { id, content: convertInlines(content, ctx) } }
      ctx.footnoteInlines.set(child, inline)
      out.push(inline)
    } else if (child.type === 'tableFootnoteRef') {
      const targetId = typeof child.attrs?.targetId === 'string' ? child.attrs.targetId : ''
      const id = ctx.id(child)
      const unsupported = unsupportedFootnoteAtomMarks(child.marks)
      if (unsupported) ctx.invalidFootnotePayloads.push({ nodeId: id || targetId, reason: unsupported })
      const inline: IRInline = { text: '', marks: [{ type: 'tableFootnoteRef', targetId, id }] }
      ctx.footnoteInlines.set(child, inline)
      out.push(inline)
    } else if (child.type === 'formulaInline') {
      const id = ctx.id(child)
      const formula: IRInlineFormula = { id }
      if (typeof child.attrs?.mathml === 'string' && child.attrs.mathml.length > 0) formula.mathml = child.attrs.mathml
      if (typeof child.attrs?.latex === 'string' && child.attrs.latex.length > 0) formula.latex = child.attrs.latex
      if (typeof child.attrs?.source === 'string' && child.attrs.source.length > 0) formula.source = child.attrs.source
      const inline: IRInline = { text: '', formula }
      const converted = convertMarks(child.marks, ctx, child)
      if (converted?.marks.length) inline.marks = converted.marks
      if (converted?.style) inline.style = converted.style
      out.push(inline)
    } else {
      ctx.unknown(child.type, '行内内容', child)
    }
  }
  return out
}

function plainText(inlines: IRInline[]): string {
  return inlines.map((r) => r.text).join('')
}

function measure(
  attrs: Record<string, unknown> | undefined,
  valueKey: string,
  unitKey: string,
  ctx?: Ctx,
  node?: PMJsonNode,
): IRMeasure | undefined {
  const rawValue = attrs?.[valueKey]
  if (rawValue === undefined || rawValue === null) return undefined
  const rawUnit = attrs?.[unitKey]
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && typeof rawUnit === 'string' && rawUnit.length > 0) {
    return { value: rawValue, unit: rawUnit }
  }
  ctx?.unsupportedContent.push({
    nodeId: typeof node?.attrs?.nodeId === 'string' ? node.attrs.nodeId : null,
    path: node?.type ?? 'metadata',
    nodeType: node?.type ?? 'measure',
    reason: `度量「${valueKey}」缺少有效数值或单位「${unitKey}」`,
  })
  return undefined
}

function scalarStyle(attrs: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const value = attrs?.[key]
    if (typeof value === 'string' && value.length > 0) out[key] = value
  }
  return out
}

function tableStyle(attrs: Record<string, unknown> | undefined, ctx: Ctx, node: PMJsonNode): IRTableStyle | undefined {
  const style: IRTableStyle = scalarStyle(attrs, ['layout', 'borderModel', 'textAlign', 'verticalAlign', 'borderColor', 'backgroundColor'])
  const borderWidth = measure(attrs, 'borderWidth', 'borderWidthUnit', ctx, node)
  const cellPadding = measure(attrs, 'cellPadding', 'cellPaddingUnit', ctx, node)
  if (borderWidth) style.borderWidth = borderWidth
  if (cellPadding) style.cellPadding = cellPadding
  return Object.keys(style).length > 0 ? style : undefined
}

function rowStyle(attrs: Record<string, unknown> | undefined, ctx: Ctx, node: PMJsonNode): IRRowStyle | undefined {
  const style: IRRowStyle = scalarStyle(attrs, ['textAlign', 'verticalAlign', 'backgroundColor', 'borderColor'])
  const measurements: [keyof IRRowStyle, string, string][] = [
    ['borderWidth', 'borderWidth', 'borderWidthUnit'], ['height', 'height', 'heightUnit'],
    ['borderTop', 'borderTop', 'borderTopUnit'], ['borderRight', 'borderRight', 'borderRightUnit'],
    ['borderBottom', 'borderBottom', 'borderBottomUnit'], ['borderLeft', 'borderLeft', 'borderLeftUnit'],
  ]
  for (const [key, valueKey, unitKey] of measurements) {
    const value = measure(attrs, valueKey, unitKey, ctx, node)
    if (value) style[key] = value as never
  }
  return Object.keys(style).length > 0 ? style : undefined
}

function cellStyle(attrs: Record<string, unknown> | undefined, ctx: Ctx, node: PMJsonNode): IRCellStyle | undefined {
  const style: IRCellStyle = scalarStyle(attrs, ['textAlign', 'verticalAlign', 'backgroundColor'])
  const measurements: [keyof IRCellStyle, string, string][] = [
    ['borderTop', 'borderTop', 'borderTopUnit'], ['borderRight', 'borderRight', 'borderRightUnit'],
    ['borderBottom', 'borderBottom', 'borderBottomUnit'], ['borderLeft', 'borderLeft', 'borderLeftUnit'],
    ['paddingTop', 'paddingTop', 'paddingTopUnit'], ['paddingRight', 'paddingRight', 'paddingRightUnit'],
    ['paddingBottom', 'paddingBottom', 'paddingBottomUnit'], ['paddingLeft', 'paddingLeft', 'paddingLeftUnit'],
  ]
  for (const [key, valueKey, unitKey] of measurements) {
    const value = measure(attrs, valueKey, unitKey, ctx, node)
    if (value) style[key] = value as never
  }
  return Object.keys(style).length > 0 ? style : undefined
}

/** 在指定子节点类型中取第一个并返回其 inline 内容 */
function childInlines(node: PMJsonNode, type: string, ctx: Ctx): IRInline[] {
  const child = node.content?.find((c) => c.type === type)
  return child ? convertInlines(child.content, ctx) : []
}

// ---------- 块级内容 ----------

/** inline 容器节点（note/example/列表项等）包装为单段落，段落 ID 由父 ID 派生（确定性） */
function wrapParagraph(parentId: NodeId, suffix: string, content: IRInline[]): IRParagraph {
  return { kind: 'paragraph', id: `${parentId}.${suffix}`, content }
}

const STD_LIST_TYPE_MAP: Record<string, IRList['listType']> = {
  dash: 'dash',
  alpha: 'alpha',
  numeric: 'number',
  dot: 'dot',
  roman: 'number',
  romanUpper: 'number',
  boxedNumeric: 'boxed',
}

function convertStdList(node: PMJsonNode, ctx: Ctx): IRList {
  const id = ctx.id(node)
  const rawType = String(node.attrs?.listType ?? 'dash')
  let listType = STD_LIST_TYPE_MAP[rawType]
  if (rawType === 'roman' || rawType === 'romanUpper') {
    ctx.warnings.push(`旧罗马列项类型「${rawType}」已降级为数字编号列项`)
  }
  if (!listType) {
    ctx.warnings.push(`列表类型「${rawType}」无法识别，已按破折号列项处理`)
    listType = 'dash'
  }
  const items: IRList['items'] = []
  for (const item of node.content ?? []) {
    if (item.type !== 'stdListItem') {
      ctx.unknown(item.type, '标准列表', item)
      continue
    }
    const itemId = ctx.id(item)
    items.push({
      id: itemId,
      content: [wrapParagraph(itemId, 'p0', convertInlines(item.content, ctx))],
    })
  }
  // 数字和间隔号列项固定为二级，兼容旧文档中仍写着 level=1 的数字列项。
  const level = rawType === 'numeric' || rawType === 'dot' ? 2 : 1
  return level === 2 ? { kind: 'list', id, listType, level, items } : { kind: 'list', id, listType, items }
}

/** StarterKit bulletList / orderedList → IRList（dash / number） */
function convertStarterList(node: PMJsonNode, ctx: Ctx): IRList {
  const id = ctx.id(node)
  const items: IRList['items'] = []
  for (const li of node.content ?? []) {
    if (li.type !== 'listItem') {
      ctx.unknown(li.type, '列表', li)
      continue
    }
    const itemId = ctx.id(li)
    const content: (IRParagraph | IRList)[] = []
    for (const child of li.content ?? []) {
      if (child.type === 'paragraph' || child.type === 'stdParagraph') {
        content.push({ kind: 'paragraph', id: ctx.id(child), content: convertInlines(child.content, ctx) })
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        content.push(convertStarterList(child, ctx))
      } else if (child.type === 'stdList') {
        content.push(convertStdList(child, ctx))
      } else {
        ctx.unknown(child.type, '列表项', child)
      }
    }
    items.push({ id: itemId, content })
  }
  return {
    kind: 'list',
    id,
    listType: node.type === 'orderedList' ? 'number' : 'dash',
    ...(node.type === 'orderedList' ? { level: 2 as const } : {}),
    items,
  }
}

function convertNoteLike<K extends 'note' | 'example'>(
  kind: K,
  node: PMJsonNode,
  ctx: Ctx,
): { kind: K; id: NodeId; content: IRBlock[] } {
  const id = ctx.id(node)
  return { kind, id, content: [wrapParagraph(id, 'p0', convertInlines(node.content, ctx))] }
}

const convertNote = (node: PMJsonNode, ctx: Ctx): IRNote => convertNoteLike('note', node, ctx)
const convertExample = (node: PMJsonNode, ctx: Ctx): IRExample => convertNoteLike('example', node, ctx)

function convertFigure(node: PMJsonNode, ctx: Ctx): IRFigure {
  const id = ctx.id(node)
  const images = node.content?.filter((c) => c.type === 'figureImage') ?? []
  const image = images[0]
  if (!image) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(node, '图'), nodeType: node.type, reason: 'figure缺少必须的figureImage，无法完整还原图像内容' })
  if (images.length > 1) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(node, '图'), nodeType: node.type, reason: 'figure包含多个figureImage，但IR只支持一个主图像' })
  const allowed = new Set(['figureImage', 'figureCaption', 'figureCaptionEn', 'figureUnit', 'figureDescription', 'figureGroup', 'figureResource'])
  for (const child of node.content ?? []) if (!allowed.has(child.type)) ctx.unknown(child.type, '图', child)
  for (const type of ['figureCaption', 'figureCaptionEn', 'figureUnit']) {
    const matches = node.content?.filter(child => child.type === type) ?? []
    if (matches.length > 1) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(node, '图'), nodeType: type, reason: 'figure包含多个' + type + '，IR只允许一项' })
  }
  const imageMeasure = (key: 'width' | 'height'): IRMeasure | undefined => {
    const value = image?.attrs?.[key]
    if (value === undefined || value === null) return undefined
    const unitKey = `${key}Unit`
    const rawUnit = image?.attrs?.[unitKey]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { value, unit: typeof rawUnit === 'string' && rawUnit ? rawUnit : 'px' }
    }
    ctx.unsupportedContent.push({ nodeId: typeof image?.attrs?.nodeId === 'string' ? image.attrs.nodeId : id, path: ctx.path(image, '图/图片'), nodeType: 'figureImage', reason: `图片${key}尺寸必须是有限数值` })
    return undefined
  }
  const width = imageMeasure('width')
  const height = imageMeasure('height')
  const fig: IRFigure = {
    kind: 'figure',
    id,
    caption: childInlines(node, 'figureCaption', ctx),
    orientation: node.attrs?.orientation === 'landscape' ? 'landscape' : 'portrait',
    src: typeof image?.attrs?.src === 'string' ? image.attrs.src : '',
    notes: [],
    ...(typeof image?.attrs?.resourceId === 'string' ? { resourceId: image.attrs.resourceId } : {}),
    ...(width ? { imageWidth: width } : {}),
    ...(height ? { imageHeight: height } : {}),
    ...(typeof image?.attrs?.alt === 'string' ? { alt: image.attrs.alt } : {}),
    ...(typeof image?.attrs?.title === 'string' ? { title: image.attrs.title } : {}),
    ...(typeof node.attrs?.unit === 'string' ? { unit: node.attrs.unit } : {}),
  }
  const captionEn = node.content?.find((c) => c.type === 'figureCaptionEn')
  if (captionEn) fig.captionEn = convertInlines(captionEn.content, ctx)
  const unit = node.content?.find((c) => c.type === 'figureUnit')
  if (unit && typeof unit.attrs?.value === 'string') {
    if (fig.unit && fig.unit !== unit.attrs.value) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(unit, '图单位'), nodeType: unit.type, reason: 'figure.attrs.unit与figureUnit子节点不一致' })
    fig.unit = unit.attrs.value
  }
  const descriptions: IRFigureDescription[] = []
  for (const description of node.content?.filter((c) => c.type === 'figureDescription') ?? []) {
    descriptions.push({ id: ctx.id(description), content: convertInlines(description.content, ctx) })
  }
  if (descriptions.length > 0) fig.descriptions = descriptions
  const groups: IRFigureGroup[] = []
  for (const groupNode of node.content?.filter((c) => c.type === 'figureGroup') ?? []) {
    const group: IRFigureGroup = { id: ctx.id(groupNode), descriptions: [], resourceRefs: [] }
    for (const child of groupNode.content ?? []) {
      if (child.type === 'figureDescription') {
        group.descriptions.push({ id: ctx.id(child), content: convertInlines(child.content, ctx) })
      } else if (child.type === 'figureResourceRef') {
        const targetId = typeof child.attrs?.targetId === 'string' ? child.attrs.targetId : ''
        if (targetId) group.resourceRefs.push(targetId)
        else ctx.unknown(child.type, '图组资源引用', child)
      } else ctx.unknown(child.type, '图组', child)
    }
    groups.push(group)
  }
  if (groups.length > 0) fig.groups = groups
  for (const resourceNode of node.content?.filter((c) => c.type === 'figureResource') ?? []) {
    ctx.resources.push(convertFigureResource(resourceNode, ctx))
  }
  return fig
}

function convertFigureResource(node: PMJsonNode, ctx: Ctx): IRResource {
  const id = ctx.id(node)
  const mediaType = typeof node.attrs?.mediaType === 'string' ? node.attrs.mediaType : undefined
  const name = typeof node.attrs?.name === 'string' ? node.attrs.name : undefined
  const rawEncoding = node.attrs?.encoding
  const encoding = rawEncoding === 'base64' || rawEncoding === 'text' || rawEncoding === 'dataUrl' ? rawEncoding : 'dataUrl'
  if (rawEncoding !== undefined && rawEncoding !== encoding) {
    ctx.unsupportedContent.push({ nodeId: id, path: 'figureResource', nodeType: node.type, reason: `资源编码「${String(rawEncoding)}」不受IR支持` })
  }
  const data = typeof node.attrs?.data === 'string' ? node.attrs.data : ''
  return { id, ...(mediaType ? { mediaType } : {}), ...(name ? { name } : {}), encoding, data }
}

// ----- 表格 -----

function intAttr(node: PMJsonNode, name: string, fallback: number): number {
  const v = node.attrs?.[name]
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback
}

function convertTableCellBlocks(
  cell: PMJsonNode,
  cellId: NodeId,
  ctx: Ctx,
): IRBlock[] {
  const out: IRBlock[] = []
  let seq = 0
  for (const child of cell.content ?? []) {
    if (child.type === 'paragraph' || child.type === 'stdParagraph') {
      const nodeId = child.attrs?.nodeId
      const id =
        typeof nodeId === 'string' && nodeId.length > 0 ? nodeId : `${cellId}.p${seq}`
      out.push({ kind: 'paragraph', id, content: convertInlines(child.content, ctx) })
    } else if (child.type === 'table' || child.type === 'stdTable') {
      ctx.unsupportedContent.push({ nodeId: typeof child.attrs?.nodeId === 'string' ? child.attrs.nodeId : null, path: ctx.path(child, '表格单元格'), nodeType: child.type, reason: '当前IR/新国标交换模型不支持嵌套表格' })
    } else {
      const block = convertBlock(child, ctx, '表格单元格')
      if (block) out.push(block)
    }
    seq += 1
  }
  return out
}

function convertStdTable(node: PMJsonNode, ctx: Ctx): IRTable {
  const id = ctx.id(node)
  const rows: IRTableRow[] = []
  let headerRowCount = 0
  let headerEnded = false
  const tableNode = node.content?.find((c) => c.type === 'table')
  let rowSeq = 0
  for (const rowNode of tableNode?.content ?? []) {
    if (rowNode.type !== 'tableRow') {
      ctx.unknown(rowNode.type, '表格', rowNode)
      continue
    }
    // 旧表格没有行 ID 时沿用既有派生值；新生产 schema 的 nodeId 原样保留。
    const rowId = typeof rowNode.attrs?.nodeId === 'string' && rowNode.attrs.nodeId.length > 0
      ? rowNode.attrs.nodeId : `${id}.r${rowSeq}`
    const cells: IRTableRow['cells'] = []
    let allHeader = true
    let cellSeq = 0
    for (const cellNode of rowNode.content ?? []) {
      if (cellNode.type !== 'tableCell' && cellNode.type !== 'tableHeader') {
        ctx.unknown(cellNode.type, '表格行', cellNode)
        continue
      }
      if (cellNode.type !== 'tableHeader') allHeader = false
      const cellId = typeof cellNode.attrs?.nodeId === 'string' && cellNode.attrs.nodeId.length > 0
        ? cellNode.attrs.nodeId : `${rowId}c${cellSeq}`
      const rawColwidth = cellNode.attrs?.colwidth
      const columnWidths = Array.isArray(rawColwidth) && rawColwidth.every(value => typeof value === 'number' && Number.isFinite(value))
        ? rawColwidth as number[] : undefined
      if (rawColwidth !== undefined && rawColwidth !== null && !columnWidths) {
        ctx.unsupportedContent.push({ nodeId: cellId, path: '表格/单元格', nodeType: cellNode.type, reason: '列宽colwidth必须为有限数值数组' })
      }
      const cellWidth = measure(cellNode.attrs, 'width', 'widthUnit', ctx, cellNode)
      const style = cellStyle(cellNode.attrs, ctx, cellNode)
      const cell = {
        id: cellId,
        colspan: intAttr(cellNode, 'colspan', 1),
        rowspan: intAttr(cellNode, 'rowspan', 1),
        header: cellNode.type === 'tableHeader',
        content: convertTableCellBlocks(cellNode, cellId, ctx),
        ...(typeof cellNode.attrs?.cellType === 'string' ? { cellType: cellNode.attrs.cellType } : {}),
        ...(typeof cellNode.attrs?.unit === 'string' ? { unit: cellNode.attrs.unit } : {}),
        ...(cellWidth ? { width: cellWidth } : {}),
        ...(style ? { style } : {}),
        ...(columnWidths ? { columnWidths: [...columnWidths] } : {}),
      }
      cells.push(cell)
      cellSeq += 1
    }
    if (allHeader && cells.length > 0 && !headerEnded) headerRowCount += 1
    else headerEnded = true
    const style = rowStyle(rowNode.attrs, ctx, rowNode)
    rows.push({ id: rowId, cells, ...(style ? { style } : {}) })
    rowSeq += 1
  }

  const explicitHeaderCount = node.attrs?.headerRowCount
  if (explicitHeaderCount !== undefined && explicitHeaderCount !== null) {
    if (typeof explicitHeaderCount === 'number' && Number.isInteger(explicitHeaderCount) && explicitHeaderCount >= 0 && explicitHeaderCount <= rows.length) {
      headerRowCount = explicitHeaderCount
    } else {
      ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(node, '表格'), nodeType: node.type, reason: 'headerRowCount必须为不超过表格行数的非负整数' })
    }
  }

  const table: IRTable = {
    kind: 'table',
    id,
    caption: childInlines(node, 'tableCaption', ctx),
    orientation: node.attrs?.orientation === 'landscape' ? 'landscape' : 'portrait',
    headerRowCount,
    rows,
    notes: [],
    ...(typeof node.attrs?.unit === 'string' ? { unit: node.attrs.unit } : {}),
  }
  const width = measure(node.attrs, 'width', 'widthUnit', ctx, node)
  if (width) table.width = width
  const style = tableStyle(node.attrs, ctx, node)
  if (style) table.style = style
  const captionEn = node.content?.find((c) => c.type === 'tableCaptionEn')
  if (captionEn) table.captionEn = convertInlines(captionEn.content, ctx)
  const footnote = node.content?.find((c) => c.type === 'tableFootnote')
  if (footnote) {
    const noteId = `${id}.note0`
    table.notes.push({
      kind: 'note',
      id: noteId,
      content: [wrapParagraph(noteId, 'p0', convertInlines(footnote.content, ctx))],
    })
  }
  for (const row of node.content ?? []) {
    if (row.type === 'tableNoteRow') {
      for (const note of row.content ?? []) {
        if (note.type === 'note') table.notes.push(convertNoteLike('note', note, ctx))
        else ctx.unknown(note.type, '表注行', note)
      }
    }
    if (row.type === 'tableFootnoteRow') {
      table.footnotes ??= []
      for (const entry of row.content ?? []) {
        if (entry.type === 'tableFootnoteEntry') {
          const id = ctx.id(entry)
          const content = entry.content ?? []
          const unsupported = unsupportedFootnoteContent(content)
          if (unsupported) ctx.invalidFootnotePayloads.push({ nodeId: id, reason: unsupported })
          table.footnotes.push({ id, content: convertInlines(content, ctx) })
        }
        else ctx.unknown(entry.type, '表脚注行', entry)
      }
    }
  }
  return table
}

// ----- 公式 -----

/**
 * 按分隔符把行内运行序列切段（保留 marks）。
 * 用于解析「式中：A——……；B——……。」式的公式说明文本。
 */
function splitInlines(inlines: IRInline[], separator: RegExp): IRInline[][] {
  const segments: IRInline[][] = []
  let current: IRInline[] = []
  for (const run of inlines) {
    // 空文本的公式/脚注 atom 仍是数据，保留完整负载到 Resolver 做位置校验。
    if (isInlineAtom(run)) {
      current.push(run)
      continue
    }
    let rest = run.text
    for (;;) {
      const m = rest.match(separator)
      if (!m || m.index === undefined) break
      const before = rest.slice(0, m.index)
      if (before) current.push({ ...run, text: before })
      segments.push(current)
      current = []
      rest = rest.slice(m.index + m[0].length)
    }
    if (rest) current.push({ ...run, text: rest })
  }
  segments.push(current)
  return segments
}

function isInlineAtom(run: IRInline): boolean {
  return Boolean(
    run.formula ||
    run.footnote ||
    run.marks?.some(mark => mark.type === 'tableFootnoteRef') ||
    (!run.text && (run.style || run.marks?.length)),
  )
}

/** 去除首尾空白与空运行：只在首尾边界克隆，单遍 + 边界收缩 */
function trimInlines(inlines: IRInline[]): IRInline[] {
  const out: IRInline[] = []
  for (const run of inlines) {
    if (run.text.length > 0 || isInlineAtom(run) || run.style || run.marks?.length) out.push(run)
  }
  while (out.length > 0) {
    if (isInlineAtom(out[0])) break
    const text = out[0].text.replace(/^\s+/, '')
    if (text) {
      if (text !== out[0].text) out[0] = { ...out[0], text }
      break
    }
    out.shift()
  }
  while (out.length > 0) {
    const last = out[out.length - 1]
    if (isInlineAtom(last)) break
    const text = last.text.replace(/\s+$/, '')
    if (text) {
      if (text !== last.text) out[out.length - 1] = { ...last, text }
      break
    }
    out.pop()
  }
  return out
}

/**
 * 解析 formulaDescription（自由文本「式中：A——定义；B——定义。」）为 whereList。
 * 条目以 ；/; 分隔，条目内以 —— 分隔变量与释义；无 —— 时整条视为释义。
 */
export function parseWhereList(
  inlines: IRInline[],
  formulaId: NodeId,
): IRFormula['whereList'] {
  const entries = splitInlines(inlines, /[；;]/)
  const whereList: IRFormula['whereList'] = []
  let seq = 0
  let first = true
  for (const entry of entries) {
    let trimmed = trimInlines(entry)
    // 前导「式中：」标识只会出现在首条，就地剥除（避免对全部 inlines 额外做一遍 split/trim）
    if (first) {
      first = false
      if (trimmed.length > 0) {
        const text = trimmed[0].text.replace(/^式中[：:]\s*/, '')
        if (text !== trimmed[0].text) {
          trimmed = text ? [{ ...trimmed[0], text }, ...trimmed.slice(1)] : trimmed.slice(1)
        }
      }
    }
    if (trimmed.length === 0) continue
    const parts = splitInlines(trimmed, /——/)
    const id = `${formulaId}.w${seq}`
    if (parts.length >= 2) {
      whereList.push({
        id,
        term: trimInlines(parts[0]),
        definition: trimInlines(parts.slice(1).flat()),
      })
    } else {
      whereList.push({ id, term: [], definition: trimmed })
    }
    seq += 1
  }
  return whereList
}

function convertFormula(node: PMJsonNode, ctx: Ctx): IRFormula {
  const id = ctx.id(node)
  const formulaContents = node.content?.filter((c) => c.type === 'formulaContent') ?? []
  if (formulaContents.length !== 1) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(node, '公式'), nodeType: node.type, reason: 'formulaContent数量为' + formulaContents.length + '，生产公式节点必须且只能有一个' })
  const content = formulaContents[0]
  const sourceInlines = convertInlines(content?.content, ctx)
  const latexFromContent = plainText(sourceInlines).trim()
  const latexAttr = typeof node.attrs?.latex === 'string' ? node.attrs.latex : undefined
  // formulaContent is the editable source. An empty content node represents an
  // intentionally cleared formula; attrs.latex is only a legacy fallback when
  // the content node is absent (the missing-node diagnostic above still applies).
  const latex = content !== undefined ? latexFromContent : latexAttr ?? latexFromContent
  const mathml = typeof node.attrs?.mathml === 'string' && node.attrs.mathml.length > 0 ? node.attrs.mathml : undefined
  const descriptions = node.content?.filter((c) => c.type === 'formulaDescription') ?? []
  const whereLists = node.content?.filter((c) => c.type === 'whereList') ?? []
  const desc = descriptions[0]
  const typedWhere = whereLists[0]
  if (descriptions.length > 1 || whereLists.length > 1) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(node, '公式'), nodeType: node.type, reason: '公式存在重复的formulaDescription/whereList，无法按单一IR列表无损表达' })
  if (typedWhere && desc && (desc.content ?? []).length > 0) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(desc, '公式说明'), nodeType: desc.type, reason: 'formula同时包含自由文本formulaDescription与类型化whereList，二者不能确定性合并' })
  const allowed = new Set(['formulaContent', 'formulaDescription', 'formulaNote', 'whereList'])
  for (const child of node.content ?? []) if (!allowed.has(child.type)) ctx.unknown(child.type, '公式', child)
  const whereList: IRFormula['whereList'] = []
  if (typedWhere) {
    for (const item of typedWhere.content ?? []) {
      if (item.type !== 'whereItem') {
        ctx.unknown(item.type, '公式式中列表', item)
        continue
      }
      const term = item.content?.find((child) => child.type === 'whereTerm')
      const definition = item.content?.find((child) => child.type === 'whereDefinition')
      whereList.push({
        id: ctx.id(item),
        term: convertInlines(term?.content, ctx),
        definition: convertInlines(definition?.content, ctx),
      })
    }
  } else if (desc) {
    whereList.push(...parseWhereList(convertInlines(desc.content, ctx), id))
  }
  const notes: IRFormulaNote[] = []
  for (const note of node.content?.filter((child) => child.type === 'formulaNote') ?? []) {
    notes.push({ id: ctx.id(note), content: convertInlines(note.content, ctx) })
  }
  const preserveFormulaSource = sourceInlines.some(run => run.footnote || run.formula || run.style || (run.marks?.length ?? 0) > 0)
  return {
    kind: 'formula',
    id,
    latex,
    // 不能让 plainText 丢掉脚注 atom，所有出口必须仍能校验其位置。
    ...(preserveFormulaSource ? { sourceInlines } : {}),
    ...(mathml ? { mathml } : {}),
    numbered: node.attrs?.numbered !== false,
    whereList,
    ...(notes.length ? { notes } : {}),
  }
}

// ----- 通用块分发 -----

function convertBlock(node: PMJsonNode, ctx: Ctx, where: string): IRBlock | null {
  switch (node.type) {
    case 'stdParagraph':
    case 'paragraph':
      return { kind: 'paragraph', id: ctx.id(node), content: convertInlines(node.content, ctx) }
    case 'stdList':
      return convertStdList(node, ctx)
    case 'bulletList':
    case 'orderedList':
      return convertStarterList(node, ctx)
    case 'stdTable':
      return convertStdTable(node, ctx)
    case 'figure':
      return convertFigure(node, ctx)
    case 'formula':
      return convertFormula(node, ctx)
    case 'note':
      return convertNote(node, ctx)
    case 'example':
      return convertExample(node, ctx)
    case 'warning':
      return { kind: 'warning', id: ctx.id(node), content: convertBlocks(node.content, ctx, '警告') } satisfies IRWarning
    case 'quoteBlock':
    case 'blockquote':
      return { kind: 'quote', id: ctx.id(node), content: convertBlocks(node.content, ctx, '引文') } satisfies IRQuote
    case 'codeBlock': {
      const id = ctx.id(node)
      if ((node.content ?? []).some(child => child.type !== 'text' || (child.marks?.length ?? 0) > 0)) {
        ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(node, where), nodeType: node.type, reason: 'codeBlock只支持无标记文本节点，存在其他子节点或格式标记' })
      }
      const text = (node.content ?? []).map(child => typeof child.text === 'string' ? child.text : '').join('')
      return { kind: 'code', id, ...(typeof node.attrs?.language === 'string' ? { language: node.attrs.language } : {}), text } satisfies IRCodeBlock
    }
    case 'horizontalRule':
      ctx.warnings.push('分隔线（horizontalRule）无对应 IR 表示')
      ctx.unsupportedContent.push({ nodeId: typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : null, path: ctx.path(node, where), nodeType: node.type, reason: 'IR没有分隔线节点，不能无损输出' })
      return null
    default:
      ctx.unknown(node.type, where, node)
      return null
  }
}

function convertBlocks(content: PMJsonNode[] | undefined, ctx: Ctx, where: string): IRBlock[] {
  const out: IRBlock[] = []
  for (const node of content ?? []) {
    const block = convertBlock(node, ctx, where)
    if (block) out.push(block)
  }
  return out
}

// ----- 术语条目 -----

/**
 * termDef → IRTermEntry。
 * IRTermEntry 不支持嵌套术语，PM 中嵌套的 termDef 拍平为后续兄弟条目（追加进 out）。
 */
function convertTermDef(node: PMJsonNode, ctx: Ctx, out: IRTermEntry[]): void {
  const id = ctx.id(node)
  const entry: IRTermEntry = {
    kind: 'termEntry',
    id,
    ...(typeof node.attrs?.level === 'number' ? { level: node.attrs.level } : {}),
    term: childInlines(node, 'termName', ctx),
    definition: [],
    notes: [],
    examples: [],
  }
  const termEn = node.content?.find((c) => c.type === 'termNameEn')
  if (termEn) {
    const inlines = convertInlines(termEn.content, ctx)
    if (inlines.length > 0) entry.termEn = inlines
  }
  const nested: IRTermEntry[] = []
  let defSeq = 0
  for (const child of node.content ?? []) {
    switch (child.type) {
      case 'termName':
      case 'termNameEn':
        break
      case 'tbxLangSet': {
        entry.languageSets ??= []
        entry.languageSets.push(convertTbxLangSet(child, ctx))
        break
      }
      case 'termDefinition': {
        const rawDefinitionId = child.attrs?.nodeId
        const definitionId = typeof rawDefinitionId === 'string' && rawDefinitionId.length > 0
          ? rawDefinitionId
          : rawDefinitionId == null ? `${id}.def${defSeq}` : ctx.id(child)
        entry.definition.push({ kind: 'paragraph', id: definitionId, content: convertInlines(child.content, ctx) })
        defSeq += 1
        break
      }
      case 'termSource': {
        const source = convertInlines(child.content, ctx)
        if (entry.source !== undefined) {
          ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(child, `术语条目/${id}`), nodeType: child.type, reason: '一个术语条目包含多个来源字段，IR只允许一个' })
        } else {
          entry.source = source
        }
        break
      }
      case 'stdParagraph': {
        const inlines = convertInlines(child.content, ctx)
        // 「[来源：……]」段按 IRTermEntry.source 处理（最多一个，后续重复并入定义）
        if (/^\s*[[［]来源/.test(plainText(inlines))) {
          if (entry.source !== undefined) {
            ctx.unsupportedContent.push({ nodeId: ctx.id(child), path: ctx.path(child, `术语条目/${id}`), nodeType: child.type, reason: '一个术语条目包含多个来源字段，IR只允许一个' })
          } else {
            entry.source = inlines
          }
        } else {
          entry.definition.push({ kind: 'paragraph', id: ctx.id(child), content: inlines })
        }
        break
      }
      case 'note':
        entry.notes.push(convertNote(child, ctx))
        break
      case 'example':
        entry.examples.push(convertExample(child, ctx))
        break
      case 'termDef':
        convertTermDef(child, ctx, nested)
        break
      default:
        ctx.unknown(child.type, '术语条目', child)
    }
  }
  out.push(entry)
  if (nested.length > 0) entry.nestedEntries = nested
}

function convertTbxLangSet(node: PMJsonNode, ctx: Ctx): IRTermLanguageSet {
  const languageSet: IRTermLanguageSet = {
    id: ctx.id(node),
    language: typeof node.attrs?.lang === 'string' ? node.attrs.lang : '',
    groups: [],
  }
  for (const tig of node.content ?? []) {
    if (tig.type !== 'tbxTig') {
      ctx.unknown(tig.type, 'TBX语言集', tig)
      continue
    }
    const group: IRTermGroup = { id: ctx.id(tig), terms: [] }
    for (const variantNode of tig.content ?? []) {
      if (variantNode.type !== 'tbxTermVariant') {
        ctx.unknown(variantNode.type, 'TBX术语组', variantNode)
        continue
      }
      const variant: IRTermVariant = { id: ctx.id(variantNode), content: [], descriptors: [] }
      for (const child of variantNode.content ?? []) {
        if (child.type === 'tbxTerm') variant.content = convertInlines(child.content, ctx)
        else if (child.type === 'tbxTermDescriptor') {
          variant.descriptors.push({
            id: ctx.id(child),
            kind: typeof child.attrs?.type === 'string' ? child.attrs.type : '',
            value: convertInlines(child.content, ctx),
          })
        } else ctx.unknown(child.type, 'TBX术语变体', child)
      }
      group.terms.push(variant)
    }
    languageSet.groups.push(group)
  }
  return languageSet
}

// ----- 章 / 条 / 附录 -----

function convertClauseChildren(
  content: PMJsonNode[] | undefined,
  ctx: Ctx,
  where: string,
  skipTypes: string[],
): IRClauseChild[] {
  const out: IRClauseChild[] = []
  for (const node of content ?? []) {
    if (skipTypes.includes(node.type)) continue
    if (node.type === 'clause') {
      out.push(convertClause(node, ctx))
    } else if (node.type === 'termDef') {
      const entries: IRTermEntry[] = []
      convertTermDef(node, ctx, entries)
      out.push(...entries)
    } else {
      const block = convertBlock(node, ctx, where)
      if (block) out.push(block)
    }
  }
  return out
}

function convertClause(node: PMJsonNode, ctx: Ctx): IRClause {
  const rawLevel = node.attrs?.level
  // intAttr 对 <1 的值回退为默认 1，与原边界收敛行为一致；警告仍按原始值判断
  let level = intAttr(node, 'level', 1)
  if (typeof rawLevel === 'number' && (rawLevel < 1 || rawLevel > 5)) {
    ctx.warnings.push(`条层级 ${String(rawLevel)} 超出 1~5，已按边界值处理`)
  }
  if (level > 5) level = 5
  const titled = node.attrs?.hasTitle !== false
  const title = childInlines(node, 'clauseTitle', ctx)
  if (!titled && title.length > 0) {
    ctx.unsupportedContent.push({
      nodeId: ctx.id(node),
      path: ctx.path(node, '条'),
      nodeType: node.type,
      reason: '无题条包含非空clauseTitle；IR要求titled=false时title为空，原内容不能安全投影',
    })
  }
  return {
    kind: 'clause',
    id: ctx.id(node),
    level: level as IRClause['level'],
    titled,
    title: titled ? title : [],
    children: convertClauseChildren(node.content, ctx, '条', ['clauseTitle']),
  }
}

const CHAPTER_SEC_TYPES: { match: RegExp; secType: IRChapter['secType'] }[] = [
  { match: /^范围$/, secType: 'scope' },
  { match: /^规范性引用文件$/, secType: 'norm-refs' },
  { match: /^术语和定义$/, secType: 'terms' },
]

function convertChapter(node: PMJsonNode, ctx: Ctx): IRChapter {
  const title = childInlines(node, 'chapterTitle', ctx)
  const titleText = plainText(title).trim()
  const explicitSecType = node.attrs?.secType
  const inferredSecType = CHAPTER_SEC_TYPES.find((s) => s.match.test(titleText))?.secType ?? 'general'
  let secType = inferredSecType
  if (explicitSecType !== undefined && explicitSecType !== null) {
    if (typeof explicitSecType === 'string' && ['scope', 'norm-refs', 'terms', 'general'].includes(explicitSecType)) {
      secType = explicitSecType as IRChapter['secType']
    } else {
      ctx.unsupportedContent.push({ nodeId: ctx.id(node), path: ctx.path(node, '章'), nodeType: node.type, reason: '章的secType不是受支持的文档角色' })
    }
  }
  return {
    kind: 'chapter',
    id: ctx.id(node),
    secType,
    title,
    children: convertClauseChildren(node.content, ctx, '章', ['chapterTitle']) as IRChapterChild[],
  }
}

function convertAppendix(node: PMJsonNode, ctx: Ctx): IRAppendix {
  return {
    kind: 'appendix',
    id: ctx.id(node),
    normative: node.attrs?.normative === true,
    title: childInlines(node, 'appendixTitle', ctx),
    // appendixLabel（「（规范性）」字样）由 Resolver/渲染器从 normative 派生，不入 IR
    children: convertClauseChildren(node.content, ctx, '附录', ['appendixLabel', 'appendixTitle']),
  }
}

function convertBibliography(node: PMJsonNode, ctx: Ctx): IRBibEntry[] {
  const out: IRBibEntry[] = []
  for (const child of node.content ?? []) {
    if (child.type === 'bibliographyTitle') continue
    if (child.type !== 'bibEntry') {
      ctx.unknown(child.type, '参考文献', child)
      continue
    }
    const entryInlineContent = child.content?.filter((item) => item.type !== 'bibStructured') ?? []
    const entry: IRBibEntry = { kind: 'bibEntry', id: ctx.id(child), content: convertInlines(entryInlineContent, ctx) }
    if (typeof child.attrs?.entryType === 'string') entry.entryType = child.attrs.entryType
    const structuredNodes = child.content?.filter((item) => item.type === 'bibStructured') ?? []
    if (structuredNodes.length > 0) {
      for (const structured of structuredNodes) {
      for (const fieldNode of structured.content ?? []) {
        if (fieldNode.type === 'bibField') {
          entry.fields ??= []
          entry.fields.push({ id: ctx.id(fieldNode), name: typeof fieldNode.attrs?.name === 'string' ? fieldNode.attrs.name : '', value: convertInlines(fieldNode.content, ctx) })
        } else if (fieldNode.type === 'bibIdentifier') {
          entry.identifiers ??= []
          entry.identifiers.push({ id: ctx.id(fieldNode), scheme: typeof fieldNode.attrs?.scheme === 'string' ? fieldNode.attrs.scheme : '', value: typeof fieldNode.attrs?.value === 'string' ? fieldNode.attrs.value : '' })
        } else if (fieldNode.type === 'bibExternalLink') {
          const href = typeof fieldNode.attrs?.href === 'string' ? fieldNode.attrs.href : ''
          if (entry.externalLink) {
            ctx.unsupportedContent.push({ nodeId: entry.id, path: ctx.path(child, `参考文献/${entry.id}`), nodeType: 'bibExternalLink', reason: '一个文献条目包含多个类型化外链，IR只允许一个' })
          } else {
            entry.externalLink = {
              href,
              ...(typeof fieldNode.attrs?.title === 'string' ? { title: fieldNode.attrs.title } : {}),
              ...(typeof fieldNode.attrs?.target === 'string' ? { target: fieldNode.attrs.target } : {}),
              ...(typeof fieldNode.attrs?.rel === 'string' ? { rel: fieldNode.attrs.rel } : {}),
              ...(typeof fieldNode.attrs?.displayText === 'string' ? { displayText: fieldNode.attrs.displayText } : {}),
            }
          }
        } else ctx.unknown(fieldNode.type, '类型化参考文献', fieldNode)
      }
      }
    }
    out.push(entry)
  }
  return out
}

function convertIndex(node: PMJsonNode, ctx: Ctx): IRIndex {
  const index: IRIndex = { id: ctx.id(node), groups: [] }
  if (typeof node.attrs?.title === 'string') index.title = [{ text: node.attrs.title }]
  for (const groupNode of node.content ?? []) {
    if (groupNode.type !== 'indexGroup') { ctx.unknown(groupNode.type, '索引', groupNode); continue }
    const group: IRIndexGroup = { id: ctx.id(groupNode), entries: [] }
    if (typeof groupNode.attrs?.label === 'string') group.label = [{ text: groupNode.attrs.label }]
    for (const entryNode of groupNode.content ?? []) {
      if (entryNode.type !== 'indexEntry') { ctx.unknown(entryNode.type, '索引分组', entryNode); continue }
      const entry: IRIndexEntry = { id: ctx.id(entryNode), term: [], targets: [], seeAlso: [] }
      let termSeen = false
      for (const child of entryNode.content ?? []) {
        if (child.type === 'indexTerm' && !termSeen) { entry.term = convertInlines(child.content, ctx); termSeen = true }
        else if (child.type === 'indexTerm') ctx.unsupportedContent.push({ nodeId: entry.id, path: ctx.path(child, '索引条目'), nodeType: child.type, reason: '索引项包含多个indexTerm，IR只允许一个' })
        else if (child.type === 'indexTarget' || child.type === 'indexSeeAlso') {
          const targetId = typeof child.attrs?.targetId === 'string' ? child.attrs.targetId : ''
          if (!targetId) ctx.unknown(child.type, '索引目标', child)
          else if (child.type === 'indexTarget') entry.targets.push(targetId)
          else entry.seeAlso.push(targetId)
        } else ctx.unknown(child.type, '索引条目', child)
      }
      group.entries.push(entry)
    }
    index.groups.push(group)
  }
  return index
}

// ----- 元数据 -----

function strAttr(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = attrs?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** 新增封面字段优先读封面节点；旧文档曾将其写在根节点时回退到根属性。 */
function coverMetaAttr(
  rootAttrs: Record<string, unknown> | undefined,
  coverAttrs: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return strAttr(coverAttrs, key) ?? strAttr(rootAttrs, key)
}

/** 旧 front 字段仍以 standardDoc 根属性为主；生产编辑器 doc 根无 attrs 时回退到 coverPage。 */
function legacyMetaAttr(
  rootAttrs: Record<string, unknown> | undefined,
  coverAttrs: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return strAttr(rootAttrs, key) ?? strAttr(coverAttrs, key)
}

function convertMeta(docNode: PMJsonNode, coverPage: PMJsonNode | undefined, ctx: Ctx): IRDocMeta {
  const attrs = docNode.attrs
  const rootType = attrs?.standardType
  const coverType = coverPage?.attrs?.standardType
  const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== ''
  const rawTypeValue = hasValue(rootType)
    ? rootType
    : hasValue(coverType)
      ? coverType
      : 'national'
  const rawType = String(rawTypeValue)
  let standardType = toIrStandardType(rawType)
  if (!standardType) {
    ctx.warnings.push(`标准类型「${rawType}」无法识别，已按国家标准处理`)
    standardType = 'gb'
  }
  const meta: IRDocMeta = { standardType }
  const set = <K extends keyof IRDocMeta>(key: K, value: IRDocMeta[K] | undefined) => {
    if (value !== undefined) meta[key] = value
  }
  set('title', legacyMetaAttr(attrs, coverPage?.attrs, 'titleCn'))
  set('titleEn', legacyMetaAttr(attrs, coverPage?.attrs, 'titleEn'))
  set('stdCode', legacyMetaAttr(attrs, coverPage?.attrs, 'standardNo'))
  set('icsCode', legacyMetaAttr(attrs, coverPage?.attrs, 'icsCode'))
  set('ccsCode', legacyMetaAttr(attrs, coverPage?.attrs, 'ccsCode'))
  set('publishDate', legacyMetaAttr(attrs, coverPage?.attrs, 'publishDate'))
  set('implementDate', legacyMetaAttr(attrs, coverPage?.attrs, 'implementDate'))
  // issuer 仅存在于 coverPage attrs（standardDoc 无此属性）
  set('issuer', strAttr(coverPage?.attrs, 'issuer'))
  set('applicant', coverMetaAttr(attrs, coverPage?.attrs, 'applicant'))
  set('proposer', coverMetaAttr(attrs, coverPage?.attrs, 'proposer'))
  set('technicalCommittee', coverMetaAttr(attrs, coverPage?.attrs, 'technicalCommittee'))
  // WP7.5 新增封面字段：封面节点为主，旧根属性仅作兼容回退。
  set('replaces', coverMetaAttr(attrs, coverPage?.attrs, 'replaces'))
  set('consistency', coverMetaAttr(attrs, coverPage?.attrs, 'consistency'))
  set('filingNo', coverMetaAttr(attrs, coverPage?.attrs, 'filingNo'))
  set('industryName', coverMetaAttr(attrs, coverPage?.attrs, 'industryName'))
  set('regionName', coverMetaAttr(attrs, coverPage?.attrs, 'regionName'))
  set('coverDesignation', coverMetaAttr(attrs, coverPage?.attrs, 'coverDesignation'))
  return meta
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

const IR_REFERENCE_TARGET_KINDS = [
  'chapter', 'clause', 'appendix', 'figure', 'table', 'formula',
  'note', 'example', 'bibliography', 'term', 'index', 'paragraph',
] as const satisfies readonly IRReferenceTargetKind[]

function isIRReferenceTargetKind(value: unknown): value is IRReferenceTargetKind {
  return typeof value === 'string' && IR_REFERENCE_TARGET_KINDS.some(kind => kind === value)
}

function metadataInlineProblem(ctx: Ctx, path: string, reason: string): void {
  ctx.unsupportedContent.push({ nodeId: null, path, nodeType: 'metadataInline', reason })
}

function storedInlines(value: unknown, ctx: Ctx, path: string): IRInline[] {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      metadataInlineProblem(ctx, path, 'inline数据必须为数组')
    }
    return []
  }
  const out: IRInline[] = []
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`
    const row = plainRecord(item)
    if (!row || typeof row.text !== 'string') {
      metadataInlineProblem(ctx, itemPath, 'inline项必须包含字符串text')
      continue
    }
    const inline: IRInline = { text: row.text }
    const style = styleFromAttrs(plainRecord(row.style))
    if (style) inline.style = style
    if (Array.isArray(row.marks)) {
      inline.marks = []
      for (const markValue of row.marks) {
        const mark = plainRecord(markValue)
        if (!mark || typeof mark.type !== 'string') {
          metadataInlineProblem(ctx, itemPath, 'inline mark结构无效')
          continue
        }
        if (mark.type === 'bold' || mark.type === 'italic' || mark.type === 'underline' || mark.type === 'sub' || mark.type === 'sup' || mark.type === 'strike' || mark.type === 'code') {
          inline.marks.push({ type: mark.type })
        } else if (mark.type === 'crossRef' && typeof mark.targetId === 'string') {
          const crossRef: Extract<IRMark, { type: 'crossRef' }> = { type: 'crossRef', targetId: mark.targetId }
          if (Object.prototype.hasOwnProperty.call(mark, 'targetKind')) {
            if (isIRReferenceTargetKind(mark.targetKind)) crossRef.targetKind = mark.targetKind
            else metadataInlineProblem(ctx, itemPath, 'crossRef引用目标类型无效')
          }
          inline.marks.push(crossRef)
        } else if (mark.type === 'bibRef' && typeof mark.targetId === 'string') {
          inline.marks.push({ type: 'bibRef', targetId: mark.targetId })
        } else if (mark.type === 'termRef' && typeof mark.targetId === 'string') {
          inline.marks.push({ type: 'termRef', targetId: mark.targetId })
        } else if (mark.type === 'tableFootnoteRef' && typeof mark.targetId === 'string') {
          const tableFootnoteRef: Extract<IRMark, { type: 'tableFootnoteRef' }> = { type: 'tableFootnoteRef', targetId: mark.targetId }
          if (Object.prototype.hasOwnProperty.call(mark, 'id')) {
            if (typeof mark.id === 'string') tableFootnoteRef.id = mark.id
            else metadataInlineProblem(ctx, itemPath, 'tableFootnoteRef引用ID无效')
          }
          inline.marks.push(tableFootnoteRef)
        } else if (mark.type === 'variable') {
          inline.marks.push({ type: 'variable', ...(typeof mark.kind === 'string' ? { kind: mark.kind } : {}), ...(typeof mark.name === 'string' ? { name: mark.name } : {}) })
        } else if (mark.type === 'externalLink' && typeof mark.href === 'string') {
          inline.marks.push({ type: 'externalLink', href: mark.href, ...(typeof mark.title === 'string' ? { title: mark.title } : {}), ...(typeof mark.target === 'string' ? { target: mark.target } : {}), ...(typeof mark.rel === 'string' ? { rel: mark.rel } : {}) })
        } else {
          metadataInlineProblem(ctx, itemPath, `不支持inline mark ${mark.type}`)
        }
      }
      if (inline.marks.length === 0) delete inline.marks
    } else if (row.marks !== undefined && row.marks !== null) {
      metadataInlineProblem(ctx, itemPath, 'inline mark必须为数组')
    }
    if (row.formula !== undefined && row.formula !== null) {
      const formula = plainRecord(row.formula)
      if (formula && typeof formula.id === 'string' && formula.id.length > 0) {
        inline.formula = {
          id: formula.id,
          ...(typeof formula.mathml === 'string' ? { mathml: formula.mathml } : {}),
          ...(typeof formula.latex === 'string' ? { latex: formula.latex } : {}),
          ...(typeof formula.source === 'string' ? { source: formula.source } : {}),
        }
      } else metadataInlineProblem(ctx, itemPath, '行内公式必须具有稳定ID')
    }
    if (Object.prototype.hasOwnProperty.call(row, 'footnote')) {
      const footnote = plainRecord(row.footnote)
      if (!footnote || typeof footnote.id !== 'string' || footnote.id.length === 0 || !Array.isArray(footnote.content)) {
        metadataInlineProblem(ctx, `${itemPath}.footnote`, '脚注必须具有非空ID和行内内容数组')
      } else {
        inline.footnote = {
          id: footnote.id,
          content: storedInlines(footnote.content, ctx, `${itemPath}.footnote.content`),
        }
      }
    }
    out.push(inline)
  }
  return out
}

function fallbackAttrs(pmDoc: PMJsonNode, coverPage: PMJsonNode | undefined, key: string): unknown {
  const rootValue = pmDoc.attrs?.[key]
  if (rootValue !== undefined && rootValue !== null) return rootValue
  return coverPage?.attrs?.[key]
}

function storedId(value: Record<string, unknown>, ctx: Ctx, type: string, path: string): NodeId {
  if (typeof value.id === 'string' && value.id.length > 0) return value.id
  const id = ctx.id({ type, attrs: value })
  ctx.unsupportedContent.push({ nodeId: id, path, nodeType: type, reason: '结构化fallback项缺少稳定ID，无法无损保持引用目标' })
  return id
}

function readFallbackMetaArray<T>(
  pmDoc: PMJsonNode,
  coverPage: PMJsonNode | undefined,
  key: string,
  ctx: Ctx,
  convert: (row: Record<string, unknown>, index: number) => T | undefined,
): T[] | undefined {
  const raw = fallbackAttrs(pmDoc, coverPage, key)
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    ctx.unsupportedContent.push({ nodeId: null, path: `meta.${key}`, nodeType: key, reason: '结构化元数据fallback必须为数组' })
    return undefined
  }
  const out: T[] = []
  raw.forEach((value, index) => {
    const row = plainRecord(value)
    if (!row) {
      ctx.unsupportedContent.push({ nodeId: null, path: `meta.${key}[${index}]`, nodeType: key, reason: '结构化元数据项必须为对象' })
      return
    }
    const converted = convert(row, index)
    if (converted !== undefined) out.push(converted)
    else ctx.unsupportedContent.push({ nodeId: typeof row.id === 'string' ? row.id : null, path: `meta.${key}[${index}]`, nodeType: key, reason: '结构化元数据项缺少必需字段，不能静默丢弃' })
  })
  return out
}

function fallbackTitlePart(row: Record<string, unknown>, index: number, ctx: Ctx): IRTitlePart | undefined {
  if (!Array.isArray(row.content)) return undefined
  return { id: storedId(row, ctx, 'titlePart', `meta.titleParts[${index}]`), ...(typeof row.lang === 'string' ? { lang: row.lang } : {}), ...(typeof row.role === 'string' ? { role: row.role } : {}), content: storedInlines(row.content, ctx, `meta.titleParts[${index}].content`) }
}

function fallbackIdentifier(row: Record<string, unknown>, index: number, ctx: Ctx): IRIdentifier | undefined {
  const parts: IRIdentifierPart[] = []
  if (Array.isArray(row.parts)) row.parts.forEach((value, partIndex) => {
    const part = plainRecord(value)
    if (!part || typeof part.kind !== 'string' || !Array.isArray(part.content)) {
      ctx.unsupportedContent.push({ nodeId: null, path: `meta.identifiers[${index}].parts[${partIndex}]`, nodeType: 'identifierPart', reason: '编号部件需包含kind和content' })
      return
    }
    parts.push({ id: storedId(part, ctx, 'identifierPart', `meta.identifiers[${index}].parts[${partIndex}]`), kind: part.kind, ...(typeof part.position === 'number' ? { position: part.position } : {}), content: storedInlines(part.content, ctx, `meta.identifiers[${index}].parts[${partIndex}].content`) })
  })
  if (!Array.isArray(row.parts)) return undefined
  return { id: storedId(row, ctx, 'standardIdentifier', `meta.identifiers[${index}]`), ...(typeof row.scheme === 'string' ? { scheme: row.scheme } : {}), ...(typeof row.value === 'string' ? { value: row.value } : {}), parts }
}

function fallbackLanguage(row: Record<string, unknown>, index: number, ctx: Ctx): IRLanguage | undefined {
  if (typeof row.tag !== 'string' || !row.tag.trim()) return undefined
  return { id: storedId(row, ctx, 'language', `meta.languages[${index}]`), tag: row.tag, ...(typeof row.usage === 'string' ? { usage: row.usage } : {}) }
}

function fallbackPublisher(row: Record<string, unknown>, index: number, ctx: Ctx): IROrganization | undefined {
  if (!Array.isArray(row.name)) return undefined
  return { id: storedId(row, ctx, 'publisher', `meta.publishers[${index}]`), name: storedInlines(row.name, ctx, `meta.publishers[${index}].name`), ...(typeof row.role === 'string' ? { role: row.role } : {}), ...(typeof row.identifier === 'string' ? { identifier: row.identifier } : {}) }
}

function fallbackAdoption(row: Record<string, unknown>, index: number, ctx: Ctx): IRAdoption | undefined {
  if (typeof row.reference !== 'string' || !row.reference.trim()) return undefined
  return { id: storedId(row, ctx, 'adoption', `meta.adoptions[${index}]`), reference: row.reference, ...(typeof row.degree === 'string' ? { degree: row.degree } : {}), ...(typeof row.language === 'string' ? { language: row.language } : {}) }
}

function fallbackReplacedStandard(row: Record<string, unknown>, index: number, ctx: Ctx): IRStandardReference | undefined {
  if (typeof row.reference !== 'string' || !row.reference.trim()) return undefined
  return { id: storedId(row, ctx, 'replacedStandard', `meta.replacedStandards[${index}]`), reference: row.reference, ...(typeof row.relation === 'string' ? { relation: row.relation } : {}) }
}

function fallbackCopyright(row: Record<string, unknown>, index: number, ctx: Ctx): IRCopyright | undefined {
  if (!Array.isArray(row.statement)) return undefined
  return { id: storedId(row, ctx, 'copyright', `meta.copyrights[${index}]`), ...(Array.isArray(row.holder) ? { holder: storedInlines(row.holder, ctx, `meta.copyrights[${index}].holder`) } : {}), ...(typeof row.year === 'string' ? { year: row.year } : {}), ...(typeof row.language === 'string' ? { language: row.language } : {}), statement: storedInlines(row.statement, ctx, `meta.copyrights[${index}].statement`) }
}

function readStructuredMetaAttrs(pmDoc: PMJsonNode, coverPage: PMJsonNode | undefined, meta: IRDocMeta, ctx: Ctx): void {
  const titleParts = readFallbackMetaArray(pmDoc, coverPage, 'titleParts', ctx, (row, i) => fallbackTitlePart(row, i, ctx))
  const identifiers = readFallbackMetaArray(pmDoc, coverPage, 'identifiers', ctx, (row, i) => fallbackIdentifier(row, i, ctx))
  const languages = readFallbackMetaArray(pmDoc, coverPage, 'languages', ctx, (row, i) => fallbackLanguage(row, i, ctx))
  const publishers = readFallbackMetaArray(pmDoc, coverPage, 'publishers', ctx, (row, i) => fallbackPublisher(row, i, ctx))
  const adoptions = readFallbackMetaArray(pmDoc, coverPage, 'adoptions', ctx, (row, i) => fallbackAdoption(row, i, ctx))
  const replacedStandards = readFallbackMetaArray(pmDoc, coverPage, 'replacedStandards', ctx, (row, i) => fallbackReplacedStandard(row, i, ctx))
  const copyrights = readFallbackMetaArray(pmDoc, coverPage, 'copyrights', ctx, (row, i) => fallbackCopyright(row, i, ctx))
  if (titleParts !== undefined) meta.titleParts = titleParts
  if (identifiers !== undefined) meta.identifiers = identifiers
  if (languages !== undefined) meta.languages = languages
  if (publishers !== undefined) meta.publishers = publishers
  if (adoptions !== undefined) meta.adoptions = adoptions
  if (replacedStandards !== undefined) meta.replacedStandards = replacedStandards
  if (copyrights !== undefined) meta.copyrights = copyrights
}

function convertMetadataBlock(node: PMJsonNode, meta: IRDocMeta, ctx: Ctx): void {
  // A visible metadataBlock is authoritative, including omitted/empty categories.
  delete meta.titleParts
  delete meta.identifiers
  delete meta.languages
  delete meta.publishers
  delete meta.adoptions
  delete meta.replacedStandards
  delete meta.copyrights
  for (const child of node.content ?? []) {
    switch (child.type) {
      case 'titlePart': {
        const item: IRTitlePart = { id: ctx.id(child), content: convertInlines(child.content, ctx) }
        if (typeof child.attrs?.lang === 'string') item.lang = child.attrs.lang
        if (typeof child.attrs?.role === 'string') item.role = child.attrs.role
        meta.titleParts ??= []
        meta.titleParts.push(item)
        break
      }
      case 'standardIdentifier': {
        const item: IRIdentifier = { id: ctx.id(child), parts: [] }
        if (typeof child.attrs?.scheme === 'string') item.scheme = child.attrs.scheme
        if (typeof child.attrs?.value === 'string') item.value = child.attrs.value
        for (const partNode of child.content ?? []) {
          if (partNode.type !== 'identifierPart') { ctx.unknown(partNode.type, '标准编号', partNode); continue }
          const partId = ctx.id(partNode)
          const kind = typeof partNode.attrs?.kind === 'string' ? partNode.attrs.kind : ''
          if (!kind) ctx.unsupportedContent.push({ nodeId: partId, path: ctx.path(partNode, '标准编号组成'), nodeType: partNode.type, reason: 'identifierPart缺少必需的kind属性' })
          item.parts.push({ id: partId, kind, ...(typeof partNode.attrs?.position === 'number' ? { position: partNode.attrs.position } : {}), content: convertInlines(partNode.content, ctx) })
        }
        if (!item.value && item.parts.length === 0) ctx.unsupportedContent.push({ nodeId: item.id, path: ctx.path(child, '标准编号'), nodeType: child.type, reason: 'standardIdentifier既无完整编号value也无组成部分' })
        meta.identifiers ??= []
        meta.identifiers.push(item)
        break
      }
      case 'language': {
        const id = ctx.id(child)
        const tag = typeof child.attrs?.tag === 'string' ? child.attrs.tag : ''
        if (!tag.trim()) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(child, '元数据语言'), nodeType: child.type, reason: 'language缺少必需的语言tag' })
        meta.languages ??= []
        meta.languages.push({ id, tag, ...(typeof child.attrs?.usage === 'string' ? { usage: child.attrs.usage } : {}) })
        break
      }
      case 'publisher':
        meta.publishers ??= []
        meta.publishers.push({ id: ctx.id(child), name: convertInlines(child.content, ctx), ...(typeof child.attrs?.role === 'string' ? { role: child.attrs.role } : {}), ...(typeof child.attrs?.identifier === 'string' ? { identifier: child.attrs.identifier } : {}) })
        break
      case 'adoption': {
        const id = ctx.id(child)
        const reference = typeof child.attrs?.reference === 'string' ? child.attrs.reference : ''
        if (!reference.trim()) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(child, '采用关系'), nodeType: child.type, reason: 'adoption缺少标准引用' })
        meta.adoptions ??= []
        meta.adoptions.push({ id, reference, ...(typeof child.attrs?.degree === 'string' ? { degree: child.attrs.degree } : {}), ...(typeof child.attrs?.language === 'string' ? { language: child.attrs.language } : {}) })
        break
      }
      case 'replacedStandard': {
        const id = ctx.id(child)
        const reference = typeof child.attrs?.reference === 'string' ? child.attrs.reference : ''
        if (!reference.trim()) ctx.unsupportedContent.push({ nodeId: id, path: ctx.path(child, '替代关系'), nodeType: child.type, reason: 'replacedStandard缺少标准引用' })
        meta.replacedStandards ??= []
        meta.replacedStandards.push({ id, reference, ...(typeof child.attrs?.relation === 'string' ? { relation: child.attrs.relation } : {}) })
        break
      }
      case 'copyright':
        meta.copyrights ??= []
        meta.copyrights.push({ id: ctx.id(child), ...(typeof child.attrs?.holder === 'string' ? { holder: [{ text: child.attrs.holder }] } : {}), ...(typeof child.attrs?.year === 'string' ? { year: child.attrs.year } : {}), ...(typeof child.attrs?.language === 'string' ? { language: child.attrs.language } : {}), statement: convertInlines(child.content, ctx) })
        break
      default:
        ctx.unknown(child.type, '结构化元数据', child)
    }
  }
}

/**
 * 检查 atom 确实留在最终 IR 中。固定标题、未知容器、被后一个部分覆盖的内容
 * 都可能绕过常规节点分发；仅“曾调用 convertInlines”不代表转换结果未被丢弃。
 */
function preserveUnmappedFootnotes(pmDoc: PMJsonNode, doc: IRDoc, ctx: Ctx): void {
  const represented = new WeakSet<object>()
  const markIr = (value: unknown): void => {
    if (!value || typeof value !== 'object' || represented.has(value)) return
    represented.add(value)
    Object.values(value).forEach(markIr)
  }
  markIr(doc)
  const pending: NonNullable<IRDoc['unmappedFootnotes']> = []
  const visit = (value: unknown, container: string): void => {
    if (!isPmJsonNode(value)) return
    const node = value
    if (node.type === 'footnoteRef' || node.type === 'tableFootnoteRef') {
      let inline = ctx.footnoteInlines.get(node)
      const mapped = inline?.footnote ?? inline?.marks?.find(mark => mark.type === 'tableFootnoteRef')
      if (!mapped || !represented.has(mapped)) {
        inline ??= convertInlines([node], ctx)[0]
        pending.push({ container, nodeId: inline.footnote?.id ?? ctx.id(node), content: [inline] })
        // 原位脚注内容已随 atom 转换；避免把嵌套脚注重复登记为丢失节点。
        return
      }
    }
    for (const child of node.content ?? []) visit(child, node.type)
    if (node.type === 'footnoteRef' && Array.isArray(node.attrs?.content)) {
      for (const child of node.attrs.content as PMJsonNode[]) visit(child, node.type)
    }
  }
  visit(pmDoc, pmDoc.type)
  for (const invalid of ctx.invalidFootnotePayloads) {
    pending.push({
      container: 'unsupportedFootnotePayload',
      nodeId: invalid.nodeId,
      content: [],
      reason: invalid.reason,
    })
  }
  if (pending.length) doc.unmappedFootnotes = pending
}

// ---------- 入口 ----------

/**
 * 把 ProseMirror JSON（standardDoc 根）转换为 Authoring IR。
 * 纯函数：同样输入产出深度相等的输出。
 */
export function pmToIr(pmDoc: PMJsonNode): PmToIrResult {
  const ctx = new Ctx()
  indexPmPaths(pmDoc, ctx)
  const doc: IRDoc = {
    schemaVersion: 1,
    meta: { standardType: 'gb' },
    front: { foreword: [], introduction: [] },
    body: [],
    appendices: [],
    bibliography: [],
  }

  if (pmDoc.type !== 'standardDoc' && pmDoc.type !== 'doc') {
    ctx.warnings.push(`根节点类型「${pmDoc.type}」不是 standardDoc，按 standardDoc 处理`)
  }

  const coverPages = pmDoc.content?.filter((c) => c.type === 'coverPage') ?? []
  const coverPage = coverPages[0]
  for (const duplicate of coverPages.slice(1)) {
    ctx.unsupportedContent.push({ nodeId: typeof duplicate.attrs?.nodeId === 'string' ? duplicate.attrs.nodeId : null, path: ctx.path(duplicate, '封面'), nodeType: duplicate.type, reason: 'IR只能表达一个coverPage；额外封面的元数据未合并且容器边界无法保留' })
  }
  doc.meta = convertMeta(pmDoc, coverPage, ctx)
  const rootVersion = pmDoc.attrs?.extensionVersion
  if (rootVersion === 1) doc.extensionVersion = 1
  else if (rootVersion !== undefined && rootVersion !== null) {
    ctx.unsupportedContent.push({ nodeId: null, path: pmDoc.type, nodeType: 'extensionVersion', reason: `无法解释扩展版本 ${String(rootVersion)}` })
  }

  const metadataBlocks = pmDoc.content?.filter((c) => c.type === 'metadataBlock') ?? []
  if (metadataBlocks.length > 0) {
    convertMetadataBlock(metadataBlocks[0], doc.meta, ctx)
    if (metadataBlocks.length > 1) {
      metadataBlocks.slice(1).forEach((node) => ctx.unsupportedContent.push({ nodeId: typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : null, path: ctx.path(node, '元数据'), nodeType: node.type, reason: '文档只能有一个authoritative metadataBlock' }))
    }
  } else {
    readStructuredMetaAttrs(pmDoc, coverPage, doc.meta, ctx)
  }

  let sawForeword = false
  let sawIntroduction = false
  let sawBibliography = false
  for (const node of pmDoc.content ?? []) {
    switch (node.type) {
      case 'coverPage':
        // 封面内容由元数据生成，不入 IR
        break
      case 'metadataBlock':
        break
      case 'foreword':
        if (sawForeword) {
          ctx.unsupportedContent.push({ nodeId: typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : null, path: ctx.path(node, '前言'), nodeType: node.type, reason: '多个foreword容器合并后无法保留原容器边界' })
          doc.front.foreword.push(...convertBlocks(node.content, ctx, '前言'))
        } else doc.front.foreword = convertBlocks(node.content, ctx, '前言')
        sawForeword = true
        break
      case 'introduction':
        if (sawIntroduction) {
          ctx.unsupportedContent.push({ nodeId: typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : null, path: ctx.path(node, '引言'), nodeType: node.type, reason: '多个introduction容器合并后无法保留原容器边界' })
          doc.front.introduction.push(...convertBlocks(node.content, ctx, '引言'))
        } else doc.front.introduction = convertBlocks(node.content, ctx, '引言')
        sawIntroduction = true
        break
      case 'chapter':
        doc.body.push(convertChapter(node, ctx))
        break
      case 'appendix':
        doc.appendices.push(convertAppendix(node, ctx))
        break
      case 'bibliography':
        if (sawBibliography) {
          ctx.unsupportedContent.push({ nodeId: typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : null, path: ctx.path(node, '参考文献'), nodeType: node.type, reason: 'IR仅支持一个bibliography容器；多容器被合并后无法保留容器边界' })
          doc.bibliography.push(...convertBibliography(node, ctx))
        } else doc.bibliography = convertBibliography(node, ctx)
        sawBibliography = true
        break
      case 'indexBlock':
        if (doc.index) ctx.unsupportedContent.push({ nodeId: typeof node.attrs?.nodeId === 'string' ? node.attrs.nodeId : null, path: ctx.path(node, '索引'), nodeType: node.type, reason: 'IR仅支持一个indexBlock，额外索引块未合并' })
        else doc.index = convertIndex(node, ctx)
        break
      case 'figureResource':
        ctx.resources.push(convertFigureResource(node, ctx))
        break
      default:
        // The editable ProseMirror doc root may carry an empty insertion-cursor paragraph.
        if ((node.type === 'paragraph' || node.type === 'stdParagraph') && (node.content ?? []).length === 0) break
        ctx.unknown(node.type, '文档顶层', node)
    }
  }

  if (ctx.resources.length > 0) doc.resources = ctx.resources
  if (ctx.unsupportedContent.length > 0) doc.unsupportedContent = ctx.unsupportedContent
  if (!doc.extensionVersion && hasSemanticExtensions(doc)) doc.extensionVersion = 1

  preserveUnmappedFootnotes(pmDoc, doc, ctx)
  return { doc, warnings: ctx.warnings }
}
