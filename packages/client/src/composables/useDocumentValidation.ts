import { computed, nextTick, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { Selection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { DocumentMeta, PMJsonNode, ValidationReport } from '@ses/shared'
import { dispatchDocumentValidationDecorations } from '../extensions/plugins/documentValidation'
import { resolveValidationIssueAnchors, type ValidationIssueAnchor } from '../validation/anchors'
import {
  startWorkerAnalysis,
  ValidationCancelledError,
  type ValidationWorkerFactory,
} from '../validation/analysis'
import type { ValidationWorkerSuccess } from '../validation/analysis.worker'

export type DocumentValidationState = 'not-run' | 'running' | 'current' | 'stale' | 'failed'
export type ValidationRunOutcome = DocumentValidationState | 'composing' | 'not-ready' | 'unavailable'

export interface UseDocumentValidationOptions {
  editor: Ref<Editor | null | undefined>
  documentId: Ref<number>
  documentMeta: () => DocumentMeta | undefined
  contentReady: Ref<boolean>
  documentUnavailable: Ref<boolean>
  workerFactory?: ValidationWorkerFactory
}

export interface DocumentValidationController {
  state: Ref<DocumentValidationState>
  report: Readonly<Ref<ValidationReport | null>>
  conversion: Readonly<Ref<ValidationWorkerSuccess['conversion']>>
  effectiveMeta: Readonly<Ref<ValidationWorkerSuccess['effectiveMeta'] | null>>
  anchors: Readonly<Ref<ValidationIssueAnchor[]>>
  error: Readonly<Ref<string>>
  run: () => Promise<ValidationRunOutcome>
  locate: (issueId: string) => boolean
  anchorFor: (issueId: string) => ValidationIssueAnchor | undefined
}

function metadataSignature(meta: DocumentMeta | undefined): string {
  if (!meta) return 'null'
  return JSON.stringify(Object.keys(meta).sort().map(key => [key, meta[key as keyof DocumentMeta]]))
}

export function useDocumentValidation(options: UseDocumentValidationOptions): DocumentValidationController {
  const state = ref<DocumentValidationState>('not-run')
  const result = shallowRef<ValidationWorkerSuccess | null>(null)
  const report = computed(() => result.value?.report ?? null)
  const conversion = computed(() => result.value?.conversion ?? { warnings: [], unsupported: [] })
  const effectiveMeta = computed(() => result.value?.effectiveMeta ?? null)
  const anchors = shallowRef<ValidationIssueAnchor[]>([])
  const error = ref('')

  let documentGeneration = 0
  let nextRunId = 0
  let activeTask: { runId: number; cancel: () => void } | null = null
  let currentSnapshot: { editor: Editor; doc: Editor['state']['doc']; documentId: number; generation: number } | null = null
  let composing = false
  let compositionDom: HTMLElement | null = null

  function clearDecorations(editor = options.editor.value) {
    if (!editor || editor.isDestroyed) return
    dispatchDocumentValidationDecorations(editor.view, [])
  }

  function cancelPending() {
    const pending = activeTask
    activeTask = null
    pending?.cancel()
  }

  function invalidate(clearPluginState: boolean, preserveReport = true) {
    documentGeneration += 1
    cancelPending()
    anchors.value = []
    currentSnapshot = null
    if (clearPluginState) clearDecorations()
    if (result.value && preserveReport) state.value = 'stale'
    else if (state.value === 'running' || state.value === 'current') state.value = 'stale'
    else if (state.value === 'failed') state.value = result.value ? 'stale' : 'not-run'
    error.value = ''
  }

  function resetForDocumentChange() {
    invalidate(true, false)
    result.value = null
    state.value = 'not-run'
    error.value = ''
  }

  function onEditorTransaction({ transaction, appendedTransactions = [] }: {
    transaction: { docChanged: boolean }
    appendedTransactions?: readonly { docChanged: boolean }[]
  }) {
    if (transaction.docChanged || appendedTransactions.some(appended => appended.docChanged)) invalidate(false)
  }

  function detachCompositionEvents() {
    if (!compositionDom) return
    compositionDom.removeEventListener('compositionstart', handleCompositionStart)
    compositionDom.removeEventListener('compositionend', handleCompositionEnd)
    compositionDom = null
    composing = false
  }

  function handleCompositionStart() { composing = true }
  function handleCompositionEnd() { composing = false }

  function attachCompositionEvents(editor: Editor | null | undefined) {
    detachCompositionEvents()
    if (!editor || editor.isDestroyed) return
    compositionDom = editor.view.dom
    compositionDom.addEventListener('compositionstart', handleCompositionStart)
    compositionDom.addEventListener('compositionend', handleCompositionEnd)
  }

  const editorTransactionHandler = (payload: { transaction: { docChanged: boolean } }) => onEditorTransaction(payload)
  watch(options.editor, (editor, previous) => {
    previous?.off('transaction', editorTransactionHandler)
    if (editor && !editor.isDestroyed) editor.on('transaction', editorTransactionHandler)
    attachCompositionEvents(editor)
  }, { immediate: true, flush: 'sync' })

  watch(options.documentId, (documentId, previous) => {
    if (documentId !== previous) resetForDocumentChange()
  }, { flush: 'sync' })

  watch(() => metadataSignature(options.documentMeta()), (next, previous) => {
    if (previous !== undefined && next !== previous) invalidate(true)
  }, { flush: 'sync' })

  watch([options.contentReady, options.documentUnavailable], ([ready, unavailable]) => {
    if (!ready || unavailable) invalidate(true)
  }, { flush: 'sync' })

  function isSnapshotCurrent(snapshot: { editor: Editor; doc: Editor['state']['doc']; documentId: number; generation: number }): boolean {
    return !snapshot.editor.isDestroyed
      && options.editor.value === snapshot.editor
      && snapshot.editor.state.doc === snapshot.doc
      && options.documentId.value === snapshot.documentId
      && documentGeneration === snapshot.generation
      && options.contentReady.value
      && !options.documentUnavailable.value
  }

  async function run(): Promise<ValidationRunOutcome> {
    if (state.value === 'running') return 'running'
    if (composing) return 'composing'
    if (options.documentUnavailable.value) return 'unavailable'
    if (!options.contentReady.value) return 'not-ready'
    const editor = options.editor.value
    if (!editor || editor.isDestroyed) return 'not-ready'

    const documentId = options.documentId.value
    const doc = editor.state.doc
    const generation = documentGeneration
    const runId = ++nextRunId
    const snapshot = { editor, doc, documentId, generation }
    let pmJson: PMJsonNode
    try {
      // toJSON shares attr values by reference; docs loaded from the store can carry Vue proxies there,
      // which Worker.postMessage cannot structured-clone. A JSON round-trip yields plain data.
      pmJson = JSON.parse(JSON.stringify(doc.toJSON())) as PMJsonNode
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      state.value = 'failed'
      return 'failed'
    }
    const rawMeta = options.documentMeta()
    const documentMeta = rawMeta ? { ...rawMeta } : undefined
    state.value = 'running'
    error.value = ''
    if (anchors.value.length > 0) clearDecorations(editor)
    anchors.value = []
    currentSnapshot = null
    await nextTick()
    if (!isSnapshotCurrent(snapshot)) {
      if (state.value === 'running') state.value = 'stale'
      return 'stale'
    }

    const task = startWorkerAnalysis({
      type: 'analyze', runId, documentId, generation, pmJson, documentMeta,
    }, options.workerFactory)
    activeTask = { runId, cancel: task.cancel }
    try {
      const response = await task.promise
      if (!isSnapshotCurrent(snapshot)
        || response.runId !== runId
        || response.documentId !== documentId
        || response.generation !== generation) {
        if (state.value === 'running') state.value = 'stale'
        return 'stale'
      }
      const resolvedAnchors = resolveValidationIssueAnchors(editor.state.doc, response.report.issues)
      result.value = response
      anchors.value = resolvedAnchors
      currentSnapshot = snapshot
      state.value = 'current'
      dispatchDocumentValidationDecorations(editor.view, resolvedAnchors)
      if (!isSnapshotCurrent(snapshot)) {
        if (state.value === 'current') {
          state.value = 'stale'
          anchors.value = []
          clearDecorations(editor)
        }
        return 'stale'
      }
      return 'current'
    } catch (cause) {
      if (cause instanceof ValidationCancelledError) return 'stale'
      if (activeTask?.runId === runId || state.value === 'running') {
        error.value = cause instanceof Error ? cause.message : String(cause)
        state.value = 'failed'
        currentSnapshot = null
        anchors.value = []
        clearDecorations(editor)
      }
      return state.value === 'stale' ? 'stale' : 'failed'
    } finally {
      if (activeTask?.runId === runId) activeTask = null
    }
  }

  function anchorFor(issueId: string): ValidationIssueAnchor | undefined {
    return anchors.value.find(anchor => anchor.issueId === issueId)
  }

  function locate(issueId: string): boolean {
    const snapshot = currentSnapshot
    const anchor = anchorFor(issueId)
    if (state.value !== 'current' || !snapshot || !anchor || anchor.status !== 'located'
      || anchor.from === undefined || anchor.to === undefined || !isSnapshotCurrent(snapshot)) return false
    const editor = snapshot.editor
    const node = editor.state.doc.nodeAt(anchor.from)
    if (!node || node.nodeSize !== anchor.to - anchor.from || node.attrs.nodeId !== anchor.nodeId) {
      invalidate(true)
      return false
    }
    const position = Math.min(anchor.from + 1, editor.state.doc.content.size)
    const selection = Selection.near(editor.state.doc.resolve(position), 1)
    editor.view.dispatch(editor.state.tr.setSelection(selection).setMeta('addToHistory', false).scrollIntoView())
    editor.view.focus()
    return true
  }

  onScopeDispose(() => {
    cancelPending()
    options.editor.value?.off('transaction', editorTransactionHandler)
    detachCompositionEvents()
    anchors.value = []
    currentSnapshot = null
  })

  return { state, report, conversion, effectiveMeta, anchors, error, run, locate, anchorFor }
}
