// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsMenu from './SettingsMenu.vue'
import { useSystemStore } from '@/stores/system'
import type { DesktopStatus, SystemInfo, UpdateCheck } from '@/api/system'

const mocks = vi.hoisted(() => ({
  api: {
    info: vi.fn(),
    desktopStatus: vi.fn(),
    createShortcuts: vi.fn(),
    setAutoStart: vi.fn(),
    checkUpdate: vi.fn(),
    startUpdate: vi.fn(),
    updateStatus: vi.fn(),
    shutdown: vi.fn(),
  },
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

function makeDesktop(patch: Partial<DesktopStatus> = {}): DesktopStatus {
  return {
    supported: true,
    unsupportedReason: null,
    platform: 'macos',
    desktopShortcut: false,
    startMenuShortcut: false,
    autoStart: false,
    ...patch,
  }
}

function makeCheck(patch: Partial<UpdateCheck> = {}): UpdateCheck {
  return {
    channel: 'stable',
    current: { version: '0.1.1-preview', commit: null, channel: 'stable' },
    latest: {
      version: '0.2.0',
      commit: 'deadbeefcafe0123',
      publishedAt: '2026-10-30T08:00:00.000Z',
      notes: '更新日志',
      url: 'https://example.com/releases/v0.2.0',
      assetSize: 1024,
    },
    available: true,
    reason: null,
    commits: [{ sha: '1234567890abcdef', message: 'feat', date: '2026-10-29T08:00:00.000Z', author: 'a' }],
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

async function mountMenu(
  info: SystemInfo | null,
  check: UpdateCheck | null = null,
  desktop: DesktopStatus | null = makeDesktop(),
) {
  if (desktop && !mocks.api.desktopStatus.getMockImplementation()) {
    mocks.api.desktopStatus.mockResolvedValue({ data: desktop })
  }
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSystemStore()
  if (info) store.info = info
  if (check) store.recordUpdateCheck(check)
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
    root,
    button,
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
  const msgSuccess = vi.fn()
  const msgError = vi.fn()
  let confirmSpy: { mockRestore: () => void }
  let successSpy: { mockRestore: () => void }
  let errorSpy: { mockRestore: () => void }

  beforeEach(() => {
    Object.values(mocks.api).forEach((fn) => fn.mockReset())
    confirm.mockReset()
    msgSuccess.mockReset()
    msgError.mockReset()
    confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockImplementation(confirm as never)
    successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(msgSuccess as never)
    errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(msgError as never)
    localStorage.clear()
  })

  afterEach(() => {
    confirmSpy.mockRestore()
    successSpy.mockRestore()
    errorSpy.mockRestore()
    localStorage.clear()
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

  it('有未读更新时显示按钮红点与菜单内「有新版本」标签；忽略后红点消失但保留菜单标签，且与共享弹窗联动', async () => {
    const ctx = await mountMenu(makeInfo(), makeCheck())
    expect(ctx.button.getAttribute('title')).toBe('设置（有新版本可用）')
    expect(ctx.root.querySelector('[data-test="settings-update-dot"]')).not.toBeNull()
    expect(q('[data-test="upgrade-badge"]')?.textContent).toBe('有新版本')

    ctx.store.dismissCurrentUpdate()
    await settle()
    expect(ctx.button.getAttribute('title')).toBeNull()
    expect(ctx.root.querySelector('[data-test="settings-update-dot"]')).toBeNull()
    expect(q('[data-test="upgrade-badge"]')?.textContent).toBe('有新版本')

    q('[data-test="upgrade-item"]')!.click()
    await settle()
    expect(ctx.store.upgradeDialogOpen).toBe(true)
    expect(q('[data-test="latest-version"]')?.textContent).toBe('0.2.0')
    ctx.unmount()
  })

  it('macOS 与 Windows 快捷方式文案与「已创建」状态正确显示', async () => {
    mocks.api.desktopStatus.mockResolvedValueOnce({ data: makeDesktop({ platform: 'macos' }) })
    const mac = await mountMenu(makeInfo({ launcher: 'macos' }), null, null)
    expect(q('[data-test="shortcut-item"]')!.textContent).toContain('创建桌面与应用程序快捷方式')
    expect(q('[data-test="shortcut-created-badge"]')).toBeNull()
    mac.unmount()
    document.body.innerHTML = ''

    mocks.api.desktopStatus.mockResolvedValueOnce({
      data: makeDesktop({
        platform: 'windows',
        desktopShortcut: true,
        startMenuShortcut: true,
      }),
    })
    const win = await mountMenu(makeInfo({ launcher: 'windows' }), null, null)
    expect(q('[data-test="shortcut-item"]')!.textContent).toContain('重建桌面与开始菜单快捷方式')
    expect(q('[data-test="shortcut-created-badge"]')?.textContent).toBe('已创建')
    win.unmount()
  })

  it('点击创建快捷方式：调用接口并更新为已创建状态', async () => {
    mocks.api.desktopStatus.mockResolvedValueOnce({ data: makeDesktop({ platform: 'windows' }) })
    mocks.api.createShortcuts.mockResolvedValueOnce({
      data: {
        desktopShortcut: true,
        startMenuShortcut: true,
        desktopPath: 'C:\\Desktop\\SES.lnk',
        startMenuPath: 'C:\\Start\\SES.lnk',
      },
    })
    const ctx = await mountMenu(makeInfo({ launcher: 'windows' }), null, null)
    q('[data-test="shortcut-item"]')!.click()
    await settle()
    expect(mocks.api.createShortcuts).toHaveBeenCalledTimes(1)
    expect(q('[data-test="shortcut-item"]')!.textContent).toContain('重建桌面与开始菜单快捷方式')
    expect(q('[data-test="shortcut-created-badge"]')?.textContent).toBe('已创建')
    expect(msgSuccess).toHaveBeenCalledWith('已创建桌面与开始菜单快捷方式')
    ctx.unmount()
  })

  it('创建快捷方式失败：弹窗提示且不伪造已创建状态', async () => {
    mocks.api.desktopStatus.mockResolvedValueOnce({ data: makeDesktop({ platform: 'macos' }) })
    mocks.api.createShortcuts.mockRejectedValueOnce({
      response: { status: 500, data: { message: '写入桌面目录失败' } },
    })
    const ctx = await mountMenu(makeInfo(), null, null)
    q('[data-test="shortcut-item"]')!.click()
    await settle()
    expect(msgError).toHaveBeenCalledWith('写入桌面目录失败')
    expect(q('[data-test="shortcut-created-badge"]')).toBeNull()
    ctx.unmount()
  })

  it('切换开机后台自启开关：成功更新状态，失败保持原值并提示错误', async () => {
    mocks.api.desktopStatus.mockResolvedValueOnce({ data: makeDesktop({ autoStart: false }) })
    mocks.api.setAutoStart.mockResolvedValueOnce({ data: { autoStart: true } })
    const ctx = await mountMenu(makeInfo(), null, null)
    const switchEl = q('[data-test="autostart-switch"]')!
    const switchInput = switchEl.querySelector('input')!
    expect(switchInput.getAttribute('aria-checked')).toBe('false')
    expect(switchEl.classList.contains('is-checked')).toBe(false)

    switchEl.click()
    await settle()
    expect(mocks.api.setAutoStart).toHaveBeenCalledWith(true)
    expect(ctx.store.desktopStatus?.autoStart).toBe(true)
    expect(switchInput.getAttribute('aria-checked')).toBe('true')
    expect(switchEl.classList.contains('is-checked')).toBe(true)
    expect(msgSuccess).toHaveBeenCalledWith('已开启开机后台自启')

    mocks.api.setAutoStart.mockRejectedValueOnce({
      response: { status: 500, data: { message: 'LaunchAgents 不可写' } },
    })
    switchEl.click()
    await settle()
    expect(mocks.api.setAutoStart).toHaveBeenCalledWith(false)
    expect(ctx.store.desktopStatus?.autoStart).toBe(true)
    expect(switchInput.getAttribute('aria-checked')).toBe('true')
    expect(switchEl.classList.contains('is-checked')).toBe(true)
    expect(msgError).toHaveBeenCalledWith('LaunchAgents 不可写')
    ctx.unmount()
  })

  it('开发模式（supported=false）禁用快捷方式与开机自启，并显示原因', async () => {
    mocks.api.desktopStatus.mockResolvedValueOnce({
      data: makeDesktop({
        supported: false,
        platform: null,
        unsupportedReason: '仅在使用启动脚本运行 SES 时支持桌面快捷方式与开机自启',
      }),
    })
    const ctx = await mountMenu(makeInfo({ launcher: null }), null, null)
    expect(q('[data-test="shortcut-item"]')!.hasAttribute('disabled')).toBe(true)
    expect(q('[data-test="shortcut-item"]')!.textContent).toContain('创建桌面快捷方式')
    expect(q('[data-test="desktop-reason"]')!.textContent).toContain('仅在使用启动脚本运行 SES 时支持')
    const switchEl = q('[data-test="autostart-switch"]')!
    expect(switchEl.classList.contains('is-disabled')).toBe(true)
    ctx.unmount()
  })
})
