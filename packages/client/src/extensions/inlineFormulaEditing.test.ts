// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import type { PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { INLINE_FORMULA_EVENT, type InlineFormulaRequest } from './plugins/inlineFormulaEditing'

type Json = PMJsonNode
const text = (value: string, ...marks: string[]): Json => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map(type => ({ type })) } : {}) })

function bodyDoc(): Json {
  return { type: 'doc', content: [{ type: 'chapter', content: [
    { type: 'chapterTitle', content: [text('要求')] },
    { type: 'stdParagraph', content: [text('流量 '), text('q'), text('V', 'subscript'), text(' 应大于 1。')] },
    { type: 'note', content: [text('注文')] },
    { type: 'termDef', attrs: { level: 1 }, content: [
      { type: 'termName', content: [text('流量')] },
      { type: 'termDefinition', content: [text('单位时间通过的体积')] },
    ] },
    { type: 'stdTable', content: [
      { type: 'tableCaption', content: [text('参数')] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [text('值')] }] }] }] },
    ] },
  ] }] }
}

const editors: Editor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

function createEditor(content: Json = bodyDoc()): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: createEditorExtensions(), content })
  editors.push(editor)
  return editor
}

function nodeStart(editor: Editor, name: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === name) { found = pos + 1; return false }
    return true
  })
  if (found < 0) throw new Error(`找不到 ${name}`)
  return found
}

function select(editor: Editor, from: number, to = from): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
}

function captureRequests(run: () => void): InlineFormulaRequest[] {
  const events: InlineFormulaRequest[] = []
  const listener = (event: Event) => events.push((event as CustomEvent<InlineFormulaRequest>).detail)
  window.addEventListener(INLINE_FORMULA_EVENT, listener)
  try { run() } finally { window.removeEventListener(INLINE_FORMULA_EVENT, listener) }
  return events
}

const formulasIn = (editor: Editor) => {
  const out: Array<{ parent: string; latex: string }> = []
  editor.state.doc.descendants((node, _pos, parent) => {
    if (node.type.name === 'formulaInline') out.push({ parent: parent!.type.name, latex: String(node.attrs.latex) })
  })
  return out
}

describe('行内公式：插入位置', () => {
  it.each(['stdParagraph', 'note', 'termDefinition', 'paragraph'])('%s 内可插入', name => {
    const editor = createEditor()
    select(editor, nodeStart(editor, name))
    expect(editor.commands.insertInlineFormula({ latex: 'x_{i}' })).toBe(true)
    expect(formulasIn(editor)).toEqual([{ parent: name, latex: 'x_{i}' }])
  })

  it.each(['chapterTitle', 'tableCaption', 'termName'])('%s（标题、图表题、术语名）内拒绝', name => {
    const editor = createEditor()
    select(editor, nodeStart(editor, name))
    expect(editor.commands.insertInlineFormula({ latex: 'x' })).toBe(false)
    expect(captureRequests(() => editor.commands.requestInlineFormula())).toEqual([])
  })
})

describe('行内公式：请求与选区转换', () => {
  it('无选区时请求在光标处插入', () => {
    const editor = createEditor()
    const pos = nodeStart(editor, 'note') + 2
    select(editor, pos)
    expect(captureRequests(() => expect(editor.commands.requestInlineFormula()).toBe(true)))
      .toEqual([{ mode: 'insert', pos, latex: '' }])
  })

  it('选中带下标的文字：用旧符号规则预填 LaTeX，确认后替换', () => {
    const editor = createEditor()
    const start = nodeStart(editor, 'stdParagraph') + 3
    select(editor, start, start + 2)
    const [request] = captureRequests(() => editor.commands.requestInlineFormula())
    expect(request).toEqual({ mode: 'replace', pos: start, to: start + 2, text: 'qV', latex: String.raw`q_{\mathrm{V}}` })
    expect(editor.commands.replaceSelectionWithFormula({ from: start, to: start + 2, text: 'qV', latex: 'q_{V}' })).toBe(true)
    expect(formulasIn(editor)).toEqual([{ parent: 'stdParagraph', latex: 'q_{V}' }])
    expect(editor.state.doc.textContent).toContain('流量  应大于 1。')
  })

  it('无法可靠转换的选区预填纯文字', () => {
    const editor = createEditor()
    const start = nodeStart(editor, 'termDefinition')
    select(editor, start, start + 2)
    const [request] = captureRequests(() => editor.commands.requestInlineFormula())
    expect(request).toEqual({ mode: 'replace', pos: start, to: start + 2, text: '单位', latex: '单位' })
  })

  it('选区文字在弹窗期间被改动时拒绝替换', () => {
    const editor = createEditor()
    const start = nodeStart(editor, 'note')
    expect(editor.commands.replaceSelectionWithFormula({ from: start, to: start + 2, text: '已变', latex: 'x' })).toBe(false)
    expect(formulasIn(editor)).toEqual([])
  })

  it('选区跨段落或含其他行内节点时不请求', () => {
    const editor = createEditor()
    select(editor, nodeStart(editor, 'stdParagraph'), nodeStart(editor, 'note') + 1)
    expect(captureRequests(() => expect(editor.commands.requestInlineFormula()).toBe(false))).toEqual([])
    const start = nodeStart(editor, 'stdParagraph')
    select(editor, start)
    editor.commands.insertInlineFormula({ latex: 'a' })
    select(editor, start, start + 2)
    expect(captureRequests(() => editor.commands.requestInlineFormula())).toEqual([])
  })

  it('快捷键 Mod-Shift-M 发出请求', () => {
    const editor = createEditor()
    select(editor, nodeStart(editor, 'note'))
    const isMac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    const events = captureRequests(() => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'M', keyCode: 77, shiftKey: true, metaKey: isMac, ctrlKey: !isMac, bubbles: true, cancelable: true,
    })))
    expect(events).toHaveLength(1)
    expect(events[0]!.mode).toBe('insert')
  })
})
