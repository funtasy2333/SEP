// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateNotice from './UpdateNotice.vue'
import {
  UPDATE_CHECK_CACHE_STORAGE_KEY,
  UPDATE_CHECK_CACHE_TTL_MS,
  UPDATE_DISMISSED_STORAGE_KEY,
  useSystemStore,
} from '@/stores/system'
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
    version: '0.2.0',
    channel: 'stable',
    commit: '1111111222222',
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
    current: { version: '0.2.0', commit: '1111111222222', channel: 'stable' },
    latest: {
      version: '0.3.0',
      commit: 'deadbeefcafe0123',
      publishedAt: '2026-11-20T08:00:00.000Z',
      notes: '更新内容',
      url: 'https://example.com/releases/v0.3.0',
      assetSize: 2048,
    },
    available: true,
    reason: null,
    commits: [
      { sha: 'abcdef1234567', message: 'feat: 1', date: '2026-11-19T08:00:00.000Z', author: 'a' },
      { sha: 'bcdefa1234567', message: 'fix: 2', date: '2026-11-20T08:00:00.000Z', author: 'b' },
    ],
    ...patch,
  }
}

async function mountNotice(info: SystemInfo | null = makeInfo(), check: UpdateCheck | null = null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSystemStore()
  store.info = info
  if (check) store.recordUpdateCheck(check)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(UpdateNotice)
  app.use(pinia).use(ElementPlus).mount(root)
  await nextTick()
  return {
    root,
    store,
    unmount() {
      app.unmount()
      root.remove()
    },
  }
}

const noticeEl = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-test="update-notice"]')

describe('UpdateNotice & background check', () => {
  beforeEach(() => {
    Object.values(mocks.api).forEach((fn) => fn.mockReset())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('无更新或不可升级时不展示', async () => {
    const noCheck = await mountNotice(makeInfo(), null)
    expect(noticeEl(noCheck.root)).toBeNull()
    noCheck.unmount()

    const notAvailable = await mountNotice(makeInfo(), makeCheck({ available: false, latest: null, reason: '已是最新版本' }))
    expect(noticeEl(notAvailable.root)).toBeNull()
    notAvailable.unmount()

    const blocked = await mountNotice(makeInfo({ canUpgrade: false }), makeCheck())
    expect(noticeEl(blocked.root)).toBeNull()
    blocked.unmount()
  })

  it('有更新时展示稳定版/提交版标签与更新条数', async () => {
    const stable = await mountNotice(makeInfo(), makeCheck())
    const text = stable.root.querySelector('[data-test="update-notice-text"]')!.textContent
    expect(text).toContain('发现新版本 SES 0.3.0')
    expect(text).toContain('包含 2 项更新')
    stable.unmount()

    const commit = await mountNotice(
      makeInfo({ channel: 'commit' }),
      makeCheck({
        channel: 'commit',
        latest: {
          version: null,
          commit: 'a1b2c3d4e5f60718',
          publishedAt: null,
          notes: null,
          url: 'https://example.com',
          assetSize: null,
        },
        commits: [],
      }),
    )
    const commitText = commit.root.querySelector('[data-test="update-notice-text"]')!.textContent
    expect(commitText).toBe('发现新版本 提交版 a1b2c3d')
    commit.unmount()
  })

  it('点击「查看更新」打开共享升级弹窗', async () => {
    const ctx = await mountNotice(makeInfo(), makeCheck())
    expect(ctx.store.upgradeDialogOpen).toBe(false)
    ctx.root.querySelector<HTMLButtonElement>('[data-test="update-notice-open"]')!.click()
    await nextTick()
    expect(ctx.store.upgradeDialogOpen).toBe(true)
    ctx.unmount()
  })

  it('点击「忽略此版本」持久化并隐藏；发现新 commit 后重新显示', async () => {
    const ctx = await mountNotice(makeInfo(), makeCheck())
    expect(noticeEl(ctx.root)).not.toBeNull()

    ctx.root.querySelector<HTMLButtonElement>('[data-test="update-notice-dismiss"]')!.click()
    await nextTick()
    expect(noticeEl(ctx.root)).toBeNull()
    expect(localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY)).toBe('stable:deadbeefcafe0123')
    ctx.unmount()

    // 重新挂载仍保持隐藏
    const again = await mountNotice(makeInfo(), makeCheck())
    expect(noticeEl(again.root)).toBeNull()

    // 发现新 commit 时重新显示
    again.store.recordUpdateCheck(makeCheck({
      latest: {
        version: '0.3.1',
        commit: 'feedface01234567',
        publishedAt: null,
        notes: null,
        url: 'https://example.com',
        assetSize: null,
      },
    }))
    await nextTick()
    expect(noticeEl(again.root)).not.toBeNull()
    expect(again.root.textContent).toContain('SES 0.3.1')
    again.unmount()
  })

  it('后台自动检查：命中 30 分钟缓存不发请求；过期或版本变化时重新请求', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useSystemStore()
    store.info = makeInfo()

    // 1. 首次请求写入缓存
    mocks.api.checkUpdate.mockResolvedValueOnce({ data: makeCheck() })
    await store.checkForUpdateInBackground()
    expect(mocks.api.checkUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.api.checkUpdate).toHaveBeenCalledWith('stable')
    expect(store.hasUnreadUpdate).toBe(true)

    // 同一会话内再次调用不会重复请求
    await store.checkForUpdateInBackground()
    expect(mocks.api.checkUpdate).toHaveBeenCalledTimes(1)

    // 2. 新会话命中 30 分钟缓存，不发请求
    const pinia2 = createPinia()
    setActivePinia(pinia2)
    const store2 = useSystemStore()
    store2.info = makeInfo()
    await store2.checkForUpdateInBackground()
    expect(mocks.api.checkUpdate).toHaveBeenCalledTimes(1)
    expect(store2.hasUnreadUpdate).toBe(true)

    // 3. 缓存超过 30 分钟 TTL 时重新请求
    const cachedRaw = localStorage.getItem(UPDATE_CHECK_CACHE_STORAGE_KEY)!
    const cached = JSON.parse(cachedRaw)
    cached.checkedAt = Date.now() - UPDATE_CHECK_CACHE_TTL_MS - 1000
    localStorage.setItem(UPDATE_CHECK_CACHE_STORAGE_KEY, JSON.stringify(cached))

    const pinia3 = createPinia()
    setActivePinia(pinia3)
    const store3 = useSystemStore()
    store3.info = makeInfo()
    mocks.api.checkUpdate.mockResolvedValueOnce({ data: makeCheck({ available: false, latest: null, reason: '已是最新版本', commits: [] }) })
    await store3.checkForUpdateInBackground()
    expect(mocks.api.checkUpdate).toHaveBeenCalledTimes(2)
    expect(store3.hasUnreadUpdate).toBe(false)
  })

  it('后台自动检查：不可升级不请求；GitHub 连接失败不缓存；响应为 undefined 或 reject 时静默', async () => {
    const pinia1 = createPinia()
    setActivePinia(pinia1)
    const blocked = useSystemStore()
    blocked.info = makeInfo({ canUpgrade: false })
    await blocked.checkForUpdateInBackground()
    expect(mocks.api.checkUpdate).not.toHaveBeenCalled()

    // GitHub 连接失败不写入缓存
    const pinia2 = createPinia()
    setActivePinia(pinia2)
    const transient = useSystemStore()
    transient.info = makeInfo()
    mocks.api.checkUpdate.mockResolvedValueOnce({
      data: makeCheck({ available: false, latest: null, commits: [], reason: '无法连接 GitHub：timeout，请检查网络或代理' }),
    })
    await transient.checkForUpdateInBackground()
    expect(localStorage.getItem(UPDATE_CHECK_CACHE_STORAGE_KEY)).toBeNull()

    // undefined 响应与 rejected promise 均不抛错
    const pinia3 = createPinia()
    setActivePinia(pinia3)
    const undefStore = useSystemStore()
    undefStore.info = makeInfo()
    mocks.api.checkUpdate.mockResolvedValueOnce(undefined)
    await expect(undefStore.checkForUpdateInBackground()).resolves.toBeUndefined()
    expect(undefStore.hasUnreadUpdate).toBe(false)

    const pinia4 = createPinia()
    setActivePinia(pinia4)
    const errStore = useSystemStore()
    errStore.info = makeInfo()
    mocks.api.checkUpdate.mockRejectedValueOnce(new Error('network down'))
    await expect(errStore.checkForUpdateInBackground()).resolves.toBeUndefined()
    expect(errStore.hasUnreadUpdate).toBe(false)
  })

  it('localStorage 读写抛异常时安全降级', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('blocked') },
      clear: () => {},
    })
    const ctx = await mountNotice(makeInfo(), makeCheck())
    expect(noticeEl(ctx.root)).not.toBeNull()
    ctx.root.querySelector<HTMLButtonElement>('[data-test="update-notice-dismiss"]')!.click()
    await nextTick()
    expect(noticeEl(ctx.root)).toBeNull()
    ctx.unmount()
  })
})
