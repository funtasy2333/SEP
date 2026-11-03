import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

function safeImageSource(value: unknown): string | null {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/.test(value)) return null
  if (/^(https?:|blob:|data:image\/)/i.test(value)) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null
  return value
}

function previews(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    const graphics = node.type.name === 'figure' && Array.isArray(node.attrs.additionalGraphics)
      ? node.attrs.additionalGraphics : node.type.name === 'stdTable' && node.attrs.alternativeGraphic ? [node.attrs.alternativeGraphic] : []
    if (!graphics.length) return
    const insertAt = node.type.name === 'figure' && node.firstChild ? pos + 1 + node.firstChild.nodeSize : pos + node.nodeSize - 1
    graphics.forEach((graphic: unknown, index: number) => {
      if (!graphic || typeof graphic !== 'object' || Array.isArray(graphic)) return
      const value = graphic as Record<string, unknown>
      const src = safeImageSource(value.src)
      if (!src || typeof value.nodeId !== 'string') return
      decorations.push(Decoration.widget(insertAt, () => {
        const image = document.createElement('img')
        image.src = src
        image.dataset.graphicId = value.nodeId as string
        image.alt = node.type.name === 'figure' ? '附加图' : '表替代图'
        image.className = 'std-graphic-preview'
        image.contentEditable = 'false'
        return image
      }, { key: `${node.type.name}:${value.nodeId}:${index}:${src}`, side: 1 }))
    })
  })
  return DecorationSet.create(doc, decorations)
}

export const GraphicPreviews = Extension.create({
  name: 'graphicPreviews',
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey('graphicPreviews'), props: { decorations: state => previews(state.doc) } })]
  },
})
