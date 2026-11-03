// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSearchState } from '@/extensions/plugins/searchHighlight'
import { undoDepth } from '@tiptap/pm/history'
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

function riskDocument() {
  return {
    type: 'doc', content: [
      chapter('c1', '范围', 'scope',
        paragraph('p1', text('执业过程中面临多种风险因素，亟需建立')),
        paragraph('p2', text('第二处风险。')),
        paragraph('p3', text('第三处风险。'))),
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

function searchInput(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('.tbar-search input')
  if (!input) throw new Error('search input missing')
  return input
}

async function typeQuery(input: HTMLInputElement, value: string) {
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

/** 模拟一次完整按键：keydown 发到当前焦点元素，keyup 同样发到（可能已变化的）焦点元素。 */
async function pressKey(key: string, init: KeyboardEventInit = {}) {
  const target = (document.activeElement ?? document.body) as HTMLElement
  const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(down)
  await flush()
  const upTarget = (document.activeElement ?? document.body) as HTMLElement
  upTarget.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init }))
  await flush()
  return down
}

function countText(root: HTMLElement) {
  return root.querySelector('[data-testid="search-count"]')?.textContent ?? ''
}

function matchedText(editor: any) {
  const state = getSearchState(editor.state)
  const match = state.matches[state.current]
  return match ? editor.state.doc.textBetween(match.from, match.to) : null
}

describe('EditorView 查找（#76）', () => {
  it('连续回车依次定位每一处，焦点留在查找框，正文、选区和保存状态都不变', async () => {
    const view = await mountEditor()
    try {
      const editor = view.editor
      document.body.append(editor.view.dom)
      const before = JSON.stringify(editor.getJSON())
      const selection = editor.state.selection.toJSON()
      const depth = undoDepth(editor.state)
      const input = searchInput(view.root)
      await typeQuery(input, '风险')

      const first = await pressKey('Enter')
      expect(first.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(input)
      expect(countText(view.root)).toBe('1/3')
      expect(getSearchState(editor.state).current).toBe(0)

      await pressKey('Enter')
      expect(document.activeElement).toBe(input)
      expect(countText(view.root)).toBe('2/3')
      await pressKey('Enter')
      expect(countText(view.root)).toBe('3/3')
      await pressKey('Enter')
      expect(countText(view.root)).toBe('1/3')
      await pressKey('Enter', { shiftKey: true })
      expect(countText(view.root)).toBe('3/3')
      expect(matchedText(editor)).toBe('风险')

      expect(JSON.stringify(editor.getJSON())).toBe(before)
      expect(editor.getText()).toContain('多种风险因素，亟需建立')
      expect(editor.state.selection.toJSON()).toEqual(selection)
      expect(undoDepth(editor.state)).toBe(depth)
      expect(mocks.store.updateDocument).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('输入法确认候选词的回车不触发查找', async () => {
    const view = await mountEditor()
    try {
      const input = searchInput(view.root)
      await typeQuery(input, '风险')
      await pressKey('Enter', { isComposing: true })
      await pressKey('Enter', { keyCode: 229 } as KeyboardEventInit)
      expect(getSearchState(view.editor.state).query).toBe('')
      expect(countText(view.root)).toBe('')
    } finally {
      view.unmount()
    }
  })

  it('无匹配时显示 0/0 且不改正文；改查询词后旧高亮清除', async () => {
    const view = await mountEditor()
    try {
      const before = JSON.stringify(view.editor.getJSON())
      const input = searchInput(view.root)
      await typeQuery(input, '不存在的词')
      await pressKey('Enter')
      expect(countText(view.root)).toBe('0/0')
      await typeQuery(input, '风险')
      expect(countText(view.root)).toBe('')
      await pressKey('Enter')
      expect(countText(view.root)).toBe('1/3')
      expect(JSON.stringify(view.editor.getJSON())).toBe(before)
    } finally {
      view.unmount()
    }
  })

  it('Esc 回到正文：光标落在当前命中之后、不选中文字，之后回车按原规则分段', async () => {
    const view = await mountEditor()
    try {
      const editor = view.editor
      document.body.append(editor.view.dom)
      const input = searchInput(view.root)
      await typeQuery(input, '风险')
      await pressKey('Enter')
      const match = getSearchState(editor.state).matches[0]
      await pressKey('Escape')
      expect(getSearchState(editor.state).query).toBe('')
      expect(countText(view.root)).toBe('')
      expect(editor.state.selection.empty).toBe(true)
      expect(editor.state.selection.from).toBe(match.to)

      editor.commands.splitBlock()
      expect(editor.getText()).toContain('多种风险')
      expect(editor.getText()).toContain('因素，亟需建立')
    } finally {
      view.unmount()
    }
  })
})
