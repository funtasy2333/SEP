// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BackgroundRunNotice from './BackgroundRunNotice.vue'
import { useSystemStore } from '@/stores/system'
import type { SystemInfo } from '@/api/system'

const KEY = 'ses.notice.backgroundRun.dismissed'

function makeInfo(launcher: SystemInfo['launcher']): SystemInfo {
  return {
    version: '0.1.1',
    channel: 'stable',
    commit: null,
    launcher,
    canShutdown: true,
    shutdownBlockedReason: null,
    canUpgrade: true,
    upgradeBlockedReason: null,
    upgrade: {
      download: { phase: 'idle', receivedBytes: 0, totalBytes: null, error: null, startedAt: null },
      last: null,
    },
  }
}

async function mountNotice(launcher: SystemInfo['launcher']) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSystemStore()
  store.info = makeInfo(launcher)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(BackgroundRunNotice)
  app.use(pinia).use(ElementPlus).mount(root)
  await nextTick()
  return { root, store, unmount: () => { app.unmount(); root.remove() } }
}

const notice = (root: HTMLElement) => root.querySelector('[data-test="background-run-notice"]')
const close = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-test="notice-close"]')!.click()

describe('BackgroundRunNotice', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('launcher 为 null 时不显示', async () => {
    const ctx = await mountNotice(null)
    expect(notice(ctx.root)).toBeNull()
    ctx.unmount()
  })

  it('launcher 非 null 且未关闭过时显示；关闭后写入 localStorage 并隐藏', async () => {
    const ctx = await mountNotice('macos')
    expect(notice(ctx.root)!.textContent)
      .toContain('关闭网页后 SES 仍在后台运行；要彻底退出，请点击右上角『设置』→『退出 SES』。')
    close(ctx.root)
    await nextTick()
    expect(notice(ctx.root)).toBeNull()
    expect(localStorage.getItem(KEY)).not.toBeNull()
    ctx.unmount()

    const again = await mountNotice('macos')
    expect(notice(again.root)).toBeNull()
    again.unmount()
  })

  it('读取 localStorage 抛异常时照常显示', async () => {
    localStorage.setItem(KEY, '1')
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const ctx = await mountNotice('windows')
    expect(notice(ctx.root)).not.toBeNull()
    ctx.unmount()
  })

  it('写入 localStorage 抛异常时仅本次隐藏', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
    })
    const ctx = await mountNotice('windows')
    close(ctx.root)
    await nextTick()
    expect(notice(ctx.root)).toBeNull()
    ctx.unmount()

    const again = await mountNotice('windows')
    expect(notice(again.root)).not.toBeNull()
    again.unmount()
  })
})
