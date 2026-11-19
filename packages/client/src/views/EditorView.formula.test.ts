// @vitest-environment happy-dom
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import ElementPlus from 'element-plus'
import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { chapter, paragraph, text } from '@/validation/__fixtures__/phase6'
import EditorView from './EditorView.vue'

const mock = vi.hoisted(() => ({
  store: { currentDocument: {} as Record<string, unknown>, fetchDocument: vi.fn(), isDocumentUnavailable: () => false },
}))

vi.setConfig({ testTimeout: 15000 })

vi.mock('@/stores/document', () => ({ useDocumentStore: () => mock.store }))
vi.mock('@/api/document', () => ({ documentApi: { update: vi.fn() } }))
vi.mock('@/utils/documentChangeSync', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/documentChangeSync')>(),
  startDocumentChangeSync: () => ({ stop() {} }),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '17' } }), useRouter: () => ({ push: vi.fn() }), onBeforeRouteLeave: vi.fn(),
}))
vi.mock('@/utils/mathlive', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/mathlive')>(), loadMathLive: async () => null,
}))

const existingLatex = String.raw`x=\frac{a}{b}`
const currentFormula = {
  type: 'formula', attrs: { nodeId: 'f1', numbered: false, latex: 'old-source' }, content: [
    { type: 'formulaContent', content: [text(existingLatex)] },
    { type: 'formulaNote', attrs: { nodeId: 'note' }, content: [text('原来的公式注')] },
    { type: 'whereList', content: [{ type: 'whereItem', attrs: { nodeId: 'item' }, content: [
      { type: 'whereTerm', content: [text('x')] }, { type: 'whereDefinition', content: [text('原来的符号说明')] },
    ] }] },
  ],
}

let app: App | undefined
async function settle() {
  for (let index = 0; index < 5; index++) {
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function mountEditor() {
  mock.store.currentDocument = {
    id: 17, revision: 1, meta: { titleCn: '公式', standardType: 'national' },
    content: { type: 'doc', content: [chapter('ch', '范围', 'scope', paragraph('p', text('前文')), currentFormula)] },
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({ render: () => h(EditorView) })
  app.use(ElementPlus).mount(root)
  await settle()
  const editor = (root.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.nodeId === 'p') editor.commands.setTextSelection(pos + 1)
  })
  return { root, editor }
}

function chapterNode(editor: Editor) {
  return editor.state.doc.content.content.find(node => node.attrs.nodeId === 'ch')!
}

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

async function dialogInput(): Promise<HTMLTextAreaElement> {
  await settle()
  document.querySelectorAll('.el-overlay-dialog, .el-dialog').forEach(element => element.dispatchEvent(new Event('transitionend')))
  await settle()
  const input = document.querySelector<HTMLTextAreaElement>('.ses-math-dlg textarea')
  expect(input).toBeTruthy()
  return input!
}

async function confirmLatex(input: HTMLTextAreaElement, latex: string) {
  input.value = latex
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  document.querySelector<HTMLButtonElement>('.ses-math-dlg .math-dlg-confirm')!.click()
  await settle()
}

it('renders only the equation and applies dialog edits to the clicked formula', async () => {
  const { root, editor } = await mountEditor()
  const formula = root.querySelector('.std-formula')!
  const equation = formula.querySelector<HTMLElement>('.std-formula-content')!
  const rendered = equation.querySelector<HTMLButtonElement>('.std-formula-preview')!
  expect(rendered?.querySelector('.katex')).toBeTruthy()
  expect(equation.childNodes.length).toBe(1)
  expect(equation.firstChild).toBe(rendered)
  rendered.click()
  const input = await dialogInput()
  expect(input.value).toBe(existingLatex)
  await confirmLatex(input, String.raw`z=\sqrt{2}`)
  const updated = chapterNode(editor).lastChild!
  expect(updated.attrs).toMatchObject({ nodeId: 'f1', numbered: false })
  expect(updated.firstChild!.textContent).toBe(String.raw`z=\sqrt{2}`)
  expect(updated.child(1).textContent).toBe('原来的公式注')
  expect(updated.child(2).textContent).toContain('原来的符号说明')
  expect(root.querySelector('.std-formula-preview .sqrt')).toBeTruthy()
})

it('opens the formula editor from the toolbar and inserts only on confirmation', async () => {
  const { root, editor } = await mountEditor()
  const before = editor.state.doc
  const toolbar = [...root.querySelectorAll<HTMLButtonElement>('button.tbar-btn')].find(button => button.textContent === '公式')!
  toolbar.click()
  expect((await dialogInput()).value).toBe('')
  expect(editor.state.doc).toBe(before)
  const cancel = [...document.querySelectorAll<HTMLButtonElement>('.ses-math-dlg button')].find(button => button.textContent?.trim() === '取消')!
  cancel.click()
  await settle()
  expect(editor.state.doc).toBe(before)

  toolbar.click()
  await confirmLatex(await dialogInput(), 'v=2')
  expect(chapterNode(editor).child(2).firstChild!.textContent).toBe('v=2')
  expect(editor.state.selection).toBeInstanceOf(NodeSelection)
  expect(root.textContent).toContain('添加式中')
})

it('removes the slash trigger only when its formula is inserted', async () => {
  const { editor } = await mountEditor()
  editor.commands.insertContent('/')
  const before = editor.state.doc
  window.dispatchEvent(new CustomEvent('slash-command', { detail: {
    items: [{ command: 'formula', label: '公式', description: '插入公式' }], coords: { left: 0, top: 0 },
  } }))
  await nextTick()
  document.querySelector<HTMLElement>('.slash-menu-item')!.click()
  const input = await dialogInput()
  expect(editor.state.doc).toBe(before)
  await confirmLatex(input, 's=vt')
  expect(chapterNode(editor).child(1).textContent).toBe('前文')
  expect(chapterNode(editor).child(2).firstChild!.textContent).toBe('s=vt')
})
