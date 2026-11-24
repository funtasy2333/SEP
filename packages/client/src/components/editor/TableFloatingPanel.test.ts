// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import TableFloatingPanel, { type TablePanelCommand } from './TableFloatingPanel.vue'

const roots: HTMLElement[] = []

afterEach(() => {
  while (roots.length) roots.pop()!.remove()
  document.body.innerHTML = ''
})

function mountPanel(initialProps: {
  inCell?: boolean
  isLandscape?: boolean
  canMergeCells?: boolean
  canSplitCell?: boolean
  canDeleteFootnoteRef?: boolean
  autoCollapse?: boolean
} = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  roots.push(root)

  const state = reactive({
    inCell: initialProps.inCell ?? true,
    isLandscape: initialProps.isLandscape ?? false,
    canMergeCells: initialProps.canMergeCells ?? false,
    canSplitCell: initialProps.canSplitCell ?? false,
    canDeleteFootnoteRef: initialProps.canDeleteFootnoteRef ?? false,
    autoCollapse: initialProps.autoCollapse ?? false,
  })
  const commands: TablePanelCommand[] = []

  const app = createApp({
    setup: () => () => h(TableFloatingPanel, {
      ...state,
      onCommand: (cmd: TablePanelCommand) => { commands.push(cmd) },
    }),
  })
  app.mount(root)

  return {
    root,
    state,
    commands,
    unmount() { app.unmount(); root.remove() },
  }
}

describe('TableFloatingPanel', () => {
  it('渲染全部分组按钮并正确触发对应 command 事件，且每个按钮都阻止 mousedown 夺取焦点', async () => {
    const mounted = mountPanel({
      inCell: true,
      isLandscape: false,
      canMergeCells: true,
      canSplitCell: true,
      canDeleteFootnoteRef: true,
    })

    try {
      const panel = mounted.root.querySelector<HTMLElement>('[data-testid="table-floating-panel"]')!
      expect(panel).not.toBeNull()
      expect(panel.classList.contains('tbar-context')).toBe(false)

      const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
      expect(buttons.length).toBeGreaterThanOrEqual(17)
      for (const btn of buttons) {
        const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        btn.dispatchEvent(mousedownEvent)
        expect(mousedownEvent.defaultPrevented, `按钮 ${btn.textContent} 必须阻止 mousedown 默认行为`).toBe(true)
      }

      const expected: Array<[string, TablePanelCommand]> = [
        ['table-panel-even-width', 'evenColWidths'],
        ['table-panel-auto-width', 'autoColWidths'],
        ['table-panel-add-row-before', 'addRowBefore'],
        ['table-panel-add-row-after', 'addRowAfter'],
        ['table-panel-add-col-before', 'addColBefore'],
        ['table-panel-add-col-after', 'addColAfter'],
        ['table-panel-delete-row', 'deleteRow'],
        ['table-panel-delete-col', 'deleteCol'],
        ['table-panel-merge-cells', 'mergeCells'],
        ['table-panel-split-cell', 'splitCell'],
        ['table-panel-add-note', 'addTableNote'],
        ['table-panel-add-footnote', 'addTableFootnote'],
        ['table-panel-ref-footnote', 'referenceTableFootnote'],
        ['table-panel-del-footnote-ref', 'deleteTableFootnoteRef'],
        ['table-panel-paragraph-after', 'paragraphAfter'],
        ['table-panel-delete-table', 'deleteTable'],
      ]

      for (const [testId, command] of expected) {
        const btn = panel.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
        expect(btn, `缺少按钮 ${testId}`).not.toBeNull()
        expect(btn.disabled).toBe(false)
        btn.click()
        expect(mounted.commands[mounted.commands.length - 1]).toBe(command)
      }
      expect(mounted.commands).toHaveLength(expected.length)
    } finally {
      mounted.unmount()
    }
  })

  it('根据 inCell / canMergeCells / canSplitCell / canDeleteFootnoteRef / isLandscape 控制禁用态与提示文案', async () => {
    const mounted = mountPanel({
      inCell: false,
      isLandscape: false,
      canMergeCells: true,
      canSplitCell: true,
      canDeleteFootnoteRef: true,
    })

    try {
      const btn = (id: string) => mounted.root.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!

      // 不在单元格内（例如光标在表题或表注行）：列宽、表后插段、删除表格可用；其余单元格操作禁用
      expect(btn('table-panel-even-width').disabled).toBe(false)
      expect(btn('table-panel-even-width').title).toContain('165 mm')
      expect(btn('table-panel-auto-width').disabled).toBe(false)
      expect(btn('table-panel-paragraph-after').disabled).toBe(false)
      expect(btn('table-panel-delete-table').disabled).toBe(false)

      expect(btn('table-panel-add-row-before').disabled).toBe(true)
      expect(btn('table-panel-add-col-after').disabled).toBe(true)
      expect(btn('table-panel-merge-cells').disabled).toBe(true)
      expect(btn('table-panel-split-cell').disabled).toBe(true)
      expect(btn('table-panel-add-note').disabled).toBe(true)
      expect(btn('table-panel-del-footnote-ref').disabled).toBe(true)

      // 进入单元格但不可合并/拆分/删除脚注标；且切换为横向表
      mounted.state.inCell = true
      mounted.state.isLandscape = true
      mounted.state.canMergeCells = false
      mounted.state.canSplitCell = false
      mounted.state.canDeleteFootnoteRef = false
      await nextTick()

      expect(btn('table-panel-even-width').title).toContain('252 mm')
      expect(btn('table-panel-add-row-before').disabled).toBe(false)
      expect(btn('table-panel-add-note').disabled).toBe(false)
      expect(btn('table-panel-add-footnote').disabled).toBe(false)
      expect(btn('table-panel-ref-footnote').disabled).toBe(false)
      expect(btn('table-panel-merge-cells').disabled).toBe(true)
      expect(btn('table-panel-split-cell').disabled).toBe(true)
      expect(btn('table-panel-del-footnote-ref').disabled).toBe(true)
    } finally {
      mounted.unmount()
    }
  })

  it('支持通过收起/展开按钮折叠为紧凑胶囊态并恢复展开', async () => {
    const mounted = mountPanel()
    try {
      const panel = mounted.root.querySelector<HTMLElement>('[data-testid="table-floating-panel"]')!
      const toggle = mounted.root.querySelector<HTMLButtonElement>('[data-testid="table-panel-toggle"]')!

      expect(panel.classList.contains('is-collapsed')).toBe(false)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(mounted.root.querySelector('[data-testid="table-panel-even-width"]')).not.toBeNull()

      toggle.click()
      await nextTick()
      expect(panel.classList.contains('is-collapsed')).toBe(true)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(mounted.root.querySelector('[data-testid="table-panel-even-width"]')).toBeNull()

      toggle.click()
      await nextTick()
      expect(panel.classList.contains('is-collapsed')).toBe(false)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(mounted.root.querySelector('[data-testid="table-panel-even-width"]')).not.toBeNull()
    } finally {
      mounted.unmount()
    }
  })

  it('窄画布（autoCollapse）下默认折叠且可按需展开，恢复宽画布时还原宽屏状态', async () => {
    const mounted = mountPanel({ autoCollapse: true })
    try {
      const panel = mounted.root.querySelector<HTMLElement>('[data-testid="table-floating-panel"]')!
      const toggle = mounted.root.querySelector<HTMLButtonElement>('[data-testid="table-panel-toggle"]')!

      // 窄画布初始收起，不遮挡右侧单元格
      expect(panel.classList.contains('is-collapsed')).toBe(true)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')

      // 窄画布下仍允许手动展开操作
      toggle.click()
      await nextTick()
      expect(panel.classList.contains('is-collapsed')).toBe(false)

      // 画布恢复宽屏后按宽屏偏好展开
      mounted.state.autoCollapse = false
      await nextTick()
      expect(panel.classList.contains('is-collapsed')).toBe(false)

      // 画布再次变窄（如打开侧栏）自动收起
      mounted.state.autoCollapse = true
      await nextTick()
      expect(panel.classList.contains('is-collapsed')).toBe(true)

      // 宽屏下用户手动收起后，经历变窄再恢复宽屏仍尊重用户的手动收起偏好
      mounted.state.autoCollapse = false
      await nextTick()
      toggle.click()
      await nextTick()
      expect(panel.classList.contains('is-collapsed')).toBe(true)

      mounted.state.autoCollapse = true
      await nextTick()
      mounted.state.autoCollapse = false
      await nextTick()
      expect(panel.classList.contains('is-collapsed')).toBe(true)
    } finally {
      mounted.unmount()
    }
  })
})
