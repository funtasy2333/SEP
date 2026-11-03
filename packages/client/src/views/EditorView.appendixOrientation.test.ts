// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pmToIr } from '@ses/shared'
import type { ValidationWorkerRequest, ValidationWorkerResponse } from '@/validation/analysis.worker'
import { processAnalysisRequest } from '@/validation/analysis.worker'
import { chapter, paragraph, text } from '@/validation/__fixtures__/phase6'
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
    // 与 @tiptap/vue-3 一致：每笔事务后触发重新渲染，工具栏按选区更新。
    useEditor: (options: any) => {
      mocks.editorOptions = options
      const editorRef = vue.shallowRef<any>(null)
      mocks.editor = new ProductionEditor({
        ...options,
        onTransaction: (props: any) => { options.onTransaction?.(props); vue.triggerRef(editorRef) },
      })
      editorRef.value = mocks.editor
      return editorRef
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

function riskDocument() {
  return {
    type: 'doc', content: [
      chapter('c1', '范围', 'scope', paragraph('p1', text('本文件规定了检验方法。'))),
      { type: 'appendix', attrs: { nodeId: 'app-b', normative: false }, content: [
        { type: 'appendixLabel', content: [text('（资料性）')] },
        { type: 'appendixTitle', content: [text('方法验证汇总')] },
        paragraph('lead', text('方法参数及验证结果见表B.1。')),
      ] },
    ],
  }
}

function createDocument() {
  return {
    id: 17, title: meta.titleCn, meta: { ...meta }, stage: 'working_draft', content: riskDocument(), revision: 4, updatedAt: '',
  }
}

async function flush() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
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

function positionOf(editor: any, needle: string): number {
  let found = -1
  editor.state.doc.descendants((node: any, pos: number) => {
    if (found < 0 && node.isText && node.text.includes(needle)) found = pos + node.text.indexOf(needle)
  })
  if (found < 0) throw new Error(`text not found: ${needle}`)
  return found
}

function group(root: HTMLElement) {
  return root.querySelector<HTMLElement>('[data-testid="appendix-orientation"]')
}

function button(root: HTMLElement, label: string) {
  const found = [...(group(root)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => item.textContent?.trim() === label)
  if (!found) throw new Error(`button missing: ${label}`)
  return found
}

function appendixAttrs(editor: any) {
  let attrs: any = null
  editor.state.doc.descendants((node: any) => {
    if (node.type.name === 'appendix') attrs = node.attrs
  })
  return attrs
}

describe('EditorView 附录版面（#75）', () => {
  it('光标在正文时不显示；进入附录后可设为横向、撤销，并写入 IR', async () => {
    const view = await mountEditor()
    try {
      const editor = view.editor
      editor.commands.setTextSelection(positionOf(editor, '本文件规定'))
      await flush()
      expect(group(view.root)).toBeNull()

      editor.commands.setTextSelection(positionOf(editor, '方法参数'))
      await flush()
      expect(group(view.root)).not.toBeNull()
      expect(button(view.root, '纵向').classList.contains('is-active')).toBe(true)

      button(view.root, '横向').click()
      await flush()
      expect(appendixAttrs(editor).orientation).toBe('landscape')
      expect(button(view.root, '横向').classList.contains('is-active')).toBe(true)
      expect(pmToIr(editor.getJSON()).doc.appendices[0]!.orientation).toBe('landscape')
      expect(editor.getText()).toContain('方法参数及验证结果见表B.1。')

      editor.commands.undo()
      await flush()
      expect(appendixAttrs(editor).orientation ?? null).toBeNull()

      editor.commands.redo()
      await flush()
      button(view.root, '纵向').click()
      await flush()
      expect(appendixAttrs(editor).orientation).toBeNull()
      expect(Object.prototype.hasOwnProperty.call(pmToIr(editor.getJSON()).doc.appendices[0]!, 'orientation')).toBe(false)
    } finally {
      view.unmount()
    }
  })
})
