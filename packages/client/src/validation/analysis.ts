import type { ValidationWorkerRequest, ValidationWorkerResponse, ValidationWorkerSuccess } from './analysis.worker'

export interface ValidationWorkerPort {
  onmessage: ((event: MessageEvent<ValidationWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: ValidationWorkerRequest): void
  terminate(): void
}

export type ValidationWorkerFactory = () => ValidationWorkerPort

export class ValidationCancelledError extends Error {
  constructor() {
    super('文档已变化，已丢弃过期检查结果')
    this.name = 'ValidationCancelledError'
  }
}

function createModuleWorker(): ValidationWorkerPort {
  if (typeof Worker === 'undefined') throw new Error('当前环境不支持 Web Worker，无法运行文档检查')
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
}

/** One real module worker per manual run, with an explicit cancellation handle. */
export function startWorkerAnalysis(
  request: ValidationWorkerRequest,
  workerFactory: ValidationWorkerFactory = createModuleWorker,
): { promise: Promise<ValidationWorkerSuccess>; cancel: () => void } {
  let worker: ValidationWorkerPort | null = null
  let settled = false
  let resolveTask!: (response: ValidationWorkerSuccess) => void
  let rejectTask!: (error: Error) => void
  const promise = new Promise<ValidationWorkerSuccess>((resolve, reject) => {
    resolveTask = resolve
    rejectTask = reject
  })

  const cleanup = () => {
    if (!worker) return
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    worker = null
  }
  const rejectOnce = (error: Error) => {
    if (settled) return
    settled = true
    cleanup()
    rejectTask(error)
  }
  const resolveOnce = (response: ValidationWorkerSuccess) => {
    if (settled) return
    settled = true
    cleanup()
    resolveTask(response)
  }

  try {
    worker = workerFactory()
    worker.onmessage = (event) => {
      const response: ValidationWorkerResponse = event.data
      if (response.runId !== request.runId
        || response.documentId !== request.documentId
        || response.generation !== request.generation) return
      if (response.type === 'error') rejectOnce(new Error(response.message || '文档检查失败'))
      else resolveOnce(response)
    }
    worker.onerror = (event) => rejectOnce(new Error(event.message || '文档检查 Worker 运行失败'))
    worker.onmessageerror = () => rejectOnce(new Error('无法读取检查结果（Worker 消息无法反序列化）'))
    worker.postMessage(request)
  } catch (error) {
    rejectOnce(error instanceof Error ? error : new Error(String(error)))
  }

  return {
    promise,
    cancel: () => rejectOnce(new ValidationCancelledError()),
  }
}
