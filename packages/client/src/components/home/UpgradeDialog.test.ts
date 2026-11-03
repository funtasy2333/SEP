// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UpgradeDialog from './UpgradeDialog.vue'
import { useSystemStore } from '@/stores/system'
import type { SystemInfo, UpdateCheck } from '@/api/system'

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

function makeCheck(patch: Partial<UpdateCheck> = {}): UpdateCheck {
  return {
    channel: 'stable',
    current: { version: '0.1.1-preview', commit: null, channel: 'stable' },
    latest: {
      version: '0.2.0',
      commit: 'deadbeefcafe0123',
      publishedAt: '2026-10-30T08:00:00.000Z',
      notes: '修复若干问题\n<script>window.__pwned = true</script>',
      url: 'https://example.com/releases/v0.2.0',
      assetSize: 1024,
    },
    available: true,
    reason: null,
    commits: [{ sha: '1234567890abcdef', message: '修复保存问题', date: '2026-10-29T08:00:00.000Z', author: 'a' }],
    ...patch,
  }
}

async function settle(ms = 5) {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}

async function mountDialog(info: SystemInfo = makeInfo()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSystemStore()
  store.info = info
  const open = ref(true)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () => h(UpgradeDialog, {
      modelValue: open.value,
      'onUpdate:modelValue': (value: boolean) => { open.value = value },
    }),
  })
  app.use(pinia).use(ElementPlus).mount(root)
  await settle()
  return {
    store,
    open,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 4000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await nextTick()
  }
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector)
const checked = () => document.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value

async function clickCheck() {
  q('[data-test="check-btn"]')!.click()
  await settle()
}

describe('UpgradeDialog', () => {
  const confirm = vi.fn()
  let confirmSpy: { mockRestore: () => void }

  beforeEach(() => {
    Object.values(mocks.api).forEach((fn) => fn.mockReset())
    confirm.mockReset()
    confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockImplementation(confirm as never)
    ;(window as unknown as { __pwned?: boolean }).__pwned = undefined
  })

  afterEach(() => {
    confirmSpy.mockRestore()
    document.body.innerHTML = ''
  })

  it('默认通道取当前通道，未知时为稳定版；显示当前版本', async () => {
    const commit = await mountDialog(makeInfo({ channel: 'commit', commit: 'a1b2c3d4e5' }))
    expect(checked()).toBe('commit')
    expect(q('[data-test="current-version"]')!.textContent).toBe('SES 0.1.1-preview · 提交版 a1b2c3d')
    commit.unmount()
    document.body.innerHTML = ''

    const none = await mountDialog(makeInfo({ channel: null }))
    expect(checked()).toBe('stable')
    none.unmount()
  })

  it('检查结果：发布说明按纯文本显示，不解析 HTML；提交列表与发布页链接', async () => {
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck() })
    const ctx = await mountDialog()
    await clickCheck()
    expect(mocks.api.checkUpdate).toHaveBeenCalledWith('stable')
    expect(q('[data-test="latest-version"]')!.textContent).toBe('0.2.0')
    const notes = q('[data-test="release-notes"]')!
    expect(notes.textContent).toContain('<script>window.__pwned = true</script>')
    expect(notes.querySelector('script')).toBeNull()
    expect(notes.children.length).toBe(0)
    expect(document.body.querySelectorAll('[data-test="release-notes"] *').length).toBe(0)
    const commits = [...document.querySelectorAll('[data-test="commit-list"] li')]
    expect(commits).toHaveLength(1)
    expect(commits[0].textContent).toContain('1234567')
    expect(commits[0].textContent).toContain('修复保存问题')
    const link = q('[data-test="release-link"]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://example.com/releases/v0.2.0')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    ctx.unmount()
  })

  it('提交列表最多显示 50 条', async () => {
    const commits = Array.from({ length: 60 }, (_, i) => ({
      sha: `${String(i).padStart(7, '0')}abcdef`, message: `提交 ${i}`, date: '2026-10-29T08:00:00.000Z', author: null,
    }))
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck({ commits }) })
    const ctx = await mountDialog()
    await clickCheck()
    expect(document.querySelectorAll('[data-test="commit-list"] li')).toHaveLength(50)
    ctx.unmount()
  })

  it('不可升级时显示 reason，且不能立即升级', async () => {
    mocks.api.checkUpdate.mockResolvedValue({
      data: makeCheck({ available: false, reason: '已是最新版本', latest: null, commits: [] }),
    })
    const ctx = await mountDialog()
    await clickCheck()
    expect(q('[data-test="unavailable"]')!.textContent).toBe('已是最新版本')
    expect(q('[data-test="upgrade-btn"]')!.hasAttribute('disabled')).toBe(true)
    ctx.unmount()
  })

  it('切换通道会清空检查结果', async () => {
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck() })
    const ctx = await mountDialog()
    await clickCheck()
    expect(q('[data-test="check-result"]')).not.toBeNull()
    document.querySelector<HTMLInputElement>('input[type="radio"][value="commit"]')!.click()
    await settle()
    expect(q('[data-test="check-result"]')).toBeNull()
    ctx.unmount()
  })

  it('升级：确认 → POST → 进度 → 交接后进入 upgrading 并关闭对话框', async () => {
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck() })
    mocks.api.startUpdate.mockResolvedValue({ data: { accepted: true } })
    mocks.api.updateStatus
      .mockResolvedValueOnce({ data: { phase: 'downloading', receivedBytes: 512 * 1024, totalBytes: 1024 * 1024, error: null, startedAt: null } })
      .mockResolvedValue({ data: { phase: 'handing-off', receivedBytes: 1024 * 1024, totalBytes: 1024 * 1024, error: null, startedAt: null } })
    confirm.mockResolvedValue('confirm')
    const ctx = await mountDialog()
    await clickCheck()
    q('[data-test="upgrade-btn"]')!.click()
    await settle()
    expect(String(confirm.mock.calls[0][0])).toBe('升级期间 SES 会停止几分钟，正在编辑的文档请先保存；升级前会自动备份数据库；升级后不支持降级。')
    expect(mocks.api.startUpdate).toHaveBeenCalledWith('stable', 'deadbeefcafe0123')
    expect(q('[data-test="progress"]')).not.toBeNull()

    await waitFor(() => q('[data-test="progress-bytes"]') !== null)
    expect(q('[data-test="progress-bytes"]')!.textContent).toBe('0.5 MB / 1.0 MB')

    await waitFor(() => ctx.store.mode === 'upgrading')
    expect(ctx.store.mode).toBe('upgrading')
    expect(ctx.store.handoffAt).toBeGreaterThan(0)
    expect(ctx.open.value).toBe(false)
    ctx.unmount()
  }, 15000)

  it('轮询请求失败（无响应）视为服务已停止，进入 upgrading', async () => {
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck() })
    mocks.api.startUpdate.mockResolvedValue({ data: { accepted: true } })
    mocks.api.updateStatus.mockRejectedValue(new Error('Network Error'))
    confirm.mockResolvedValue('confirm')
    const ctx = await mountDialog()
    await clickCheck()
    q('[data-test="upgrade-btn"]')!.click()
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await settle()
    expect(ctx.store.mode).toBe('upgrading')
    ctx.unmount()
  }, 10000)

  it('下载出错：显示错误并允许重试', async () => {
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck() })
    mocks.api.startUpdate.mockResolvedValue({ data: { accepted: true } })
    mocks.api.updateStatus.mockResolvedValue({
      data: { phase: 'error', receivedBytes: 10, totalBytes: null, error: '下载升级包失败：校验不一致', startedAt: null },
    })
    confirm.mockResolvedValue('confirm')
    const ctx = await mountDialog()
    await clickCheck()
    q('[data-test="upgrade-btn"]')!.click()
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await settle()
    expect(q('[data-test="upgrade-error"]')!.textContent).toBe('下载升级包失败：校验不一致')
    const retry = q('[data-test="upgrade-btn"]')!
    expect(retry.hasAttribute('disabled')).toBe(false)
    expect(retry.textContent).toContain('重试升级')
    expect(ctx.store.mode).toBe('normal')
    ctx.unmount()
  }, 10000)

  it('取消确认：不调用 POST', async () => {
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck() })
    confirm.mockRejectedValue('cancel')
    const ctx = await mountDialog()
    await clickCheck()
    q('[data-test="upgrade-btn"]')!.click()
    await settle()
    expect(mocks.api.startUpdate).not.toHaveBeenCalled()
    ctx.unmount()
  })

  it('409：提示状态已变化，需重新检查', async () => {
    mocks.api.checkUpdate.mockResolvedValue({ data: makeCheck() })
    mocks.api.startUpdate.mockRejectedValue({ response: { status: 409, data: { message: 'conflict' } } })
    confirm.mockResolvedValue('confirm')
    const ctx = await mountDialog()
    await clickCheck()
    q('[data-test="upgrade-btn"]')!.click()
    await settle()
    expect(q('[data-test="upgrade-error"]')!.textContent).toBe('状态已变化，请重新检查更新')
    expect(q('[data-test="check-result"]')).toBeNull()
    expect(ctx.store.mode).toBe('normal')
    ctx.unmount()
  })
})
