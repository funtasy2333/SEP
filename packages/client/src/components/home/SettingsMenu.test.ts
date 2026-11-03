// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsMenu from './SettingsMenu.vue'
import { useSystemStore } from '@/stores/system'
import type { SystemInfo } from '@/api/system'

const mocks = vi.hoisted(() => ({
  api: { info: vi.fn(), checkUpdate: vi.fn(), startUpdate: vi.fn(), updateStatus: vi.fn(), shutdown: vi.fn() },
}))

vi.mock('@/api/system', async () => {
  const actual = await vi.importActual<typeof import('@/api/system')>('@/api/system')
  return { ...actual, systemApi: mocks.api }
})

function makeInfo(patch: Partial<SystemInfo> = {}): SystemInfo {
  return {
    version: '0.1.1-preview',
    channel: 'stable',
    commit: null,
    launcher: 'macos',
    canShutdown: true,
    shutdownBlockedReason: null,
    canUpgrade: true,
    upgradeBlockedReason: null,
    upgrade: {
      download: { phase: 'idle', receivedBytes: 0, totalBytes: null, error: null, startedAt: null },
      last: null,
    },
    ...patch,
  }
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function mountMenu(info: SystemInfo | null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSystemStore()
  if (info) store.info = info
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(SettingsMenu)
  app.use(pinia).use(ElementPlus).mount(root)
  await settle()
  const button = root.querySelector<HTMLButtonElement>('button[aria-label="设置"]')!
  expect(button).not.toBeNull()
  button.click()
  await settle()
  return {
    store,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector)

describe('SettingsMenu', () => {
  const confirm = vi.fn()
  let confirmSpy: { mockRestore: () => void }

  beforeEach(() => {
    Object.values(mocks.api).forEach((fn) => fn.mockReset())
    confirm.mockReset()
    confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockImplementation(confirm as never)
  })

  afterEach(() => {
    confirmSpy.mockRestore()
    document.body.innerHTML = ''
  })

  it('稳定版显示「SES 版本 · 稳定版」，并常驻后台运行说明', async () => {
    const ctx = await mountMenu(makeInfo())
    expect(q('[data-test="version-line"]')!.textContent).toBe('SES 0.1.1-preview · 稳定版')
    expect(document.body.textContent).toContain('关闭网页后 SES 仍在后台运行；要彻底退出，请使用『退出 SES』。')
    ctx.unmount()
  })

  it('提交版显示短 sha；通道为空时只显示版本', async () => {
    const commit = await mountMenu(makeInfo({ version: '0.1.1', channel: 'commit', commit: 'a1b2c3d4e5f60718' }))
    expect(q('[data-test="version-line"]')!.textContent).toBe('SES 0.1.1 · 提交版 a1b2c3d')
    commit.unmount()
    document.body.innerHTML = ''

    const none = await mountMenu(makeInfo({ version: '0.1.1', channel: null }))
    expect(q('[data-test="version-line"]')!.textContent).toBe('SES 0.1.1')
    none.unmount()
  })

  it('不可升级、不可退出时置灰并显示原因', async () => {
    const ctx = await mountMenu(makeInfo({
      canUpgrade: false,
      upgradeBlockedReason: '当前不是由启动脚本运行',
      canShutdown: false,
      shutdownBlockedReason: '无法确认运行方式',
    }))
    expect(q('[data-test="upgrade-item"]')!.hasAttribute('disabled')).toBe(true)
    expect(q('[data-test="upgrade-reason"]')!.textContent).toContain('当前不是由启动脚本运行')
    expect(q('[data-test="shutdown-item"]')!.hasAttribute('disabled')).toBe(true)
    expect(q('[data-test="shutdown-reason"]')!.textContent).toContain('无法确认运行方式')
    ctx.unmount()
  })

  it('退出 SES：确认后调用 shutdown 并进入 exited', async () => {
    confirm.mockResolvedValue('confirm')
    mocks.api.shutdown.mockResolvedValue({ data: { accepted: true } })
    const ctx = await mountMenu(makeInfo())
    q('[data-test="shutdown-item"]')!.click()
    await settle()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0][0])).toContain('退出后所有 SES 页面都将无法使用，再次使用请双击『启动SES』。未保存的修改请先保存。')
    expect(mocks.api.shutdown).toHaveBeenCalledTimes(1)
    expect(ctx.store.mode).toBe('exited')
    ctx.unmount()
  })

  it('取消退出确认：不调用 shutdown，状态不变', async () => {
    confirm.mockRejectedValue('cancel')
    const ctx = await mountMenu(makeInfo())
    q('[data-test="shutdown-item"]')!.click()
    await settle()
    expect(mocks.api.shutdown).not.toHaveBeenCalled()
    expect(ctx.store.mode).toBe('normal')
    ctx.unmount()
  })

  it('退出请求失败：保持 normal', async () => {
    confirm.mockResolvedValue('confirm')
    mocks.api.shutdown.mockRejectedValue({ response: { status: 500, data: { message: '退出失败了' } } })
    const ctx = await mountMenu(makeInfo())
    q('[data-test="shutdown-item"]')!.click()
    await settle()
    expect(ctx.store.mode).toBe('normal')
    ctx.unmount()
  })

  it('info 加载失败时显示错误并允许重试', async () => {
    mocks.api.info.mockRejectedValueOnce(new Error('boom'))
    const ctx = await mountMenu(null)
    expect(q('[data-test="info-error"]')).not.toBeNull()
    mocks.api.info.mockResolvedValueOnce({ data: makeInfo({ version: '0.2.0' }) })
    q('[data-test="info-retry"]')!.click()
    await settle()
    expect(q('[data-test="version-line"]')!.textContent).toBe('SES 0.2.0 · 稳定版')
    ctx.unmount()
  })
})
