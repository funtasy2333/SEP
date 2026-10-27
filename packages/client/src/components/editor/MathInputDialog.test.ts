// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import ElementPlus from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import type { MathfieldStatics } from '@/utils/mathlive'
import MathInputDialog from './MathInputDialog.vue'

const roots: HTMLElement[] = []
afterEach(() => { while (roots.length) roots.pop()!.remove(); document.body.innerHTML = '' })

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }
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
  await settle()
  // happy-dom 不触发过渡事件；直接派发 el-dialog 的 opened 回调依赖的过渡结束。
  document.querySelectorAll('.el-overlay-dialog, .el-dialog').forEach(el => el.dispatchEvent(new Event('transitionend')))
  await settle()
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
  if (!customElements.get('math-field')) {
    customElements.define('math-field', class extends HTMLElement {
      value = ''
      getValue() { return this.value }
      insert() { return true }
    })
  }
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
  keyboard.dispatchEvent(new Event('geometrychange'))
  expect((document.querySelector('.el-overlay-dialog') as HTMLElement).style.paddingBottom).toBe('320px')

  open.value = false
  await settle()
  expect(keyboard.hide).toHaveBeenCalled()
  expect(document.body.style.getPropertyValue('--keyboard-zindex')).toBe('')
  app.unmount()
  Reflect.deleteProperty(window, 'mathVirtualKeyboard')
})
