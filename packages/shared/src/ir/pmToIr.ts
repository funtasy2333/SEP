/**
 * pmToIr：ProseMirror JSON → Authoring IR 转换器（Phase 5.5 / WP3）。
 *
 * 输入为纯 JSON 对象（不依赖 @tiptap 包），按 `type` 字符串分发。
 * 未知节点类型不中断转换，收集进 warnings 返回。
 * 同构纯 TypeScript，不引用浏览器或 Node 专有 API。
 */

import { toIrStandardType } from './meta'
import type {
  IRAppendix,
  IRBibEntry,
  IRBlock,
  IRChapter,
  IRChapterChild,
  IRClause,
  IRClauseChild,
  IRDoc,
  IRDocMeta,
  IRExample,
  IRFigure,
  IRFormula,
  IRInline,
  IRList,
  IRMark,
  IRNote,
  IRParagraph,
  IRTable,
  IRTableRow,
  IRTermEntry,
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

  unknown(type: string, where: string): void {
    if (this.warnedUnknown.has(`${where}:${type}`)) return
    this.warnedUnknown.add(`${where}:${type}`)
    this.warnings.push(`未知节点类型「${type}」（位于${where}），已跳过`)
  }
}

// ---------- 行内内容 ----------

const MARK_MAP: Record<string, Exclude<IRMark, { type: 'crossRef' }>['type']> = {
  bold: 'bold',
  strong: 'bold',
  italic: 'italic',
  em: 'italic',
  underline: 'underline',
  subscript: 'sub',
  superscript: 'sup',
}

function convertMarks(
  marks: PMJsonNode['marks'],
  ctx: Ctx,
): IRMark[] | undefined {
  if (!marks || marks.length === 0) return undefined
  const out: IRMark[] = []
  for (const m of marks) {
    const mapped = MARK_MAP[m.type]
    if (mapped) {
      out.push({ type: mapped })
    } else if (m.type === 'crossRef') {
      const refId = m.attrs?.refId
      if (typeof refId === 'string' && refId.length > 0) {
        out.push({ type: 'crossRef', targetId: refId })
      } else {
        ctx.warnings.push('交叉引用缺少 refId，已按普通文本处理')
      }
    } else {
      ctx.unknown(m.type, '行内标记')
    }
  }
  return out.length > 0 ? out : undefined
}

/** 把 inline* 内容（text 节点序列）转为 IRInline[] */
function convertInlines(content: PMJsonNode[] | undefined, ctx: Ctx): IRInline[] {
  if (!content) return []
  const out: IRInline[] = []
  for (const child of content) {
    if (child.type === 'text') {
      if (!child.text) continue
      const inline: IRInline = { text: child.text }
      const marks = convertMarks(child.marks, ctx)
      if (marks) inline.marks = marks
      out.push(inline)
    } else if (child.type === 'hardBreak') {
      out.push({ text: '\n' })
    } else {
      ctx.unknown(child.type, '行内内容')
    }
  }
  return out
}

function plainText(inlines: IRInline[]): string {
  return inlines.map((r) => r.text).join('')
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
  roman: 'roman',
  romanUpper: 'romanUpper',
  boxedNumeric: 'boxed',
}

function convertStdList(node: PMJsonNode, ctx: Ctx): IRList {
  const id = ctx.id(node)
  const rawType = String(node.attrs?.listType ?? 'dash')
  let listType = STD_LIST_TYPE_MAP[rawType]
  if (!listType) {
    ctx.warnings.push(`列表类型「${rawType}」无法识别，已按破折号列项处理`)
    listType = 'dash'
  }
  const items: IRList['items'] = []
  for (const item of node.content ?? []) {
    if (item.type !== 'stdListItem') {
      ctx.unknown(item.type, '标准列表')
      continue
    }
    const itemId = ctx.id(item)
    items.push({
      id: itemId,
      content: [wrapParagraph(itemId, 'p0', convertInlines(item.content, ctx))],
    })
  }
  return { kind: 'list', id, listType, items }
}

/** StarterKit bulletList / orderedList → IRList（dash / number） */
function convertStarterList(node: PMJsonNode, ctx: Ctx): IRList {
  const id = ctx.id(node)
  const items: IRList['items'] = []
  for (const li of node.content ?? []) {
    if (li.type !== 'listItem') {
      ctx.unknown(li.type, '列表')
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
        ctx.unknown(child.type, '列表项')
      }
    }
    items.push({ id: itemId, content })
  }
  return {
    kind: 'list',
    id,
    listType: node.type === 'orderedList' ? 'number' : 'dash',
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
  const image = node.content?.find((c) => c.type === 'figureImage')
  const fig: IRFigure = {
    kind: 'figure',
    id,
    caption: childInlines(node, 'figureCaption', ctx),
    orientation: node.attrs?.orientation === 'landscape' ? 'landscape' : 'portrait',
    src: typeof image?.attrs?.src === 'string' ? image.attrs.src : '',
    notes: [],
  }
  const captionEn = node.content?.find((c) => c.type === 'figureCaptionEn')
  if (captionEn) fig.captionEn = convertInlines(captionEn.content, ctx)
  return fig
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
    } else if (child.type === 'bulletList' || child.type === 'orderedList') {
      out.push(convertStarterList(child, ctx))
    } else if (child.type === 'stdList') {
      out.push(convertStdList(child, ctx))
    } else {
      ctx.unknown(child.type, '表格单元格')
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
      ctx.unknown(rowNode.type, '表格')
      continue
    }
    // 表格行/单元格不携带 nodeId（WP2 决策：NodeView 不渲染 data-node-id），
    // ID 由表 ID 确定性派生，满足 IR 字段完整与 JSON 往返
    const rowId = `${id}.r${rowSeq}`
    const cells: IRTableRow['cells'] = []
    let allHeader = true
    let cellSeq = 0
    for (const cellNode of rowNode.content ?? []) {
      if (cellNode.type !== 'tableCell' && cellNode.type !== 'tableHeader') {
        ctx.unknown(cellNode.type, '表格行')
        continue
      }
      if (cellNode.type !== 'tableHeader') allHeader = false
      const cellId = `${rowId}c${cellSeq}`
      cells.push({
        id: cellId,
        colspan: intAttr(cellNode, 'colspan', 1),
        rowspan: intAttr(cellNode, 'rowspan', 1),
        header: cellNode.type === 'tableHeader',
        content: convertTableCellBlocks(cellNode, cellId, ctx),
      })
      cellSeq += 1
    }
    if (allHeader && cells.length > 0 && !headerEnded) headerRowCount += 1
    else headerEnded = true
    rows.push({ id: rowId, cells })
    rowSeq += 1
  }

  const table: IRTable = {
    kind: 'table',
    id,
    caption: childInlines(node, 'tableCaption', ctx),
    orientation: node.attrs?.orientation === 'landscape' ? 'landscape' : 'portrait',
    headerRowCount,
    rows,
    notes: [],
  }
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
    let rest = run.text
    for (;;) {
      const m = rest.match(separator)
      if (!m || m.index === undefined) break
      const before = rest.slice(0, m.index)
      if (before) current.push(run.marks ? { text: before, marks: run.marks } : { text: before })
      segments.push(current)
      current = []
      rest = rest.slice(m.index + m[0].length)
    }
    if (rest) current.push(run.marks ? { text: rest, marks: run.marks } : { text: rest })
  }
  segments.push(current)
  return segments
}

/** 去除首尾空白与空运行：只在首尾边界克隆，单遍 + 边界收缩 */
function trimInlines(inlines: IRInline[]): IRInline[] {
  const out: IRInline[] = []
  for (const run of inlines) {
    if (run.text.length > 0) out.push(run)
  }
  while (out.length > 0) {
    const text = out[0].text.replace(/^\s+/, '')
    if (text) {
      if (text !== out[0].text) out[0] = { ...out[0], text }
      break
    }
    out.shift()
  }
  while (out.length > 0) {
    const last = out[out.length - 1]
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
  const content = node.content?.find((c) => c.type === 'formulaContent')
  const latex = plainText(convertInlines(content?.content, ctx)).trim()
  const desc = node.content?.find((c) => c.type === 'formulaDescription')
  return {
    kind: 'formula',
    id,
    latex,
    numbered: true,
    whereList: desc ? parseWhereList(convertInlines(desc.content, ctx), id) : [],
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
    // 历史文档兼容：StarterKit 节点已在编辑器中禁用，存量内容降级为普通段落，不得静默丢失
    case 'blockquote': {
      const id = ctx.id(node)
      ctx.warnings.push('引用块（blockquote）已降级为普通段落')
      const content: IRInline[] = []
      for (const child of node.content ?? []) {
        if (content.length > 0) content.push({ text: '\n' })
        content.push(...convertInlines(child.content, ctx))
      }
      return { kind: 'paragraph', id, content }
    }
    case 'codeBlock':
      ctx.warnings.push('代码块（codeBlock）已降级为普通段落')
      return { kind: 'paragraph', id: ctx.id(node), content: convertInlines(node.content, ctx) }
    case 'horizontalRule':
      ctx.warnings.push('分隔线（horizontalRule）无对应 IR 表示，已跳过')
      return null
    default:
      ctx.unknown(node.type, where)
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
  const nested: PMJsonNode[] = []
  let defSeq = 0
  for (const child of node.content ?? []) {
    switch (child.type) {
      case 'termName':
      case 'termNameEn':
        break
      case 'termDefinition':
        entry.definition.push(wrapParagraph(id, `def${defSeq}`, convertInlines(child.content, ctx)))
        defSeq += 1
        break
      case 'stdParagraph': {
        const inlines = convertInlines(child.content, ctx)
        // 「[来源：……]」段按 IRTermEntry.source 处理（最多一个，后续重复并入定义）
        if (!entry.source && /^\s*[[［]来源/.test(plainText(inlines))) {
          entry.source = inlines
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
        nested.push(child)
        break
      default:
        ctx.unknown(child.type, '术语条目')
    }
  }
  out.push(entry)
  for (const n of nested) {
    ctx.warnings.push('术语条目存在嵌套术语，已拍平为同级条目')
    convertTermDef(n, ctx, out)
  }
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
  return {
    kind: 'clause',
    id: ctx.id(node),
    level: level as IRClause['level'],
    titled,
    title: titled ? childInlines(node, 'clauseTitle', ctx) : [],
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
  const secType =
    CHAPTER_SEC_TYPES.find((s) => s.match.test(titleText))?.secType ?? 'general'
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
      ctx.unknown(child.type, '参考文献')
      continue
    }
    out.push({ kind: 'bibEntry', id: ctx.id(child), content: convertInlines(child.content, ctx) })
  }
  return out
}

// ----- 元数据 -----

function strAttr(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = attrs?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function convertMeta(docNode: PMJsonNode, coverPage: PMJsonNode | undefined, ctx: Ctx): IRDocMeta {
  const attrs = docNode.attrs
  const rawType = String(attrs?.standardType ?? 'national')
  let standardType = toIrStandardType(rawType)
  if (!standardType) {
    ctx.warnings.push(`标准类型「${rawType}」无法识别，已按国家标准处理`)
    standardType = 'gb'
  }
  const meta: IRDocMeta = { standardType }
  const set = (key: keyof Omit<IRDocMeta, 'standardType'>, value: string | undefined) => {
    if (value !== undefined) meta[key] = value
  }
  set('title', strAttr(attrs, 'titleCn'))
  set('titleEn', strAttr(attrs, 'titleEn'))
  set('stdCode', strAttr(attrs, 'standardNo'))
  set('icsCode', strAttr(attrs, 'icsCode'))
  set('ccsCode', strAttr(attrs, 'ccsCode'))
  set('publishDate', strAttr(attrs, 'publishDate'))
  set('implementDate', strAttr(attrs, 'implementDate'))
  // issuer 仅存在于 coverPage attrs（standardDoc 无此属性）
  set('issuer', strAttr(coverPage?.attrs, 'issuer'))
  return meta
}

// ---------- 入口 ----------

/**
 * 把 ProseMirror JSON（standardDoc 根）转换为 Authoring IR。
 * 纯函数：同样输入产出深度相等的输出。
 */
export function pmToIr(pmDoc: PMJsonNode): PmToIrResult {
  const ctx = new Ctx()
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

  const coverPage = pmDoc.content?.find((c) => c.type === 'coverPage')
  doc.meta = convertMeta(pmDoc, coverPage, ctx)

  for (const node of pmDoc.content ?? []) {
    switch (node.type) {
      case 'coverPage':
        // 封面内容由元数据生成，不入 IR
        break
      case 'foreword':
        doc.front.foreword = convertBlocks(node.content, ctx, '前言')
        break
      case 'introduction':
        doc.front.introduction = convertBlocks(node.content, ctx, '引言')
        break
      case 'chapter':
        doc.body.push(convertChapter(node, ctx))
        break
      case 'appendix':
        doc.appendices.push(convertAppendix(node, ctx))
        break
      case 'bibliography':
        doc.bibliography = convertBibliography(node, ctx)
        break
      default:
        ctx.unknown(node.type, '文档顶层')
    }
  }

  return { doc, warnings: ctx.warnings }
}
