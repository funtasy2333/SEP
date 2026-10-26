// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ValidationWorkerRequest, ValidationWorkerResponse, ValidationWorkerSuccess } from './analysis.worker'
import { startWorkerAnalysis, ValidationCancelledError, type ValidationWorkerPort } from './analysis'

class WorkerDouble implements ValidationWorkerPort {
  onmessage: ((event: MessageEvent<ValidationWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn<(request: ValidationWorkerRequest) => void>()
  terminate = vi.fn()

  reply(data: ValidationWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<ValidationWorkerResponse>)
  }

  fail(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }

  failMessage() {
    this.onmessageerror?.({} as MessageEvent)
  }
}

const request: ValidationWorkerRequest = {
  type: 'analyze', runId: 4, documentId: 27, generation: 8,
  pmJson: { type: 'doc', content: [] },
  documentMeta: { titleCn: '测试', standardType: 'national' },
}

function result(): ValidationWorkerSuccess {
  return {
    type: 'result', runId: 4, documentId: 27, generation: 8,
    report: {
      profile: 'ses-phase6-manual-v2', rulesVersion: '2026-10-22',
      issues: [], summary: { total: 0, error: 0, warning: 0, suggestion: 0 },
      coverage: {} as ValidationWorkerSuccess['report']['coverage'],
    },
    effectiveMeta: {},
    conversion: { warnings: [], unsupported: [] },
  }
}

describe('validation worker client', () => {
  it('ignores a reply for a different document generation and accepts only its own run', async () => {
    const worker = new WorkerDouble()
    const task = startWorkerAnalysis(request, () => worker)
    expect(worker.postMessage).toHaveBeenCalledWith(request)

    let settled = false
    void task.promise.then(() => { settled = true })
    worker.reply({ ...result(), generation: 7 })
    await Promise.resolve()
    expect(settled).toBe(false)

    worker.reply(result())
    await expect(task.promise).resolves.toMatchObject({ runId: 4, generation: 8 })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it.each(['worker error', 'message deserialization error'] as const)('rejects and terminates on %s', async kind => {
    const worker = new WorkerDouble()
    const task = startWorkerAnalysis(request, () => worker)
    if (kind === 'worker error') worker.fail('analysis crashed')
    else worker.failMessage()

    await expect(task.promise).rejects.toThrow(kind === 'worker error' ? 'analysis crashed' : '无法读取检查结果')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects pending analysis when its owner cancels the worker', async () => {
    const worker = new WorkerDouble()
    const task = startWorkerAnalysis(request, () => worker)
    task.cancel()

    await expect(task.promise).rejects.toBeInstanceOf(ValidationCancelledError)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})
