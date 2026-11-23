import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { SelectionBookmark } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** 单张本地图片最大原始文件大小（10 MB），确保 Base64 Data URL 嵌入文档 JSON 后远低于服务端 25 MB 限制。 */
export const MAX_LOCAL_IMAGE_BYTES = 10 * 1024 * 1024

type ImageTarget = { doc: ProseMirrorNode; bookmark: SelectionBookmark; pos?: number; slashPos?: number }

/** Keep the original document and selection so an asynchronous picker cannot write elsewhere. */
export function captureImageTarget(editor: Editor, pos?: number, slashPos?: number): ImageTarget {
  return { doc: editor.state.doc, bookmark: editor.state.selection.getBookmark(), pos, slashPos }
}

export function applyImageTarget(editor: Editor, target: ImageTarget, src: string): boolean {
  if (editor.isDestroyed || !editor.isEditable || !editor.state.doc.eq(target.doc)) return false
  if (target.pos !== undefined) {
    const node = editor.state.doc.nodeAt(target.pos)
    if (!node || !['figureImage', 'inlineImage'].includes(node.type.name) || node.attrs.src) return false
    editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...node.attrs, src }))
    return true
  }
  const range = target.slashPos === undefined ? null : { from: target.slashPos, to: target.slashPos + 1 }
  if (range && editor.state.doc.textBetween(range.from, range.to) !== '/') return false
  const insert = (check: boolean) => {
    const chain = check ? editor.can().chain() : editor.chain()
    chain.command(({ tr }) => {
      tr.setSelection(target.bookmark.resolve(tr.doc))
      if (range) tr.delete(range.from, range.to)
      return true
    })
    return chain.insertFigure({ src }).run()
  }
  if (!insert(true)) return false
  const applied = insert(false)
  if (applied) editor.view.focus()
  return applied
}

/** Reject mismatched file contents before asking the browser to decode them. */
export function isSupportedImageData(src: string): boolean {
  const match = /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(src)
  if (!match) return false
  try {
    const bytes = atob(match[2]!.slice(0, 16))
    switch (match[1]!.toLowerCase()) {
      case 'image/png': return bytes.startsWith('\x89PNG\r\n\x1a\n')
      case 'image/jpeg': return bytes.startsWith('\xff\xd8\xff')
      case 'image/gif': return bytes.startsWith('GIF87a') || bytes.startsWith('GIF89a')
      default: return false
    }
  } catch { return false }
}

export function validateLocalImageFile(file: Pick<File, 'type' | 'size'>): void {
  if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) {
    throw new Error('请选择 PNG、JPEG 或 GIF 格式的图片')
  }
  if (file.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error(`图片文件过大（最大支持 ${Math.round(MAX_LOCAL_IMAGE_BYTES / (1024 * 1024))} MB），请压缩后再试`)
  }
}

export function isEmptyImageNode(node: ProseMirrorNode | null | undefined): boolean {
  return Boolean(node && ['figureImage', 'inlineImage'].includes(node.type.name) && !node.attrs.src)
}

export function findEmptyImagePosFromKeydown(view: EditorView, event: KeyboardEvent): number | undefined {
  if (!view.editable) return undefined
  const target = event.target
  if ((event.key !== 'Enter' && event.key !== ' ') || !(target instanceof HTMLImageElement) || target.getAttribute('role') !== 'button') {
    return undefined
  }
  const pos = view.posAtDOM(target, 0)
  return [pos, pos - 1].find((p) => {
    if (p < 0 || p >= view.state.doc.content.size) return false
    const node = view.state.doc.nodeAt(p)
    return isEmptyImageNode(node) && Boolean(view.nodeDOM(p)?.contains(target))
  })
}

export function handleEmptyImageClick(
  view: EditorView,
  node: ProseMirrorNode,
  nodePos: number,
  direct: boolean,
  pickImage: (pos: number) => void,
): boolean {
  if (!view.editable || !direct || !isEmptyImageNode(node)) return false
  pickImage(nodePos)
  return true
}

export function handleEmptyImageKeydown(
  view: EditorView,
  event: KeyboardEvent,
  pickImage: (pos: number) => void,
): boolean {
  const imagePos = findEmptyImagePosFromKeydown(view, event)
  if (imagePos === undefined) return false
  event.preventDefault()
  pickImage(imagePos)
  return true
}

/** A fresh input per invocation also allows choosing the same file again. */
export function selectLocalImage(): Promise<string | null> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif'
  return new Promise((resolve, reject) => {
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      try {
        validateLocalImageFile(file)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('图片格式或大小不符合要求'))
        return
      }
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.onload = () => {
        if (typeof reader.result !== 'string') { reject(new Error('图片读取失败')); return }
        const src = reader.result
        if (!isSupportedImageData(src)) {
          reject(new Error('图片内容无效，请选择有效的 PNG、JPEG 或 GIF 图片'))
          return
        }
        const image = new Image()
        image.onload = () => resolve(src)
        image.onerror = () => reject(new Error('图片无法读取，请选择有效的 PNG、JPEG 或 GIF 图片'))
        image.src = src
      }
      reader.readAsDataURL(file)
    }, { once: true })
    input.click()
  })
}
