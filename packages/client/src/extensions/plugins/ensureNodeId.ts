import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { generateNodeId } from '@ses/shared'

/**
 * 携带 nodeId 属性的块级节点类型清单。
 * 含全部自定义块级节点 + StarterKit 中可出现在 block 内容里的节点；
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
  'stdTable',
  'figure',
  'formula',
  'stdList',
  'note',
  'example',
  'appendix',
  'bibliography',
  // StarterKit 中可出现在 block 内容里的节点
  // （table 不在列表中：其 NodeView 不渲染 data-node-id，且语义节点是外层 stdTable）
  'paragraph',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
]

export interface NodeIdFix {
  pos: number
  nodeId: string
}

/**
 * 扫描文档，找出缺失或重复的 nodeId，返回待修复列表（pos → 新 ID）。
 * 重复时按文档顺序保留首个出现的 ID，后续重复者重新生成（同文档内唯一是硬约束）。
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
      if (fixes.length === 0) return null
      const tr = newState.tr
      // 仅改属性不改文档结构，pos 在本事务内保持有效
      for (const { pos, nodeId } of fixes) {
        tr.setNodeAttribute(pos, 'nodeId', nodeId)
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
