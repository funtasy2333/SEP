/**
 * 分派表与渲染上下文的装配（WP8.2 设计 §2.0.1、§6.3）。
 *
 * 块种类 → 渲染函数的对应**一次写全**：后续 T2.4b（表/图/公式/MathML）与 T2.4c（术语/规范性引用/文献/索引/缩略语）
 * 只替换各自领域文件里的函数体与常量，不再改本文件、`xml46687.ts`、`outputBoundary.ts`。
 *
 * 领域模块互不 import：它们只通过 `RenderContext`（`ctx.renderInlines/renderBlock/renderBlocks/renderSectionContent`）
 * 调用彼此；`ctx` 的这些入口在这里装配到本表。所以导入关系是无环的：dispatch → 各领域 → context。
 */

import { computeOrderedListMarkers } from '../../ir/resolve'
import type { IRBlock, IRClauseChild, IRInline, NodeId, ResolvedLabel } from '../../ir/types'
import { collectXml46687ImageRefs } from '../../xml46687/resources'
import type { XmlElement, XmlNode } from '../../xml46687/tree'
import type { RenderXml46687Options, Xml46687Problem, Xml46687ProblemCode, Xml46687Severity } from '../xml46687'
import { renderCode, renderExample, renderList, renderNote, renderParagraph, renderQuote, renderWarning } from './blocks'
import { sub, type InlineContainer, type RenderContext, type RenderScope, type Site } from './context'
import { renderFigure } from './figures'
import { renderFormula } from './formulas'
import { createIdState, emitRef, registerPending, type IdState } from './ids'
import { renderInlines } from './inline'
import { renderNormRefList } from './refs'
import { renderSectionContent } from './structure'
import { buildTargets } from './targets'
import { renderTable } from './tables'
import { renderDefList } from './terms'

/** 块种类 → 渲染函数。`never` 检查保证 `IRBlock` 新增种类时这里必须补。 */
export function renderBlock(ctx: RenderContext, block: IRBlock, at: Site): XmlElement[] {
  switch (block.kind) {
    case 'paragraph': return renderParagraph(block, at, ctx)
    case 'list': return renderList(block, at, ctx)
    case 'table': return renderTable(block, at, ctx)
    case 'figure': return renderFigure(block, at, ctx)
    case 'formula': return renderFormula(block, at, ctx)
    case 'formulaGroup': case 'figureSet': case 'array': throw new Error(`xml46687: ${block.kind} 尚未支持（${at.path}）`)
    case 'note': return renderNote(block, at, ctx)
    case 'example': return renderExample(block, at, ctx)
    case 'warning': return renderWarning(block, at, ctx)
    case 'quote': return renderQuote(block, at, ctx)
    case 'code': return renderCode(block, at, ctx)
    case 'defList': return renderDefList(block, at, ctx)
    case 'normRefList': return renderNormRefList(block, at, ctx)
    default: {
      const unknown: never = block
      throw new Error(`xml46687: 未知的块种类 ${String((unknown as { kind?: unknown }).kind)}（${at.path}）`)
    }
  }
}

export function renderBlocks(ctx: RenderContext, blocks: readonly IRBlock[], at: Site): XmlElement[] {
  return blocks.flatMap((block, index) => renderBlock(ctx, block, sub(at, `[${index}]`, block.id)))
}

interface MergedProblem {
  code: Xml46687ProblemCode
  severity: Xml46687Severity
  title: string
  items: { detail: string; at: Site }[]
}

export interface RenderSession {
  ctx: RenderContext
  ids: IdState
  /** 把 `reportMerged` 累积的聚合问题写入 `ctx.problems`（P2 结束时调用一次）。 */
  flushMerged(): void
}

function problemOf(code: Xml46687ProblemCode, severity: Xml46687Severity, message: string, at: Site): Xml46687Problem {
  return { code, severity, ...(at.nodeId === undefined ? {} : { nodeId: at.nodeId }), path: at.path, message }
}

/** 装配一次渲染的上下文（含 P1 预扫描）。纯函数：不修改 `doc/labels/options`。 */
export function createRenderSession(
  doc: RenderContext['doc'],
  labels: Readonly<Record<NodeId, ResolvedLabel>>,
  options: RenderXml46687Options,
): RenderSession {
  const problems: Xml46687Problem[] = []
  const merged = new Map<string, MergedProblem>()
  const counters = new Map<string, number>()
  const ids = createIdState()
  const scope: RenderScope = { introduction: false }
  const labelOf = (id: NodeId): ResolvedLabel | undefined => (Object.prototype.hasOwnProperty.call(labels, id) ? labels[id] : undefined)

  const ctx: RenderContext = {
    doc,
    labels,
    options,
    targets: buildTargets(doc),
    orderedMarkers: computeOrderedListMarkers(doc),
    imageRefs: collectXml46687ImageRefs(doc, labels as Record<NodeId, ResolvedLabel>),
    problems,
    scope,

    report(code, severity, message, at) {
      problems.push(problemOf(code, severity, message, at))
    },
    reportMerged(code, severity, title, detail, at) {
      const key = `${code}|${severity}`
      const entry = merged.get(key)
      if (entry) entry.items.push({ detail, at })
      else merged.set(key, { code, severity, title, items: [{ detail, at }] })
    },
    labelOf,
    xmlIdOf(id, at, what) {
      const xmlId = labelOf(id)?.xmlId
      if (typeof xmlId === 'string' && xmlId !== '') return xmlId
      problems.push(problemOf('xml-label-missing', 'error', `${what}在 Resolver 的 labels 中没有 xmlId（节点 ${id}）。`, at))
      return undefined
    },
    registerPendingId(nodeId, element, at) {
      registerPending(ids, nodeId, element, at?.path)
    },
    emitRef(nodeId) {
      emitRef(ids, nodeId)
    },
    nextCount(name) {
      const next = (counters.get(name) ?? 0) + 1
      counters.set(name, next)
      return next
    },

    renderInlines(runs: readonly IRInline[], at: Site, container: InlineContainer): XmlNode[] {
      return renderInlines(ctx, runs, at, container)
    },
    renderBlock(block, at) { return renderBlock(ctx, block, at) },
    renderBlocks(blocks, at) { return renderBlocks(ctx, blocks, at) },
    renderSectionContent(children: readonly IRClauseChild[], at: Site) { return renderSectionContent(ctx, children, at) },
  }

  return {
    ctx,
    ids,
    flushMerged() {
      for (const entry of merged.values()) {
        const [first] = entry.items
        if (!first) continue
        const count = entry.items.length
        const shown = entry.items.slice(0, 3).map((item) => item.detail)
        const message = count === 1
          ? `${entry.title}：${first.detail}`
          : `${entry.title}（共 ${count} 处）：${shown.join('；')}${count > shown.length ? '；……' : ''}`
        problems.push(problemOf(entry.code, entry.severity, message, first.at))
      }
      merged.clear()
    },
  }
}
