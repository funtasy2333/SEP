// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue'
import type { DocumentMeta } from '@ses/shared'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { createEditorSchema, normalizeNodeIds } from '../extensions/editorSchema'
import { createDocumentValidationExtension, documentValidationPluginKey } from '../extensions/plugins/documentValidation'
import { installRemoteDocument, replaceEditorDocument } from '../utils/editorDocument'
import { processAnalysisRequest, type ValidationWorkerRequest, type ValidationWorkerResponse } from '../validation/analysis.worker'
import { phase6Fixture } from '../validation/__fixtures__/phase6'
import { useDocumentValidation, type DocumentValidationController } from './useDocumentValidation'

class WorkerDouble {
  request: ValidationWorkerRequest | null = null
  onmessage: ((event: MessageEvent<ValidationWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  postMessage(request: ValidationWorkerRequest) { this.request = request }
  terminate = vi.fn()
  fail(message: string) { this.onerror?.({ message } as ErrorEvent) }

  reply() {
    if (!this.request) throw new Error('No snapshot was posted')
    this.onmessage?.({ data: processAnalysisRequest(this.request) } as MessageEvent<ValidationWorkerResponse>)
  }
}

const editors: Editor[] = []
const scopes: EffectScope[] = []
const hosts: HTMLElement[] = []

function fixtureWithMissingIntroduction() {
  const fixture = phase6Fixture()
  const requirements = fixture.content!.find(node => node.attrs?.nodeId === 'requirements')!
  requirements.content = requirements.content!.filter(node => node.attrs?.nodeId !== 'objects-lead')
  return fixture
}

function nodePosition(editor: Editor, nodeId: string) {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.attrs.nodeId === nodeId) from = pos
  })
  if (from < 0) throw new Error(`Missing PM node ${nodeId}`)
  return from
}

function setup(options: { ready?: boolean; id?: number; meta?: Partial<DocumentMeta>; normalizeIds?: boolean } = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  const onUpdate = vi.fn()
  const rawContent = fixtureWithMissingIntroduction()
  const content = options.normalizeIds === false
    ? rawContent
    : normalizeNodeIds(createEditorSchema().nodeFromJSON(rawContent)).toJSON()
  const editor = new Editor({
    element: host,
    extensions: [...createEditorExtensions(), createDocumentValidationExtension()],
    content,
    onUpdate,
  })
  if (options.normalizeIds !== false) replaceEditorDocument(editor, editor.getJSON(), false, false)
  editors.push(editor)
  onUpdate.mockClear()
  const editorRef = shallowRef<Editor | null>(editor)
  const documentId = ref(options.id ?? 7)
  const documentMeta = ref<DocumentMeta>({
    standardType: 'national', titleCn: '检查标准', standardNo: 'GB/T 1.1—2020', ...options.meta,
  })
  const contentReady = ref(options.ready ?? true)
  const unavailable = ref(false)
  const workers: WorkerDouble[] = []
  const workerFactory = () => {
    const worker = new WorkerDouble()
    workers.push(worker)
    return worker
  }
  const scope = effectScope()
  scopes.push(scope)
  let validation!: DocumentValidationController
  scope.run(() => {
    validation = useDocumentValidation({
      editor: editorRef,
      documentId,
      documentMeta: () => documentMeta.value,
      contentReady,
      documentUnavailable: unavailable,
      workerFactory,
    })
  })
  return { editor, onUpdate, documentId, documentMeta, contentReady, unavailable, workers, validation, scope }
}

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  for (const editor of editors.splice(0)) editor.destroy()
  for (const host of hosts.splice(0)) host.remove()
})

async function completeManualRun(validation: DocumentValidationController, workers: WorkerDouble[]) {
  const pending = validation.run()
  await nextTick()
  expect(workers).toHaveLength(1)
  workers[0]!.reply()
  await expect(pending).resolves.toBe('current')
}

describe('useDocumentValidation manual lifecycle', () => {
  it('does not run on setup, edits, or selection changes; one click analyzes the actual snapshot without editing it', async () => {
    const { editor, onUpdate, workers, validation } = setup()
    expect(validation.state.value).toBe('not-run')
    expect(workers).toHaveLength(0)

    editor.commands.insertContentAt(nodePosition(editor, 'scope-p') + 1, '改动')
    editor.commands.setTextSelection(nodePosition(editor, 'scope-p') + 2)
    expect(workers).toHaveLength(0)

    const jsonBefore = editor.getJSON()
    const updateCount = onUpdate.mock.calls.length
    const undoBefore = editor.can().undo()
    const pending = validation.run()
    await nextTick()
    expect(validation.state.value).toBe('running')
    expect(workers[0]?.request?.pmJson).toEqual(editor.state.doc.toJSON())
    expect(workers[0]?.request?.documentMeta?.titleCn).toBe('检查标准')
    workers[0]!.reply()
    await expect(pending).resolves.toBe('current')

    expect(validation.state.value).toBe('current')
    expect(editor.getJSON()).toEqual(jsonBefore)
    expect(onUpdate).toHaveBeenCalledTimes(updateCount)
    expect(editor.can().undo()).toBe(undoBefore)
    expect(documentValidationPluginKey.getState(editor.state)?.find().length).toBeGreaterThan(0)
  })

  it('turns a current report stale on document edits and never starts another worker automatically', async () => {
    const { editor, workers, validation } = setup()
    await completeManualRun(validation, workers)
    const report = validation.report.value

    editor.commands.insertContentAt(nodePosition(editor, 'scope-p') + 1, '正文修改')

    expect(validation.state.value).toBe('stale')
    expect(validation.report.value).toBe(report)
    expect(documentValidationPluginKey.getState(editor.state)?.find()).toEqual([])
    expect(workers).toHaveLength(1)
    expect(validation.locate(report!.issues[0]!.id)).toBe(false)
  })

  it('clears current markers and suspends jump targets while a manual recheck is running', async () => {
    const { editor, workers, validation } = setup()
    await completeManualRun(validation, workers)
    const oldReport = validation.report.value
    expect(documentValidationPluginKey.getState(editor.state)?.find().length).toBeGreaterThan(0)

    const pending = validation.run()
    await nextTick()

    expect(validation.state.value).toBe('running')
    expect(validation.report.value).toBe(oldReport)
    expect(validation.anchors.value).toEqual([])
    expect(documentValidationPluginKey.getState(editor.state)?.find()).toEqual([])
    await expect(validation.run()).resolves.toBe('running')
    expect(workers).toHaveLength(2)

    workers[1]!.reply()
    await expect(pending).resolves.toBe('current')
    expect(documentValidationPluginKey.getState(editor.state)?.find().length).toBeGreaterThan(0)
  })

  it('locates a live PM anchor through a selection-only transaction without changing the document or undo history', async () => {
    const { editor, onUpdate, workers, validation } = setup()
    await completeManualRun(validation, workers)
    const anchor = validation.anchors.value.find(item => item.status === 'located')!
    const jsonBefore = editor.getJSON()
    const canUndoBefore = editor.can().undo()
    const updatesBefore = onUpdate.mock.calls.length
    expect(validation.locate(anchor.issueId)).toBe(true)

    expect(editor.getJSON()).toEqual(jsonBefore)
    expect(editor.can().undo()).toBe(canUndoBefore)
    expect(onUpdate).toHaveBeenCalledTimes(updatesBefore)
  })

  it('discards a report if a plugin appends a document-changing transaction while markers are applied', async () => {
    const { editor, workers, validation } = setup({ normalizeIds: false })
    const pending = validation.run()
    await nextTick()
    workers[0]!.reply()

    await expect(pending).resolves.toBe('stale')
    expect(validation.state.value).toBe('stale')
    expect(validation.report.value).not.toBeNull()
    expect(documentValidationPluginKey.getState(editor.state)?.find()).toEqual([])
    expect(workers).toHaveLength(1)
  })

  it('shows an actual Worker failure as failed and exposes its error instead of a passing report', async () => {
    const { workers, validation } = setup()
    const pending = validation.run()
    await nextTick()
    workers[0]!.fail('worker crashed')

    await expect(pending).resolves.toBe('failed')
    expect(validation.state.value).toBe('failed')
    expect(validation.error.value).toBe('worker crashed')
    expect(validation.report.value).toBeNull()
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight worker on a suppressed remote replacement and discards its reply', async () => {
    const { editor, onUpdate, workers, validation } = setup()
    const pending = validation.run()
    await nextTick()
    const remote = editor.getJSON() as Record<string, unknown>
    installRemoteDocument(editor, remote)

    expect(onUpdate).not.toHaveBeenCalled()
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1)
    await expect(pending).resolves.toBe('stale')
    expect(validation.state.value).toBe('stale')
    expect(workers).toHaveLength(1)
  })

  it('keeps a report current after selection changes and marks it stale when effective metadata changes', async () => {
    const { editor, documentMeta, workers, validation } = setup()
    await completeManualRun(validation, workers)
    editor.commands.setTextSelection(nodePosition(editor, 'scope-p') + 2)
    expect(validation.state.value).toBe('current')

    documentMeta.value = { ...documentMeta.value, titleCn: '新的已生效标题' }
    await nextTick()
    expect(validation.state.value).toBe('stale')
    expect(workers).toHaveLength(1)
  })

  it('refuses a click during IME composition without queuing work until compositionend', async () => {
    const { editor, workers, validation } = setup()
    editor.view.dom.dispatchEvent(new Event('compositionstart'))
    await expect(validation.run()).resolves.toBe('composing')
    editor.view.dom.dispatchEvent(new Event('compositionend'))
    await nextTick()

    expect(validation.state.value).toBe('not-run')
    expect(workers).toHaveLength(0)
  })

  it('clears report on document switch and cancels work when the document becomes unavailable', async () => {
    const { documentId, unavailable, workers, validation } = setup()
    await completeManualRun(validation, workers)
    documentId.value = 8
    await nextTick()
    expect(validation.state.value).toBe('not-run')
    expect(validation.report.value).toBeNull()

    const pending = validation.run()
    await nextTick()
    unavailable.value = true
    await nextTick()
    await expect(pending).resolves.toBe('stale')
    expect(workers[1]!.terminate).toHaveBeenCalledTimes(1)
    await expect(validation.run()).resolves.toBe('unavailable')
  })

  it('terminates a pending worker when the composable owner unmounts', async () => {
    const { workers, validation, scope } = setup()
    const pending = validation.run()
    await nextTick()
    scope.stop()

    await expect(pending).resolves.toBe('stale')
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1)
  })
})
