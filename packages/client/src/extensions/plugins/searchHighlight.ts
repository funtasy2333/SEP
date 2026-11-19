import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

/**
 * 编辑器查找（issue #76）。
 *
 * 查找只读：高亮不改正文、不改编辑器选区、不抢焦点。
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
  | { type: 'set', query: string, direction: 1 | -1 }
  | { type: 'goto', index: number }
  | { type: 'clear' }

export const searchHighlightKey = new PluginKey<SearchState>('sesSearchHighlight')

/**
 * 不可匹配的占位字符：行内叶子节点（脚注引用、行内公式、行内图、文献外链等）占一个位置；
 * 行内容器（结构化参考文献 bibStructured、字段 bibField）的起止各占一个位置，
 * 使命中不会把叶子两侧或相邻字段的文字拼在一起。
 */
const BOUNDARY = '\uFFFC'

/** 各字符及行内边界与 ProseMirror 位置一一对应。 */
function searchableText(node: PMNode): string {
  let text = ''
  node.forEach(child => {
    if (child.isText) text += child.text ?? ''
    else if (child.isLeaf) text += BOUNDARY
    else text += BOUNDARY + searchableText(child) + BOUNDARY
  })
  return text
}

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
    const text = searchableText(node)
    let index = text.indexOf(query)
    while (index !== -1) {
      const from = pos + 1 + index
      matches.push({ from, to: from + query.length })
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
    return { query: meta.query, matches, current: meta.direction === -1 ? matches.length - 1 : clampCurrent(matches, 0) }
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
  if (before.query !== query || before.matches.length === 0) {
    meta = { type: 'set', query, direction }
  } else {
    const target = before.current + direction
    wrapped = target < 0 || target >= before.matches.length
    meta = { type: 'goto', index: target }
  }
  const tr = dispatchState.state.tr.setMeta(searchHighlightKey, meta).setMeta('addToHistory', false)
  dispatchState.dispatch(tr)
  return { state: getSearchState(dispatchState.state), wrapped }
}

export function clearSearch(dispatchState: { state: EditorState, dispatch: (tr: Transaction) => void }) {
  if (!getSearchState(dispatchState.state).query) return
  dispatchState.dispatch(dispatchState.state.tr
    .setMeta(searchHighlightKey, { type: 'clear' } satisfies SearchMeta)
    .setMeta('addToHistory', false))
}

export const SEARCH_MATCH_CLASS = 'ses-search-match'
export const SEARCH_CURRENT_CLASS = 'ses-search-current'

function nativeHighlights(): HighlightRegistry | undefined {
  if (typeof CSS !== 'undefined' && typeof Highlight === 'function' && typeof StaticRange === 'function') return CSS.highlights
}

/** Keep the editor DOM intact even when a query matches thousands of paragraphs. */
function createNativeSearchView(view: EditorView, registry: HighlightRegistry) {
  const all = new Highlight()
  const current = new Highlight()
  current.priority = 1
  let previous: SearchState | undefined
  let ranges: StaticRange[] = []

  function clear() {
    if (registry.get(SEARCH_MATCH_CLASS) === all) registry.delete(SEARCH_MATCH_CLASS)
    if (registry.get(SEARCH_CURRENT_CLASS) === current) registry.delete(SEARCH_CURRENT_CLASS)
    all.clear()
    current.clear()
    ranges = []
  }

  function update(force = false) {
    const search = getSearchState(view.state)
    if (!force && search === previous) return
    if (search.matches.length === 0) {
      observer.disconnect()
      clear()
    } else {
      if (!previous?.matches.length) observer.observe(view.dom, { childList: true, characterData: true, subtree: true })
      if (force || search.matches !== previous?.matches) {
        all.clear()
        ranges = search.matches.map(({ from, to }) => {
          const start = view.domAtPos(from, 1)
          const end = view.domAtPos(to, -1)
          const range = new StaticRange({
            startContainer: start.node, startOffset: start.offset,
            endContainer: end.node, endOffset: end.offset,
          })
          all.add(range)
          return range
        })
      }
      current.clear()
      const range = ranges[search.current]
      if (range) current.add(range)
      if (registry.get(SEARCH_MATCH_CLASS) !== all) registry.set(SEARCH_MATCH_CLASS, all)
      if (registry.get(SEARCH_CURRENT_CLASS) !== current) registry.set(SEARCH_CURRENT_CLASS, current)
    }
    previous = search
  }

  // Validation decorations and node views can replace DOM without changing the document.
  const observer = new MutationObserver(() => {
    if (ranges.length) update(true)
  })
  update()
  return {
    update() {
      update(observer.takeRecords().length > 0)
    },
    destroy() {
      observer.disconnect()
      clear()
    },
  }
}

export function scrollToCurrentSearchMatch(view: EditorView) {
  if (!nativeHighlights()) {
    view.dom.querySelector<HTMLElement>(`.${SEARCH_CURRENT_CLASS}`)?.scrollIntoView?.({ block: 'center' })
    return
  }
  const search = getSearchState(view.state)
  const match = search.matches[search.current]
  const viewport = view.dom.closest<HTMLElement>('.editor-content-wrapper')
  if (!match || !viewport) return
  const rect = view.coordsAtPos(match.from, 1)
  const { node } = view.domAtPos(match.from, 1)
  const element = node instanceof HTMLElement ? node : node.parentElement
  let table = element?.closest<HTMLElement>('.tableWrapper')
  if (table) {
    const end = view.coordsAtPos(match.to, -1)
    const sameLine = end.top < rect.bottom && end.bottom > rect.top
    let left = sameLine ? Math.min(rect.left, end.left) : rect.left
    let right = Math.max(rect.right + 1, sameLine ? end.right : rect.right)
    // Wide tables scroll inside the editor viewport. Reveal the hit in each containing table.
    while (table) {
      const edge = table.getBoundingClientRect().left + table.clientLeft
      const before = table.scrollLeft
      const startOffset = left - edge
      const endOffset = right - (edge + table.clientWidth)
      table.scrollLeft += startOffset < 0 ? startOffset : Math.min(startOffset, Math.max(0, endOffset))
      const shift = table.scrollLeft - before
      left -= shift
      right -= shift
      table = table.parentElement?.closest<HTMLElement>('.tableWrapper')
    }
  }
  const center = viewport.getBoundingClientRect().top + viewport.clientTop + viewport.clientHeight / 2
  viewport.scrollTo({ top: viewport.scrollTop + (rect.top + rect.bottom) / 2 - center })
}

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
          if (!search || search.matches.length === 0 || nativeHighlights()) return null
          return DecorationSet.create(state.doc, search.matches.map((match, index) => Decoration.inline(
            match.from,
            match.to,
            { class: index === search.current ? `${SEARCH_MATCH_CLASS} ${SEARCH_CURRENT_CLASS}` : SEARCH_MATCH_CLASS },
          )))
        },
      },
      view(view) {
        const registry = nativeHighlights()
        return registry ? createNativeSearchView(view, registry) : {}
      },
    })]
  },
})
