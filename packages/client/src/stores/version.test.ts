import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { versionApi, type VersionData } from '@/api/version'
import { useVersionStore } from './version'

vi.mock('@/api/version', () => ({
  versionApi: {
    listByDocument: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  },
}))

const api = vi.mocked(versionApi)

function version(id: number, documentId = 7, extra: Partial<VersionData> = {}): VersionData {
  return {
    id,
    documentId,
    versionNo: `1.${id}`,
    stage: 'working_draft',
    content: { type: 'doc', content: [] },
    createdAt: `2026-10-0${id}T00:00:00.000Z`,
    ...extra,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/** axios 的响应包装 */
const ok = <T>(data: T) => ({ data }) as never

/** 让已就绪的微任务都跑完。 */
async function drain() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

const ids = (versions: VersionData[]) => versions.map((v) => v.id)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
})

describe('fetchVersions：只采用最近一次发出的请求', () => {
  it('后发先至：较新的请求先返回，较旧的请求晚到时不覆盖列表', async () => {
    const store = useVersionStore()
    const older = deferred<ReturnType<typeof ok>>()
    const newer = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(older.promise as never).mockReturnValueOnce(newer.promise as never)

    const first = store.fetchVersions(7)
    const second = store.fetchVersions(7, { silent: true })

    newer.resolve(ok([version(2), version(1)]))
    await second
    expect(ids(store.versions)).toEqual([2, 1])

    older.resolve(ok([version(1)]))
    await first
    expect(ids(store.versions)).toEqual([2, 1])
  })

  it('先发先至：两次都返回后，列表是最近一次请求的数据', async () => {
    const store = useVersionStore()
    const older = deferred<ReturnType<typeof ok>>()
    const newer = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(older.promise as never).mockReturnValueOnce(newer.promise as never)

    const first = store.fetchVersions(7)
    const second = store.fetchVersions(7, { silent: true })

    older.resolve(ok([version(1)]))
    await first
    // 较旧的响应先到：不采用（否则列表会短暂回到旧状态）
    expect(store.versions).toEqual([])

    newer.resolve(ok([version(2), version(1)]))
    await second
    expect(ids(store.versions)).toEqual([2, 1])
  })

  it('单次请求仍然正常写入列表', async () => {
    const store = useVersionStore()
    api.listByDocument.mockResolvedValueOnce(ok([version(1)]))
    await store.fetchVersions(7)
    expect(ids(store.versions)).toEqual([1])
    expect(store.currentDocumentId).toBe(7)
  })

  it('切换文档：旧文档较晚返回的响应不会覆盖新文档的列表', async () => {
    const store = useVersionStore()
    const doc7 = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(doc7.promise as never)
    api.listByDocument.mockResolvedValueOnce(ok([version(5, 8)]))

    const first = store.fetchVersions(7)
    await store.fetchVersions(8)
    expect(ids(store.versions)).toEqual([5])
    expect(store.currentDocumentId).toBe(8)

    doc7.resolve(ok([version(1, 7), version(2, 7)]))
    await first
    expect(ids(store.versions)).toEqual([5])
    expect(store.currentDocumentId).toBe(8)
  })

  it('切换文档：新文档的响应先到、旧文档的先发出也不串；顺序相反同样不串', async () => {
    const store = useVersionStore()
    const doc7 = deferred<ReturnType<typeof ok>>()
    const doc8 = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(doc7.promise as never).mockReturnValueOnce(doc8.promise as never)

    const first = store.fetchVersions(7)
    const second = store.fetchVersions(8)
    doc7.resolve(ok([version(1, 7)]))
    await first
    expect(store.versions).toEqual([])
    doc8.resolve(ok([version(5, 8)]))
    await second
    expect(ids(store.versions)).toEqual([5])
  })

  it('较旧的请求失败不影响较新的结果；失败的错误仍抛给它的调用方', async () => {
    const store = useVersionStore()
    const older = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(older.promise as never)
    api.listByDocument.mockResolvedValueOnce(ok([version(2), version(1)]))

    const first = store.fetchVersions(7)
    const failed = first.catch((reason: unknown) => reason)
    await store.fetchVersions(7, { silent: true })
    older.reject(new Error('network unavailable'))

    expect(await failed).toEqual(new Error('network unavailable'))
    expect(ids(store.versions)).toEqual([2, 1])
  })
})

describe('fetchVersions：loading 开关', () => {
  it('非 silent 请求被更新的请求取代：loading 保持到最新请求返回，不会过早关闭，也不会卡住', async () => {
    const store = useVersionStore()
    const older = deferred<ReturnType<typeof ok>>()
    const newer = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(older.promise as never).mockReturnValueOnce(newer.promise as never)

    const first = store.fetchVersions(7) // 非 silent：打开 loading
    expect(store.loading).toBe(true)
    const second = store.fetchVersions(7, { silent: true }) // 例如 AI 事件触发的刷新
    expect(store.loading).toBe(true)

    // 较旧的先返回：loading 不能就此关闭（列表还没有最新数据）
    older.resolve(ok([version(1)]))
    await first
    expect(store.loading).toBe(true)
    expect(store.versions).toEqual([])

    // 最新的（silent）返回：负责关掉前一个非 silent 请求打开的 loading
    newer.resolve(ok([version(2), version(1)]))
    await second
    expect(store.loading).toBe(false)
    expect(ids(store.versions)).toEqual([2, 1])
  })

  it('较新的请求先返回：loading 关闭，之后较旧响应到达不会再改动 loading 与列表', async () => {
    const store = useVersionStore()
    const older = deferred<ReturnType<typeof ok>>()
    const newer = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(older.promise as never).mockReturnValueOnce(newer.promise as never)

    const first = store.fetchVersions(7)
    const second = store.fetchVersions(7)
    newer.resolve(ok([version(2)]))
    await second
    expect(store.loading).toBe(false)

    older.resolve(ok([version(1)]))
    await first
    expect(store.loading).toBe(false)
    expect(ids(store.versions)).toEqual([2])
  })

  it('silent 请求先发出、非 silent 请求后发出：loading 由后者打开并在它返回时关闭', async () => {
    const store = useVersionStore()
    const older = deferred<ReturnType<typeof ok>>()
    const newer = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(older.promise as never).mockReturnValueOnce(newer.promise as never)

    const first = store.fetchVersions(7, { silent: true })
    expect(store.loading).toBe(false)
    const second = store.fetchVersions(7)
    expect(store.loading).toBe(true)

    older.resolve(ok([version(1)]))
    await first
    expect(store.loading).toBe(true)

    newer.resolve(ok([version(2), version(1)]))
    await second
    expect(store.loading).toBe(false)
    expect(ids(store.versions)).toEqual([2, 1])
  })

  it('最新请求失败时 loading 也会关闭', async () => {
    const store = useVersionStore()
    api.listByDocument.mockRejectedValueOnce(new Error('boom'))
    await expect(store.fetchVersions(7)).rejects.toThrow('boom')
    expect(store.loading).toBe(false)
  })

  it('切换文档时旧文档的非 silent 请求被取代：loading 由新文档的请求关闭', async () => {
    const store = useVersionStore()
    const doc7 = deferred<ReturnType<typeof ok>>()
    const doc8 = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(doc7.promise as never).mockReturnValueOnce(doc8.promise as never)

    const first = store.fetchVersions(7)
    const second = store.fetchVersions(8)
    doc7.resolve(ok([version(1, 7)]))
    await first
    expect(store.loading).toBe(true)
    doc8.resolve(ok([version(5, 8)]))
    await second
    expect(store.loading).toBe(false)
  })

  it('clearVersions 使进行中的请求作废并关闭 loading：晚到的响应不会写回已清空的列表', async () => {
    const store = useVersionStore()
    const pending = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(pending.promise as never)

    const fetching = store.fetchVersions(7)
    expect(store.loading).toBe(true)
    store.clearVersions()
    expect(store.loading).toBe(false)

    pending.resolve(ok([version(1)]))
    await fetching
    expect(store.versions).toEqual([])
    expect(store.currentDocumentId).toBeNull()
    expect(store.loading).toBe(false)
  })
})

describe('createVersion 与进行中的刷新交错', () => {
  it('创建前发出的刷新在创建之后才返回（响应里没有新版本）：再刷新一次，刚创建的版本不丢失', async () => {
    const store = useVersionStore()
    const staleRefresh = deferred<ReturnType<typeof ok>>()
    const followUp = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(staleRefresh.promise as never)
    const refreshing = store.fetchVersions(7, { silent: true })

    api.create.mockResolvedValueOnce(ok(version(3)))
    // 创建之后补发的刷新：服务端已包含新版本
    api.listByDocument.mockReturnValueOnce(followUp.promise as never)
    await store.createVersion({ documentId: 7, versionNo: '1.3', stage: 'working_draft', content: {} })
    expect(ids(store.versions)).toEqual([3]) // 先本地加上，立即可见
    expect(api.listByDocument).toHaveBeenCalledTimes(2)

    // 旧刷新晚到（不含新版本）：被丢弃，刚创建的版本还在
    staleRefresh.resolve(ok([version(2), version(1)]))
    await refreshing
    expect(ids(store.versions)).toEqual([3])

    followUp.resolve(ok([version(3), version(2), version(1)]))
    await drain()
    expect(ids(store.versions)).toEqual([3, 2, 1])
  })

  it('补发的刷新先返回、旧刷新后到：旧刷新同样被丢弃', async () => {
    const store = useVersionStore()
    const staleRefresh = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(staleRefresh.promise as never)
    const refreshing = store.fetchVersions(7, { silent: true })

    api.create.mockResolvedValueOnce(ok(version(3)))
    api.listByDocument.mockResolvedValueOnce(ok([version(3), version(2), version(1)]))
    await store.createVersion({ documentId: 7, versionNo: '1.3', stage: 'working_draft', content: {} })
    await drain()
    expect(ids(store.versions)).toEqual([3, 2, 1])

    staleRefresh.resolve(ok([version(2), version(1)]))
    await refreshing
    expect(ids(store.versions)).toEqual([3, 2, 1])
  })

  it('进行中的是非 silent 刷新：被补发的 silent 刷新取代后 loading 仍会关闭', async () => {
    const store = useVersionStore()
    const staleRefresh = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(staleRefresh.promise as never)
    const refreshing = store.fetchVersions(7)
    expect(store.loading).toBe(true)

    api.create.mockResolvedValueOnce(ok(version(3)))
    api.listByDocument.mockResolvedValueOnce(ok([version(3), version(1)]))
    await store.createVersion({ documentId: 7, versionNo: '1.3', stage: 'working_draft', content: {} })
    await drain()
    expect(store.loading).toBe(false)

    staleRefresh.resolve(ok([version(1)]))
    await refreshing
    expect(store.loading).toBe(false)
    expect(ids(store.versions)).toEqual([3, 1])
  })

  it('没有进行中的刷新时创建版本不多发请求', async () => {
    const store = useVersionStore()
    api.listByDocument.mockResolvedValueOnce(ok([version(1)]))
    await store.fetchVersions(7)
    api.listByDocument.mockClear()

    api.create.mockResolvedValueOnce(ok(version(2)))
    await store.createVersion({ documentId: 7, versionNo: '1.2', stage: 'working_draft', content: {} })
    await drain()
    expect(api.listByDocument).not.toHaveBeenCalled()
    expect(ids(store.versions)).toEqual([2, 1])
  })

  it('补发的刷新失败不影响创建结果：新版本仍在列表里，loading 已关闭', async () => {
    const store = useVersionStore()
    const staleRefresh = deferred<ReturnType<typeof ok>>()
    api.listByDocument.mockReturnValueOnce(staleRefresh.promise as never)
    const refreshing = store.fetchVersions(7)

    api.create.mockResolvedValueOnce(ok(version(3)))
    api.listByDocument.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(store.createVersion({ documentId: 7, versionNo: '1.3', stage: 'working_draft', content: {} }))
      .resolves.toMatchObject({ id: 3 })
    await drain()
    expect(ids(store.versions)).toEqual([3])
    expect(store.loading).toBe(false)

    staleRefresh.resolve(ok([version(1)]))
    await refreshing
    expect(ids(store.versions)).toEqual([3])
  })
})
