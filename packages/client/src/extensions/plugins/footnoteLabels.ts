import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

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
      props: {
        decorations(state) {
          const labels = resolve(pmToIr(state.doc.toJSON()).doc).labels
          const decorations: Decoration[] = []
          const titles = new Set(['chapterTitle', 'clauseTitle', 'termName', 'tableCaption', 'figureCaption', 'appendixLabel'])
          state.doc.descendants((node, pos, parent) => {
            // 示例（含 WP8.M G7-b 的块内容示例 exampleBlock）的「示例：/示例N：」标签挂在节点自身；其余标题挂在父节点上。
            const owner = titles.has(node.type.name) ? parent : (node.type.name === 'example' || node.type.name === 'exampleBlock') ? node : null
            if (owner) decorations.push(Decoration.node(pos, pos + node.nodeSize, {
              'data-resolved-label': labels[owner.attrs.nodeId || '']?.label ?? '?',
            }))
          })
          return DecorationSet.create(state.doc, decorations)
        },
      },
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
