/**
 * Resolver：Authoring IR → labels + problems（Phase 5.5 / WP3）。
 *
 * 全部编号逻辑集中于此（全局不变式 2）：渲染器只消费 labels 中的现成字符串。
 * 固定规则（不属于策略）：图/表/公式在正文全文连续编号、不按章重置；
 * 进入附录后按附录字母前缀重新计数；交叉引用解析失败产出 dangling-xref。
 *
 * 纯函数：不修改入参 doc，同一输入两次调用输出深度相等。
 */

import type {
  IRAppendix,
  IRBlock,
  IRChapter,
  IRClause,
  IRClauseChild,
  IRDoc,
  IRInline,
  IRNormRef,
  IRNote,
  IRProblem,
  IRTermEntry,
  NodeId,
  NumberingStrategy,
  ResolveResult,
  ResolvedLabel,
} from './types'
import { MISSING_ID_PREFIX } from './pmToIr'
import { gbT11Strategy, listItem as builtinListItem } from './strategies'
import { orderedTermTail } from './termTailOrder'

// ---------- 内部上下文 ----------

interface NoteScope {
  notes: { id: NodeId }[]
  examples: { id: NodeId }[]
}

interface ListItemCandidate {
  id: NodeId
  marker: string
  /** 有序祖先标记 + 本项标记，空格连接："a）"、"a） 1）" */
  markerPath: string
  /** visitBlock 传入的作用域 ID（最近的条/章/附录/术语条目/表…），其 label 即容器编号 */
  scopeKey: string
}

class ResolveCtx {
  labels: Record<NodeId, ResolvedLabel> = Object.create(null) as Record<NodeId, ResolvedLabel>
  problems: IRProblem[] = []
  /** 文档内出现过的全部 nodeId（含派生子 ID），用于重复检测与 xref 解析 */
  seenIds = new Set<NodeId>()
  /** 交叉引用出现顺序：[targetId, 所在块 nodeId] */
  xrefs: { targetId: NodeId; fromId: NodeId; typed?: boolean }[] = []
  /** 注/示例按作用域分组（作用域 = 最近的条或章/附录/术语条目/前言/引言/表/图） */
  scopes = new Map<string, NoteScope>()
  visitedInlines = new WeakSet<IRInline>()
  kinds = new Map<NodeId, string>()
  /** 有序列项候选（文档序）；只有被 crossRef 引用者才会在 labelReferencedListItems 里获得标签 */
  listItems: ListItemCandidate[] = []
  /** 无编号作用域（注/示例）→ 其外层作用域；列项 refText 据此回溯到最近的有编号祖先 */
  scopeParents = new Map<string, string>()
  /** 当前列项的有序祖先标记（嵌套列表的标记路径用）；无序祖先不贡献标记 */
  listMarkerPath: string[] = []
  /**
   * 当前所处的列表嵌套深度：0 = 不在任何列项内，1 = 位于一层列表的列项内……
   * 显式记录而不是用 `listMarkerPath` 是否为空推断：无序父列表不产生标记，却同样使其子列表成为嵌套列表。
   */
  listDepth = 0
  /** 规范性引用清单（WP8.M G1）：允许出现的清单 id（= 当前 norm-refs 章的直属清单）与已访问的清单数 */
  allowedNormRefLists = new Set<NodeId>()
  normRefListCount = 0
  targetTexts = new Map<NodeId, string>()
  typedRefs: { targetId: NodeId; fromId: NodeId; expectedKind: string; refKind: 'crossRef' | 'bibRef' | 'termRef' }[] = []
  /** note/example 的 xmlId 全局序号（按文档顺序，确定性） */
  noteSeq = 0
  exampleSeq = 0
  footnoteSeq = 0
  /** 缩略语项的 xmlId 全局序号（abb_<k>，文档序；D-M-02） */
  abbrSeq = 0
  footnoteDepth = 0
  inTerm = false
  tableFootnotes: { tableId: string; ids: Set<string>; referenced: Set<string>; seq: number } | undefined
  // 图/表/公式计数器：正文全文连续，附录内按附录重置
  figSeq = 0
  tableSeq = 0
  formulaSeq = 0
  /** 当前附录字母；undefined 表示正文/前置部分 */
  appendixLetter: string | undefined
  /** 编号策略。用显式字段而非参数属性：参数属性不可擦除，会触发消费端 erasableSyntaxOnly（TS1294）。 */
  readonly strategy: NumberingStrategy

  constructor(strategy: NumberingStrategy) {
    this.strategy = strategy
  }

  registerId(id: NodeId): void {
    if (typeof id !== 'string' || !id || id.startsWith(MISSING_ID_PREFIX)) {
      this.problems.push({
        code: 'missing-id',
        nodeId: id,
        severity: 'error',
        message: '节点缺少稳定 ID（nodeId），请在编辑器中重新打开文档以自动补齐',
      })
      this.seenIds.add(id)
      return
    }
    if (this.seenIds.has(id)) {
      this.problems.push({
        code: 'duplicate-id',
        nodeId: id,
        severity: 'error',
        message: `节点 ID「${id}」在文档中重复出现`,
      })
      return
    }
    this.seenIds.add(id)
  }

  setLabel(id: NodeId, label: string, xmlId: string, refText: string, extra?: Pick<ResolvedLabel, 'termEntryXmlId'>): void {
    this.labels[id] = extra ? { label, xmlId, refText, ...extra } : { label, xmlId, refText }
  }

  scope(key: string): NoteScope {
    let s = this.scopes.get(key)
    if (!s) {
      s = { notes: [], examples: [] }
      this.scopes.set(key, s)
    }
    return s
  }
}

/**
 * Resolver 对 `doc.unsupportedContent`（pmToIr 的诊断）与术语 `tailOrder` 无效重述为 unsupported-content error 时使用的文案。
 * 输出边界（outputBoundary.ts）已经按各自的路径阻断这两类问题；它用同一函数还原文案，以便把 Resolver 的重述识别出来、
 * 不再重复报告（见 getOutputSupportProblems 对 Resolver unsupported-content 的处理）。
 */
export function unsupportedContentProblemMessage(issue: { path: string; nodeType: string; reason: string }): string {
  return `${issue.path}（${issue.nodeType}）：${issue.reason}`
}
export function termTailOrderProblemMessage(reason: string): string {
  return `术语条目 tailOrder 无效：${reason}`
}

// ---------- 行内（收集交叉引用） ----------

// 与编辑器 canInsertBodyFootnote 保持一致；图中的限制沿块级子树传递。
type ForbiddenFootnoteContainer = '标题' | '图' | '公式主体' | '公式说明' | '定义列表'

/**
 * `allowImage`：行内图（IRInline.image，M-8.3-02）只允许出现在 IRParagraph.content（visitBlock 的 paragraph 分支传 true），
 * 且不在术语条目或脚注内。其余位置（标题、图题、术语名、脚注、文献、索引、元数据……）出现 image 报 unsupported-content（error）。
 */
function visitInlines(inlines: IRInline[], fromId: NodeId, ctx: ResolveCtx, forbiddenContainer?: ForbiddenFootnoteContainer, allowImage = false): void {
  for (const run of inlines) {
    ctx.visitedInlines.add(run)
    if (run.image) {
      const where = ctx.footnoteDepth ? '脚注' : ctx.inTerm ? '术语条目' : undefined
      if (!allowImage || where) {
        ctx.problems.push({
          code: 'unsupported-content', nodeId: fromId, severity: 'error',
          message: where
            ? `行内图不能放在${where}内；行内图只允许出现在正文段落（含列项、注、示例、单元格内的段落）中`
            : '行内图只允许出现在正文段落（含列项、注、示例、单元格内的段落）中，不能放在标题、图表题、术语名、文献、索引等位置',
        })
      }
    }
    if (run.formula) {
      ctx.registerId(run.formula.id)
      ctx.kinds.set(run.formula.id, 'formula')
      ctx.setLabel(run.formula.id, '', stableExtensionXmlId(run.formula.id), '行内公式')
    }
    if (run.footnote) {
      const note = run.footnote
      if (ctx.seenIds.has(note.id) || note.id.startsWith(MISSING_ID_PREFIX)) ctx.problems.push({ code: 'invalid-footnote', nodeId: note.id, severity: 'error', message: '脚注必须具有文档内唯一的稳定 ID' })
      if (forbiddenContainer || ctx.inTerm || ctx.tableFootnotes || ctx.footnoteDepth) {
        ctx.problems.push({ code: 'invalid-footnote', nodeId: fromId, severity: 'error', message: forbiddenContainer ? `${forbiddenContainer}中不能插入条文脚注` : '术语条目、表格及脚注内部不能插入条文脚注；表格请使用表脚注' })
        if (ctx.footnoteDepth) continue
      }
      ctx.registerId(note.id)
      const seq = ++ctx.footnoteSeq
      ctx.setLabel(note.id, `${seq})`, `fn_${seq}`, `${seq})`)
      if (!note.content.some(inline => inline.text.trim())) ctx.problems.push({ code: 'invalid-footnote', nodeId: note.id, severity: 'error', message: '脚注内容不能为空' })
      ctx.footnoteDepth += 1
      visitInlines(note.content, note.id, ctx)
      ctx.footnoteDepth -= 1
    }
    for (const mark of run.marks ?? []) {
      if (mark.type === 'crossRef') {
        ctx.xrefs.push({ targetId: mark.targetId, fromId })
        if (mark.targetKind) ctx.typedRefs.push({ targetId: mark.targetId, fromId, expectedKind: mark.targetKind, refKind: mark.type })
      }
      if (mark.type === 'bibRef' || mark.type === 'termRef') {
        ctx.xrefs.push({ targetId: mark.targetId, fromId, typed: true })
        ctx.typedRefs.push({ targetId: mark.targetId, fromId, expectedKind: mark.type === 'bibRef' ? 'bibliography' : 'term', refKind: mark.type })
      }
      if (mark.type === 'tableFootnoteRef') {
        const scope = ctx.tableFootnotes
        if (!scope || !scope.ids.has(mark.targetId) || ctx.footnoteDepth) {
          ctx.problems.push({ code: 'dangling-footnote', nodeId: fromId, severity: 'error', message: `表脚注上标的目标「${mark.targetId}」不在当前表中，或位于脚注内部` })
        } else if (!scope.referenced.has(mark.targetId)) {
          scope.referenced.add(mark.targetId)
          let n = ++scope.seq
          let label = ''
          while (n > 0) { n -= 1; label = String.fromCharCode(97 + n % 26) + label; n = Math.floor(n / 26) }
          ctx.setLabel(mark.targetId, label, `tabfn_${ctx.labels[scope.tableId]!.xmlId}_${label}`, label)
        }
      }
    }
  }
}

function inlinePlainText(inlines: IRInline[]): string {
  return inlines.map(run => run.text).join('')
}

/** GB/T 1.1—2020 10.3.4：规范性引用文件“文件之后不加标点符号”；中英文常见的句读标点 */
const NORM_REF_TRAILING_PUNCTUATION = new Set(['；', ';', '，', ',', '。', '.', '、'])

/**
 * 规范性引用条目末尾有标点：给 warning，不剥离、不阻断（旧稿常以“；”结尾，渲染与导出保持作者原文）。
 * std 看文件名称末尾（名称为空时看文件编号），mixed 看内容末尾；末尾空白不算。
 */
function warnTrailingPunctuation(entry: IRNormRef, ctx: ResolveCtx): void {
  const tail = entry.entryType === 'std'
    ? (inlinePlainText(entry.title).trim() ? entry.title : entry.ref)
    : entry.content
  const text = inlinePlainText(tail).trimEnd()
  const last = text.slice(-1)
  if (!last || !NORM_REF_TRAILING_PUNCTUATION.has(last)) return
  ctx.problems.push({
    code: 'trailing-punctuation', nodeId: entry.id, severity: 'warning',
    message: `规范性引用文件条目「${text.slice(0, 40)}」末尾有标点“${last}”：GB/T 1.1—2020 10.3.4 规定文件之后不加标点符号，请删除（输出时不会自动剥离）`,
  })
}

// ---------- 块级 ----------

/** 图/表编号公共头：登记 ID、计数自增、按附录前缀取号、写入 label（编号格式一致，仅策略方法与 xmlId 前缀不同） */
function labelFigureOrTable(id: NodeId, kind: 'fig' | 'tab', ctx: ResolveCtx): void {
  ctx.registerId(id)
  const seq = kind === 'fig' ? ++ctx.figSeq : ++ctx.tableSeq
  const label =
    kind === 'fig'
      ? ctx.strategy.figure(seq, ctx.appendixLetter)
      : ctx.strategy.table(seq, ctx.appendixLetter)
  const num = ctx.appendixLetter ? `${ctx.appendixLetter}.${seq}` : String(seq)
  ctx.setLabel(id, label, `${kind}_${num}`, label)
}

function visitNoteContent(note: IRNote, ctx: ResolveCtx, forbiddenContainer?: ForbiddenFootnoteContainer, parentScope?: string): void {
  ctx.registerId(note.id)
  if (parentScope !== undefined) ctx.scopeParents.set(note.id, parentScope)
  for (const block of note.content) visitBlock(block, note.id, ctx, forbiddenContainer)
}

/** Metadata inline fields precede the body and are serialized in this order by irToPm. */
function visitMetadataInlines(meta: IRDoc['meta'], ctx: ResolveCtx): void {
  for (const titlePart of meta.titleParts ?? []) {
    visitInlines(titlePart.content, titlePart.id, ctx, '标题')
  }
  for (const identifier of meta.identifiers ?? []) {
    for (const part of identifier.parts) visitInlines(part.content, part.id, ctx)
  }
  for (const publisher of meta.publishers ?? []) {
    visitInlines(publisher.name, publisher.id, ctx)
  }
  for (const copyright of meta.copyrights ?? []) {
    // holder is projected into a plain-text attribute; PM rejects marks on it.
    if (copyright.holder) visitInlines(copyright.holder, copyright.id, ctx)
    visitInlines(copyright.statement, copyright.id, ctx)
  }
}

/**
 * 访问一个块：登记 ID、计数图/表/公式、把注/示例归入作用域。
 * scopeKey = 最近的条或章（或附录/术语条目/前言/引言）的 ID。
 */
function visitBlock(block: IRBlock, scopeKey: string, ctx: ResolveCtx, forbiddenContainer?: ForbiddenFootnoteContainer): void {
  switch (block.kind) {
    case 'paragraph':
      ctx.registerId(block.id)
      visitInlines(block.content, block.id, ctx, forbiddenContainer, true)
      break
    case 'list': {
      ctx.registerId(block.id)
      // 只有「渲染时确有该标识」的列项才有标记（D-M-17）：
      // - 第一层的 alpha / number / roman：HTML 与 DOCX 都显示 a） / 1） / i）；
      // - 嵌套（第二层）的 number：HTML 仍显示 1），DOCX 另起 A13 实例显示 1）；
      // - 嵌套的 alpha / roman：HTML 显示间隔号“·”，DOCX 取父列表实例 ilvl 1（bullet“·”），都不是 b） / ii） 本身，不赋标记；
      // - 第三层及以下：DOCX 只输出 SesListDot（并给出 list-too-deep 警告），没有编号，不赋标记；
      // - 无序列项与 romanUpper 本来就没有标识。
      // 对没有标记的列项的引用照旧 dangling-xref（没有编号，无法生成引用文本），渲染器回退作者原文，不输出不存在的标识。
      const depth = ctx.listDepth + 1
      const ordered = block.listType === 'alpha' || block.listType === 'number' || block.listType === 'roman'
      const rendered = ordered && (depth === 1 || (depth === 2 && block.listType === 'number'))
      const inheritedPath = ctx.listMarkerPath
      ctx.listDepth = depth
      block.items.forEach((item, index) => {
        ctx.registerId(item.id)
        ctx.kinds.set(item.id, 'listItem')
        const marker = !rendered ? ''
          : ctx.strategy.listItem ? ctx.strategy.listItem(block.listType, index + 1) : builtinListItem(block.listType, index + 1)
        ctx.listMarkerPath = marker ? [...inheritedPath, marker] : inheritedPath
        if (marker) ctx.listItems.push({ id: item.id, marker, markerPath: ctx.listMarkerPath.join(' '), scopeKey })
        for (const child of item.content) visitBlock(child, scopeKey, ctx, forbiddenContainer)
      })
      ctx.listMarkerPath = inheritedPath
      ctx.listDepth = depth - 1
      break
    }
    case 'table': {
      labelFigureOrTable(block.id, 'tab', ctx)
      const previousTable = ctx.tableFootnotes
      const scope = { tableId: block.id, ids: new Set((block.footnotes ?? []).map(note => note.id)), referenced: new Set<string>(), seq: 0 }
      ctx.tableFootnotes = scope
      for (const note of block.footnotes ?? []) {
        if (ctx.seenIds.has(note.id) || note.id.startsWith(MISSING_ID_PREFIX)) ctx.problems.push({ code: 'invalid-footnote', nodeId: note.id, severity: 'error', message: '表脚注必须具有文档内唯一的稳定 ID' })
        ctx.registerId(note.id)
      }
      visitInlines(block.caption, block.id, ctx)
      if (block.captionEn) visitInlines(block.captionEn, block.id, ctx)
      for (const row of block.rows) {
        ctx.registerId(row.id)
        for (const cell of row.cells) {
          ctx.registerId(cell.id)
          for (const child of cell.content) visitBlock(child, block.id, ctx, forbiddenContainer)
        }
      }
      // 表内注独立计数：作用域 = 该表
      for (const note of block.notes) {
        visitNoteContent(note, ctx, forbiddenContainer, block.id)
        ctx.scope(block.id).notes.push({ id: note.id })
      }
      for (const note of block.footnotes ?? []) {
        if (!scope.referenced.has(note.id)) ctx.problems.push({ code: 'unreferenced-footnote', nodeId: note.id, severity: 'error', message: '表脚注没有当前表中的对应上标，请插入引用或删除该脚注' })
        if (!note.content.some(inline => inline.text.trim())) ctx.problems.push({ code: 'invalid-footnote', nodeId: note.id, severity: 'error', message: '表脚注内容不能为空' })
        ctx.footnoteDepth += 1
        visitInlines(note.content, note.id, ctx)
        ctx.footnoteDepth -= 1
      }
      ctx.tableFootnotes = previousTable
      break
    }
    case 'figure': {
      // §4.7「遍历顺序」：DOCX 按 9.11.1 把图中的注排在图题之上（§5.8），Resolver 据此先遍历
      // 注、再给图编号、最后遍历图题，与 Word 按文档顺序的计数保持一致。
      for (const note of block.notes) {
        visitNoteContent(note, ctx, '图', block.id)
        ctx.scope(block.id).notes.push({ id: note.id })
      }
      labelFigureOrTable(block.id, 'fig', ctx)
      visitInlines(block.caption, block.id, ctx, '图')
      if (block.captionEn) visitInlines(block.captionEn, block.id, ctx, '图')
      // Extended descriptions are emitted directly after the captions. Visit their
      // inline references here so bibliography order follows the figure's position.
      for (const description of block.descriptions ?? []) {
        visitInlines(description.content, description.id, ctx, '图')
      }
      for (const group of block.groups ?? []) {
        for (const description of group.descriptions) {
          visitInlines(description.content, description.id, ctx, '图')
        }
      }
      // 图例（M-8.5-01～06）：登记容器与各项 id，标题与项内行内按文档顺序访问；图例项不赋 label（C-T-31：不带 id、不可被引用，
      // 对它们的 crossRef 由 checkXrefs 报「没有编号」）。项内脚注沿用「图」的禁止规则。
      if (block.legend) {
        ctx.registerId(block.legend.id)
        if (block.legend.title) visitInlines(block.legend.title, block.legend.id, ctx, '图')
        for (const item of block.legend.items) {
          ctx.registerId(item.id)
          visitInlines(item.term, item.id, ctx, '图')
          visitInlines(item.definition, item.id, ctx, '图')
        }
      }
      // 图中的示例（M-8.4-03）：作用域 = 本图，标签沿用「示例：/示例n：」，与块位置的示例同一机制。
      for (const example of block.examples ?? []) {
        ctx.registerId(example.id)
        ctx.scopeParents.set(example.id, block.id)
        for (const child of example.content) visitBlock(child, example.id, ctx, '图')
        ctx.scope(block.id).examples.push({ id: example.id })
      }
      break
    }
    case 'formula': {
      ctx.registerId(block.id)
      if (block.numbered) {
        ctx.formulaSeq += 1
        const label = ctx.strategy.formula(ctx.formulaSeq, ctx.appendixLetter)
        const num = ctx.appendixLetter
          ? `${ctx.appendixLetter}.${ctx.formulaSeq}`
          : String(ctx.formulaSeq)
        ctx.setLabel(block.id, label, `formula_${num}`, `公式${label}`)
      }
      if (block.sourceInlines) {
        visitInlines(block.sourceInlines, block.id, ctx, '公式主体')
        // 表内公式的上标也不能在纯 LaTeX 渲染时被静默抹掉。
        if (block.sourceInlines.some(run => run.marks?.some(mark => mark.type === 'tableFootnoteRef'))) {
          ctx.problems.push({ code: 'invalid-footnote', nodeId: block.id, severity: 'error', message: '公式主体中不能插入表脚注上标' })
        }
      }
      for (const note of block.notes ?? []) {
        // Formula notes have no `kind` discriminator in IRFormulaNote. The generic
        // extension scan preserves a kind registered here instead of assigning `entity`.
        ctx.kinds.set(note.id, 'note')
        visitInlines(note.content, note.id, ctx, '公式说明')
      }
      for (const item of block.whereList) {
        ctx.registerId(item.id)
        visitInlines(item.term, item.id, ctx, '公式说明')
        visitInlines(item.definition, item.id, ctx, '公式说明')
      }
      break
    }
    case 'defList': {
      // 缩略语表（M-10.1.4-01/-03/-04/-05）：项可被 crossRef(targetKind='abbreviation') 引用。
      // label / refText 为术语纯文本，xmlId = abb_<k>（k 为全文缩略语项序，D-M-02）；项内不得有条文脚注。
      // kind 在此先登记，通用扫描（registerExtendedData）不会覆盖，也不会补 ext_ 占位标签。
      ctx.registerId(block.id)
      for (const item of block.items) {
        ctx.registerId(item.id)
        ctx.kinds.set(item.id, 'abbreviation')
        visitInlines(item.term, item.id, ctx, '定义列表')
        visitInlines(item.definition, item.id, ctx, '定义列表')
        const term = item.term.map(run => run.text).join('')
        ctx.setLabel(item.id, term, `abb_${++ctx.abbrSeq}`, term)
      }
      break
    }
    case 'warning': case 'quote':
      ctx.registerId(block.id)
      for (const child of block.content) visitBlock(child, scopeKey, ctx, forbiddenContainer)
      break
    case 'normRefList': {
      // M-4.4.2.3-02：规范性引用清单只能是 secType==='norm-refs' 章的直属块（8.6：清单是该章内容，章不分条）。
      ctx.registerId(block.id)
      if (!ctx.allowedNormRefLists.has(block.id)) {
        ctx.problems.push({
          code: 'unsupported-content', nodeId: block.id, severity: 'error',
          message: '规范性引用文件清单只能出现在「规范性引用文件」章（secType 为 norm-refs）中，不能放在其他位置',
        })
      }
      if (++ctx.normRefListCount > 1) {
        // 条目 xmlId 取清单内序号（ref_<n>），第二个清单会让 XML 里的 id 重复；规范性引用文件只设一个清单，必须合并。
        ctx.problems.push({
          code: 'unsupported-content', nodeId: block.id, severity: 'error',
          message: '文档中出现多个规范性引用文件清单：条目 xmlId（ref_<n>，n 为清单内序号）会重复，导出 XML 时 id 冲突；规范性引用文件只设一个清单，请合并为一个清单',
        })
      }
      // R-8：条目 xmlId = ref_<清单内序号>，label 为空（条目之前不给序号，GB/T 1.1—2020 8.6.3.1）。
      // 条目内行内（含脚注）按文档顺序访问，脚注允许（与参考文献一致）。
      block.entries.forEach((entry, index) => {
        ctx.registerId(entry.id)
        ctx.kinds.set(entry.id, 'normRef')
        const text = entry.entryType === 'std' ? inlinePlainText(entry.ref) : inlinePlainText(entry.content).slice(0, 40)
        ctx.setLabel(entry.id, '', `ref_${index + 1}`, text)
        if (entry.entryType === 'std') {
          visitInlines(entry.ref, entry.id, ctx, forbiddenContainer)
          visitInlines(entry.title, entry.id, ctx, forbiddenContainer)
        } else visitInlines(entry.content, entry.id, ctx, forbiddenContainer)
        warnTrailingPunctuation(entry, ctx)
      })
      break
    }
    case 'code':
      ctx.registerId(block.id)
      break
    case 'note':
      visitNoteContent(block, ctx, forbiddenContainer, scopeKey)
      ctx.scope(scopeKey).notes.push({ id: block.id })
      break
    case 'example':
      ctx.registerId(block.id)
      ctx.scopeParents.set(block.id, scopeKey)
      for (const child of block.content) visitBlock(child, block.id, ctx, forbiddenContainer)
      ctx.scope(scopeKey).examples.push({ id: block.id })
      break
  }
}

// ---------- 术语条目 ----------

function visitTermEntry(
  entry: IRTermEntry,
  numberPath: string,
  ctx: ResolveCtx,
): void {
  const previousTerm = ctx.inTerm
  ctx.inTerm = true
  // §4.7「遍历顺序」：DOCX 按 8.7.3.1／9.11.1 的顺序是 术语→定义→示例→注→来源（§5.4），
  // Resolver 据此遍历，与 Word 按文档顺序的计数保持一致。
  ctx.registerId(entry.id)
  // R-3：术语条目另有独立 xmlId term_<编号>（编号与 label 相同），与 sec_<编号> 并存。
  ctx.setLabel(entry.id, numberPath, `sec_${numberPath}`, numberPath, { termEntryXmlId: `term_${numberPath}` })
  visitInlines(entry.term, entry.id, ctx)
  if (entry.termEn) visitInlines(entry.termEn, entry.id, ctx)
  // M-9.2.9-01：领域位于术语名之后、定义之前；inTerm 已为真，其中的条文脚注自动报错。
  if (entry.subjectField) visitInlines(entry.subjectField, entry.id, ctx)
  if (entry.definition[0]) visitBlock(entry.definition[0], entry.id, ctx)
  // Legacy native IR retains the published DOCX sequence example→note→source.
  // PM-imported extended terms use explicit order so nested/TBX references follow
  // the visible author sequence without changing that no-metadata contract.
  const tail = orderedTermTail(entry, 'resolver')
  if (tail.issue) ctx.problems.push({
    code: 'unsupported-content',
    nodeId: entry.id,
    severity: 'error',
    message: termTailOrderProblemMessage(tail.issue),
  })
  for (const item of tail.items) {
    switch (item.kind) {
      case 'definition':
        visitBlock(item.value, entry.id, ctx)
        break
      case 'example': {
        const example = item.value
        ctx.registerId(example.id)
        ctx.scopeParents.set(example.id, entry.id)
        for (const block of example.content) visitBlock(block, example.id, ctx)
        ctx.scope(entry.id).examples.push({ id: example.id })
        break
      }
      case 'note': {
        const note = item.value
        visitNoteContent(note, ctx, undefined, entry.id)
        ctx.scope(entry.id).notes.push({ id: note.id })
        break
      }
      case 'source':
        visitInlines(item.value, entry.id, ctx)
        break
      case 'nestedEntry':
        visitTermEntry(item.value, `${numberPath}.${item.index + 1}`, ctx)
        break
      case 'languageSet':
        for (const group of item.value.groups) {
          for (const variant of group.terms) {
            visitInlines(variant.content, variant.id, ctx)
            for (const descriptor of variant.descriptors) {
              visitInlines(descriptor.value, descriptor.id, ctx)
            }
          }
        }
        break
    }
  }
  ctx.inTerm = previousTerm
}

// ---------- 条 / 章 / 附录 ----------

/** 编号路径：[5] / [5,1] / ['A'] / ['A',2]，章号或附录字母为首元素，编号格式由 strategy.clause 决定 */
function visitSectionChildren(
  children: IRClauseChild[],
  containerId: NodeId,
  containerLabel: string,
  path: Array<number | string>,
  expectedChildLevel: number,
  ctx: ResolveCtx,
): void {
  let numberedSeq = 0
  // 悬置段只对含「条」的容器报告：术语章的引导语与术语条目并存是 GB/T 1.1 的规范写法
  let hasClauseChild = false
  let hasDirectBlock = false

  for (const child of children) {
    if (child.kind === 'clause' || child.kind === 'termEntry') {
      if (child.kind === 'clause') hasClauseChild = true
      numberedSeq += 1
      const childPath = [...path, numberedSeq]
      const numberPath = ctx.strategy.clause(childPath)
      if (child.kind === 'clause') {
        if (child.level !== expectedChildLevel) {
          ctx.problems.push({
            code: 'heading-skip',
            nodeId: child.id,
            severity: 'warning',
            message: `条「${numberPath}」层级为 ${child.level}，应为 ${expectedChildLevel}（层级跳级）`,
          })
        }
        visitClause(child, childPath, expectedChildLevel + 1, ctx)
      } else {
        visitTermEntry(child, numberPath, ctx)
      }
    } else {
      hasDirectBlock = true
      visitBlock(child, containerId, ctx)
    }
  }

  if (hasClauseChild && hasDirectBlock) {
    ctx.problems.push({
      code: 'hanging-paragraph',
      nodeId: containerId,
      severity: 'warning',
      message: `「${containerLabel}」含有子条，同时直接含有正文段（悬置段），GB/T 1.1 不允许`,
    })
  }
  if (children.length === 0) {
    ctx.problems.push({
      code: 'empty-section',
      nodeId: containerId,
      severity: 'warning',
      message: `「${containerLabel}」没有任何内容`,
    })
  }
}

function visitClause(
  clause: IRClause,
  path: Array<number | string>,
  expectedChildLevel: number,
  ctx: ResolveCtx,
): void {
  ctx.registerId(clause.id)
  const numberPath = ctx.strategy.clause(path)
  ctx.setLabel(clause.id, numberPath, `sec_${numberPath}`, numberPath)
  visitInlines(clause.title, clause.id, ctx, '标题')
  visitSectionChildren(clause.children, clause.id, numberPath, path, expectedChildLevel, ctx)
}

function visitChapter(chapter: IRChapter, seq: number, ctx: ResolveCtx): void {
  // 规范性引用清单只在 norm-refs 章的直属块位置合法（见 visitBlock 的 normRefList 分支）
  if (chapter.secType === 'norm-refs') {
    for (const child of chapter.children) if (child.kind === 'normRefList') ctx.allowedNormRefLists.add(child.id)
  }
  ctx.registerId(chapter.id)
  const num = ctx.strategy.chapter(seq)
  ctx.setLabel(chapter.id, num, `sec_${num}`, `第${num}章`)
  visitInlines(chapter.title, chapter.id, ctx, '标题')
  visitSectionChildren(chapter.children, chapter.id, `第${num}章`, [seq], 1, ctx)
}

function visitAppendix(appendix: IRAppendix, seq: number, ctx: ResolveCtx): void {
  ctx.registerId(appendix.id)
  const letter = ctx.strategy.appendixLetter(seq)
  const label = ctx.strategy.appendix(seq)
  ctx.setLabel(appendix.id, label, `sec_${letter}`, label)
  visitInlines(appendix.title, appendix.id, ctx, '标题')
  // 附录内图/表/公式按字母前缀重新计数
  ctx.appendixLetter = letter
  ctx.figSeq = 0
  ctx.tableSeq = 0
  ctx.formulaSeq = 0
  visitSectionChildren(appendix.children, appendix.id, label, [letter], 1, ctx)
}

// ---------- 注/示例编号（作用域收集完成后统一赋号） ----------

function labelScopeGroup(
  items: { id: NodeId }[],
  labelOf: (index: number, totalInScope: number) => string,
  xmlPrefix: string,
  nextSeq: () => number,
  ctx: ResolveCtx,
): void {
  items.forEach(({ id }, i) => {
    const label = labelOf(i + 1, items.length)
    ctx.setLabel(id, label, `${xmlPrefix}_${nextSeq()}`, label.replace(/：$/, ''))
  })
}

function labelNotesAndExamples(ctx: ResolveCtx): void {
  for (const scope of ctx.scopes.values()) {
    labelScopeGroup(scope.notes, (i, t) => ctx.strategy.note(i, t), 'note', () => ++ctx.noteSeq, ctx)
    labelScopeGroup(scope.examples, (i, t) => ctx.strategy.example(i, t), 'example', () => ++ctx.exampleSeq, ctx)
  }
}

// ---------- 列项标签（仅被引用者） ----------

/**
 * 列项所在作用域的编号：作用域自身有编号（条、章、附录、术语条目、表、图）就用它；
 * 注/示例等无编号作用域沿 scopeParents 回溯到最近的有编号祖先。前言/引言等没有任何编号祖先时返回 undefined。
 * 此时注/示例尚未赋号（labelNotesAndExamples 在后），它们的 label 一定还不存在，不会被误当容器编号。
 */
function nearestNumberedScopeLabel(scopeKey: string, ctx: ResolveCtx): string | undefined {
  const seen = new Set<string>()
  for (let key: string | undefined = scopeKey; key !== undefined && !seen.has(key); key = ctx.scopeParents.get(key)) {
    seen.add(key)
    const label = ctx.labels[key]?.label
    if (label) return label
  }
  return undefined
}

/**
 * 给被 crossRef 引用的有序列项赋标签（WP8.M / G4，设计 §3.2）：
 * label = 本项标记（"a）"），xmlId = li_<k>（k 为被引用列项的文档序），
 * refText = 容器编号 + 空格 + 标记路径（"5.2 a）"、"5.2 a） 1）"）。
 * 容器取最近的有编号作用域（注/示例内的列表回溯到所在条、术语条目、表、图）；前言/引言等没有编号祖先时只写标记路径。
 * 必须在 checkTypedReferences 之前：否则类型正确但无标签的目标会被补成 ext_ 占位标签。
 * 未被引用的列项保持无标签，这样现有文档的 HTML/DOCX 输出不新增任何 id。
 * 候选只含渲染时确有该标识的列项（visitBlock 的 list 分支，D-M-17）：嵌套的 alpha / roman 渲染为间隔号，不在候选内。
 */
function labelReferencedListItems(ctx: ResolveCtx): void {
  const referenced = new Set<NodeId>()
  for (const { targetId, typed } of ctx.xrefs) if (!typed) referenced.add(targetId)
  if (referenced.size === 0) return
  let seq = 0
  const labeled = new Set<NodeId>()
  for (const item of ctx.listItems) {
    if (!referenced.has(item.id) || labeled.has(item.id)) continue
    labeled.add(item.id)
    const container = nearestNumberedScopeLabel(item.scopeKey, ctx)
    ctx.setLabel(item.id, item.marker, `li_${++seq}`, container ? `${container} ${item.markerPath}` : item.markerPath)
  }
}

// ---------- 参考文献 ----------

function resolveBibliography(doc: IRDoc, ctx: ResolveCtx): NodeId[] {
  const bibIds = new Set(doc.bibliography.map((e) => e.id))
  for (const entry of doc.bibliography) if (!ctx.seenIds.has(entry.id)) ctx.registerId(entry.id)
  // 按正文出现顺序：先被引用者按首次引用顺序，未被引用者按原顺序居后
  const order: NodeId[] = []
  const placed = new Set<NodeId>()
  for (const { targetId } of ctx.xrefs) {
    if (bibIds.has(targetId) && !placed.has(targetId)) {
      placed.add(targetId)
      order.push(targetId)
    }
  }
  for (const entry of doc.bibliography) {
    if (!placed.has(entry.id)) order.push(entry.id)
  }
  order.forEach((id, i) => {
    const label = ctx.strategy.bibEntry(i + 1)
    ctx.setLabel(id, label, `biblref_${i + 1}`, label)
  })
  // 文献按引用顺序输出，文献中的脚注也必须按最终输出顺序编号。
  for (const id of order) {
    const entry = doc.bibliography.find(entry => entry.id === id)!
    visitInlines(entry.content, entry.id, ctx)
    for (const field of entry.fields ?? []) visitInlines(field.value, field.id, ctx)
  }
  return order
}

// ---------- 交叉引用校验 ----------

function checkXrefs(ctx: ResolveCtx): void {
  for (const { targetId, fromId, typed } of ctx.xrefs) {
    if (typed && ctx.typedRefs.some(ref => ref.targetId === targetId && ctx.kinds.get(targetId) !== ref.expectedKind)) continue
    if (!ctx.seenIds.has(targetId)) {
      ctx.problems.push({
        code: 'dangling-xref',
        nodeId: fromId,
        severity: 'error',
        message: `交叉引用的目标「${targetId}」在文档中不存在`,
      })
    } else if (!ctx.labels[targetId]) {
      ctx.problems.push({
        code: 'dangling-xref',
        nodeId: fromId,
        severity: 'error',
        message: `交叉引用的目标「${targetId}」没有编号，无法生成引用文本`,
      })
    }
  }
}

// ---------- WP6 typed entities and targets ----------

/** Project convention only; final external XML ID vocabulary belongs to WP8.1. */
function stableExtensionXmlId(id: string): string {
  return `ext_${Array.from(id).map(char => char.codePointAt(0)!.toString(16)).join('_')}`
}

function contentText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  if (Array.isArray(value)) return value.map(contentText).join('')
  const row = value as Record<string, unknown>
  return typeof row.text === 'string' ? row.text : contentText(row.content)
}

/** Inline arrays emitted after the body are processed at their own output positions. */
function collectDeferredInlineArrays(doc: IRDoc): WeakSet<object> {
  const arrays = new WeakSet<object>()
  const defer = (inlines: IRInline[] | undefined): void => {
    if (inlines) arrays.add(inlines)
  }
  for (const entry of doc.bibliography) {
    defer(entry.content)
    for (const field of entry.fields ?? []) defer(field.value)
  }
  defer(doc.bibliographyTitle)
  if (doc.index) {
    defer(doc.index.title)
    for (const group of doc.index.groups) {
      defer(group.label)
      for (const entry of group.entries) defer(entry.term)
    }
  }
  return arrays
}

/** Inspect typed IDs/resources/index targets without consuming deferred inline arrays. */
function registerExtendedData(
  doc: IRDoc,
  ctx: ResolveCtx,
  deferredInlineArrays: WeakSet<object>,
): { targetId: string; ownerId: string | null; path: string }[] {
  const definitions = new Set<string>()
  const resourceIds = new Set((doc.resources ?? []).map(resource => resource.id))
  const resourceRefs: { targetId: string; ownerId: string | null; path: string }[] = []
  const indexRefs: { targetId: string; ownerId: string | null; path: string }[] = []
  const visit = (value: unknown, path: string, parentId: string | null, forbidden?: ForbiddenFootnoteContainer): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      if (deferredInlineArrays.has(value)) return
      value.forEach((item, index) => visit(item, `${path}[${index}]`, parentId, forbidden))
      return
    }
    const row = value as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : null
    const ownerId = id ?? parentId
    const previousTerm = ctx.inTerm
    if (row.kind === 'termEntry') ctx.inTerm = true
    const location = row.kind === 'figure' ? '图' : row.kind === 'formula' ? '公式说明' : path.startsWith('doc.meta.titleParts[') ? '标题' : forbidden
    if (id !== null) {
      if (definitions.has(id) && !ctx.problems.some(problem => problem.code === 'duplicate-id' && problem.nodeId === id)) {
        ctx.problems.push({ code: 'duplicate-id', nodeId: id, severity: 'error', message: `节点 ID「${id}」在文档中重复出现（${path}）` })
      }
      definitions.add(id)
      const kind = row.kind === 'termEntry' ? 'term' : row.kind === 'bibEntry' ? 'bibliography'
        : typeof row.kind === 'string' ? row.kind
          : path === 'doc.index' ? 'index' : path.startsWith('doc.resources[') ? 'resource' : 'entity'
      // Inline formula registration already supplied its specific kind.
      if (!ctx.kinds.has(id) || kind !== 'entity') ctx.kinds.set(id, kind)
      ctx.targetTexts.set(id, contentText(row.content ?? row.term ?? row.title ?? row.name ?? row.value).slice(0, 40) || id)
      const alreadyRegistered = ctx.seenIds.has(id)
      if (!alreadyRegistered) ctx.registerId(id)
      if (!alreadyRegistered || (!ctx.labels[id] && ['warning', 'quote', 'code'].includes(kind))) {
        ctx.setLabel(id, '', stableExtensionXmlId(id), ctx.targetTexts.get(id)!)
      }
    }
    if (typeof row.text === 'string' && !row.kind && !ctx.visitedInlines.has(row as unknown as IRInline)) {
      visitInlines([row as unknown as IRInline], ownerId ?? path, ctx, location)
    }
    for (const [key, child] of Object.entries(row)) {
      const at = `${path}.${key}`
      if (key === 'resourceId' && typeof child === 'string') resourceRefs.push({ targetId: child, ownerId, path: at })
      if ((key === 'resourceRefs' || key === 'targets' || key === 'seeAlso') && Array.isArray(child)) {
        for (const targetId of child) if (typeof targetId === 'string') {
          (key === 'resourceRefs' ? resourceRefs : indexRefs).push({ targetId, ownerId, path: at })
        }
      }
      if (key !== 'unsupportedContent' && key !== 'unmappedFootnotes' && !(row.kind === 'bibEntry' && key === 'content')) visit(child, at, ownerId, location)
    }
    ctx.inTerm = previousTerm
  }
  visit(doc, 'doc', null)
  for (const ref of resourceRefs) if (!resourceIds.has(ref.targetId)) {
    ctx.problems.push({ code: 'dangling-resource', nodeId: ref.ownerId, severity: 'error', message: `${ref.path} 的资源目标「${ref.targetId}」不存在` })
  }
  for (const issue of doc.unsupportedContent ?? []) {
    ctx.problems.push({ code: 'unsupported-content', nodeId: issue.nodeId, severity: 'error', message: unsupportedContentProblemMessage(issue) })
  }
  return indexRefs
}

function checkTypedReferences(ctx: ResolveCtx): void {
  for (const ref of ctx.typedRefs) {
    const actualKind = ctx.kinds.get(ref.targetId)
    // Missing crossRef targets are reported by checkXrefs; existing targets must
    // still be type-checked even when no numbered label has been assigned.
    if (ref.refKind === 'crossRef' && !ctx.seenIds.has(ref.targetId)) continue
    if (actualKind !== ref.expectedKind) {
      ctx.problems.push({ code: 'dangling-typed-ref', nodeId: ref.fromId, severity: 'error', message: `引用目标「${ref.targetId}」应为 ${ref.expectedKind}，实际为 ${actualKind ?? '不存在'}` })
    } else if (!ctx.labels[ref.targetId] && actualKind !== 'listItem') {
      // Explicit typed targets can reference entities without a numbered label.
      // 列项是例外：无序列项与 romanUpper 没有编号，不补占位标签，让 checkXrefs 报「没有编号」的 dangling-xref。
      ctx.setLabel(ref.targetId, '', stableExtensionXmlId(ref.targetId), ctx.targetTexts.get(ref.targetId) ?? ref.targetId)
    }
  }
}

/** Index content is serialized after the bibliography and must not affect its order. */
function visitIndexInlines(index: IRDoc['index'], ctx: ResolveCtx): void {
  if (!index) return
  if (index.title) visitInlines(index.title, index.id, ctx)
  for (const group of index.groups) {
    if (group.label) visitInlines(group.label, group.id, ctx)
    for (const entry of group.entries) visitInlines(entry.term, entry.id, ctx)
  }
}

function checkIndexTargets(
  refs: { targetId: string; ownerId: string | null; path: string }[],
  ctx: ResolveCtx,
): void {
  for (const ref of refs) if (!ctx.seenIds.has(ref.targetId)) {
    ctx.problems.push({ code: 'dangling-index-target', nodeId: ref.ownerId, severity: 'error', message: `${ref.path} 的索引目标「${ref.targetId}」不存在` })
  }
}

// ---------- 入口 ----------

/**
 * 解析 IR 文档：派生编号 labels、检测结构问题。
 * 不复制树：返回原 doc + labels + problems + bibliographyOrder。
 */
export function resolve(doc: IRDoc, strategy: NumberingStrategy = gbT11Strategy): ResolveResult {
  const ctx = new ResolveCtx(strategy)

  for (const source of doc.unmappedFootnotes ?? []) {
    const location = source.container === 'bibliographyTitle' ? '参考文献标题'
      : source.container === 'appendixLabel' ? '附录标识'
        : source.container === 'clauseTitle' ? '无题条标题' : '当前内容'
    const message = source.container === 'unsupportedFootnotePayload'
      ? `脚注「${source.nodeId}」包含暂不支持的${source.reason ?? '内容结构'}，不能导出以避免内容丢失`
      : `${location}中的脚注不支持导出，请移至受支持的正文或表格位置`
    ctx.problems.push({ code: 'invalid-footnote', nodeId: source.nodeId, severity: 'error', message })
    visitInlines(source.content, source.nodeId, ctx)
  }

  visitMetadataInlines(doc.meta, ctx)

  // 前置部分（前言/引言）：注/示例作用域为各自部分；图表公式与正文共用计数器
  for (const block of doc.front.foreword) visitBlock(block, 'front.foreword', ctx)
  const introductionClauses = doc.front.introductionClauses ?? []
  if (introductionClauses.length === 0) {
    for (const block of doc.front.introduction) visitBlock(block, 'front.introduction', ctx)
  } else {
    // 引言有条（GB/T 1.1—2020 8.4）：引言不给章编号，条仅编号 0.1、0.2……。路径首元素取数字 0，
    // strategy.clause([0, n]) 得 "0.n"，xmlId 为 sec_0.n（R-7）；复用章/条的遍历，条内注/示例/
    // 脚注作用域、层级检查与悬置段检查与正文一致。引言自身的 sec_0 / sec_intro 是渲染器常量（R-6、X-05），不在此赋值。
    visitSectionChildren([...doc.front.introduction, ...introductionClauses], 'front.introduction', '引言', [0], 1, ctx)
  }

  doc.body.forEach((chapter, i) => visitChapter(chapter, i + 1, ctx))
  doc.appendices.forEach((appendix, i) => visitAppendix(appendix, i + 1, ctx))

  const deferredInlineArrays = collectDeferredInlineArrays(doc)
  const indexTargets = registerExtendedData(doc, ctx, deferredInlineArrays)
  // M-4.5.3-02：自定义参考文献标题只做检查（标题内不能有条文脚注），不产生标签；先于条目访问，与输出顺序一致。
  if (doc.bibliographyTitle) visitInlines(doc.bibliographyTitle, 'doc.bibliographyTitle', ctx, '标题')
  const bibliographyOrder = resolveBibliography(doc, ctx)
  visitIndexInlines(doc.index, ctx)
  checkIndexTargets(indexTargets, ctx)
  // 参考文献与索引内的引用此时都已进入 ctx.xrefs；必须先于 checkTypedReferences（见函数注释）。
  labelReferencedListItems(ctx)
  checkTypedReferences(ctx)
  labelNotesAndExamples(ctx)
  checkXrefs(ctx)

  return { doc, labels: ctx.labels, problems: ctx.problems, bibliographyOrder }
}
