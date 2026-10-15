import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { documentApi, type DocumentData } from '@/api/document'
import { isRevisionConflict } from '@/utils/documentConflict'
import { useDocumentStore } from './document'

vi.mock('@/api/document', () => ({
  documentApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const api = vi.mocked(documentApi)

function doc(revision: number, extra: Partial<DocumentData> = {}): DocumentData {
  return {
    id: 7,
    title: '测试',
    meta: { standardType: 'national', titleCn: '测试' },
    stage: 'working_draft',
    content: { type: 'doc', content: [] },
    revision,
    ...extra,
  } as DocumentData
}

function conflictError(revision: number) {
  return Object.assign(new Error('Request failed with status code 409'), {
    response: { status: 409, data: { statusCode: 409, message: '文档已被修改', revision } },
  })
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

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
})

describe('文档 store 的 baseRevision', () => {
  it('更新时带上打开文档得到的 revision，并用响应里的新 revision 更新本地记录', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValue(ok(doc(3)))
    api.list.mockResolvedValue(ok([doc(3)]))
    await store.fetchDocuments()
    await store.fetchDocument(7)

    api.update.mockResolvedValue(ok(doc(4, { title: '新标题' })))
    const updated = await store.updateDocument(7, { title: '新标题' })

    expect(api.update).toHaveBeenCalledWith(7, { title: '新标题', baseRevision: 3 })
    expect(updated.revision).toBe(4)
    expect(store.currentDocument?.revision).toBe(4)
    expect(store.documents[0].revision).toBe(4)
    expect(store.documents[0].title).toBe('新标题')
  })

  it('连续保存使用上一次响应的 revision（即使调用方没有等待上一次完成）', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValue(ok(doc(0)))
    await store.fetchDocument(7)

    const first = deferred<ReturnType<typeof ok>>()
    api.update
      .mockReturnValueOnce(first.promise as never)
      .mockResolvedValueOnce(ok(doc(2)))
      .mockResolvedValueOnce(ok(doc(3)))

    // 设置保存、正文自动保存、版本保存先后发生：全部同步发起。
    const settings = store.updateDocument(7, { title: '设置' })
    const body = store.updateDocument(7, { content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    const version = store.updateDocument(7, { content: { type: 'doc', content: [] } })
    await Promise.resolve()
    // 第一个请求未完成时，后面的请求不应发出（否则会带着过期的 revision）。
    expect(api.update).toHaveBeenCalledTimes(1)

    first.resolve(ok(doc(1)))
    await Promise.all([settings, body, version])

    expect(api.update.mock.calls.map(([, payload]) => payload.baseRevision)).toEqual([0, 1, 2])
    expect(store.currentDocument?.revision).toBe(3)
  })

  it('前一次保存失败后，下一次仍然发出并沿用未变化的 revision', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValue(ok(doc(5)))
    await store.fetchDocument(7)

    api.update
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(ok(doc(6)))
    const failed = store.updateDocument(7, { title: 'A' })
    const next = store.updateDocument(7, { title: 'B' })
    await expect(failed).rejects.toThrow('network unavailable')
    await expect(next).resolves.toMatchObject({ revision: 6 })

    expect(api.update.mock.calls.map(([, payload]) => payload.baseRevision)).toEqual([5, 5])
  })

  it('409 时抛出可识别的冲突错误，本地 revision 与文档保持不变', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValue(ok(doc(2, { title: '本地已知' })))
    await store.fetchDocument(7)

    api.update.mockRejectedValue(conflictError(9))
    const error = await store.updateDocument(7, { title: '想覆盖' }).catch((reason: unknown) => reason)

    expect(isRevisionConflict(error)).toBe(true)
    expect(store.currentDocument?.revision).toBe(2)
    expect(store.currentDocument?.title).toBe('本地已知')
  })

  it('重新加载后用服务端最新 revision 继续保存', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(2)))
    await store.fetchDocument(7)
    api.update.mockRejectedValueOnce(conflictError(5))
    await expect(store.updateDocument(7, { title: 'x' })).rejects.toBeDefined()

    api.get.mockResolvedValueOnce(ok(doc(5)))
    await store.fetchDocument(7)
    api.update.mockResolvedValueOnce(ok(doc(6)))
    await store.updateDocument(7, { title: 'y' })

    expect(api.update).toHaveBeenLastCalledWith(7, { title: 'y', baseRevision: 5 })
  })

  it('不知道文档 revision 时不发请求', async () => {
    const store = useDocumentStore()
    await expect(store.updateDocument(7, { title: 'x' })).rejects.toThrow('修订号')
    expect(api.update).not.toHaveBeenCalled()

    // currentDocument 是另一份文档时同样不能借用它的 revision。
    api.get.mockResolvedValue(ok(doc(1, { id: 8 })))
    await store.fetchDocument(8)
    await expect(store.updateDocument(7, { title: 'x' })).rejects.toThrow('修订号')
    expect(api.update).not.toHaveBeenCalled()
  })

  it('新建文档的响应带 revision，进入列表', async () => {
    const store = useDocumentStore()
    api.create.mockResolvedValue(ok(doc(0, { id: 9 })))
    const created = await store.createDocument({ title: '新文档' })
    expect(created.revision).toBe(0)
    expect(store.documents[0].revision).toBe(0)
  })
})

describe('感知外部修改所需的 store 能力', () => {
  it('readDocument 只读取最新文档，不改动 currentDocument', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(3)))
    await store.fetchDocument(7)

    api.get.mockResolvedValueOnce(ok(doc(6, { title: '别处改的' })))
    const latest = await store.readDocument(7)
    expect(latest.revision).toBe(6)
    expect(store.currentDocument?.revision).toBe(3)
    expect(store.currentDocument?.title).toBe('测试')
  })

  it('adoptDocument 把已装入编辑器的最新文档安装为当前文档并同步列表；只前进不后退，也不接受别的文档', async () => {
    const store = useDocumentStore()
    api.list.mockResolvedValue(ok([doc(3)]))
    api.get.mockResolvedValueOnce(ok(doc(3)))
    await store.fetchDocuments()
    await store.fetchDocument(7)

    expect(store.adoptDocument(doc(6, { title: '别处改的' }))).toBe(true)
    expect(store.currentDocument?.revision).toBe(6)
    expect(store.documents[0].title).toBe('别处改的')

    // 较早发出的读取晚到：不覆盖更新的记录
    expect(store.adoptDocument(doc(5))).toBe(false)
    expect(store.adoptDocument(doc(6))).toBe(false)
    expect(store.currentDocument?.revision).toBe(6)
    // 别的文档
    expect(store.adoptDocument(doc(9, { id: 8 }))).toBe(false)
    expect(store.currentDocument?.id).toBe(7)
  })

  it('adoptRevision 只前移 revision，内容不变；用于 system 写入', async () => {
    const store = useDocumentStore()
    api.list.mockResolvedValue(ok([doc(3)]))
    api.get.mockResolvedValueOnce(ok(doc(3, { title: '本地内容' })))
    await store.fetchDocuments()
    await store.fetchDocument(7)

    expect(store.adoptRevision(7, 4)).toBe(true)
    expect(store.currentDocument?.revision).toBe(4)
    expect(store.currentDocument?.title).toBe('本地内容')
    expect(store.documents[0].revision).toBe(4)
    expect(store.adoptRevision(7, 4)).toBe(false)
    expect(store.adoptRevision(7, 2)).toBe(false)
    expect(store.adoptRevision(8, 9)).toBe(false)
    expect(store.currentDocument?.revision).toBe(4)

    // 追上之后的保存使用新的 revision
    api.update.mockResolvedValueOnce(ok(doc(5)))
    await store.updateDocument(7, { title: 'y' })
    expect(api.update).toHaveBeenCalledWith(7, { title: 'y', baseRevision: 4 })
  })

  it('waitForPendingUpdates 等到排队和进行中的写入都结束（无论成败），没有写入时立即返回', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(3)))
    await store.fetchDocument(7)
    await store.waitForPendingUpdates(7)

    const first = deferred<ReturnType<typeof ok>>()
    api.update
      .mockReturnValueOnce(first.promise as never)
      .mockRejectedValueOnce(conflictError(9))
    const a = store.updateDocument(7, { title: 'a' })
    const b = store.updateDocument(7, { title: 'b' })
    void b.catch(() => undefined)

    let waited = false
    const waiter = store.waitForPendingUpdates(7).then(() => { waited = true })
    await Promise.resolve()
    expect(waited).toBe(false)

    first.resolve(ok(doc(4)))
    await a
    await waiter
    expect(waited).toBe(true)
    // 第二个写入（409）也已落定：等待者看到的是最终状态
    expect(api.update).toHaveBeenCalledTimes(2)
    expect(store.currentDocument?.revision).toBe(4)
    await expect(b).rejects.toBeDefined()
  })

  it('等待期间又排进来的写入也会被等待', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(3)))
    await store.fetchDocument(7)

    const first = deferred<ReturnType<typeof ok>>()
    const second = deferred<ReturnType<typeof ok>>()
    api.update.mockReturnValueOnce(first.promise as never).mockReturnValueOnce(second.promise as never)
    void store.updateDocument(7, { title: 'a' })
    let waited = false
    const waiter = store.waitForPendingUpdates(7).then(() => { waited = true })
    first.resolve(ok(doc(4)))
    await Promise.resolve()
    void store.updateDocument(7, { title: 'b' })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(waited).toBe(false)
    second.resolve(ok(doc(5)))
    await waiter
    expect(store.currentDocument?.revision).toBe(5)
  })
})

describe('runDocumentWrite：把多步流程登记为一次本地写入', () => {
  /** 让已就绪的微任务都跑完（用来断言「此刻还没有发生某件事」）。 */
  async function drain() {
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
  }

  it('task 运行期间 waitForPendingUpdates 不返回，task 结束（无论成败）后才返回', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(3)))
    await store.fetchDocument(7)

    const gate = deferred<void>()
    const write = store.runDocumentWrite(7, async () => { await gate.promise })
    expect(store.hasPendingUpdates(7)).toBe(true)

    let waited = false
    const waiter = store.waitForPendingUpdates(7).then(() => { waited = true })
    await drain()
    expect(waited).toBe(false)

    gate.resolve()
    await write
    await waiter
    expect(waited).toBe(true)
    expect(store.hasPendingUpdates(7)).toBe(false)

    // 失败的 task 同样让等待者返回
    const failing = deferred<void>()
    const failed = store.runDocumentWrite(7, async () => { await failing.promise })
    void failed.catch(() => undefined)
    waited = false
    const secondWaiter = store.waitForPendingUpdates(7).then(() => { waited = true })
    await drain()
    expect(waited).toBe(false)
    failing.reject(new Error('boom'))
    await secondWaiter
    expect(waited).toBe(true)
    await expect(failed).rejects.toThrow('boom')
  })

  it('task 内的 PUT 用发请求那一刻的 revision，而不是排队或 task 开始时的', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(3)))
    await store.fetchDocument(7)

    // 前面已有一个写入：排队时本地 revision 是 3，轮到 task 时已是 4
    const first = deferred<ReturnType<typeof ok>>()
    api.update.mockReturnValueOnce(first.promise as never)
    const before = store.updateDocument(7, { title: '前一个写入' })

    const gate = deferred<void>()
    let revisionWhenTaskStarted: number | undefined
    api.update.mockResolvedValueOnce(ok(doc(10, { title: 'task 写入' })))
    const write = store.runDocumentWrite(7, async (put) => {
      revisionWhenTaskStarted = store.currentDocument?.revision
      await gate.promise
      return await put({ title: 'task 写入' })
    })
    await drain()
    expect(api.update).toHaveBeenCalledTimes(1)

    first.resolve(ok(doc(4)))
    await before
    await drain()
    expect(revisionWhenTaskStarted).toBe(4)

    // task 等待期间本地 revision 又前移（例如 system 写入追上），PUT 取的是此刻的值
    store.adoptRevision(7, 9)
    gate.resolve()
    const saved = await write
    expect(saved.revision).toBe(10)
    expect(api.update).toHaveBeenLastCalledWith(7, { title: 'task 写入', baseRevision: 9 })
    expect(store.currentDocument?.revision).toBe(10)
  })

  it('task 内先做别的异步操作再 PUT，期间外部写入使服务端 revision 前移时，PUT 得到 409 且本地记录不变', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(3, { title: '本地已知' })))
    await store.fetchDocument(7)

    // 简易服务端：按 baseRevision 判断
    let serverRevision = 3
    api.update.mockImplementation((async (_id: number, body: { baseRevision: number }) => {
      if (body.baseRevision !== serverRevision) throw conflictError(serverRevision)
      serverRevision += 1
      return ok(doc(serverRevision))
    }) as never)

    const gate = deferred<void>()
    const write = store.runDocumentWrite(7, async (put) => {
      await gate.promise // 例如创建版本快照
      return await put({ content: { type: 'doc', content: [] } })
    })
    serverRevision = 4 // 外部（AI）在这期间写入了文档
    gate.resolve()

    const error = await write.catch((reason: unknown) => reason)
    expect(isRevisionConflict(error)).toBe(true)
    expect(store.currentDocument?.revision).toBe(3)
    expect(store.currentDocument?.title).toBe('本地已知')
  })

  it('task 抛错只让这一次失败：队列继续，后面的写入照常执行并沿用未变化的 revision', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(5)))
    await store.fetchDocument(7)

    api.update.mockResolvedValueOnce(ok(doc(6)))
    const failed = store.runDocumentWrite(7, async () => { throw new Error('快照保存失败') })
    const next = store.updateDocument(7, { title: '后面的写入' })

    await expect(failed).rejects.toThrow('快照保存失败')
    await expect(next).resolves.toMatchObject({ revision: 6 })
    expect(api.update).toHaveBeenCalledTimes(1)
    expect(api.update).toHaveBeenCalledWith(7, { title: '后面的写入', baseRevision: 5 })
    await store.waitForPendingUpdates(7)
    expect(store.hasPendingUpdates(7)).toBe(false)
  })

  it('与 updateDocument 交错：按发起顺序执行，每次都用上一次响应的 revision，且不会死锁', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(0)))
    await store.fetchDocument(7)

    // 按发生顺序记录：task 开始、每个 PUT 发出时的 title 与 baseRevision
    const events: string[] = []
    const firstPut = deferred<ReturnType<typeof ok>>()
    let serverRevision = 0
    api.update.mockImplementation(((_id: number, body: { title: string; baseRevision: number }) => {
      events.push(`PUT ${body.title}@${body.baseRevision}`)
      if (body.title === 'A') return firstPut.promise
      serverRevision += 1
      return Promise.resolve(ok(doc(serverRevision)))
    }) as never)

    const a = store.updateDocument(7, { title: 'A' })
    const task = store.runDocumentWrite(7, async (put) => {
      events.push('task 开始')
      const saved = await put({ title: 'task' })
      events.push(`task 结束 revision=${saved.revision}`)
      return saved.revision
    })
    const b = store.updateDocument(7, { title: 'B' })
    await drain()
    // A 的请求未返回前，task 与 B 都不开始
    expect(events).toEqual(['PUT A@0'])

    serverRevision = 1
    firstPut.resolve(ok(doc(1)))
    await expect(Promise.all([a, task, b])).resolves.toEqual([expect.objectContaining({ revision: 1 }), 2, expect.objectContaining({ revision: 3 })])

    expect(events).toEqual(['PUT A@0', 'task 开始', 'PUT task@1', 'task 结束 revision=2', 'PUT B@2'])
    expect(store.currentDocument?.revision).toBe(3)
  })

  it('task 里的 put 不再排队：后面已有排队的写入时 put 也立即发出，task 内多次 put 的 revision 依次推进', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(0)))
    await store.fetchDocument(7)
    api.update
      .mockResolvedValueOnce(ok(doc(1)))
      .mockResolvedValueOnce(ok(doc(2)))
      .mockResolvedValueOnce(ok(doc(3)))

    const gate = deferred<void>()
    const task = store.runDocumentWrite(7, async (put) => {
      await gate.promise
      await put({ title: 'x1' })
      await put({ title: 'x2' })
    })
    const queued = store.updateDocument(7, { title: '排在 task 后面' })
    gate.resolve()
    await Promise.all([task, queued])

    expect(api.update.mock.calls.map(([, payload]) => [payload.title, payload.baseRevision])).toEqual([
      ['x1', 0],
      ['x2', 1],
      ['排在 task 后面', 2],
    ])
  })

  it('task 结束后 put 失效，不能绕过队列写文档', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(0)))
    await store.fetchDocument(7)

    let leaked: ((doc: { title: string }) => Promise<unknown>) | undefined
    await store.runDocumentWrite(7, async (put) => { leaked = put })
    await expect(leaked!({ title: '迟到的写入' })).rejects.toThrow('已结束')
    expect(api.update).not.toHaveBeenCalled()
  })

  it('不同文档的写入互不排队', async () => {
    const store = useDocumentStore()
    api.get.mockResolvedValueOnce(ok(doc(0)))
    await store.fetchDocument(7)

    const gate = deferred<void>()
    const slow = store.runDocumentWrite(8, async () => { await gate.promise })
    api.update.mockResolvedValueOnce(ok(doc(1)))
    await store.updateDocument(7, { title: '另一份文档' })
    expect(store.hasPendingUpdates(8)).toBe(true)
    expect(store.hasPendingUpdates(7)).toBe(false)
    await store.waitForPendingUpdates(7)
    gate.resolve()
    await slow
  })
})

describe('isRevisionConflict', () => {
  it('只识别 HTTP 409', () => {
    expect(isRevisionConflict(conflictError(1))).toBe(true)
    expect(isRevisionConflict({ response: { status: 428 } })).toBe(false)
    expect(isRevisionConflict({ response: { status: 500 } })).toBe(false)
    expect(isRevisionConflict(new Error('network unavailable'))).toBe(false)
    expect(isRevisionConflict(undefined)).toBe(false)
    expect(isRevisionConflict(null)).toBe(false)
  })
})
