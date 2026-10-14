// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorView from './EditorView.vue'
import { useDocumentStore } from '@/stores/document'

/**
 * 保存版本与外部写入的竞态：真实的 EditorView + 真实的 VersionPanel + 真实的 pinia store，
 * 服务端（documentApi / versionApi / EventSource）用模拟实现，PUT 按 baseRevision 判断 409。
 *
 * 要防的问题：保存版本先取内容、再等待创建版本的请求，期间 AI 写入到达——编辑器无未保存修改时会自动载入
 * AI 的内容并前移本地 revision，随后「旧内容 + 新 revision」的 PUT 成功，静默覆盖 AI 的修改。
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
      mocks.editor = new ProductionEditor(options)
      return vue.shallowRef(mocks.editor)
    },
  }
})
vi.mock('@/components/editor/EditorContent.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentOutline.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/SlashMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentSettingsPanel.vue', () => ({ default: { render: () => null } }))

// ---------- 模拟 EventSource ----------
class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
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
    this.readyState = 2
  }
  push(revision: number, source: 'human' | 'ai' | 'system', client?: string) {
    const event = {
      data: JSON.stringify({ documentId: 17, revision, source, ...(client ? { client } : {}), at: '2026-10-13T00:00:00.000Z' }),
    }
    for (const listener of this.listeners.get('document-changed') ?? []) listener(event)
  }
}

// ---------- 模拟服务端 ----------
const baseMeta = {
  standardType: 'national',
  standardNo: 'GB/T 00001—2026',
  titleCn: '保存版本回归',
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

function serverDocument(revision: number, content: Record<string, unknown> = documentJson('服务端原文')) {
  return {
    id: 17,
    title: baseMeta.titleCn,
    meta: { ...baseMeta },
    stage: 'working_draft',
    content,
    revision,
    updatedAt: '',
  }
}

const server = { doc: serverDocument(4), versions: [] as any[] }

/** 服务端上有人写入（AI），revision 加 1，返回新 revision */
function serverWrites(text: string) {
  server.doc = serverDocument(server.doc.revision + 1, documentJson(text))
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

/** 创建版本请求的闸门：每个请求先登记，测试决定何时让它返回。 */
let createGates: Array<{ body: any; gate: ReturnType<typeof deferred<void>> }> = []

async function mountEditor() {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ htmlToPdf: true }) }))
  server.doc = serverDocument(4)
  server.versions = []
  createGates = []
  for (const fn of Object.values(mocks.api)) fn.mockReset()
  for (const fn of Object.values(mocks.versionApi)) fn.mockReset()
  mocks.api.get.mockImplementation(async () => ({ data: structuredClone(server.doc) }))
  // 与真实服务端一致：baseRevision 与当前 revision 不一致就 409，成功则 revision 加 1。
  mocks.api.update.mockImplementation(async (_id: number, body: any) => {
    if (body.baseRevision !== server.doc.revision) throw conflictError()
    server.doc = serverDocument(server.doc.revision + 1, body.content ?? server.doc.content)
    return { data: structuredClone(server.doc) }
  })
  mocks.versionApi.listByDocument.mockImplementation(async () => ({ data: structuredClone(server.versions) }))
  mocks.versionApi.create.mockImplementation(async (body: any) => {
    const entry = { body: structuredClone(body), gate: deferred<void>() }
    createGates.push(entry)
    await entry.gate.promise
    const created = { ...structuredClone(body), id: server.versions.length + 1, createdAt: '2026-10-13T00:00:00.000Z' }
    server.versions.unshift(created)
    return { data: structuredClone(created) }
  })
  mocks.routerPush.mockReset()
  mocks.routeGuard = null
  mocks.editor = null

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
  return {
    root,
    editor: mocks.editor,
    store: useDocumentStore(),
    source: FakeEventSource.instances[0]!,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

type View = Awaited<ReturnType<typeof mountEditor>>

const textOf = (element: Element) => (element.textContent ?? '').replace(/\s/g, '')

function clickButton(container: ParentNode, label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => textOf(candidate) === label)
  if (!button) throw new Error(`找不到按钮：${label}`)
  button.click()
}

/** 打开版本面板，点「保存版本」，在对话框里点「确定」。 */
async function startVersionSave(view: View) {
  clickButton(view.root, '版本历史')
  await settle()
  clickButton(view.root.querySelector('.version-panel .header-actions')!, '保存版本')
  await settle()
  clickButton(document.body.querySelector('.el-dialog__footer')!, '确定')
  await flushMicrotasks()
}

function foreword(editor: any): string {
  return editor.getJSON().content.find((node: any) => node.type === 'foreword').content[0].content?.[0]?.text ?? ''
}
function serverForeword(): string {
  return (server.doc.content as any).content.find((node: any) => node.type === 'foreword').content[0].content[0].text
}
const banner = (view: View) => view.root.querySelector<HTMLElement>('[aria-label="保存冲突提示"]')
const conflictDialog = () => document.body.querySelector<HTMLElement>('.ses-conflict-dlg')
const conflictDialogOpen = () => {
  const overlay = conflictDialog()?.closest<HTMLElement>('.el-overlay')
  return Boolean(overlay) && overlay!.style.display !== 'none'
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('保存版本与外部写入', () => {
  it('创建版本期间 AI 写入到达：不自动载入、PUT 必然 409，进入冲突分支，AI 的修改与本地内容都不被覆盖', async () => {
    const view = await mountEditor()
    const warning = vi.spyOn(ElMessage, 'warning')
    const success = vi.spyOn(ElMessage, 'success')
    const info = vi.spyOn(ElMessage, 'info')
    try {
      await startVersionSave(view)
      expect(createGates).toHaveLength(1)
      expect(createGates[0]!.body.content).toEqual(view.editor.getJSON())

      // 创建版本的请求还没返回，AI 写入了文档，变更事件先到达
      view.source.push(serverWrites('AI 写入的内容'), 'ai', 'playwright')
      await settle()

      // 编辑器没有无提示地载入 AI 内容，也没有读取最新文档、前移本地 revision
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(foreword(view.editor)).toBe('服务端原文')
      expect(view.store.currentDocument?.revision).toBe(4)
      expect(mocks.api.update).not.toHaveBeenCalled()

      // 创建版本的请求返回：随后写回文档的 PUT 带着打开时的 revision，被服务端 409 拒绝
      createGates[0]!.gate.resolve()
      await settle()

      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(4)
      expect(serverForeword()).toBe('AI 写入的内容')
      expect(server.doc.revision).toBe(5)
      // 编辑器内容保持本地的版本（已作为版本快照保存），没有被服务端内容替换
      expect(foreword(view.editor)).toBe('服务端原文')
      expect(mocks.api.get).not.toHaveBeenCalled()
      expect(view.store.currentDocument?.revision).toBe(4)
      // 走既有的冲突分支：提示 + 冲突横幅/对话框（补上 AI 原因）
      expect(warning).toHaveBeenCalledWith('版本已保存，但文档已在其他地方被修改，当前编辑内容未保存')
      expect(success).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
      expect(banner(view)).not.toBeNull()
      expect(conflictDialogOpen()).toBe(true)
      expect(conflictDialog()!.textContent).toContain('AI（playwright）在你编辑期间修改了这份文档')
      expect(conflictDialog()!.textContent).toContain('版本快照已保存')
    } finally {
      view.unmount()
    }
  })

  it('没有并发的外部写入：行为与以前一致，版本和文档都保存成功，revision 前进', async () => {
    const view = await mountEditor()
    const warning = vi.spyOn(ElMessage, 'warning')
    const success = vi.spyOn(ElMessage, 'success')
    try {
      await startVersionSave(view)
      expect(createGates).toHaveLength(1)
      const localContent = view.editor.getJSON()

      createGates[0]!.gate.resolve()
      await settle()

      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(mocks.api.update.mock.calls[0]![1]).toEqual({ content: localContent, baseRevision: 4 })
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(success).toHaveBeenCalledWith('版本保存成功')
      expect(warning).not.toHaveBeenCalled()
      expect(banner(view)).toBeNull()
      expect(server.versions).toHaveLength(1)
    } finally {
      view.unmount()
    }
  })

  it('保存版本完成之后到达的 AI 写入照常自动载入（保存期间推迟处理，不是丢弃）', async () => {
    const view = await mountEditor()
    const info = vi.spyOn(ElMessage, 'info')
    try {
      await startVersionSave(view)
      createGates[0]!.gate.resolve()
      await settle()
      expect(view.store.currentDocument?.revision).toBe(5)

      view.source.push(serverWrites('之后的 AI 写入'), 'ai', 'playwright')
      await settle()
      expect(foreword(view.editor)).toBe('之后的 AI 写入')
      expect(view.store.currentDocument?.revision).toBe(6)
      expect(info.mock.calls[0]![0]).toMatchObject({ message: 'AI（playwright）已更新文档，已载入最新内容' })
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('创建版本失败（非 409）：不写文档；期间到达的 AI 写入在失败之后照常载入', async () => {
    const view = await mountEditor()
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    try {
      await startVersionSave(view)
      view.source.push(serverWrites('AI 写入的内容'), 'ai', 'playwright')
      await settle()
      expect(foreword(view.editor)).toBe('服务端原文')

      createGates[0]!.gate.reject(new Error('network unavailable'))
      await settle()

      expect(mocks.api.update).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalled()
      expect(String(error.mock.calls[0]![0])).toContain('版本保存失败')
      // 保存已经结束、编辑器没有未保存修改：外部写入此时才被载入
      expect(foreword(view.editor)).toBe('AI 写入的内容')
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('内容在排到这次写入时才读取：前面的自动保存结束后，版本快照与写回文档的是最新的本地内容', async () => {
    const view = await mountEditor()
    try {
      vi.useFakeTimers()
      // 正文自动保存进行中（PUT 还没返回）
      const autosave = deferred<void>()
      mocks.api.update.mockImplementationOnce(async (_id: number, body: any) => {
        await autosave.promise
        server.doc = serverDocument(server.doc.revision + 1, body.content)
        return { data: structuredClone(server.doc) }
      })
      view.editor.commands.insertContent('甲')
      await vi.advanceTimersByTimeAsync(3000)
      await flushMicrotasks()
      expect(mocks.api.update).toHaveBeenCalledTimes(1)

      // 自动保存进行中又输入了新内容，然后点保存版本
      view.editor.commands.insertContent('乙')
      await startVersionSave(view)
      // 排在自动保存之后：创建版本的请求还没有发出
      expect(createGates).toHaveLength(0)

      autosave.resolve()
      await settle()
      expect(createGates).toHaveLength(1)
      const text = JSON.stringify(createGates[0]!.body.content)
      expect(text).toContain('甲')
      expect(text).toContain('乙')
      expect(createGates[0]!.body.content).toEqual(view.editor.getJSON())

      createGates[0]!.gate.resolve()
      await settle()
      // 写回文档的 PUT 使用自动保存响应里的 revision（5），内容是最新的本地内容
      expect(mocks.api.update).toHaveBeenCalledTimes(2)
      expect(mocks.api.update.mock.calls[1]![1].baseRevision).toBe(5)
      expect(JSON.stringify(mocks.api.update.mock.calls[1]![1].content)).toContain('乙')
      expect(view.store.currentDocument?.revision).toBe(6)
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('编辑器正在读取外部修改的最新内容时开始保存版本：读取完成后不再载入，避免之后的 PUT 覆盖外部修改', async () => {
    const view = await mountEditor()
    try {
      // AI 写入，变更事件到达，编辑器开始读取最新内容（读取请求暂时不返回）
      const gate = deferred<void>()
      mocks.api.get.mockImplementationOnce(async () => {
        await gate.promise
        return { data: structuredClone(server.doc) }
      })
      view.source.push(serverWrites('AI 写入的内容'), 'ai', 'playwright')
      await settle()
      expect(mocks.api.get).toHaveBeenCalledTimes(1)

      // 读取期间用户点了保存版本：此刻内容与 revision 都还是旧的
      await startVersionSave(view)
      expect(createGates).toHaveLength(1)

      gate.resolve()
      await settle()
      // 读取完成：有本地写入在进行，不能载入（会把 revision 前移到「内容仍是旧的」状态）
      expect(foreword(view.editor)).toBe('服务端原文')
      expect(view.store.currentDocument?.revision).toBe(4)
      expect(conflictDialogOpen()).toBe(true)

      createGates[0]!.gate.resolve()
      await settle()
      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(4)
      expect(serverForeword()).toBe('AI 写入的内容')
      expect(foreword(view.editor)).toBe('服务端原文')
      expect(banner(view)).not.toBeNull()
    } finally {
      view.unmount()
    }
  })
})
