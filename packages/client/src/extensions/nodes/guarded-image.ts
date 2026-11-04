import { mergeAttributes } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { guardImageAttributes, readImageSrc, readImageTitle } from '../../utils/imageSource'

/**
 * Tiptap 通用 Image：外部图片在编辑器里显示占位图（见 utils/imageSource.ts）。
 * 占位元素的 src 是占位图的 data URL，而通用规则 `img[src]:not([src^="data:"])` 不会匹配 data URL，
 * 所以补一条按 data-external-src 匹配的规则，并让 src / title 以 data-external-src / data-original-title 为准。
 */
export const GuardedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: null, parseHTML: (element: HTMLElement) => readImageSrc(element) },
      title: { default: null, parseHTML: (element: HTMLElement) => readImageTitle(element) },
    }
  },

  parseHTML() {
    return [...(this.parent?.() ?? []), { tag: 'img[data-external-src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, guardImageAttributes(HTMLAttributes))]
  },
})
