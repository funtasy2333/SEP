/**
 * 批量文档操作（WP9.2c1）：在内存中依次执行 insert / replace / delete / move，全有或全无。
 *
 * 流程（设计文档 §6.3）：在 PM JSON 中按 nodeId 定位并执行操作，只把新增片段经
 * `normalizeAuthoringFragment` → `irFragmentToPm` 投影，不做整篇 IR 往返。全部执行后：
 * 宿主注入的 `validateContent`（生产 schema 校验 + nodeId 规范化）→ `pmToIr` + `resolve`，
 * 把 Resolver 问题连同「是否本批新引入」一并返回。任一操作出错则整批不生效，返回全部问题。
 *
 * 纯函数、同构：不读系统时间，不使用浏览器或 Node 专有 API，不修改入参（结果与入参共享未改动的子树）；
 * nodeId 生成器可注入。
 */

import {
  describeAuthoringContext,
  fragmentContextRules,
  generateNodeId,
  irFragmentToPm,
  IRToPmError,
  MISSING_ID_PREFIX,
  normalizeAuthoringFragment,
  pmToIr,
  resolve,
  type AuthoringContext,
  type IRFragmentNode,
  type IRProblem,
  type IRUnsupportedContent,
  type PMJsonNode,
} from '@ses/shared'
import {
  analyzeReplaceability, buildInspectEnv, idsOutsideSubtree, RESERVED_IDS, usedIdsOf,
} from './inspect'
import {
  CONTAINER_LABELS, firstBodyIndex, findEnclosingAddressable, indexDocument, kindAllowedIn, KIND_LABELS,
  nodeAtPath, parentPathOf, pathKey, rootInsertIndex, spliceAt, subtreeIds,
  type DocIndex, type LocatedNode,
} from './locator'
import { parseOperations } from './operations'
import {
  DOCUMENT_CONTAINERS,
  type ApplyDocumentOperationsOptions,
  type ApplyDocumentOperationsResult,
  type DocumentContainer,
  type DocumentOperation,
  type DocumentOperationIssue,
  type DocumentOperationIssueCode,
  type DocumentOperationWarning,
  type DocumentProblem,
  type InsertPosition,
  type OperationEffect,
} from './types'

/** 参考文献容器新建时的标题，与 irToPm 一致。 */
const BIBLIOGRAPHY_TITLE = '参考文献'

const MAX_LEVEL = 5

const isContainerName = (value: string): value is DocumentContainer =>
  (DOCUMENT_CONTAINERS as readonly string[]).includes(value)

/**
 * 写作片段里的节点 id 不得取容器名：`resolveTarget` 先按容器名解析 `parent`，
 * id 为 `body` 等的章、条、附录因此永远无法作为 insert / move 的父节点。
 * 只约束本批新写入的 id；文档里已有的这类 id（REST 直接写入）不在此列，`nodeId` 规范化也不处理。
 */
const RESERVED_ID_SET: ReadonlySet<string> = new Set(RESERVED_IDS)

function issueOf(
  index: number, path: string, code: DocumentOperationIssueCode, reason: string, nodeId?: string,
): DocumentOperationIssue {
  return { operationIndex: index, path, code, reason, ...(nodeId ? { nodeId } : {}) }
}

// ---------- 定位目标 ----------

type Found<T> = { ok: true; value: T } | { ok: false; issue: DocumentOperationIssue }

/** 在文档里找不到（或不能单独寻址）某个 nodeId 时的提示。 */
function missingNodeIssue(
  index: DocIndex, id: string, opIndex: number, path: string, code: 'node-not-found' | 'anchor-not-found',
): DocumentOperationIssue {
  const enclosing = findEnclosingAddressable(index, id)
  if (enclosing) {
    const where = enclosing.ancestor
      ? `位于${KIND_LABELS[enclosing.ancestor.kind]}「${enclosing.ancestor.id}」内部，请改为操作该${KIND_LABELS[enclosing.ancestor.kind]}`
      : '不属于可单独寻址的节点'
    return issueOf(opIndex, path, 'node-not-addressable', `「${id}」（${enclosing.pmType}）${where}`, id)
  }
  return issueOf(opIndex, path, code, `文档里没有 id 为「${id}」的节点`, id)
}

function locateNode(
  index: DocIndex, id: string, opIndex: number, path: string,
  code: 'node-not-found' | 'anchor-not-found' = 'node-not-found',
): Found<LocatedNode> {
  if (index.duplicates.has(id)) {
    return {
      ok: false,
      issue: issueOf(opIndex, path, 'node-ambiguous', `文档里有多个节点使用 id「${id}」，无法确定指哪一个；请先修复重复的 id`, id),
    }
  }
  const located = index.byId.get(id)
  return located ? { ok: true, value: located } : { ok: false, issue: missingNodeIssue(index, id, opIndex, path, code) }
}

/** 片段插入的目标：容器，或章/条/附录节点。 */
interface Target {
  context: AuthoringContext
  container?: DocumentContainer
  located?: LocatedNode
}

function resolveTarget(index: DocIndex, name: string, opIndex: number, path: string): Found<Target> {
  if (isContainerName(name)) {
    return { ok: true, value: { container: name, context: { parent: name } } }
  }
  const found = locateNode(index, name, opIndex, path)
  if (!found.ok) return found
  const located = found.value
  switch (located.kind) {
    case 'chapter':
      return { ok: true, value: { located, context: { parent: 'chapter' } } }
    case 'appendix':
      return { ok: true, value: { located, context: { parent: 'appendix' } } }
    case 'clause': {
      const level = located.level ?? 1
      if (level > MAX_LEVEL) {
        return {
          ok: false,
          issue: issueOf(opIndex, path, 'invalid-context', `条「${name}」位于第 ${level} 层，超过最大层级 ${MAX_LEVEL}，无法作为插入目标`, name),
        }
      }
      return { ok: true, value: { located, context: { parent: 'clause', level: level as 1 | 2 | 3 | 4 | 5 } } }
    }
    default:
      return {
        ok: false,
        issue: issueOf(opIndex, path, 'invalid-parent',
          `「${name}」是${KIND_LABELS[located.kind]}，不能作为父节点；可作为父节点的是章、条、附录，或容器 ${DOCUMENT_CONTAINERS.join('、')}`, name),
      }
  }
}

const targetLabel = (target: Target): string =>
  target.located
    ? `${KIND_LABELS[target.located.kind]}「${target.located.id}」`
    : CONTAINER_LABELS[target.container!]

const parentLabel = (located: LocatedNode): string =>
  'container' in located.parent
    ? CONTAINER_LABELS[located.parent.container]
    : `${KIND_LABELS[located.parent.kind]}「${located.parent.nodeId}」`

// ---------- 插入位置 ----------

interface InsertPoint {
  /** 接收子节点的父节点路径（根节点为 []）。 */
  parentPath: number[]
  pmIndex: number
  /** 容器还不存在，需要新建：容器类型与它在 `root.content` 中应有的下标。 */
  create?: { type: 'foreword' | 'introduction' | 'bibliography'; rootIndex: number }
}

/**
 * 把位置解析为 PM 下标。`start`/`end` 对章、条、附录、参考文献指标题节点之后/末尾；
 * `before`/`after` 的锚点必须是目标的直接子节点。根节点顺序由 {@link rootInsertIndex} 保证。
 * `movingId`：move 时被移动节点的 id，不能作为自己的锚点。
 */
function resolveInsertPoint(
  index: DocIndex, target: Target, position: InsertPosition, opIndex: number, path: string, movingId?: string,
): Found<InsertPoint> {
  const root = index.root
  const anchorKey = typeof position === 'object' ? ('before' in position ? 'before' : 'after') : undefined
  const anchorId = typeof position === 'object' ? ('before' in position ? position.before : position.after) : undefined
  const anchorPath = anchorKey ? `${path}.${anchorKey}` : path

  let parentPath: number[]
  let content: readonly PMJsonNode[]
  let isChild: (anchor: LocatedNode) => boolean
  let rootLevel: { type: 'chapter' | 'appendix'; roots: number[] } | undefined
  let create: InsertPoint['create']

  if (target.located) {
    const located = target.located
    parentPath = located.path
    content = located.node.content ?? []
    isChild = anchor => pathKey(parentPathOf(anchor)) === pathKey(located.path)
  } else {
    const name = target.container!
    if (name === 'body' || name === 'appendices') {
      const type = name === 'body' ? 'chapter' : 'appendix'
      parentPath = []
      content = root.content ?? []
      rootLevel = { type, roots: index.rootIndices[type] }
      isChild = anchor => 'container' in anchor.parent && anchor.parent.container === name
    } else {
      const roots = index.rootIndices[name]
      if (roots.length > 1) {
        return {
          ok: false,
          issue: issueOf(opIndex, path, 'container-ambiguous', `文档里有 ${roots.length} 个${CONTAINER_LABELS[name]}容器，无法确定指哪一个`),
        }
      }
      if (roots.length === 0) {
        if (anchorId !== undefined) {
          return {
            ok: false,
            issue: issueOf(opIndex, anchorPath, 'anchor-not-found',
              `${CONTAINER_LABELS[name]}还不存在，无法相对节点「${anchorId}」定位；请使用 'start' 或 'end'`, anchorId),
          }
        }
        return { ok: true, value: { parentPath: [], pmIndex: 0, create: { type: name, rootIndex: rootInsertIndex(root, name) } } }
      }
      const rootIndex = roots[0]!
      parentPath = [rootIndex]
      content = root.content![rootIndex]!.content ?? []
      isChild = anchor => 'container' in anchor.parent && anchor.parent.container === name && anchor.path[0] === rootIndex
    }
  }

  if (anchorId === undefined) {
    if (rootLevel) {
      const { type, roots } = rootLevel
      const fallback = (): number => rootInsertIndex(root, type)
      const pmIndex = position === 'start'
        ? (roots.length > 0 ? roots[0]! : fallback())
        : (roots.length > 0 ? roots[roots.length - 1]! + 1 : fallback())
      return { ok: true, value: { parentPath, pmIndex, create } }
    }
    return { ok: true, value: { parentPath, pmIndex: position === 'start' ? firstBodyIndex(content) : content.length, create } }
  }

  if (anchorId === movingId) {
    return {
      ok: false,
      issue: issueOf(opIndex, anchorPath, 'anchor-not-in-parent', `锚点不能是被移动的节点「${anchorId}」本身`, anchorId),
    }
  }
  const found = locateNode(index, anchorId, opIndex, anchorPath, 'anchor-not-found')
  if (!found.ok) return found
  const anchor = found.value
  if (!isChild(anchor)) {
    return {
      ok: false,
      issue: issueOf(opIndex, anchorPath, 'anchor-not-in-parent',
        `锚点「${anchorId}」（${KIND_LABELS[anchor.kind]}）不是${targetLabel(target)}的直接子节点，它位于${parentLabel(anchor)}`, anchorId),
    }
  }
  return { ok: true, value: { parentPath, pmIndex: anchor.pmIndex + (anchorKey === 'after' ? 1 : 0), create } }
}

// ---------- 片段 ----------

interface BuiltFragment {
  ir: IRFragmentNode[]
  pm: PMJsonNode[]
  /** 片段里全部可寻址节点的 id（先序）。 */
  ids: string[]
}

function addressableIds(nodes: readonly IRFragmentNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(node.id)
    if (node.kind === 'chapter' || node.kind === 'appendix' || node.kind === 'clause') addressableIds(node.children, out)
  }
  return out
}

const SECTION_TYPES: ReadonlySet<string> = new Set(['chapter', 'appendix', 'clause'])

/**
 * 编辑器里条标题节点的 `level` 与条自身的 `level` 同步（决定标题的显示层级）。
 * `irToPm` 投影的条标题不带该属性，这里补上，使 AI 写入的深层条与人在编辑器里建的条显示一致。
 */
function syncClauseTitles(node: PMJsonNode): PMJsonNode {
  if (!SECTION_TYPES.has(node.type) || !node.content) return node
  const level = node.type === 'clause' ? node.attrs?.level : undefined
  return {
    ...node,
    content: node.content.map(child =>
      node.type === 'clause' && child.type === 'clauseTitle' && typeof level === 'number'
        ? { ...child, attrs: { ...child.attrs, level } }
        : syncClauseTitles(child)),
  }
}

function buildFragment(
  content: unknown, context: AuthoringContext, rootPath: string, existingIds: ReadonlySet<string>,
  generateId: () => string, opIndex: number,
): { ok: true; built: BuiltFragment } | { ok: false; issues: DocumentOperationIssue[] } {
  const normalized = normalizeAuthoringFragment(content, context, {
    existingIds, generateId, rootPath, reservedIds: RESERVED_ID_SET,
  })
  if (!normalized.ok) {
    return {
      ok: false,
      issues: normalized.issues.map(item => issueOf(opIndex, item.path, item.code, item.reason, item.nodeId)),
    }
  }
  try {
    const pm = irFragmentToPm(normalized.nodes, context, { rootPath }).map(syncClauseTitles)
    return { ok: true, built: { ir: normalized.nodes, pm, ids: addressableIds(normalized.nodes) } }
  } catch (error) {
    if (!(error instanceof IRToPmError)) throw error
    return {
      ok: false,
      issues: error.diagnostics.map(item => issueOf(opIndex, item.path, 'projection-failed', item.reason, item.nodeId)),
    }
  }
}

/** 取一个不与 `taken` 冲突的新 id。 */
function freshId(generateId: () => string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = generateId()
    if (typeof id === 'string' && id.length > 0 && !taken.has(id)) return id
  }
  throw new Error('无法生成不冲突的 nodeId：id 生成器连续返回重复或空值')
}

function makeContainer(
  type: 'foreword' | 'introduction' | 'bibliography', children: PMJsonNode[], nodeId: string,
): PMJsonNode {
  return {
    type,
    attrs: { nodeId },
    content: type === 'bibliography'
      ? [{ type: 'bibliographyTitle', content: [{ type: 'text', text: BIBLIOGRAPHY_TITLE }] }, ...children]
      : children,
  }
}

/** 在插入点写入节点；容器不存在时先建容器。返回新文档与新建的容器名。 */
function insertAt(
  doc: PMJsonNode, point: InsertPoint, nodes: PMJsonNode[], generateId: () => string, taken: ReadonlySet<string>,
): { doc: PMJsonNode; createdContainer?: DocumentContainer } {
  if (point.create) {
    const container = makeContainer(point.create.type, nodes, freshId(generateId, taken))
    return { doc: spliceAt(doc, [], point.create.rootIndex, 0, [container]), createdContainer: point.create.type }
  }
  return { doc: spliceAt(doc, point.parentPath, point.pmIndex, 0, nodes) }
}

// ---------- 容器清理 ----------

/**
 * `node` 是前言/引言/参考文献容器且已没有内容节点时返回 true。
 * 生产 schema：前言、引言为 `block+`，参考文献为 `bibliographyTitle bibEntry+`，不能为空；
 * 空容器等价于「没有这个容器」（irToPm 对空容器同样省略），所以移除而不是留一个非法的空节点。
 */
function isEmptyContainer(node: PMJsonNode | undefined): boolean {
  if (!node) return false
  if (node.type === 'foreword' || node.type === 'introduction') return (node.content ?? []).length === 0
  if (node.type === 'bibliography') return !(node.content ?? []).some(child => child.type === 'bibEntry')
  return false
}

const containerNameOf = (node: PMJsonNode): DocumentContainer | undefined =>
  node.type === 'foreword' || node.type === 'introduction' || node.type === 'bibliography' ? node.type : undefined

/** 按对象身份移除指定的（空）容器节点；该节点已不在根下（被写入新内容后已是新对象）则不动。 */
function dropContainer(doc: PMJsonNode, emptied: PMJsonNode | undefined): { doc: PMJsonNode; removed?: DocumentContainer } {
  if (!emptied) return { doc }
  const at = (doc.content ?? []).indexOf(emptied)
  if (at === -1) return { doc }
  return { doc: spliceAt(doc, [], at, 1, []), removed: containerNameOf(emptied) }
}

// ---------- 层级调整（move） ----------

interface Relevel {
  node: PMJsonNode
  /** 层级发生变化的条与术语条目 id（先序）。 */
  changed: string[]
  /** 超过最大层级的条（id 与新层级）。 */
  overflow: { id: string; level: number }[]
}

/**
 * 被移动的条/术语条目取新位置的层级 `newLevel`，其后代（子条、术语条目）按同一差值平移，
 * 条标题节点的 `level` 同步（编辑器里两者相等）。术语条目的层级只是显示层级，平移后限制在 1~5；
 * 条超过 5 记为溢出，由调用方拒绝。差值为 0 时原样返回。
 */
function relevel(node: PMJsonNode, newLevel: number): Relevel {
  const changed: string[] = []
  const overflow: Relevel['overflow'] = []
  const oldLevel = typeof node.attrs?.level === 'number' ? node.attrs.level : newLevel
  const delta = newLevel - oldLevel
  if (delta === 0) return { node, changed, overflow }

  const shift = (current: PMJsonNode, level: number): PMJsonNode => {
    const isClause = current.type === 'clause'
    const id = current.attrs?.nodeId
    if (typeof id === 'string') {
      changed.push(id)
      if (isClause && level > MAX_LEVEL) overflow.push({ id, level })
    }
    const content = (current.content ?? []).map(child => {
      if (isClause && child.type === 'clauseTitle') return { ...child, attrs: { ...child.attrs, level } }
      if (child.type !== 'clause' && child.type !== 'termDef') return child
      const childOld = typeof child.attrs?.level === 'number' ? child.attrs.level : level - delta + 1
      const shifted = Math.max(1, childOld + delta)
      return shift(child, child.type === 'termDef' ? Math.min(MAX_LEVEL, shifted) : shifted)
    })
    return { ...current, attrs: { ...current.attrs, level }, ...(current.content ? { content } : {}) }
  }
  return { node: shift(node, newLevel), changed, overflow }
}

// ---------- 操作执行 ----------

interface OpSuccess {
  ok: true
  doc: PMJsonNode
  effect: OperationEffect
  warnings: DocumentOperationWarning[]
}
interface OpFailure {
  ok: false
  issues: DocumentOperationIssue[]
}
type OpResult = OpSuccess | OpFailure

const fail = (...issues: DocumentOperationIssue[]): OpFailure => ({ ok: false, issues })

function runInsert(
  doc: PMJsonNode, op: Extract<DocumentOperation, { op: 'insert' }>, i: number, generateId: () => string,
): OpResult {
  const index = indexDocument(doc)
  const target = resolveTarget(index, op.parent, i, `operations[${i}].parent`)
  if (!target.ok) return fail(target.issue)
  const point = resolveInsertPoint(index, target.value, op.position, i, `operations[${i}].position`)
  if (!point.ok) return fail(point.issue)

  const { doc: ir } = pmToIr(doc)
  const used = usedIdsOf(doc, ir)
  const built = buildFragment(op.content, target.value.context, `operations[${i}].content`, used, generateId, i)
  if (!built.ok) return fail(...built.issues)

  const taken = new Set([...used, ...built.built.ids])
  const inserted = insertAt(doc, point.value, built.built.pm, generateId, taken)
  return {
    ok: true,
    doc: inserted.doc,
    effect: {
      index: i, op: 'insert', inserted: built.built.ids, removed: [], moved: [],
      ...(inserted.createdContainer ? { createdContainer: inserted.createdContainer } : {}),
    },
    warnings: [],
  }
}

function runReplace(
  doc: PMJsonNode, op: Extract<DocumentOperation, { op: 'replace' }>, i: number, generateId: () => string,
): OpResult {
  const index = indexDocument(doc)
  const found = locateNode(index, op.nodeId, i, `operations[${i}].nodeId`)
  if (!found.ok) return fail(found.issue)
  const located = found.value
  if (located.context === undefined) {
    return fail(issueOf(i, `operations[${i}].nodeId`, 'invalid-context',
      `${KIND_LABELS[located.kind]}「${op.nodeId}」所在层级超过 ${MAX_LEVEL} 级，没有可用的替换上下文`, op.nodeId))
  }
  const env = buildInspectEnv(doc, index)

  // 被替换的节点（或其后代）含写作片段无法表达的内容时，整体替换必然丢失它们：默认拒绝，
  // 显式 acceptLoss 才执行（并在 warnings 里留下说明）。片段本身的问题与此并行检查，一次报全。
  const losses = analyzeReplaceability(env, located).filter(reason =>
    reason.code === 'unsupported-field' || reason.code === 'unsupported-content' || reason.code === 'unsupported-kind')
  const listed = losses.map((reason, position) => `${position + 1}. ${reason.message}${reason.path ? `（位置 ${reason.path}）` : ''}`).join('；')
  const label = `${KIND_LABELS[located.kind]}「${op.nodeId}」`
  const issues: DocumentOperationIssue[] = []
  if (losses.length > 0 && op.acceptLoss !== true) {
    issues.push(issueOf(i, `operations[${i}].nodeId`, 'replace-loses-content',
      `${label}含有写作片段无法表达的内容，整体替换会丢失它们：${listed}。`
      + '确认可以丢失时，在该 replace 操作上加 "acceptLoss": true；只想修改其中一部分时，请改为替换它内部不含这些内容的子节点', op.nodeId))
  }
  const built = buildFragment(
    op.content, located.context, `operations[${i}].content`, idsOutsideSubtree(env, located), generateId, i,
  )
  if (!built.ok) issues.push(...built.issues)
  if (!built.ok || issues.length > 0) return fail(...issues)

  const warnings: DocumentOperationWarning[] = losses.length === 0 ? [] : [{
    operationIndex: i,
    code: 'replace-loses-content',
    nodeId: op.nodeId,
    reason: `已按 acceptLoss 替换${label}，其中写作片段无法表达的内容已丢失：${listed}`,
  }]
  return {
    ok: true,
    doc: spliceAt(doc, parentPathOf(located), located.pmIndex, 1, built.built.pm),
    effect: {
      index: i, op: 'replace', inserted: built.built.ids, removed: subtreeIds(index, located), moved: [],
    },
    warnings,
  }
}

function runDelete(
  doc: PMJsonNode, op: Extract<DocumentOperation, { op: 'delete' }>, i: number,
): OpResult {
  const index = indexDocument(doc)
  const found = locateNode(index, op.nodeId, i, `operations[${i}].nodeId`)
  if (!found.ok) return fail(found.issue)
  const located = found.value
  const removed = subtreeIds(index, located)
  const without = spliceAt(doc, parentPathOf(located), located.pmIndex, 1, [])
  const container = 'container' in located.parent ? nodeAtPath(without, [located.path[0]!]) : undefined
  const cleaned = 'container' in located.parent && isEmptyContainer(container)
    ? dropContainer(without, container)
    : { doc: without }
  return {
    ok: true,
    doc: cleaned.doc,
    effect: {
      index: i, op: 'delete', inserted: [], removed, moved: [],
      ...('removed' in cleaned && cleaned.removed ? { removedContainer: cleaned.removed } : {}),
    },
    warnings: [],
  }
}

function runMove(
  doc: PMJsonNode, op: Extract<DocumentOperation, { op: 'move' }>, i: number, generateId: () => string,
): OpResult {
  const index = indexDocument(doc)
  const found = locateNode(index, op.nodeId, i, `operations[${i}].nodeId`)
  if (!found.ok) return fail(found.issue)
  const moving = found.value
  const targetPath = `operations[${i}].parent`
  const resolved = resolveTarget(index, op.parent, i, targetPath)
  if (!resolved.ok) return fail(resolved.issue)
  const target = resolved.value

  const into = target.located
  if (into && (into.id === moving.id || (into.path.length >= moving.path.length
    && moving.path.every((segment, position) => into.path[position] === segment)))) {
    return fail(issueOf(i, targetPath, 'move-into-self',
      `不能把${KIND_LABELS[moving.kind]}「${moving.id}」移动到它自己或它的子孙之内`, moving.id))
  }
  if (!kindAllowedIn(moving.kind, target.context)) {
    return fail(issueOf(i, targetPath, 'not-allowed-here',
      `${KIND_LABELS[moving.kind]}不能放在「${describeAuthoringContext(target.context)}」中；${targetLabel(target)}允许的节点种类见写作说明的上下文表`, moving.id))
  }
  const early = resolveInsertPoint(index, target, op.position, i, `operations[${i}].position`, moving.id)
  if (!early.ok) return fail(early.issue)

  // 条与术语条目的层级随新位置变化
  let movedNode = moving.node
  let levelChanged: string[] = []
  if (moving.kind === 'clause' || moving.kind === 'termEntry') {
    const newLevel = fragmentContextRules(target.context).childLevel!
    const result = relevel(movedNode, newLevel)
    if (result.overflow.length > 0) {
      return fail(...result.overflow.map(item => issueOf(i, targetPath, 'level-overflow',
        `移动后条「${item.id}」的层级将为 ${item.level}，超过最大层级 ${MAX_LEVEL}；请选择层级更浅的目标，或先调整这条的子条`, item.id)))
    }
    movedNode = result.node
    levelChanged = result.changed
  }

  // 先移除、再在移除后的文档里重新解析位置，使 before/after 与下标都对应最新结构。
  const without = spliceAt(doc, parentPathOf(moving), moving.pmIndex, 1, [])
  const sourceContainer = 'container' in moving.parent ? nodeAtPath(without, [moving.path[0]!]) : undefined
  const index2 = indexDocument(without)
  const target2 = resolveTarget(index2, op.parent, i, targetPath)
  if (!target2.ok) return fail(target2.issue)
  const point = resolveInsertPoint(index2, target2.value, op.position, i, `operations[${i}].position`, moving.id)
  if (!point.ok) return fail(point.issue)

  const taken = new Set([...usedIdsOf(without, pmToIr(without).doc)])
  const inserted = insertAt(without, point.value, [movedNode], generateId, taken)
  const cleaned = isEmptyContainer(sourceContainer) ? dropContainer(inserted.doc, sourceContainer) : { doc: inserted.doc }
  return {
    ok: true,
    doc: cleaned.doc,
    effect: {
      index: i, op: 'move', inserted: [], removed: [], moved: [moving.id],
      ...(levelChanged.length > 0 ? { levelChanged } : {}),
      ...(inserted.createdContainer ? { createdContainer: inserted.createdContainer } : {}),
      ...('removed' in cleaned && cleaned.removed ? { removedContainer: cleaned.removed } : {}),
    },
    warnings: [],
  }
}

function execute(doc: PMJsonNode, op: DocumentOperation, i: number, generateId: () => string): OpResult {
  switch (op.op) {
    case 'insert': return runInsert(doc, op, i, generateId)
    case 'replace': return runReplace(doc, op, i, generateId)
    case 'delete': return runDelete(doc, op, i)
    case 'move': return runMove(doc, op, i, generateId)
  }
}

// ---------- Resolver 问题对比 ----------

function problemKey(problem: IRProblem): string {
  const id = problem.nodeId === null ? '' : problem.nodeId.startsWith(MISSING_ID_PREFIX) ? MISSING_ID_PREFIX : problem.nodeId
  return `${problem.code}\u0000${problem.severity}\u0000${id}`
}

/**
 * 标出 `after` 中哪些问题是本批新引入的。同一（代码、严重程度、节点）下先按消息精确配对，
 * 剩余的再按顺序一一配对：消息里的编号（「第 3 章」「5.1」）会随位置变化，不能因此把原有问题当成新问题。
 */
export function diffProblems(before: readonly IRProblem[], after: readonly IRProblem[]): DocumentProblem[] {
  const pool = new Map<string, string[]>()
  for (const problem of before) {
    const key = problemKey(problem)
    pool.set(key, [...(pool.get(key) ?? []), problem.message])
  }
  const matched = after.map(() => false)
  after.forEach((problem, position) => {
    const list = pool.get(problemKey(problem))
    const at = list ? list.indexOf(problem.message) : -1
    if (list && at !== -1) {
      list.splice(at, 1)
      matched[position] = true
    }
  })
  after.forEach((problem, position) => {
    if (matched[position]) return
    const list = pool.get(problemKey(problem))
    if (list && list.length > 0) {
      list.shift()
      matched[position] = true
    }
  })
  return after.map((problem, position) => ({ ...problem, introduced: !matched[position] }))
}

function newUnsupportedContent(
  before: readonly IRUnsupportedContent[], after: readonly IRUnsupportedContent[],
): IRUnsupportedContent[] {
  const key = (item: IRUnsupportedContent): string => `${item.nodeType}\u0000${item.reason}\u0000${item.nodeId ?? ''}`
  const remaining = new Map<string, number>()
  for (const item of before) remaining.set(key(item), (remaining.get(key(item)) ?? 0) + 1)
  return after.filter(item => {
    const left = remaining.get(key(item)) ?? 0
    if (left > 0) {
      remaining.set(key(item), left - 1)
      return false
    }
    return true
  })
}

// ---------- 入口 ----------

const FOLLOW_UP_CODES: ReadonlySet<DocumentOperationIssueCode> = new Set([
  'node-not-found', 'node-not-addressable', 'anchor-not-found', 'invalid-parent',
])

/**
 * 按顺序在内存中执行一批操作，全有或全无。
 *
 * - 先检查全部操作的形状（未知操作、未知字段、缺字段），再逐个执行；某个操作出错后，其余操作仍会继续检查
 *   （按「该操作未发生」处理），一次报出所有问题；后续操作若因找不到本应由失败操作创建的节点而出错，
 *   提示里会注明。只要有问题，整批不生效，返回 `{ ok: false, issues }`。
 * - 全部成功后：补根节点 `extensionVersion`（新内容含语义扩展时，规则同 irToPm）→ 宿主的 `validateContent` →
 *   `pmToIr` + `resolve`。Resolver 问题不阻止写入，连同「是否本批新引入」返回；
 *   但本批新产生的 `unsupportedContent`（文档里无法表达的内容）视为错误，整批拒绝。
 *   执行前就存在的 `unsupportedContent` 不阻止后续编辑（否则含遗留内容的文档就再也改不了），
 *   它们作为 `unsupported-content` 问题（`introduced: false`）原样返回。
 * - `replace` 的目标（或其后代）含写作片段无法表达的内容时默认拒绝（`replace-loses-content`），
 *   操作带 `acceptLoss: true` 才执行，并在 `warnings` 里留下说明；不靠事后警告兜底。
 * - 不修改入参 `pmDoc`；返回的文档与它共享未改动的子树。
 */
export function applyDocumentOperations(
  pmDoc: PMJsonNode,
  operations: unknown,
  options: ApplyDocumentOperationsOptions = {},
): ApplyDocumentOperationsResult {
  if (pmDoc === null || typeof pmDoc !== 'object' || (pmDoc.type !== 'doc' && pmDoc.type !== 'standardDoc')) {
    return {
      ok: false,
      issues: [{ path: 'document', code: 'invalid-document', reason: '文档必须是根节点为 doc 的 ProseMirror JSON' }],
    }
  }
  const parsed = parseOperations(operations)
  if (parsed.batchIssues.length > 0) return { ok: false, issues: parsed.batchIssues }

  const generateId = options.generateId ?? generateNodeId
  const issues: DocumentOperationIssue[] = []
  const effects: OperationEffect[] = []
  const warnings: DocumentOperationWarning[] = []
  const failed: number[] = []
  let doc = pmDoc

  for (const item of parsed.items) {
    if (!item.operation) {
      issues.push(...item.issues)
      failed.push(item.index)
      continue
    }
    const result = execute(doc, item.operation, item.index, generateId)
    if (result.ok) {
      doc = result.doc
      effects.push(result.effect)
      warnings.push(...result.warnings)
    } else {
      const hint = failed.length === 0 ? '' : `（注意：operations[${failed.join('], operations[')}] 已失败；如果该节点本应由它创建，请先修复它）`
      issues.push(...result.issues.map(entry =>
        hint && FOLLOW_UP_CODES.has(entry.code) ? { ...entry, reason: entry.reason + hint } : entry))
      failed.push(item.index)
    }
  }
  if (issues.length > 0) return { ok: false, issues }

  // ---- 全部操作成功后的整体检查 ----
  const finalIssues: DocumentOperationIssue[] = []
  if ((doc.content ?? []).length === 0) {
    return {
      ok: false,
      issues: [{ path: 'document', code: 'empty-document', reason: '全部操作执行后文档没有任何内容；生产文档至少需要一个节点' }],
    }
  }
  const beforeIr = pmToIr(pmDoc).doc
  let after = pmToIr(doc).doc
  if (after.extensionVersion === 1 && doc.attrs?.extensionVersion !== 1) {
    doc = { ...doc, attrs: { ...doc.attrs, extensionVersion: 1 } }
  }

  const attribute = (nodeId: string | undefined): number | undefined => {
    if (!nodeId) return undefined
    let found: number | undefined
    for (const effect of effects) if (effect.inserted.includes(nodeId) || effect.moved.includes(nodeId)) found = effect.index
    return found
  }

  if (options.validateContent) {
    const validation = options.validateContent(doc)
    if (!validation.ok) {
      const owner = attribute(validation.nodeId)
      finalIssues.push({
        ...(owner === undefined ? {} : { operationIndex: owner }),
        path: owner === undefined ? 'document' : `operations[${owner}]`,
        code: 'schema-invalid',
        reason: `操作执行后的文档未通过编辑器 schema 校验：${validation.message}${validation.path ? `（文档内位置 ${validation.path}）` : ''}`,
        ...(validation.nodeId ? { nodeId: validation.nodeId } : {}),
      })
      return { ok: false, issues: finalIssues }
    }
    if (validation.content) doc = validation.content
    after = pmToIr(doc).doc
  }

  for (const item of newUnsupportedContent(beforeIr.unsupportedContent ?? [], after.unsupportedContent ?? [])) {
    const owner = attribute(item.nodeId ?? undefined)
    finalIssues.push({
      ...(owner === undefined ? {} : { operationIndex: owner }),
      path: item.path,
      code: 'unsupported-content',
      reason: `操作使文档产生了无法表达的内容（${item.nodeType}）：${item.reason}`,
      ...(item.nodeId ? { nodeId: item.nodeId } : {}),
    })
  }
  if (finalIssues.length > 0) return { ok: false, issues: finalIssues }

  const problems = diffProblems(resolve(beforeIr).problems, resolve(after).problems)
  return { ok: true, doc, operations: effects, problems, warnings }
}

