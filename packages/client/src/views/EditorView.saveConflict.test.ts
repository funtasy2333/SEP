// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import EditorView from './EditorView.vue'

const mocks = vi.hoisted(() => ({
  store: {
    currentDocument: null as any,
    fetchDocument: vi.fn(),
    readDocument: vi.fn(),
    adoptDocument: vi.fn(),
    updateDocument: vi.fn(),
    createDocument: vi.fn(),
  },
  editor: null as any,
  editorOptions: null as any,
  routeGuard: null as null | (() => Promise<boolean> | boolean),
  routerPush: vi.fn(),
  documentApiUpdate: vi.fn(),
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/api/document', () => ({ documentApi: { update: mocks.documentApiUpdate } }))
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
// 设置面板：一个标题输入框 + 保存按钮 + 错误标记，足够驱动设置保存路径。
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
          vue.h('input', {
            'data-testid': 'settings-stage',
            value: props.draft.stage,
            onInput: (event: Event) => { props.draft.stage = (event.target as HTMLInputElement).value },
          }),
          vue.h('button', { 'data-testid': 'settings-save', onClick: () => emit('save') }, '保存设置'),
          vue.h('span', { 'data-testid': 'settings-error' }, props.saveError ? 'error' : ''),
        ])
      },
    },
  }
})
// 版本面板：一个按钮模拟「创建版本后写文档时遇到 409」。
vi.mock('@/components/version/VersionPanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: {
      emits: ['close', 'conflict'],
      setup(_props: unknown, { emit }: any) {
        return () => vue.h('button', { 'data-testid': 'version-conflict', onClick: () => emit('conflict') }, 'version')
      },
    },
  }
})

const baseMeta = {
  standardType: 'national',
  standardNo: 'GB/T 00001—2026',
  titleCn: '冲突回归',
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

function documentJson(text: string, nodeId = 'stable-paragraph') {
  return {
    type: 'doc',
    attrs: {},
    content: [{
      type: 'coverPage',
      attrs: { nodeId: 'stable-cover', standardType: 'national', titleCn: baseMeta.titleCn },
      content: [{ type: 'paragraph', attrs: { nodeId } }],
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

function createDocument(revision = 4, text = '服务端原文', titleCn = baseMeta.titleCn) {
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

function conflictError() {
  return Object.assign(new Error('Request failed with status code 409'), {
    response: { status: 409, data: { statusCode: 409, message: '文档已被修改', revision: 5 } },
  })
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

/** 让 Vue 过渡（对话框开关）走完；假定时器下需要推进时间。 */
async function settle() {
  await flushMicrotasks()
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(100)
  await flushMicrotasks()
}

async function mountEditor() {
  mocks.store.currentDocument = createDocument()
  mocks.store.fetchDocument.mockReset().mockResolvedValue(undefined)
  mocks.store.readDocument.mockReset()
  // 与真实 store 一致：adoptDocument 把读到的文档装为当前文档（这里只模拟「revision 前进」的成功情形）。
  mocks.store.adoptDocument.mockReset().mockImplementation((doc: any) => {
    mocks.store.currentDocument = doc
    return true
  })
  mocks.store.updateDocument.mockReset()
  mocks.store.createDocument.mockReset()
  mocks.documentApiUpdate.mockReset().mockResolvedValue(undefined)
  mocks.routerPush.mockReset()
  mocks.routeGuard = null
  mocks.editor = null
  mocks.editorOptions = null
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ htmlToPdf: true }),
  }))

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(EditorView) })
  app.use(ElementPlus).mount(root)
  await flushMicrotasks()

  const callbacks = mocks.editorOptions as {
    onUpdate: () => void
    editorProps: { handleKeyDown: (view: unknown, event: KeyboardEvent) => boolean }
  }
  expect(callbacks).not.toBeNull()
  // 初次加载会调用一次 fetchDocument；之后的调用才是冲突处理产生的。
  mocks.store.fetchDocument.mockClear()
  return {
    root,
    callbacks,
    editor: mocks.editor,
    updateDocument: mocks.store.updateDocument,
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
/** el-dialog 关闭后内容仍留在 DOM 中，只是外层遮罩 display:none。 */
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
function pressSave(view: View) {
  const event = { ctrlKey: true, metaKey: false, key: 's', preventDefault: vi.fn() } as unknown as KeyboardEvent
  expect(view.callbacks.editorProps.handleKeyDown({}, event)).toBe(true)
}
/** 编辑正文并等待自动保存请求发出。 */
async function editBodyAndAutosave(view: View, text = '本地新增的正文') {
  view.editor.commands.insertContent(text)
  await vi.advanceTimersByTimeAsync(3000)
  await flushMicrotasks()
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

it('正文自动保存收到 409：内容保留、暂停自动保存、出现冲突提示，关闭后保留状态入口', async () => {
  const view = await mountEditor()
  const messageError = vi.spyOn(ElMessage, 'error')
  try {
    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(conflictError())
    await editBodyAndAutosave(view)

    expect(view.updateDocument).toHaveBeenCalledTimes(1)
    // 提示：对话框 + 常驻横幅 + 状态胶囊，并且没有走泛化的「保存失败」消息
    expect(conflictDialogOpen()).toBe(true)
    expect(conflictDialog()!.textContent).toContain('文档已在其他地方被修改')
    expect(conflictDialog()!.textContent).toContain('当前内容未保存')
    expect(banner(view)!.textContent).toContain('文档已在其他地方被修改，当前内容未保存')
    expect(pill(view)).toContain('存在冲突')
    expect(messageError).not.toHaveBeenCalled()
    // 编辑器内容与未保存标记都还在
    expect(foreword(view.editor)).toContain('本地新增的正文')
    expect(bodyDirtyMark(view)).not.toBeNull()

    // 之后的编辑不再触发自动保存
    view.editor.commands.insertContent('冲突后的又一次编辑')
    view.callbacks.onUpdate()
    await vi.advanceTimersByTimeAsync(30000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(1)

    // Ctrl+S 也不会再发请求，而是重新弹出冲突提示
    clickButton(conflictDialog()!, '稍后处理')
    await settle()
    expect(conflictDialogOpen()).toBe(false)
    pressSave(view)
    await settle()
    expect(view.updateDocument).toHaveBeenCalledTimes(1)
    expect(conflictDialogOpen()).toBe(true)

    // 关闭提示后横幅仍在，且可以重新打开
    clickButton(conflictDialog()!, '稍后处理')
    await settle()
    expect(conflictDialogOpen()).toBe(false)
    expect(banner(view)).not.toBeNull()
    expect(pill(view)).toContain('存在冲突')
    clickButton(banner(view)!, '处理冲突')
    await settle()
    expect(conflictDialogOpen()).toBe(true)
  } finally {
    view.unmount()
  }
})

it('非 409 的保存失败保持原有提示，不进入冲突状态', async () => {
  const view = await mountEditor()
  const messageError = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
  try {
    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }))
    await editBodyAndAutosave(view)

    expect(messageError).toHaveBeenCalledWith('保存失败；正文仍保留在编辑器中')
    expect(banner(view)).toBeNull()
    expect(conflictDialog()).toBeNull()
    expect(pill(view)).not.toContain('冲突')
  } finally {
    view.unmount()
  }
})

it('文件设置保存收到 409：设置草稿与正文都保留，同样暂停自动保存', async () => {
  const view = await mountEditor()
  const messageError = vi.spyOn(ElMessage, 'error')
  try {
    const titleInput = view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!
    titleInput.value = '未保存的新题名'
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushMicrotasks()

    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(conflictError())
    view.root.querySelector<HTMLButtonElement>('[data-testid="settings-save"]')!.click()
    await flushMicrotasks()

    expect(view.updateDocument).toHaveBeenCalledTimes(1)
    expect(conflictDialogOpen()).toBe(true)
    expect(conflictDialog()!.textContent).toContain('文件设置的修改也尚未保存')
    expect(banner(view)).not.toBeNull()
    expect(messageError).not.toHaveBeenCalled()
    expect(view.root.querySelector('[data-testid="settings-error"]')!.textContent).toBe('error')
    expect(view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!.value).toBe('未保存的新题名')

    // 冲突期间再点保存设置、再编辑正文，都不会发请求
    view.root.querySelector<HTMLButtonElement>('[data-testid="settings-save"]')!.click()
    view.editor.commands.insertContent('冲突期间的编辑')
    await vi.advanceTimersByTimeAsync(30000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
  }
})

it('版本面板保存版本后写文档遇到 409：编辑器进入同一冲突状态', async () => {
  const view = await mountEditor()
  try {
    clickButton(view.root, '版本历史')
    await flushMicrotasks()
    view.root.querySelector<HTMLButtonElement>('[data-testid="version-conflict"]')!.click()
    await flushMicrotasks()

    expect(conflictDialogOpen()).toBe(true)
    expect(conflictDialog()!.textContent).toContain('版本快照已保存')
    expect(banner(view)).not.toBeNull()
    expect(view.updateDocument).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})

it('重新加载：二次确认后载入最新内容，刷新设置草稿，清除冲突并恢复自动保存', async () => {
  const view = await mountEditor()
  const confirm = vi.spyOn(ElMessageBox, 'confirm')
  try {
    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(conflictError())
    await editBodyAndAutosave(view)
    const titleInput = view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!
    titleInput.value = '本地设置草稿'
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushMicrotasks()
    expect(conflictDialogOpen()).toBe(true)

    // 取消二次确认：什么都不变
    confirm.mockRejectedValueOnce('cancel')
    clickButton(conflictDialog()!, '重新加载')
    await flushMicrotasks()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0]![0])).toContain('放弃')
    expect(mocks.store.readDocument).not.toHaveBeenCalled()
    expect(banner(view)).not.toBeNull()
    expect(foreword(view.editor)).toContain('本地新增的正文')

    // 确认后：读取最新文档、替换编辑器内容，再把读到的文档装进 store
    const latest = createDocument(5, 'AI 刚写入的内容', '服务端最新题名')
    mocks.store.readDocument.mockResolvedValue(latest)
    confirm.mockResolvedValueOnce(undefined as any)
    clickButton(conflictDialog()!, '重新加载')
    await flushMicrotasks()

    expect(mocks.store.readDocument).toHaveBeenCalledWith(17)
    // 不再用 fetchDocument（它会在校验之前就改写 store）
    expect(mocks.store.fetchDocument).not.toHaveBeenCalled()
    expect(mocks.store.adoptDocument).toHaveBeenCalledWith(latest)
    await settle()
    expect(foreword(view.editor)).toBe('AI 刚写入的内容')
    expect(view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!.value).toBe('服务端最新题名')
    expect(banner(view)).toBeNull()
    expect(conflictDialogOpen()).toBe(false)
    expect(bodyDirtyMark(view)).toBeNull()
    expect(pill(view)).not.toContain('冲突')
    expect(pill(view)).not.toContain('待保存')
    // 重载不能被撤销：否则旧内容会回到编辑器并在下次自动保存时覆盖最新版本
    view.editor.commands.undo()
    expect(foreword(view.editor)).toBe('AI 刚写入的内容')
    expect(view.updateDocument).toHaveBeenCalledTimes(1)

    // 自动保存恢复
    view.updateDocument.mockResolvedValueOnce({})
    view.editor.commands.insertContent('冲突解决后的编辑')
    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(2)
    expect(view.updateDocument.mock.calls[1]![1].content).toBeDefined()
  } finally {
    view.unmount()
  }
})

it('重新加载失败时保持冲突状态与本地内容', async () => {
  const view = await mountEditor()
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue(undefined as any)
  const messageError = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
  try {
    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(conflictError())
    await editBodyAndAutosave(view)

    const before = mocks.store.currentDocument
    mocks.store.readDocument.mockRejectedValueOnce(new Error('network unavailable'))
    clickButton(conflictDialog()!, '重新加载')
    await flushMicrotasks()

    expect(confirm).toHaveBeenCalledOnce()
    expect(String(messageError.mock.calls[0]?.[0])).toContain('重新加载失败')
    expect(mocks.store.adoptDocument).not.toHaveBeenCalled()
    expect(mocks.store.currentDocument).toBe(before)
    expect(banner(view)).not.toBeNull()
    expect(foreword(view.editor)).toContain('本地新增的正文')
    expect(bodyDirtyMark(view)).not.toBeNull()
  } finally {
    view.unmount()
  }
})

it('另存为副本：用当前编辑器内容和未保存的设置新建文档并进入副本，原文档不被写入', async () => {
  const view = await mountEditor()
  try {
    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(conflictError())
    await editBodyAndAutosave(view)
    const titleInput = view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!
    titleInput.value = '带草稿的新题名'
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    const stageInput = view.root.querySelector<HTMLInputElement>('[data-testid="settings-stage"]')!
    stageInput.value = 'committee_draft'
    stageInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushMicrotasks()

    mocks.store.createDocument.mockImplementation(async (data: any) => ({ ...data, id: 99, revision: 0 }))
    clickButton(conflictDialog()!, '另存为副本')
    await flushMicrotasks()

    expect(mocks.store.createDocument).toHaveBeenCalledOnce()
    const copy = mocks.store.createDocument.mock.calls[0]![0]
    expect(copy.title).toBe('带草稿的新题名（副本）')
    expect(copy.meta.titleCn).toBe('带草稿的新题名（副本）')
    // 未保存的阶段草稿同样带入副本
    expect(copy.stage).toBe('committee_draft')
    expect(JSON.stringify(copy.content)).toContain('本地新增的正文')
    // 原文档：没有再被写入，也没有被重新拉取（保持服务端版本）
    expect(view.updateDocument).toHaveBeenCalledTimes(1)
    expect(mocks.store.readDocument).not.toHaveBeenCalled()
    expect(mocks.store.fetchDocument).not.toHaveBeenCalled()
    // 进入副本的编辑器，本页的冲突/未保存状态已清除，离开不会再被拦截
    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'editor', params: { id: 99 } })
    expect(banner(view)).toBeNull()
    expect(bodyDirtyMark(view)).toBeNull()
    expect(await mocks.routeGuard!()).toBe(true)
  } finally {
    view.unmount()
  }
})

it('另存为副本失败时保持冲突状态，不跳转', async () => {
  const view = await mountEditor()
  const messageError = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
  try {
    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(conflictError())
    await editBodyAndAutosave(view)

    mocks.store.createDocument.mockRejectedValueOnce(new Error('network unavailable'))
    clickButton(conflictDialog()!, '另存为副本')
    await flushMicrotasks()

    expect(String(messageError.mock.calls[0]?.[0])).toContain('另存为副本失败')
    expect(mocks.routerPush).not.toHaveBeenCalled()
    expect(banner(view)).not.toBeNull()
    expect(foreword(view.editor)).toContain('本地新增的正文')
  } finally {
    view.unmount()
  }
})

it('冲突状态下离开页面需要确认放弃，不会再发保存请求', async () => {
  const view = await mountEditor()
  const confirm = vi.spyOn(ElMessageBox, 'confirm')
  try {
    vi.useFakeTimers()
    view.updateDocument.mockRejectedValueOnce(conflictError())
    await editBodyAndAutosave(view)
    expect(view.updateDocument).toHaveBeenCalledTimes(1)

    confirm.mockRejectedValueOnce('cancel')
    expect(await mocks.routeGuard!()).toBe(false)
    confirm.mockResolvedValueOnce(undefined as any)
    expect(await mocks.routeGuard!()).toBe(true)
    expect(String(confirm.mock.calls[0]![0])).toContain('尚未保存')
    expect(view.updateDocument).toHaveBeenCalledTimes(1)

    // 放弃后离开：卸载时的兜底保存也不会发出
    view.unmount()
    expect(mocks.documentApiUpdate).not.toHaveBeenCalled()
  } finally {
    // 重复卸载无副作用
    view.root.remove()
  }
})

it('离开页面前保存遇到 409：停留在页面并显示冲突提示，不叠加泛化失败消息', async () => {
  const view = await mountEditor()
  const messageWarning = vi.spyOn(ElMessage, 'warning')
  try {
    view.editor.commands.insertContent('离开前的编辑')
    view.updateDocument.mockRejectedValueOnce(conflictError())
    expect(await mocks.routeGuard!()).toBe(false)
    await flushMicrotasks()

    expect(conflictDialogOpen()).toBe(true)
    expect(banner(view)).not.toBeNull()
    expect(messageWarning).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})

it('卸载时的兜底保存带上 baseRevision；遇到 409 提示未保存', async () => {
  const view = await mountEditor()
  const messageWarning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
  view.editor.commands.insertContent('卸载前的编辑')
  mocks.documentApiUpdate.mockRejectedValueOnce(conflictError())
  view.unmount()
  await flushMicrotasks()

  expect(mocks.documentApiUpdate).toHaveBeenCalledOnce()
  const [id, payload] = mocks.documentApiUpdate.mock.calls[0]!
  expect(id).toBe(17)
  expect(payload.baseRevision).toBe(4)
  expect(JSON.stringify(payload.content)).toContain('卸载前的编辑')
  expect(String(messageWarning.mock.calls[0]?.[0])).toContain('未保存')
})
