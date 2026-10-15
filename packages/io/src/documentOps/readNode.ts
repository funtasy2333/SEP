/**
 * 读取节点（WP9.2c1）：返回节点的 IR、编号、父节点、位置，以及替换它应使用的上下文。
 *
 * 返回的 IR 是写作片段可接受的形态：`replaceable` 为 true 时，把它放进 `content: [ir]` 原样替换，
 * 文档保持不变。节点含有写作片段表达不了的内容（表格样式与列宽、图的资源引用、TBX 语言集、行内样式与脚注……）
 * 时，`replaceable` 为 false，`notReplaceable` 逐条说明哪些内容会在整体替换时丢失。`replace` 操作遇到这样的节点
 * 默认拒绝（`replace-loses-content`）；调用方可改为替换其中不含这些内容的子节点，或在知情的前提下
 * 给该 replace 操作加 `acceptLoss: true`。
 */

import { pmToIr, resolve, type IRFragmentNode, type PMJsonNode } from '@ses/shared'
import {
  analyzeReplaceability, buildInspectEnv,
} from './inspect'
import { CONTAINER_LABELS, findEnclosingAddressable, indexDocument, KIND_LABELS } from './locator'
import { DOCUMENT_CONTAINERS, type ReadContainerResult, type ReadNodeResult } from './types'

/** 读取一个可寻址节点（章、条、附录、术语条目、参考文献条目，以及前言/引言/章/条/附录下的块）。 */
export function readNode(pmDoc: PMJsonNode, nodeId: string): ReadNodeResult {
  const index = indexDocument(pmDoc)
  if (index.duplicates.has(nodeId)) {
    return {
      ok: false, code: 'node-ambiguous',
      reason: `文档里有多个节点使用 id「${nodeId}」，无法确定指哪一个；请先修复重复的 id`,
    }
  }
  const located = index.byId.get(nodeId)
  if (!located) {
    const enclosing = findEnclosingAddressable(index, nodeId)
    if (enclosing) {
      const where = enclosing.ancestor
        ? `位于${KIND_LABELS[enclosing.ancestor.kind]}「${enclosing.ancestor.id}」内部，请读取或替换该${KIND_LABELS[enclosing.ancestor.kind]}`
        : '不属于可单独寻址的节点'
      return {
        ok: false, code: 'node-not-addressable',
        reason: `「${nodeId}」（${enclosing.pmType}）${where}`,
      }
    }
    return { ok: false, code: 'node-not-found', reason: `文档里没有 id 为「${nodeId}」的节点` }
  }

  const env = buildInspectEnv(pmDoc, index)
  const ir = env.irNodes.get(nodeId)
  if (!ir || ir.kind !== located.kind) {
    return {
      ok: false, code: 'node-not-addressable',
      reason: `「${nodeId}」无法读成 IR（文档结构异常），请先修复文档`,
    }
  }
  const { labels } = resolve(env.ir)
  const label = labels[nodeId]?.label
  const reasons = analyzeReplaceability(env, located)
  return {
    ok: true,
    node: {
      nodeId,
      kind: located.kind,
      ...(label ? { number: label } : {}),
      parent: located.parent,
      index: located.index,
      siblingCount: located.siblingCount,
      ...(located.context ? { context: located.context } : {}),
      ir,
      replaceable: reasons.length === 0,
      ...(reasons.length > 0 ? { notReplaceable: reasons } : {}),
    },
  }
}

/**
 * 读取前言、引言或参考文献容器里的全部节点（取得其中节点的 id，如参考文献条目要被 `bibRef` 引用时）。
 * 正文章与附录请先用结构树取得章/附录的 id，再逐个 {@link readNode}，避免整篇文档进入上下文。
 */
export function readContainer(pmDoc: PMJsonNode, container: string): ReadContainerResult {
  if (container !== 'foreword' && container !== 'introduction' && container !== 'bibliography') {
    const known = (DOCUMENT_CONTAINERS as readonly string[]).includes(container) ? `；${container === 'body' ? '正文章' : '附录'}请用结构树取得 id 后逐个读取` : ''
    return {
      ok: false, code: 'invalid-container',
      reason: `只能读取 foreword、introduction、bibliography 容器（收到「${container}」）${known}`,
    }
  }
  const index = indexDocument(pmDoc)
  const roots = index.rootIndices[container]
  if (roots.length > 1) {
    return {
      ok: false, code: 'container-ambiguous',
      reason: `文档里有 ${roots.length} 个${CONTAINER_LABELS[container]}容器，无法确定指哪一个`,
    }
  }
  const { doc: ir } = pmToIr(pmDoc)
  const nodes: IRFragmentNode[] = container === 'foreword' ? ir.front.foreword
    : container === 'introduction' ? ir.front.introduction : ir.bibliography
  return {
    ok: true,
    container: { container, exists: roots.length === 1, context: { parent: container }, nodes },
  }
}
