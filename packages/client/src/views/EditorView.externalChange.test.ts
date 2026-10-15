// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorView from './EditorView.vue'
import { useDocumentStore } from '@/stores/document'

/**
 * 编辑器感知外部修改（WP9.2d）：用真实的 pinia store 和模拟的服务端（documentApi + EventSource），
 * 验证自动载入、冲突、保存竞态、重连比较与清理。
 */

const mocks = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  versionApi: {
    listByDocument: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  },
  editor: null as any,
  editorOptions: null as any,
  routeGuard: null as null | (() => Promise<boolean> | boolean),
  routerPush: vi.fn(),
}))

vi.mock('@/api/document', () => ({ documentApi: mocks.api }))
vi.mock('@/api/version', () => ({ versionApi: mocks.versionApi }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => Promise<boolean> | boolean) => { mocks.routeGuard = guard },
  useRoute: () => ({ params: { id: '17' } }),
  useRouter: () => ({ push: mocks.routerPush }),
}))
vi.mock('@tiptap/vue-3', async () => {
  const vue = await import('vue')
  const { Editor: ProductionEditor } = await import('@tiptap/core')
  return {
    useEditor: (options: any) => {
      mocks.editorOptions = options
      mocks.editor = new ProductionEditor(options)
      return vue.shallowRef(mocks.editor)
    },
  }
})
vi.mock('@/components/editor/EditorContent.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentOutline.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/SlashMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentSettingsPanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: {
      props: ['draft', 'dirty', 'saving', 'saveError'],
      emits: ['save', 'reset'],
      setup(props: any, { emit }: any) {
        return () => vue.h('div', [
          vue.h('input', {
            'data-testid': 'settings-title',
            value: props.draft.titleCn,
            onInput: (event: Event) => { props.draft.titleCn = (event.target as HTMLInputElement).value },
          }),
          vue.h('button', { 'data-testid': 'settings-save', onClick: () => emit('save') }, '保存设置'),
        ])
      },
    },
  }
})
vi.mock('@/components/version/VersionPanel.vue', async () => {
  const vue = await import('vue')
  return { default: { setup: () => () => vue.h('div', { 'data-testid': 'version-panel' }) } }
})

// ---------- 模拟 EventSource ----------
class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
  closeCalls = 0
  private listeners = new Map<string, Array<(event: any) => void>>()
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close() {
    this.closeCalls += 1
    this.readyState = 2
  }
  private emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  open() {
    this.readyState = 1
    this.emit('open')
  }
  push(revision: number, source: 'human' | 'ai' | 'system', client?: string) {
    this.emit('document-changed', {
      data: JSON.stringify({ documentId: 17, revision, source, ...(client ? { client } : {}), at: '2026-10-13T00:00:00.000Z' }),
    })
  }
}
const sse = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]!

// ---------- 模拟服务端文档 ----------
const baseMeta = {
  standardType: 'national',
  standardNo: 'GB/T 00001—2026',
  titleCn: '外部修改回归',
  titleEn: '',
  icsCode: '',
  ccsCode: '',
  issuer: '',
  applicant: '',
  proposer: '',
  technicalCommittee: '',
  replaces: '',
  consistency: '',
  publishDate: '',
  implementDate: '',
  filingNo: '',
  industryName: '',
  regionName: '',
  coverDesignation: '',
}

function documentJson(text: string) {
  return {
    type: 'doc',
    attrs: {},
    content: [{
      type: 'coverPage',
      attrs: { nodeId: 'stable-cover', standardType: 'national', titleCn: baseMeta.titleCn },
      content: [{ type: 'paragraph', attrs: { nodeId: 'stable-cover-p' } }],
    }, {
      type: 'foreword',
      attrs: { nodeId: 'stable-foreword' },
      content: [{
        type: 'paragraph',
        attrs: { nodeId: 'stable-foreword-p' },
        content: [{ type: 'text', text }],
      }],
    }],
  }
}

function serverDocument(revision: number, text = '服务端原文', titleCn = baseMeta.titleCn) {
  return {
    id: 17,
    title: titleCn,
    meta: { ...baseMeta, titleCn },
    stage: 'working_draft',
    content: documentJson(text),
    revision,
    updatedAt: '',
  }
}

const server = { doc: serverDocument(4) }

/** 服务端上有人写入（AI 或其他地方），revision 加 1，返回新 revision */
function serverWrites(text: string, titleCn?: string) {
  server.doc = serverDocument(server.doc.revision + 1, text, titleCn ?? server.doc.meta.titleCn)
  return server.doc.revision
}

function conflictError() {
  return Object.assign(new Error('Request failed with status code 409'), {
    response: { status: 409, data: { statusCode: 409, message: '文档已被修改', revision: server.doc.revision } },
  })
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function settle() {
  await flushMicrotasks()
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(100)
  await flushMicrotasks()
}

async function mountEditor() {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ htmlToPdf: true }) }))
  server.doc = serverDocument(4)
  for (const fn of Object.values(mocks.api)) fn.mockReset()
  for (const fn of Object.values(mocks.versionApi)) fn.mockReset()
  mocks.api.get.mockImplementation(async () => ({ data: structuredClone(server.doc) }))
  mocks.versionApi.listByDocument.mockResolvedValue({ data: [] })
  mocks.routerPush.mockReset()
  mocks.routeGuard = null
  mocks.editor = null
  mocks.editorOptions = null

  const pinia = createPinia()
  setActivePinia(pinia)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(EditorView) })
  app.use(pinia).use(ElementPlus).mount(root)
  await flushMicrotasks()
  expect(FakeEventSource.instances).toHaveLength(1)
  // 初次加载读过一次文档；之后的 get 才是外部修改引起的。
  mocks.api.get.mockClear()
  const store = useDocumentStore()
  return {
    root,
    editor: mocks.editor,
    store,
    source: sse(),
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

type View = Awaited<ReturnType<typeof mountEditor>>

const banner = (view: View) => view.root.querySelector<HTMLElement>('[aria-label="保存冲突提示"]')
const pill = (view: View) => view.root.querySelector('.ses-save-pill')?.textContent ?? ''
const bodyDirtyMark = (view: View) => view.root.querySelector('[aria-label="正文有未保存修改"]')
const conflictDialog = () => document.body.querySelector<HTMLElement>('.ses-conflict-dlg')
const conflictDialogOpen = () => {
  const overlay = conflictDialog()?.closest<HTMLElement>('.el-overlay')
  return Boolean(overlay) && overlay!.style.display !== 'none'
}
function clickButton(container: ParentNode, label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`找不到按钮：${label}`)
  button.click()
}
function foreword(editor: any): string {
  return editor.getJSON().content.find((node: any) => node.type === 'foreword').content[0].content?.[0]?.text ?? ''
}
function typeIntoSettings(view: View, value: string) {
  const input = view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const settingsTitle = (view: View) => view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!.value

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('无未保存修改：自动载入', () => {
  it('AI 写入：无需刷新就载入最新内容与设置，提示来源，不进入撤销历史，也不触发保存', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      vi.useFakeTimers()
      const revision = serverWrites('AI 刚写入的内容', '服务端最新题名')
      view.source.push(revision, 'ai', 'playwright')
      await settle()

      expect(mocks.api.get).toHaveBeenCalledTimes(1)
      expect(foreword(view.editor)).toBe('AI 刚写入的内容')
      expect(settingsTitle(view)).toBe('服务端最新题名')
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(info).toHaveBeenCalledTimes(1)
      expect(info.mock.calls[0]![0]).toMatchObject({ message: 'AI（playwright）已更新文档，已载入最新内容' })
      // 没有冲突，也没有被标成未保存
      expect(banner(view)).toBeNull()
      expect(conflictDialog()).toBeNull()
      expect(bodyDirtyMark(view)).toBeNull()
      expect(pill(view)).not.toContain('待保存')
      // 载入本身不会触发自动保存
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mocks.api.update).not.toHaveBeenCalled()
      // 不进入撤销历史：Ctrl+Z 不会把旧内容带回来，也不会产生多余的改动和自动保存
      view.editor.commands.undo()
      expect(foreword(view.editor)).toBe('AI 刚写入的内容')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mocks.api.update).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('载入后继续编辑，自动保存带上新的 revision', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      view.source.push(serverWrites('AI 写入'), 'ai', 'playwright')
      await settle()

      mocks.api.update.mockImplementation(async (_id: number, body: any) => ({
        data: { ...serverDocument(body.baseRevision + 1), content: body.content },
      }))
      view.editor.commands.insertContent('接着写')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()

      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(5)
    } finally {
      view.unmount()
    }
  })

  it('其他地方（人）的修改：提示「文档已在其他地方更新」；AI 没有 client 名时不带括号', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      view.source.push(serverWrites('别处改的'), 'human')
      await settle()
      expect(foreword(view.editor)).toBe('别处改的')
      expect(info.mock.calls[0]![0]).toMatchObject({ message: '文档已在其他地方更新，已载入最新内容' })

      view.source.push(serverWrites('AI 又改了'), 'ai')
      await settle()
      expect(foreword(view.editor)).toBe('AI 又改了')
      expect(info.mock.calls[1]![0]).toMatchObject({ message: 'AI 已更新文档，已载入最新内容' })
    } finally {
      view.unmount()
    }
  })

  it('连续两次写入合并为一次载入，直接得到最新内容', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      const first = serverWrites('第一次')
      const second = serverWrites('第二次')
      view.source.push(first, 'ai', 'playwright')
      view.source.push(second, 'ai', 'playwright')
      await settle()
      expect(foreword(view.editor)).toBe('第二次')
      expect(view.store.currentDocument?.revision).toBe(second)
      expect(info).toHaveBeenCalledTimes(1)
      expect(mocks.api.get).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
    }
  })

  it('system 事件（只补齐 nodeId）：静默追上 revision，不读取内容、不提示，编辑器与光标不动', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      view.source.push(5, 'system')
      await settle()
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(foreword(view.editor)).toBe('服务端原文')

      // 之后的保存使用追上后的 revision，不会无谓地 409
      vi.useFakeTimers()
      mocks.api.update.mockImplementation(async (_id: number, body: any) => ({
        data: { ...serverDocument(body.baseRevision + 1), content: body.content },
      }))
      view.editor.commands.insertContent('继续写')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(5)
    } finally {
      view.unmount()
    }
  })

  it('system 事件到达时本地有未保存修改：同样只追上 revision，不进入冲突', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      view.editor.commands.insertContent('正在输入')
      view.source.push(5, 'system')
      await settle()
      expect(banner(view)).toBeNull()
      expect(conflictDialog()).toBeNull()
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(foreword(view.editor)).toContain('正在输入')
    } finally {
      view.unmount()
    }
  })

  it('读取最新内容失败：提示一次，本页内容与 revision 不变；下一次事件会重试', async () => {
    const view = await mountEditor()
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
    try {
      const revision = serverWrites('AI 写入')
      mocks.api.get.mockRejectedValueOnce(new Error('offline'))
      view.source.push(revision, 'ai', 'playwright')
      await settle()
      expect(warning).toHaveBeenCalledTimes(1)
      expect(String((warning.mock.calls[0]![0] as any).message)).toContain('读取最新内容失败')
      expect(foreword(view.editor)).toBe('服务端原文')
      expect(view.store.currentDocument?.revision).toBe(4)

      // 同一 revision 的事件再次到达（或重连）时重试成功
      view.source.push(revision, 'ai', 'playwright')
      await settle()
      expect(foreword(view.editor)).toBe('AI 写入')
      expect(view.store.currentDocument?.revision).toBe(revision)
    } finally {
      view.unmount()
    }
  })

  it('最新内容不符合编辑器 schema：不载入、不前移 revision（避免之后的保存静默覆盖），提示错误', async () => {
    const view = await mountEditor()
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    try {
      const revision = serverWrites('将被破坏')
      server.doc.content = { type: 'doc', content: [{ type: 'not-a-production-node' }] } as any
      view.source.push(revision, 'ai', 'playwright')
      await settle()
      expect(String((error.mock.calls[0]![0] as any).message)).toContain('无法载入编辑器')
      expect(foreword(view.editor)).toBe('服务端原文')
      expect(view.store.currentDocument?.revision).toBe(4)
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })
})

describe('有未保存修改：直接进入冲突', () => {
  it('未保存的正文：立即出现冲突提示并说明是 AI 修改，本地输入不丢，自动保存暂停', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      vi.useFakeTimers()
      view.editor.commands.insertContent('我正在输入')
      await flushMicrotasks()
      expect(bodyDirtyMark(view)).not.toBeNull()

      view.source.push(serverWrites('AI 写入的内容'), 'ai', 'playwright')
      await settle()

      expect(conflictDialogOpen()).toBe(true)
      expect(conflictDialog()!.textContent).toContain('AI 已修改此文档')
      expect(conflictDialog()!.textContent).toContain('AI（playwright）在你编辑期间修改了这份文档')
      expect(conflictDialog()!.textContent).toContain('重新加载')
      expect(conflictDialog()!.textContent).toContain('另存为副本')
      expect(banner(view)!.textContent).toContain('AI（playwright）已修改此文档，当前内容未保存；自动保存已暂停')
      expect(pill(view)).toContain('存在冲突')
      // 没有读取内容、没有载入、没有提示「已更新」
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
      expect(foreword(view.editor)).toContain('我正在输入')
      expect(bodyDirtyMark(view)).not.toBeNull()
      expect(view.store.currentDocument?.revision).toBe(4)

      // 自动保存与手动保存都暂停：不会发出带过期 revision 的请求
      view.editor.commands.insertContent('冲突后的又一次编辑')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(mocks.api.update).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('他处（非 AI）修改沿用原有文案', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      view.editor.commands.insertContent('我正在输入')
      view.source.push(serverWrites('别处改的'), 'human')
      await settle()
      expect(conflictDialog()!.textContent).toContain('文档已在其他地方被修改')
      expect(conflictDialog()!.textContent).toContain('这份文档在你编辑期间被其他地方修改')
      expect(banner(view)!.textContent).toContain('文档已在其他地方被修改，当前内容未保存')
    } finally {
      view.unmount()
    }
  })

  it('选择「重新加载」后显示 AI 的内容，冲突与未保存标记消失，之后的编辑可正常保存', async () => {
    const view = await mountEditor()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(undefined as any)
    try {
      vi.useFakeTimers()
      view.editor.commands.insertContent('我正在输入')
      view.source.push(serverWrites('AI 写入的内容'), 'ai', 'playwright')
      await settle()
      expect(conflictDialogOpen()).toBe(true)

      clickButton(conflictDialog()!, '重新加载')
      await settle()
      expect(confirm).toHaveBeenCalledOnce()
      expect(foreword(view.editor)).toBe('AI 写入的内容')
      expect(banner(view)).toBeNull()
      expect(conflictDialogOpen()).toBe(false)
      expect(bodyDirtyMark(view)).toBeNull()
      expect(view.store.currentDocument?.revision).toBe(5)

      mocks.api.update.mockImplementation(async (_id: number, body: any) => ({
        data: { ...serverDocument(body.baseRevision + 1), content: body.content },
      }))
      view.editor.commands.insertContent('解决冲突后继续写')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(5)
    } finally {
      view.unmount()
    }
  })

  it('未保存的文件设置草稿同样进入冲突，并提示设置草稿仍保留', async () => {
    const view = await mountEditor()
    try {
      typeIntoSettings(view, '未保存的新题名')
      await flushMicrotasks()
      view.source.push(serverWrites('AI 写入的内容'), 'ai', 'playwright')
      await settle()

      expect(conflictDialogOpen()).toBe(true)
      expect(conflictDialog()!.textContent).toContain('文件设置的修改也尚未保存')
      expect(settingsTitle(view)).toBe('未保存的新题名')
      expect(foreword(view.editor)).toBe('服务端原文')
      expect(mocks.api.get).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('已处于冲突状态：关闭提示后不会因后续事件再次弹窗，但横幅补上 AI 原因', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      view.editor.commands.insertContent('我正在输入')
      view.source.push(serverWrites('别处改的'), 'human')
      await settle()
      clickButton(conflictDialog()!, '稍后处理')
      await settle()
      expect(conflictDialogOpen()).toBe(false)
      expect(banner(view)!.textContent).toContain('文档已在其他地方被修改')

      view.source.push(serverWrites('AI 又写了'), 'ai', 'playwright')
      await settle()
      expect(conflictDialogOpen()).toBe(false)
      expect(banner(view)!.textContent).toContain('AI（playwright）已修改此文档')
    } finally {
      view.unmount()
    }
  })

  it('读取内容期间用户开始输入：以读取完成时的状态为准，进入冲突而不是覆盖输入', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      const read = deferred<{ data: unknown }>()
      mocks.api.get.mockImplementationOnce(() => read.promise as never)
      const revision = serverWrites('AI 写入的内容')
      view.source.push(revision, 'ai', 'playwright')
      await settle()
      expect(mocks.api.get).toHaveBeenCalledTimes(1)

      view.editor.commands.insertContent('读取期间输入')
      read.resolve({ data: structuredClone(server.doc) })
      await settle()

      expect(conflictDialogOpen()).toBe(true)
      expect(foreword(view.editor)).toContain('读取期间输入')
      expect(view.store.currentDocument?.revision).toBe(4)
    } finally {
      view.unmount()
    }
  })
})

describe('保存进行中收到事件', () => {
  it('自己保存产生的事件先于保存响应到达：不当作外部修改，不读取、不提示、不冲突', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      vi.useFakeTimers()
      const put = deferred<{ data: unknown }>()
      mocks.api.update.mockImplementationOnce(() => put.promise as never)
      view.editor.commands.insertContent('我保存的内容')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()
      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(pill(view)).toContain('保存中')

      // 服务端已提交（revision 5）并推送 human 事件，保存响应还没回来
      view.source.push(5, 'human')
      await settle()
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(conflictDialog()).toBeNull()

      // 响应到达：revision 追平，事件被忽略
      put.resolve({ data: { ...serverDocument(5), content: mocks.api.update.mock.calls[0]![1].content } })
      await settle()
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
      expect(banner(view)).toBeNull()
      expect(foreword(view.editor)).toContain('我保存的内容')
      expect(bodyDirtyMark(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('保存期间 AI 又写了一次（revision 更大）：保存成功后载入 AI 的最新内容', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      vi.useFakeTimers()
      const put = deferred<{ data: unknown }>()
      mocks.api.update.mockImplementationOnce(() => put.promise as never)
      view.editor.commands.insertContent('我保存的内容')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()

      view.source.push(5, 'human')
      server.doc = serverDocument(6, '我保存的内容之后 AI 又写了')
      view.source.push(6, 'ai', 'playwright')
      await settle()
      expect(mocks.api.get).not.toHaveBeenCalled()

      put.resolve({ data: { ...serverDocument(5), content: mocks.api.update.mock.calls[0]![1].content } })
      await settle()
      expect(mocks.api.get).toHaveBeenCalledTimes(1)
      expect(foreword(view.editor)).toBe('我保存的内容之后 AI 又写了')
      expect(view.store.currentDocument?.revision).toBe(6)
      expect(info.mock.calls[0]![0]).toMatchObject({ message: 'AI（playwright）已更新文档，已载入最新内容' })
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('保存因 AI 抢先写入而 409：走既有冲突路径，提示补上 AI 原因，只弹一次', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      const put = deferred<{ data: unknown }>()
      mocks.api.update.mockImplementationOnce(() => put.promise as never)
      view.editor.commands.insertContent('我保存的内容')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()

      const revision = serverWrites('AI 抢先写入')
      view.source.push(revision, 'ai', 'playwright')
      await settle()
      // 保存还没结束：不在这时判断
      expect(conflictDialog()).toBeNull()

      put.reject(conflictError())
      await settle()
      expect(conflictDialogOpen()).toBe(true)
      expect(conflictDialog()!.textContent).toContain('AI（playwright）在你编辑期间修改了这份文档')
      expect(banner(view)!.textContent).toContain('AI（playwright）已修改此文档')
      expect(foreword(view.editor)).toContain('我保存的内容')
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(mocks.api.update).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
    }
  })

  it('保存因其他原因失败（非 409）：保存期间收到的外部修改在保存结束后按未保存修改处理，进入冲突', async () => {
    const view = await mountEditor()
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    try {
      vi.useFakeTimers()
      const put = deferred<{ data: unknown }>()
      mocks.api.update.mockImplementationOnce(() => put.promise as never)
      view.editor.commands.insertContent('我保存的内容')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()

      view.source.push(serverWrites('AI 写入'), 'ai', 'playwright')
      put.reject(Object.assign(new Error('boom'), { response: { status: 500 } }))
      await settle()

      expect(error).toHaveBeenCalledWith('保存失败；正文仍保留在编辑器中')
      expect(conflictDialogOpen()).toBe(true)
      expect(conflictDialog()!.textContent).toContain('AI（playwright）在你编辑期间修改了这份文档')
      expect(foreword(view.editor)).toContain('我保存的内容')
    } finally {
      view.unmount()
    }
  })

  it('版本面板的保存（不经过编辑器的保存流程）产生的事件同样被识别为自己的', async () => {
    const view = await mountEditor()
    try {
      const put = deferred<{ data: unknown }>()
      mocks.api.update.mockImplementationOnce(() => put.promise as never)
      // 版本面板直接调用 store.updateDocument
      const saving = view.store.updateDocument(17, { content: documentJson('版本面板保存') })
      view.source.push(5, 'human')
      await settle()
      expect(mocks.api.get).not.toHaveBeenCalled()

      put.resolve({ data: { ...serverDocument(5, '版本面板保存') } })
      await saving
      await settle()
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })
})

describe('重连后比较', () => {
  it('连接建立后读取 revision：与本地相同不打扰', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      view.source.open()
      await settle()
      expect(mocks.api.get).toHaveBeenCalledTimes(1)
      expect(info).not.toHaveBeenCalled()
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('断线期间文档被改（事件不会补发）：重连后发现 revision 更大，自动载入并按「其他地方」提示', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      view.source.open()
      await settle()
      serverWrites('断线期间 AI 写的')
      view.source.open() // 浏览器自动重连成功
      await settle()
      expect(foreword(view.editor)).toBe('断线期间 AI 写的')
      expect(info.mock.calls[0]![0]).toMatchObject({ message: '文档已在其他地方更新，已载入最新内容' })
    } finally {
      view.unmount()
    }
  })

  it('断线期间文档被改且本地有未保存修改：重连后进入冲突，用「其他地方」文案', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      view.editor.commands.insertContent('我正在输入')
      serverWrites('断线期间别处改的')
      view.source.open()
      await settle()
      expect(conflictDialogOpen()).toBe(true)
      expect(conflictDialog()!.textContent).toContain('文档已在其他地方被修改')
      expect(foreword(view.editor)).toContain('我正在输入')
    } finally {
      view.unmount()
    }
  })

  it('连接失败不影响编辑，也不弹窗', async () => {
    const view = await mountEditor()
    const error = vi.spyOn(ElMessage, 'error')
    const warning = vi.spyOn(ElMessage, 'warning')
    try {
      vi.useFakeTimers()
      view.editor.commands.insertContent('离线时输入')
      mocks.api.update.mockImplementation(async (_id: number, body: any) => ({
        data: { ...serverDocument(body.baseRevision + 1), content: body.content },
      }))
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()
      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(error).not.toHaveBeenCalled()
      expect(warning).not.toHaveBeenCalled()
      expect(conflictDialog()).toBeNull()
    } finally {
      view.unmount()
    }
  })
})

describe('版本面板与清理', () => {
  it('版本面板打开时收到 AI 事件刷新版本列表；面板关闭或非 AI 事件不刷新', async () => {
    const view = await mountEditor()
    try {
      // 面板关闭：不刷新
      view.source.push(serverWrites('AI 写入 1'), 'ai', 'playwright')
      await settle()
      expect(mocks.versionApi.listByDocument).not.toHaveBeenCalled()

      clickButton(view.root, '版本历史')
      await settle()
      expect(view.root.querySelector('[data-testid="version-panel"]')).not.toBeNull()

      // 面板打开：human 事件不刷新，ai 事件刷新（不论编辑器当前如何处理这次修改）
      view.source.push(serverWrites('别处改的'), 'human')
      await settle()
      expect(mocks.versionApi.listByDocument).not.toHaveBeenCalled()

      view.source.push(serverWrites('AI 写入 2'), 'ai', 'playwright')
      await settle()
      expect(mocks.versionApi.listByDocument).toHaveBeenCalledTimes(1)
      expect(mocks.versionApi.listByDocument).toHaveBeenCalledWith(17)
    } finally {
      view.unmount()
    }
  })

  it('有未保存修改而进入冲突时，版本面板仍会刷新（AI 版本已经生成）', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      clickButton(view.root, '版本历史')
      await settle()
      view.editor.commands.insertContent('我正在输入')
      view.source.push(serverWrites('AI 写入'), 'ai', 'playwright')
      await settle()
      expect(conflictDialogOpen()).toBe(true)
      expect(mocks.versionApi.listByDocument).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
    }
  })

  it('离开页面时关闭连接；之后到达的事件不再有任何影响', async () => {
    const view = await mountEditor()
    const source = view.source
    const info = vi.spyOn(ElMessage, 'info')
    view.unmount()
    expect(source.closeCalls).toBeGreaterThanOrEqual(1)
    source.push(serverWrites('卸载后的写入'), 'ai', 'playwright')
    source.open()
    await flushMicrotasks()
    expect(mocks.api.get).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('保存进行中离开页面：等待保存的订阅逻辑被释放，不留下挂起的等待', async () => {
    const view = await mountEditor()
    vi.useFakeTimers()
    const put = deferred<{ data: unknown }>()
    mocks.api.update.mockImplementationOnce(() => put.promise as never)
    view.editor.commands.insertContent('我保存的内容')
    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    view.source.push(5, 'human')
    await flushMicrotasks()
    view.unmount()
    put.resolve({ data: { ...serverDocument(5) } })
    await flushMicrotasks()
    expect(mocks.api.get).not.toHaveBeenCalled()
  })
})
