/**
 * id 的登记、后置赋值（P3）与收尾检查（P4）（WP8.2 设计 §3.2～§3.4）。
 *
 * - “仅被引用时写 id”不靠预扫描：P2 建树时登记 `(NodeId → 元素)`（`registerPendingId`）、写出每个 `xref` 时登记目标
 *   （`emitRef`），P3 对交集补写 `id`，于是 id 与实际写出的引用严格一一对应；
 * - `mml:math` 的 `id="mml_m<k>"` 在整棵树建完后按**输出文档序**后置赋值（行间与行内合并计数）；
 * - P4 在一次遍历里检查：id 是合法 NCName、全树唯一、`rid`/`target` 可解析、没有 `ext_` 等内部占位 id 泄漏，
 *   以及图片 `href` 在资源清单里有条目（`resource-missing`/`resource-mismatch`，多余条目 info `resource-unused`）。
 *
 * 编号只来自 Resolver：本文件除 `mml_m<k>` 外不产生任何 id。
 */

import type { NodeId } from '../../ir/types'
import { MATHML_NS, type XmlElement, type XmlNode } from '../../xml46687/tree'
import { getAttr, qualifiedName, removeAttr, setAttr, site, type RenderContext } from './context'

export interface IdState {
  /** NodeId → 待补 id 的元素（同一 NodeId 理论上只登记一次；重复 id 时全部处理）。 */
  pending: Map<NodeId, { element: XmlElement; path: string | undefined }[]>
  emitted: Set<NodeId>
}

export function createIdState(): IdState {
  return { pending: new Map(), emitted: new Set() }
}

export function registerPending(state: IdState, nodeId: NodeId, element: XmlElement, path?: string): void {
  const list = state.pending.get(nodeId)
  const entry = { element, path }
  if (list) list.push(entry)
  else state.pending.set(nodeId, [entry])
}

export function emitRef(state: IdState, nodeId: NodeId): void {
  state.emitted.add(nodeId)
}

// ---------------------------------------------------------------------------
// P3 后置赋值
// ---------------------------------------------------------------------------

/** P3①：对 `emittedRefs ∩ pendingIds` 的元素补写 `id=labels[nodeId].xmlId`（置于第一个属性）。 */
export function assignPendingIds(ctx: RenderContext, state: IdState): void {
  for (const [nodeId, entries] of state.pending) {
    if (!state.emitted.has(nodeId)) continue
    for (const { element, path } of entries) {
      const xmlId = ctx.labelOf(nodeId)?.xmlId
      if (typeof xmlId !== 'string' || xmlId === '') {
        ctx.report('xml-label-missing', 'error', `被引用的对象（节点 ${nodeId}）在 Resolver 的 labels 中没有 xmlId，无法写出 id。`, site(path ?? `labels[${nodeId}]`, nodeId))
        continue
      }
      setAttr(element, 'id', xmlId)
    }
  }
}

/**
 * P3②：按输出文档序给 `mml:math` 根赋 `id="mml_m<k>"`（k 从 1 起，行间与行内合并计数；嵌套在另一个 `mml:math` 内的不计）。
 * 原有 `id` 先删除（输入值被丢弃，设计 §4.5-3）。必须以输出树为准而不是 IR 顺序（表注在行之后、图注在说明段之后……）。
 */
export function assignMathIds(root: XmlElement): number {
  let count = 0
  const visit = (node: XmlNode, insideMath: boolean): void => {
    if (node.type !== 'element') return
    const isMath = node.name.ns === MATHML_NS && node.name.local === 'math'
    if (isMath && !insideMath) {
      count += 1
      removeAttr(node, 'id')
      setAttr(node, 'id', `mml_m${count}`)
    }
    for (const child of node.children) visit(child, insideMath || isMath)
  }
  visit(root, false)
  return count
}

// ---------------------------------------------------------------------------
// P4 收尾检查
// ---------------------------------------------------------------------------

const NAME_START = 'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF'
  + '\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const NAME_CHAR = `${NAME_START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`
const NCNAME = new RegExp(`^[${NAME_START}][${NAME_CHAR}]*$`, 'u')
/** 内部占位或遗留形式的 id（R-5、V-7）：不得进入 XML。 */
const LEAKED_ID = [/^ext_/, /^Formula/, /^id-[0-9A-Fa-f]+(?:-[0-9A-Fa-f]+)+$/, /^p-\d+$/]

function leaks(value: string): boolean {
  return LEAKED_ID.some((pattern) => pattern.test(value))
}

interface Reference { kind: 'rid' | 'target'; value: string; path: string; element: string }

/** P4：全树检查（id/rid/target），再对资源清单做核对。所有问题都是 error，除 `resource-unused`（info）。 */
export function checkOutputTree(ctx: RenderContext, root: XmlElement): void {
  const ids = new Map<string, { element: string; path: string }>()
  const references: Reference[] = []
  const hrefs = new Map<string, string>()

  const visit = (element: XmlElement, path: string): void => {
    const name = qualifiedName(element)
    const id = getAttr(element, 'id')
    if (id !== undefined) {
      if (!NCNAME.test(id)) {
        ctx.report('xml-id-invalid', 'error', `id「${id}」不是合法的 XML 名称（NCName）：<${name}>（${path}）。`, site(`xml:${path}`))
      } else if (leaks(id)) {
        ctx.report('xml-ext-id-leak', 'error', `id「${id}」是内部占位或遗留形式，不得写入 XML：<${name}>（${path}）。`, site(`xml:${path}`))
      }
      const first = ids.get(id)
      if (first) {
        ctx.report('xml-id-duplicate', 'error', `id「${id}」重复：<${first.element}>（${first.path}）与 <${name}>（${path}）。`, site(`xml:${path}`))
      } else {
        ids.set(id, { element: name, path })
      }
    }
    if (name === 'xref') {
      const rid = getAttr(element, 'rid')
      if (rid !== undefined) {
        for (const token of rid.split(/\s+/).filter((entry) => entry !== '')) references.push({ kind: 'rid', value: token, path, element: name })
      }
    } else if (name === 'tbx:entailedTerm') {
      const target = getAttr(element, 'target')
      if (target !== undefined) references.push({ kind: 'target', value: target, path, element: name })
    } else if (name === 'graphic' || name === 'inline-graphic') {
      const href = getAttr(element, 'xlink:href')
      if (href !== undefined && !hrefs.has(href)) hrefs.set(href, path)
    }
    const counts = new Map<string, number>()
    for (const child of element.children) {
      if (child.type !== 'element') continue
      const childName = qualifiedName(child)
      const index = (counts.get(childName) ?? 0) + 1
      counts.set(childName, index)
      visit(child, `${path}/${childName}[${index}]`)
    }
  }
  visit(root, `/${qualifiedName(root)}[1]`)

  for (const reference of references) {
    const attribute = reference.kind === 'rid' ? 'rid' : 'target'
    if (leaks(reference.value)) {
      ctx.report('xml-ext-id-leak', 'error', `<${reference.element}> 的 ${attribute}「${reference.value}」是内部占位或遗留形式，不得写入 XML（${reference.path}）。`, site(`xml:${reference.path}`))
    } else if (!ids.has(reference.value)) {
      ctx.report('xml-rid-unresolved', 'error', `<${reference.element}> 的 ${attribute}「${reference.value}」在输出中找不到对应的 id（${reference.path}）。`, site(`xml:${reference.path}`))
    }
  }

  checkResources(ctx, hrefs)
}

/**
 * 资源清单核对（设计 §3.4、§4.3）：IR 里的每处图片引用在清单里要有条目且资源键一致；树里出现的 `href` 若不在清单里再补报
 * （领域模块写出了 IR 之外的 `href` 时）；清单里没被用到的条目 info `resource-unused`。
 */
function checkResources(ctx: RenderContext, treeHrefs: ReadonlyMap<string, string>): void {
  const entries = ctx.options.resources.entries
  const byHref = new Map(entries.map((entry) => [entry.href, entry]))
  const reported = new Set<string>()
  for (const ref of ctx.imageRefs) {
    const entry = byHref.get(ref.href)
    if (!entry) {
      reported.add(ref.href)
      ctx.report('resource-missing', 'error', `图片资源清单中没有 href「${ref.href}」的条目（资源 ${ref.key || '（无）'}），无法写出 xlink:href。`, site(ref.path, ref.ownerId))
    } else if (entry.key !== ref.key) {
      reported.add(ref.href)
      ctx.report('resource-mismatch', 'error', `图片资源清单中 href「${ref.href}」对应的资源键「${entry.key}」与文档中的「${ref.key}」不一致。`, site(ref.path, ref.ownerId))
    }
  }
  for (const [href, path] of treeHrefs) {
    if (!byHref.has(href) && !reported.has(href)) {
      ctx.report('resource-missing', 'error', `图片资源清单中没有 href「${href}」的条目，无法写出 xlink:href（${path}）。`, site(`xml:${path}`))
    }
  }
  const used = new Set([...treeHrefs.keys()])
  for (const entry of entries) {
    if (!used.has(entry.href)) {
      ctx.report('resource-unused', 'info', `图片资源清单中的条目「${entry.href}」没有被文档使用。`, site(`options.resources.entries`))
    }
  }
}
