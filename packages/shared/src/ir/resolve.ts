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
  IRNote,
  IRProblem,
  IRTermEntry,
  NodeId,
  NumberingStrategy,
  ResolveResult,
  ResolvedLabel,
} from './types'
import { MISSING_ID_PREFIX } from './pmToIr'
import { gbT11Strategy } from './strategies'

// ---------- 内部上下文 ----------

interface NoteScope {
  notes: { id: NodeId }[]
  examples: { id: NodeId }[]
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
  targetTexts = new Map<NodeId, string>()
  typedRefs: { targetId: NodeId; fromId: NodeId; expectedKind: string; refKind: 'crossRef' | 'bibRef' | 'termRef' }[] = []
  /** note/example 的 xmlId 全局序号（按文档顺序，确定性） */
  noteSeq = 0
  exampleSeq = 0
  footnoteSeq = 0
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

  setLabel(id: NodeId, label: string, xmlId: string, refText: string): void {
    this.labels[id] = { label, xmlId, refText }
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

// ---------- 行内（收集交叉引用） ----------

// 与编辑器 canInsertBodyFootnote 保持一致；图中的限制沿块级子树传递。
type ForbiddenFootnoteContainer = '标题' | '图' | '公式主体' | '公式说明'

function visitInlines(inlines: IRInline[], fromId: NodeId, ctx: ResolveCtx, forbiddenContainer?: ForbiddenFootnoteContainer): void {
  for (const run of inlines) {
    ctx.visitedInlines.add(run)
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

function visitNoteContent(note: IRNote, ctx: ResolveCtx, forbiddenContainer?: ForbiddenFootnoteContainer): void {
  ctx.registerId(note.id)
  for (const block of note.content) visitBlock(block, note.id, ctx, forbiddenContainer)
}

/**
 * 访问一个块：登记 ID、计数图/表/公式、把注/示例归入作用域。
 * scopeKey = 最近的条或章（或附录/术语条目/前言/引言）的 ID。
 */
function visitBlock(block: IRBlock, scopeKey: string, ctx: ResolveCtx, forbiddenContainer?: ForbiddenFootnoteContainer): void {
  switch (block.kind) {
    case 'paragraph':
      ctx.registerId(block.id)
      visitInlines(block.content, block.id, ctx, forbiddenContainer)
      break
    case 'list':
      ctx.registerId(block.id)
      for (const item of block.items) {
        ctx.registerId(item.id)
        for (const child of item.content) visitBlock(child, scopeKey, ctx, forbiddenContainer)
      }
      break
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
        visitNoteContent(note, ctx, forbiddenContainer)
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
        visitNoteContent(note, ctx, '图')
        ctx.scope(block.id).notes.push({ id: note.id })
      }
      labelFigureOrTable(block.id, 'fig', ctx)
      visitInlines(block.caption, block.id, ctx, '图')
      if (block.captionEn) visitInlines(block.captionEn, block.id, ctx, '图')
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
      for (const item of block.whereList) {
        ctx.registerId(item.id)
        visitInlines(item.term, item.id, ctx, '公式说明')
        visitInlines(item.definition, item.id, ctx, '公式说明')
      }
      break
    }
    case 'warning': case 'quote':
      ctx.registerId(block.id)
      for (const child of block.content) visitBlock(child, scopeKey, ctx, forbiddenContainer)
      break
    case 'code':
      ctx.registerId(block.id)
      break
    case 'note':
      visitNoteContent(block, ctx, forbiddenContainer)
      ctx.scope(scopeKey).notes.push({ id: block.id })
      break
    case 'example':
      ctx.registerId(block.id)
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
  ctx.setLabel(entry.id, numberPath, `sec_${numberPath}`, numberPath)
  visitInlines(entry.term, entry.id, ctx)
  if (entry.termEn) visitInlines(entry.termEn, entry.id, ctx)
  for (const block of entry.definition) visitBlock(block, entry.id, ctx)
  for (const example of entry.examples) {
    ctx.registerId(example.id)
    for (const block of example.content) visitBlock(block, example.id, ctx)
    ctx.scope(entry.id).examples.push({ id: example.id })
  }
  for (const note of entry.notes) {
    visitNoteContent(note, ctx)
    ctx.scope(entry.id).notes.push({ id: note.id })
  }
  if (entry.source) visitInlines(entry.source, entry.id, ctx)
  for (const [index, child] of (entry.nestedEntries ?? []).entries()) {
    visitTermEntry(child, `${numberPath}.${index + 1}`, ctx)
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
    ctx.setLabel(id, label, `bib_${i + 1}`, label)
  })
  // 文献按引用顺序输出，文献中的脚注也必须按最终输出顺序编号。
  for (const id of order) {
    const entry = doc.bibliography.find(entry => entry.id === id)!
    visitInlines(entry.content, entry.id, ctx)
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

/** Inspect every typed field, including metadata/TBX/descriptors/notes not printed by legacy outputs. */
function registerExtendedData(doc: IRDoc, ctx: ResolveCtx): void {
  const definitions = new Set<string>()
  const resourceIds = new Set((doc.resources ?? []).map(resource => resource.id))
  const resourceRefs: { targetId: string; ownerId: string | null; path: string }[] = []
  const indexRefs: { targetId: string; ownerId: string | null; path: string }[] = []
  const visit = (value: unknown, path: string, parentId: string | null, forbidden?: ForbiddenFootnoteContainer): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`, parentId, forbidden)); return }
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
  for (const ref of indexRefs) if (!ctx.seenIds.has(ref.targetId)) {
    ctx.problems.push({ code: 'dangling-index-target', nodeId: ref.ownerId, severity: 'error', message: `${ref.path} 的索引目标「${ref.targetId}」不存在` })
  }
  for (const issue of doc.unsupportedContent ?? []) {
    ctx.problems.push({ code: 'unsupported-content', nodeId: issue.nodeId, severity: 'error', message: `${issue.path}（${issue.nodeType}）：${issue.reason}` })
  }
}

function checkTypedReferences(ctx: ResolveCtx): void {
  for (const ref of ctx.typedRefs) {
    const actualKind = ctx.kinds.get(ref.targetId)
    if (ref.refKind === 'crossRef' && actualKind !== ref.expectedKind && !ctx.labels[ref.targetId]) continue
    if (actualKind !== ref.expectedKind) {
      ctx.problems.push({ code: 'dangling-typed-ref', nodeId: ref.fromId, severity: 'error', message: `引用目标「${ref.targetId}」应为 ${ref.expectedKind}，实际为 ${actualKind ?? '不存在'}` })
    } else if (!ctx.labels[ref.targetId]) {
      // Explicit typed targets can reference entities without a numbered label.
      ctx.setLabel(ref.targetId, '', stableExtensionXmlId(ref.targetId), ctx.targetTexts.get(ref.targetId) ?? ref.targetId)
    }
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

  // 前置部分（前言/引言）：注/示例作用域为各自部分；图表公式与正文共用计数器
  for (const block of doc.front.foreword) visitBlock(block, 'front.foreword', ctx)
  for (const block of doc.front.introduction) visitBlock(block, 'front.introduction', ctx)

  doc.body.forEach((chapter, i) => visitChapter(chapter, i + 1, ctx))
  doc.appendices.forEach((appendix, i) => visitAppendix(appendix, i + 1, ctx))

  registerExtendedData(doc, ctx)
  const bibliographyOrder = resolveBibliography(doc, ctx)
  checkTypedReferences(ctx)
  labelNotesAndExamples(ctx)
  checkXrefs(ctx)

  return { doc, labels: ctx.labels, problems: ctx.problems, bibliographyOrder }
}
