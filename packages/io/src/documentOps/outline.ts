/**
 * 文档结构树（WP9.2c1）：章、条、附录、术语条目，以及表、图、公式，带编号与标题。
 *
 * 由 `pmToIr` + `resolve` 计算，编号一律来自 Resolver 的 label，本文件不做任何编号。
 * 段落等块不逐个列出，只给数量，避免结构树过大；前言、参考文献只体现是否存在与数量，
 * 引言除此之外还列出其中的条（编号 0.1、0.2…，递归带子条）。
 */

import {
  pmToIr,
  resolve,
  type IRAppendix,
  type IRBlock,
  type IRChapter,
  type IRClause,
  type IRClauseChild,
  type IRInline,
  type PMJsonNode,
  type ResolvedLabel,
} from '@ses/shared'
import type { DocumentOutline, FrontMatterOutline, OutlineItem } from './types'

/** 公式摘要的最大长度。 */
const FORMULA_SUMMARY_LENGTH = 60

function plainText(inlines: readonly IRInline[]): string {
  return inlines.map(run => run.text).join('').replace(/\s+/g, ' ').trim()
}

function summarize(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** 一个节点序列里「值得单独列出」的项，其余块只计数。 */
function listItems(
  nodes: readonly (IRClauseChild | IRBlock)[],
  labels: Record<string, ResolvedLabel>,
): { items: OutlineItem[]; blockCount: number } {
  const items: OutlineItem[] = []
  let blockCount = 0
  const numberOf = (id: string): { number?: string } => {
    const label = labels[id]?.label
    return label ? { number: label } : {}
  }
  for (const node of nodes) {
    switch (node.kind) {
      case 'clause': {
        const inner = listItems(node.children, labels)
        items.push({
          nodeId: node.id, kind: 'clause', ...numberOf(node.id), title: plainText(node.title),
          level: node.level, blockCount: inner.blockCount, children: inner.items,
        })
        break
      }
      case 'termEntry':
        items.push({ nodeId: node.id, kind: 'termEntry', ...numberOf(node.id), title: plainText(node.term) })
        break
      case 'table':
        items.push({ nodeId: node.id, kind: 'table', ...numberOf(node.id), title: plainText(node.caption) })
        break
      case 'figure':
        items.push({ nodeId: node.id, kind: 'figure', ...numberOf(node.id), title: plainText(node.caption) })
        break
      case 'formula':
        items.push({
          nodeId: node.id, kind: 'formula', ...numberOf(node.id), title: summarize(node.latex, FORMULA_SUMMARY_LENGTH),
        })
        break
      default:
        blockCount += 1
    }
  }
  return { items, blockCount }
}

/**
 * 计算文档结构树。不修改入参；对 IR 无法表达的内容（`unsupportedContent`）不报错，结构树只呈现能读到的部分。
 * 没有 `nodeId` 的节点以 pmToIr 的占位 id（`__missing-N`）列出，这样的 id 不能用于寻址，应先规范化文档。
 */
export function buildOutline(pmDoc: PMJsonNode): DocumentOutline {
  const { doc: ir } = pmToIr(pmDoc)
  const { labels } = resolve(ir)
  const present = (type: string): boolean => (pmDoc.content ?? []).some(child => child.type === type)
  const front = (blocks: readonly (IRBlock | IRClause)[], type: string): FrontMatterOutline => {
    const { items, blockCount } = listItems(blocks, labels)
    return { present: present(type), blockCount, items }
  }
  const sections = (nodes: ReadonlyArray<IRChapter | IRAppendix>): OutlineItem[] => nodes.map(node => {
    const inner = listItems(node.children, labels)
    const label = labels[node.id]?.label
    return node.kind === 'chapter'
      ? {
          nodeId: node.id, kind: 'chapter' as const, ...(label ? { number: label } : {}), title: plainText(node.title),
          secType: node.secType, blockCount: inner.blockCount, children: inner.items,
        }
      : {
          nodeId: node.id, kind: 'appendix' as const, ...(label ? { number: label } : {}), title: plainText(node.title),
          normative: node.normative, blockCount: inner.blockCount, children: inner.items,
        }
  })
  return {
    foreword: front(ir.front.foreword, 'foreword'),
    // 引言中的条（WP8.M G6，GB/T 1.1—2020 8.4）排在引言块之后，编号 0.1、0.2…来自 Resolver，结构与正文章下的条一致。
    introduction: front([...ir.front.introduction, ...(ir.front.introductionClauses ?? [])], 'introduction'),
    body: sections(ir.body),
    appendices: sections(ir.appendices),
    bibliography: { present: present('bibliography'), entryCount: ir.bibliography.length },
  }
}
