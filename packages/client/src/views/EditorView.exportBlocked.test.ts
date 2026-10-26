// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import { getSchema } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import EditorView from './EditorView.vue'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { createWp8mFixture } from '../extensions/__fixtures__/wp8m'

/**
 * 导出被阻止时的提示（WP8.M M-Z-c F-1）：真实的 EditorView 载入 WP8.M 全要素文档，点导出 → DOCX，
 * 对话框里应是“一行概述 + 逐条一行的明细”，而不是把全部问题连成一整段。
 * happy-dom 不做布局，限高、滚动、折行等样式由浏览器走查确认（见 docs/wp8.m/validation.md F-1）；这里断言结构与文字。
 */

const mocks = vi.hoisted(() => ({
  store: {
    currentDocument: null as any,
    isDocumentUnavailable: vi.fn(),
    markDocumentUnavailable: vi.fn(),
    fetchDocument: vi.fn(),
    updateDocument: vi.fn(),
  },
  editor: null as any,
  routerPush: vi.fn(),
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/api/document', () => ({ documentApi: { update: vi.fn() } }))
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

const schema = getSchema(createEditorExtensions())

/** 经生产 Schema 规范化后的全要素文档，与 API 保存、编辑器持有的形态一致。 */
function canonicalFixture(): PMJsonNode {
  const node = schema.nodeFromJSON(createWp8mFixture())
  node.check()
  return node.toJSON() as PMJsonNode
}

function createDocument(content: PMJsonNode) {
  return {
    id: 17,
    title: '导出阻断提示回归',
    meta: {
      standardType: 'national',
      standardNo: 'GB/T 00001—2026',
      titleCn: '导出阻断提示回归',
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
    },
    stage: 'working_draft',
    content,
    updatedAt: '',
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mountEditor(content: PMJsonNode) {
  mocks.store.currentDocument = createDocument(content)
  mocks.store.isDocumentUnavailable.mockReset().mockReturnValue(false)
  mocks.store.markDocumentUnavailable.mockReset()
  mocks.store.fetchDocument.mockReset().mockResolvedValue(undefined)
  mocks.store.updateDocument.mockReset()
  mocks.routerPush.mockReset()
  mocks.editor = null
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ htmlToPdf: true }) }))

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(EditorView) })
  app.use(ElementPlus).mount(root)
  await flushMicrotasks()
  return {
    root,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

const compact = (element: Element) => (element.textContent ?? '').replace(/\s/g, '')

function clickByText(selector: string, label: string) {
  const target = [...document.body.querySelectorAll<HTMLElement>(selector)]
    .find((candidate) => compact(candidate).includes(label))
  if (!target) throw new Error(`找不到 ${selector}：${label}`)
  target.click()
}

async function openExportAndChoose(label: string) {
  clickByText('button', '导出')
  await flushMicrotasks()
  clickByText('.export-card', label)
  await flushMicrotasks()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('导出被阻止的提示分行显示', () => {
  it('全要素文档导出 DOCX：一行概述，15 处阻断逐条各占一行，格式卡片仍在对话框内', async () => {
    const view = await mountEditor(canonicalFixture())
    const error = vi.spyOn(ElMessage, 'error')
    try {
      await openExportAndChoose('DOCX')

      const alert = document.body.querySelector<HTMLElement>('.export-error')
      expect(alert, '应显示导出被阻止的提示').not.toBeNull()
      expect(alert!.getAttribute('role')).toBe('alert')

      // 概述：一行，不含任何明细
      const summary = alert!.querySelector('.export-error-text')!
      expect(summary.textContent).toBe('导出被阻止：DOCX 暂未支持 15 处内容')

      // 明细：一个问题一条 <li>，没有被连成一段
      const items = [...alert!.querySelectorAll('.export-error-items > li')].map((li) => li.textContent ?? '')
      expect(items).toHaveLength(15)
      for (const item of items) {
        expect(item).toMatch(/^DOCX /)
        expect(item).toContain('请保留 JSON 文档。')
        expect(item).toMatch(/【(节点 [^】，]+，)?位置 [^】]+】$/)
        expect(item).not.toContain('；DOCX')
      }
      // 与 WP8.M 的暂不排版结构对应：图例、行内图、图中示例、单元格边框、列宽
      const all = items.join('\n')
      expect(all).toContain('legend')
      expect(all).toContain('image')
      expect(all).toContain('examples')
      expect(all).toContain('style')
      expect(all).toContain('columns')

      // 概述中不出现明细，明细中不再带“导出被阻止：”前缀
      for (const item of items) {
        expect(summary.textContent).not.toContain(item)
        expect(item).not.toContain('导出被阻止')
      }

      // 提示只是对话框里的一块，格式卡片仍然渲染（限高与内部滚动由样式保证）
      const dialog = alert!.closest('.el-dialog')!
      expect(dialog.querySelectorAll('.export-card').length).toBeGreaterThanOrEqual(5)
      // 提示在格式卡片之上（卡片不会被挤出对话框的结构）
      expect(dialog.querySelector('.export-grid')!.compareDocumentPosition(alert!) & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0)

      // 弹出的简短提示保持原样（概述 + 另有 N 项）
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]![0])).toMatch(/^导出被阻止：DOCX 暂未支持此信息：.*（另有 14 项，详见导出详情）$/)
    } finally {
      view.unmount()
    }
  })

  it('重新打开导出对话框会清掉先前的提示和明细', async () => {
    const view = await mountEditor(canonicalFixture())
    vi.spyOn(ElMessage, 'error')
    try {
      await openExportAndChoose('DOCX')
      expect(document.body.querySelectorAll('.export-error-items > li')).toHaveLength(15)

      // 再次点工具栏“导出”会重置对话框状态：旧提示不应残留
      clickByText('button', '导出')
      await flushMicrotasks()
      expect(document.body.querySelector('.export-error')).toBeNull()
      expect(document.body.querySelector('.export-error-items')).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('同一文档对 HTML 也被阻止时，概述的格式名随所选格式变化', async () => {
    const view = await mountEditor(canonicalFixture())
    vi.spyOn(ElMessage, 'error')
    try {
      await openExportAndChoose('HTML')
      const summary = document.body.querySelector('.export-error-text')!
      expect(summary.textContent).toMatch(/^导出被阻止：HTML 暂未支持 \d+ 处内容$/)
      const items = document.body.querySelectorAll('.export-error-items > li')
      expect(items.length).toBe(Number(/(\d+) 处内容/.exec(summary.textContent!)![1]))
      for (const item of items) expect(item.textContent).toMatch(/^HTML /)
    } finally {
      view.unmount()
    }
  })
})
