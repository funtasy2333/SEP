import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * 编辑器查找（issue #76）。
 *
 * 查找只读：命中用装饰高亮，不改正文、不改编辑器选区、不抢焦点。
 * 旧实现把焦点移入正文并选中命中文字，查找框里的下一次回车便落进正文，
 * 替换选区并分段，造成“命中文字被删、凭空多出一段”。
 */

export interface SearchMatch { from: number, to: number }

export interface SearchState {
  query: string
  matches: SearchMatch[]
  /** 当前命中下标；没有命中时为 -1。 */
  current: number
}

type SearchMeta =
  | { type: 'set', query: string }
  | { type: 'goto', index: number }
  | { type: 'clear' }

export const searchHighlightKey = new PluginKey<SearchState>('sesSearchHighlight')

/**
 * 不可匹配的占位字符：行内叶子节点（脚注引用、行内公式、行内图、文献外链等）占一个位置；
 * 行内容器（结构化参考文献 bibStructured、字段 bibField）的起止各占一个位置，
 * 使命中不会把叶子两侧或相邻字段的文字拼在一起。
 */
const BOUNDARY = '\uFFFC'

/**
 * 在每个文本块内查找 query，匹配可以跨越不同标记（粗体、上下标等）分隔的文本节点，不跨段落、不跨行内容器边界。
 * 行内容器（非叶子的行内节点）递归收集其中的文字，位置按文档实际偏移计算。
 * 返回按文档顺序排列、互不重叠的命中区间。
 */
export function findTextMatches(doc: PMNode, query: string): SearchMatch[] {
  if (!query) return []
  const matches: SearchMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    const offsets: number[] = []
    const collect = (parent: PMNode, contentStart: number) => {
      parent.forEach((child, offset) => {
        const start = contentStart + offset
        if (child.isText) {
          const value = child.text ?? ''
          for (let index = 0; index < value.length; index += 1) offsets.push(start + index)
          text += value
        } else if (child.isLeaf) {
          offsets.push(start)
          text += BOUNDARY
        } else {
          offsets.push(start)
          text += BOUNDARY
          collect(child, start + 1)
          offsets.push(start + child.nodeSize - 1)
          text += BOUNDARY
        }
      })
    }
    collect(node, pos + 1)
    let index = text.indexOf(query)
    while (index !== -1) {
      const last = index + query.length - 1
      matches.push({ from: offsets[index]!, to: offsets[last]! + 1 })
      index = text.indexOf(query, index + query.length)
    }
    return false
  })
  return matches
}

const EMPTY: SearchState = { query: '', matches: [], current: -1 }

function clampCurrent(matches: SearchMatch[], index: number): number {
  if (matches.length === 0) return -1
  return ((index % matches.length) + matches.length) % matches.length
}

function applySearch(tr: Transaction, value: SearchState): SearchState {
  const meta = tr.getMeta(searchHighlightKey) as SearchMeta | undefined
  if (meta?.type === 'clear') return EMPTY
  if (meta?.type === 'set') {
    const matches = findTextMatches(tr.doc, meta.query)
    return { query: meta.query, matches, current: matches.length ? 0 : -1 }
  }
  if (meta?.type === 'goto') return { ...value, current: clampCurrent(value.matches, meta.index) }
  if (!tr.docChanged || !value.query) return value

  // 正文被编辑后重新查找，并尽量停留在原当前命中附近。
  const matches = findTextMatches(tr.doc, value.query)
  if (matches.length === 0) return { ...value, matches, current: -1 }
  const anchor = value.current >= 0 ? tr.mapping.map(value.matches[value.current].from) : 0
  const next = matches.findIndex((match) => match.from >= anchor)
  return { ...value, matches, current: next === -1 ? 0 : next }
}

export function getSearchState(state: EditorState): SearchState {
  return searchHighlightKey.getState(state) ?? EMPTY
}

/**
 * 查找框按回车时调用：查询词变了从头开始，未变则前进（direction=1）或后退（-1），首尾循环。
 * 只派发带 meta 的事务，不改文档、不改选区、不加入撤销历史。
 */
export function stepSearch(
  dispatchState: { state: EditorState, dispatch: (tr: Transaction) => void },
  query: string,
  direction: 1 | -1 = 1,
): { state: SearchState, wrapped: boolean } {
  const before = getSearchState(dispatchState.state)
  let wrapped = false
  let meta: SearchMeta
  if (before.query !== query) {
    meta = { type: 'set', query }
  } else if (before.matches.length === 0) {
    // 正文可能已改动，按同一查询词重新查找。
    meta = { type: 'set', query }
  } else {
    const target = before.current + direction
    wrapped = target < 0 || target >= before.matches.length
    meta = { type: 'goto', index: target }
  }
  const tr = dispatchState.state.tr.setMeta(searchHighlightKey, meta).setMeta('addToHistory', false)
  dispatchState.dispatch(tr)
  const after = getSearchState(dispatchState.state)
  if (meta.type === 'set' && direction === -1 && after.matches.length > 0) {
    // 新查询按 Shift+Enter：直接定位到最后一处。
    dispatchState.dispatch(dispatchState.state.tr
      .setMeta(searchHighlightKey, { type: 'goto', index: after.matches.length - 1 } satisfies SearchMeta)
      .setMeta('addToHistory', false))
    return { state: getSearchState(dispatchState.state), wrapped }
  }
  return { state: after, wrapped }
}

export function clearSearch(dispatchState: { state: EditorState, dispatch: (tr: Transaction) => void }) {
  if (!getSearchState(dispatchState.state).query) return
  dispatchState.dispatch(dispatchState.state.tr
    .setMeta(searchHighlightKey, { type: 'clear' } satisfies SearchMeta)
    .setMeta('addToHistory', false))
}

export const SEARCH_MATCH_CLASS = 'ses-search-match'
export const SEARCH_CURRENT_CLASS = 'ses-search-current'

export const SearchHighlight = Extension.create({
  name: 'sesSearchHighlight',

  addProseMirrorPlugins() {
    return [new Plugin<SearchState>({
      key: searchHighlightKey,
      state: {
        init: () => EMPTY,
        apply: applySearch,
      },
      props: {
        decorations(state) {
          const search = searchHighlightKey.getState(state)
          if (!search || search.matches.length === 0) return null
          return DecorationSet.create(state.doc, search.matches.map((match, index) => Decoration.inline(
            match.from,
            match.to,
            { class: index === search.current ? `${SEARCH_MATCH_CLASS} ${SEARCH_CURRENT_CLASS}` : SEARCH_MATCH_CLASS },
          )))
        },
      },
    })]
  },
})
