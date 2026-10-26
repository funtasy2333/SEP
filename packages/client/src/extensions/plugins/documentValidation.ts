import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { ValidationIssueAnchor } from '../../validation/anchors'

export const documentValidationPluginKey = new PluginKey<DecorationSet>('documentValidation')

function createDecorations(doc: Parameters<typeof DecorationSet.create>[0], anchors: readonly ValidationIssueAnchor[]): DecorationSet {
  const groups = new Map<string, { from: number; to: number; issueIds: string[]; severities: Set<string> }>()
  for (const anchor of anchors) {
    if (anchor.status !== 'located' || !Number.isInteger(anchor.from) || !Number.isInteger(anchor.to)) continue
    const from = anchor.from!
    const to = anchor.to!
    const node = doc.nodeAt(from)
    if (!node || node.nodeSize !== to - from || node.attrs.nodeId !== anchor.nodeId) continue
    const key = `${from}:${to}`
    const group = groups.get(key) ?? { from, to, issueIds: [], severities: new Set<string>() }
    group.issueIds.push(anchor.issueId)
    group.severities.add(anchor.severity)
    groups.set(key, group)
  }

  const rank = { error: 0, warning: 1, suggestion: 2 }
  const decorations = [...groups.values()].map((group) => {
    const severity = [...group.severities].sort((left, right) => rank[left as keyof typeof rank] - rank[right as keyof typeof rank])[0]!
    const issueIds = [...new Set(group.issueIds)]
    return Decoration.node(group.from, group.to, {
      class: `ses-validation-mark ses-validation-${severity}`,
      'data-validation-severity': severity,
      'data-validation-issue-ids': issueIds.join(' '),
      'data-validation-count': String(issueIds.length),
    })
  })
  return DecorationSet.create(doc, decorations)
}

export function createDocumentValidationPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: documentValidationPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, current) {
        if (transaction.docChanged) return DecorationSet.empty
        const anchors = transaction.getMeta(documentValidationPluginKey) as readonly ValidationIssueAnchor[] | undefined
        return anchors === undefined ? current : createDecorations(transaction.doc, anchors)
      },
    },
    props: {
      decorations(state) {
        return documentValidationPluginKey.getState(state) ?? DecorationSet.empty
      },
    },
  })
}

export function dispatchDocumentValidationDecorations(view: EditorView, anchors: readonly ValidationIssueAnchor[]): void {
  view.dispatch(view.state.tr
    .setMeta(documentValidationPluginKey, anchors)
    .setMeta('addToHistory', false))
}

/** EditorView-only extension; keep this out of createEditorExtensions() used by server schema. */
export function createDocumentValidationExtension(): Extension {
  return Extension.create({
    name: 'documentValidation',
    addProseMirrorPlugins() {
      return [createDocumentValidationPlugin()]
    },
  })
}
