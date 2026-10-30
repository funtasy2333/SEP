// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeView from './HomeView.vue'
import { useDocumentStore } from '@/stores/document'

const mocks = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listTrash: vi.fn(),
    restore: vi.fn(),
    permanentDelete: vi.fn(),
    emptyTrash: vi.fn(),
    previewSesImport: vi.fn(),
    importSesPackage: vi.fn(),
  },
  routerPush: vi.fn(),
}))

vi.mock('@/api/document', () => ({ documentApi: mocks.api }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }))

vi.mock('@/components/home/HomeNav.vue', async () => {
  const vue = await import('vue')
  return {
    default: {
      props: ['activeTab', 'tabs'],
      emits: ['select-tab'],
      setup(props: any, { emit }: any) {
        return () => vue.h('nav', props.tabs.map((tab: any) => vue.h('button', {
          type: 'button',
          'data-tab': tab.id,
          onClick: () => emit('select-tab', tab.id),
        }, `${tab.label}${tab.count === undefined ? '' : ` ${tab.count}`}`)))
      },
    },
  }
})
vi.mock('@/components/home/StageOverview.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))
vi.mock('@/components/home/TemplateRail.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))
vi.mock('@/components/home/DocCard.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))
vi.mock('@/components/home/NewDocDialog.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))

const ok = (data: unknown) => ({ data }) as never

function activeDoc(id: number, title: string) {
  return {
    id,
    title,
    meta: { standardType: 'national', standardNo: `GB ${id}`, titleCn: title },
    stage: 'review_draft',
    revision: 11,
    content: { type: 'doc', content: [] },
  }
}

function activePreview(overrides: Record<string, unknown> = {}) {
  return {
    match: { id: 12, title: '本地标准', revision: 7 },
    inTrash: false,
    newVersions: 2,
    localOnlyVersions: 1,
    contentDiffers: true,
    versionNoCollisions: ['1.0'],
    ...overrides,
  }
}

async function flush() {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

async function mountHome() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(HomeView)
  app.use(pinia).use(ElementPlus)
  app.mount(root)
  await flush()
  setActivePinia(pinia)
  return {
    root,
    store: useDocumentStore(),
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

function button(root: ParentNode, label: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label) ?? null
}

function emitSesDialogOpened() {
  const dialog = document.body.querySelector('.ses-import-dialog') as any
  let component = dialog?.__vueParentComponent
  while (component && component.type?.name !== 'ElDialog') component = component.parent
  // happy-dom 不会完成 Element Plus 的过渡；触发其 opened 组件事件以验证焦点处理器。
  component?.emit('opened')
}

async function chooseFile(root: ParentNode, file: File): Promise<boolean> {
  const input = root.querySelector<HTMLInputElement>('input[type="file"][accept=".ses"]')
  expect(input).not.toBeNull()
  if (!input) return false
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
  return true
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.api.list.mockResolvedValue(ok([]))
  mocks.api.listTrash.mockResolvedValue(ok([]))
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('HomeView SES 文档包导入', () => {
  it('空标准库也显示 .ses 导入入口和限制为 .ses 的隐藏文件框', async () => {
    const view = await mountHome()
    try {
      expect(button(view.root, '导入 .ses')).not.toBeNull()
      const input = view.root.querySelector<HTMLInputElement>('input[type="file"][accept=".ses"]')
      expect(input).not.toBeNull()
      expect(input?.hidden || input?.style.display === 'none').toBe(true)
    } finally {
      view.unmount()
    }
  })

  it('无匹配时直接新建并跳转，列表刷新失败仍报告导入成功', async () => {
    const file = new File(['{}'], 'backup.ses')
    const imported = activeDoc(31, '导入标准')
    mocks.api.previewSesImport.mockResolvedValue({
      match: null, inTrash: false, newVersions: 2, localOnlyVersions: 0,
      contentDiffers: false, versionNoCollisions: [],
    })
    mocks.api.importSesPackage.mockResolvedValue(imported)
    const view = await mountHome()
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as any)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
    try {
      mocks.api.list.mockRejectedValueOnce(new Error('刷新中断'))
      if (!await chooseFile(view.root, file)) return

      expect(mocks.api.previewSesImport).toHaveBeenCalledWith(file)
      expect(mocks.api.importSesPackage).toHaveBeenCalledWith(file, 'new')
      expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'editor', params: { id: 31 } })
      expect(success).toHaveBeenCalled()
      expect(warning).toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
      expect(view.root.querySelector<HTMLInputElement>('input[type="file"]')?.value).toBe('')
    } finally {
      view.unmount()
    }
  })

  it('正文不同的活动匹配提示包正文替换并记录本次导入，更新使用 preview revision', async () => {
    const file = new File(['{}'], 'backup.ses')
    mocks.api.previewSesImport.mockResolvedValue(activePreview())
    mocks.api.importSesPackage.mockResolvedValue(activeDoc(12, '本地标准'))
    const view = await mountHome()
    try {
      if (!await chooseFile(view.root, file)) return
      expect(document.body.textContent).toContain('本地标准')
      expect(document.body.textContent).toContain('新增 2 个版本')
      expect(document.body.textContent).toContain('本地独有 1 个版本')
      expect(document.body.textContent).toContain('版本历史会记录本次导入，可查看本次修改或回滚到导入前')
      expect(document.body.textContent).toContain('包正文成为当前正文')
      expect(document.body.textContent).toContain('1.0')
      expect(button(view.root, '导入 .ses')?.disabled).toBe(true)

      const update = button(document.body, '更新现有文档')
      expect(update).not.toBeNull()
      emitSesDialogOpened()
      await flush()
      expect(document.activeElement).toBe(update)
      expect(update?.hasAttribute('autofocus')).toBe(true)
      if (!update) return
      update.click()
      await flush()
      expect(mocks.api.importSesPackage).toHaveBeenCalledWith(file, 'update', { targetId: 12, baseRevision: 7 })
    } finally {
      view.unmount()
    }
  })

  it('正文相同时说明只追加版本；只选择另存才创建副本', async () => {
    const file = new File(['{}'], 'backup.ses')
    mocks.api.previewSesImport.mockResolvedValue(activePreview({ contentDiffers: false, versionNoCollisions: [] }))
    mocks.api.importSesPackage.mockResolvedValue(activeDoc(32, '本地标准（导入副本）'))
    const view = await mountHome()
    try {
      if (!await chooseFile(view.root, file)) return
      expect(document.body.textContent).toContain('正文相同')
      expect(document.body.textContent).toContain('导入只追加版本，不改动当前正文')

      const copy = button(document.body, '另存为新文档')
      expect(copy).not.toBeNull()
      if (!copy) return
      copy.click()
      await flush()
      expect(mocks.api.importSesPackage).toHaveBeenCalledWith(file, 'new')
    } finally {
      view.unmount()
    }
  })

  it('回收站匹配只允许另存或取消，不会发送 update', async () => {
    const file = new File(['{}'], 'backup.ses')
    mocks.api.previewSesImport.mockResolvedValue(activePreview({ inTrash: true }))
    mocks.api.importSesPackage.mockResolvedValue(activeDoc(32, '本地标准（导入副本）'))
    const view = await mountHome()
    try {
      if (!await chooseFile(view.root, file)) return
      expect(document.body.textContent).toContain('请先恢复')
      expect(button(document.body, '更新现有文档')).toBeNull()
      const copy = button(document.body, '另存为新文档')
      expect(copy).not.toBeNull()
      emitSesDialogOpened()
      await flush()
      expect(document.activeElement).toBe(copy)
      copy?.click()
      await flush()
      expect(mocks.api.importSesPackage).toHaveBeenCalledWith(file, 'new')
      expect(mocks.api.importSesPackage).not.toHaveBeenCalledWith(file, 'update', expect.anything())
    } finally {
      view.unmount()
    }
  })

  it.each(['Escape', '遮罩', '关闭按钮'] as const)('活动匹配对话框通过%s关闭只取消，不转成另存', async (closeMethod) => {
    const file = new File(['{}'], 'backup.ses')
    mocks.api.previewSesImport.mockResolvedValue(activePreview())
    const view = await mountHome()
    try {
      if (!await chooseFile(view.root, file)) return
      if (closeMethod === 'Escape') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      } else if (closeMethod === '遮罩') {
        const mask = document.body.querySelector<HTMLElement>('.ses-import-dialog')
          ?.closest<HTMLElement>('.el-overlay')?.querySelector<HTMLElement>('.el-overlay-dialog')
        mask?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        mask?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        mask?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      } else {
        document.body.querySelector<HTMLButtonElement>('.ses-import-dialog .el-dialog__headerbtn')?.click()
      }
      await flush()
      expect(mocks.api.importSesPackage).not.toHaveBeenCalled()
      expect(view.root.querySelector<HTMLInputElement>('input[type="file"]')?.value).toBe('')
      expect(button(view.root, '导入 .ses')?.disabled).toBe(false)
    } finally {
      view.unmount()
    }
  })

  it('更新返回 409 时精确要求重新导入且不重试旧 preview', async () => {
    const file = new File(['{}'], 'backup.ses')
    mocks.api.previewSesImport.mockResolvedValue(activePreview())
    mocks.api.importSesPackage.mockRejectedValue({
      response: { status: 409, data: { message: 'revision changed' } },
    })
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    const view = await mountHome()
    try {
      if (!await chooseFile(view.root, file)) return
      button(document.body, '更新现有文档')?.click()
      await flush()
      expect(error).toHaveBeenCalledWith('该文档在你确认期间被修改，请重新导入')
      expect(mocks.api.previewSesImport).toHaveBeenCalledTimes(1)
      expect(mocks.api.importSesPackage).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
    }
  })

  it('schema 导入失败时显示服务端消息，并清空文件框便于重选同一文件', async () => {
    const file = new File(['{}'], 'backup.ses')
    mocks.api.previewSesImport.mockResolvedValue({
      match: null, inTrash: false, newVersions: 0, localOnlyVersions: 0,
      contentDiffers: false, versionNoCollisions: [],
    })
    mocks.api.importSesPackage.mockRejectedValue({
      response: { status: 422, data: { message: 'document.content.type 不符合当前 schema' } },
    })
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    const view = await mountHome()
    try {
      if (!await chooseFile(view.root, file)) return
      expect(error).toHaveBeenCalledWith('document.content.type 不符合当前 schema')
      expect(view.root.querySelector<HTMLInputElement>('input[type="file"]')?.value).toBe('')
    } finally {
      view.unmount()
    }
  })

  it('preview尚未返回时页面卸载，返回后不开始新建也不弹确认框', async () => {
    const file = new File(['{}'], 'backup.ses')
    const preview = deferred<any>()
    mocks.api.previewSesImport.mockReturnValue(preview.promise)
    const view = await mountHome()
    if (!await chooseFile(view.root, file)) return
    view.unmount()
    preview.resolve({
      match: null, inTrash: false, newVersions: 1, localOnlyVersions: 0,
      contentDiffers: false, versionNoCollisions: [],
    })
    await flush()

    expect(mocks.api.importSesPackage).not.toHaveBeenCalled()
    expect(mocks.routerPush).not.toHaveBeenCalled()
    expect(document.body.querySelector('.ses-import-dialog')).toBeNull()
  })

  it('写入响应晚于页面卸载时不把用户跳回编辑器', async () => {
    const file = new File(['{}'], 'backup.ses')
    const imported = deferred<any>()
    mocks.api.previewSesImport.mockResolvedValue({
      match: null, inTrash: false, newVersions: 1, localOnlyVersions: 0,
      contentDiffers: false, versionNoCollisions: [],
    })
    mocks.api.importSesPackage.mockReturnValue(imported.promise)
    const view = await mountHome()
    if (!await chooseFile(view.root, file)) return
    expect(mocks.api.importSesPackage).toHaveBeenCalledWith(file, 'new')
    view.unmount()
    imported.resolve(activeDoc(31, '迟到的导入'))
    await flush()

    expect(mocks.routerPush).not.toHaveBeenCalled()
  })
})
