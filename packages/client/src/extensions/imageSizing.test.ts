// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'
import { setFigureSizePreset } from '../utils/figureSize'

let editor: Editor | undefined
afterEach(() => { editor?.destroy(); editor = undefined })
function setup() {
  const root = document.createElement('div'); document.body.appendChild(root)
  editor = new Editor({ element: root, extensions: createEditorExtensions(), content: { type: 'doc', content: [{ type: 'chapter', content: [
    { type: 'chapterTitle', content: [{ type: 'text', text: '测试' }] },
    { type: 'figure', content: [{ type: 'figureImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }, { type: 'figureCaption' }] },
    { type: 'stdTable', content: [{ type: 'tableCaption' }, { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'inlineImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }] }] },
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '文字' }, { type: 'inlineImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }] }] },
    ] }] }] },
  ] }] } })
  return editor
}
it('仅图合并单元格得到尺寸标记，混排单元格不受影响', () => {
  const ed = setup()
  const cells = ed.view.dom.querySelectorAll('td')
  expect(cells[0]?.classList.contains('ses-image-only-cell')).toBe(true)
  expect(cells[1]?.classList.contains('ses-image-only-cell')).toBe(false)
})
it('选中正文图片可选择通栏并保存逻辑版心宽度，恢复默认清除尺寸', () => {
  const ed = setup(); let pos = -1
  ed.state.doc.descendants((node, p) => { if (node.type.name === 'figureImage') pos = p })
  ed.commands.setNodeSelection(pos)
  expect(setFigureSizePreset(ed.view, pos, 'full')).toBe(true)
  expect(ed.state.doc.nodeAt(pos)?.attrs.width).toBeCloseTo(165 * 96 / 25.4, 2)
  expect(setFigureSizePreset(ed.view, pos, 'reset')).toBe(true)
  expect(ed.state.doc.nodeAt(pos)?.attrs.width).toBeNull()
})
it('点击角点不产生尺寸事务，拖动一次只写入一次并可撤销', () => {
  const ed = setup(); let pos = -1
  ed.state.doc.descendants((node, p) => { if (node.type.name === 'figureImage') pos = p })
  ed.commands.setNodeSelection(pos)
  const handle = ed.view.dom.querySelector<HTMLButtonElement>('.ses-figure-resize-handle')!
  const frame = ed.view.dom.querySelector<HTMLElement>('.ses-figure-image-view')!
  const image = frame.querySelector('img')!
  frame.getBoundingClientRect = () => ({ width: 600 } as DOMRect)
  image.getBoundingClientRect = () => ({ width: 300 } as DOMRect)
  const send = (target: EventTarget, type: string, x: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x }))
  send(handle, 'pointerdown', 100); send(window, 'pointerup', 100)
  expect(ed.state.doc.nodeAt(pos)?.attrs.width).toBeNull()
  send(handle, 'pointerdown', 100); send(window, 'pointermove', 150); send(window, 'pointerup', 150)
  expect(ed.state.doc.nodeAt(pos)?.attrs.width).toBeGreaterThan(0)
  expect(ed.commands.undo()).toBe(true)
  expect(ed.state.doc.nodeAt(pos)?.attrs.width).toBeNull()
})
it('快速连续调整尺寸，撤销只回退最近一步', () => {
  const ed = setup(); let pos = -1
  ed.state.doc.descendants((node, p) => { if (node.type.name === 'figureImage') pos = p })
  ed.commands.setNodeSelection(pos)
  expect(setFigureSizePreset(ed.view, pos, 'half')).toBe(true)
  const half = ed.state.doc.nodeAt(pos)?.attrs.width
  expect(setFigureSizePreset(ed.view, pos, 'full')).toBe(true)
  expect(ed.commands.undo()).toBe(true)
  expect(ed.state.doc.nodeAt(pos)?.attrs.width).toBe(half)
})
it.each(['figure', 'appendix'] as const)('%s 改为横向时按原保存宽度重新计算图片预览', (ancestor) => {
  const ed = setup()
  if (ancestor === 'appendix') {
    const figure = ed.state.doc.firstChild!.child(1).toJSON()
    ed.commands.setContent({ type: 'doc', content: [{
      type: 'appendix',
      content: [{ type: 'appendixLabel' }, { type: 'appendixTitle' }, figure],
    }] })
  }
  let ancestorPos = -1
  let imagePos = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === ancestor) ancestorPos = pos
    if (node.type.name === 'figureImage') imagePos = pos
  })
  ed.commands.setNodeSelection(imagePos)
  expect(setFigureSizePreset(ed.view, imagePos, 'half')).toBe(true)
  const image = ed.state.doc.nodeAt(imagePos)!
  const frameWidth = () => parseFloat(ed.view.dom.querySelector<HTMLElement>('.ses-figure-image-frame')!.style.width)
  expect(frameWidth()).toBeCloseTo(50, 2)

  ed.view.dispatch(ed.state.tr.setNodeAttribute(ancestorPos, 'orientation', 'landscape'))
  expect(ed.state.doc.nodeAt(imagePos)).toBe(image)
  expect(frameWidth()).toBeCloseTo(100 * (165 / 2) / 252, 2)

  ed.view.dispatch(ed.state.tr.setNodeAttribute(ancestorPos, 'orientation', 'portrait'))
  expect(ed.state.doc.nodeAt(imagePos)).toBe(image)
  expect(frameWidth()).toBeCloseTo(50, 2)
})
it('拖动期间正文改变则取消写入尺寸', () => {
  const ed = setup(); let pos = -1
  ed.state.doc.descendants((node, p) => { if (node.type.name === 'figureImage') pos = p })
  ed.commands.setNodeSelection(pos)
  const frame = ed.view.dom.querySelector<HTMLElement>('.ses-figure-image-view')!
  frame.getBoundingClientRect = () => ({ width: 600 } as DOMRect)
  frame.querySelector('img')!.getBoundingClientRect = () => ({ width: 300 } as DOMRect)
  frame.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100 }))
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 150 }))
  ed.commands.insertContentAt(2, '变')
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 150 }))
  let width: unknown
  ed.state.doc.descendants(node => { if (node.type.name === 'figureImage') width = node.attrs.width })
  expect(width).toBeNull()
})
it('旧图仅设高度时根据自然比例显示，旧图宽高同时存在时保留比例', () => {
  const ed = setup(); let pos = -1
  ed.state.doc.descendants((node, p) => { if (node.type.name === 'figureImage') pos = p })
  const image = ed.view.dom.querySelector<HTMLImageElement>('.ses-figure-image-frame img')!
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 400 })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 200 })
  let node = ed.state.doc.nodeAt(pos)!
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: null, height: 50, heightUnit: 'px' }))
  const currentImage = ed.view.dom.querySelector<HTMLImageElement>('.ses-figure-image-frame img')!
  Object.defineProperty(currentImage, 'naturalWidth', { configurable: true, value: 400 })
  Object.defineProperty(currentImage, 'naturalHeight', { configurable: true, value: 200 })
  currentImage.dispatchEvent(new Event('load'))
  const frame = currentImage.parentElement!
  expect(parseFloat(frame.style.width)).toBeCloseTo(100 / (165 * 96 / 25.4) * 100, 3)
  node = ed.state.doc.nodeAt(pos)!
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: 200, widthUnit: 'px', height: 50, heightUnit: 'px' }))
  expect(ed.view.dom.querySelector<HTMLImageElement>('.ses-figure-image-frame img')!.style.aspectRatio).toBe('200 / 50')
})

it('ImageLayout 排除空图、hardBreak、带 marks 节点与空白，仅对合法单图单元格加类', () => {
  const ed = new Editor({
    extensions: createEditorExtensions(),
    content: {
      type: 'doc',
      content: [{
        type: 'chapter',
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '测试' }] },
          {
            type: 'stdTable',
            content: [
              { type: 'tableCaption' },
              {
                type: 'table',
                content: [{
                  type: 'tableRow',
                  content: [
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }, { type: 'inlineImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }, { type: 'text', text: ' ' }] }] },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'inlineImage', attrs: { src: '' } }] }] },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'inlineImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }, { type: 'hardBreak' }] }] },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'inlineImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }, { type: 'text', text: ' ', marks: [{ type: 'bold' }] }] }] },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'inlineImage', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' }, marks: [{ type: 'bold' }] }] }] },
                  ],
                }],
              },
            ],
          },
        ],
      }],
    },
  })
  const cells = ed.view.dom.querySelectorAll('td')
  expect(cells).toHaveLength(5)
  expect(cells[0]!.classList.contains('ses-image-only-cell')).toBe(true)
  expect(cells[1]!.classList.contains('ses-image-only-cell')).toBe(false)
  expect(cells[2]!.classList.contains('ses-image-only-cell')).toBe(false)
  expect(cells[3]!.classList.contains('ses-image-only-cell')).toBe(false)
  expect(cells[4]!.classList.contains('ses-image-only-cell')).toBe(false)
  ed.destroy()
})

it('拖拽角点忽略非左键与非当前 pointerId，安全处理 setPointerCapture 异常并在拖拽时清除旧 aspectRatio', () => {
  const ed = setup()
  let pos = -1
  ed.state.doc.descendants((node, p) => { if (node.type.name === 'figureImage') pos = p })
  const initialNode = ed.state.doc.nodeAt(pos)!
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...initialNode.attrs, width: 200, widthUnit: 'px', height: 50, heightUnit: 'px' }))

  const viewDom = ed.view.dom.querySelector<HTMLElement>('.ses-figure-image-view')!
  const image = viewDom.querySelector<HTMLImageElement>('img')!
  const handle = viewDom.querySelector<HTMLButtonElement>('.ses-figure-resize-handle')!
  viewDom.getBoundingClientRect = () => ({ width: 500 } as DOMRect)
  image.getBoundingClientRect = () => ({ width: 200 } as DOMRect)
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 400 })
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 200 })
  let captured = false
  let released = false
  handle.setPointerCapture = () => { captured = true; throw new Error('unsupported') }
  handle.releasePointerCapture = () => { released = true; throw new Error('unsupported') }

  // 右键点击不触发拖拽，也不会污染 aspectRatio
  handle.dispatchEvent(new PointerEvent('pointerdown', { button: 2, pointerId: 10, clientX: 200, bubbles: true }))
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 10, clientX: 300 }))
  expect(captured).toBe(false)
  expect(image.style.aspectRatio).toBe('200 / 50')

  // 主键按下后忽略其他 pointerId，合法移动清除 aspectRatio 并按新比例预览，仅对应 pointerId 释放
  const frame = viewDom.querySelector<HTMLElement>('.ses-figure-image-frame')!
  handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 11, clientX: 200, bubbles: true }))
  expect(captured).toBe(true)
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 99, clientX: 350 }))
  expect(image.style.aspectRatio).toBe('200 / 50')
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, clientX: 300 }))
  expect(image.style.aspectRatio).toBe('')
  expect(frame.style.width).toBe('80%')
  expect(image.style.width).toBe('100%')
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, clientX: 350 }))
  expect(released).toBe(false)
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, clientX: 300 }))
  expect(released).toBe(true)
  expect(ed.state.doc.nodeAt(pos)!.attrs.width).toBeCloseTo(0.8 * 165 * 96 / 25.4, 1)
  ed.destroy()
})
