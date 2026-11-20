import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import {
  dispatchExpandLandscapeTable,
  isEffectiveLandscapeStdTable,
} from '../../utils/landscapeTable'

export const landscapeTablePreviewPluginKey = new PluginKey('landscapeTablePreview')

const LANDSCAPE_NATIVE_WIDTH_PX = 952

/**
 * 扫描主编辑器文档中所有生效横排的 `stdTable`，在其内容开头（表网格区域之外的 wrapper 顶部）注入
 * 不可编辑的「展开编辑」按钮 decoration。
 */
function buildLandscapeExpandDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'stdTable') return true
    if (!isEffectiveLandscapeStdTable(doc, pos)) return false

    const nodeId = typeof node.attrs.nodeId === 'string' && node.attrs.nodeId ? node.attrs.nodeId : undefined
    // 插在 stdTable 内部开头（pos + 1），由 CSS 绝对定位在 .std-table-wrapper 右上角，
    // 确保不进入模型/序列化且不影响表题、表格内容流。
    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'ses-expand-landscape-btn'
          button.contentEditable = 'false'
          button.dataset.testid = 'expand-landscape-table-btn'
          if (nodeId) button.dataset.tableId = nodeId
          button.title = '在 252mm 横向宽幅弹窗中编辑此表格'
          button.textContent = '展开编辑'
          button.addEventListener('mousedown', (event) => {
            // 阻止按钮抢走 ProseMirror 选区焦点或触发编辑区拖拽
            event.preventDefault()
          })
          button.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            dispatchExpandLandscapeTable({ pos, ...(nodeId ? { nodeId } : {}) })
          })
          return button
        },
        {
          key: `expand-landscape:${nodeId ?? pos}`,
          side: -1,
          ignoreSelection: true,
        },
      ),
    )
    return false
  })
  return DecorationSet.create(doc, decorations)
}

function resetWrapperPreviewStyles(wrapper: HTMLElement): void {
  wrapper.style.removeProperty('height')
  wrapper.removeAttribute('data-landscape-scale')
  const table = wrapper.querySelector<HTMLElement>(':scope > table')
  if (table) {
    table.style.removeProperty('transform')
    table.style.removeProperty('transform-origin')
  }
}

function syncLandscapeTableScale(stdWrapper: HTMLElement): void {
  const tableWrapper = stdWrapper.querySelector<HTMLElement>(':scope > .tableWrapper')
  if (!tableWrapper) return
  const table = tableWrapper.querySelector<HTMLElement>(':scope > table')
  if (!table) {
    resetWrapperPreviewStyles(tableWrapper)
    return
  }

  const isLandscape = stdWrapper.getAttribute('data-orientation') === 'landscape'
    || Boolean(stdWrapper.closest('.std-appendix[data-orientation="landscape"]'))

  if (!isLandscape) {
    resetWrapperPreviewStyles(tableWrapper)
    return
  }

  // 在无布局的测试环境（如 happy-dom）中 clientWidth 为 0，不强行写入缩放以避免误伤
  const computed = typeof getComputedStyle === 'function' ? getComputedStyle(tableWrapper) : null
  const padX = computed
    ? (Number.parseFloat(computed.paddingLeft) || 0) + (Number.parseFloat(computed.paddingRight) || 0)
    : 0
  const containerWidth = Math.max(0, tableWrapper.clientWidth - padX - 1)
  if (containerWidth <= 0) {
    resetWrapperPreviewStyles(tableWrapper)
    return
  }

  // 先清除旧高度/缩放再读取真实未缩放宽高，以免旧状态影响测量
  const rawTableWidth = Math.max(
    LANDSCAPE_NATIVE_WIDTH_PX,
    table.offsetWidth || table.scrollWidth || LANDSCAPE_NATIVE_WIDTH_PX,
  )
  const scale = Math.min(1, containerWidth / rawTableWidth)

  if (scale >= 0.999) {
    resetWrapperPreviewStyles(tableWrapper)
    return
  }

  tableWrapper.setAttribute('data-landscape-scale', scale.toFixed(6))
  table.style.transformOrigin = 'top left'
  table.style.transform = `scale(${scale})`

  // 同步 .tableWrapper 高度为缩放后的视觉高度（加 2px padding 余量），消除底部空白
  const rawHeight = table.offsetHeight || table.getBoundingClientRect().height / scale
  if (rawHeight > 0) {
    tableWrapper.style.height = `${Math.ceil(rawHeight * scale + 2)}px`
  }
}

function createPreviewCoordinator(view: EditorView) {
  let frameId: number | null = null
  let observer: ResizeObserver | null = null
  let observedElements = new Set<Element>()
  let destroyed = false

  const syncAll = () => {
    frameId = null
    if (destroyed) return

    const allStdTables = Array.from(view.dom.querySelectorAll<HTMLElement>('.std-table-wrapper'))
    // 清理不再处于横向状态的表或已卸载元素记录
    const nextObserved = new Set<Element>([view.dom])

    for (const stdTable of allStdTables) {
      const tableWrapper = stdTable.querySelector<HTMLElement>(':scope > .tableWrapper')
      const table = tableWrapper?.querySelector<HTMLElement>(':scope > table')
      syncLandscapeTableScale(stdTable)
      if (tableWrapper) nextObserved.add(tableWrapper)
      if (table) nextObserved.add(table)
    }

    if (observer) {
      for (const el of observedElements) {
        if (!nextObserved.has(el)) observer.unobserve(el)
      }
      for (const el of nextObserved) {
        if (!observedElements.has(el)) observer.observe(el)
      }
    }
    observedElements = nextObserved
  }

  const scheduleSync = () => {
    if (destroyed) return
    if (typeof requestAnimationFrame !== 'function') {
      syncAll()
      return
    }
    if (frameId !== null) return
    frameId = requestAnimationFrame(syncAll)
  }

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      scheduleSync()
    })
    observer.observe(view.dom)
    observedElements.add(view.dom)
  }

  // 初始化即同步一次
  syncAll()

  return {
    update() {
      scheduleSync()
    },
    destroy() {
      destroyed = true
      if (frameId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameId)
        frameId = null
      }
      observer?.disconnect()
      observer = null
      observedElements.clear()
    },
  }
}

/**
 * 主编辑器横页表格预览与「展开编辑」入口插件：
 * 1. 为每个生效横向表格注入非持久化「展开编辑」按钮（Decoration.widget）。
 * 2. 将横表内部 `<table>` 按其 952px 真实坐标比例缩放到容器宽度（Option A），并同步 `.tableWrapper` 高度。
 * 3. 在弹窗独立编辑器中不启用此扩展，使横表按 1:1 真实 952px 宽度编辑。
 *
 * 注意：禁止在模块顶层或扩展配置期访问 window / document / ResizeObserver（editorSchema.node.test.ts）。
 */
export const LandscapeTablePreview = Extension.create({
  name: 'landscapeTablePreview',

  addProseMirrorPlugins() {
    let cached: { doc: PMNode; set: DecorationSet } | undefined
    return [
      new Plugin({
        key: landscapeTablePreviewPluginKey,
        props: {
          decorations(state) {
            if (cached?.doc === state.doc) return cached.set
            const set = buildLandscapeExpandDecorations(state.doc)
            cached = { doc: state.doc, set }
            return set
          },
        },
        view(view) {
          if (typeof document === 'undefined') return {}
          return createPreviewCoordinator(view)
        },
      }),
    ]
  },
})
