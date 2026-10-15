// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EditorView from './EditorView.vue'
import { createDefaultDocumentContent } from '@/utils/newDocument'
import { NODE_ID_TYPES } from '@/extensions/plugins/ensureNodeId'
import { TABLE_CONTINUATION_STORAGE_KEY } from '@/utils/docxExportPrefs'
import type { DocumentMeta } from '@ses/shared'

const mocks = vi.hoisted(() => ({
  store: {
    currentDocument: null as any,
    fetchDocument: vi.fn(),
    updateDocument: vi.fn(),
  },
  editor: null as any,
  buildDocxBlob: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/api/document', () => ({ documentApi: { update: vi.fn() } }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: () => undefined,
  useRoute: () => ({ params: { id: '17' } }),
  useRouter: () => ({ push: mocks.routerPush }),
}))
vi.mock('@/serializer', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/serializer')>(),
  buildDocxBlob: mocks.buildDocxBlob,
}))
vi.mock('@tiptap/vue-3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/vue-3')>()
  const vue = await import('vue')
  return {
    ...actual,
    useEditor: (options: any) => {
      const editorRef = actual.useEditor(options)
      vue.watch(editorRef, (value: any) => { mocks.editor = value }, { immediate: true })
      return editorRef
    },
  }
})
vi.mock('@/components/editor/EditorContent.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentOutline.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentSettingsPanel.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/SlashMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/version/VersionPanel.vue', () => ({ default: { render: () => null } }))

const meta = {
  standardType: 'national', standardNo: 'GB/T 00001—2026', titleCn: '续表方式', titleEn: '',
  icsCode: '', ccsCode: '', issuer: '', applicant: '', proposer: '', technicalCommittee: '',
  replaces: '', consistency: '', publishDate: '', implementDate: '', filingNo: '',
  industryName: '', regionName: '', coverDesignation: '',
} as DocumentMeta

function stableContent() {
  const content = structuredClone(createDefaultDocumentContent(meta) as any)
  let index = 0
  const visit = (node: any) => {
    if (NODE_ID_TYPES.includes(node.type)) node.attrs = { ...node.attrs, nodeId: `stable-${index++}` }
    node.content?.forEach(visit)
  }
  visit(content)
  return content
}

async function flush() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mountEditor() {
  mocks.store.currentDocument = { id: 17, title: '续表方式', meta, stage: 'working_draft', content: stableContent(), updatedAt: '' }
  mocks.store.fetchDocument.mockReset().mockResolvedValue(undefined)
  mocks.store.updateDocument.mockReset().mockImplementation(async (_id: number, update: any) => {
    mocks.store.currentDocument = { ...mocks.store.currentDocument, ...update }
    return mocks.store.currentDocument
  })
  mocks.editor = null
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ htmlToPdf: true }) }))
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(EditorView) })
  app.use(ElementPlus).mount(root)
  await flush()
  if (!mocks.editor) throw new Error('生产 Tiptap Editor 未挂载')
  return { root, unmount() { app.unmount(); root.remove() } }
}

const radios = () => [...document.body.querySelectorAll<HTMLElement>('[data-testid="docx-table-continuation"] .el-radio-button')]
const radio = (label: string) => radios().find(item => item.textContent?.includes(label))!

async function openExport(root: HTMLElement) {
  const exportButton = [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.getAttribute('aria-label') === '导出')!
  exportButton.click()
  await flush()
}

const docxCard = () => [...document.body.querySelectorAll<HTMLButtonElement>('.export-card')]
  .find(button => button.textContent?.includes('DOCX'))!

beforeEach(() => {
  localStorage.removeItem(TABLE_CONTINUATION_STORAGE_KEY)
  mocks.buildDocxBlob.mockReset().mockResolvedValue({ blob: new Blob(['docx']), warnings: [] })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:docx')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

it('导出对话框提供“续表方式”，默认自动续表（定稿），导出时传给 buildDocxBlob', async () => {
  const view = await mountEditor()
  try {
    await openExport(view.root)
    expect(radios().map(item => item.textContent?.trim())).toEqual(['自动续表（定稿）', 'Word 自然分页（编辑稿）'])
    expect(radio('自动续表').classList.contains('is-active')).toBe(true)
    docxCard().click()
    await flush()
    expect(mocks.buildDocxBlob).toHaveBeenCalledOnce()
    expect(mocks.buildDocxBlob.mock.calls[0]![0]).toMatchObject({ tableContinuation: 'split' })
  } finally {
    view.unmount()
  }
})

it('选择 Word 自然分页后保存到 localStorage、传给导出，并在重新打开时恢复', async () => {
  const view = await mountEditor()
  try {
    await openExport(view.root)
    radio('Word 自然分页').querySelector('input')!.click()
    await flush()
    expect(localStorage.getItem(TABLE_CONTINUATION_STORAGE_KEY)).toBe('natural')
    expect(document.body.querySelector('.export-option-hint')?.textContent).toContain('表X（续）')
    docxCard().click()
    await flush()
    expect(mocks.buildDocxBlob.mock.calls[0]![0]).toMatchObject({ tableContinuation: 'natural' })
  } finally {
    view.unmount()
  }

  document.body.innerHTML = ''
  const reopened = await mountEditor()
  try {
    await openExport(reopened.root)
    expect(radio('Word 自然分页').classList.contains('is-active')).toBe(true)
  } finally {
    reopened.unmount()
  }
})

it('localStorage 抛错时仍可导出，回退默认的自动续表', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  const view = await mountEditor()
  try {
    await openExport(view.root)
    radio('Word 自然分页').querySelector('input')!.click()
    await flush()
    docxCard().click()
    await flush()
    expect(mocks.buildDocxBlob.mock.calls[0]![0]).toMatchObject({ tableContinuation: 'natural' })
  } finally {
    view.unmount()
  }
})
