// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeView from './HomeView.vue'
import { useDocumentStore } from '@/stores/document'

const mocks = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listTrash: vi.fn(),
    restore: vi.fn(),
    permanentDelete: vi.fn(),
    emptyTrash: vi.fn(),
  },
  routerPush: vi.fn(),
}))

vi.mock('@/api/document', () => ({ documentApi: mocks.api }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }))

vi.mock('@/components/home/HomeNav.vue', async () => {
  const vue = await import('vue')
  return {
    default: {
      props: ['activeTab', 'tabs'],
      emits: ['select-tab'],
      setup(props: any, { emit }: any) {
        return () => vue.h('nav', props.tabs.map((tab: any) => vue.h('button', {
          type: 'button',
          'data-tab': tab.id,
          onClick: () => emit('select-tab', tab.id),
        }, `${tab.label}${tab.count === undefined ? '' : ` ${tab.count}`}`)))
      },
    },
  }
})
vi.mock('@/components/home/StageOverview.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))
vi.mock('@/components/home/TemplateRail.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))
vi.mock('@/components/home/DocCard.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))
vi.mock('@/components/home/NewDocDialog.vue', () => ({ default: defineComponent({ render: () => h('div') }) }))

const ok = (data: unknown) => ({ data }) as never

function trashDoc(id: number, revision = 4) {
  return {
    id,
    title: `文档 ${id}`,
    meta: { standardType: 'national', standardNo: `GB ${id}`, titleCn: `回收标题 ${id}` },
    stage: 'review_draft',
    revision,
    deletedAt: '2026-10-15T02:30:00.000Z',
  }
}

function activeDoc(id: number, revision: number) {
  return { ...trashDoc(id, revision), content: { type: 'doc', content: [] } }
}

async function flush() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mountHome() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(HomeView)
  app.use(pinia).use(ElementPlus)
  app.mount(root)
  await flush()
  setActivePinia(pinia)
  const store = useDocumentStore()
  return {
    root,
    store,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`找不到按钮：${label}`)
  return found
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.api.list.mockResolvedValue(ok([]))
  mocks.api.listTrash.mockResolvedValue(ok([]))
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('HomeView 回收站', () => {
  it('导航到独立回收站，展示摘要字段并在恢复成功后移出回收站', async () => {
    mocks.api.listTrash.mockResolvedValue(ok([trashDoc(12)]))
    mocks.api.restore.mockResolvedValue(ok(activeDoc(12, 5)))
    const view = await mountHome()
    try {
      button(view.root, '回收站 1').click()
      await flush()

      expect(view.root.textContent).toContain('回收站')
      expect(view.root.textContent).toContain('GB 12')
      expect(view.root.textContent).toContain('回收标题 12')
      expect(view.root.textContent).toContain('送审稿')
      expect(view.root.textContent).toContain('2026')
      expect(view.root.querySelector('.list-toolbar')).toBeNull()
      expect(view.root.querySelector('.doc-grid')).toBeNull()

      button(view.root, '恢复').click()
      await flush()
      expect(mocks.api.restore).toHaveBeenCalledWith(12)
      expect(view.store.documents[0]?.id).toBe(12)
      expect(view.store.trashDocuments).toEqual([])
      expect(view.root.textContent).toContain('回收站为空')
    } finally {
      view.unmount()
    }
  })

  it('单项永久删除确认清除正文与版本不可恢复；取消静默，失败保留列表项', async () => {
    mocks.api.listTrash.mockResolvedValue(ok([trashDoc(20, 6)]))
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
    const messageError = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
    const view = await mountHome()
    try {
      button(view.root, '回收站 1').click()
      await flush()
      button(view.root, '永久删除').click()
      await flush()
      expect(confirm).toHaveBeenCalledOnce()
      expect(String(confirm.mock.calls[0]?.[0])).toContain('清除全部版本历史，无法恢复')
      expect(messageError).not.toHaveBeenCalled()
      expect(view.store.trashDocuments.map((entry) => entry.id)).toEqual([20])
      expect(mocks.api.permanentDelete).not.toHaveBeenCalled()

      confirm.mockResolvedValueOnce(undefined as any)
      mocks.api.permanentDelete.mockRejectedValueOnce(new Error('revision changed'))
      button(view.root, '永久删除').click()
      await flush()
      expect(mocks.api.permanentDelete).toHaveBeenCalledWith(20, 6)
      expect(view.store.trashDocuments.map((entry) => entry.id)).toEqual([20])
      expect(messageError).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
    }
  })

  it('清空固定打开确认框时的 id/revision 快照，后来进入回收站的文档保留', async () => {
    const original = trashDoc(30, 3)
    const arrivedWhileConfirmOpen = trashDoc(31, 8)
    mocks.api.listTrash.mockResolvedValue(ok([original]))
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const view = await mountHome()
    let approve!: () => void
    try {
      confirm.mockImplementationOnce(() => new Promise((resolve) => {
        approve = () => resolve(undefined as any)
      }))
      button(view.root, '回收站 1').click()
      await flush()
      mocks.api.emptyTrash.mockResolvedValueOnce(ok(undefined))
      button(view.root, '清空回收站').click()
      await flush()
      view.store.trashDocuments.push(arrivedWhileConfirmOpen as any)
      approve()
      await flush()

      expect(confirm).toHaveBeenCalledOnce()
      expect(String(confirm.mock.calls[0]?.[0])).toContain('无法恢复')
      expect(mocks.api.emptyTrash).toHaveBeenCalledWith([{ id: 30, revision: 3 }])
      expect(view.store.trashDocuments.map((entry) => entry.id)).toEqual([31])
    } finally {
      view.unmount()
    }
  })
})
