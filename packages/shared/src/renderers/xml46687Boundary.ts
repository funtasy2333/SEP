/**
 * XML46687 输出边界放行项的汇总（WP8.2 设计 §1.3.2～§1.3.4、§6.3）。
 *
 * 每个领域把自己要放行的字段/shape/mark 作为常量放在**自己的** `xml46687Parts/<域>.ts` 里（`XML46687_<域>_BOUNDARY`），
 * 本文件只做汇总，`outputBoundary.ts` 只接线一次。T2.4b/T2.4c 只改各自领域文件里的常量，不改本文件、不改 `outputBoundary.ts`。
 *
 * 常量写法（`Xml46687BoundaryContribution`）：
 * - `fields`：kind 或 shape 名 → 额外放行的字段（与 `BASE_FIELDS` 取并集）。`BASE_FIELDS` 里没有的 kind（如 `warning`）视为整个 kind 放行；
 * - `shapes`：childShape 登记——`{ parent: 父对象的 kind 或 shape, key: 字段名, shape }`，让该字段下的对象按 `fields[shape]` 校验
 *   （没有 `kind` 的对象类型必须登记，否则默认按 `inline` 校验、整棵子树被误报）；
 * - `plainKindShapes`：对象带有名为 `kind` 的**数据字段**（如 `IRIdentifierPart.kind`、`IRTermDescriptor.kind`）的 shape，
 *   边界不得把它当成节点 kind（mark 恒如此，不必登记）；
 * - `marks`：额外放行的 mark 类型；
 * - `declared`：每项放行的“已声明差异”（见下），测试据此断言“XML46687 比 XML 多放行的恰为声明集合”。
 */

import type { IRDoc } from '../ir/types'
import { XML46687_BLOCKS_BOUNDARY } from './xml46687Parts/blocks'
import { XML46687_FIGURES_BOUNDARY } from './xml46687Parts/figures'
import { XML46687_FORMULAS_BOUNDARY } from './xml46687Parts/formulas'
import { XML46687_INLINE_BOUNDARY } from './xml46687Parts/inline'
import { XML46687_META_BOUNDARY } from './xml46687Parts/meta'
import { XML46687_REFS_BOUNDARY } from './xml46687Parts/refs'
import { XML46687_STRUCTURE_BOUNDARY } from './xml46687Parts/structure'
import { XML46687_TABLES_BOUNDARY } from './xml46687Parts/tables'
import { XML46687_TERMS_BOUNDARY } from './xml46687Parts/terms'

export type Xml46687DeclaredTask = 'T2.4a' | 'T2.4b' | 'T2.4c'

/**
 * XML46687 比旧 `XML` 多放行的一项。路径后缀与问题路径对照时**先去掉全部 `[n]` 下标**，再按 `endsWith` 匹配：
 * - `kind: 'field'`：`pathSuffix` 形如 `meta.proposer`、`marks.href`（父对象名 + 字段名），`name` 是字段名；
 * - `kind: 'kind'`：整个块 kind 放行，`pathSuffix` 为 `.kind`，`name` 是 kind（如 `warning`）；
 * - `kind: 'markType'`：mark 类型放行，`pathSuffix` 为 `marks.type`，`name` 是 mark 类型（如 `stdRef`）。
 */
export interface Xml46687DeclaredDifference {
  pathSuffix: string
  kind: 'field' | 'kind' | 'markType'
  name: string
  matrixIds: readonly string[]
  task: Xml46687DeclaredTask
  reason: string
}

export interface Xml46687ShapeRule {
  /** 父对象的 kind（无 kind 时为它的 shape 名）。 */
  parent: string
  key: string
  shape: string
}

export interface Xml46687BoundaryContribution {
  fields?: Readonly<Record<string, readonly string[]>>
  shapes?: readonly Xml46687ShapeRule[]
  plainKindShapes?: readonly string[]
  marks?: readonly string[]
  declared: readonly Xml46687DeclaredDifference[]
}

/**
 * 各领域的放行常量，按任务分段排列（T2.4b/T2.4c 的常量已在此登记，它们只改各自文件里的内容）。
 * 数组的“域分段”写法让不同任务的改动落在不同的行上，不在同一行冲突。
 */
const CONTRIBUTIONS: readonly Xml46687BoundaryContribution[] = [
  // T2.4a-1
  XML46687_STRUCTURE_BOUNDARY,
  XML46687_META_BOUNDARY,
  XML46687_INLINE_BOUNDARY,
  XML46687_BLOCKS_BOUNDARY,
  // T2.4b
  XML46687_TABLES_BOUNDARY,
  XML46687_FIGURES_BOUNDARY,
  XML46687_FORMULAS_BOUNDARY,
  // T2.4c
  XML46687_TERMS_BOUNDARY,
  XML46687_REFS_BOUNDARY,
]

function mergeFields(): Readonly<Record<string, readonly string[]>> {
  const merged: Record<string, string[]> = {}
  for (const contribution of CONTRIBUTIONS) {
    for (const [kind, fields] of Object.entries(contribution.fields ?? {})) {
      const list = merged[kind] ?? (merged[kind] = [])
      for (const field of fields) if (!list.includes(field)) list.push(field)
    }
  }
  return merged
}

/** `EXTRA_FIELDS.XML46687`：kind 或 shape → 额外放行的字段。 */
export const XML46687_EXTRA_FIELDS: Readonly<Record<string, readonly string[]>> = mergeFields()
/** 额外放行的 mark 类型（并入 `MARKS_BY_FORMAT.XML46687`）。 */
export const XML46687_EXTRA_MARKS: readonly string[] = [...new Set(CONTRIBUTIONS.flatMap((contribution) => contribution.marks ?? []))]
/** childShape 登记。 */
export const XML46687_SHAPE_RULES: readonly Xml46687ShapeRule[] = CONTRIBUTIONS.flatMap((contribution) => contribution.shapes ?? [])
/** `kind` 是数据字段而不是节点 kind 的 shape。 */
export const XML46687_PLAIN_KIND_SHAPES: ReadonlySet<string> = new Set(CONTRIBUTIONS.flatMap((contribution) => contribution.plainKindShapes ?? []))

/**
 * XML46687 比旧 `XML` 多放行的全部项（含罗马列项，原因同 `outputBoundary.ts` 的注释）。
 * 测试以此断言“差集恰等于声明集合”：新增放行而不登记，或登记了却没有真正放行，都会失败。
 */
export const XML46687_DECLARED_DIFFERENCES: readonly Xml46687DeclaredDifference[] = CONTRIBUTIONS.flatMap((contribution) => contribution.declared)

// ---------------------------------------------------------------------------
// 差异对照（供测试与验收使用）
// ---------------------------------------------------------------------------

/** 去掉问题路径里的全部 `[n]` 下标：`doc.body[0].children[2].kind` → `doc.body.children.kind`。 */
export function stripPathIndices(path: string): string {
  return path.replace(/\[\d+\]/g, '')
}

function walkPath(root: unknown, path: string): { parent: unknown; key: string; parentPath: string } | undefined {
  const tokens = [...path.matchAll(/\.?([^.[\]]+)|\[(\d+)\]/g)].map((match) => (match[2] !== undefined ? Number(match[2]) : match[1]!))
  if (tokens.length < 2 || tokens[0] !== 'doc' || typeof tokens[tokens.length - 1] !== 'string') return undefined
  let current: unknown = root
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[tokens[index]!]
  }
  const key = tokens[tokens.length - 1] as string
  const parentPath = path.slice(0, path.length - key.length - 1)
  return { parent: current, key, parentPath }
}

/**
 * 把一条边界问题路径归类为“字段 / 块 kind / mark 类型”差异：以 `.kind` 结尾且父对象不是 mark → 块 kind，
 * 以 `marks[n].type` 结尾 → mark 类型，其余按字段名。路径解析不到时按字段名处理。
 */
export function describeBoundaryDifference(doc: IRDoc, path: string): { kind: 'field' | 'kind' | 'markType'; name: string } {
  const walked = walkPath(doc, path)
  if (!walked) return { kind: 'field', name: path.slice(path.lastIndexOf('.') + 1) }
  const inMark = /marks\[\d+\]$/.test(walked.parentPath)
  const parent = walked.parent as Record<string, unknown> | null | undefined
  if (walked.key === 'kind' && !inMark && parent && typeof parent.kind === 'string') return { kind: 'kind', name: parent.kind }
  if (walked.key === 'type' && inMark && parent && typeof parent.type === 'string') return { kind: 'markType', name: parent.type }
  return { kind: 'field', name: walked.key }
}

/** 找出覆盖这条问题路径的已声明差异；没有则返回 undefined。 */
export function findDeclaredDifference(doc: IRDoc, path: string): Xml46687DeclaredDifference | undefined {
  const described = describeBoundaryDifference(doc, path)
  const stripped = stripPathIndices(path)
  return XML46687_DECLARED_DIFFERENCES.find((entry) =>
    entry.kind === described.kind && entry.name === described.name && stripped.endsWith(entry.pathSuffix))
}
