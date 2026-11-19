// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import type { MathfieldStatics } from '@/utils/mathlive'
import MathInputDialog from './MathInputDialog.vue'

const roots: HTMLElement[] = []
afterEach(() => { while (roots.length) roots.pop()!.remove(); document.body.innerHTML = ''; vi.restoreAllMocks() })

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }
}

async function finishDialogTransition(): Promise<void> {
  await settle()
  // happy-dom does not finish CSS transitions on its own.
  document.querySelectorAll('.el-overlay-dialog, .el-dialog').forEach(el => el.dispatchEvent(new Event('transitionend')))
  await settle()
}

function registerMathfield(): void {
  if (!customElements.get('math-field')) {
    customElements.define('math-field', class extends HTMLElement {
      value = ''
      getValue() { return this.value }
      insert() { return true }
      resetUndo() {}
    })
  }
}

async function mountDialog(initialLatex = '', loader: () => Promise<MathfieldStatics | null> = async () => null) {
  const root = document.createElement('div')
  document.body.append(root)
  roots.push(root)
  const open = ref(false)
  const confirmed: string[] = []
  const app = createApp({
    setup: () => () => h(MathInputDialog, {
      modelValue: open.value,
      initialLatex,
      loader,
      'onUpdate:modelValue': (value: boolean) => { open.value = value },
      onConfirm: (latex: string) => confirmed.push(latex),
    }),
  })
  app.use(ElementPlus).mount(root)
  open.value = true
  await finishDialogTransition()
  return { open, confirmed, app }
}

it('MathLive 加载失败时退回 LaTeX 源码输入，校验通过后回传并关闭', async () => {
  const { open, confirmed, app } = await mountDialog('q')
  expect(document.querySelector('.math-dlg-hint')?.textContent).toContain('加载失败')
  expect((document.querySelector('.math-dlg-source') as HTMLElement).style.display).not.toBe('none')
  expect((document.querySelector('.math-dlg-visual') as HTMLElement).style.display).toBe('none')
  const textarea = document.querySelector('.math-dlg-source-input textarea') as HTMLTextAreaElement
  expect(textarea).not.toBeNull()
  expect(textarea.value).toBe('q')
  textarea.value = String.raw` \rho_{\mathrm{w}} `
  textarea.dispatchEvent(new Event('input'))
  await settle()
  expect(document.querySelector('.math-dlg-preview-body .katex')).not.toBeNull()
  ;(document.querySelector('.math-dlg-confirm') as HTMLButtonElement).click()
  await settle()
  expect(confirmed).toEqual([String.raw`\rho_{\mathrm{w}}`])
  expect(open.value).toBe(false)
  app.unmount()
})

it('无法解析的 LaTeX 显示错误，不回传', async () => {
  const { open, confirmed, app } = await mountDialog(String.raw`\frac{`)
  ;(document.querySelector('.math-dlg-confirm') as HTMLButtonElement).click()
  await settle()
  expect(confirmed).toEqual([])
  expect(open.value).toBe(true)
  expect(document.querySelector('.math-dlg-error')?.textContent).toContain('KaTeX 无法解析')
  app.unmount()
})

it('复杂公式显示行高提示，但仍可保存', async () => {
  const { confirmed, app } = await mountDialog(String.raw`\frac{a}{b}`)
  expect(document.querySelector('.math-dlg-complex')?.textContent).toContain('撑高所在行')
  ;(document.querySelector('.math-dlg-confirm') as HTMLButtonElement).click()
  await settle()
  expect(confirmed).toEqual([String.raw`\frac{a}{b}`])
  app.unmount()
})

it('简单符号不显示提示', async () => {
  const { app } = await mountDialog('q_{V}')
  expect(document.querySelector('.math-dlg-complex')).toBeNull()
  app.unmount()
})

it('屏幕键盘层级高于弹窗遮罩，弹出时弹窗让出底部，关闭弹窗时收起键盘', async () => {
  registerMathfield()
  const keyboard = Object.assign(new EventTarget(), {
    visible: false,
    boundingRect: new DOMRect(0, 0, 0, 0),
    hide: vi.fn(),
  })
  Object.assign(window, { mathVirtualKeyboard: keyboard })
  const { open, app } = await mountDialog('x', async () => ({}) as MathfieldStatics)

  const overlay = document.querySelector('.el-overlay') as HTMLElement
  expect(overlay.style.zIndex).not.toBe('')
  const keyboardZ = Number(document.body.style.getPropertyValue('--keyboard-zindex'))
  expect(keyboardZ).toBeGreaterThan(Number(overlay.style.zIndex))

  keyboard.visible = true
  keyboard.boundingRect = new DOMRect(0, 400, 1000, 320)
  const overlayDialog = document.querySelector('.el-overlay-dialog') as HTMLElement
  const dialog = document.querySelector('.el-dialog') as HTMLElement
  const field = document.querySelector('math-field') as HTMLElement
  let paddingAtRead = ''
  vi.spyOn(dialog, 'getBoundingClientRect').mockImplementation(() => {
    paddingAtRead = overlayDialog.style.paddingBottom
    return new DOMRect(0, 120, 560, 420)
  })
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 260, 500, 44))
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
  let scheduledScroll: FrameRequestCallback | null = null
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    scheduledScroll = cb
    return 1
  })
  keyboard.dispatchEvent(new Event('geometrychange'))
  expect(paddingAtRead).toBe('')
  expect(overlayDialog.style.paddingBottom).toBe('320px')
  expect(overlayDialog.scrollTop).toBe(0)
  scheduledScroll!(0)
  expect(overlayDialog.scrollTop).toBe(160)

  open.value = false
  await settle()
  expect(keyboard.hide).toHaveBeenCalled()
  expect(document.body.style.getPropertyValue('--keyboard-zindex')).toBe('')
  app.unmount()
  Reflect.deleteProperty(window, 'mathVirtualKeyboard')
})

it('keeps the MathLive field mounted on close and resets the draft on reopen', async () => {
  registerMathfield()
  const { open, app, confirmed } = await mountDialog('x=1', async () => ({}) as MathfieldStatics)
  try {
    const field = document.querySelector('math-field') as HTMLElement & { value: string }
    expect(field.value).toBe('x=1')
    field.value = 'x=2'
    field.dispatchEvent(new Event('input'))
    open.value = false
    await finishDialogTransition()
    expect(field.isConnected).toBe(true)

    open.value = true
    await finishDialogTransition()
    expect(document.querySelector('math-field')).toBe(field)
    expect(field.value).toBe('x=1')
    expect(confirmed).toEqual([])
  } finally {
    app.unmount()
  }
})
