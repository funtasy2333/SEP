// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import SlashMenu from './SlashMenu.vue'

const apps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  while (apps.length) apps.pop()!.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

it('SlashMenu 在隐藏态完成边界钳制后再显形并调用 preventScroll 聚焦', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => () => h(SlashMenu) })
  apps.push(app)
  app.mount(root)

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

  const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(700, 520, 280, 300),
  )

  window.dispatchEvent(new CustomEvent('slash-command', {
    detail: {
      coords: { left: 700, top: 520 },
      items: [{ command: 'paragraph', label: '正文', description: '插入正文段落', group: '常用' }],
    },
  }))

  await nextTick()
  const menu = document.body.querySelector<HTMLElement>('.slash-menu')
  expect(menu).not.toBeNull()
  // 初次渲染尚未完成定位前处于隐藏态且未抢先 focus
  expect(menu!.classList.contains('is-positioned')).toBe(false)

  await settle()
  expect(rectSpy).toHaveBeenCalled()
  expect(menu!.classList.contains('is-positioned')).toBe(true)
  expect(menu!.style.left).toBe('512px')
  expect(menu!.style.top).toBe('190px')
  expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
})
