import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { figurePageWidthPx } from '../../utils/figureSize'

function decorations(doc: PMNode) {
  const result: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'figureImage') {
      const pageWidth = figurePageWidthPx(doc, pos)
      // Changing the outer decoration updates the view even when the image node is reused.
      result.push(Decoration.node(pos, pos + node.nodeSize,
        { 'data-figure-page-width': String(pageWidth) }, { figurePageWidth: pageWidth }))
      return false
    }
    if (!['tableCell', 'tableHeader'].includes(node.type.name)) return true
    if (node.childCount !== 1 || !node.firstChild?.isTextblock) return true
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
export const ImageLayout = Extension.create({
  name: 'imageLayout',
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('imageLayout')
    return [new Plugin({
      key,
      state: { init: (_config, state) => decorations(state.doc), apply: (tr, previous) => tr.docChanged ? decorations(tr.doc) : previous },
      props: { decorations: state => key.getState(state) ?? null },
    })]
  },
})
