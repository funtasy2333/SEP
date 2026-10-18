// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { pmToIr, type IRFormula, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from './editorExtensions'
import { buildDocxBlob } from '../serializer/docxExporter'

type Json = PMJsonNode
const text = (value: string): Json => ({ type: 'text', text: value })
const symbolNode = (latex: string): Json => ({ type: 'formulaInline', attrs: { latex } })
const item = (term: Json[], definition: string): Json => ({
  type: 'whereItem', content: [
    { type: 'whereTerm', content: term },
    { type: 'whereDefinition', content: definition ? [text(definition)] : [] },
  ],
})

function formulaDoc(children: Json[] = []): Json {
  return {
    type: 'doc', content: [{ type: 'chapter', content: [
      { type: 'chapterTitle', content: [text('计算')] },
      { type: 'formula', content: [{ type: 'formulaContent', content: [text('q_{V}=Av')] }, ...children] },
    ] }],
  }
}

const editors: Editor[] = []
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

function createEditor(content: Json): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: createEditorExtensions(), content })
  editors.push(editor)
  return editor
}

/** 把光标放进第 index 个 nodeName 节点内，offset 为相对内容起点的偏移（-1 表示末尾）。 */
function placeCursor(editor: Editor, nodeName: string, index = 0, offset = 0): void {
  let seen = 0
  let target: number | undefined
  editor.state.doc.descendants((node, pos) => {
    if (target !== undefined) return false
    if (node.type.name === nodeName && seen++ === index) {
      target = pos + 1 + (offset < 0 ? node.content.size : offset)
      return false
    }
    return true
  })
  if (target === undefined) throw new Error(`找不到节点 ${nodeName}[${index}]`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)))
}

function press(editor: Editor, key: string, shiftKey = false): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
}

function formulaJson(editor: Editor): Json {
  return (editor.getJSON() as Json).content![0]!.content!.find(node => node.type === 'formula')!
}

const childTypes = (node: Json) => (node.content ?? []).map(child => child.type)
const whereItems = (editor: Editor) => formulaJson(editor).content!.find(node => node.type === 'whereList')?.content ?? []
const parentName = (editor: Editor) => editor.state.selection.$from.parent.type.name

describe('结构化式中：命令', () => {
  it('公式内添加式中：没有式中列表时在公式末尾新建一条，光标进入符号', () => {
    const editor = createEditor(formulaDoc())
    placeCursor(editor, 'formulaContent')
    expect(editor.commands.addWhereItem()).toBe(true)
    expect(childTypes(formulaJson(editor))).toEqual(['formulaContent', 'whereList'])
    expect(whereItems(editor).map(childTypes)).toEqual([['whereTerm', 'whereDefinition']])
    expect(parentName(editor)).toBe('whereTerm')
  })

  it('已有式中列表时追加到末尾', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([symbolNode('q_{V}')], '体积流量')] }]))
    placeCursor(editor, 'whereDefinition')
    expect(editor.commands.addWhereItem()).toBe(true)
    expect(whereItems(editor)).toHaveLength(2)
    expect(parentName(editor)).toBe('whereTerm')
    expect(editor.state.selection.$from.parent.childCount).toBe(0)
  })

  it('空的自由文本式中会被替换，不与结构化式中并存', () => {
    const editor = createEditor(formulaDoc([{ type: 'formulaDescription' }]))
    placeCursor(editor, 'formulaContent')
    expect(editor.commands.addWhereItem()).toBe(true)
    expect(childTypes(formulaJson(editor))).toEqual(['formulaContent', 'whereList'])
  })

  it('已有非空自由文本式中时拒绝添加，文档不变（交由一键转换处理）', () => {
    const editor = createEditor(formulaDoc([{ type: 'formulaDescription', content: [text('式中：A——面积；')] }]))
    placeCursor(editor, 'formulaContent')
    const before = JSON.stringify(editor.getJSON())
    expect(editor.commands.addWhereItem()).toBe(false)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('公式以外的位置不能添加式中', () => {
    const editor = createEditor(formulaDoc())
    placeCursor(editor, 'chapterTitle')
    expect(editor.commands.addWhereItem()).toBe(false)
  })

  it('在符号格插入行内公式；公式源码内拒绝', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([], '体积流量')] }]))
    placeCursor(editor, 'formulaContent')
    expect(editor.commands.insertInlineFormula({ latex: 'q_{V}' })).toBe(false)
    placeCursor(editor, 'whereTerm')
    expect(editor.commands.insertInlineFormula({ latex: 'q_{V}' })).toBe(true)
    const term = whereItems(editor)[0]!.content![0]!
    expect(term.content).toEqual([expect.objectContaining({ type: 'formulaInline', attrs: expect.objectContaining({ latex: 'q_{V}' }) })])
  })

  it('更新行内公式时写入新 LaTeX，并清空 MathML 与外部源', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([
      { type: 'formulaInline', attrs: { latex: 'q', mathml: '<math><mi>q</mi></math>', source: 'old' } },
    ], '体积流量')] }]))
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'formulaInline') pos = nodePos })
    expect(editor.commands.updateFormulaInline({ pos, latex: 'q_{m}' })).toBe(true)
    expect(editor.state.doc.nodeAt(pos)!.attrs).toEqual(expect.objectContaining({ latex: 'q_{m}', mathml: null, source: null }))
    expect(editor.commands.updateFormulaInline({ pos: 1, latex: 'x' })).toBe(false)
  })

  it('更新时核对节点 ID：位置上已是另一个符号（如远端修改后）则拒绝', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([
      { type: 'formulaInline', attrs: { nodeId: 'sym-a', latex: 'a' } },
    ], '甲')] }]))
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'formulaInline') pos = nodePos })
    expect(editor.commands.updateFormulaInline({ pos, latex: 'b', nodeId: 'sym-other' })).toBe(false)
    expect(editor.state.doc.nodeAt(pos)!.attrs.latex).toBe('a')
    expect(editor.commands.updateFormulaInline({ pos, latex: 'b', nodeId: 'sym-a' })).toBe(true)
  })
})

describe('结构化式中：键盘', () => {
  it('符号格按 Enter 或 Tab 跳到释义；释义按 Shift-Tab 回到符号', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([text('A')], '面积')] }]))
    placeCursor(editor, 'whereTerm', 0, -1)
    press(editor, 'Enter')
    expect(parentName(editor)).toBe('whereDefinition')
    press(editor, 'Tab', true)
    expect(parentName(editor)).toBe('whereTerm')
    press(editor, 'Tab')
    expect(parentName(editor)).toBe('whereDefinition')
    expect(whereItems(editor)).toHaveLength(1)
  })

  it('释义按 Enter 在下方新建一条，光标进入新符号格', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([text('A')], '面积'), item([text('v')], '流速')] }]))
    placeCursor(editor, 'whereDefinition', 0, -1)
    press(editor, 'Enter')
    const items = whereItems(editor)
    expect(items).toHaveLength(3)
    expect(items[1]!.content!.every(child => !child.content?.length)).toBe(true)
    expect(parentName(editor)).toBe('whereTerm')
    const { $from } = editor.state.selection
    expect($from.index($from.depth - 2)).toBe(1)
  })

  it('空条目开头按 Backspace 删除该条；最后一条删除时连同式中列表一起删除', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([text('A')], '面积'), item([], '')] }]))
    placeCursor(editor, 'whereTerm', 1)
    press(editor, 'Backspace')
    expect(whereItems(editor)).toHaveLength(1)
    expect(parentName(editor)).toBe('whereDefinition')

    const single = createEditor(formulaDoc([{ type: 'whereList', content: [item([], '')] }]))
    placeCursor(single, 'whereDefinition')
    press(single, 'Backspace')
    expect(childTypes(formulaJson(single))).toEqual(['formulaContent'])
  })

  it('非空释义开头按 Backspace 只把光标移回符号格，不合并', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([text('A')], '面积')] }]))
    placeCursor(editor, 'whereDefinition')
    press(editor, 'Backspace')
    expect(parentName(editor)).toBe('whereTerm')
    expect(whereItems(editor)[0]!.content!.map(child => child.content?.[0]?.text)).toEqual(['A', '面积'])
  })

  it('选中行内公式按 Enter 请求编辑', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([symbolNode('q_{V}')], '体积流量')] }]))
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'formulaInline') pos = nodePos })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    const events: unknown[] = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener('ses:edit-inline-formula', listener)
    press(editor, 'Enter')
    window.removeEventListener('ses:edit-inline-formula', listener)
    expect(events).toEqual([{ mode: 'edit', pos, latex: 'q_{V}', nodeId: expect.any(String) }])
  })
})

describe('结构化式中：显示', () => {
  it('行内公式以 KaTeX 行内模式显示，点击请求编辑', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([symbolNode('q_{V}')], '体积流量')] }]))
    // 与真实编辑器载入后一致：任一事务触发 ensureNodeId 补齐 ID。
    editor.view.dispatch(editor.state.tr)
    const dom = editor.view.dom.querySelector('.std-formula-inline') as HTMLElement
    expect(dom.querySelector('.katex')).not.toBeNull()
    expect(dom.querySelector('.katex-display')).toBeNull()
    const events: Array<{ mode: string; latex: string }> = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener('ses:edit-inline-formula', listener)
    dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    window.removeEventListener('ses:edit-inline-formula', listener)
    expect(events).toEqual([expect.objectContaining({ mode: 'edit', latex: 'q_{V}', nodeId: expect.any(String) })])
  })

  it('无法解析的 LaTeX 显示为源码并标记错误', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([symbolNode(String.raw`\frac{`)], '错')] }]))
    const dom = editor.view.dom.querySelector('.std-formula-inline') as HTMLElement
    expect(dom.classList.contains('is-invalid')).toBe(true)
    expect(dom.textContent).toBe(String.raw`\frac{`)
  })

  it('空符号格带占位标记，点击请求插入符号', () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([], '体积流量')] }]))
    const term = editor.view.dom.querySelector('[data-type="where-term"]') as HTMLElement
    expect(term.classList.contains('where-term-empty')).toBe(true)
    let termPos = -1
    editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'whereTerm') termPos = nodePos })
    const events: unknown[] = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener('ses:edit-inline-formula', listener)
    const handled = editor.view.someProp('handleClickOn', handler => handler(
      editor.view, termPos + 1, editor.state.doc.nodeAt(termPos)!, termPos, new MouseEvent('click'), true,
    ))
    window.removeEventListener('ses:edit-inline-formula', listener)
    expect(handled).toBe(true)
    expect(events).toEqual([{ mode: 'insert', pos: termPos + 1, latex: '' }])
  })
})

describe('结构化式中：往返与导出', () => {
  it('编辑器 JSON → IR 得到公式符号，DOCX 中写为 OMML', async () => {
    const editor = createEditor(formulaDoc([{ type: 'whereList', content: [item([symbolNode('q_{V}')], '体积流量')] }]))
    const json = editor.getJSON() as Json
    const formula = pmToIr(json).doc.body[0]!.children[0] as IRFormula
    expect(formula.whereList[0]!.term).toEqual([{ text: '', formula: { id: expect.any(String), latex: 'q_{V}' } }])
    const { blob } = await buildDocxBlob({ pmDoc: json, documentMeta: { titleCn: '计算', standardType: 'national' } })
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string')
    expect(xml).toMatch(/SesWhereItem[\s\S]*?<m:oMath[\s\S]*?<\/m:oMath><w:r><w:tab\/><\/w:r>/)
  })
})

describe('结构化式中：旧式中转换写回编辑器', () => {
  it('替换后条目与符号由 ensureNodeId 分配新 ID，可撤销', async () => {
    const { convertLegacyWhereDescription } = await import('../utils/whereListConversion')
    const editor = createEditor(formulaDoc([{ type: 'formulaDescription', content: [text('式中：A——面积；v——流速。')] }]))
    let pos = -1
    editor.state.doc.descendants((node, nodePos) => { if (node.type.name === 'formula') pos = nodePos })
    const node = editor.state.doc.nodeAt(pos)!
    const { formula } = convertLegacyWhereDescription(node.toJSON() as Json)
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodeFromJSON(formula)))
    const ids: string[] = []
    editor.state.doc.descendants(child => {
      if (child.type.name === 'whereItem' || child.type.name === 'formulaInline') ids.push(String(child.attrs.nodeId ?? ''))
    })
    expect(ids).toHaveLength(4)
    expect(ids.every(id => id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(4)
    expect(pmToIr(editor.getJSON() as Json).doc.unsupportedContent).toBeUndefined()
    editor.commands.undo()
    expect(childTypes(formulaJson(editor))).toEqual(['formulaContent', 'formulaDescription'])
  })
})
