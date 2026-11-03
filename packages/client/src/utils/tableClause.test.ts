// @vitest-environment happy-dom
import { Editor, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../extensions/editorExtensions'
import { semanticLabels } from './semanticLabels'
import { insertParagraphAfterTable, setClauseFormat, structureFailureMessage } from './structureEditing'

/** #73：表格之后插入新的条 / 正文段。 */

const editors: Editor[] = []
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()) })

const p = (id: string, text: string): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [{ type: 'text', text }] })
const clause = (id: string, level: number, title: string, ...children: JSONContent[]): JSONContent => ({
  type: 'clause', attrs: { nodeId: id, level, hasTitle: true },
  content: [{ type: 'clauseTitle', attrs: { level }, content: [{ type: 'text', text: title }] }, ...children],
})
const table = (id: string): JSONContent => ({ type: 'stdTable', attrs: { nodeId: id }, content: [
  { type: 'tableCaption', content: [{ type: 'text', text: `表${id}` }] },
  { type: 'table', content: [0, 1].map(r => ({ type: 'tableRow', content: [0, 1].map(c => ({
    type: r === 0 ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${id}格${r}${c}` }] }],
  })) })) },
] })
const chapter = (id: string, title: string, ...children: JSONContent[]): JSONContent => ({
  type: 'chapter', attrs: { nodeId: id }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: title }] }, ...children],
})

/** 真实按键：经 handleKeyDown 派发（tiptap 的 keyboardShortcut 命令只回放步骤、不回放选区）。 */
function pressModEnter(e: Editor) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }) // 测试环境非 macOS：Mod 即 Ctrl
  return e.view.someProp('handleKeyDown', handler => handler(e.view, event))
}

function editor(...chapters: JSONContent[]) {
  const e = new Editor({ extensions: createEditorExtensions(), content: { type: 'doc', content: chapters } })
  editors.push(e)
  return e
}

function cursorAt(e: Editor, text: string) {
  let pos = -1
  e.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = at + node.text!.indexOf(text)
  })
  if (pos < 0) throw new Error(`找不到文字 ${text}`)
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)))
}

/** 结构 + 编号：条显示为“编号 标题/首段”，用于断言新条的位置与前后编号。 */
function outline(e: Editor): string[] {
  const { labels } = semanticLabels(e.getJSON() as never)
  const lines: string[] = []
  const visit = (node: typeof e.state.doc, depth: number) => node.forEach(child => {
    const indent = '  '.repeat(depth)
    if (child.type.name === 'clause') {
      lines.push(`${indent}${labels[child.attrs.nodeId]?.label ?? '?'} ${child.firstChild!.textContent || '（无题）'}`)
      visit(child, depth + 1)
    } else if (child.type.name === 'chapter') {
      lines.push(`${indent}${labels[child.attrs.nodeId]?.label ?? '?'} ${child.firstChild!.textContent}`)
      visit(child, depth + 1)
    } else if (child.type.name === 'stdTable') {
      lines.push(`${indent}[${child.firstChild!.textContent}]`)
    } else if (child.type.name === 'stdParagraph') {
      lines.push(`${indent}¶${child.textContent}`)
    }
  })
  visit(e.state.doc, 0)
  return lines
}

const tableJson = (e: Editor, id: string) => JSON.stringify(e.getJSON().content!.flatMap(function find(node: JSONContent): JSONContent[] {
  return node.attrs?.nodeId === id ? [node] : (node.content ?? []).flatMap(find)
}))

describe('在表格之后插入同级新条', () => {
  it.each([
    ['条末（其后还有同级条）', () => editor(
      chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1')), clause('c2', 1, '乙', p('p2', '乙正文'))),
    ), ['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '  1.2 （无题）', '  1.3 乙', '    ¶乙正文']],
    ['章末（表格在该章最后一条的末尾，其后是下一章）', () => editor(
      chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1'))), chapter('ch2', '试验', p('p2', '试验正文')),
    ), ['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '  1.2 （无题）', '2 试验', '  ¶试验正文']],
    ['文档正文末尾', () => editor(
      chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1'))),
    ), ['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '  1.2 （无题）']],
  ])('%s：光标在单元格内选择一级条，新条出现在表格外，原表格不变', (_name, create, expected) => {
    const e = create()
    cursorAt(e, 'T1格11')
    const before = tableJson(e, 'T1')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(outline(e)).toEqual(expected)
    expect(tableJson(e, 'T1')).toBe(before)
    // 光标进入新条的标题，输入不会进入单元格
    expect(e.state.selection.$from.parent.type.name).toBe('clauseTitle')
    e.commands.insertContent('新条标题')
    expect(outline(e)).toContain('  1.2 新条标题')
    expect(tableJson(e, 'T1')).toBe(before)
  })

  it('光标在表标题中也在表格之后新建条；撤销、重做、保存重开后结构正确', () => {
    const e = editor(chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1')), clause('c2', 1, '乙', p('p2', '乙正文'))))
    const original = outline(e)
    cursorAt(e, '表T1')
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    const after = outline(e)
    expect(after).toEqual(['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '  1.2 （无题）', '  1.3 乙', '    ¶乙正文'])
    e.commands.undo()
    expect(outline(e)).toEqual(original)
    e.commands.redo()
    expect(outline(e)).toEqual(after)
    const reopened = new Editor({ extensions: createEditorExtensions(), content: JSON.parse(JSON.stringify(e.getJSON())) })
    editors.push(reopened)
    expect(outline(reopened)).toEqual(after)
  })

  it('表格在子条末尾：可插入同级子条，也可插入上一级的同级条', () => {
    const create = () => editor(chapter('ch', '要求', clause('c1', 1, '甲', clause('c11', 2, '甲一', p('p11', '甲一正文'), table('T1')))))
    const sub = create()
    cursorAt(sub, 'T1格00')
    expect(setClauseFormat(sub, 2)).toEqual({ ok: true })
    expect(outline(sub)).toEqual(['1 要求', '  1.1 甲', '    1.1.1 甲一', '      ¶甲一正文', '      [表T1]', '    1.1.2 （无题）'])
    const upper = create()
    cursorAt(upper, 'T1格00')
    expect(setClauseFormat(upper, 1)).toEqual({ ok: true })
    expect(outline(upper)).toEqual(['1 要求', '  1.1 甲', '    1.1.1 甲一', '      ¶甲一正文', '      [表T1]', '  1.2 （无题）'])
  })

  it('无题条：在表格之后新建无题条，光标进入其正文段', () => {
    const e = editor(chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1'))))
    cursorAt(e, 'T1格11')
    expect(setClauseFormat(e, 1, false)).toEqual({ ok: true })
    const created = e.state.selection.$from.node(-1)
    expect(created.type.name).toBe('clause')
    expect(created.attrs.hasTitle).toBe(false)
    expect(e.state.selection.$from.parent.type.name).toBe('stdParagraph')
    e.commands.insertContent('无题条正文')
    expect(outline(e)).toEqual(['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '  1.2 （无题）', '    ¶无题条正文'])
  })

  it('不合法的层级仍按大纲规则拒绝，文档不变：含直属正文和表格的条里不能新设子条（悬置段）', () => {
    const e = editor(chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1'))))
    cursorAt(e, 'T1格11')
    const before = JSON.stringify(e.getJSON())
    expect(setClauseFormat(e, 2)).toEqual({ ok: false, reason: 'hanging-paragraph' })
    expect(setClauseFormat(e, 3)).toEqual({ ok: false, reason: 'level-skip' })
    expect(JSON.stringify(e.getJSON())).toBe(before)
  })
})

describe('在表格之后插入正文段（不新建条）', () => {
  it('表格菜单命令：正文段在同一条内、表格之后，光标进入后可输入，再设为条得到同级新条', () => {
    const e = editor(chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1')), clause('c2', 1, '乙', p('p2', '乙正文'))))
    cursorAt(e, 'T1格01')
    const before = tableJson(e, 'T1')
    expect(insertParagraphAfterTable(e)).toEqual({ ok: true })
    e.commands.insertContent('表后说明')
    expect(outline(e)).toEqual(['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '    ¶表后说明', '  1.2 乙', '    ¶乙正文'])
    expect(tableJson(e, 'T1')).toBe(before)
    // 表后正文段与“新条”是两种操作：继续把这一段设为一级条，得到 1.2，原 1.2 顺延为 1.3
    expect(setClauseFormat(e, 1)).toEqual({ ok: true })
    expect(outline(e)).toEqual(['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '  1.2 表后说明', '  1.3 乙', '    ¶乙正文'])
  })

  it('章内没有条时也能在表格之后继续书写正文', () => {
    const e = editor(chapter('ch', '范围', p('p1', '范围正文'), table('T1')))
    cursorAt(e, 'T1格11')
    expect(insertParagraphAfterTable(e)).toEqual({ ok: true })
    e.commands.insertContent('续写')
    expect(outline(e)).toEqual(['1 范围', '  ¶范围正文', '  [表T1]', '  ¶续写'])
  })

  it('Mod-Enter：表格内在表格之后插入正文段，表格外仍是换行', () => {
    const e = editor(chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'), table('T1'))))
    cursorAt(e, 'T1格11')
    expect(pressModEnter(e)).toBe(true)
    expect(e.state.selection.$from.parent.type.name).toBe('stdParagraph')
    expect(outline(e)).toEqual(['1 要求', '  1.1 甲', '    ¶甲正文', '    [表T1]', '    ¶'])
    cursorAt(e, '甲正文')
    expect(pressModEnter(e)).toBe(true)
    let breaks = 0
    e.state.doc.descendants(node => { if (node.type.name === 'hardBreak') breaks += 1 })
    expect(breaks).toBe(1)
  })

  it('光标不在表格内时给出提示，文档不变', () => {
    const e = editor(chapter('ch', '要求', clause('c1', 1, '甲', p('p1', '甲正文'))))
    cursorAt(e, '甲正文')
    const before = JSON.stringify(e.getJSON())
    const result = insertParagraphAfterTable(e)
    expect(result).toEqual({ ok: false, reason: 'not-in-table' })
    expect(structureFailureMessage('not-in-table', 'table')).toBe('请先将光标置于表格内')
    expect(JSON.stringify(e.getJSON())).toBe(before)
  })
})
