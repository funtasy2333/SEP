// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import EditorView from './EditorView.vue'
import { createWp6Fixture } from '../extensions/__fixtures__/wp6'

const mocks = vi.hoisted(() => ({
  store: {
    currentDocument: null as any,
    isDocumentUnavailable: vi.fn(),
    markDocumentUnavailable: vi.fn(),
    fetchDocument: vi.fn(),
    updateDocument: vi.fn(),
  },
  editor: null as any,
  editorOptions: null as any,
  routerPush: vi.fn(),
  documentApiUpdate: vi.fn(),
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/api/document', () => ({ documentApi: { update: mocks.documentApiUpdate } }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
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
vi.mock('@/components/editor/DocumentSettingsPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/SlashMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/version/VersionPanel.vue', () => ({ default: { render: () => null } }))

function createDocumentJson() {
  return {
    type: 'doc',
    attrs: {},
    content: [{
      type: 'coverPage',
      attrs: { nodeId: 'stable-cover', standardType: 'national' },
      content: [{ type: 'paragraph', attrs: { nodeId: 'stable-cover-paragraph' } }],
    }],
  }
}

function createDocument() {
  const meta = {
    standardType: 'national',
    standardNo: 'GB/T 00001—2026',
    titleCn: '自动保存回归',
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
  return {
    id: 17,
    title: '自动保存回归',
    meta,
    stage: 'working_draft',
    content: createDocumentJson(),
    updatedAt: '',
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mountEditor() {
  mocks.store.currentDocument = createDocument()
  mocks.store.isDocumentUnavailable.mockReset().mockReturnValue(false)
  mocks.store.markDocumentUnavailable.mockReset()
  mocks.store.fetchDocument.mockReset().mockResolvedValue(undefined)
  mocks.store.updateDocument.mockReset()
  mocks.documentApiUpdate.mockReset().mockResolvedValue(undefined)
  mocks.routerPush.mockReset()
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
    editorProps: {
      handleKeyDown: (view: unknown, event: KeyboardEvent) => boolean
    }
  }
  expect(callbacks).not.toBeNull()
  return {
    root,
    app,
    callbacks,
    updateDocument: mocks.store.updateDocument,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function expectBodyDirty(root: HTMLElement) {
  expect(root.querySelector('[aria-label="正文有未保存修改"]')).not.toBeNull()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('自动保存失败后保留dirty并停止重试，新编辑才会重新安排保存', async () => {
  const view = await mountEditor()
  try {
    view.updateDocument.mockRejectedValueOnce(new Error('network unavailable'))
    vi.useFakeTimers()
    view.callbacks.onUpdate()
    await flushMicrotasks()
    expectBodyDirty(view.root)

    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(1)
    expectBodyDirty(view.root)

    await vi.advanceTimersByTimeAsync(9000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(1)

    view.updateDocument.mockResolvedValueOnce({})
    view.callbacks.onUpdate()
    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(2)
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).toBeNull()
  } finally {
    view.unmount()
  }
})

it('Ctrl+S 在自动保存失败后可以手动重试', async () => {
  const view = await mountEditor()
  try {
    view.updateDocument.mockRejectedValueOnce(new Error('network unavailable'))
    vi.useFakeTimers()
    view.callbacks.onUpdate()
    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(1)
    expectBodyDirty(view.root)

    view.updateDocument.mockResolvedValueOnce({})
    const event = {
      ctrlKey: true,
      metaKey: false,
      key: 's',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent
    expect(view.callbacks.editorProps.handleKeyDown({}, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await flushMicrotasks()

    expect(view.updateDocument).toHaveBeenCalledTimes(2)
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).toBeNull()
    await vi.advanceTimersByTimeAsync(9000)
    expect(view.updateDocument).toHaveBeenCalledTimes(2)
  } finally {
    view.unmount()
  }
})

it.each([
  ['成功', false],
  ['失败', true],
])('保存请求期间新增编辑后，首个请求%s仍只安排一个后续请求', async (_outcome, rejectFirst) => {
  const view = await mountEditor()
  try {
    const firstRequest = deferred<unknown>()
    view.updateDocument
      .mockReturnValueOnce(firstRequest.promise)
      .mockRejectedValueOnce(new Error('second request failed'))
    vi.useFakeTimers()
    view.callbacks.onUpdate()
    await vi.advanceTimersByTimeAsync(3000)
    expect(view.updateDocument).toHaveBeenCalledTimes(1)

    view.callbacks.onUpdate()
    await vi.advanceTimersByTimeAsync(3000)
    expect(view.updateDocument).toHaveBeenCalledTimes(1)
    expectBodyDirty(view.root)

    if (rejectFirst) firstRequest.reject(new Error('first request failed'))
    else firstRequest.resolve({})
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(3000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(2)
    expectBodyDirty(view.root)

    await vi.advanceTimersByTimeAsync(9000)
    await flushMicrotasks()
    expect(view.updateDocument).toHaveBeenCalledTimes(2)
    expectBodyDirty(view.root)
  } finally {
    view.unmount()
  }
})

it('无法生成XML的源码保持诊断并禁用复制/下载，语义JSON仍完整可用', async () => {
  const view = await mountEditor()
  try {
    mocks.editor.getJSON = () => createWp6Fixture()
    const sourceButton = [...view.root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('源码'))!
    sourceButton.click()
    await flushMicrotasks()
    const dialog = document.body.querySelector<HTMLElement>('.ses-code-dlg')!
    const buttons = () => [...dialog.querySelectorAll<HTMLButtonElement>('button')]
    expect(dialog.querySelector('pre')?.textContent).toContain('XML 导出错误')
    expect(buttons().find(button => button.textContent?.trim() === '复制')?.disabled).toBe(true)
    expect(buttons().find(button => button.textContent?.trim() === '下载')?.disabled).toBe(true)
    const jsonRadio = [...dialog.querySelectorAll<HTMLElement>('.el-radio-button')].find(radio => radio.textContent?.includes('语义 JSON'))!
    jsonRadio.click()
    await flushMicrotasks()
    const exported = JSON.parse(dialog.querySelector('pre')!.textContent!)
    expect(exported.attrs.extensionVersion).toBe(1)
    expect(JSON.stringify(exported)).toContain('term-lang-zh')
    expect(buttons().find(button => button.textContent?.trim() === '下载')?.disabled).toBe(false)
  } finally {
    view.unmount()
  }
})
