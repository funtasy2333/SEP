// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TemplateEditorView from './TemplateEditorView.vue'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  fetchTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  revertTemplate: vi.fn(),
  createTemplate: vi.fn(),
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
    previewDocx: vi.fn(),
    previewPdf: vi.fn(),
  },
}))

vi.mock('@/composables/useStandardEditorCore', () => ({
  useStandardEditorCore: () => ({
    editor: ref({
      setEditable: vi.fn(),
      getJSON: () => ({ type: 'doc', content: [] }),
      chain: () => ({ focus: () => ({ insertContent: () => ({ run: vi.fn() }) }) }),
    }),
    hasUnappliedLandscapeEdits: () => false,
  }),
}))

vi.mock('@/utils/editorDocument', () => ({
  replaceEditorDocument: vi.fn(),
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
})
