import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { generateNodeId } from '@ses/shared'

/**
 * 携带 nodeId 属性的生产节点类型清单。
 * 除块级实体外，也包括拥有稳定 IR ID 的行内 atom 和结构化文献实体；
 * 清单中未注册到 schema 的类型名会被 Tiptap 忽略，无副作用。
 */
export const NODE_ID_TYPES = [
  // 自定义块级节点
  'coverPage',
  'foreword',
  'introduction',
  'chapter',
  'clause',
  'stdParagraph',
  'termDef',
  // termDefinition itself maps to the first IR definition paragraph entity.
  'termDefinition',
  'stdTable',
  'tableFootnoteEntry',
  'figure',
  'formula',
  'stdList',
  'note',
  'example',
  'appendix',
  'bibliography',
  // Structured document metadata records (metadataBlock is a non-semantic container).
  'titlePart',
  'standardIdentifier',
  'identifierPart',
  'language',
  'publisher',
  'adoption',
  'replacedStandard',
  'copyright',
  // TBX language sets, term groups, variants and descriptors.
  'tbxLangSet',
  'tbxTig',
  'tbxTermVariant',
  'tbxTermDescriptor',
  // Formula semantic records (formulaInline is a referenceable inline atom).
  'formulaInline',
  'formulaNote',
  'whereItem',
  // Figure/resource and typed bibliography semantic records.
  'figureGroup',
  'figureDescription',
  'figureResource',
  'bibField',
  'bibIdentifier',
  // Index and prose-role blocks.
  'indexBlock',
  'indexGroup',
  'indexEntry',
  'warning',
  'quoteBlock',
  'codeBlock',
  // 块级容器内的可引用子节点（IR 类型中带 id，需稳定锚点供 WP3 pmToIr 使用）；
  // 表格行/单元格与公式 whereList 项的 ID 来源策略在 WP3 设计时确定
  'stdListItem',
  'bibEntry',
  // Resolver assigns stable IDs to table rows/cells as well as their semantic table wrapper.
  'tableRow',
  'tableCell',
  'tableHeader',
  // StarterKit 中可出现在 block 内容里的节点
  // （table 不在列表中：其 NodeView 不渲染 data-node-id，且语义节点是外层 stdTable）
  'paragraph',
  'blockquote',
  'bulletList',
  'orderedList',
  'horizontalRule',
  'listItem',
  // Inline footnote references have document-wide stable identities for labels and XML round trips.
  'footnoteRef',
  'tableFootnoteRef',
]

export interface NodeIdFix {
  pos: number
  nodeId: string
}

/**
 * 扫描文档，找出缺失或重复的 nodeId，返回待修复列表（pos → 新 ID）。
 * 重复时按文档顺序保留首个出现的 ID，后续重复者重新生成（同文档内唯一是硬约束）。
 * 已知限制：保留的是"文档顺序首个"而非"原节点"——粘贴位置在原节点之前时，
 * 副本继承原 ID、原节点被换新 ID。对唯一性无影响；若未来按 nodeId 锚定批注，
 * 需 diff 事务前后状态才能区分原件，本期不做。
 * 纯函数，便于单测。
 */
export function findNodeIdFixes(doc: PMNode): NodeIdFix[] {
  const seen = new Set<string>()
  const fixes: NodeIdFix[] = []
  doc.descendants((node, pos) => {
    if (!('nodeId' in node.attrs)) return
    const id = node.attrs.nodeId
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id)
      return
    }
    let newId = generateNodeId()
    while (seen.has(newId)) newId = generateNodeId()
    seen.add(newId)
    fixes.push({ pos, nodeId: newId })
  })
  return fixes
}

/**
 * When ProseMirror pastes a complete table with table-footnote definitions, NodeId repairs the
 * copied entry IDs. Remap that table's copied references with them so each copied table remains
 * self-contained. A duplicate definition inside one table is ambiguous, so leave its references
 * untouched and let the shared resolver report the invalid/unreferenced IDs.
 */
function findCopiedTableFootnoteTargets(doc: PMNode, fixes: NodeIdFix[]): Array<{ pos: number; targetId: string }> {
  const fixPositions = new Set(fixes.map((fix) => fix.pos))
  const seen = new Set<string>()
  const remapsByTable = new Map<number, Map<string, string>>()

  doc.descendants((node, pos) => {
    if (!('nodeId' in node.attrs)) return
    const id = node.attrs.nodeId
    const duplicated = typeof id === 'string' && id.length > 0 && seen.has(id)
    if (typeof id === 'string' && id.length > 0) seen.add(id)
    if (node.type.name !== 'tableFootnoteEntry' || !duplicated || !fixPositions.has(pos)) return

    const $pos = doc.resolve(pos + 1)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name !== 'stdTable') continue
      const table = $pos.node(depth)
      const tablePos = $pos.before(depth)
      let matchingEntries = 0
      table.descendants((child) => {
        if (child.type.name === 'tableFootnoteEntry' && child.attrs.nodeId === id) matchingEntries += 1
      })
      if (matchingEntries !== 1) return
      const targetRemaps = remapsByTable.get(tablePos) ?? new Map<string, string>()
      targetRemaps.set(id, fixes.find((fix) => fix.pos === pos)!.nodeId)
      remapsByTable.set(tablePos, targetRemaps)
      return
    }
  })

  const targetFixes: Array<{ pos: number; targetId: string }> = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'tableFootnoteRef' || typeof node.attrs.targetId !== 'string') return
    const $pos = doc.resolve(pos + 1)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name !== 'stdTable') continue
      const targetId = remapsByTable.get($pos.before(depth))?.get(node.attrs.targetId)
      if (targetId) targetFixes.push({ pos, targetId })
      return
    }
  })
  return targetFixes
}

export const ensureNodeIdPluginKey = new PluginKey('ensureNodeId')

/**
 * 事务后扫描文档，给缺 nodeId 的块级节点补 ID，并重新生成重复 ID
 * （粘贴会复制 data-node-id，必须去重）。
 */
export function ensureNodeIdPlugin(): Plugin {
  return new Plugin({
    key: ensureNodeIdPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const fixes = findNodeIdFixes(newState.doc)
      const targetFixes = findCopiedTableFootnoteTargets(newState.doc, fixes)
      if (fixes.length === 0 && targetFixes.length === 0) return null
      const tr = newState.tr
      // 仅改属性不改文档结构，pos 在本事务内保持有效
      for (const { pos, nodeId } of fixes) {
        tr.setNodeAttribute(pos, 'nodeId', nodeId)
      }
      for (const { pos, targetId } of targetFixes) {
        tr.setNodeAttribute(pos, 'targetId', targetId)
      }
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
}

/**
 * NodeId 扩展：
 * - 给全部块级节点注册 `nodeId` 属性，renderHTML 写 `data-node-id`，parseHTML 读回；
 * - 拆分节点时新节点不继承 nodeId（keepOnSplit: false），由插件补新 ID；
 * - onCreate 时对初始文档补齐（旧文档打开自动补 ID）。
 */
export const NodeId = Extension.create({
  name: 'nodeId',

  addGlobalAttributes() {
    return [
      {
        types: NODE_ID_TYPES,
        attributes: {
          nodeId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute('data-node-id'),
            renderHTML: (attributes) =>
              attributes.nodeId ? { 'data-node-id': attributes.nodeId } : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [ensureNodeIdPlugin()]
  },

  onCreate() {
    const { state, view } = this.editor
    const fixes = findNodeIdFixes(state.doc)
    if (fixes.length === 0) return
    const tr = state.tr
    for (const { pos, nodeId } of fixes) {
      tr.setNodeAttribute(pos, 'nodeId', nodeId)
    }
    tr.setMeta('addToHistory', false)
    view.dispatch(tr)
  },
})
