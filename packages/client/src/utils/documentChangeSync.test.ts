import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  documentEventsUrl,
  parseChangeEvent,
  startDocumentChangeSync,
  type DocumentChangeSyncOptions,
  type EventSourceLike,
  type ExternalChange,
} from './documentChangeSync'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = []
  readyState = CONNECTING
  closeCalls = 0
  private listeners = new Map<string, Array<(event: any) => void>>()

  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.closeCalls += 1
    this.readyState = CLOSED
  }

  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  /** 连接建立（首次或浏览器自动重连成功） */
  open() {
    this.readyState = OPEN
    this.emit('open')
  }

  /** 服务端推送一条 document-changed 事件 */
  change(data: Record<string, unknown>) {
    this.emit('document-changed', { data: JSON.stringify({ documentId: 17, at: '2026-10-13T00:00:00.000Z', ...data }) })
  }

  /** 连接出错：closed=true 表示浏览器放弃重连（HTTP 错误），否则浏览器自行重连 */
  fail(closed: boolean) {
    this.readyState = closed ? CLOSED : CONNECTING
    this.emit('error')
  }
}

const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]!

/** 让所有已排队的微任务（含 async 链）跑完 */
async function settleAll() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function setup(overrides: Partial<DocumentChangeSyncOptions> & { local?: number } = {}) {
  const state = { local: overrides.local ?? 4 }
  const changes: ExternalChange[] = []
  const options: DocumentChangeSyncOptions = {
    documentId: 17,
    getLocalRevision: () => state.local,
    readRevision: vi.fn(async () => state.local),
    onExternalChange: (change) => { changes.push(change) },
    createEventSource: (url) => new FakeEventSource(url),
    ...overrides,
  }
  const sync = startDocumentChangeSync(options)
  return { state, changes, sync, options }
}

beforeEach(() => {
  FakeEventSource.instances = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('parseChangeEvent', () => {
  it('接受合法事件，client 为空串或缺失时省略', () => {
    expect(parseChangeEvent(JSON.stringify({ documentId: 17, revision: 5, source: 'ai', client: 'claude-code', at: 't' }), 17))
      .toEqual({ documentId: 17, revision: 5, source: 'ai', client: 'claude-code', at: 't' })
    expect(parseChangeEvent(JSON.stringify({ documentId: 17, revision: 5, source: 'human', client: '' }), 17))
      .toEqual({ documentId: 17, revision: 5, source: 'human' })
    expect(parseChangeEvent(JSON.stringify({ documentId: 17, revision: 6, source: 'human', lifecycle: 'deleted' }), 17))
      .toEqual({ documentId: 17, revision: 6, source: 'human', lifecycle: 'deleted' })
  })

  it.each([
    ['不是字符串', undefined],
    ['不是 JSON', '{oops'],
    ['不是对象', '"x"'],
    ['null', 'null'],
    ['别的文档', JSON.stringify({ documentId: 18, revision: 5, source: 'ai' })],
    ['revision 不是整数', JSON.stringify({ documentId: 17, revision: 5.5, source: 'ai' })],
    ['revision 为负', JSON.stringify({ documentId: 17, revision: -1, source: 'ai' })],
    ['revision 缺失', JSON.stringify({ documentId: 17, source: 'ai' })],
    ['来源未知', JSON.stringify({ documentId: 17, revision: 5, source: 'robot' })],
    ['生命周期未知', JSON.stringify({ documentId: 17, revision: 5, source: 'human', lifecycle: 'purged' })],
  ])('拒绝不合法的事件：%s', (_name, raw) => {
    expect(parseChangeEvent(raw, 17)).toBeNull()
  })
})

describe('订阅与清理', () => {
  it('生命周期事件透传给外部修改处理器', async () => {
    const { sync, changes } = setup()
    latest().change({ revision: 5, source: 'human', lifecycle: 'deleted' })
    await settleAll()
    expect(changes).toEqual([{ revision: 5, source: 'human', lifecycle: 'deleted' }])
    sync.stop()
  })

  it('订阅该文档的事件流；stop 关闭连接，之后的事件与重连都不再生效', async () => {
    vi.useFakeTimers()
    const { sync, changes } = setup()
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().url).toBe(documentEventsUrl(17))
    expect(latest().url).toBe('/api/documents/17/events')

    const source = latest()
    sync.stop()
    expect(source.closeCalls).toBe(1)
    source.change({ revision: 9, source: 'ai' })
    source.open()
    await settleAll()
    expect(changes).toEqual([])

    // 重复 stop 无副作用
    sync.stop()
    expect(source.closeCalls).toBe(1)
  })

  it('stop 会取消尚未执行的重连', async () => {
    vi.useFakeTimers()
    const { sync } = setup()
    latest().fail(true)
    sync.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('运行环境没有 EventSource 时不报错也不订阅', () => {
    vi.stubGlobal('EventSource', undefined)
    const changes: ExternalChange[] = []
    const sync = startDocumentChangeSync({
      documentId: 17,
      getLocalRevision: () => 4,
      readRevision: async () => 4,
      onExternalChange: (change) => { changes.push(change) },
    })
    expect(() => sync.stop()).not.toThrow()
    expect(changes).toEqual([])
  })

  it('默认使用全局 EventSource', () => {
    const created: string[] = []
    vi.stubGlobal('EventSource', class extends FakeEventSource {
      constructor(url: string) {
        super(url)
        created.push(url)
      }
    })
    const sync = startDocumentChangeSync({
      documentId: 17,
      getLocalRevision: () => 4,
      readRevision: async () => 4,
      onExternalChange: () => undefined,
    })
    expect(created).toEqual(['/api/documents/17/events'])
    sync.stop()
  })
})

describe('事件与本地 revision 比较', () => {
  it('忽略 revision 不大于本地的事件（含自己保存产生的、迟到的旧事件），但仍通知 onEvent', async () => {
    const onEvent = vi.fn()
    const { changes } = setup({ local: 5, onEvent })
    latest().change({ revision: 5, source: 'human' })
    latest().change({ revision: 3, source: 'ai', client: 'old' })
    await settleAll()
    expect(changes).toEqual([])
    expect(onEvent).toHaveBeenCalledTimes(2)
  })

  it('更大的 revision 上报一次，携带来源与写入方；同一 revision 不重复上报', async () => {
    const { changes } = setup({ local: 4 })
    latest().change({ revision: 5, source: 'ai', client: 'claude-code' })
    await settleAll()
    expect(changes).toEqual([{ revision: 5, source: 'ai', client: 'claude-code' }])

    // 同一 revision 的重复事件（或重连比较读到同一 revision）不会再次上报
    latest().change({ revision: 5, source: 'ai', client: 'claude-code' })
    latest().open()
    await settleAll()
    expect(changes).toHaveLength(1)
  })

  it('不合法的 data、别的文档的事件被忽略', async () => {
    const onEvent = vi.fn()
    const { changes } = setup({ onEvent })
    latest().emit('document-changed', { data: '{oops' })
    latest().emit('document-changed', { data: JSON.stringify({ documentId: 99, revision: 50, source: 'ai' }) })
    await settleAll()
    expect(changes).toEqual([])
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('本地 revision 还未确定时先不判断，也不丢事件', async () => {
    let local: number | undefined
    const { changes, options } = setup({ getLocalRevision: () => local })
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    expect(changes).toEqual([])
    local = 4
    latest().change({ revision: 6, source: 'ai' })
    await settleAll()
    // 之前缓存的 5 与 6 合并为一次上报
    expect(changes).toEqual([{ revision: 6, source: 'ai' }])
    expect(options.getLocalRevision()).toBe(4)
  })
})

describe('保存进行中的竞态', () => {
  it('自己保存产生的事件先于响应到达：等保存落定、本地 revision 更新后再比较，不当作外部修改', async () => {
    const saving = deferred()
    const { state, changes } = setup({ local: 4, settle: () => saving.promise })

    // PUT 已提交（服务端 revision=5）并推送了事件，响应还在路上，本地仍是 4
    latest().change({ revision: 5, source: 'human' })
    await settleAll()
    expect(changes).toEqual([])

    // 响应到达，store 把本地 revision 更新为 5，写入落定
    state.local = 5
    saving.resolve()
    await settleAll()
    expect(changes).toEqual([])
  })

  it('保存期间别人又写了一次：保存落定后服务端 revision 仍比本地大，才上报', async () => {
    const saving = deferred()
    const { state, changes } = setup({ local: 4, settle: () => saving.promise })

    latest().change({ revision: 5, source: 'human' }) // 自己的保存
    latest().change({ revision: 6, source: 'ai', client: 'claude-code' }) // 紧接着 AI 写入
    await settleAll()
    expect(changes).toEqual([])

    state.local = 5
    saving.resolve()
    await settleAll()
    expect(changes).toEqual([{ revision: 6, source: 'ai', client: 'claude-code' }])
  })

  it('保存失败（本地 revision 不变）时，保存期间收到的更大 revision 照常上报', async () => {
    const saving = deferred()
    const { changes } = setup({ local: 4, settle: () => saving.promise })
    latest().change({ revision: 5, source: 'ai' })
    saving.resolve() // 保存以非 409 错误结束，本地仍是 4
    await settleAll()
    expect(changes).toEqual([{ revision: 5, source: 'ai' }])
  })

  it('每次比较前都会等待 settle', async () => {
    const settle = vi.fn(() => Promise.resolve())
    setup({ local: 4, settle })
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    expect(settle).toHaveBeenCalled()
  })
})

describe('多个事件合并', () => {
  it('其间有 AI 写入就按 AI 处理，client 取最近一次 AI 写入方', async () => {
    const gate = deferred()
    const { changes } = setup({ local: 4, settle: () => gate.promise })
    latest().change({ revision: 5, source: 'ai', client: 'first' })
    latest().change({ revision: 6, source: 'human' })
    latest().change({ revision: 7, source: 'ai', client: 'second' })
    latest().change({ revision: 8, source: 'system' })
    gate.resolve()
    await settleAll()
    expect(changes).toEqual([{ revision: 8, source: 'ai', client: 'second' }])
  })

  it('没有 AI 时按 human；只有重连比较得到的 revision 为 unknown', async () => {
    const gate = deferred()
    const { changes } = setup({ local: 4, settle: () => gate.promise })
    latest().change({ revision: 5, source: 'human', client: 'cli' })
    gate.resolve()
    await settleAll()
    expect(changes).toEqual([{ revision: 5, source: 'human', client: 'cli' }])

    const second = setup({ local: 4, readRevision: async () => 9 })
    FakeEventSource.instances[1]!.open()
    await settleAll()
    expect(second.changes).toEqual([{ revision: 9, source: 'unknown' }])
  })

  it('只有 system 写入且 revision 连续覆盖时才算 system；中间有缺口说明漏了事件，按 unknown', async () => {
    const gate = deferred()
    const contiguous = setup({ local: 4, settle: () => gate.promise })
    FakeEventSource.instances[0]!.change({ revision: 5, source: 'system' })
    FakeEventSource.instances[0]!.change({ revision: 6, source: 'system' })
    gate.resolve()
    await settleAll()
    expect(contiguous.changes).toEqual([{ revision: 6, source: 'system' }])

    const gap = setup({ local: 4 })
    FakeEventSource.instances[1]!.change({ revision: 6, source: 'system' }) // 5 没收到
    await settleAll()
    expect(gap.changes).toEqual([{ revision: 6, source: 'unknown' }])
  })
})

describe('处理结果与串行', () => {
  it('处理返回 false 表示没成功：同一 revision 在下一次事件或重连时会再次上报', async () => {
    const calls: ExternalChange[] = []
    let ok = false
    setup({
      local: 4,
      onExternalChange: (change) => {
        calls.push(change)
        return ok
      },
    })
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    expect(calls).toHaveLength(1)

    ok = true
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    expect(calls).toHaveLength(2)

    // 成功后不再上报
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    expect(calls).toHaveLength(2)
  })

  it('处理抛出异常等同于失败，不影响后续事件', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let calls = 0
    setup({
      local: 4,
      onExternalChange: () => {
        calls += 1
        if (calls === 1) throw new Error('boom')
      },
    })
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    latest().change({ revision: 6, source: 'ai' })
    await settleAll()
    expect(calls).toBe(2)
    error.mockRestore()
  })

  it('处理期间到达的新事件在处理结束后再上报，同一时刻只有一次处理在执行', async () => {
    const first = deferred<boolean>()
    let running = 0
    let maxRunning = 0
    const calls: number[] = []
    setup({
      local: 4,
      onExternalChange: async (change) => {
        running += 1
        maxRunning = Math.max(maxRunning, running)
        calls.push(change.revision)
        if (calls.length === 1) await first.promise
        running -= 1
        return true
      },
    })
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    latest().change({ revision: 6, source: 'ai' })
    await settleAll()
    expect(calls).toEqual([5])

    first.resolve(true)
    await settleAll()
    expect(calls).toEqual([5, 6])
    expect(maxRunning).toBe(1)
  })

  it('处理没有追上本地 revision（如进入了冲突状态）时，已上报的 revision 不会重复上报', async () => {
    const { changes, state } = setup({ local: 4 })
    latest().change({ revision: 5, source: 'ai' })
    await settleAll()
    expect(changes).toHaveLength(1)
    // 本地仍是 4；重连比较读到同样的 5
    latest().open()
    await settleAll()
    expect(changes).toHaveLength(1)
    // 更新的 revision 照常上报
    latest().change({ revision: 6, source: 'human' })
    await settleAll()
    expect(changes).toHaveLength(2)
    expect(state.local).toBe(4)
  })
})

describe('连接建立与重连后的比较', () => {
  it('连接建立后读取服务端 revision：比本地大就上报，相同则不打扰', async () => {
    const server = { revision: 4 }
    const { changes, options } = setup({ local: 4, readRevision: vi.fn(async () => server.revision) })
    latest().open()
    await settleAll()
    expect(options.readRevision).toHaveBeenCalledTimes(1)
    expect(changes).toEqual([])

    // 断线期间文档被改（事件不会补发），浏览器自动重连后再次 open
    latest().fail(false)
    server.revision = 6
    latest().open()
    await settleAll()
    expect(options.readRevision).toHaveBeenCalledTimes(2)
    expect(changes).toEqual([{ revision: 6, source: 'unknown' }])
  })

  it('读取 revision 失败时静默忽略，不上报也不抛错', async () => {
    const { changes } = setup({ local: 4, readRevision: vi.fn(async () => { throw new Error('offline') }) })
    latest().open()
    await settleAll()
    expect(changes).toEqual([])
  })

  it('重连比较同样先等本地写入落定：自己的保存已体现在服务端 revision 里，不算外部修改', async () => {
    const saving = deferred()
    const { state, changes } = setup({ local: 4, settle: () => saving.promise, readRevision: async () => 5 })
    latest().open()
    await settleAll()
    state.local = 5
    saving.resolve()
    await settleAll()
    expect(changes).toEqual([])
  })
})

describe('连接失败', () => {
  it('浏览器自行重连（CONNECTING）时不重建连接，也不上报任何东西', async () => {
    vi.useFakeTimers()
    const { changes } = setup()
    latest().fail(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(changes).toEqual([])
  })

  it('连接被放弃（HTTP 错误后 CLOSED）时按退避间隔重建，成功后恢复初始间隔', async () => {
    vi.useFakeTimers()
    setup({ reconnectDelaysMs: [1_000, 2_000, 5_000] })

    latest().fail(true)
    expect(FakeEventSource.instances[0]!.closeCalls).toBe(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeEventSource.instances).toHaveLength(2)

    latest().fail(true)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(FakeEventSource.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeEventSource.instances).toHaveLength(3)

    latest().fail(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeEventSource.instances).toHaveLength(4)
    // 用完的间隔重复最后一个
    latest().fail(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(FakeEventSource.instances).toHaveLength(5)

    // 连接成功后重置
    latest().open()
    latest().fail(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(FakeEventSource.instances).toHaveLength(6)
  })

  it('重建的连接建立后同样会读取 revision 比较', async () => {
    vi.useFakeTimers()
    const { changes } = setup({ local: 4, readRevision: async () => 8, reconnectDelaysMs: [1_000] })
    latest().fail(true)
    await vi.advanceTimersByTimeAsync(1_000)
    latest().open()
    await settleAll()
    expect(changes).toEqual([{ revision: 8, source: 'unknown' }])
  })

  it('旧连接关闭后迟到的事件不再生效', async () => {
    vi.useFakeTimers()
    const { changes } = setup({ local: 4, reconnectDelaysMs: [1_000] })
    const stale = latest()
    stale.fail(true)
    await vi.advanceTimersByTimeAsync(1_000)
    stale.change({ revision: 9, source: 'ai' })
    await settleAll()
    expect(changes).toEqual([])
  })

  it('创建连接抛错也不影响页面，之后会重试', async () => {
    vi.useFakeTimers()
    let attempts = 0
    startDocumentChangeSync({
      documentId: 17,
      getLocalRevision: () => 4,
      readRevision: async () => 4,
      onExternalChange: () => undefined,
      reconnectDelaysMs: [1_000],
      createEventSource: (url) => {
        attempts += 1
        if (attempts === 1) throw new Error('blocked')
        return new FakeEventSource(url)
      },
    })
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(attempts).toBe(2)
  })
})

describe('页面重新可见时的补充检查', () => {
  function stubDocument() {
    const listeners = new Set<() => void>()
    const fake = {
      visibilityState: 'visible' as 'visible' | 'hidden',
      addEventListener: (type: string, listener: () => void) => { if (type === 'visibilitychange') listeners.add(listener) },
      removeEventListener: (type: string, listener: () => void) => { if (type === 'visibilitychange') listeners.delete(listener) },
    }
    vi.stubGlobal('document', fake)
    return { fake, listeners, fire: () => [...listeners].forEach((listener) => listener()) }
  }

  it('重新可见时读取 revision 并比较（连接可能在后台悄悄失效）；隐藏时不检查', async () => {
    vi.useFakeTimers()
    const page = stubDocument()
    const server = { revision: 4 }
    const { changes, options } = setup({ local: 4, readRevision: vi.fn(async () => server.revision) })

    page.fake.visibilityState = 'hidden'
    page.fire()
    await settleAll()
    expect(options.readRevision).not.toHaveBeenCalled()

    // 连接已失效期间文档被改，没有任何事件到达
    server.revision = 6
    page.fake.visibilityState = 'visible'
    page.fire()
    await settleAll()
    expect(options.readRevision).toHaveBeenCalledTimes(1)
    expect(changes).toEqual([{ revision: 6, source: 'unknown' }])
  })

  it('短时间内反复切换标签页只检查一次；过了最短间隔再检查。刚建立连接做过的比较也算在内', async () => {
    vi.useFakeTimers()
    const page = stubDocument()
    const { options } = setup({ local: 4, minRecheckIntervalMs: 10_000 })

    latest().open() // 连接建立时已比较过一次
    await settleAll()
    expect(options.readRevision).toHaveBeenCalledTimes(1)

    page.fire()
    await settleAll()
    expect(options.readRevision).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    page.fire()
    page.fire()
    await settleAll()
    expect(options.readRevision).toHaveBeenCalledTimes(2)
  })

  it('stop 后移除监听，不再检查', async () => {
    vi.useFakeTimers()
    const page = stubDocument()
    const { sync, options } = setup({ local: 4 })
    expect(page.listeners.size).toBe(1)
    sync.stop()
    expect(page.listeners.size).toBe(0)
    page.fire()
    await settleAll()
    expect(options.readRevision).not.toHaveBeenCalled()
  })
})
