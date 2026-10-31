// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import { getSchema } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import EditorView from './EditorView.vue'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { createWp8mFixture } from '../extensions/__fixtures__/wp8m'
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
  exportSesPackage: vi.fn(),
  fetchVersions: vi.fn(),
  editor: null as any,
  editorOptions: null as any,
  routeGuard: null as null | (() => Promise<boolean> | boolean),
  routerPush: vi.fn(),
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/stores/version', () => ({ useVersionStore: () => ({ fetchVersions: mocks.fetchVersions }) }))
vi.mock('@/api/document', () => ({
  documentApi: { update: mocks.documentApiUpdate, exportSesPackage: mocks.exportSesPackage },
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
  titleCn: 'SES 导出回归',
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

function canonicalFixture(): PMJsonNode {
  const node = schema.nodeFromJSON(createWp8mFixture())
  node.check()
  return node.toJSON() as PMJsonNode
}

function createDocument(content = canonicalFixture()) {
  return {
    id: 17,
    title: 'SES 导出回归',
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
  mocks.exportSesPackage.mockReset()
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

async function openSesExport(view: Awaited<ReturnType<typeof mountEditor>>) {
  view.root.querySelector<HTMLButtonElement>('button[aria-label="导出"]')?.click()
  await flush()
  const card = [...document.body.querySelectorAll<HTMLButtonElement>('.export-card')]
    .find((candidate) => candidate.textContent?.includes('SES 文档包')) ?? null
  expect(card).not.toBeNull()
  return card
}

beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:ses'), revokeObjectURL: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('EditorView SES 文档包导出', () => {
  it('先保存脏正文、等待本地写入后再下载完整包，并保留截断告警总数', async () => {
    const view = await mountEditor()
    const order: string[] = []
    const localWrites = deferred<void>()
    mocks.store.waitForPendingUpdates.mockImplementation(() => localWrites.promise)
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as any)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('SES 导出回归.ses')
    })
    mocks.store.updateDocument.mockImplementation(async (_id: number, data: any) => {
      order.push('save')
      const updated = { ...mocks.store.currentDocument, ...data, revision: mocks.store.currentDocument.revision + 1 }
      mocks.store.currentDocument = updated
      return updated
    })
    mocks.exportSesPackage.mockImplementation(async () => {
      order.push('export')
      return {
        blob: new Blob(['{}'], { type: 'application/vnd.ses-package+json' }),
        warningCount: 3,
        warnings: [{ code: 'image-resource-failed', message: '外部图片未打包' }],
        warningsTruncated: true,
      }
    })
    try {
      expect(checkExportGuard(view.editor.state.doc, 'docx')).not.toBeNull()
      view.editor.commands.insertContent('本地新增的正文')
      await flush()
      const card = await openSesExport(view)
      if (!card) return
      card.click()
      await flush()

      expect(order).toEqual(['save'])
      expect(mocks.store.waitForPendingUpdates).toHaveBeenCalledWith(17)
      expect(mocks.exportSesPackage).not.toHaveBeenCalled()
      expect(anchorClick).not.toHaveBeenCalled()

      localWrites.resolve(undefined)
      await flush()
      expect(order).toEqual(['save', 'export'])
      expect(mocks.exportSesPackage).toHaveBeenCalledWith(17)
      expect(anchorClick).toHaveBeenCalledOnce()
      expect(warning).toHaveBeenCalledOnce()
      expect(String(warning.mock.calls[0]?.[0])).toContain('3')
      expect(String(warning.mock.calls[0]?.[0])).toContain('部分告警明细未包含')
    } finally {
      view.unmount()
    }
  })

  it('保存失败或遇到 409 时不调用服务端导出，也不创建下载', async () => {
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
        const card = await openSesExport(view)
        if (!card) return
        card.click()
        await flush()
        expect(mocks.store.updateDocument, error.message).toHaveBeenCalledOnce()
        expect(mocks.exportSesPackage).not.toHaveBeenCalled()
        expect(anchorClick).not.toHaveBeenCalled()
      } finally {
        view.unmount()
        vi.restoreAllMocks()
      }
    }
  })

  it('未保存文件设置仍拦截 SES 导出', async () => {
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
      expect(document.body.querySelector('.export-grid')).toBeNull()
      expect(mocks.exportSesPackage).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('版本面板打开时 import 事件刷新版本列表，正文脏时进入外部冲突', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const view = await mountEditor()
    try {
      view.root.querySelector<HTMLButtonElement>('button[title="版本历史"]')?.click()
      FakeEventSource.instances[0]?.push(5, 'import')
      await flush()
      expect(mocks.fetchVersions).toHaveBeenCalledWith(17, { silent: true })

      view.editor.commands.insertContent('本地待保存正文')
      await flush()
      FakeEventSource.instances[0]?.push(6, 'import')
      await flush()
      expect(view.root.querySelector('[aria-label="保存冲突提示"]')?.textContent)
        .toContain('文档已在其他地方被修改，当前内容未保存')
    } finally {
      view.unmount()
    }
  })
})
