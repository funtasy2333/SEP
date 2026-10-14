// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EditorView from './EditorView.vue'
import { useDocumentStore } from '@/stores/document'

/**
 * 冲突后「重新加载」：真实的 EditorView + 真实的 VersionPanel + 真实的 pinia store，
 * 服务端（documentApi / versionApi / EventSource）用模拟实现，PUT 按 baseRevision 判断 409。
 *
 * 要防的问题：重新加载若先把服务端文档装进 store（fetchDocument）、再校验内容，服务端内容不符合编辑器 schema 时
 * 校验失败，页面声称「本页内容保持不变」，store 却已是「远端 revision + 远端 meta」、编辑器仍是旧内容。
 * 冲突期间仍可用的「保存版本」随后会带着旧内容和新 revision 的 PUT 成功，覆盖远端修改，而不是 409。
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
      data: JSON.stringify({ documentId: 17, revision, source, ...(client ? { client } : {}), at: '2026-10-14T00:00:00.000Z' }),
    }
    for (const listener of this.listeners.get('document-changed') ?? []) listener(event)
  }
}

// ---------- 模拟服务端 ----------
const baseMeta = {
  standardType: 'national',
  standardNo: 'GB/T 00001—2026',
  titleCn: '冲突重载回归',
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

function documentJson(text: string, titleCn = baseMeta.titleCn) {
  return {
    type: 'doc',
    attrs: {},
    content: [{
      type: 'coverPage',
      attrs: { nodeId: 'stable-cover', standardType: 'national', titleCn },
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

/** 不符合编辑器 schema 的内容：含有 schema 里不存在的节点类型。 */
function invalidContent() {
  return {
    type: 'doc',
    attrs: {},
    content: [{ type: 'noSuchNode', attrs: { nodeId: 'broken' } }],
  }
}

function serverDocument(revision: number, content: Record<string, unknown>, titleCn = baseMeta.titleCn) {
  return {
    id: 17,
    title: titleCn,
    meta: { ...baseMeta, titleCn },
    stage: 'working_draft',
    content,
    revision,
    updatedAt: '',
  }
}

const server = { doc: serverDocument(4, documentJson('服务端原文')), versions: [] as any[] }

/** 服务端上有人写入（AI）：revision 加 1，题名一并变化，返回新 revision。 */
function serverWrites(content: Record<string, unknown>, titleCn = '远端新题名') {
  server.doc = serverDocument(server.doc.revision + 1, content, titleCn)
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
  server.doc = serverDocument(4, documentJson('服务端原文'))
  server.versions = []
  createGates = []
  for (const fn of Object.values(mocks.api)) fn.mockReset()
  for (const fn of Object.values(mocks.versionApi)) fn.mockReset()
  mocks.api.get.mockImplementation(async () => ({ data: structuredClone(server.doc) }))
  // 与真实服务端一致：baseRevision 与当前 revision 不一致就 409，成功则 revision 加 1。
  mocks.api.update.mockImplementation(async (_id: number, body: any) => {
    if (body.baseRevision !== server.doc.revision) throw conflictError()
    server.doc = serverDocument(server.doc.revision + 1, body.content ?? server.doc.content, server.doc.meta.titleCn)
    return { data: structuredClone(server.doc) }
  })
  mocks.versionApi.listByDocument.mockImplementation(async () => ({ data: structuredClone(server.versions) }))
  mocks.versionApi.create.mockImplementation(async (body: any) => {
    const entry = { body: structuredClone(body), gate: deferred<void>() }
    createGates.push(entry)
    await entry.gate.promise
    const created = { ...structuredClone(body), id: server.versions.length + 1, createdAt: '2026-10-14T00:00:00.000Z' }
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
  // 初次加载读过一次文档；之后的 get 才是冲突处理产生的。
  mocks.api.get.mockClear()
  let mounted = true
  return {
    root,
    editor: mocks.editor,
    store: useDocumentStore(),
    source: FakeEventSource.instances[0]!,
    unmount() {
      if (!mounted) return
      mounted = false
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

const conflictDialog = () => document.body.querySelector<HTMLElement>('.ses-conflict-dlg')
const conflictDialogOpen = () => {
  const overlay = conflictDialog()?.closest<HTMLElement>('.el-overlay')
  return Boolean(overlay) && overlay!.style.display !== 'none'
}
const banner = (view: View) => view.root.querySelector<HTMLElement>('[aria-label="保存冲突提示"]')
/** 「保存版本」对话框（冲突对话框也在 body 里，不能直接取第一个 footer）。 */
const versionDialog = () => [...document.body.querySelectorAll<HTMLElement>('.el-dialog')]
  .find((dialog) => textOf(dialog.querySelector('.el-dialog__title') ?? dialog) === '保存版本')

/** 冲突期间仍可用：打开版本面板，点「保存版本」，在对话框里点「确定」，让创建版本的请求返回。 */
async function saveVersionDuringConflict(view: View) {
  clickButton(view.root, '版本历史')
  await settle()
  clickButton(view.root.querySelector('.version-panel .header-actions')!, '保存版本')
  await settle()
  clickButton(versionDialog()!.querySelector('.el-dialog__footer')!, '确定')
  await flushMicrotasks()
  expect(createGates).toHaveLength(1)
  createGates[0]!.gate.resolve()
  await settle()
}

/** 本地有未保存修改时服务端写入，变更事件直接让页面进入冲突（不读取内容）。 */
async function enterConflictByExternalWrite(view: View, revision: number) {
  view.editor.commands.insertContent('我正在输入')
  await flushMicrotasks()
  view.source.push(revision, 'ai', 'playwright')
  await settle()
  expect(banner(view)).not.toBeNull()
  expect(conflictDialogOpen()).toBe(true)
  expect(mocks.api.get).not.toHaveBeenCalled()
}

function foreword(editor: any): string {
  return editor.getJSON().content.find((node: any) => node.type === 'foreword').content[0].content?.[0]?.text ?? ''
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('冲突后重新加载：先校验再装入 store', () => {
  it('服务端内容不符合 schema：报错，store 的 revision/meta 与编辑器内容都不变；随后「保存版本」得到 409，远端内容不被覆盖', async () => {
    const view = await mountEditor()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(undefined as any)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const success = vi.spyOn(ElMessage, 'success')
    const warning = vi.spyOn(ElMessage, 'warning')
    try {
      vi.useFakeTimers()
      // store 里是响应式对象，先转成普通对象留一份打开时的快照
      const openedDocument = JSON.parse(JSON.stringify(view.store.currentDocument))
      expect(openedDocument?.revision).toBe(4)

      // 本地有未保存的输入，此时远端写入了装不进编辑器的内容（revision 5、题名也变了）
      const invalid = invalidContent()
      const remoteRevision = serverWrites(invalid)
      expect(remoteRevision).toBe(5)
      await enterConflictByExternalWrite(view, remoteRevision)
      const localContent = view.editor.getJSON()

      clickButton(conflictDialog()!, '重新加载')
      await settle()

      // 读取了一次远端文档，校验失败
      expect(confirm).toHaveBeenCalledOnce()
      expect(mocks.api.get).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]![0])).toContain('重新加载失败，本页内容保持不变')
      expect(success).not.toHaveBeenCalled()
      // store 完全没有改动：revision、meta、内容、updatedAt 都还是打开时的样子
      expect(view.store.currentDocument?.revision).toBe(4)
      expect(view.store.currentDocument?.meta.titleCn).toBe(baseMeta.titleCn)
      expect(view.store.currentDocument).toEqual(openedDocument)
      // 编辑器内容、冲突状态都保持
      expect(view.editor.getJSON()).toEqual(localContent)
      expect(foreword(view.editor)).toContain('我正在输入')
      expect(banner(view)).not.toBeNull()
      expect(conflictDialogOpen()).toBe(true)

      // 冲突期间「保存版本」仍可用：它的 PUT 读取 store 的 revision——必须还是 4，因此被服务端 409，而不是覆盖远端
      await saveVersionDuringConflict(view)
      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(4)
      expect(server.doc.revision).toBe(5)
      expect(server.doc.content).toEqual(invalid)
      expect(server.doc.meta.titleCn).toBe('远端新题名')
      expect(view.store.currentDocument?.revision).toBe(4)
      expect(warning).toHaveBeenCalledWith('版本已保存，但文档已在其他地方被修改，当前编辑内容未保存')
      expect(banner(view)).not.toBeNull()
      // 版本快照里是本地内容，没有丢
      expect(server.versions).toHaveLength(1)
      expect(JSON.stringify(server.versions[0].content)).toContain('我正在输入')
    } finally {
      view.unmount()
    }
  })

  it('对照：服务端内容合法时重新加载成功，store 前进到远端 revision 与 meta，冲突解除，之后保存基于新 revision', async () => {
    const view = await mountEditor()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(undefined as any)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const success = vi.spyOn(ElMessage, 'success')
    try {
      vi.useFakeTimers()
      const remote = documentJson('AI 写入的内容', '远端新题名')
      const remoteRevision = serverWrites(remote)
      await enterConflictByExternalWrite(view, remoteRevision)
      expect(view.store.currentDocument?.revision).toBe(4)

      clickButton(conflictDialog()!, '重新加载')
      await settle()

      expect(confirm).toHaveBeenCalledOnce()
      expect(mocks.api.get).toHaveBeenCalledTimes(1)
      expect(error).not.toHaveBeenCalled()
      expect(success).toHaveBeenCalledWith('已载入最新内容')
      // 编辑器与 store 都是服务端的那一份
      expect(foreword(view.editor)).toBe('AI 写入的内容')
      expect(view.store.currentDocument?.revision).toBe(5)
      expect(view.store.currentDocument?.meta.titleCn).toBe('远端新题名')
      expect(view.store.currentDocument?.content).toEqual(remote)
      // 冲突解除
      expect(banner(view)).toBeNull()
      expect(conflictDialogOpen()).toBe(false)

      // 之后的「保存版本」基于 revision 5，写入成功，不再 409
      await saveVersionDuringConflict(view)
      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(5)
      expect(server.doc.revision).toBe(6)
      expect(view.store.currentDocument?.revision).toBe(6)
      expect(success).toHaveBeenCalledWith('版本保存成功')
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('服务端 revision 不大于本地（服务端回滚 / 从备份恢复）：adoptDocument 不会前进，仍以服务端为准，之后的保存基于服务端 revision', async () => {
    const view = await mountEditor()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(undefined as any)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    try {
      vi.useFakeTimers()
      // 服务端回到了更早的 revision（2），本地仍记着 4：自动保存带 baseRevision 4 得到 409，进入冲突
      server.doc = serverDocument(2, documentJson('从备份恢复的内容'), '恢复后的题名')
      view.editor.commands.insertContent('我正在输入')
      await vi.advanceTimersByTimeAsync(3000)
      await settle()
      expect(mocks.api.update).toHaveBeenCalledTimes(1)
      expect(mocks.api.update.mock.calls[0]![1].baseRevision).toBe(4)
      expect(banner(view)).not.toBeNull()
      expect(view.store.currentDocument?.revision).toBe(4)

      clickButton(conflictDialog()!, '重新加载')
      await settle()

      expect(error).not.toHaveBeenCalled()
      expect(foreword(view.editor)).toBe('从备份恢复的内容')
      // store 与编辑器一致，都是服务端的（revision 2）；若保留本地的 4，之后每次保存都会 409
      expect(view.store.currentDocument?.revision).toBe(2)
      expect(view.store.currentDocument?.meta.titleCn).toBe('恢复后的题名')
      expect(banner(view)).toBeNull()
      expect(conflictDialogOpen()).toBe(false)

      view.editor.commands.insertContent('恢复后继续写')
      await vi.advanceTimersByTimeAsync(3000)
      await settle()
      expect(mocks.api.update).toHaveBeenCalledTimes(2)
      expect(mocks.api.update.mock.calls[1]![1].baseRevision).toBe(2)
      expect(server.doc.revision).toBe(3)
      expect(view.store.currentDocument?.revision).toBe(3)
      expect(banner(view)).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('读取最新内容期间页面被离开：不再改动编辑器与 store，也不弹出失败提示', async () => {
    const view = await mountEditor()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(undefined as any)
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const success = vi.spyOn(ElMessage, 'success')
    try {
      vi.useFakeTimers()
      const remoteRevision = serverWrites(documentJson('AI 写入的内容', '远端新题名'))
      await enterConflictByExternalWrite(view, remoteRevision)

      // 重新加载的读取请求暂时不返回，此时离开页面
      const gate = deferred<void>()
      mocks.api.get.mockImplementationOnce(async () => {
        await gate.promise
        return { data: structuredClone(server.doc) }
      })
      clickButton(conflictDialog()!, '重新加载')
      await settle()
      expect(mocks.api.get).toHaveBeenCalledTimes(1)
      view.unmount()

      gate.resolve()
      await settle()
      expect(view.store.currentDocument?.revision).toBe(4)
      expect(view.store.currentDocument?.meta.titleCn).toBe(baseMeta.titleCn)
      expect(error).not.toHaveBeenCalled()
      expect(success).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
})
