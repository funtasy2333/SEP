// @vitest-environment happy-dom
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../editorExtensions'
import { SES_CLIPBOARD_ATTR, isSesClipboardHtml, joinPlainTextLines } from './clipboardPolicy'

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
    { type: 'stdList', attrs: { nodeId: 'list', listType: 'dash', level: 1 }, content: [
      { type: 'stdListItem', attrs: { nodeId: 'item' }, content: [text('列项')] },
    ] },
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

describe('外部来源（Word、网页等）：按纯文本插入光标所在段落', () => {
  const wordHtml = '<html><body><!--StartFragment--><p class="MsoNormal" style="font-family:宋体"><b>外部粗体</b>正文</p>'
    + '<table><tr><td>外部单元格</td><td>第二列</td></tr></table><p>第二段</p><!--EndFragment--></body></html>'
  const wordText = '外部粗体正文\r\n外部单元格\t第二列\r\n\r\n第二段'
  const joined = '外部粗体正文外部单元格 第二列第二段'

  it.each([
    ['start', `stdParagraph「${joined}目标段」`],
    ['end', `stdParagraph「目标段${joined}」`],
  ] as const)('粘贴到段落%s：不带格式和表格，全部并入该段，不新建段落', (where, expected) => {
    const e = editor()
    const before = clauseBlocks(e)
    placeCursor(e, '目标段', where)
    paste(e, { html: wordHtml, text: wordText })
    const blocks = clauseBlocks(e)
    expect(blocks).toHaveLength(before.length)
    expect(blocks[2]).toBe(expected)
    e.commands.undo()
    expect(clauseBlocks(e)).toEqual(before)
  })

  it.each([
    ['列项', '列项', 'stdList'],
    ['条标题', '甲', 'clauseTitle'],
    ['表格单元格', '单元格', 'paragraph'],
  ])('粘贴到%s：沿用该处格式，不新建条目', (_name, target, parentType) => {
    const e = editor()
    placeCursor(e, target, 'end')
    const before = JSON.stringify(e.getJSON()).match(/"type":"[a-zA-Z]+"/g)!.length
    paste(e, { html: wordHtml, text: wordText })
    const { $from } = e.state.selection
    expect(parentType === 'stdList' ? $from.node(-1).type.name : $from.parent.type.name).toBe(parentType)
    expect($from.parent.textContent).toBe(`${target}${joined}`)
    // 节点数不变：没有新建段落、列项、条或表格（新增的只是文字）
    expect(JSON.stringify(e.getJSON()).match(/"type":"[a-zA-Z]+"/g)!.length).toBe(before)
  })

  it('其他 ProseMirror 编辑器的内容（有 data-pm-slice 但无 SES 标记）也按纯文本粘贴', () => {
    const e = editor()
    placeCursor(e, '目标段', 'end')
    paste(e, { html: '<p data-pm-slice="1 1 []"><strong>别处</strong></p>', text: '别处' })
    expect(clauseBlocks(e)).toContain('stdParagraph「目标段别处」')
  })

  it('只有纯文本的剪贴板：多行合并为一行插入', () => {
    const e = editor()
    placeCursor(e, '目标段', 'start')
    paste(e, { text: '第一行\n第二行\n第三行' })
    expect(clauseBlocks(e)[2]).toBe('stdParagraph「第一行第二行第三行目标段」')
  })

  it('合并规则：中文直接相连，英文、数字之间补空格，去掉空行和行首尾空白，单行原样', () => {
    expect(joinPlainTextLines('甲\n\n  乙  \r\n丙')).toBe('甲乙丙')
    expect(joinPlainTextLines('GB/T 1.1\n2020 edition')).toBe('GB/T 1.1 2020 edition')
    expect(joinPlainTextLines('结论：\nok')).toBe('结论：ok')
    expect(joinPlainTextLines('  单行  ')).toBe('  单行  ')
  })
})

describe('Ctrl/Cmd+Shift+V：始终按纯文本粘贴', () => {
  it('SES 内复制的多段内容也去掉格式，并入光标所在段落', () => {
    const e = editor()
    const clip = copy(e, '面积', '目标段')
    placeCursor(e, '目标段', 'end')
    const before = clauseBlocks(e).length
    // shift 粘贴时 ProseMirror 走纯文本路径（等同 view.pasteText）
    e.view.pasteText(clip.text)
    expect(clauseBlocks(e)).toHaveLength(before)
    expect(clauseBlocks(e)[2]).toBe('stdParagraph「目标段面积为 1 m2，加粗目标段」')
  })
})

describe('复制整条列项：选区终点落在下一项开头时，粘贴不多出空白列项', () => {
  const listDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'chapter', attrs: { nodeId: 'ch' }, content: [
    { type: 'chapterTitle', content: [text('要求')] },
    { type: 'clause', attrs: { nodeId: 'c1', level: 1 }, content: [
      { type: 'clauseTitle', attrs: { level: 1 }, content: [text('甲')] },
      { type: 'stdList', attrs: { nodeId: 'list', listType: 'dash', level: 1 }, content: [
        { type: 'stdListItem', attrs: { nodeId: 'i1' }, content: [text('第一项')] },
        { type: 'stdListItem', attrs: { nodeId: 'i2' }, content: [text('第二项')] },
      ] },
      p('after', text('后文')),
      p('blank'),
    ] },
  ] }] })
  const listEditor = () => {
    const e = new Editor({ extensions: createEditorExtensions(), content: listDoc() })
    editors.push(e)
    return e
  }
  /** 浏览器拖选整行：起点在第一项开头，终点落在第二项开头（偏移 0），按真实复制流程（当前选区）生成剪贴板。 */
  const copyWholeFirstItem = (e: Editor) => {
    const start = textPos(e, '第一项'), end = textPos(e, '第二项')
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, start, end)))
    const { dom, text: plain } = e.view.serializeForClipboard(e.state.selection.content())
    return { html: dom.innerHTML, text: plain }
  }
  const items = (e: Editor) => {
    const texts: string[] = []
    e.state.doc.descendants(node => { if (node.type.name === 'stdListItem') texts.push(node.textContent) })
    return texts
  }

  it('复现：回车新建空列项后粘贴，只得到复制的那一项', () => {
    const e = listEditor()
    const clip = copyWholeFirstItem(e)
    expect(clip.text).toBe('第一项')
    placeCursor(e, '第二项', 'end')
    e.commands.enter()
    paste(e, clip)
    expect(items(e)).toEqual(['第一项', '第二项', '第一项'])
  })

  it('粘贴到列项末尾：文字接在光标处，不新增空白列项', () => {
    const e = listEditor()
    const clip = copyWholeFirstItem(e)
    placeCursor(e, '第二项', 'end')
    paste(e, clip)
    expect(items(e)).toEqual(['第一项', '第二项第一项'])
  })

  it('粘贴到空正文段：仍作为列项粘贴（保留列项结构）', () => {
    const e = listEditor()
    const clip = copyWholeFirstItem(e)
    let blank = -1
    e.state.doc.descendants((node, pos) => { if (node.attrs.nodeId === 'blank') blank = pos + 1 })
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, blank)))
    paste(e, clip)
    expect(items(e)).toEqual(['第一项', '第二项', '第一项'])
    expect(clauseBlocks(e)).toEqual(['clauseTitle「甲」', 'stdList', 'stdParagraph「后文」', 'stdList'])
  })

  it('剪切同一选区：整条第一项被移除，第二项保留', () => {
    const e = listEditor()
    copyWholeFirstItem(e)
    e.commands.deleteSelection()
    expect(items(e)).toEqual(['第二项'])
  })
})
