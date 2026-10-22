/**
 * 在生产 PM JSON 中定位可寻址节点，并提供不可变的编辑原语（WP9.2c1）。
 *
 * 操作直接作用于 PM JSON（设计文档 §6.3），不做整篇 IR 往返，避免 `pmToIr`/`irToPm` 往返
 * 对 IR 未覆盖的内容造成影响：只有新写入的片段经 `irFragmentToPm` 投影。
 *
 * 「可寻址」节点就是写作片段里能作为顶层元素出现的节点：章、条、附录、术语条目、参考文献条目，
 * 以及章/条/附录/前言/引言下的块（段落、列项、表、图、公式、注、示例……）。
 * 表行、单元格、列项项、术语条目里的注等是它们所属节点的一部分，不能单独寻址。
 *
 * 同构纯 TypeScript：不引用浏览器或 Node 专有 API。
 */

import { fragmentContextRules, type AuthoringContext, type PMJsonNode } from '@ses/shared'
import type { DocumentContainer, NodeKind, ParentRef } from './types'

/** 章、条、附录、参考文献的固定标题节点：它们在内容数组的最前面，不属于「子节点」。 */
export const TITLE_TYPES: ReadonlySet<string> = new Set([
  'chapterTitle', 'clauseTitle', 'appendixLabel', 'appendixTitle', 'bibliographyTitle',
])

const BLOCK_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'paragraph', 'list', 'table', 'figure', 'formula', 'note', 'example', 'warning', 'quote', 'code', 'defList',
])

/** 与 pmToIr 的 `convertBlock` 一致：哪些 PM 节点类型会读成 IR 块。 */
const BLOCK_BY_PM_TYPE: ReadonlyMap<string, NodeKind> = new Map<string, NodeKind>([
  ['stdParagraph', 'paragraph'], ['paragraph', 'paragraph'],
  ['stdList', 'list'], ['bulletList', 'list'], ['orderedList', 'list'],
  ['stdTable', 'table'], ['figure', 'figure'], ['formula', 'formula'],
  // WP8.M G7-b：块内容的注/示例读成 IR 的 note/example（pmToIr.convertBlock 同构），可整体寻址、移动、删除。
  ['note', 'note'], ['example', 'example'], ['noteBlock', 'note'], ['exampleBlock', 'example'], ['warning', 'warning'],
  ['quoteBlock', 'quote'], ['blockquote', 'quote'], ['codeBlock', 'code'],
  // WP8.M G2：缩略语表读成 IR 块 defList；写作片段不能创建它（与 warning/quote/code 同类，可删除/移动，不能整体替换）。
  ['defList', 'defList'],
])

export const KIND_LABELS: Record<NodeKind, string> = {
  chapter: '章', clause: '条', appendix: '附录', termEntry: '术语条目', bibEntry: '参考文献条目',
  paragraph: '段落', list: '列项', table: '表', figure: '图', formula: '公式', note: '注',
  example: '示例', warning: '警告块', quote: '引文块', code: '代码块', defList: '缩略语表',
}

export const CONTAINER_LABELS: Record<DocumentContainer, string> = {
  foreword: '前言', introduction: '引言', body: '正文（章序列）', appendices: '附录序列', bibliography: '参考文献',
}

/** 该种节点能否放入给定上下文（上下文必须合法）。 */
export function kindAllowedIn(kind: NodeKind, context: AuthoringContext): boolean {
  const rules = fragmentContextRules(context)
  if (BLOCK_KINDS.has(kind)) return rules.blocks
  switch (kind) {
    case 'chapter': return rules.chapter
    case 'appendix': return rules.appendix
    case 'clause': return rules.clause
    case 'termEntry': return rules.termEntry
    case 'bibEntry': return rules.bibEntry
    default: return false
  }
}

// ---------- 节点位置索引 ----------

export interface LocatedNode {
  id: string
  kind: NodeKind
  node: PMJsonNode
  /** 从根节点 `content` 出发的下标路径。 */
  path: number[]
  parent: ParentRef
  /** 在 PM 父节点 `content` 中的下标。 */
  pmIndex: number
  /** 在 IR 兄弟序列中的位置（跳过标题节点与读不成 IR 的节点）。 */
  index: number
  /** 同级节点（IR 兄弟序列）总数。 */
  siblingCount: number
  /** 替换/插入同级节点时的上下文（= 父节点的上下文）；层级超过 5 时没有。 */
  context: AuthoringContext | undefined
  /** 条在文档结构中的实际层级（章/附录下为 1，条内每深一层加 1）；非条省略。 */
  level?: number
  /** 在 {@link DocIndex.order} 中的位置。 */
  orderIndex: number
}

export interface DocIndex {
  root: PMJsonNode
  byId: Map<string, LocatedNode>
  byPath: Map<string, LocatedNode>
  /** 出现多次的 nodeId：无法定位，操作应拒绝。 */
  duplicates: Set<string>
  /** 全部可寻址节点（含没有 nodeId 的），按文档顺序（先序）。 */
  order: LocatedNode[]
  /** 各类顶层节点在 `root.content` 中的下标。 */
  rootIndices: {
    foreword: number[]
    introduction: number[]
    bibliography: number[]
    chapter: number[]
    appendix: number[]
  }
}

export const pathKey = (path: readonly number[]): string => path.join('.')

function nodeIdOf(node: PMJsonNode): string | undefined {
  const id = node.attrs?.nodeId
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

type ChildMode = 'blocks' | 'section' | 'bibliography'

function childKind(mode: ChildMode, type: string): NodeKind | undefined {
  if (mode === 'bibliography') return type === 'bibEntry' ? 'bibEntry' : undefined
  const block = BLOCK_BY_PM_TYPE.get(type)
  if (block) return block
  if (mode === 'section') {
    if (type === 'clause') return 'clause'
    if (type === 'termDef') return 'termEntry'
  }
  return undefined
}

function clauseContext(level: number): AuthoringContext | undefined {
  return level >= 1 && level <= 5 ? { parent: 'clause', level: level as 1 | 2 | 3 | 4 | 5 } : undefined
}

/** 为文档建立可寻址节点的位置索引。只描述结构，不修改文档，不依赖 IR。 */
export function indexDocument(root: PMJsonNode): DocIndex {
  const index: DocIndex = {
    root,
    byId: new Map(),
    byPath: new Map(),
    duplicates: new Set(),
    order: [],
    rootIndices: { foreword: [], introduction: [], bibliography: [], chapter: [], appendix: [] },
  }

  const add = (located: Omit<LocatedNode, 'orderIndex'>): LocatedNode => {
    const full: LocatedNode = { ...located, orderIndex: index.order.length }
    index.order.push(full)
    index.byPath.set(pathKey(full.path), full)
    if (full.id !== '') {
      if (index.byId.has(full.id)) index.duplicates.add(full.id)
      else index.byId.set(full.id, full)
    }
    return full
  }

  /** 登记 parent 的直接子节点；对条递归。 */
  const visit = (
    parentNode: PMJsonNode,
    parentPath: number[],
    parentRef: ParentRef,
    context: AuthoringContext | undefined,
    mode: ChildMode,
    childLevel: number,
  ): void => {
    const content = parentNode.content ?? []
    const kinds = content.map(child => childKind(mode, child.type))
    const siblingCount = kinds.filter(kind => kind !== undefined).length
    let position = 0
    content.forEach((child, pmIndex) => {
      const kind = kinds[pmIndex]
      if (kind === undefined) return
      const path = [...parentPath, pmIndex]
      const located = add({
        id: nodeIdOf(child) ?? '', kind, node: child, path, parent: parentRef, pmIndex,
        index: position, siblingCount, context,
        ...(kind === 'clause' ? { level: childLevel } : {}),
      })
      position += 1
      if (kind === 'clause') {
        visit(child, path, { nodeId: located.id, kind: 'clause' }, clauseContext(childLevel), 'section', childLevel + 1)
      }
    })
  }

  const rootContent = root.content ?? []
  rootContent.forEach((child, rootIndex) => {
    const path = [rootIndex]
    switch (child.type) {
      case 'foreword':
        index.rootIndices.foreword.push(rootIndex)
        visit(child, path, { container: 'foreword' }, { parent: 'foreword' }, 'blocks', 1)
        break
      case 'introduction':
        index.rootIndices.introduction.push(rootIndex)
        visit(child, path, { container: 'introduction' }, { parent: 'introduction' }, 'blocks', 1)
        break
      case 'bibliography':
        index.rootIndices.bibliography.push(rootIndex)
        visit(child, path, { container: 'bibliography' }, { parent: 'bibliography' }, 'bibliography', 1)
        break
      case 'chapter':
      case 'appendix': {
        const isChapter = child.type === 'chapter'
        const roots = isChapter ? index.rootIndices.chapter : index.rootIndices.appendix
        const located = add({
          id: nodeIdOf(child) ?? '', kind: isChapter ? 'chapter' : 'appendix', node: child, path,
          parent: { container: isChapter ? 'body' : 'appendices' }, pmIndex: rootIndex,
          index: roots.length, siblingCount: 0,
          context: { parent: isChapter ? 'body' : 'appendices' },
        })
        roots.push(rootIndex)
        visit(child, path, { nodeId: located.id, kind: isChapter ? 'chapter' : 'appendix' },
          { parent: isChapter ? 'chapter' : 'appendix' }, 'section', 1)
        break
      }
      default:
        break
    }
  })

  // 章、附录的兄弟总数要等全部登记后才知道。
  for (const located of index.order) {
    if (located.kind === 'chapter') located.siblingCount = index.rootIndices.chapter.length
    else if (located.kind === 'appendix') located.siblingCount = index.rootIndices.appendix.length
  }
  return index
}

/** 节点 `located` 的全部可寻址后代（不含自身），按文档顺序。 */
export function descendantsOf(index: DocIndex, located: LocatedNode): LocatedNode[] {
  const out: LocatedNode[] = []
  for (let i = located.orderIndex + 1; i < index.order.length; i += 1) {
    const candidate = index.order[i]!
    if (candidate.path.length <= located.path.length
      || located.path.some((segment, position) => candidate.path[position] !== segment)) break
    out.push(candidate)
  }
  return out
}

/** 节点及其后代的 nodeId（跳过没有 id 的），先序。 */
export function subtreeIds(index: DocIndex, located: LocatedNode): string[] {
  return [located, ...descendantsOf(index, located)].map(item => item.id).filter(id => id !== '')
}

export const parentPathOf = (located: LocatedNode): number[] => located.path.slice(0, -1)

/**
 * 内容数组里第一个非标题节点的下标：章/条/附录/参考文献的「开头」在标题节点之后；
 * 没有标题的容器（前言、引言）为 0。
 */
export function firstBodyIndex(content: readonly PMJsonNode[]): number {
  const found = content.findIndex(child => !TITLE_TYPES.has(child.type))
  return found === -1 ? content.length : found
}

export function nodeAtPath(root: PMJsonNode, path: readonly number[]): PMJsonNode | undefined {
  let node: PMJsonNode | undefined = root
  for (const segment of path) node = node?.content?.[segment]
  return node
}

/**
 * 节点存在但不可单独寻址时，找出它所在的最近的可寻址祖先，用于给出更有用的提示。
 * 只在报错路径上调用。
 */
export function findEnclosingAddressable(
  index: DocIndex, id: string,
): { pmType: string; ancestor?: LocatedNode } | undefined {
  const search = (node: PMJsonNode, path: number[]): { pmType: string; ancestor?: LocatedNode } | undefined => {
    if (path.length > 0 && nodeIdOf(node) === id) {
      for (let length = path.length - 1; length >= 1; length -= 1) {
        const ancestor = index.byPath.get(pathKey(path.slice(0, length)))
        if (ancestor) return { pmType: node.type, ancestor }
      }
      return { pmType: node.type }
    }
    for (const [position, child] of (node.content ?? []).entries()) {
      const found = search(child, [...path, position])
      if (found) return found
    }
    return undefined
  }
  return search(index.root, [])
}

// ---------- 不可变编辑原语 ----------

/**
 * 在 `parentPath` 指向的节点的 `content` 里做 splice，返回新根节点。
 * 只复制路径上的节点，其余子树与入参共享；入参不被修改。
 */
export function spliceAt(
  root: PMJsonNode,
  parentPath: readonly number[],
  start: number,
  deleteCount: number,
  items: readonly PMJsonNode[],
): PMJsonNode {
  const edit = (node: PMJsonNode, depth: number): PMJsonNode => {
    const content = [...(node.content ?? [])]
    if (depth === parentPath.length) {
      content.splice(start, deleteCount, ...items)
    } else {
      const position = parentPath[depth]!
      content[position] = edit(content[position]!, depth + 1)
    }
    return { ...node, content }
  }
  return edit(root, 0)
}

// ---------- 根节点顺序 ----------

/**
 * 根节点的规范顺序（与 irToPm 一致）：封面、元数据、前言、引言、章*、附录*、参考文献、索引、图资源*。
 * 生产 schema 的根节点是 `doc`（`block+`），不约束顺序，因此由引擎保证新建节点落在正确位置。
 */
const ROOT_RANK: Record<string, number> = {
  coverPage: 0, metadataBlock: 1, foreword: 2, introduction: 3, chapter: 4, appendix: 5,
  bibliography: 6, indexBlock: 7, figureResource: 8,
}

/**
 * 新建一个 `type` 类型的根节点（文档里还没有同类节点）应插入的 `root.content` 下标：
 * 紧跟在最后一个「不后于它」的已知类型节点之后；若没有，则放在第一个「后于它」的节点之前。
 * 封面里夹带的空段落等不认识的节点不参与排序。
 */
export function rootInsertIndex(root: PMJsonNode, type: keyof typeof ROOT_RANK): number {
  const rank = ROOT_RANK[type]!
  const content = root.content ?? []
  let lastNotAfter = -1
  let firstAfter = -1
  content.forEach((child, position) => {
    const other = ROOT_RANK[child.type]
    if (other === undefined) return
    if (other <= rank) lastNotAfter = position
    else if (firstAfter === -1) firstAfter = position
  })
  if (lastNotAfter !== -1) return lastNotAfter + 1
  return firstAfter !== -1 ? firstAfter : content.length
}

// ---------- nodeId 收集 ----------

/** 收集 PM 子树里所有 `attrs.nodeId`。 */
export function collectPmNodeIds(node: PMJsonNode, out: Set<string> = new Set()): Set<string> {
  const id = nodeIdOf(node)
  if (id !== undefined) out.add(id)
  for (const child of node.content ?? []) collectPmNodeIds(child, out)
  return out
}

/** 收集 IR 值里所有名为 `id` 的字符串字段（含 pmToIr 派生的 id，如 `x.p0`、行/单元格 id、脚注 id）。 */
export function collectIrIds(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectIrIds(item, out)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id' && typeof child === 'string' && child.length > 0) out.add(child)
      else collectIrIds(child, out)
    }
  }
  return out
}
