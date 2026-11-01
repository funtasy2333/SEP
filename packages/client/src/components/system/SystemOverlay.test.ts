// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemOverlay from './SystemOverlay.vue'
import { useSystemStore } from '@/stores/system'
import type { SystemInfo, UpgradeStatusFile } from '@/api/system'

const mocks = vi.hoisted(() => ({
  api: { info: vi.fn(), checkUpdate: vi.fn(), startUpdate: vi.fn(), updateStatus: vi.fn(), shutdown: vi.fn() },
}))

vi.mock('@/api/system', async () => {
  const actual = await vi.importActual<typeof import('@/api/system')>('@/api/system')
  return { ...actual, systemApi: mocks.api }
})

const HANDOFF = Date.parse('2026-11-01T10:00:00.000Z')

function makeInfo(last: UpgradeStatusFile | null): SystemInfo {
  return {
    version: '0.1.1',
    channel: 'stable',
    commit: null,
    launcher: 'macos',
    canShutdown: true,
    shutdownBlockedReason: null,
    canUpgrade: true,
    upgradeBlockedReason: null,
    upgrade: {
      download: { phase: 'handed-off', receivedBytes: 1, totalBytes: 1, error: null, startedAt: null },
      last,
    },
  }
}

function makeLast(patch: Partial<UpgradeStatusFile> = {}): UpgradeStatusFile {
  return {
    state: 'succeeded',
    step: 'start',
    from: '0.1.1',
    to: '0.2.0',
    message: null,
    log: '.ses-run/upgrade.log',
    updatedAt: '2026-11-01T10:05:00.000Z',
    ...patch,
  }
}

const reload = vi.fn()

function mountOverlay() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSystemStore()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () => h(SystemOverlay, { reload, pollIntervalMs: 3000, reloadDelayMs: 2000, timeoutMs: 20 * 60 * 1000 }),
  })
  app.use(pinia).use(ElementPlus).mount(root)
  return {
    store,
    root,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

describe('SystemOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:30.000Z'))
    Object.values(mocks.api).forEach((fn) => fn.mockReset())
    reload.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('normal 模式不渲染', async () => {
    const ctx = mountOverlay()
    await nextTick()
    expect(ctx.root.querySelector('.system-overlay')).toBeNull()
    ctx.unmount()
  })

  it('exited：显示已退出说明，且不轮询', async () => {
    const ctx = mountOverlay()
    ctx.store.markExited()
    await advance(10000)
    expect(ctx.root.querySelector('[data-test="exited-text"]')!.textContent)
      .toBe('SES 已退出，可以关闭此页面。再次使用请双击『启动SES』。')
    expect(mocks.api.info).not.toHaveBeenCalled()
    ctx.unmount()
  })

  it('upgrading：请求失败继续等待；succeeded 显示新版本并在 2s 后刷新', async () => {
    mocks.api.info
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ data: makeInfo(makeLast({ state: 'running', step: 'build' })) })
      .mockResolvedValue({ data: makeInfo(makeLast()) })
    const ctx = mountOverlay()
    ctx.store.beginUpgrade(HANDOFF)
    await nextTick()
    expect(ctx.root.textContent).toContain('停止服务')
    expect(ctx.root.textContent).toContain('启动')

    await advance(3000)
    expect(ctx.root.querySelector('[data-test="upgrade-succeeded"]')).toBeNull()
    await advance(3000)
    expect(ctx.root.querySelector('[data-test="upgrade-step"]')!.textContent).toContain('build')
    await advance(3000)
    expect(ctx.root.querySelector('[data-test="upgrade-succeeded"]')!.textContent).toBe('已升级到 0.2.0')
    expect(reload).not.toHaveBeenCalled()
    await advance(2000)
    expect(reload).toHaveBeenCalledTimes(1)
    ctx.unmount()
  })

  it('succeeded：「立即刷新」按钮直接刷新，且不会重复刷新', async () => {
    mocks.api.info.mockResolvedValue({ data: makeInfo(makeLast()) })
    const ctx = mountOverlay()
    ctx.store.beginUpgrade(HANDOFF)
    await advance(3000)
    ctx.root.querySelector<HTMLButtonElement>('[data-test="refresh-btn"]')!.click()
    expect(reload).toHaveBeenCalledTimes(1)
    await advance(5000)
    expect(reload).toHaveBeenCalledTimes(1)
    ctx.unmount()
  })

  it('忽略交接之前留下的旧升级结果', async () => {
    mocks.api.info.mockResolvedValue({ data: makeInfo(makeLast({ updatedAt: '2026-10-01T10:00:00.000Z' })) })
    const ctx = mountOverlay()
    ctx.store.beginUpgrade(HANDOFF)
    await advance(9000)
    expect(ctx.root.querySelector('[data-test="upgrade-succeeded"]')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    ctx.unmount()
  })

  it('rolled-back：显示已恢复、原因、日志路径与刷新按钮，不自动刷新', async () => {
    mocks.api.info.mockResolvedValue({
      data: makeInfo(makeLast({ state: 'rolled-back', message: '构建失败：缺少依赖' })),
    })
    const ctx = mountOverlay()
    ctx.store.beginUpgrade(HANDOFF)
    await advance(3000)
    expect(ctx.root.querySelector('[data-test="upgrade-rolled-back"]')!.textContent).toBe('升级失败，已恢复到原版本')
    expect(ctx.root.querySelector('[data-test="upgrade-message"]')!.textContent).toBe('构建失败：缺少依赖')
    expect(ctx.root.textContent).toContain('.ses-run/upgrade.log')
    ctx.root.querySelector<HTMLButtonElement>('[data-test="refresh-btn"]')!.click()
    expect(reload).toHaveBeenCalledTimes(1)
    ctx.unmount()
  })

  it('failed：显示失败、日志路径，并提示双击启动SES', async () => {
    mocks.api.info.mockResolvedValue({ data: makeInfo(makeLast({ state: 'failed', message: '无法启动' })) })
    const ctx = mountOverlay()
    ctx.store.beginUpgrade(HANDOFF)
    await advance(3000)
    expect(ctx.root.querySelector('[data-test="upgrade-failed"]')).not.toBeNull()
    expect(ctx.root.textContent).toContain('.ses-run/upgrade.log')
    expect(ctx.root.textContent).toContain('双击『启动SES』')
    await advance(10000)
    expect(reload).not.toHaveBeenCalled()
    ctx.unmount()
  })

  it('超过 20 分钟仍无结果：提示查看日志，并继续轮询', async () => {
    mocks.api.info.mockRejectedValue(new Error('Network Error'))
    const ctx = mountOverlay()
    ctx.store.beginUpgrade(HANDOFF)
    await advance(19 * 60 * 1000)
    expect(ctx.root.querySelector('[data-test="upgrade-timeout"]')).toBeNull()
    await advance(61 * 1000)
    const timeout = ctx.root.querySelector('[data-test="upgrade-timeout"]')!
    expect(timeout.textContent).toContain('.ses-run/upgrade.log')
    expect(timeout.textContent).toContain('双击『启动SES』')

    const calls = mocks.api.info.mock.calls.length
    mocks.api.info.mockResolvedValue({ data: makeInfo(makeLast()) })
    await advance(3000)
    expect(mocks.api.info.mock.calls.length).toBeGreaterThan(calls)
    expect(ctx.root.querySelector('[data-test="upgrade-succeeded"]')).not.toBeNull()
    ctx.unmount()
  })
})
