import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'

/** `stdTable` 内网格节点 `table` 的列数（含 colspan / rowspan 占位）；结构残缺时返回 null。 */
export function stdTableGridWidth(stdTable: PMNode): number | null {
  let grid: PMNode | null = null
  stdTable.forEach((child) => {
    if (grid === null && child.type.name === 'table') grid = child
  })
  if (grid === null) return null
  try {
    return TableMap.get(grid).width
  } catch {
    return null
  }
}

function columnsLength(stdTable: PMNode): number | null {
  const columns = stdTable.attrs.columns
  return Array.isArray(columns) ? columns.length : null
}

function nodeIdOf(node: PMNode): string | null {
  const id = node.attrs.nodeId
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * 列数变化时清空 `stdTable.columns`（WP8.M G8，D-M-11，M-6.1-03）。
 *
 * `columns` 是导入稿给出的名义列宽，长度必须等于网格列数。用户对表做“插入列 / 删除列 / 合并单元格”后，
 * 名义列宽与新的列已无法一一对应；若不处理，文档会永久带着列数不符的 `columns`，pmToIr 把它记为 unsupportedContent，
 * 所有非 JSON 导出随即被阻断，而本阶段没有任何修复入口。因此把它置为 null（退回自动列宽）。
 *
 * 触发条件刻意收窄为“这次修改让列数变了，并且此后 `columns` 与列数不符”，按 nodeId 对应新旧两个表：
 * - 载入文档、版本回滚等整篇替换不会命中（新文档里的表没有“修改前”的同 id 对应物，或列数未变）；
 * - 载入时就已列数不符的坏数据保持原样，继续由 pmToIr 的诊断阻断导出，不被悄悄“修好”；
 * - 同一事务内直接改写 `columns` 本身而列数未变的情况同样不处理，交给诊断。
 * 追加的事务与原事务属于同一个撤销组：撤销“插入列”会同时还原 `columns`。
 */
export const TableColumnsSync = Extension.create({
  name: 'tableColumnsSync',

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null
        const start = oldState.doc.content.findDiffStart(newState.doc.content)
        if (start === null || start === undefined) return null
        const end = oldState.doc.content.findDiffEnd(newState.doc.content)
        if (!end) return null

        const before = new Map<string, number | null>()
        oldState.doc.nodesBetween(start, Math.max(start, end.a), (node) => {
          if (node.type.name !== 'stdTable') return true
          const id = nodeIdOf(node)
          if (id !== null) before.set(id, stdTableGridWidth(node))
          return true
        })
        if (before.size === 0) return null

        const stale: Array<{ pos: number; node: PMNode }> = []
        newState.doc.nodesBetween(start, Math.max(start, end.b), (node, pos) => {
          if (node.type.name !== 'stdTable') return true
          const id = nodeIdOf(node)
          const length = columnsLength(node)
          if (id === null || length === null || !before.has(id)) return true
          const width = stdTableGridWidth(node)
          if (width !== null && width !== before.get(id) && length !== width) stale.push({ pos, node })
          return true
        })
        if (stale.length === 0) return null

        const transaction = newState.tr
        for (const { pos, node } of stale) transaction.setNodeMarkup(pos, undefined, { ...node.attrs, columns: null })
        return transaction
      },
    })]
  },
})
