import { FigureImage } from './figure'
import { figurePageWidthPx, setFigureWidth } from '../../utils/figureSize'
import { guardImageAttributes } from '../../utils/imageSource'

const units: Record<string, number> = { px: 1, mm: 96 / 25.4, cm: 960 / 25.4, in: 96, pt: 96 / 72 }

/** Editor-only controls; serialization remains the figureImage <img> defined by the schema. */
export const EditableFigureImage = FigureImage.extend({
  addNodeView() {
    return ({ node: initial, decorations, view, getPos }) => {
      let node = initial
      let imageDecorations = decorations
      let stopDrag: (() => void) | undefined
      const dom = document.createElement('div')
      dom.className = 'ses-figure-image-view'
      dom.contentEditable = 'false'
      const image = document.createElement('img')
      image.className = 'std-figure-image'
      image.dataset.type = 'figure-image'
      const handle = document.createElement('button')
      handle.type = 'button'; handle.className = 'ses-figure-resize-handle'; handle.setAttribute('aria-label', '拖动调整图片大小')
      const frame = document.createElement('div')
      frame.className = 'ses-figure-image-frame'
      frame.append(image, handle); dom.append(frame)

      function limit(): number {
        const pageWidth = imageDecorations.find(decoration => typeof decoration.spec.figurePageWidth === 'number')?.spec.figurePageWidth
        if (typeof pageWidth === 'number') return pageWidth
        const pos = getPos()
        return typeof pos === 'number' ? figurePageWidthPx(view.state.doc, pos) : 165 * 96 / 25.4
      }
      function sync() {
        const attrs = guardImageAttributes({ src: node.attrs.src, title: node.attrs.title })
        const src = String(attrs.src ?? '')
        if (image.getAttribute('src') !== src) image.setAttribute('src', src)
        image.setAttribute('alt', String(node.attrs.alt ?? ''))
        image.classList.toggle('is-external-image', !!attrs['data-external-src'])
        for (const key of ['data-external-src', 'data-original-title', 'title']) {
          const value = attrs[key]
          if (typeof value === 'string') image.setAttribute(key, value); else image.removeAttribute(key)
        }
        if (!node.attrs.src) {
          image.setAttribute('role', 'button'); image.setAttribute('tabindex', '0'); image.setAttribute('aria-label', '点击选择图片')
        } else {
          image.removeAttribute('role'); image.removeAttribute('tabindex'); image.removeAttribute('aria-label')
        }
        const width = Number(node.attrs.width), height = Number(node.attrs.height)
        const widthPx = Number.isFinite(width) && width > 0 ? width * (units[String(node.attrs.widthUnit || 'px')] ?? 1) : 0
        const heightPx = Number.isFinite(height) && height > 0 ? height * (units[String(node.attrs.heightUnit || 'px')] ?? 1) : 0
        const px = widthPx || (heightPx && image.naturalHeight ? heightPx * image.naturalWidth / image.naturalHeight : 0)
        frame.style.width = px ? `${Math.min(100, px / limit() * 100)}%` : ''
        image.style.width = px ? '100%' : ''
        image.style.aspectRatio = widthPx && heightPx ? `${widthPx} / ${heightPx}` : ''
        image.style.height = 'auto'
        dom.classList.toggle('is-empty', !node.attrs.src)
      }
      handle.addEventListener('pointerdown', event => {
        if (!view.editable || !node.attrs.src) return
        event.preventDefault(); event.stopPropagation()
        stopDrag?.()
        const originalDoc = view.state.doc, originalPos = getPos()
        const startX = event.clientX, startWidth = image.getBoundingClientRect().width
        const frameWidth = dom.getBoundingClientRect().width
        if (!frameWidth || !startWidth) return
        const initialWidth = startWidth / frameWidth * limit()
        let width = initialWidth
        const move = (e: PointerEvent) => {
          width = Math.max(16, Math.min(limit(), (startWidth + (e.clientX - startX) * 2) / frameWidth * limit()))
          frame.style.width = `${width / limit() * 100}%`
          image.style.width = '100%'
        }
        const cleanup = () => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel)
          stopDrag = undefined
        }
        const finish = (e: PointerEvent) => {
          cleanup()
          if (e.type === 'pointerup' && Math.abs(width - initialWidth) > 0.01 && view.state.doc.eq(originalDoc) && getPos() === originalPos) {
            if (typeof originalPos === 'number') setFigureWidth(view, originalPos, Math.round(width * 100) / 100)
          } else sync()
        }
        const cancel = (e: PointerEvent) => finish(e)
        stopDrag = cleanup
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel)
      })
      image.addEventListener('load', sync)
      sync()
      return {
        dom,
        update(updated, nextDecorations) {
          if (updated.type !== node.type) return false
          const previousLimit = limit()
          node = updated
          imageDecorations = nextDecorations
          if (stopDrag && limit() !== previousLimit) stopDrag()
          sync()
          return true
        },
        selectNode() { dom.classList.add('ProseMirror-selectednode') },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode') },
        stopEvent(event) { return event.target === handle },
        ignoreMutation() { return true },
        destroy() { stopDrag?.(); image.removeEventListener('load', sync) },
      }
    }
  },
})
