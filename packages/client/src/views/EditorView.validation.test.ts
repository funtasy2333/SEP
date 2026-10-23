// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValidationWorkerRequest, ValidationWorkerResponse } from '@/validation/analysis.worker'
import { processAnalysisRequest } from '@/validation/analysis.worker'
import { phase6Fixture } from '@/validation/__fixtures__/phase6'
import EditorView from './EditorView.vue'

const mocks = vi.hoisted(() => ({
  store: {
    currentDocument: null as any,
    isDocumentUnavailable: vi.fn(),
    markDocumentUnavailable: vi.fn(),
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
  workers: [] as any[],
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/stores/version', () => ({ useVersionStore: () => ({}) }))
vi.mock('@/api/document', () => ({ documentApi: { update: vi.fn() } }))
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
vi.mock('@/components/editor/TableMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/SesLogo.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/MathInputDialog.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/WhereConversionDialog.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentSettingsPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/version/VersionPanel.vue', () => ({ default: { render: () => null } }))

class WorkerDouble {
  onmessage: ((event: MessageEvent<ValidationWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  request: ValidationWorkerRequest | null = null
  terminated = false
  constructor() { mocks.workers.push(this) }
  postMessage(request: ValidationWorkerRequest) {
    this.request = request
    queueMicrotask(() => {
      if (!this.terminated && this.request) {
        this.onmessage?.({ data: processAnalysisRequest(this.request) } as MessageEvent<ValidationWorkerResponse>)
      }
    })
  }
  terminate() { this.terminated = true }
}

const meta = {
  standardType: 'national', standardNo: 'GB/T 1.1—2020', titleCn: '质量检查接入', titleEn: '',
  icsCode: '', ccsCode: '', issuer: '', applicant: '', proposer: '', technicalCommittee: '',
  replaces: '', consistency: '', publishDate: '', implementDate: '', filingNo: '', industryName: '',
  regionName: '', coverDesignation: '',
}

function createDocument() {
  return {
    id: 17, title: meta.titleCn, meta: { ...meta }, stage: 'working_draft', content: phase6Fixture(), revision: 4, updatedAt: '',
  }
}

async function flush() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function mountEditor(fetchGate: Promise<unknown> = Promise.resolve()) {
  mocks.store.currentDocument = createDocument()
  mocks.store.isDocumentUnavailable.mockReset().mockReturnValue(false)
  mocks.store.fetchDocument.mockReset().mockReturnValue(fetchGate)
  mocks.store.readDocument.mockReset()
  mocks.store.adoptDocument.mockReset().mockImplementation((doc: any) => { mocks.store.currentDocument = doc; return true })
  mocks.store.updateDocument.mockReset().mockResolvedValue(undefined)
  mocks.store.createDocument.mockReset()
  mocks.editor = null
  mocks.editorOptions = null
  mocks.routeGuard = null
  mocks.routerPush.mockReset()
  mocks.workers.length = 0
  vi.stubGlobal('Worker', WorkerDouble)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ htmlToPdf: true }) }))

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(EditorView) })
  app.use(ElementPlus).mount(root)
  await flush()
  return {
    root,
    editor: mocks.editor,
    workers: mocks.workers as WorkerDouble[],
    unmount() { app.unmount(); root.remove() },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('EditorView manual validation integration', () => {
  it('opens the panel without analysis, keeps checking disabled until load, then runs only on an explicit click', async () => {
    const gate = deferred<void>()
    const view = await mountEditor(gate.promise)
    try {
      expect(view.workers).toHaveLength(0)
      view.root.querySelector<HTMLButtonElement>('[aria-label="打开质量检查"]')!.click()
      await nextTick()
      expect(view.root.textContent).toContain('未检查')
      expect(view.workers).toHaveLength(0)
      expect(view.root.querySelector<HTMLButtonElement>('[data-testid="editor-validation-run"]')!.disabled).toBe(true)

      gate.resolve(undefined)
      await flush()
      const run = view.root.querySelector<HTMLButtonElement>('[data-testid="editor-validation-run"]')!
      expect(run.disabled).toBe(false)
      run.click()
      await flush()

      expect(view.workers).toHaveLength(1)
      expect(view.workers[0]!.request?.pmJson).toEqual(view.editor.state.doc.toJSON())
      expect(view.root.textContent).toContain('检查完成')
    } finally {
      view.unmount()
    }
  })

  it('marks an integrated report stale after an editor transaction and does not auto-run again', async () => {
    const view = await mountEditor()
    try {
      view.root.querySelector<HTMLButtonElement>('[data-testid="editor-validation-run"]')!.click()
      await flush()
      expect(view.workers).toHaveLength(1)
      expect(view.root.textContent).toContain('检查完成')

      let position = -1
      view.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.attrs.nodeId === 'scope-p') position = pos
      })
      view.editor.commands.insertContentAt(position + 1, '后续修改')
      await nextTick()

      expect(view.root.textContent).toContain('结果已过期')
      expect(view.root.textContent).toContain('结果已过期，请重新检查')
      expect(view.workers).toHaveLength(1)
      expect(view.root.querySelector('[data-validation-issue-ids]')).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('keeps the validation sidebar mutually exclusive with version history', async () => {
    const view = await mountEditor()
    try {
      const history = [...view.root.querySelectorAll('button')].find(button => button.textContent?.includes('版本历史'))!
      history.click()
      await nextTick()
      expect(view.root.querySelector('[aria-label="关闭质量检查"]')).toBeNull()

      view.root.querySelector<HTMLButtonElement>('[aria-label="打开质量检查"]')!.click()
      await nextTick()
      const closingHistory = view.root.querySelector<HTMLElement>('[data-testid="version-sidebar"]')
      expect(closingHistory === null || closingHistory.classList.contains('slide-right-leave-active')).toBe(true)
      expect(view.root.querySelector('[aria-label="关闭质量检查"]')).not.toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('returns from settings to the editor when a global manual-check button is used', async () => {
    const view = await mountEditor()
    try {
      const settingsTab = [...view.root.querySelectorAll<HTMLButtonElement>('.ed-tab')]
        .find(button => button.textContent?.includes('文件设置'))!
      settingsTab.click()
      await nextTick()
      expect(settingsTab.classList.contains('is-active')).toBe(true)

      view.root.querySelector<HTMLButtonElement>('[data-testid="editor-validation-run"]')!.click()
      await flush()

      expect(view.workers).toHaveLength(1)
      expect(view.root.querySelector('[aria-label="关闭质量检查"]')).not.toBeNull()
      expect(settingsTab.classList.contains('is-active')).toBe(false)
    } finally {
      view.unmount()
    }
  })
})
