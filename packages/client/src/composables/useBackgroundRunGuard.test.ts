// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunGuard } from './useBackgroundRunGuard'
import { useSystemStore } from '@/stores/system'
import type { SystemInfo } from '@/api/system'

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

function mountGuard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSystemStore()
  const root = document.createElement('div')
  const app = createApp(defineComponent({ setup() { useBackgroundRunGuard(); return () => h('div') } }))
  app.use(pinia).mount(root)
  return { store, unmount: () => app.unmount() }
}

/** 派发 beforeunload，返回是否被 preventDefault。 */
function fireBeforeUnload(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useBackgroundRunGuard', () => {
  let addSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    addSpy = vi.spyOn(window, 'addEventListener')
  })

  afterEach(() => {
    addSpy.mockRestore()
  })

  const beforeUnloadRegistrations = () => addSpy.mock.calls.filter(([type]) => type === 'beforeunload').length

  it('info 未加载或加载失败时不注册', async () => {
    const ctx = mountGuard()
    await nextTick()
    expect(beforeUnloadRegistrations()).toBe(0)
    expect(fireBeforeUnload()).toBe(false)
    ctx.unmount()
  })

  it('launcher 为 null 时不注册', async () => {
    const ctx = mountGuard()
    ctx.store.info = makeInfo(null)
    await nextTick()
    expect(beforeUnloadRegistrations()).toBe(0)
    expect(fireBeforeUnload()).toBe(false)
    ctx.unmount()
  })

  it('launcher 非 null 时注册；mode 变为 exited 或 upgrading 后注销', async () => {
    const ctx = mountGuard()
    ctx.store.info = makeInfo('macos')
    await nextTick()
    expect(beforeUnloadRegistrations()).toBe(1)
    expect(fireBeforeUnload()).toBe(true)

    ctx.store.beginUpgrade()
    await nextTick()
    expect(fireBeforeUnload()).toBe(false)

    ctx.store.mode = 'normal'
    await nextTick()
    expect(fireBeforeUnload()).toBe(true)
    ctx.store.markExited()
    await nextTick()
    expect(fireBeforeUnload()).toBe(false)
    ctx.unmount()
  })

  it('组件卸载后注销', async () => {
    const ctx = mountGuard()
    ctx.store.info = makeInfo('windows')
    await nextTick()
    expect(fireBeforeUnload()).toBe(true)
    ctx.unmount()
    expect(fireBeforeUnload()).toBe(false)
  })
})
