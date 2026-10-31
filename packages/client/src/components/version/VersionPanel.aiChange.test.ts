// @vitest-environment happy-dom
import { createApp, h, nextTick, reactive } from 'vue'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VersionPanel from './VersionPanel.vue'

const mocks = vi.hoisted(() => ({
  versionStore: null as any,
  documentStore: {
    currentDocument: { stage: 'working_draft' },
    updateDocument: vi.fn(),
  },
}))

vi.mock('@/stores/version', () => ({ useVersionStore: () => mocks.versionStore }))
vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.documentStore }))

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

/** 前言里依次排列的若干段落，足以在差异里区分「修改处」与「未变内容」。 */
function docWith(...texts: string[]) {
  return {
    type: 'doc',
    content: [{
      type: 'foreword',
      content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    }],
  }
}

const paragraphs = Array.from({ length: 10 }, (_, index) => `原有第${index + 1}段`)
const baseContent = docWith(...paragraphs)
const afterAi = docWith(...paragraphs.slice(0, 5), 'AI 新增的一条', ...paragraphs.slice(5))

const listItem = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  documentId: 17,
  versionNo: `1.${id}`,
  stage: 'working_draft',
  createdAt: '2026-10-07T00:00:00.000Z',
  content: docWith(`版本${id}`),
  source: 'human',
  client: null,
  ...extra,
})

interface MountOptions {
  versions?: any[]
  details?: Record<number, any>
  setContent?: (content: Record<string, unknown>) => void
  onClose?: () => void
}

async function mountPanel(options: MountOptions = {}) {
  const versions = options.versions ?? [
    listItem(3, { source: 'ai', client: 'claude-code', note: 'AI 修改：插入 1 处' }),
    listItem(2),
  ]
  const details: Record<number, any> = options.details ?? {
    3: { ...versions[0], content: afterAi, baseContent },
  }
  mocks.versionStore = reactive({
    loading: false,
    sortedVersions: versions,
    versions: [...versions],
    fetchVersions: vi.fn().mockResolvedValue(undefined),
    fetchVersion: vi.fn(async (id: number) => {
      if (!(id in details)) throw new Error(`no detail ${id}`)
      return details[id]
    }),
    getNextVersionNo: vi.fn(() => '1.4'),
    createVersion: vi.fn(),
  })
  const setContent = options.setContent ?? vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(VersionPanel, {
      documentId: 17,
      getContent: () => ({ type: 'doc', content: [] }),
      getDoc: () => null,
      setContent,
      onClose: options.onClose,
    }),
  })
  app.use(ElementPlus).mount(root)
  await flushMicrotasks()
  return {
    root,
    setContent: setContent as ReturnType<typeof vi.fn>,
    store: mocks.versionStore,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

type Panel = Awaited<ReturnType<typeof mountPanel>>

const items = (panel: Panel) => [...panel.root.querySelectorAll<HTMLElement>('.version-item')]
const itemFor = (panel: Panel, versionNo: string) =>
  items(panel).find((item) => item.querySelector('.version-no')?.textContent?.trim() === `v${versionNo}`)!
const buttonLabels = (item: HTMLElement) =>
  [...item.querySelectorAll('.version-actions button')].map((button) => button.textContent?.trim())
const diffDialog = () => document.body.querySelector<HTMLElement>('.diff-dialog')
function clickIn(container: ParentNode, label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`找不到按钮：${label}`)
  button.click()
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('AI 修改的版本条目', () => {
  it('标签明确写「AI 修改」，并显示写入方与备注；人工版本不加标签', async () => {
    const panel = await mountPanel()
    try {
      const ai = itemFor(panel, '1.3')
      expect(ai.querySelector('.version-source-tag')!.textContent!.trim()).toBe('AI 修改')
      expect(ai.dataset.source).toBe('ai')
      expect(ai.classList.contains('is-ai')).toBe(true)
      expect(ai.querySelector('.version-client')!.textContent).toContain('claude-code')
      expect(ai.querySelector('.version-note')!.textContent).toContain('AI 修改：插入 1 处')

      const human = itemFor(panel, '1.2')
      expect(human.querySelector('.version-source-tag')).toBeNull()
      expect(human.querySelector('.version-client')).toBeNull()
      expect(human.classList.contains('is-ai')).toBe(false)
    } finally {
      panel.unmount()
    }
  })
})

describe('探测写入前内容：旧数据不显示 AI 修改的操作', () => {
  it('详情带 baseContent 的 AI 版本显示「查看本次修改」「回滚到修改前」；人工版本没有，也不会被探测', async () => {
    const panel = await mountPanel()
    try {
      expect(buttonLabels(itemFor(panel, '1.3'))).toEqual(['预览', '回滚', '查看本次修改', '回滚到修改前'])
      expect(buttonLabels(itemFor(panel, '1.2'))).toEqual(['预览', '回滚'])
      // 只探测 AI 版本
      expect(panel.store.fetchVersion).toHaveBeenCalledTimes(1)
      expect(panel.store.fetchVersion).toHaveBeenCalledWith(3)
    } finally {
      panel.unmount()
    }
  })

  it('没有 baseContent 的旧数据（含 source=ai 但详情里没有写入前内容）不显示这两个操作', async () => {
    const versions = [
      listItem(5, { source: 'ai', client: 'legacy', note: 'AI 写入前的快照' }),
      listItem(4, { source: 'ai', client: 'claude-code' }),
    ]
    const panel = await mountPanel({
      versions,
      details: {
        5: { ...versions[0], baseContent: null },
        4: { ...versions[1], baseContent },
      },
    })
    try {
      // 标签仍然是「AI 修改」，但只有 4 提供查看/回滚修改前
      expect(itemFor(panel, '1.5').querySelector('.version-source-tag')!.textContent!.trim()).toBe('AI 修改')
      expect(buttonLabels(itemFor(panel, '1.5'))).toEqual(['预览', '回滚'])
      expect(buttonLabels(itemFor(panel, '1.4'))).toEqual(['预览', '回滚', '查看本次修改', '回滚到修改前'])
    } finally {
      panel.unmount()
    }
  })

  it('探测失败时不显示操作，也不影响其他功能；后台刷新后新出现的 AI 版本会被探测', async () => {
    const panel = await mountPanel({
      versions: [listItem(3, { source: 'ai', client: 'claude-code' })],
      details: {}, // 详情读取失败
    })
    try {
      expect(buttonLabels(itemFor(panel, '1.3'))).toEqual(['预览', '回滚'])

      // 收到 AI 写入的推送后，编辑器刷新版本列表：新的 AI 版本出现并被探测
      const added = listItem(4, { source: 'ai', client: 'playwright', note: 'AI 修改：插入 1 处' })
      panel.store.sortedVersions = [added, ...panel.store.sortedVersions]
      ;(panel.store.fetchVersion as ReturnType<typeof vi.fn>).mockImplementation(async (id: number) => {
        if (id === 4) return { ...added, content: afterAi, baseContent }
        throw new Error('still failing')
      })
      await flushMicrotasks()
      expect(buttonLabels(itemFor(panel, '1.4'))).toEqual(['预览', '回滚', '查看本次修改', '回滚到修改前'])
      // 失败过的 3 在列表变化时重试，仍失败则保持隐藏
      expect(buttonLabels(itemFor(panel, '1.3'))).toEqual(['预览', '回滚'])
    } finally {
      panel.unmount()
    }
  })
})

describe('查看本次修改', () => {
  it('用 baseContent → content 做差异，只含这批 AI 修改：新增 1 行、无删除，远处未变内容折叠', async () => {
    const panel = await mountPanel()
    try {
      panel.store.fetchVersion.mockClear()
      clickIn(itemFor(panel, '1.3'), '查看本次修改')
      await flushMicrotasks()

      // 差异基于详情（含 baseContent）
      expect(panel.store.fetchVersion).toHaveBeenCalledWith(3)
      const dialog = diffDialog()!
      expect(dialog.textContent).toContain('本次 AI 修改')
      const header = dialog.querySelector('[data-testid="ai-change-header"]')!.textContent!
      expect(header).toContain('修改前')
      expect(header).toContain('修改后')
      expect(header).toContain('v1.3')
      expect(header).toContain('AI 修改')
      expect(header).toContain('claude-code')
      expect(dialog.textContent).toContain('AI 修改：插入 1 处')

      const added = [...dialog.querySelectorAll('.diff-line.added')]
      const removed = [...dialog.querySelectorAll('.diff-line.removed')]
      expect(added.map((line) => line.querySelector('.line-text')!.textContent!.trim())).toEqual(['AI 新增的一条'])
      expect(removed).toHaveLength(0)
      expect(dialog.querySelector('.stat-added')!.textContent).toContain('+1')
      expect(dialog.querySelector('.stat-removed')!.textContent).toContain('-0')

      // 只保留修改处上下各 2 行，其余折叠
      const shown = [...dialog.querySelectorAll('.diff-line:not(.skipped) .line-text')].map((line) => line.textContent!.trim())
      expect(shown).toEqual(['原有第4段', '原有第5段', 'AI 新增的一条', '原有第6段', '原有第7段'])
      const skipped = [...dialog.querySelectorAll('.diff-line.skipped')].map((line) => line.textContent!.trim())
      expect(skipped).toHaveLength(2)
      expect(skipped.every((text) => text.includes('省略'))).toBe(true)
    } finally {
      panel.unmount()
    }
  })

  it('取消「仅显示修改处及上下文」后显示全部行', async () => {
    const panel = await mountPanel()
    try {
      clickIn(itemFor(panel, '1.3'), '查看本次修改')
      await flushMicrotasks()
      const dialog = diffDialog()!
      dialog.querySelector<HTMLInputElement>('.el-checkbox input')!.click()
      await flushMicrotasks()
      expect(dialog.querySelectorAll('.diff-line.skipped')).toHaveLength(0)
      expect(dialog.querySelectorAll('.diff-line.unchanged').length).toBeGreaterThanOrEqual(10)
      expect(dialog.querySelectorAll('.diff-line.added')).toHaveLength(1)
    } finally {
      panel.unmount()
    }
  })

  it('点击时详情里已没有 baseContent：提示并撤下这两个操作，不打开差异', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
    const panel = await mountPanel()
    try {
      panel.store.fetchVersion.mockResolvedValueOnce({ ...listItem(3, { source: 'ai' }), baseContent: null })
      clickIn(itemFor(panel, '1.3'), '查看本次修改')
      await flushMicrotasks()
      expect(String(warning.mock.calls[0]?.[0])).toContain('没有保存修改前的内容')
      expect(diffDialog()?.closest<HTMLElement>('.el-overlay')?.style.display ?? 'none').toBe('none')
      expect(buttonLabels(itemFor(panel, '1.3'))).toEqual(['预览', '回滚'])
    } finally {
      panel.unmount()
    }
  })

  it('读取详情失败时提示错误，不打开差异', async () => {
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    const panel = await mountPanel()
    try {
      panel.store.fetchVersion.mockRejectedValueOnce(new Error('network unavailable'))
      clickIn(itemFor(panel, '1.3'), '查看本次修改')
      await flushMicrotasks()
      expect(String(error.mock.calls[0]?.[0])).toContain('加载本次修改失败')
    } finally {
      panel.unmount()
    }
  })

  it('两版本比较保持原样：全部行显示，不折叠，也没有 AI 修改的页眉', async () => {
    const panel = await mountPanel()
    try {
      const [first, second] = items(panel)
      first!.querySelector<HTMLInputElement>('.el-checkbox input')!.click()
      second!.querySelector<HTMLInputElement>('.el-checkbox input')!.click()
      await flushMicrotasks()
      clickIn(panel.root, '比对选中的两个版本')
      await flushMicrotasks()
      const dialog = diffDialog()!
      expect(dialog.textContent).toContain('版本差异比对')
      expect(dialog.querySelector('[data-testid="ai-change-header"]')).toBeNull()
      expect(dialog.querySelectorAll('.diff-line.skipped')).toHaveLength(0)
      expect(dialog.querySelectorAll('.diff-line').length).toBeGreaterThan(0)
    } finally {
      panel.unmount()
    }
  })
})

describe('回滚到修改前', () => {
  it('二次确认后把编辑器内容设为 baseContent，提示并关闭面板', async () => {
    const onClose = vi.fn()
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as any)
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const panel = await mountPanel({ onClose })
    try {
      confirm.mockResolvedValueOnce(undefined as any)
      clickIn(itemFor(panel, '1.3'), '回滚到修改前')
      await flushMicrotasks()

      expect(confirm).toHaveBeenCalledOnce()
      const [message, title, options] = confirm.mock.calls[0]! as [string, string, Record<string, unknown>]
      expect(title).toBe('回滚确认')
      expect(message).toContain('AI 修改（v1.3）之前')
      expect(message).toContain('人工编辑')
      expect(options).toMatchObject({ type: 'warning', confirmButtonText: '确定回滚', cancelButtonText: '取消' })

      expect(panel.setContent).toHaveBeenCalledOnce()
      expect(panel.setContent).toHaveBeenCalledWith(baseContent)
      expect(success).toHaveBeenCalledWith('已回滚到 AI 修改（v1.3）之前')
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      panel.unmount()
    }
  })

  it('取消确认：不读取详情、不改动编辑器，也不报错', async () => {
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
    const panel = await mountPanel()
    try {
      panel.store.fetchVersion.mockClear()
      clickIn(itemFor(panel, '1.3'), '回滚到修改前')
      await flushMicrotasks()
      expect(confirm).toHaveBeenCalledOnce()
      expect(panel.store.fetchVersion).not.toHaveBeenCalled()
      expect(panel.setContent).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    } finally {
      panel.unmount()
    }
  })

  it('确认后详情里没有 baseContent：提示，不改动编辑器', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce(undefined as any)
    const panel = await mountPanel()
    try {
      panel.store.fetchVersion.mockResolvedValueOnce({ ...listItem(3, { source: 'ai' }), baseContent: null })
      clickIn(itemFor(panel, '1.3'), '回滚到修改前')
      await flushMicrotasks()
      expect(panel.setContent).not.toHaveBeenCalled()
      expect(String(warning.mock.calls[0]?.[0])).toContain('没有保存修改前的内容')
    } finally {
      panel.unmount()
    }
  })

  it('设置内容失败（如内容不符合编辑器 schema）：提示回滚失败，面板保持打开', async () => {
    const onClose = vi.fn()
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce(undefined as any)
    const panel = await mountPanel({
      onClose,
      setContent: () => { throw new Error('Invalid content for node') },
    })
    try {
      clickIn(itemFor(panel, '1.3'), '回滚到修改前')
      await flushMicrotasks()
      expect(String(error.mock.calls[0]?.[0])).toContain('回滚失败')
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      panel.unmount()
    }
  })

  it('人工版本的「回滚」仍回滚到该版本自己的内容', async () => {
    vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as any)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce(undefined as any)
    const panel = await mountPanel()
    try {
      clickIn(itemFor(panel, '1.2'), '回滚')
      await flushMicrotasks()
      expect(panel.setContent).toHaveBeenCalledWith(docWith('版本2'))
    } finally {
      panel.unmount()
    }
  })
})

describe('.ses 导入记录', () => {
  const beforeImport = docWith(...paragraphs)
  const afterImport = docWith(...paragraphs.slice(0, 2), '对方修改后的第3段', ...paragraphs.slice(3))
  const importItem = listItem(4, { source: 'import', note: '导入 .ses 文档包' })
  const options = () => ({
    versions: [importItem, listItem(2)],
    details: { 4: { ...importItem, content: afterImport, baseContent: beforeImport } },
  })

  it('标签为「导入 .ses」，并提供「查看本次修改」「回滚到修改前」', async () => {
    const panel = await mountPanel(options())
    try {
      const item = itemFor(panel, '1.4')
      expect(item.querySelector('.version-source-tag')!.textContent!.trim()).toBe('导入 .ses')
      expect(item.classList.contains('is-ai')).toBe(false)
      expect(buttonLabels(item)).toEqual(['预览', '回滚', '查看本次修改', '回滚到修改前'])
    } finally {
      panel.unmount()
    }
  })

  it('查看本次修改：导入前的本地正文 → 导入后的正文', async () => {
    const panel = await mountPanel(options())
    try {
      clickIn(itemFor(panel, '1.4'), '查看本次修改')
      await flushMicrotasks()
      const dialog = diffDialog()!
      expect(dialog.textContent).toContain('本次导入修改')
      expect(dialog.querySelector('[data-testid="ai-change-header"]')!.textContent).toContain('导入前的本地正文')
      expect(dialog.querySelectorAll('.diff-line.added')).toHaveLength(1)
      expect(dialog.querySelectorAll('.diff-line.removed')).toHaveLength(1)
      expect(dialog.querySelector('.diff-line.added')!.textContent).toContain('对方修改后的第3段')
    } finally {
      panel.unmount()
    }
  })

  it('回滚到修改前：确认后把编辑器内容设为导入前的本地正文', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as any)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValueOnce(undefined as any)
    const panel = await mountPanel(options())
    try {
      clickIn(itemFor(panel, '1.4'), '回滚到修改前')
      await flushMicrotasks()
      expect(String(confirm.mock.calls[0]![0])).toContain('回滚到导入（v1.4）之前')
      expect(panel.setContent).toHaveBeenCalledWith(beforeImport)
      expect(success).toHaveBeenCalledWith('已回滚到导入（v1.4）之前')
    } finally {
      panel.unmount()
    }
  })
})

describe('保存版本的版本号建议', () => {
  it('列表在面板打开期间被刷新后，没手动改过的版本号按最新列表重新建议；手动改过的保留', async () => {
    const panel = await mountPanel()
    try {
      expect(panel.store.getNextVersionNo).toHaveBeenCalledTimes(1)
      panel.store.getNextVersionNo.mockReturnValue('1.5')
      clickIn(panel.root, '保存版本')
      await flushMicrotasks()
      expect(document.body.querySelector<HTMLInputElement>('.el-dialog input')!.value).toBe('1.5')

      // 手动改过则不再覆盖
      const input = document.body.querySelector<HTMLInputElement>('.el-dialog input')!
      input.value = '2.0'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await flushMicrotasks()
      panel.store.getNextVersionNo.mockReturnValue('1.6')
      clickIn(document.body.querySelector<HTMLElement>('.el-dialog__footer')!, '取消')
      await flushMicrotasks()
      clickIn(panel.root, '保存版本')
      await flushMicrotasks()
      expect(document.body.querySelector<HTMLInputElement>('.el-dialog input')!.value).toBe('2.0')
    } finally {
      panel.unmount()
    }
  })
})
