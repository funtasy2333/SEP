/**
 * 文档变更订阅（设计文档 §6.2）：用 EventSource 订阅 `GET /api/documents/:id/events`，
 * 把「别处写入了文档」归结为一个 {@link ExternalChange} 交给调用方处理。
 *
 * 服务端协议要点（见 server 的 document-events.controller.ts）：
 * - 事件 `document-changed`，`data` 为 `{ documentId, revision, source, client?, at }`，不含内容；
 * - 事件不重放，连接建立时也不推送当前 revision。所以每次（重新）连接成功后都要重新读取文档 revision
 *   并与本地比较：既补上断线期间错过的变更，也补上「读取文档」与「订阅生效」之间的空档；
 * - 编辑器自己的保存同样会产生 human 事件，而且常常比保存请求的响应先到达——此时本地 revision 尚未更新，
 *   必须等本地写入落定（`settle`）后再比较，否则会把自己的保存当成别人的修改；
 * - EventSource 看不到服务端的心跳（SSE 注释行），连接悄悄失效（休眠、半开的代理连接）时既不报错也不重连，
 *   所以页面重新可见时也补充比较一次 revision。
 *
 * 本模块不依赖 Vue，也不决定如何处理外部修改（自动载入还是进入冲突由调用方按编辑器状态判断）。
 */

/** 服务端事件里的来源。 */
export type ChangeSource = 'human' | 'ai' | 'system'

/** `document-changed` 事件的 data。 */
export interface DocumentChangeEventData {
  documentId: number
  revision: number
  source: ChangeSource
  client?: string
  at?: string
  lifecycle?: 'deleted' | 'restored'
}

/** 交给调用方的外部修改。`system` 仅在「本地 revision 之后的每一次写入都是 system 写入」时出现。 */
export interface ExternalChange {
  /** 已观察到的最高 revision（大于本地 revision）。 */
  revision: number
  /** 来源：`unknown` 表示只通过重连后读取 revision 得知有变化，无法判断是谁改的。 */
  source: ChangeSource | 'unknown'
  /** ai / human 事件携带的写入方标识。 */
  client?: string
  /** 文档移入回收站或恢复；编辑器收到后必须保持当前页面只读。 */
  lifecycle?: 'deleted' | 'restored'
}

/** 测试可替换的 EventSource 最小接口。 */
export interface EventSourceLike {
  readonly readyState: number
  addEventListener(type: string, listener: (event: any) => void): void
  close(): void
}

export interface DocumentChangeSyncOptions {
  documentId: number
  /** 本地已知的 revision（打开文档或最近一次保存的响应）；尚未载入时返回 undefined。 */
  getLocalRevision: () => number | undefined
  /** 读取服务端当前的 revision；重连后用它与本地比较。失败时静默忽略。 */
  readRevision: () => Promise<number>
  /**
   * 等待本地写入落定（没有进行中或排队的保存）后 resolve。
   * 比较 revision 之前总会先等它，避免把自己保存产生的事件当成外部修改。缺省为立即返回。
   */
  settle?: () => Promise<void>
  /**
   * 处理一次外部修改。返回 `false` 表示没有处理成功（如读取失败），同一 revision 之后还会再次上报；
   * 其他返回值视为已处理。同一时刻只会有一次调用在执行。
   */
  onExternalChange: (change: ExternalChange) => Promise<boolean | void> | boolean | void
  /** 每收到一条合法事件就调用一次，不做 revision 比较（如：AI 事件到来时刷新版本列表）。 */
  onEvent?: (event: DocumentChangeEventData) => void
  /** 测试用：替换 EventSource 的创建。 */
  createEventSource?: (url: string) => EventSourceLike
  /** 连接被浏览器放弃（HTTP 错误等）后的重连间隔（毫秒），依次使用，用完后重复最后一个。 */
  reconnectDelaysMs?: number[]
  /** 页面重新可见时的补充检查之间的最短间隔（毫秒），避免频繁切换标签页反复读取文档。默认 10 秒。 */
  minRecheckIntervalMs?: number
}

export interface DocumentChangeSync {
  /** 关闭连接并清理所有定时器；之后不会再调用任何回调。可重复调用。 */
  stop: () => void
}

const SSE_CLOSED = 2
const DEFAULT_RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000, 30_000]
const DEFAULT_MIN_RECHECK_INTERVAL_MS = 10_000
const VALID_SOURCES: readonly string[] = ['human', 'ai', 'system']
const VALID_LIFECYCLES: readonly string[] = ['deleted', 'restored']

export function documentEventsUrl(documentId: number): string {
  return `/api/documents/${documentId}/events`
}

/** 解析并校验一条事件的 data；不合法（或属于别的文档）返回 null。 */
export function parseChangeEvent(raw: unknown, documentId: number): DocumentChangeEventData | null {
  if (typeof raw !== 'string') return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const event = data as Record<string, unknown>
  if (event.documentId !== documentId) return null
  if (typeof event.revision !== 'number' || !Number.isInteger(event.revision) || event.revision < 0) return null
  if (typeof event.source !== 'string' || !VALID_SOURCES.includes(event.source)) return null
  if (event.lifecycle !== undefined && (typeof event.lifecycle !== 'string' || !VALID_LIFECYCLES.includes(event.lifecycle))) return null
  return {
    documentId,
    revision: event.revision,
    source: event.source as ChangeSource,
    ...(typeof event.client === 'string' && event.client ? { client: event.client } : {}),
    ...(typeof event.at === 'string' ? { at: event.at } : {}),
    ...(event.lifecycle === undefined ? {} : { lifecycle: event.lifecycle as 'deleted' | 'restored' }),
  }
}

interface PendingChange {
  revision: number
  source: ChangeSource | 'unknown'
  client?: string
  lifecycle?: 'deleted' | 'restored'
}

/**
 * 把本地 revision 之后收到的变更合并成一次外部修改。优先级 ai > human > unknown > system：
 * 只要其间有 AI 写入就按 AI 处理；全是 system 写入且 revision 连续覆盖（没有漏掉的写入）才算 system。
 */
function summarize(changes: PendingChange[], floor: number): ExternalChange {
  const revision = changes.reduce((max, change) => Math.max(max, change.revision), floor)
  const latestWithClient = (source: ChangeSource) => [...changes]
    .reverse()
    .find((change) => change.source === source && change.client)?.client
  const withClient = (source: ExternalChange['source'], client?: string): ExternalChange =>
    ({ revision, source, ...(client ? { client } : {}) })

  const latestLifecycle = [...changes].reverse().find((change) => change.lifecycle)
  if (latestLifecycle?.lifecycle) {
    return {
      revision,
      source: latestLifecycle.source,
      ...(latestLifecycle.client ? { client: latestLifecycle.client } : {}),
      lifecycle: latestLifecycle.lifecycle,
    }
  }

  if (changes.some((change) => change.source === 'ai')) return withClient('ai', latestWithClient('ai'))
  if (changes.some((change) => change.source === 'human')) return withClient('human', latestWithClient('human'))
  if (changes.some((change) => change.source === 'unknown')) return withClient('unknown')
  const covered = new Set(changes.map((change) => change.revision))
  for (let next = floor + 1; next <= revision; next += 1) {
    if (!covered.has(next)) return withClient('unknown')
  }
  return withClient('system')
}

export function startDocumentChangeSync(options: DocumentChangeSyncOptions): DocumentChangeSync {
  const {
    documentId,
    getLocalRevision,
    readRevision,
    settle = () => Promise.resolve(),
    onExternalChange,
    onEvent,
  } = options
  const delays = options.reconnectDelaysMs?.length ? options.reconnectDelaysMs : DEFAULT_RECONNECT_DELAYS_MS
  const minRecheckIntervalMs = options.minRecheckIntervalMs ?? DEFAULT_MIN_RECHECK_INTERVAL_MS
  const createEventSource = options.createEventSource
    ?? (typeof EventSource === 'undefined' ? null : (url: string) => new EventSource(url))

  let stopped = false
  let source: EventSourceLike | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  /** 已交给 onExternalChange 并处理成功的最高 revision：同一 revision 不重复上报。 */
  let handledRevision = -1
  let pending: PendingChange[] = []
  let flushing = false
  let flushAgain = false
  let lastCheckAt = 0

  function floor(): number | undefined {
    const local = getLocalRevision()
    return local === undefined ? undefined : Math.max(local, handledRevision)
  }

  async function flush(): Promise<void> {
    if (flushing) {
      flushAgain = true
      return
    }
    flushing = true
    try {
      do {
        flushAgain = false
        await settle()
        if (stopped) return
        const base = floor()
        if (base === undefined) return
        pending = pending.filter((change) => change.revision > base)
        if (pending.length === 0) continue
        const change = summarize(pending, base)
        const previous = handledRevision
        // 处理期间新到的事件留在 pending 里，下一轮再比较；先记下已上报的 revision，处理失败时回退。
        pending = pending.filter((entry) => entry.revision > change.revision)
        handledRevision = change.revision
        let handled: boolean | void = false
        try {
          handled = await onExternalChange(change)
        } catch (error) {
          console.error('处理文档外部修改失败', error)
        }
        if (handled === false) handledRevision = previous
      } while (flushAgain && !stopped)
    } finally {
      flushing = false
    }
  }

  function report(change: PendingChange): void {
    if (stopped) return
    const base = floor()
    if (base !== undefined && change.revision <= base) return
    pending.push(change)
    void flush()
  }

  /** 读取服务端 revision，与本地比较（连接建立后、页面重新可见时调用）。 */
  async function checkRevision(): Promise<void> {
    lastCheckAt = Date.now()
    let revision: number
    try {
      revision = await readRevision()
    } catch {
      // 读取失败不打扰用户：下一次事件或下一次重连会再比较。
      return
    }
    report({ revision, source: 'unknown' })
  }

  /**
   * 页面重新可见：连接可能在后台或休眠期间悄悄失效（EventSource 看不到服务端的心跳，
   * 半开的连接既不报错也不重连），所以补充比较一次 revision。短时间内重复切换只检查一次。
   */
  function onVisibilityChange(): void {
    if (stopped || document.visibilityState !== 'visible') return
    if (Date.now() - lastCheckAt < minRecheckIntervalMs) return
    void checkRevision()
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return
    const delay = delays[Math.min(reconnectAttempt, delays.length - 1)]
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  function connect(): void {
    if (stopped || !createEventSource) return
    let current: EventSourceLike
    try {
      current = createEventSource(documentEventsUrl(documentId))
    } catch {
      scheduleReconnect()
      return
    }
    source = current
    current.addEventListener('open', () => {
      if (stopped || source !== current) return
      reconnectAttempt = 0
      void checkRevision()
    })
    current.addEventListener('document-changed', (message: { data?: unknown }) => {
      if (stopped || source !== current) return
      const event = parseChangeEvent(message.data, documentId)
      if (!event) return
      onEvent?.(event)
      report({
        revision: event.revision,
        source: event.source,
        ...(event.client ? { client: event.client } : {}),
        ...(event.lifecycle ? { lifecycle: event.lifecycle } : {}),
      })
    })
    current.addEventListener('error', () => {
      if (stopped || source !== current) return
      // CONNECTING：浏览器按服务端给的 retry 自行重连，之后会再触发 open。
      // CLOSED：HTTP 错误（如开发代理在后端重启时返回 5xx）后浏览器不会再重连，由这里按退避间隔重建连接。
      if (current.readyState === SSE_CLOSED) {
        current.close()
        source = null
        scheduleReconnect()
      }
    })
  }

  connect()
  const watchVisibility = typeof document !== 'undefined' && typeof document.addEventListener === 'function'
  if (watchVisibility) document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    stop() {
      if (stopped) return
      stopped = true
      if (watchVisibility) document.removeEventListener('visibilitychange', onVisibilityChange)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      pending = []
      const closing = source
      source = null
      closing?.close()
    },
  }
}
