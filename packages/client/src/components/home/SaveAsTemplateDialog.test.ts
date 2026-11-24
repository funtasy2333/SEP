// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SaveAsTemplateDialog from './SaveAsTemplateDialog.vue'

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

describe('SaveAsTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('从文档提交名称与说明创建自定义模板并触发 saved 回调', async () => {
    const createdTemplate = {
      id: 99,
      uid: 'saved-from-doc',
      name: '电子标签通用模板',
      description: '带封面徽标',
      baseType: 'group',
      defaultStage: 'working_draft',
      defaultMeta: {},
      content: { type: 'doc', content: [] },
      source: 'human',
      readonly: false,
      revision: 1,
    }
    mocks.api.createFromDocument.mockResolvedValue({ data: createdTemplate })

    const root = document.createElement('div')
    document.body.append(root)
    const saved: unknown[] = []
    const app = createApp({
      setup: () => () => h(SaveAsTemplateDialog, {
        modelValue: true,
        document: {
          id: 7,
          title: '电子标签规范',
          meta: { titleCn: '电子标签规范', standardType: 'group' },
          stage: 'working_draft',
          revision: 1,
          content: {},
        },
        onSaved: (tpl: unknown) => { saved.push(tpl) },
      }),
    })

    try {
      app.use(ElementPlus).mount(root)
      await nextTick()

      const nameInput = document.querySelector<HTMLInputElement>('input[data-testid="save-template-name"]')!
      expect(nameInput.value).toBe('电子标签规范 模板')
      nameInput.value = '电子标签通用模板'
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))

      const descInput = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="save-template-desc"]')!
      descInput.value = '带封面徽标'
      descInput.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()

      document.querySelector<HTMLButtonElement>('[data-testid="save-template-confirm"]')!.click()
      await nextTick()
      await new Promise((r) => setTimeout(r, 10))

      expect(mocks.api.createFromDocument).toHaveBeenCalledWith(7, {
        name: '电子标签通用模板',
        description: '带封面徽标',
      })
      expect(saved).toEqual([createdTemplate])
    } finally {
      app.unmount()
      root.remove()
    }
  })
})
