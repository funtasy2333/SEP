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
  labels: Record<NodeId, ResolvedLabel> = {}
  problems: IRProblem[] = []
  /** 文档内出现过的全部 nodeId（含派生子 ID），用于重复检测与 xref 解析 */
  seenIds = new Set<NodeId>()
  /** 交叉引用出现顺序：[targetId, 所在块 nodeId] */
  xrefs: { targetId: NodeId; fromId: NodeId }[] = []
  /** 注/示例按作用域分组（作用域 = 最近的条或章/附录/术语条目/前言/引言/表/图） */
  scopes = new Map<string, NoteScope>()
  /** note/example 的 xmlId 全局序号（按文档顺序，确定性） */
  noteSeq = 0
  exampleSeq = 0
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
    if (id.startsWith(MISSING_ID_PREFIX)) {
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

function visitInlines(inlines: IRInline[], fromId: NodeId, ctx: ResolveCtx): void {
  for (const run of inlines) {
    for (const mark of run.marks ?? []) {
      if (mark.type === 'crossRef') {
        ctx.xrefs.push({ targetId: mark.targetId, fromId })
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

function visitNoteContent(note: IRNote, ctx: ResolveCtx): void {
  ctx.registerId(note.id)
  for (const block of note.content) visitBlock(block, note.id, ctx)
}

/**
 * 访问一个块：登记 ID、计数图/表/公式、把注/示例归入作用域。
 * scopeKey = 最近的条或章（或附录/术语条目/前言/引言）的 ID。
 */
function visitBlock(block: IRBlock, scopeKey: string, ctx: ResolveCtx): void {
  switch (block.kind) {
    case 'paragraph':
      ctx.registerId(block.id)
      visitInlines(block.content, block.id, ctx)
      break
    case 'list':
      ctx.registerId(block.id)
      for (const item of block.items) {
        ctx.registerId(item.id)
        for (const child of item.content) visitBlock(child, scopeKey, ctx)
      }
      break
    case 'table': {
      labelFigureOrTable(block.id, 'tab', ctx)
      visitInlines(block.caption, block.id, ctx)
      if (block.captionEn) visitInlines(block.captionEn, block.id, ctx)
      for (const row of block.rows) {
        ctx.registerId(row.id)
        for (const cell of row.cells) {
          ctx.registerId(cell.id)
          for (const child of cell.content) visitBlock(child, block.id, ctx)
        }
      }
      // 表内注独立计数：作用域 = 该表
      for (const note of block.notes) {
        visitNoteContent(note, ctx)
        ctx.scope(block.id).notes.push({ id: note.id })
      }
      break
    }
    case 'figure': {
      labelFigureOrTable(block.id, 'fig', ctx)
      visitInlines(block.caption, block.id, ctx)
      if (block.captionEn) visitInlines(block.captionEn, block.id, ctx)
      for (const note of block.notes) {
        visitNoteContent(note, ctx)
        ctx.scope(block.id).notes.push({ id: note.id })
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
      for (const item of block.whereList) {
        ctx.registerId(item.id)
        visitInlines(item.term, item.id, ctx)
        visitInlines(item.definition, item.id, ctx)
      }
      break
    }
    case 'note':
      visitNoteContent(block, ctx)
      ctx.scope(scopeKey).notes.push({ id: block.id })
      break
    case 'example':
      ctx.registerId(block.id)
      for (const child of block.content) visitBlock(child, block.id, ctx)
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
  ctx.registerId(entry.id)
  ctx.setLabel(entry.id, numberPath, `sec_${numberPath}`, numberPath)
  visitInlines(entry.term, entry.id, ctx)
  if (entry.termEn) visitInlines(entry.termEn, entry.id, ctx)
  for (const block of entry.definition) visitBlock(block, entry.id, ctx)
  if (entry.source) visitInlines(entry.source, entry.id, ctx)
  for (const note of entry.notes) {
    visitNoteContent(note, ctx)
    ctx.scope(entry.id).notes.push({ id: note.id })
  }
  for (const example of entry.examples) {
    ctx.registerId(example.id)
    for (const block of example.content) visitBlock(block, example.id, ctx)
    ctx.scope(entry.id).examples.push({ id: example.id })
  }
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
  visitInlines(clause.title, clause.id, ctx)
  visitSectionChildren(clause.children, clause.id, numberPath, path, expectedChildLevel, ctx)
}

function visitChapter(chapter: IRChapter, seq: number, ctx: ResolveCtx): void {
  ctx.registerId(chapter.id)
  const num = ctx.strategy.chapter(seq)
  ctx.setLabel(chapter.id, num, `sec_${num}`, `第${num}章`)
  visitInlines(chapter.title, chapter.id, ctx)
  visitSectionChildren(chapter.children, chapter.id, `第${num}章`, [seq], 1, ctx)
}

function visitAppendix(appendix: IRAppendix, seq: number, ctx: ResolveCtx): void {
  ctx.registerId(appendix.id)
  const letter = ctx.strategy.appendixLetter(seq)
  const label = ctx.strategy.appendix(seq)
  ctx.setLabel(appendix.id, label, `sec_${letter}`, label)
  visitInlines(appendix.title, appendix.id, ctx)
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
  for (const entry of doc.bibliography) ctx.registerId(entry.id)
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
  for (const entry of doc.bibliography) visitInlines(entry.content, entry.id, ctx)
  return order
}

// ---------- 交叉引用校验 ----------

function checkXrefs(ctx: ResolveCtx): void {
  for (const { targetId, fromId } of ctx.xrefs) {
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

// ---------- 入口 ----------

/**
 * 解析 IR 文档：派生编号 labels、检测结构问题。
 * 不复制树：返回原 doc + labels + problems + bibliographyOrder。
 */
export function resolve(doc: IRDoc, strategy: NumberingStrategy = gbT11Strategy): ResolveResult {
  const ctx = new ResolveCtx(strategy)

  // 前置部分（前言/引言）：注/示例作用域为各自部分；图表公式与正文共用计数器
  for (const block of doc.front.foreword) visitBlock(block, 'front.foreword', ctx)
  for (const block of doc.front.introduction) visitBlock(block, 'front.introduction', ctx)

  doc.body.forEach((chapter, i) => visitChapter(chapter, i + 1, ctx))
  doc.appendices.forEach((appendix, i) => visitAppendix(appendix, i + 1, ctx))

  const bibliographyOrder = resolveBibliography(doc, ctx)
  labelNotesAndExamples(ctx)
  checkXrefs(ctx)

  return { doc, labels: ctx.labels, problems: ctx.problems, bibliographyOrder }
}
