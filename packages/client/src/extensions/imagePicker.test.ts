// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'
import { captureImageTarget, applyImageTarget, isSupportedImageData } from '../utils/imagePicker'

const editors: Editor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })
const png = 'data:image/png;base64,iVBORw0KGgo='
function setup() {
  const editor = new Editor({ extensions: createEditorExtensions(), content: { type: 'doc', content: [{ type: 'chapter', content: [
    { type: 'chapterTitle', content: [{ type: 'text', text: '要求' }] },
    { type: 'stdParagraph', content: [{ type: 'text', text: '正文' }] },
  ] }] } })
  editors.push(editor)
  let pos = 0
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'stdParagraph') pos = p + 1 })
  editor.commands.setTextSelection(pos)
  return editor
}
function imagePos(editor: Editor) {
  let pos = -1
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'figureImage') pos = p })
  return pos
}

describe('本地图片写入', () => {
  it('选定图片后在原位置插入有内容的图', () => {
    const editor = setup()
    const target = captureImageTarget(editor)
    expect(applyImageTarget(editor, target, png)).toBe(true)
    expect(editor.state.doc.nodeAt(imagePos(editor))?.attrs.src).toBe(png)
  })
  it('为已有空图填充图片并保留图题', () => {
    const editor = setup()
    editor.commands.insertFigure({ captionCn: '原图题' })
    const pos = imagePos(editor)
    const target = captureImageTarget(editor, pos)
    editor.commands.setTextSelection(2)
    expect(applyImageTarget(editor, target, png)).toBe(true)
    expect(editor.state.doc.nodeAt(pos)?.attrs.src).toBe(png)
    expect(editor.state.doc.textContent).toContain('原图题')
  })
  it('表格行内空图在原位补选并保留替代文字', () => {
    const editor = setup()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '要求' }] },
      { type: 'stdTable', content: [
        { type: 'tableCaption' },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
          { type: 'paragraph', content: [{ type: 'inlineImage', attrs: { src: '', alt: '表内图' } }] },
        ] }] }] },
      ] },
    ] }] })
    let pos = -1
    editor.state.doc.descendants((n, p) => { if (n.type.name === 'inlineImage') pos = p })
    expect(pos).toBeGreaterThanOrEqual(0)
    const image = editor.view.dom.querySelector('img[data-type="inline-image"]')
    expect(image?.getAttribute('aria-label')).toContain('选择图片')
    expect(applyImageTarget(editor, captureImageTarget(editor, pos), png)).toBe(true)
    expect(editor.state.doc.nodeAt(pos)?.attrs).toMatchObject({ src: png, alt: '表内图' })
  })
  it('表格选图后光标漂移仍在原单元格插入行内图', () => {
    const editor = setup()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '要求' }] },
      { type: 'stdTable', content: [
        { type: 'tableCaption' },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
          { type: 'paragraph', content: [{ type: 'text', text: '单元格' }] },
        ] }] }] },
      ] },
    ] }] })
    let cellPos = 0
    editor.state.doc.descendants((n, p, parent) => { if (n.type.name === 'paragraph' && parent?.type.name === 'tableCell') cellPos = p + 1 })
    editor.commands.setTextSelection(cellPos)
    const target = captureImageTarget(editor)
    editor.commands.setTextSelection(2)
    expect(applyImageTarget(editor, target, png)).toBe(true)
    let found = false
    editor.state.doc.descendants((n, _p, parent) => {
      if (n.type.name === 'inlineImage' && n.attrs.src === png && parent?.type.name === 'paragraph') found = true
    })
    expect(found).toBe(true)
    expect(imagePos(editor)).toBe(-1)
  })
  it('语义相同的新文档快照仍能在原位置插图', () => {
    const editor = setup()
    const target = captureImageTarget(editor)
    const doc = editor.getJSON()
    editor.commands.setContent(doc)
    expect(applyImageTarget(editor, target, png)).toBe(true)
    expect(editor.state.doc.nodeAt(imagePos(editor))?.attrs.src).toBe(png)
  })
  it('空图显示可用键盘聚焦的选择提示', () => {
    const editor = setup()
    editor.commands.insertFigure()
    const image = editor.view.dom.querySelector('img[data-type="figure-image"]')
    expect(image?.getAttribute('role')).toBe('button')
    expect(image?.getAttribute('tabindex')).toBe('0')
    expect(image?.getAttribute('aria-label')).toContain('选择图片')
  })
  it('选图后才删除斜杠触发符并插图', () => {
    const editor = setup()
    editor.commands.insertContent('/')
    const slash = editor.state.selection.from - 1
    const target = captureImageTarget(editor, undefined, slash)
    expect(editor.state.doc.textContent).toContain('/')
    editor.commands.setTextSelection(2)
    expect(applyImageTarget(editor, target, png)).toBe(true)
    expect(editor.state.doc.textContent).not.toContain('/')
    expect(editor.state.doc.nodeAt(imagePos(editor))?.attrs.src).toBe(png)
  })
  it('选择期间编辑器变为只读时不写入', () => {
    const editor = setup()
    const target = captureImageTarget(editor)
    editor.setEditable(false)
    expect(applyImageTarget(editor, target, png)).toBe(false)
    expect(imagePos(editor)).toBe(-1)
  })
  it('选择期间文档发生改变时不写入', () => {
    const editor = setup()
    const target = captureImageTarget(editor)
    editor.commands.insertContent('变化')
    expect(applyImageTarget(editor, target, png)).toBe(false)
    expect(imagePos(editor)).toBe(-1)
  })
  it('选图期间光标漂移后仍在原段落插图', () => {
    const editor = setup()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: '要求' }] },
      { type: 'stdParagraph', content: [{ type: 'text', text: '第一段' }] },
      { type: 'stdParagraph', content: [{ type: 'text', text: '第二段' }] },
    ] }] })
    let first = 0, second = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'stdParagraph') { if (!first) first = pos + 1; else second = pos + 1 }
    })
    editor.commands.setTextSelection(first)
    const target = captureImageTarget(editor)
    editor.commands.setTextSelection(second)
    expect(applyImageTarget(editor, target, png)).toBe(true)
    const chapter = editor.state.doc.firstChild!
    expect(Array.from({ length: chapter.childCount }, (_, i) => chapter.child(i).type.name)).toEqual(['chapterTitle', 'stdParagraph', 'figure', 'stdParagraph'])
    expect(editor.state.doc.nodeAt(imagePos(editor))?.attrs.src).toBe(png)
  })
})

describe('图片数据校验', () => {
  it('拒绝扩展名或 MIME 冒充支持格式的内容', () => {
    expect(isSupportedImageData('data:image/png;base64,PGh0bWw+')).toBe(false)
    expect(isSupportedImageData('data:image/png;base64,R0lGODlh')).toBe(false)
    expect(isSupportedImageData('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isSupportedImageData('data:image/gif;base64,R0lGODlh')).toBe(true)
    expect(isSupportedImageData('data:image/jpeg;base64,/9j/4A==')).toBe(true)
  })
})
