import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { SelectionBookmark } from '@tiptap/pm/state'

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
      if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) {
        reject(new Error('请选择 PNG、JPEG 或 GIF 格式的图片'))
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
