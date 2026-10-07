// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import EditorView from './EditorView.vue'
import { createDefaultDocumentContent } from '@/utils/newDocument'
import { findNodeIdFixes, NODE_ID_TYPES } from '@/extensions/plugins/ensureNodeId'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { getSchema } from '@tiptap/core'
import { serializeToXml } from '@/serializer'
import type { DocumentMeta } from '@ses/shared'

const mocks = vi.hoisted(() => ({
  store: {
    currentDocument: null as any,
    fetchDocument: vi.fn(),
    updateDocument: vi.fn(),
  },
  editor: null as any,
  editorOptions: null as any,
  routeGuard: null as null | (() => Promise<boolean> | boolean),
  routerPush: vi.fn(),
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/api/document', () => ({ documentApi: { update: vi.fn() } }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => Promise<boolean> | boolean) => { mocks.routeGuard = guard },
  useRoute: () => ({ params: { id: '17' } }),
  useRouter: () => ({ push: mocks.routerPush }),
}))
vi.mock('@tiptap/vue-3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/vue-3')>()
  const vue = await import('vue')
  return {
    ...actual,
    useEditor: (options: any) => {
      mocks.editorOptions = options
      const editorRef = actual.useEditor(options)
      vue.watch(editorRef, (value: any) => { mocks.editor = value }, { immediate: true })
      return editorRef
    },
  }
})
vi.mock('@/components/editor/EditorContent.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentOutline.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentSettingsPanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: {
      props: ['draft'],
      setup(props: { draft: { titleCn: string } }) {
        return () => vue.h('input', {
          'data-testid': 'settings-title-probe',
          value: props.draft.titleCn,
          onInput: (event: Event) => { props.draft.titleCn = (event.target as HTMLInputElement).value },
        })
      },
    },
  }
})
vi.mock('@/components/editor/SlashMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/version/VersionPanel.vue', () => ({ default: { render: () => null } }))

const meta: DocumentMeta = {
  standardType: 'national',
  standardNo: 'GB/T 00001—2026',
  titleCn: 'WP6 集成回归',
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
}

function assignNodeIds<T extends Record<string, any>>(source: T): T {
  const clone = structuredClone(source)
  let index = 0
  const visit = (node: any) => {
    if (NODE_ID_TYPES.includes(node.type)) {
      node.attrs = { ...node.attrs, nodeId: `stable-test-node-${index++}` }
    }
    node.content?.forEach(visit)
  }
  visit(clone)
  return clone
}

function createDocument(content: Record<string, unknown>) {
  return {
    id: 17,
    title: 'WP6 集成回归',
    meta,
    stage: 'working_draft',
    content,
    updatedAt: '',
  }
}

async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mountEditor(
  content = assignNodeIds(createDefaultDocumentContent(meta) as any),
  updateHandler?: (id: number, update: any) => Promise<unknown>,
) {
  mocks.store.currentDocument = createDocument(content)
  mocks.store.fetchDocument.mockReset().mockResolvedValue(undefined)
  mocks.store.updateDocument.mockReset().mockImplementation(updateHandler ?? (async (_id: number, update: any) => {
    const updated = { ...mocks.store.currentDocument, ...update }
    mocks.store.currentDocument = updated
    return updated
  }))
  mocks.editor = null
  mocks.editorOptions = null
  mocks.routeGuard = null
  mocks.routerPush.mockReset()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ htmlToPdf: true }),
  }))

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(EditorView) })
  app.use(ElementPlus).mount(root)
  await flushMicrotasks()
  if (!mocks.editor) throw new Error('生产 Tiptap Editor 未挂载')

  return {
    root,
    editor: mocks.editor,
    app,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

function allNodeIdsPresent(json: any): boolean {
  let valid = true
  const visit = (node: any) => {
    if (NODE_ID_TYPES.includes(node.type)
      && !(typeof node.attrs?.nodeId === 'string' && node.attrs.nodeId.length > 0)) valid = false
    node.content?.forEach(visit)
  }
  visit(json)
  return valid
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('打开未带 nodeId 的旧正文后立即持久化生产 schema 规范化后的 ID，重开仍稳定', async () => {
  const original = createDefaultDocumentContent(meta) as any
  const first = await mountEditor(original)
  let firstUnmounted = false
  try {
    expect(findNodeIdFixes(first.editor.state.doc)).toHaveLength(0)
    expect(allNodeIdsPresent(first.editor.getJSON())).toBe(true)
    expect(mocks.store.updateDocument).toHaveBeenCalledOnce()
    const savedContent = mocks.store.updateDocument.mock.calls[0]![1].content
    expect(allNodeIdsPresent(savedContent)).toBe(true)
    const ids = new Map<string, string>()
    const collect = (node: any, path = 'root') => {
      if (NODE_ID_TYPES.includes(node.type)) ids.set(path, node.attrs.nodeId)
      node.content?.forEach((child: any, index: number) => collect(child, `${path}.${index}`))
    }
    collect(savedContent)
    first.unmount()
    firstUnmounted = true

    mocks.store.currentDocument = createDocument(savedContent)
    const reopened = await mountEditor(savedContent)
    try {
      const reopenedIds = new Map<string, string>()
      const collectAgain = (node: any, path = 'root') => {
        if (NODE_ID_TYPES.includes(node.type)) reopenedIds.set(path, node.attrs.nodeId)
        node.content?.forEach((child: any, index: number) => collectAgain(child, `${path}.${index}`))
      }
      collectAgain(reopened.editor.getJSON())
      expect(reopenedIds).toEqual(ids)
      expect(mocks.store.updateDocument).not.toHaveBeenCalled()
    } finally {
      reopened.unmount()
    }
  } finally {
    if (!firstUnmounted) first.unmount()
  }
})

it('初始化 ID 保存失败后保留 dirty，停止无限重试并允许 Ctrl+S 重试', async () => {
  let attempts = 0
  const view = await mountEditor(createDefaultDocumentContent(meta) as any, async (_id, update) => {
    attempts += 1
    if (attempts === 1) throw new Error('network unavailable')
    const updated = { ...mocks.store.currentDocument, ...update }
    mocks.store.currentDocument = updated
    return updated
  })
  try {
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).not.toBeNull()
    expect(mocks.store.updateDocument).toHaveBeenCalledOnce()

    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(9000)
    expect(mocks.store.updateDocument).toHaveBeenCalledOnce()

    const event = {
      ctrlKey: true,
      metaKey: false,
      key: 's',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent
    expect(mocks.editorOptions.editorProps.handleKeyDown(view.editor.view, event)).toBe(true)
    await flushMicrotasks()
    expect(mocks.store.updateDocument).toHaveBeenCalledTimes(2)
    expect(allNodeIdsPresent(mocks.store.updateDocument.mock.calls[1]![1].content)).toBe(true)
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).toBeNull()
  } finally {
    view.unmount()
  }
})

it('XML 导入在持久化前先用生产 Editor schema 补齐并保存稳定 nodeId', async () => {
  const view = await mountEditor()
  try {
    mocks.store.updateDocument.mockClear()
    const schema = getSchema(createEditorExtensions())
    const xml = serializeToXml(schema.nodeFromJSON(createDefaultDocumentContent(meta) as any))
    const input = view.root.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([xml], 'standard.xml', { type: 'application/xml' })],
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(mocks.store.updateDocument).toHaveBeenCalledOnce())
    const savedContent = mocks.store.updateDocument.mock.calls[0]![1].content
    expect(allNodeIdsPresent(savedContent)).toBe(true)
    expect(allNodeIdsPresent(view.editor.getJSON())).toBe(true)
  } finally {
    view.unmount()
  }
})

it('XML 导入持久化失败时不改变正文、根属性、选区或 undo 历史', async () => {
  const view = await mountEditor()
  try {
    const baseJson = view.editor.getJSON()
    view.editor.view.dispatch(view.editor.state.tr
      .setDocAttribute('extensionVersion', 'original-root-value')
      .setMeta('addToHistory', false))
    const beforeEditJson = view.editor.getJSON()
    const initialSelection = view.editor.state.selection.from
    view.editor.commands.insertContent('本地正文编辑')
    view.editor.commands.setTextSelection(initialSelection)
    const beforeImportJson = view.editor.getJSON()
    const selectionBeforeImport = view.editor.state.selection.from
    const stateBeforeImport = view.editor.state
    expect(beforeImportJson).not.toEqual(beforeEditJson)

    const imported = structuredClone(baseJson)
    const cover = imported.content.find((node: any) => node.type === 'coverPage')
    cover.attrs.titleCn = '失败导入文档'
    const xml = serializeToXml(view.editor.schema.nodeFromJSON(imported))
    mocks.store.updateDocument.mockRejectedValueOnce(new Error('network unavailable'))
    const input = view.root.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([xml], 'failed-import.xml', { type: 'application/xml' })],
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(mocks.store.updateDocument).toHaveBeenCalledOnce())
    await flushMicrotasks()

    expect(view.editor.getJSON()).toEqual(beforeImportJson)
    expect(view.editor.state).toBe(stateBeforeImport)
    expect(view.editor.state.selection.from).toBe(selectionBeforeImport)
    expect(view.editor.getJSON().attrs?.extensionVersion).toBe('original-root-value')
    expect(view.editor.can().undo()).toBe(true)
    view.editor.commands.undo()
    expect(JSON.stringify(view.editor.getJSON())).not.toContain('失败导入文档')
  } finally {
    view.unmount()
  }
})

it('离开前等待正在进行的正文保存；失败时阻止离开且 beforeunload 反映 dirty', async () => {
  const view = await mountEditor()
  try {
    const firstRequest = (() => {
      let resolve!: (value: unknown) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
      return { promise, resolve, reject }
    })()
    mocks.store.updateDocument.mockReturnValueOnce(firstRequest.promise)
    view.editor.commands.insertContent('新内容')
    const saveEvent = {
      ctrlKey: true,
      metaKey: false,
      key: 's',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent
    mocks.editorOptions.editorProps.handleKeyDown(view.editor.view, saveEvent)
    await flushMicrotasks()

    let navigationSettled = false
    const navigation = Promise.resolve(mocks.routeGuard!()).finally(() => { navigationSettled = true })
    await flushMicrotasks()
    expect(navigationSettled).toBe(false)
    firstRequest.reject(new Error('network unavailable'))
    expect(await navigation).toBe(false)
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).not.toBeNull()

    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
  } finally {
    view.unmount()
  }
})

it('脏正文发起离开时先保存成功再离开；失败则留在原编辑器', async () => {
  const view = await mountEditor()
  try {
    view.editor.commands.insertContent('修改正文')
    mocks.store.updateDocument.mockRejectedValueOnce(new Error('network unavailable'))
    expect(await mocks.routeGuard!()).toBe(false)
    expect(mocks.store.updateDocument).toHaveBeenCalledOnce()
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).not.toBeNull()

    mocks.store.updateDocument.mockImplementationOnce(async (_id: number, update: any) => {
      const updated = { ...mocks.store.currentDocument, ...update }
      mocks.store.currentDocument = updated
      return updated
    })
    expect(await mocks.routeGuard!()).toBe(true)
    expect(mocks.store.updateDocument).toHaveBeenCalledTimes(2)
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).toBeNull()
  } finally {
    view.unmount()
  }
})

it('文件设置确认等待期间正文变脏时，离开前仍必须保存正文', async () => {
  const view = await mountEditor()
  const confirmation = (() => {
    let resolve!: (value: unknown) => void
    const promise = new Promise<unknown>((resolvePromise) => { resolve = resolvePromise })
    return { promise, resolve }
  })()
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockReturnValue(confirmation.promise as any)
  try {
    const settingInput = view.root.querySelector<HTMLInputElement>('[data-testid="settings-title-probe"]')!
    settingInput.value = '设置草稿'
    settingInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushMicrotasks()

    const navigation = Promise.resolve(mocks.routeGuard!())
    await flushMicrotasks()
    expect(confirm).toHaveBeenCalledOnce()

    view.editor.commands.insertContent('等待确认时新增的正文')
    mocks.store.updateDocument.mockRejectedValueOnce(new Error('network unavailable'))
    confirmation.resolve(undefined)
    expect(await navigation).toBe(false)
    expect(mocks.store.updateDocument).toHaveBeenCalledOnce()
    expect(view.root.querySelector('[aria-label="正文有未保存修改"]')).not.toBeNull()
  } finally {
    view.unmount()
  }
})

it('粘贴片段中重复定义被其引用时拒绝粘贴并显示诊断，文档状态不变', async () => {
  const view = await mountEditor()
  const messageError = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as any)
  try {
    const schema = view.editor.schema
    const target = (label: string) => schema.nodeFromJSON({
      type: 'paragraph',
      attrs: { nodeId: 'ambiguous-target' },
      content: [{ type: 'text', text: label }],
    })
    const ref = schema.nodeFromJSON({
      type: 'paragraph',
      attrs: { nodeId: 'ambiguous-ref' },
      content: [{
        type: 'text', text: 'ambiguous reference',
        marks: [{ type: 'crossRef', attrs: { targetId: 'ambiguous-target', refType: 'paragraph' } }],
      }],
    })
    const wrapper = document.createElement('div')
    wrapper.append(DOMSerializer.fromSchema(schema).serializeFragment(Fragment.fromArray([
      target('definition one'), target('definition two'), ref,
    ])))
    const beforePasteState = view.editor.state
    view.editor.view.pasteHTML(wrapper.innerHTML)

    expect(messageError).toHaveBeenCalledOnce()
    expect(String(messageError.mock.calls[0]?.[0])).toContain('重复引用目标')
    expect(view.editor.state).toBe(beforePasteState)
    expect(view.editor.getJSON()).toEqual(beforePasteState.doc.toJSON())
  } finally {
    view.unmount()
  }
})

it('语义 JSON 与原始 JSON 代码下载不被脚注打印校验阻断', async () => {
  const view = await mountEditor()
  const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:wp6-audit')
  const clipboardWrite = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  })
  try {
    view.editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'chapter',
        attrs: { nodeId: 'chapter-invalid-footnote' },
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
          { type: 'stdParagraph', attrs: { nodeId: 'paragraph-invalid-footnote' }, content: [
            { type: 'text', text: '正文' },
            { type: 'footnoteRef', attrs: { nodeId: 'empty-footnote', content: [] } },
          ] },
        ],
      }],
    })
    const sourceButton = [...view.root.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('源码'))!
    sourceButton.click()
    await flushMicrotasks()

    for (const format of ['json', 'raw']) {
      const radio = [...document.body.querySelectorAll<HTMLElement>('.el-radio-button')]
        .find(item => item.textContent?.includes(format === 'json' ? '语义 JSON' : '原始 JSON'))!
      radio.click()
      await flushMicrotasks()
      const dialog = document.body.querySelector<HTMLElement>('.ses-code-dlg')!
      const actions = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      actions.find(button => button.textContent?.trim() === '复制')!.click()
      actions.find(button => button.textContent?.trim() === '下载')!.click()
      await flushMicrotasks()
    }
    expect(clipboardWrite).toHaveBeenCalledTimes(2)
    expect(createObjectUrl).toHaveBeenCalledTimes(2)
    expect(clickAnchor).toHaveBeenCalledTimes(2)

    const exportButton = [...view.root.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('导出'))!
    exportButton.click()
    await flushMicrotasks()
    const jsonExportCard = [...document.body.querySelectorAll<HTMLButtonElement>('.export-card')]
      .find(button => button.textContent?.includes('JSON'))!
    jsonExportCard.click()
    await flushMicrotasks()
    expect(createObjectUrl).toHaveBeenCalledTimes(3)
    expect(clickAnchor).toHaveBeenCalledTimes(3)
  } finally {
    view.unmount()
  }
})
