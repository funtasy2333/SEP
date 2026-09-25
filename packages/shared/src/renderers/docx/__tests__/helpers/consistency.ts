/**
 * §4.7「比对」（docs/wp7-docx-delivery.md §4.7），供 numbering/full 两个一致性 fixture 复用。
 *
 * - `assertNumberingConsistency`：模拟器中 label 不为空的段落数等于 `numbered.length`，二者
 *   按顺序一一对应；对应段落的模拟器 label 去掉末尾一个 U+3000 后，kind 为 listItem 的等于
 *   手写期望，其余等于 `labels[nodeId].label`。
 * - `assertCoverage`：IR 中每个章/条/术语条目/附录/图/表/注/示例/参考文献条目在 numbered 中
 *   恰好出现一次（WP7.2 不含表格内部的节点）。`collectNumberedNodeIds` 按渲染器同样的规则
 *   （跳过表格内部）从 IRDoc 收集这些 id。
 * - `assertExpectMarkers`：扫描模拟器每段文本里的「〔期望X〕」「〔前段期望X〕」「〔附录期望X〕」
 *   标记，核对 X 与模拟器算出的对应段落 label（去掉末尾一个 U+3000）一致。
 *
 * 这是测试代码（属于 shared 测试基建），不从任何 index.ts 导出，同样不得使用 Node 或浏览器
 * 专有 API。
 */

import type {
  IRBlock,
  IRChapterChild,
  IRClauseChild,
  IRDoc,
  IRTermEntry,
  NodeId,
  ResolvedLabel,
} from '../../../../ir/types'
import type { NumberedParagraphTrace } from '../../render'
import type { DocxPackage } from '../../types'
import { simulateNumbering, type SimParagraph } from './numberingSim'

export function assertNumberingConsistency(
  pkg: DocxPackage,
  numbered: readonly NumberedParagraphTrace[],
  labels: Record<NodeId, ResolvedLabel>,
  listItemExpected: ReadonlyMap<NodeId, string>,
): void {
  const simulated = simulateNumbering(pkg)
  const simLabeled = simulated.filter((p) => p.label !== undefined)
  if (simLabeled.length !== numbered.length) {
    throw new Error(
      `assertNumberingConsistency: 模拟器中有编号的段落数（${simLabeled.length}）与 numbered.length（${numbered.length}）不一致`,
    )
  }
  simLabeled.forEach((sim, i) => {
    const trace = numbered[i]
    const simLabel = sim.label!.replace(/　$/, '')
    const expected = trace.kind === 'listItem' ? listItemExpected.get(trace.nodeId) : labels[trace.nodeId]?.label
    if (expected === undefined) {
      throw new Error(`assertNumberingConsistency: 第 ${i} 项（nodeId="${trace.nodeId}", kind="${trace.kind}"）没有可比对的期望值`)
    }
    if (simLabel !== expected) {
      throw new Error(
        `assertNumberingConsistency: 第 ${i} 项（index=${sim.index}, nodeId="${trace.nodeId}", kind="${trace.kind}"）` +
          `模拟器标识「${simLabel}」与期望「${expected}」不一致（styleId=${sim.styleId}，text="${sim.text}"）`,
      )
    }
  })
}

export function assertCoverage(numbered: readonly NumberedParagraphTrace[], expectedIds: readonly NodeId[]): void {
  const counts = new Map<NodeId, number>()
  for (const t of numbered) counts.set(t.nodeId, (counts.get(t.nodeId) ?? 0) + 1)
  for (const id of expectedIds) {
    const count = counts.get(id) ?? 0
    if (count !== 1) {
      throw new Error(`assertCoverage: 节点 "${id}" 在 numbered 中出现 ${count} 次（期望恰好 1 次）`)
    }
  }
}

// ---------------- IR 覆盖 id 收集（跳过表格内部，WP7.2 范围） ----------------

function walkBlock(block: IRBlock, ids: NodeId[]): void {
  switch (block.kind) {
    case 'figure':
      ids.push(block.id)
      for (const n of block.notes) walkBlock(n, ids)
      break
    case 'table':
      ids.push(block.id) // WP7.2：单元格内容、表注不计入覆盖（表格内部不渲染）
      break
    case 'note':
      ids.push(block.id)
      for (const b of block.content) walkBlock(b, ids)
      break
    case 'example':
      ids.push(block.id)
      for (const b of block.content) walkBlock(b, ids)
      break
    case 'list':
      for (const item of block.items) {
        for (const c of item.content) {
          if (c.kind === 'list') walkBlock(c, ids)
        }
      }
      break
    case 'paragraph':
    case 'formula':
      break
  }
}

function walkTermEntry(entry: IRTermEntry, ids: NodeId[]): void {
  ids.push(entry.id)
  for (const b of entry.definition) walkBlock(b, ids)
  for (const ex of entry.examples) walkBlock(ex, ids)
  for (const n of entry.notes) walkBlock(n, ids)
}

function walkContainerChildren(children: readonly (IRClauseChild | IRChapterChild)[], ids: NodeId[]): void {
  for (const child of children) {
    if (child.kind === 'clause') {
      ids.push(child.id)
      walkContainerChildren(child.children, ids)
    } else if (child.kind === 'termEntry') {
      walkTermEntry(child, ids)
    } else {
      walkBlock(child, ids)
    }
  }
}

/** 按渲染器同样的规则从 IRDoc 收集所有「应恰好编号一次」的节点 id（WP7.2 不含表格内部） */
export function collectNumberedNodeIds(doc: IRDoc): NodeId[] {
  const ids: NodeId[] = []
  for (const b of doc.front.foreword) walkBlock(b, ids)
  for (const b of doc.front.introduction) walkBlock(b, ids)
  for (const chapter of doc.body) {
    ids.push(chapter.id)
    walkContainerChildren(chapter.children, ids)
  }
  for (const appendix of doc.appendices) {
    ids.push(appendix.id)
    walkContainerChildren(appendix.children, ids)
  }
  for (const entry of doc.bibliography) ids.push(entry.id)
  return ids
}

// ---------------- 期望标记（§9 WP7.2「numbering」fixture、§10.3 expect.py 的 TS 对应实现） ----------------

const SELF_MARKER_RE = /〔(?:期望|附录期望)([^〕]+)〕/
const PREV_MARKER_RE = /〔前段期望([^〕]+)〕/

/**
 * 扫描模拟器每段文本里的期望标记：「期望」「附录期望」核对本段的 label；「前段期望」核对
 * 上一段的 label（label 都先去掉末尾一个 U+3000 再比较）。规格里的写法是「〔期望 X〕」（带
 * 空格，§9 WP7.2），X 两侧的空白先 trim 掉再比较，即使 fixture 本身不带空格也兼容（#34 审查）。
 * 至少要找到一个标记（否则说明 fixture 没有按规格要求写标记，测试本身就没有意义）。
 */
export function assertExpectMarkers(simulated: readonly SimParagraph[]): void {
  let found = 0
  simulated.forEach((p, i) => {
    const self = SELF_MARKER_RE.exec(p.text)
    if (self) {
      found += 1
      const expected = self[1].trim()
      const actual = p.label?.replace(/　$/, '')
      if (actual !== expected) {
        throw new Error(`assertExpectMarkers: 第 ${i} 段「期望」标记为「${expected}」，模拟器标识为「${actual}」（text="${p.text}"）`)
      }
    }
    const prev = PREV_MARKER_RE.exec(p.text)
    if (prev) {
      found += 1
      const expected = prev[1].trim()
      const prevPara = simulated[i - 1]
      const actual = prevPara?.label?.replace(/　$/, '')
      if (actual !== expected) {
        throw new Error(
          `assertExpectMarkers: 第 ${i} 段「前段期望」标记为「${expected}」，上一段（第 ${i - 1} 段）模拟器标识为「${actual}」`,
        )
      }
    }
  })
  if (found === 0) {
    throw new Error('assertExpectMarkers: 没有在任何段落里找到期望标记（〔期望…〕/〔前段期望…〕/〔附录期望…〕）')
  }
}
