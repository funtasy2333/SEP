// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { createWp6Fixture } from '@/extensions/__fixtures__/wp6'
import { replaceEditorDocument } from '@/utils/editorDocument'
import VersionPanel from './VersionPanel.vue'

const mocks = vi.hoisted(() => ({
  versionStore: {
    loading: false,
    sortedVersions: [] as any[],
    versions: [] as any[],
    fetchVersions: vi.fn(),
    fetchVersion: vi.fn(),
    getNextVersionNo: vi.fn(() => '1.1'),
    createVersion: vi.fn(),
  },
  documentStore: {
    currentDocument: { stage: 'working_draft' },
    updateDocument: vi.fn(),
  },
}))

vi.mock('@/stores/version', () => ({ useVersionStore: () => mocks.versionStore }))
vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.documentStore }))

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mountPanel(setContent: (content: Record<string, unknown>) => void) {
  mocks.versionStore.loading = false
  mocks.versionStore.sortedVersions = [{
    id: 4,
    versionNo: '1.0',
    stage: 'working_draft',
    createdAt: '2026-10-07T00:00:00.000Z',
    content: { type: 'doc', content: [{ type: 'not-a-production-node' }] },
  }]
  mocks.versionStore.versions = [...mocks.versionStore.sortedVersions]
  mocks.versionStore.fetchVersions.mockReset().mockResolvedValue(undefined)
  mocks.versionStore.fetchVersion.mockReset()

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h(VersionPanel, {
      documentId: 17,
      getContent: () => ({ type: 'doc', content: [] }),
      getDoc: () => null,
      setContent,
    }),
  })
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

afterEach(() => {
  vi.restoreAllMocks()
})

it('回滚确认取消不报错；确认后实际设置内容失败要显示失败并保留编辑器内容', async () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: createWp6Fixture() })
  editor.commands.insertContent('本地未保存正文')
  const beforeRestore = editor.getJSON()
  const stateBeforeRestore = editor.state
  const beforeSelection = editor.state.selection.from
  const setContent = vi.fn((content: Record<string, unknown>) => replaceEditorDocument(editor, content))
  const view = await mountPanel(setContent)
  const confirm = vi.spyOn(ElMessageBox, 'confirm')
  const messageError = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
  try {
    const restore = () => [...view.root.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '回滚')!.click()

    confirm.mockRejectedValueOnce('cancel')
    restore()
    await flushMicrotasks()
    expect(setContent).not.toHaveBeenCalled()
    expect(messageError).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(beforeRestore)
    expect(editor.state).toBe(stateBeforeRestore)

    confirm.mockResolvedValueOnce(undefined as any)
    restore()
    await flushMicrotasks()
    expect(setContent).toHaveBeenCalledOnce()
    expect(messageError).toHaveBeenCalledOnce()
    expect(String(messageError.mock.calls[0]?.[0])).toContain('回滚失败')
    expect(editor.getJSON()).toEqual(beforeRestore)
    expect(editor.state).toBe(stateBeforeRestore)
    expect(editor.state.selection.from).toBe(beforeSelection)
    expect(editor.getJSON().attrs).toEqual(beforeRestore.attrs)
    expect(editor.can().undo()).toBe(true)
    editor.commands.undo()
    expect(editor.state.doc.textContent).not.toContain('本地未保存正文')
  } finally {
    view.unmount()
    editor.destroy()
  }
})
