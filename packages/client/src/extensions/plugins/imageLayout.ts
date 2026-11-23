import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

function decorations(doc: PMNode) {
  const result: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!['tableCell', 'tableHeader'].includes(node.type.name)) return true
    if (node.childCount !== 1 || !node.firstChild?.isTextblock) return false
    let images = 0, other = false
    node.firstChild.forEach(child => {
      if (child.type.name === 'inlineImage') images++
      else if (!child.isText || child.text?.trim()) other = true
    })
    if (images === 1 && !other) result.push(Decoration.node(pos, pos + node.nodeSize, { class: 'ses-image-only-cell' }))
    return false
  })
  return DecorationSet.create(doc, result)
}
export const ImageCellLayout = Extension.create({
  name: 'imageCellLayout',
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('imageCellLayout')
    return [new Plugin({
      key,
      state: { init: (_config, state) => decorations(state.doc), apply: (tr, previous) => tr.docChanged ? decorations(tr.doc) : previous },
      props: { decorations: state => key.getState(state) ?? null },
    })]
  },
})
