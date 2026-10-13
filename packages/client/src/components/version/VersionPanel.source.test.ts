// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import VersionPanel from './VersionPanel.vue'

const mocks = vi.hoisted(() => ({
  versionStore: {
    loading: false,
    sortedVersions: [] as any[],
    versions: [] as any[],
    fetchVersions: vi.fn(),
    fetchVersion: vi.fn(),
    getNextVersionNo: vi.fn(() => '1.3'),
    createVersion: vi.fn(),
  },
  documentStore: {
    currentDocument: { stage: 'working_draft' },
    updateDocument: vi.fn(),
  },
}))

vi.mock('@/stores/version', () => ({ useVersionStore: () => mocks.versionStore }))
vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.documentStore }))

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

const version = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  versionNo: `1.${id}`,
  stage: 'working_draft',
  createdAt: '2026-10-07T00:00:00.000Z',
  content: { type: 'doc', content: [] },
  ...extra,
})

async function mountPanel(onConflict = vi.fn()) {
  mocks.versionStore.loading = false
  mocks.versionStore.sortedVersions = [
    version(3, { source: 'import', client: null }),
    version(2, { source: 'ai', client: 'claude-code', note: 'AI 写入前的快照' }),
    version(1, { source: 'human', client: null }),
    version(0), // 旧数据：没有 source 字段
  ]
  mocks.versionStore.versions = [...mocks.versionStore.sortedVersions]
  mocks.versionStore.fetchVersions.mockReset().mockResolvedValue(undefined)
  mocks.versionStore.createVersion.mockReset().mockResolvedValue({})
  mocks.documentStore.updateDocument.mockReset()

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(VersionPanel, {
      documentId: 17,
      getContent: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }),
      getDoc: () => null,
      setContent: vi.fn(),
      onConflict,
    }),
  })
  app.use(ElementPlus).mount(root)
  await flushMicrotasks()
  return {
    root,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

it('非人工来源的版本显示来源标签（AI / 导入），人工与旧数据不显示', async () => {
  const view = await mountPanel()
  try {
    const items = [...view.root.querySelectorAll<HTMLElement>('.version-item')]
    expect(items).toHaveLength(4)
    const tagOf = (item: HTMLElement) => item.querySelector('.version-source-tag')?.textContent?.trim() ?? null
    expect(tagOf(items[0]!)).toBe('导入')
    expect(tagOf(items[1]!)).toBe('AI 修改')
    expect(items[1]!.querySelector('.version-source-tag')!.getAttribute('title')).toBe('写入方：claude-code')
    expect(tagOf(items[2]!)).toBeNull()
    expect(tagOf(items[3]!)).toBeNull()
  } finally {
    view.unmount()
  }
})

it('创建版本时传 source=human，并在写文档成功后正常结束', async () => {
  const onConflict = vi.fn()
  const view = await mountPanel(onConflict)
  const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as any)
  try {
    mocks.documentStore.updateDocument.mockResolvedValue({})
    view.root.querySelector<HTMLButtonElement>('.header-actions button')!.click()
    await flushMicrotasks()
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === '确定')!
    // 版本号来自 getNextVersionNo，已在 mounted 后填入
    confirm.click()
    await flushMicrotasks()

    expect(mocks.versionStore.createVersion).toHaveBeenCalledOnce()
    expect(mocks.versionStore.createVersion.mock.calls[0]![0]).toMatchObject({
      documentId: 17,
      source: 'human',
    })
    expect(mocks.documentStore.updateDocument).toHaveBeenCalledWith(17, { content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    expect(success).toHaveBeenCalledWith('版本保存成功')
    expect(onConflict).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})

it('版本已创建但写文档遇到 409：提示并通知编辑器进入冲突状态', async () => {
  const onConflict = vi.fn()
  const view = await mountPanel(onConflict)
  const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
  const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
  try {
    mocks.documentStore.updateDocument.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), { response: { status: 409 } }),
    )
    view.root.querySelector<HTMLButtonElement>('.header-actions button')!.click()
    await flushMicrotasks()
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('.el-dialog__footer button')]
      .find((button) => button.textContent?.replace(/\s/g, '') === '确定')!
    confirm.click()
    await flushMicrotasks()

    expect(mocks.versionStore.createVersion).toHaveBeenCalledOnce()
    expect(onConflict).toHaveBeenCalledOnce()
    expect(String(warning.mock.calls[0]?.[0])).toContain('版本已保存')
    expect(error).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})
