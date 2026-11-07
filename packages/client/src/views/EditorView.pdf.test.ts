// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import { getSchema } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import EditorView from './EditorView.vue'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { checkExportGuard } from '@ses/io'

const mocks = vi.hoisted(() => ({
  store: {
    currentDocument: null as any,
    isDocumentUnavailable: vi.fn(),
    markDocumentUnavailable: vi.fn(),
    fetchDocument: vi.fn(),
    readDocument: vi.fn(),
    adoptDocument: vi.fn(),
    adoptRevision: vi.fn(),
    hasPendingUpdates: vi.fn(),
    waitForPendingUpdates: vi.fn(),
    updateDocument: vi.fn(),
    createDocument: vi.fn(),
  },
  documentApiUpdate: vi.fn(),
  exportPdf: vi.fn(),
  fetchVersions: vi.fn(),
  editor: null as any,
  editorOptions: null as any,
  routeGuard: null as null | (() => Promise<boolean> | boolean),
  routerPush: vi.fn(),
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/stores/version', () => ({ useVersionStore: () => ({ fetchVersions: mocks.fetchVersions }) }))
vi.mock('@/api/document', () => ({
  documentApi: { update: mocks.documentApiUpdate, exportPdf: mocks.exportPdf },
}))
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
            value: props.draft?.titleCn ?? '',
            onInput: (event: Event) => { if (props.draft) props.draft.titleCn = (event.target as HTMLInputElement).value },
          }),
          vue.h('button', { 'data-testid': 'settings-save', onClick: () => emit('save') }, '保存设置'),
        ])
      },
    },
  }
})
vi.mock('@/components/version/VersionPanel.vue', () => ({ default: { render: () => null } }))

const schema = getSchema(createEditorExtensions())
const baseMeta = {
  standardType: 'national',
  standardNo: 'GB/T 00017—2026',
  titleCn: 'PDF 导出回归',
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

/** 最小的合法正文：一章一段，能通过导出前检查。 */
function canonicalFixture(): PMJsonNode {
  const node = schema.nodeFromJSON({
    type: 'doc',
    content: [{
      type: 'chapter',
      attrs: { nodeId: 'chapter-1' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
        { type: 'stdParagraph', attrs: { nodeId: 'p-1' }, content: [{ type: 'text', text: '正文。' }] },
      ],
    }],
  })
  node.check()
  return node.toJSON() as PMJsonNode
}

function createDocument(content = canonicalFixture()) {
  return {
    id: 17,
    title: 'PDF 导出回归',
    meta: { ...baseMeta },
    stage: 'working_draft',
    content,
    revision: 4,
    updatedAt: '',
  }
}

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
  close() { this.readyState = 2 }
  push(revision: number, source: string) {
    for (const listener of this.listeners.get('document-changed') ?? []) {
      listener({ data: JSON.stringify({ documentId: 17, revision, source }) })
    }
  }
}

async function flush() {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

async function mountEditor(content = canonicalFixture()) {
  mocks.store.currentDocument = createDocument(content)
  mocks.store.isDocumentUnavailable.mockReset().mockReturnValue(false)
  mocks.store.markDocumentUnavailable.mockReset()
  mocks.store.fetchDocument.mockReset().mockResolvedValue(undefined)
  mocks.store.readDocument.mockReset().mockImplementation(async () => mocks.store.currentDocument)
  mocks.store.adoptDocument.mockReset().mockImplementation((document: any) => {
    mocks.store.currentDocument = document
    return true
  })
  mocks.store.adoptRevision.mockReset().mockReturnValue(true)
  mocks.store.hasPendingUpdates.mockReset().mockReturnValue(false)
  mocks.store.waitForPendingUpdates.mockReset().mockResolvedValue(undefined)
  mocks.store.updateDocument.mockReset().mockImplementation(async (_id: number, data: any) => {
    const updated = { ...mocks.store.currentDocument, ...data, revision: mocks.store.currentDocument.revision + 1 }
    mocks.store.currentDocument = updated
    return updated
  })
  mocks.store.createDocument.mockReset()
  mocks.documentApiUpdate.mockReset()
  mocks.exportPdf.mockReset()
  mocks.fetchVersions.mockReset().mockResolvedValue([])
  mocks.routerPush.mockReset()
  mocks.editor = null
  mocks.editorOptions = null
  mocks.routeGuard = null
  FakeEventSource.instances = []
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ htmlToPdf: true }) }))

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(EditorView) })
  app.use(ElementPlus).mount(root)
  await flush()
  return {
    root,
    editor: mocks.editor,
    updateDocument: mocks.store.updateDocument,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

async function openPdfExport(view: Awaited<ReturnType<typeof mountEditor>>) {
  view.root.querySelector<HTMLButtonElement>('button[aria-label="导出"]')?.click()
  await flush()
  const card = [...document.body.querySelectorAll<HTMLButtonElement>('.export-card')]
    .find((candidate) => candidate.textContent?.includes('PDF')) ?? null
  expect(card).not.toBeNull()
  return card
}

beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('EditorView PDF 导出（服务端按文档 id 导出）', () => {
  it('夹具本身能通过 PDF 导出前检查', async () => {
    const view = await mountEditor()
    try {
      expect(checkExportGuard(view.editor.state.doc, 'pdf')).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('先保存脏正文、等待本地写入后再请求服务端导出，并下载 PDF；不再请求 html-to-pdf', async () => {
    const view = await mountEditor()
    const order: string[] = []
    const localWrites = deferred<void>()
    mocks.store.waitForPendingUpdates.mockImplementation(() => localWrites.promise)
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as any)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('PDF 导出回归.pdf')
    })
    mocks.store.updateDocument.mockImplementation(async (_id: number, data: any) => {
      order.push('save')
      const updated = { ...mocks.store.currentDocument, ...data, revision: mocks.store.currentDocument.revision + 1 }
      mocks.store.currentDocument = updated
      return updated
    })
    mocks.exportPdf.mockImplementation(async () => {
      order.push('export')
      return { blob: new Blob(['%PDF']), warningCount: 0, warnings: [], warningsTruncated: false }
    })
    const fetchMock = vi.mocked(fetch)
    try {
      view.editor.commands.insertContent('本地新增的正文')
      await flush()
      const card = await openPdfExport(view)
      card?.click()
      await flush()

      expect(order).toEqual(['save'])
      expect(mocks.store.waitForPendingUpdates).toHaveBeenCalledWith(17)
      expect(mocks.exportPdf).not.toHaveBeenCalled()
      expect(anchorClick).not.toHaveBeenCalled()

      localWrites.resolve(undefined)
      await flush()
      expect(order).toEqual(['save', 'export'])
      expect(mocks.exportPdf).toHaveBeenCalledWith(17)
      expect(anchorClick).toHaveBeenCalledOnce()
      expect(success).toHaveBeenCalledWith('PDF 文件已导出')
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('html-to-pdf'))).toBe(false)
    } finally {
      view.unmount()
    }
  })

  it('正文没有未保存修改时不保存，直接导出', async () => {
    const view = await mountEditor()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    mocks.exportPdf.mockResolvedValue({ blob: new Blob(['%PDF']), warningCount: 0, warnings: [], warningsTruncated: false })
    try {
      const card = await openPdfExport(view)
      card?.click()
      await flush()
      expect(mocks.store.updateDocument).not.toHaveBeenCalled()
      expect(mocks.exportPdf).toHaveBeenCalledWith(17)
    } finally {
      view.unmount()
    }
  })

  it('有外部图片告警时用警告提示，写明未嵌入的张数', async () => {
    const view = await mountEditor()
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as any)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    mocks.exportPdf.mockResolvedValue({
      blob: new Blob(['%PDF']),
      warningCount: 2,
      warnings: [{ code: 'image-resource-failed', message: 'x' }],
      warningsTruncated: false,
    })
    try {
      const card = await openPdfExport(view)
      card?.click()
      await flush()
      expect(warning).toHaveBeenCalledWith('PDF 已导出；2 张外部图片未嵌入（服务端导出不访问网络资源）')
      expect(success).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('保存失败或遇到 409 时不请求服务端导出，也不创建下载', async () => {
    for (const error of [
      new Error('save failed'),
      Object.assign(new Error('revision changed'), { response: { status: 409, data: { message: 'revision changed' } } }),
    ]) {
      const view = await mountEditor()
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
      try {
        view.editor.commands.insertContent('未保存的正文')
        await flush()
        mocks.store.updateDocument.mockClear()
        mocks.store.updateDocument.mockRejectedValueOnce(error)
        const card = await openPdfExport(view)
        card?.click()
        await flush()
        expect(mocks.store.updateDocument, error.message).toHaveBeenCalledOnce()
        expect(mocks.exportPdf).not.toHaveBeenCalled()
        expect(anchorClick).not.toHaveBeenCalled()
      } finally {
        view.unmount()
        vi.restoreAllMocks()
      }
    }
  })

  it('服务端拒绝（422 导出前检查未通过 / 503 缺依赖 / 500）时显示原因，不下载', async () => {
    for (const message of ['导出被阻止：脚注未定义', 'PDF 导出不可用：服务端 IR→HTML→PDF 管线缺少依赖：poppler', 'PDF 导出失败：vivliostyle 退出码 1']) {
      const view = await mountEditor()
      const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
      const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
      mocks.exportPdf.mockRejectedValueOnce(new Error(message))
      try {
        const card = await openPdfExport(view)
        card?.click()
        await flush()
        expect(anchorClick).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledOnce()
        expect(String(error.mock.calls[0]?.[0])).toContain(message)
        expect(String(error.mock.calls[0]?.[0])).toContain('PDF 导出失败：')
        expect(document.body.textContent).toContain(message)
      } finally {
        view.unmount()
        vi.restoreAllMocks()
      }
    }
  })

  it('未保存文件设置仍拦截 PDF 导出', async () => {
    const view = await mountEditor()
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
    try {
      const title = view.root.querySelector<HTMLInputElement>('[data-testid="settings-title"]')!
      title.value = '未保存题名'
      title.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
      view.root.querySelector<HTMLButtonElement>('button[aria-label="导出"]')?.click()
      await flush()
      expect(warning).toHaveBeenCalledWith('文件设置有未保存修改，请先保存或重置')
      expect(mocks.exportPdf).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
})
