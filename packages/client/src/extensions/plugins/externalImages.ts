import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { EXTERNAL_IMAGE_SELECTOR, revealExternalImage } from '../../utils/imageSource'

/**
 * 外部图片「点击才加载」：编辑器里未允许加载的外部图片显示占位图（见 utils/imageSource.ts），
 * 点击占位图后允许加载该地址并显示真实图片。只改 DOM 元素，不产生事务，文档内容与「未保存」状态都不变。
 */
export const ExternalImages = Extension.create({
  name: 'externalImages',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('externalImages'),
      props: {
        handleDOMEvents: {
          click(view, event) {
            const target = event.target as Element | null
            const image = target?.closest?.(EXTERNAL_IMAGE_SELECTOR)
            return image ? revealExternalImage(image, view.dom) : false
          },
        },
      },
    })]
  },
})
