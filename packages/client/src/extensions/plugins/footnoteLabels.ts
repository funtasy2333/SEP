import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import type { EditorView } from '@tiptap/pm/view'

function refreshFootnoteLabels(view: EditorView) {
  try {
    const pm = view.state.doc.toJSON() as PMJsonNode
    const { doc } = pmToIr(pm)
    const labels = resolve(doc).labels

    view.dom.querySelectorAll<HTMLElement>('[data-node-id].std-note-editor').forEach((element) => {
      const id = element.dataset.nodeId || ''
      const label = labels[id]?.label || '注：'
      const target = element.querySelector<HTMLElement>('.std-note-marker')
      if (target && target.textContent !== label) target.textContent = label
    })

    view.dom.querySelectorAll<HTMLElement>('[data-node-id].std-footnote-ref').forEach((element) => {
      const id = element.dataset.nodeId || ''
      const label = labels[id]?.label || '?'
      const target = element.querySelector<HTMLElement>('.std-footnote-label')
      if (target && target.textContent !== label) target.textContent = label
    })

    view.dom.querySelectorAll<HTMLElement>('[data-target-id].std-table-footnote-ref').forEach((element) => {
      const targetId = element.dataset.targetId || ''
      const label = labels[targetId]?.label || '?'
      const target = element.querySelector<HTMLElement>('.std-table-footnote-label')
      if (target && target.textContent !== label) target.textContent = label
    })

    view.dom.querySelectorAll<HTMLElement>('[data-node-id].std-table-footnote-entry').forEach((element) => {
      const id = element.dataset.nodeId || ''
      const label = labels[id]?.label || '?'
      const target = element.querySelector<HTMLElement>('[data-table-footnote-label]')
      if (target && target.textContent !== label) target.textContent = label
    })
  } catch {
    // Keep labels visibly unresolved when the document cannot be converted; export validation
    // reports the underlying IR problem with its full message.
    view.dom.querySelectorAll<HTMLElement>('.std-note-marker, .std-footnote-label, .std-table-footnote-label, [data-table-footnote-label]')
      .forEach((element) => { element.textContent = '?' })
  }
}

/** Editor-only label projection; numbering is shared with export through the IR resolver. */
export const FootnoteLabels = Extension.create({
  name: 'footnoteLabels',

  addProseMirrorPlugins() {
    return [new Plugin({
      view(view) {
        refreshFootnoteLabels(view)
        return {
          update(updatedView) {
            refreshFootnoteLabels(updatedView)
          },
        }
      },
    })]
  },
})
