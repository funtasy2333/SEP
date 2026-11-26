// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TemplateEditorView from './TemplateEditorView.vue'
import { replaceEditorDocument } from '@/utils/editorDocument'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  fetchTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  revertTemplate: vi.fn(),
  createTemplate: vi.fn(),
  onEditorUpdate: null as null | (() => void),
  emitEditorUpdate: null as null | (() => void),
  previewDocx: vi.fn(),
  editorGetJSON: vi.fn(() => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '初始正文' }] }] })),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '42' } }),
  useRouter: () => ({ push: mocks.routerPush }),
  onBeforeRouteLeave: vi.fn(),
}))

vi.mock('@/stores/template', () => ({
  useTemplateStore: () => ({
    fetchTemplate: mocks.fetchTemplate,
    updateTemplate: mocks.updateTemplate,
    revertTemplate: mocks.revertTemplate,
    createTemplate: mocks.createTemplate,
  }),
}))

vi.mock('@/api/template', () => ({
  templateApi: {
    exportPackage: vi.fn(),
    previewDocx: mocks.previewDocx,
    previewPdf: vi.fn(),
  },
}))

vi.mock('@/composables/useStandardEditorCore', () => ({
  useStandardEditorCore: (options: { onUpdate?: () => void }) => {
    mocks.onEditorUpdate = options.onUpdate ?? null
    let suppressed = false
    mocks.emitEditorUpdate = () => { if (!suppressed) options.onUpdate?.() }
    return {
      editor: ref({
        setEditable: vi.fn(),
        getJSON: mocks.editorGetJSON,
        chain: () => ({ focus: () => ({ insertContent: () => ({ run: vi.fn() }) }) }),
      }),
      hasUnappliedLandscapeEdits: () => false,
      setSuppressUpdate: (value: boolean) => { suppressed = value },
    }
  },
}))

vi.mock('@/utils/editorDocument', () => ({
  replaceEditorDocument: vi.fn((_editor, _content, emitUpdate = true) => {
    if (emitUpdate) mocks.emitEditorUpdate?.()
    return true
  }),
}))

vi.mock('@/components/editor/StandardEditorToolbar.vue', () => ({
  default: defineComponent({ render: () => h('div', { 'data-testid': 'stub-toolbar' }) }),
}))

vi.mock('@/components/editor/StandardEditorCanvas.vue', () => ({
  default: defineComponent({ render: () => h('div', { 'data-testid': 'stub-canvas' }) }),
}))

describe('TemplateEditorView UI 与无障碍交互', () => {
  const roots: HTMLElement[] = []

  afterEach(() => {
    for (const r of roots.splice(0)) r.remove()
    vi.clearAllMocks()
  })

  it('loads and reverts without marking the body dirty or saving before preview', async () => {
    setActivePinia(createPinia())
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    for (const method of ['success', 'warning', 'info', 'error'] as const) {
      vi.spyOn(ElMessage, method).mockImplementation(() => ({ close: vi.fn() }) as never)
    }
    const template = {
      id: 42, uid: 'template-42', name: '模板', description: '', baseType: 'group', defaultStage: 'working_draft',
      defaultMeta: {}, content: { type: 'doc', content: [] }, source: 'human', readonly: false,
      revision: 3, hasPreviousContent: true,
    }
    mocks.fetchTemplate.mockResolvedValue(template)
    mocks.revertTemplate.mockResolvedValue({ ...template, revision: 4 })
    mocks.previewDocx.mockResolvedValue(new Blob(['docx']))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const root = document.createElement('div')
    document.body.append(root)
    roots.push(root)
    const app = createApp(TemplateEditorView)
    app.use(ElementPlus).mount(root)
    await nextTick(); await nextTick(); await nextTick()
    try {
      const save = root.querySelector<HTMLButtonElement>('[data-testid="template-save-btn"]')!
      const body = root.querySelector<HTMLElement>('[data-testid="template-tab-body"]')!
      expect(save.disabled).toBe(true)
      expect(body.querySelector('.tab-dirty-mark')).toBeNull()
      root.querySelector<HTMLButtonElement>('[data-testid="template-preview-docx-btn"]')!.click()
      await nextTick(); await nextTick(); await nextTick()
      expect(mocks.previewDocx).toHaveBeenCalledWith(42)
      expect(mocks.updateTemplate).not.toHaveBeenCalled()

      mocks.emitEditorUpdate?.()
      await nextTick()
      expect(save.disabled).toBe(false)
      expect(body.querySelector('.tab-dirty-mark')).not.toBeNull()

      root.querySelector<HTMLButtonElement>('[data-testid="template-more-actions-btn"]')!.click()
      await nextTick(); await nextTick()
      document.querySelector<HTMLElement>('[data-testid="template-revert-btn"]')!.click()
      await nextTick(); await nextTick(); await nextTick()
      expect(mocks.revertTemplate).toHaveBeenCalledWith(42, 3)
      expect(save.disabled).toBe(true)
      expect(body.querySelector('.tab-dirty-mark')).toBeNull()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
      root.querySelector<HTMLButtonElement>('[data-testid="template-preview-docx-btn"]')!.click()
      await nextTick(); await nextTick(); await nextTick()
      expect(mocks.previewDocx).toHaveBeenCalledTimes(2)
      expect(mocks.updateTemplate).not.toHaveBeenCalled()
      mocks.emitEditorUpdate?.()
      await nextTick()
      expect(save.disabled).toBe(false)
    } finally {
      app.unmount()
      vi.restoreAllMocks()
    }
  })

  it('支持 ARIA tablist 键盘切换、分分页脏标记以及自适应/固定缩放与页序预览', async () => {
    setActivePinia(createPinia())
    mocks.fetchTemplate.mockResolvedValue({
      id: 42,
      uid: 'tpl-zsm-1',
      name: '浙江省团体标准模板',
      description: '适用团体标准起草',
      baseType: 'group',
      defaultStage: 'working_draft',
      defaultMeta: { stdPrefix: 'T/ZSM', issuer: '省学会' },
      coverLayout: {
        backCover: { enabled: true, blocks: [{ id: 'b1', type: 'heading', text: '版权保护文件' }] },
        watermark: { enabled: true, kind: 'text', frequency: 'alternate', text: '内部草案' },
      },
      content: { type: 'doc', content: [] },
      source: 'human',
      readonly: false,
      revision: 3,
    })

    const root = document.createElement('div')
    document.body.append(root)
    roots.push(root)

    const app = createApp(TemplateEditorView)
    app.use(ElementPlus).mount(root)
    await nextTick()
    await nextTick()
    await nextTick()

    try {
      const tablist = root.querySelector<HTMLElement>('[role="tablist"]')!
      const bodyTab = root.querySelector<HTMLButtonElement>('[data-testid="template-tab-body"]')!
      const metaTab = root.querySelector<HTMLButtonElement>('[data-testid="template-tab-meta"]')!
      const layoutTab = root.querySelector<HTMLButtonElement>('[data-testid="template-tab-layout"]')!
      expect(bodyTab.getAttribute('aria-selected')).toBe('true')
      expect(metaTab.getAttribute('tabindex')).toBe('-1')

      // ArrowRight 选择跟随焦点切换至模板元信息页签
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      await nextTick()
      expect(metaTab.getAttribute('aria-selected')).toBe('true')
      expect(metaTab.getAttribute('tabindex')).toBe('0')

      // 修改模板名称只点亮元信息页签脏标记，不误标版式页签
      const nameInput = root.querySelector<HTMLInputElement>('input[data-testid="template-name-input"]')!
      nameInput.value = '浙江省团体标准新模板'
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(metaTab.querySelector('.tab-dirty-mark')).not.toBeNull()
      expect(layoutTab.querySelector('.tab-dirty-mark')).toBeNull()

      // End 键直达封面与封底版式页签，检验页序与缩放控件
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      await nextTick()
      expect(layoutTab.getAttribute('aria-selected')).toBe('true')
      const previewHeader = root.querySelector('.preview-header')?.textContent ?? ''
      expect(previewHeader).toContain('第1页 封面')
      expect(previewHeader).toContain('第2页 版权页（不计页码）')
      expect(previewHeader).toContain('正文水印示例')

      const fitBtn = root.querySelector<HTMLButtonElement>('[data-testid="preview-zoom-fit"]')!
      const zoom50Btn = root.querySelector<HTMLButtonElement>('[data-testid="preview-zoom-50"]')!
      expect(fitBtn.classList.contains('is-active')).toBe(true)
      zoom50Btn.click()
      await nextTick()
      expect(zoom50Btn.classList.contains('is-active')).toBe(true)
      const iframe = root.querySelector<HTMLIFrameElement>('[data-testid="template-cover-preview-iframe"]')!
      const srcdoc = iframe.getAttribute('srcdoc') ?? ''
      expect(srcdoc).toContain('color-scheme:light')
      expect(srcdoc.indexOf('ses-cover')).toBeLessThan(srcdoc.indexOf('ses-back-cover'))
      expect(srcdoc.indexOf('ses-back-cover')).toBeLessThan(srcdoc.indexOf('ses-body-preview'))
    } finally {
      app.unmount()
    }
  })

  it('保存时保留未在表单展示的 defaultMeta 字段，且不覆盖保存期间产生的新正文编辑', async () => {
    setActivePinia(createPinia())
    for (const method of ['success', 'warning', 'info', 'error'] as const) {
      vi.spyOn(ElMessage, method).mockImplementation(() => ({ close: vi.fn() }) as never)
    }

    const baseTpl = {
      id: 42,
      uid: 'tpl-zsm-1',
      name: '带扩展预设模板',
      description: '含 titleEn 等非表单字段',
      baseType: 'group' as const,
      defaultStage: 'working_draft' as const,
      defaultMeta: {
        stdPrefix: 'T/ZSM',
        titleEn: 'Zhejiang Group Standard',
        standardNo: 'T/ZSM 001—2026',
        publishDate: '2026-05-01',
        implementDate: '2026-08-01',
        issuer: '省学会',
      },
      coverLayout: undefined,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '初始正文' }] }] },
      source: 'import' as const,
      readonly: false,
      revision: 3,
    }
    mocks.fetchTemplate.mockResolvedValue(baseTpl)

    let resolveSave!: (value: unknown) => void
    mocks.updateTemplate.mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    const root = document.createElement('div')
    document.body.append(root)
    roots.push(root)

    const app = createApp(TemplateEditorView)
    app.use(ElementPlus).mount(root)
    await nextTick()
    await nextTick()
    await nextTick()

    const replaceMock = vi.mocked(replaceEditorDocument)
    const initialReplaceCalls = replaceMock.mock.calls.length

    try {
      // 修改模板名称（表单字段）并触发一次正文编辑
      const metaTab = root.querySelector<HTMLButtonElement>('[data-testid="template-tab-meta"]')!
      metaTab.click()
      await nextTick()
      const nameInput = root.querySelector<HTMLInputElement>('input[data-testid="template-name-input"]')!
      nameInput.value = '改名后的模板'
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      const standardNoInput = root.querySelector<HTMLTextAreaElement>('textarea[data-testid="template-standard-no-input"]')!
      expect(standardNoInput?.value).toBe('T/ZSM 001—2026')
      standardNoInput.value = ' T/CCFAGS 032—2022\n\n T/CAPPMA 02—2022 '
      standardNoInput.dispatchEvent(new Event('input', { bubbles: true }))
      const issuerInput = root.querySelector<HTMLTextAreaElement>('textarea[data-testid="template-issuer-input"]')!
      issuerInput.value = ' 中国连锁经营协会\n 中国水产流通与加工协会 '
      issuerInput.dispatchEvent(new Event('input', { bubbles: true }))
      mocks.onEditorUpdate?.()
      await nextTick()

      const preview = root.querySelector<HTMLIFrameElement>('[data-testid="template-cover-preview-iframe"]')!.srcdoc
      expect(preview).toContain('.ses-cover-issuer-multiple {')
      expect(preview).toContain('<div>T/CCFAGS 032—2022</div><div>T/CAPPMA 02—2022</div>')
      expect(preview).toContain('<div>中国连锁经营协会</div><div>中国水产流通与加工协会</div>')

      // 点击保存（请求暂未返回）
      const saveBtn = root.querySelector<HTMLButtonElement>('[data-testid="template-save-btn"]')!
      saveBtn.click()
      await nextTick()
      expect(mocks.updateTemplate).toHaveBeenCalledTimes(1)

      const sentPayload = mocks.updateTemplate.mock.calls[0]![1] as { defaultMeta: Record<string, unknown> }
      expect(sentPayload.defaultMeta).toMatchObject({
        stdPrefix: 'T/ZSM',
        titleEn: 'Zhejiang Group Standard',
        standardNo: 'T/CCFAGS 032—2022\nT/CAPPMA 02—2022',
        publishDate: '2026-05-01',
        implementDate: '2026-08-01',
        issuer: '中国连锁经营协会\n中国水产流通与加工协会',
      })

      // 保存请求等待期间用户继续修改正文
      mocks.onEditorUpdate?.()
      await nextTick()

      // 服务端返回保存响应
      resolveSave({
        ...baseTpl,
        name: '改名后的模板',
        defaultMeta: sentPayload.defaultMeta,
        revision: 4,
        updatedAt: '2026-11-25T12:00:00.000Z',
      })
      await nextTick()
      await nextTick()

      // 绝不回写旧正文覆盖保存期间的新输入，且正文脏标记与保存按钮保持激活
      expect(replaceMock.mock.calls.length).toBe(initialReplaceCalls)
      const bodyTab = root.querySelector<HTMLButtonElement>('[data-testid="template-tab-body"]')!
      expect(bodyTab.querySelector('.tab-dirty-mark')).not.toBeNull()
      expect(saveBtn.disabled).toBe(false)
    } finally {
      app.unmount()
    }
  })
})
