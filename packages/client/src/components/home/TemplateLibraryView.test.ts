// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_TEMPLATES, type StandardTemplate } from '@ses/shared'
import TemplateLibraryView from './TemplateLibraryView.vue'
import { useTemplateStore } from '@/stores/template'

const mocks = vi.hoisted(() => ({
  api: {
    eventsUrl: vi.fn(() => '/api/templates/events'),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    createFromDocument: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    revert: vi.fn(),
    applyOperations: vi.fn(),
    exportPackage: vi.fn(),
    previewImport: vi.fn(),
    importPackage: vi.fn(),
    previewDocx: vi.fn(),
    previewPdf: vi.fn(),
  },
}))

vi.mock('@/api/template', () => ({
  templateApi: mocks.api,
  SES_TEMPLATE_MIME: 'application/vnd.ses-template+json',
}))

describe('TemplateLibraryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('展示自定义与内置模板，支持搜索过滤、派生及删除流程', async () => {
    const store = useTemplateStore()
    const customTpl: StandardTemplate = {
      id: 10,
      uid: 'custom-uid-10',
      name: '人工智能团体标准模板',
      description: 'AI 专项',
      baseType: 'group',
      defaultStage: 'working_draft',
      defaultMeta: { stdPrefix: 'T/AI' },
      content: { type: 'doc', content: [] },
      source: 'agent',
      readonly: false,
      revision: 2,
    }
    store.templates = [customTpl, ...BUILTIN_TEMPLATES]
    mocks.api.create.mockResolvedValue({ data: { ...customTpl, id: 11, name: '国家级标准模板（自定义）', readonly: false, source: 'human' } })
    mocks.api.remove.mockResolvedValue({ data: { deleted: true } })

    const root = document.createElement('div')
    document.body.append(root)
    const used: StandardTemplate[] = []
    const edited: StandardTemplate[] = []
    const app = createApp({
      setup: () => () => h(TemplateLibraryView, {
        onUseTemplate: (tpl: StandardTemplate) => { used.push(tpl) },
        onEditTemplate: (tpl: StandardTemplate) => { edited.push(tpl) },
      }),
    })

    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    try {
      app.use(ElementPlus).mount(root)
      await nextTick()

      const cards = root.querySelectorAll('[data-testid="template-card"]')
      expect(cards.length).toBe(1 + BUILTIN_TEMPLATES.length)
      expect(cards[0]!.querySelector('[data-testid="template-source-badge"]')?.textContent?.trim()).toBe('AI 创建')

      // 搜索筛选
      const searchInput = root.querySelector<HTMLInputElement>('input[data-testid="template-search-input"]')!
      searchInput.value = '人工智能'
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      expect(root.querySelectorAll('[data-testid="template-card"]')).toHaveLength(1)

      // 触发使用
      root.querySelector<HTMLButtonElement>('[data-testid="template-use-btn"]')!.click()
      expect(used).toHaveLength(1)
      expect(used[0]!.uid).toBe('custom-uid-10')

      // 清空搜索并对首个内置模板点击基于此派生
      searchInput.value = ''
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      const deriveBtn = root.querySelector<HTMLButtonElement>('[data-testid="template-derive-btn"]')!
      deriveBtn.click()
      await nextTick()
      await new Promise((r) => setTimeout(r, 10))
      expect(mocks.api.create).toHaveBeenCalledOnce()
      expect(edited).toHaveLength(1)

      // 删除自定义模板
      await store.deleteTemplate(10)
      expect(mocks.api.remove).toHaveBeenCalledWith(10)
      expect(store.customTemplates.some((t) => t.id === 10)).toBe(false)
    } finally {
      confirmSpy.mockRestore()
      app.unmount()
      root.remove()
    }
  })
})
