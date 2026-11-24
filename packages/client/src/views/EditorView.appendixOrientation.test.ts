// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CellSelection } from '@tiptap/pm/tables'
import { pmToIr } from '@ses/shared'
import { getStdTableGridColwidths } from '@/utils/landscapeTable'
import { resolveEditorLabels } from '@/utils/semanticLabels'
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
  mathConfirm: null as null | ((latex: string) => void),
  mathDialogProps: null as null | Record<string, any>,
}))

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mocks.store }))
vi.mock('@/stores/version', () => ({ useVersionStore: () => ({}) }))
vi.mock('@/api/document', () => ({ documentApi: { update: vi.fn() } }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => Promise<boolean> | boolean) => { mocks.routeGuard = guard },
  useRoute: () => ({ params: { id: '17' } }),
  useRouter: () => ({ push: mocks.routerPush }),
}))
vi.mock('@tiptap/vue-3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/vue-3')>()
  const vue = await import('vue')
  const { Editor: ProductionEditor } = await import('@tiptap/core')
  return {
    ...actual,
    // 与 @tiptap/vue-3 一致：每笔事务后触发重新渲染，工具栏按选区更新。
    useEditor: (options: any) => {
      mocks.editorOptions = options
      const editorRef = vue.shallowRef<any>(null)
      mocks.editor = new ProductionEditor({
        ...options,
        onTransaction: (props: any) => { options.onTransaction?.(props); vue.triggerRef(editorRef) },
      })
      editorRef.value = mocks.editor
      return editorRef
    },
  }
})
vi.mock('@/components/editor/EditorContent.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/DocumentOutline.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/SlashMenu.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/SesLogo.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/editor/MathInputDialog.vue', () => ({
  default: {
    props: ['modelValue', 'initialLatex', 'displayMode', 'title'],
    emits: ['update:modelValue', 'confirm'],
    setup(props: any, { emit }: any) {
      mocks.mathDialogProps = props
      mocks.mathConfirm = (latex: string) => emit('confirm', latex)
      return () => null
    },
  },
}))
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

function sampleTable(id: string, cellText: string, orientation: 'portrait' | 'landscape' = 'portrait') {
  return {
    type: 'stdTable',
    attrs: { nodeId: id, orientation },
    content: [
      { type: 'tableCaption', content: [text(`表-${id}`)] },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [{ type: 'tableCell', content: [paragraph(`${id}-p`, text(cellText))] }],
          },
        ],
      },
    ],
  }
}

function sampleFigure(id: string, captionText: string, orientation: 'portrait' | 'landscape' = 'portrait') {
  return {
    type: 'figure',
    attrs: { nodeId: id, orientation },
    content: [
      { type: 'figureImage', attrs: { src: 'data:image/png;base64,AA==', alt: captionText } },
      { type: 'figureCaption', content: [text(captionText)] },
    ],
  }
}

function riskDocument() {
  return {
    type: 'doc', content: [
      chapter('c1', '范围', 'scope',
        paragraph('p1', text('本文件规定了检验方法。')),
        sampleTable('body-t1', '正文表内容'),
        sampleFigure('body-f1', '正文图题'),
      ),
      { type: 'appendix', attrs: { nodeId: 'app-b', normative: false }, content: [
        { type: 'appendixLabel', content: [text('（资料性）')] },
        { type: 'appendixTitle', content: [text('方法验证汇总')] },
        paragraph('lead', text('方法参数及验证结果见表B.1。')),
        sampleTable('app-t1', '附录纵表内容', 'portrait'),
        sampleTable('app-t2', '附录横表内容', 'landscape'),
        sampleFigure('app-f1', '附录图题', 'portrait'),
      ] },
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

function positionOf(editor: any, needle: string): number {
  let found = -1
  editor.state.doc.descendants((node: any, pos: number) => {
    if (found < 0 && node.isText && node.text.includes(needle)) found = pos + node.text.indexOf(needle)
  })
  if (found < 0) throw new Error(`text not found: ${needle}`)
  return found
}

function group(root: HTMLElement) {
  return root.querySelector<HTMLElement>('[data-testid="appendix-orientation"]')
}

function nodeGroup(root: HTMLElement) {
  return root.querySelector<HTMLElement>('[data-testid="node-orientation"]')
}

function buttonIn(container: HTMLElement | null, label: string) {
  const found = [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => item.textContent?.trim() === label)
  if (!found) throw new Error(`button missing: ${label}`)
  return found
}

function button(root: HTMLElement, label: string) {
  return buttonIn(group(root), label)
}

function nodeAttrsById(editor: any, nodeId: string) {
  let attrs: any = null
  editor.state.doc.descendants((node: any) => {
    if (node.attrs?.nodeId === nodeId) attrs = node.attrs
  })
  return attrs
}

function appendixAttrs(editor: any) {
  let attrs: any = null
  editor.state.doc.descendants((node: any) => {
    if (node.type.name === 'appendix') attrs = node.attrs
  })
  return attrs
}

describe('EditorView 附录版面（#75）', () => {
  it('光标在正文时不显示；进入附录后可设为横向、撤销，并写入 IR', async () => {
    const view = await mountEditor()
    try {
      const editor = view.editor
      editor.commands.setTextSelection(positionOf(editor, '本文件规定'))
      await flush()
      expect(group(view.root)).toBeNull()
      expect(nodeGroup(view.root)).toBeNull()

      editor.commands.setTextSelection(positionOf(editor, '方法参数'))
      await flush()
      expect(group(view.root)).not.toBeNull()
      expect(group(view.root)?.querySelector('.tbar-label')?.textContent?.trim()).toBe('整篇附录')
      expect(button(view.root, '纵向').classList.contains('is-active')).toBe(true)

      button(view.root, '横向').click()
      await flush()
      expect(appendixAttrs(editor).orientation).toBe('landscape')
      expect(button(view.root, '横向').classList.contains('is-active')).toBe(true)
      expect(pmToIr(editor.getJSON()).doc.appendices[0]!.orientation).toBe('landscape')
      expect(editor.getText()).toContain('方法参数及验证结果见表B.1。')

      editor.commands.undo()
      await flush()
      expect(appendixAttrs(editor).orientation ?? null).toBeNull()

      editor.commands.redo()
      await flush()
      button(view.root, '纵向').click()
      await flush()
      expect(appendixAttrs(editor).orientation).toBeNull()
      expect(Object.prototype.hasOwnProperty.call(pmToIr(editor.getJSON()).doc.appendices[0]!, 'orientation')).toBe(false)
    } finally {
      view.unmount()
    }
  })

  it('明确区分当前图/当前表与整篇附录，并在横向附录内锁定子图表方向且保留原值', async () => {
    const view = await mountEditor()
    try {
      const editor = view.editor

      // 1. 正文表与正文图：显示当前表 / 当前图，不显示整篇附录，且上下文浮架锚定在编辑区 .ed-main 内（不遮挡右侧栏）
      editor.commands.setTextSelection(positionOf(editor, '正文表内容'))
      await flush()
      expect(view.root.querySelector('.ed-main > .tbar-context-shelf')).not.toBeNull()
      expect(view.root.querySelector('.ed-toolbar .tbar-context-shelf')).toBeNull()
      expect(group(view.root)).toBeNull()
      expect(nodeGroup(view.root)?.querySelector('.tbar-label')?.textContent?.trim()).toBe('当前表')
      expect(buttonIn(nodeGroup(view.root), '纵向').classList.contains('is-active')).toBe(true)
      buttonIn(nodeGroup(view.root), '横向').click()
      await flush()
      expect(nodeAttrsById(editor, 'body-t1').orientation).toBe('landscape')

      editor.commands.setTextSelection(positionOf(editor, '正文图题'))
      await flush()
      expect(group(view.root)).toBeNull()
      expect(nodeGroup(view.root)?.querySelector('.tbar-label')?.textContent?.trim()).toBe('当前图')

      // 2. 纵向附录内的表：两者同时存在但作用域标签清晰，各自可独立切换
      editor.commands.setTextSelection(positionOf(editor, '附录纵表内容'))
      await flush()
      expect(nodeGroup(view.root)?.querySelector('.tbar-label')?.textContent?.trim()).toBe('当前表')
      expect(group(view.root)?.querySelector('.tbar-label')?.textContent?.trim()).toBe('整篇附录')
      expect(buttonIn(nodeGroup(view.root), '纵向').disabled).toBe(false)
      expect(buttonIn(nodeGroup(view.root), '纵向').classList.contains('is-active')).toBe(true)

      // 3. 将整篇附录切换为横向：内部图表锁定为随附录横排，但保留自身原属性
      button(view.root, '横向').click()
      await flush()
      expect(appendixAttrs(editor).orientation).toBe('landscape')
      expect(buttonIn(nodeGroup(view.root), '纵向').disabled).toBe(true)
      expect(buttonIn(nodeGroup(view.root), '横向').disabled).toBe(true)
      expect(buttonIn(nodeGroup(view.root), '纵向').classList.contains('is-active')).toBe(false)
      expect(buttonIn(nodeGroup(view.root), '横向').classList.contains('is-active')).toBe(true)
      expect(view.root.querySelector('[data-testid="orientation-locked-hint"]')?.textContent?.trim()).toBe('随附录')

      // 点击已禁用的纵向按钮不会改写子表属性
      buttonIn(nodeGroup(view.root), '纵向').click()
      await flush()
      expect(nodeAttrsById(editor, 'app-t1').orientation).toBe('portrait')

      // 附录内的图同样锁定
      editor.commands.setTextSelection(positionOf(editor, '附录图题'))
      await flush()
      expect(nodeGroup(view.root)?.querySelector('.tbar-label')?.textContent?.trim()).toBe('当前图')
      expect(buttonIn(nodeGroup(view.root), '纵向').disabled).toBe(true)
      expect(buttonIn(nodeGroup(view.root), '横向').classList.contains('is-active')).toBe(true)

      // 4. 切回纵向附录：解锁并恢复各子图表原有方向（app-t1 保持纵向，app-t2 保持横向）
      button(view.root, '纵向').click()
      await flush()
      editor.commands.setTextSelection(positionOf(editor, '附录纵表内容'))
      await flush()
      expect(buttonIn(nodeGroup(view.root), '纵向').disabled).toBe(false)
      expect(buttonIn(nodeGroup(view.root), '纵向').classList.contains('is-active')).toBe(true)

      editor.commands.setTextSelection(positionOf(editor, '附录横表内容'))
      await flush()
      expect(buttonIn(nodeGroup(view.root), '横向').disabled).toBe(false)
      expect(buttonIn(nodeGroup(view.root), '横向').classList.contains('is-active')).toBe(true)
    } finally {
      view.unmount()
    }
  })
})

describe('EditorView 图片尺寸浮窗', () => {
  it('仅选中有图源的正文或附录图片时显示，操作后保留选中并可撤销', async () => {
    const view = await mountEditor()
    try {
      const editor = view.editor
      const imagePos = (figureId: string) => {
        let found = -1
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type.name === 'figure' && node.attrs.nodeId === figureId) found = pos + 1
        })
        return found
      }
      const sizing = () => view.root.querySelector<HTMLElement>('[data-testid="image-size-controls"]')
      editor.commands.setTextSelection(positionOf(editor, '正文图题'))
      await flush()
      expect(sizing()).toBeNull()
      const pos = imagePos('body-f1')
      editor.commands.setNodeSelection(pos)
      await flush()
      expect(sizing()).not.toBeNull()
      expect(sizing()?.closest('.tbar-context-shelf')).not.toBeNull()
      expect(nodeGroup(view.root)).not.toBeNull()
      buttonIn(sizing(), '半版宽').click()
      await flush()
      expect(editor.state.doc.nodeAt(pos).attrs.width).toBeCloseTo(165 * 96 / 25.4 / 2, 2)
      expect(editor.state.selection.from).toBe(pos)
      expect(editor.state.selection.node?.type.name).toBe('figureImage')
      buttonIn(sizing(), '通栏').click()
      await flush()
      expect(editor.state.doc.nodeAt(pos).attrs.width).toBeCloseTo(165 * 96 / 25.4, 2)
      editor.commands.undo()
      await flush()
      expect(editor.state.doc.nodeAt(pos).attrs.width).toBeCloseTo(165 * 96 / 25.4 / 2, 2)
      editor.commands.setNodeSelection(imagePos('app-f1'))
      await flush()
      expect(sizing()).not.toBeNull()
      expect(group(view.root)).not.toBeNull()
      const appPos = imagePos('app-f1')
      let appendixPos = -1
      editor.state.doc.descendants((node: any, pos: number) => { if (node.type.name === 'appendix') appendixPos = pos })
      editor.view.dispatch(editor.state.tr.setNodeAttribute(appendixPos, 'orientation', 'landscape'))
      editor.commands.setNodeSelection(appPos)
      await flush()
      buttonIn(sizing(), '通栏').click()
      await flush()
      expect(editor.state.doc.nodeAt(appPos).attrs.width).toBeCloseTo(252 * 96 / 25.4, 2)
      editor.view.dispatch(editor.state.tr.setNodeAttribute(appPos, 'src', ''))
      editor.commands.setNodeSelection(appPos)
      await flush()
      expect(sizing()).toBeNull()
    } finally { view.unmount() }
  })
})

describe('EditorView 横页表格展开编辑', () => {
  async function finishDialogTransition() {
    await flush()
    document.querySelectorAll('.el-overlay, .el-overlay-dialog, .el-dialog').forEach((el) => {
      el.dispatchEvent(new Event('transitionend'))
      el.dispatchEvent(new Event('animationend'))
    })
    await flush()
  }

  it('上下文条「展开编辑」仅对生效横向表格显示（含横向附录内表格），点击或触发自定义事件打开弹窗并支持单步撤销回写', async () => {
    const view = await mountEditor()
    try {
      const { editor } = view

      // 1. 纵向表格中不显示「展开编辑」按钮
      editor.commands.setTextSelection(positionOf(editor, '正文表内容'))
      await flush()
      expect(view.root.querySelector('[data-testid="context-expand-landscape-btn"]')).toBeNull()

      // 2. 图形中不显示「展开编辑」按钮
      editor.commands.setTextSelection(positionOf(editor, '正文图题'))
      await flush()
      expect(view.root.querySelector('[data-testid="context-expand-landscape-btn"]')).toBeNull()

      // 3. 附录横表中显示「展开编辑」按钮
      editor.commands.setTextSelection(positionOf(editor, '附录横表内容'))
      await flush()
      const expandBtn = view.root.querySelector<HTMLButtonElement>('[data-testid="context-expand-landscape-btn"]')
      expect(expandBtn).not.toBeNull()
      expect(expandBtn!.textContent?.trim()).toBe('展开编辑')

      // 4. 点击上下文「展开编辑」打开弹窗，修改内容并调整列宽后点击「完成并应用」
      expandBtn!.click()
      await finishDialogTransition()

      const titleEl = document.querySelector('[data-testid="landscape-dialog-title"]')
      expect(titleEl?.textContent).toContain('表-app-t2')
      expect(document.querySelector('.lt-editor-content .ProseMirror')).not.toBeNull()
      expect(document.querySelector('.lt-editor-content .std-table-caption')).toBeNull()

      // 使用弹窗快捷按钮「均分列宽」，并点击应用
      document.querySelector<HTMLButtonElement>('[data-testid="lt-even-width-btn"]')!.click()
      await flush()
      document.querySelector<HTMLButtonElement>('[data-testid="lt-apply-btn"]')!.click()
      await finishDialogTransition()

      // 关闭后子编辑器应已被销毁卸载（不再渲染 .ProseMirror 内容）
      expect(document.querySelector('.lt-editor-content .ProseMirror')).toBeNull()
      let updatedTable: any = null
      editor.state.doc.descendants((node: any) => {
        if (node.type.name === 'stdTable' && node.attrs.nodeId === 'app-t2') updatedTable = node.toJSON()
      })
      expect(updatedTable).not.toBeNull()
      // 保留原有表题
      expect(updatedTable.content[0]).toMatchObject({
        type: 'tableCaption',
        content: [{ type: 'text', text: '表-app-t2' }],
      })
      // 单列均分 952px 写入 colwidth
      expect(updatedTable.content[1].content[0].content[0].attrs.colwidth).toEqual([952])

      // 主编辑器按一次 Ctrl+Z（undo）即可整步撤销该次弹窗应用
      expect(editor.can().undo()).toBe(true)
      editor.commands.undo()
      await flush()
      let undoneTable: any = null
      editor.state.doc.descendants((node: any) => {
        if (node.type.name === 'stdTable' && node.attrs.nodeId === 'app-t2') undoneTable = node.toJSON()
      })
      expect(undoneTable.content[1].content[0].content[0].attrs.colwidth).toBeNull()

      // 5. 将附录整体切换为横向后，原先 portrait 的附录纵表 app-t1 也变为有效横向，能通过自定义事件展开编辑
      editor.commands.setTextSelection(positionOf(editor, '方法验证汇总'))
      await flush()
      button(view.root, '横向').click()
      await flush()

      editor.commands.setTextSelection(positionOf(editor, '附录纵表内容'))
      await flush()
      expect(view.root.querySelector('[data-testid="context-expand-landscape-btn"]')).not.toBeNull()

      window.dispatchEvent(new CustomEvent('ses:expand-landscape-table', { detail: { nodeId: 'app-t1' } }))
      await finishDialogTransition()
      expect(document.querySelector('[data-testid="landscape-dialog-title"]')?.textContent).toContain('表-app-t1')
      expect(document.querySelector('.lt-editor-content .ProseMirror')).not.toBeNull()

      // 6. 验证弹窗开启期间行内公式事件路由到子编辑器
      const mainSnapshotBeforeModal = JSON.stringify(editor.getJSON())
      window.dispatchEvent(new CustomEvent('ses:edit-inline-formula', {
        detail: { mode: 'insert', pos: 4, latex: '' },
      }))
      await flush()
      expect(mocks.mathDialogProps?.modelValue).toBe(true)
      mocks.mathConfirm?.('q_V')
      await flush()
      // 尚未点击「完成并应用」前，主编辑器文档应保持未变
      expect(JSON.stringify(editor.getJSON())).toBe(mainSnapshotBeforeModal)

      // 点击「完成并应用」后，弹窗内新增的行内公式同步回到主编辑器 app-t1 中
      document.querySelector<HTMLButtonElement>('[data-testid="lt-apply-btn"]')!.click()
      await finishDialogTransition()
      expect(document.querySelector('.lt-editor-content .ProseMirror')).toBeNull()

      let appT1AfterFormula: any = null
      editor.state.doc.descendants((node: any) => {
        if (node.type.name === 'stdTable' && node.attrs.nodeId === 'app-t1') appT1AfterFormula = node.toJSON()
      })
      expect(JSON.stringify(appT1AfterFormula)).toContain('"formulaInline"')
      expect(JSON.stringify(appT1AfterFormula)).toContain('q_V')
    } finally {
      view.unmount()
    }
  })

  it('空图点击与键盘补选遵守只读状态与真实节点位置校验', async () => {
    const view = await mountEditor()
    try {
      const editor = view.editor
      const editorProps = mocks.editorOptions.editorProps
      editor.commands.setContent({
        type: 'doc',
        content: [{
          type: 'chapter',
          content: [
            { type: 'chapterTitle', content: [{ type: 'text', text: '第一章' }] },
            {
              type: 'figure',
              content: [
                { type: 'figureImage', attrs: { src: '' } },
                { type: 'figureCaption', content: [{ type: 'text', text: '图题' }] },
              ],
            },
          ],
        }],
      })
      await flush()

      let figImgPos = -1
      editor.state.doc.descendants((node: any, p: number) => {
        if (node.type.name === 'figureImage') figImgPos = p
      })
      const figImgNode = editor.state.doc.nodeAt(figImgPos)

      // 只读状态下点击与 Enter 都不拦截也不触发选图
      editor.setEditable(false)
      expect(editorProps.handleClickOn(editor.view, figImgPos, figImgNode, figImgPos, new MouseEvent('click'), true)).toBe(false)
      const emptyImg = document.createElement('img')
      emptyImg.setAttribute('role', 'button')
      const roKey = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      Object.defineProperty(roKey, 'target', { value: emptyImg })
      expect(editorProps.handleKeyDown(editor.view, roKey)).toBe(false)

      // 可编辑状态下，即使 dom nodeDOM 命中了外层非空图节点（如 figure），因 nodeAt(p) 非空图而不误触发
      editor.setEditable(true)
      const figEl = document.createElement('figure')
      figEl.setAttribute('role', 'button')
      const bogusKey = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      Object.defineProperty(bogusKey, 'target', { value: figEl })
      expect(editorProps.handleKeyDown(editor.view, bogusKey)).toBe(false)
    } finally {
      view.unmount()
    }
  })
})

describe('EditorView 右侧表格浮窗与纵向列宽', () => {
  it('工具栏直接插入 3×3 表格，光标进入/离开表格时右侧浮窗自动显隐并与上下文条共存', async () => {
    const view = await mountEditor()
    try {
      const { editor } = view
      const floatingPanel = () => view.root.querySelector<HTMLElement>('[data-testid="table-floating-panel"]')

      // 正文段落中不显示右侧表格浮窗
      editor.commands.setTextSelection(positionOf(editor, '本文件规定'))
      await flush()
      expect(floatingPanel()).toBeNull()

      // 点击顶部工具栏「表格」直接插入 3×3 标准表格
      const insertBtn = view.root.querySelector<HTMLButtonElement>('[data-testid="toolbar-insert-table-btn"]')
      expect(insertBtn).not.toBeNull()
      expect(insertBtn!.textContent?.trim()).toBe('表格')

      const existingIds = new Set<string>()
      editor.state.doc.descendants((node: any) => {
        if (node.type.name === 'stdTable' && node.attrs.nodeId) existingIds.add(node.attrs.nodeId)
      })
      insertBtn!.click()
      await flush()

      let tablesAfter = 0
      let insertedTable: any = null
      editor.state.doc.descendants((node: any) => {
        if (node.type.name === 'stdTable') {
          tablesAfter += 1
          if (!existingIds.has(node.attrs.nodeId)) insertedTable = node
        }
      })
      expect(tablesAfter).toBe(existingIds.size + 1)
      expect(insertedTable).not.toBeNull()
      // 验证插入的是 3 行 × 3 列标准表格
      const insertedGrid = insertedTable.child(1)
      expect(insertedGrid.childCount).toBe(3)
      expect(insertedGrid.child(0).childCount).toBe(3)

      // 光标位于新插入的表格内部：浮窗与「当前表」上下文条同时出现在 .ed-main > .tbar-context-shelf
      expect(floatingPanel()).not.toBeNull()
      expect(floatingPanel()!.closest('.ed-main > .tbar-context-shelf')).not.toBeNull()
      expect(floatingPanel()!.classList.contains('tbar-context')).toBe(false)
      expect(nodeGroup(view.root)?.querySelector('.tbar-label')?.textContent?.trim()).toBe('当前表')

      // 光标移出表格回到正文段落：浮窗自动隐藏
      editor.commands.setTextSelection(positionOf(editor, '本文件规定'))
      await flush()
      expect(floatingPanel()).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('在纵向表格中支持均分 662px 列宽、自动列宽（含清空 columns）及单步撤销，且框选多单元格合并时不丢选区', async () => {
    const view = await mountEditor()
    try {
      const { editor } = view

      // 构造含名义列宽 columns 的 3 列表格（在正文中）
      editor.commands.setContent({
        type: 'doc',
        content: [
          chapter('c1', '范围', 'scope',
            paragraph('p1', text('前置正文。')),
            {
              type: 'stdTable',
              attrs: {
                nodeId: 'tbl-portrait-3col',
                orientation: 'portrait',
                columns: [
                  { width: 20, widthUnit: '%' },
                  { width: 30, widthUnit: '%' },
                  { width: 50, widthUnit: '%' },
                ],
              },
              content: [
                { type: 'tableCaption', content: [text('纵向三列表')] },
                {
                  type: 'table',
                  content: [
                    {
                      type: 'tableRow',
                      content: [
                        { type: 'tableHeader', attrs: { colwidth: [120] }, content: [paragraph('h1', text('列一'))] },
                        { type: 'tableHeader', attrs: { colwidth: [180] }, content: [paragraph('h2', text('列二'))] },
                        { type: 'tableHeader', attrs: { colwidth: [240] }, content: [paragraph('h3', text('列三'))] },
                      ],
                    },
                    {
                      type: 'tableRow',
                      content: [
                        { type: 'tableCell', attrs: { colwidth: [120] }, content: [paragraph('d1', text('甲'))] },
                        { type: 'tableCell', attrs: { colwidth: [180] }, content: [paragraph('d2', text('乙'))] },
                        { type: 'tableCell', attrs: { colwidth: [240] }, content: [paragraph('d3', text('丙'))] },
                      ],
                    },
                  ],
                },
              ],
            },
          ),
        ],
      })
      await flush()

      editor.commands.setTextSelection(positionOf(editor, '甲'))
      await flush()

      const findStdTable = () => {
        let found: any = null
        editor.state.doc.descendants((node: any) => {
          if (node.type.name === 'stdTable' && node.attrs.nodeId === 'tbl-portrait-3col') found = node
        })
        return found
      }

      // 1. 点击「均分列宽」-> 662px 均分 3 列为 [220, 221, 221]
      const evenBtn = view.root.querySelector<HTMLButtonElement>('[data-testid="table-panel-even-width"]')!
      expect(evenBtn).not.toBeNull()
      evenBtn.click()
      await flush()
      expect(getStdTableGridColwidths(findStdTable())!.widths).toEqual([220, 221, 221])

      // 2. 点击「自动列宽」-> 清空 colwidth 与 stdTable.attrs.columns
      const autoBtn = view.root.querySelector<HTMLButtonElement>('[data-testid="table-panel-auto-width"]')!
      autoBtn.click()
      await flush()
      expect(getStdTableGridColwidths(findStdTable())!.widths).toEqual([null, null, null])
      expect(findStdTable().attrs.columns).toBeNull()

      // 3. 单步撤销恢复 colwidth 与 columns
      editor.commands.undo()
      await flush()
      expect(getStdTableGridColwidths(findStdTable())!.widths).toEqual([220, 221, 221])
      expect(findStdTable().attrs.columns).toEqual([
        { width: 20, widthUnit: '%' },
        { width: 30, widthUnit: '%' },
        { width: 50, widthUnit: '%' },
      ])

      // 4. 多选单元格（CellSelection）后点击「合并单元格」：保留选区并完成合并
      const cellPositions: number[] = []
      editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell') cellPositions.push(pos)
      })
      editor.view.dispatch(
        editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cellPositions[0]!, cellPositions[1]!)),
      )
      await flush()

      const mergeBtn = view.root.querySelector<HTMLButtonElement>('[data-testid="table-panel-merge-cells"]')!
      expect(mergeBtn.disabled).toBe(false)
      const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      mergeBtn.dispatchEvent(mousedown)
      expect(mousedown.defaultPrevented).toBe(true)
      mergeBtn.click()
      await flush()

      const bodyRow = findStdTable().child(1).child(1)
      expect(bodyRow.childCount).toBe(2)
      expect(bodyRow.child(0).attrs.colspan).toBe(2)
    } finally {
      view.unmount()
    }
  })

  it('禁止在节外（如文档末尾补位段落）插入无编号表格，章内连续插表正确编号为表2', async () => {
    const view = await mountEditor()
    try {
      const { editor } = view

      // 1. 光标在正文表内点击工具栏「表格」：新表插入同一章内，自动获得表2 编号（而非 ?）
      editor.commands.setTextSelection(positionOf(editor, '正文表内容'))
      await flush()
      const insertBtn = view.root.querySelector<HTMLButtonElement>('[data-testid="toolbar-insert-table-btn"]')!
      insertBtn.click()
      await flush()

      const firstChapter = editor.state.doc.children.find((n: any) => n.type.name === 'chapter')!
      const chapterTables: string[] = []
      firstChapter.forEach((child: any) => {
        if (child.type.name === 'stdTable') chapterTables.push(child.attrs.nodeId)
      })
      expect(chapterTables).toHaveLength(2)
      const labels = resolveEditorLabels(editor.state.doc)
      expect(labels[chapterTables[0]!]?.label).toBe('表1')
      expect(labels[chapterTables[1]!]?.label).toBe('表2')

      // 2. 光标位于文档末尾游离段落（节外）时点击「表格」：拒绝插入根级无编号表格（避免表题出现 ?）
      editor.commands.setContent({
        type: 'doc',
        content: [
          chapter('c1', '范围', 'scope', paragraph('p1', text('正文'))),
          { type: 'paragraph', attrs: { nodeId: 'stray-p' }, content: [text('游离段落')] },
        ],
      })
      await flush()
      editor.commands.setTextSelection(positionOf(editor, '游离段落'))
      await flush()
      insertBtn.click()
      await flush()

      const rootTableCount = editor.state.doc.children.filter((n: any) => n.type.name === 'stdTable').length
      expect(rootTableCount).toBe(0)
    } finally {
      view.unmount()
    }
  })

  it('窄画布（.ed-main < 1136px）下表格浮窗自动收起为紧凑胶囊，避免遮挡右侧单元格，变宽后恢复展开', async () => {
    const callbacks: Array<() => void> = []
    class MockResizeObserver {
      constructor(cb: () => void) { callbacks.push(cb) }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const view = await mountEditor()
    try {
      const { editor } = view
      const edMain = view.root.querySelector<HTMLElement>('.ed-main')!
      let simulatedWidth = 900
      Object.defineProperty(edMain, 'clientWidth', { configurable: true, get: () => simulatedWidth })
      callbacks.forEach(cb => cb())
      await flush()

      editor.commands.setTextSelection(positionOf(editor, '正文表内容'))
      await flush()

      const panel = view.root.querySelector<HTMLElement>('[data-testid="table-floating-panel"]')!
      expect(panel).not.toBeNull()
      expect(panel.classList.contains('is-collapsed')).toBe(true)

      simulatedWidth = 1200
      callbacks.forEach(cb => cb())
      await flush()
      expect(panel.classList.contains('is-collapsed')).toBe(false)

      simulatedWidth = 820
      callbacks.forEach(cb => cb())
      await flush()
      expect(panel.classList.contains('is-collapsed')).toBe(true)
    } finally {
      view.unmount()
    }
  })
})

