// @vitest-environment happy-dom
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../editorExtensions'
import { SES_CLIPBOARD_ATTR, isSesClipboardHtml } from './clipboardPolicy'

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  document.body.replaceChildren()
})

const text = (value: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value })
const p = (id: string, ...content: JSONContent[]): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: id }, content })
const doc = (): JSONContent => ({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'ch' }, content: [
  { type: 'chapterTitle', content: [text('要求')] },
  { type: 'clause', attrs: { nodeId: 'c1', level: 1 }, content: [
    { type: 'clauseTitle', attrs: { level: 1 }, content: [text('甲')] },
    p('src', text('面积为 1 m'), text('2', [{ type: 'superscript' }]), text('，'), text('加粗', [{ type: 'bold' }])),
    p('target', text('目标段')),
    { type: 'stdTable', attrs: { nodeId: 'T1' }, content: [
      { type: 'tableCaption', content: [text('表一')] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text('单元格')] }] }] }] },
    ] },
  ] },
] }] })

function editor() {
  const e = new Editor({ extensions: createEditorExtensions(), content: doc() })
  editors.push(e)
  return e
}

function textPos(e: Editor, value: string) {
  let pos = -1
  e.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text!.includes(value)) pos = at + node.text!.indexOf(value)
  })
  if (pos < 0) throw new Error(`找不到文字 ${value}`)
  return pos
}

function placeCursor(e: Editor, value: string, where: 'start' | 'end' = 'start') {
  const pos = textPos(e, value) + (where === 'start' ? 0 : value.length)
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)))
}

/** 模拟浏览器粘贴事件：带 text/html 与 text/plain 的剪贴板数据。 */
function paste(e: Editor, data: { html?: string; text?: string }) {
  const clipboardData = { getData: (type: string) => (type === 'text/html' ? data.html ?? '' : type === 'text/plain' ? data.text ?? '' : '') }
  const event = { clipboardData, preventDefault() {} } as unknown as ClipboardEvent
  if (data.html) e.view.pasteHTML(data.html, event)
  else e.view.pasteText(data.text ?? '', event)
}

function copy(e: Editor, from: string, to: string) {
  const { dom, text: plain } = e.view.serializeForClipboard(e.state.doc.slice(textPos(e, from), textPos(e, to) + to.length))
  return { html: dom.innerHTML, text: plain }
}

/** 目标条内的块：类型与文字，以及文字上的 mark（用于判断格式是否保留）。 */
function clauseBlocks(e: Editor) {
  const clause = e.state.doc.child(0).child(1)
  const blocks: string[] = []
  clause.forEach(child => {
    if (!child.isTextblock) { blocks.push(child.type.name); return }
    const marks = new Set<string>()
    child.forEach(inline => inline.marks.forEach(mark => marks.add(mark.type.name)))
    blocks.push(`${child.type.name}「${child.textContent}」${marks.size ? `[${[...marks].sort().join(',')}]` : ''}`)
  })
  return blocks
}

describe('SES 内复制：剪贴板带标记，粘贴保留格式', () => {
  it('跨段复制与段内复制都带标记', () => {
    const e = editor()
    expect(isSesClipboardHtml(copy(e, '面积', '目标段').html)).toBe(true)
    const inline = copy(e, '面积', '加粗').html
    expect(inline).toContain(`${SES_CLIPBOARD_ATTR}="1"`)
  })

  it('粘贴后保留上标、加粗', () => {
    const e = editor()
    const clip = copy(e, '面积', '加粗')
    placeCursor(e, '目标段', 'end')
    paste(e, clip)
    expect(clauseBlocks(e)).toContain('stdParagraph「目标段面积为 1 m2，加粗」[bold,superscript]')
  })
})

describe('外部来源（Word、网页等）：按纯文本粘贴', () => {
  const wordHtml = '<html><body><!--StartFragment--><p class="MsoNormal" style="font-family:宋体"><b>外部粗体</b>正文</p>'
    + '<table><tr><td>外部单元格</td></tr></table><p>第二段</p><!--EndFragment--></body></html>'
  const wordText = '外部粗体正文\r\n外部单元格\r\n\r\n第二段'

  it.each(['start', 'end'] as const)('粘贴到段落%s：不带格式和表格，每行一个正文段', (where) => {
    const e = editor()
    placeCursor(e, '目标段', where)
    paste(e, { html: wordHtml, text: wordText })
    const blocks = clauseBlocks(e)
    expect(blocks.filter(block => block.includes('外部') || block.includes('第二段') || block.includes('目标段'))).toEqual(where === 'start'
      ? ['stdParagraph「外部粗体正文」', 'stdParagraph「外部单元格」', 'stdParagraph「第二段目标段」']
      : ['stdParagraph「目标段外部粗体正文」', 'stdParagraph「外部单元格」', 'stdParagraph「第二段」'])
    expect(blocks.filter(block => block === 'stdTable')).toHaveLength(1) // 只有原有的表格
    e.commands.undo()
    expect(clauseBlocks(e)).toEqual(clauseBlocks(editor()))
  })

  it('其他 ProseMirror 编辑器的内容（有 data-pm-slice 但无 SES 标记）也按纯文本粘贴', () => {
    const e = editor()
    placeCursor(e, '目标段', 'end')
    paste(e, { html: '<p data-pm-slice="1 1 []"><strong>别处</strong></p>', text: '别处' })
    expect(clauseBlocks(e)).toContain('stdParagraph「目标段别处」')
  })

  it('只有纯文本的剪贴板：多行均为正文段，不产生普通 paragraph', () => {
    const e = editor()
    placeCursor(e, '目标段', 'start')
    paste(e, { text: '第一行\n第二行\n第三行' })
    expect(clauseBlocks(e).slice(2, 5)).toEqual(['stdParagraph「第一行」', 'stdParagraph「第二行」', 'stdParagraph「第三行目标段」'])
  })
})

describe('Ctrl/Cmd+Shift+V：始终按纯文本粘贴', () => {
  it('SES 内复制的内容也去掉格式', () => {
    const e = editor()
    const clip = copy(e, '面积', '加粗')
    placeCursor(e, '目标段', 'end')
    // shift 粘贴时 ProseMirror 走纯文本路径（等同 view.pasteText）
    e.view.pasteText(clip.text)
    expect(clauseBlocks(e)).toContain('stdParagraph「目标段面积为 1 m2，加粗」')
  })

  it('表格单元格内多行纯文本仍为单元格段落，不把正文段放进表格', () => {
    const e = editor()
    placeCursor(e, '单元格', 'end')
    e.view.pasteText('甲\n乙')
    const cell = e.state.doc.child(0).child(1).child(3).child(1).firstChild!.firstChild!
    expect(cell.content.content.map(block => `${block.type.name}「${block.textContent}」`)).toEqual(['paragraph「单元格甲」', 'paragraph「乙」'])
  })
})
