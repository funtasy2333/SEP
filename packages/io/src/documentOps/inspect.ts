/**
 * 读取节点的 IR 与「能否整体替换」的判定（WP9.2c1，readNode 与 replace 操作共用）。
 *
 * 写作片段只覆盖 IR 的一部分：表格样式与列宽、图的资源引用、TBX 语言集、行内样式与脚注等
 * 不能用片段表达。用这些节点的 IR 去替换它们，写入的内容就会缺少这些信息。判定方法不靠枚举字段，
 * 而是真的把该节点的 IR 当作片段走一遍归一化与投影：
 * 1. 归一化是否接受（不支持的字段、层级与位置不符、必填内容为空……都会被拒绝）；
 * 2. 归一化结果与原 IR 是否一致（忽略空数组、相邻同标记文字合并等不改变内容的差异）；
 * 3. 能否投影为生产节点；
 * 4. 该节点内部是否有 pmToIr 读不成 IR 的内容（`unsupportedContent`），它们在 IR 里不可见，替换必然丢失。
 */

import {
  irFragmentToPm,
  IRToPmError,
  normalizeAuthoringFragment,
  pmToIr,
  type IRDoc,
  type IRFragmentNode,
  type PMJsonNode,
} from '@ses/shared'
import { collectIrIds, collectPmNodeIds, KIND_LABELS, type DocIndex, type LocatedNode } from './locator'
import { DOCUMENT_CONTAINERS, type NotReplaceableReason } from './types'

/** 保留字：容器名不能被节点 id 占用。 */
export const RESERVED_IDS: readonly string[] = DOCUMENT_CONTAINERS

// ---------- IR 索引 ----------

/** 可寻址节点的 IR，按 id 索引（章、条、附录、术语条目、参考文献条目与各级块）。 */
export function indexIrNodes(ir: IRDoc): Map<string, IRFragmentNode> {
  const map = new Map<string, IRFragmentNode>()
  const addAll = (nodes: readonly IRFragmentNode[]): void => {
    for (const node of nodes) {
      if (!map.has(node.id)) map.set(node.id, node)
      if (node.kind === 'chapter' || node.kind === 'appendix' || node.kind === 'clause') addAll(node.children)
    }
  }
  addAll(ir.front.foreword)
  addAll(ir.front.introduction)
  addAll(ir.body)
  addAll(ir.appendices)
  addAll(ir.bibliography)
  return map
}

/**
 * 文档里已被占用的 id：PM 节点的 `nodeId`、IR 里的全部 `id`（含派生 id 如 `x.p0`），以及容器保留字。
 * 新写入片段的 id 必须避开它们。
 */
export function usedIdsOf(root: PMJsonNode, ir: IRDoc): Set<string> {
  const ids = new Set<string>(RESERVED_IDS)
  collectPmNodeIds(root, ids)
  collectIrIds(ir, ids)
  return ids
}

export interface InspectEnv {
  root: PMJsonNode
  index: DocIndex
  ir: IRDoc
  irNodes: Map<string, IRFragmentNode>
  usedIds: Set<string>
}

export function buildInspectEnv(root: PMJsonNode, index: DocIndex): InspectEnv {
  const { doc: ir } = pmToIr(root)
  return { root, index, ir, irNodes: indexIrNodes(ir), usedIds: usedIdsOf(root, ir) }
}

// ---------- 规范形态比较 ----------

type Obj = Record<string, unknown>
const isObj = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)

function isRunArray(items: unknown[]): items is Obj[] {
  return items.length > 0 && items.every(item => isObj(item) && typeof item.text === 'string' && item.kind === undefined)
}

/** 与归一化同一规则：相邻、标记完全相同的文字片段合并（它们在生产文档里本来就是同一段文字）。 */
function mergeRuns(runs: Obj[]): Obj[] {
  const out: Obj[] = []
  for (const run of runs) {
    const previous = out[out.length - 1]
    const plain = (item: Obj): boolean => item.text !== '\n' && item.style === undefined
      && item.formula === undefined && item.footnote === undefined
    if (previous && plain(previous) && plain(run)
      && JSON.stringify(previous.marks ?? []) === JSON.stringify(run.marks ?? [])) {
      out[out.length - 1] = { ...previous, text: String(previous.text) + String(run.text) }
    } else {
      out.push(run)
    }
  }
  return out
}

/** 规范形态：键排序，去掉 undefined 与空数组，合并相邻同标记文字。仅用于比较。 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonical)
    return isRunArray(items) ? mergeRuns(items) : items
  }
  if (isObj(value)) {
    const out: Obj = {}
    for (const key of Object.keys(value).sort()) {
      const child = canonical(value[key])
      if (child === undefined || (Array.isArray(child) && child.length === 0)) continue
      out[key] = child
    }
    return out
  }
  return value
}

/** 找出两个规范形态的第一处差异（路径与双方的值）；相同返回 undefined。 */
function firstDifference(a: unknown, b: unknown, path: string): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`)
      if (found) return found
    }
  } else if (isObj(a) && isObj(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference(a[key], b[key], `${path}.${key}`)
      if (found) return found
    }
  }
  return path
}

/** 文档里被占用的 id，去掉 `located` 子树自己的（替换时，被替换的子树会先移除，其 id 可以复用）。 */
export function idsOutsideSubtree(env: InspectEnv, located: LocatedNode): Set<string> {
  const existing = new Set(env.usedIds)
  for (const id of collectPmNodeIds(located.node)) existing.delete(id)
  const irNode = env.irNodes.get(located.id)
  if (irNode) for (const id of collectIrIds(irNode)) existing.delete(id)
  for (const reserved of RESERVED_IDS) existing.add(reserved)
  return existing
}

// ---------- 能否整体替换 ----------

const MAX_REASONS = 10

const FIELD_LABELS: Record<string, string> = {
  style: '样式', width: '宽度', unit: '单位', footnotes: '表脚注', columnWidths: '列宽', columns: '列宽模型', cellType: '单元格类型',
  resourceId: '图资源引用', imageWidth: '图片宽度', imageHeight: '图片高度', title: '图的标题属性',
  descriptions: '图说明', groups: '图分组', mathml: 'MathML', sourceInlines: '含标记的公式源',
  languageSets: 'TBX 语言集', nestedEntries: '嵌套术语条目', tailOrder: '术语尾项顺序', subjectField: '术语领域',
  entryType: '文献类型', fields: '文献结构化字段', identifiers: '文献标识符', externalLink: '文献外链',
  footnote: '脚注', formula: '行内公式',
}

const OWNER_FIELD = /^「(.+?)」(?:暂不支持字段|没有字段)「(.+?)」/

/** 把相对片段根的路径 `ir[0].rows[1]` 改写为相对节点的 `ir.rows[1]`。 */
const relativePath = (path: string): string => path.replace(/^ir\[0\]/, 'ir')

interface Grouped {
  reason: NotReplaceableReason
}

function addReason(groups: Map<string, Grouped>, key: string, make: () => NotReplaceableReason): void {
  const existing = groups.get(key)
  if (existing) existing.reason.count = (existing.reason.count ?? 1) + 1
  else groups.set(key, { reason: make() })
}

/**
 * 判定 `located` 能否用它自己的 IR 无损地整体替换，返回不能的原因（空数组 = 可以）。
 * 同类原因合并计数；最多返回 {@link MAX_REASONS} 条，超出的并入最后一条说明。
 */
export function analyzeReplaceability(env: InspectEnv, located: LocatedNode): NotReplaceableReason[] {
  const irNode = env.irNodes.get(located.id)
  if (!irNode) {
    return [{ code: 'authoring-invalid', message: '无法读取该节点的 IR' }]
  }
  const groups = new Map<string, Grouped>()

  if (irNode.kind === 'warning' || irNode.kind === 'quote' || irNode.kind === 'code' || irNode.kind === 'defList') {
    addReason(groups, 'kind', () => ({
      code: 'unsupported-kind',
      message: `「${KIND_LABELS[irNode.kind]}」写作片段暂不支持，不能整体替换（可以删除或移动）`,
    }))
  } else if (located.context === undefined) {
    addReason(groups, 'context', () => ({
      code: 'no-context',
      message: '该节点所在层级超过 5 级，没有可用的替换上下文',
    }))
  } else {
    const existing = idsOutsideSubtree(env, located)
    // IR 的每个节点都带 id，正常不会用到生成器；给一个递增的，万一用到也不会因重复而失败。
    let generated = 0
    const normalized = normalizeAuthoringFragment([irNode], located.context, {
      existingIds: existing,
      rootPath: 'ir',
      generateId: () => `__inspect__${++generated}`,
    })
    if (!normalized.ok) {
      for (const issue of normalized.issues) {
        const owned = OWNER_FIELD.exec(issue.reason)
        if (owned && (issue.code === 'unsupported-field' || issue.code === 'unknown-field')) {
          const [, owner, field] = owned as unknown as [string, string, string]
          const label = FIELD_LABELS[field]
          addReason(groups, `field:${owner}:${field}`, () => ({
            code: 'unsupported-field',
            message: `${owner}含有写作片段不支持的内容：「${field}」${label ? `（${label}）` : ''}，整体替换会丢失它`,
            path: relativePath(issue.path),
            count: 1,
          }))
        } else if (issue.code === 'unsupported-field' || issue.code === 'unknown-field') {
          addReason(groups, `field:${issue.reason}`, () => ({
            code: 'unsupported-field', message: `${issue.reason}，整体替换会丢失它`, path: relativePath(issue.path), count: 1,
          }))
        } else if (issue.code === 'not-allowed-here' && /^(注|示例)只能包含一段内容/.test(issue.reason)) {
          // WP8.M G7-b：块内容的注/示例（noteBlock/exampleBlock，M-5.6-05）有多个段落/列项，写作片段只能写单段：
          // 整体替换会丢掉多出的块，与其他「写作片段表达不了的内容」同样默认拒绝（replace-loses-content）。
          const what = issue.reason.slice(0, issue.reason.indexOf('只能'))
          addReason(groups, `blocks:${issue.path}`, () => ({
            code: 'unsupported-content',
            message: `${what}含有多个块（段落/列项），写作片段只能表达单段内容，整体替换会丢失其余块`,
            path: relativePath(issue.path), count: 1,
          }))
        } else if (issue.code === 'unsupported-kind') {
          addReason(groups, `kind:${issue.reason}`, () => ({
            code: 'unsupported-kind', message: issue.reason, path: relativePath(issue.path), count: 1,
          }))
        } else {
          addReason(groups, `invalid:${issue.code}:${issue.reason}`, () => ({
            code: 'authoring-invalid', message: issue.reason, path: relativePath(issue.path), count: 1,
          }))
        }
      }
    } else {
      const same = canonical(irNode)
      const difference = firstDifference(same, canonical(normalized.nodes[0]), 'ir')
      if (difference) {
        addReason(groups, 'lossless', () => ({
          code: 'not-lossless',
          message: '写作片段归一化会改变该节点的内容，回传 IR 替换后文档不再保持不变',
          path: difference,
        }))
      }
      try {
        irFragmentToPm(normalized.nodes, located.context, { rootPath: 'ir' })
      } catch (error) {
        if (!(error instanceof IRToPmError)) throw error
        for (const diagnostic of error.diagnostics) {
          addReason(groups, `project:${diagnostic.reason}`, () => ({
            code: 'projection-failed', message: diagnostic.reason, path: relativePath(diagnostic.path), count: 1,
          }))
        }
      }
    }
  }

  // IR 里读不到的内容（pmToIr 记录为 unsupportedContent）：替换必然丢失。
  const prefix = `${env.root.type}${located.path.map(position => `.content[${position}]`).join('')}`
  const subtree = new Set([...collectPmNodeIds(located.node), ...collectIrIds(irNode)])
  for (const item of env.ir.unsupportedContent ?? []) {
    const inside = (item.nodeId !== null && subtree.has(item.nodeId))
      || item.path === prefix || item.path.startsWith(`${prefix}.`)
    if (!inside) continue
    addReason(groups, `unsupported:${item.nodeType}:${item.reason}`, () => ({
      code: 'unsupported-content',
      message: `该节点内含有无法表达的内容（${item.nodeType}）：${item.reason}，整体替换会丢失它`,
      count: 1,
    }))
  }

  const reasons = [...groups.values()].map(({ reason }) => {
    if (reason.count === 1) delete reason.count
    return reason.count === undefined ? reason : { ...reason, message: `${reason.message}（共 ${reason.count} 处）` }
  })
  if (reasons.length > MAX_REASONS) {
    const rest = reasons.length - (MAX_REASONS - 1)
    return [...reasons.slice(0, MAX_REASONS - 1), {
      code: 'authoring-invalid', message: `另有 ${rest} 类问题未列出`,
    }]
  }
  return reasons
}
