// @vitest-environment happy-dom
import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../editorExtensions'
import { semanticLabels } from '../../utils/semanticLabels'
import { CONTEXT_ONLY_DEFINING, STRUCTURAL_PASTE_ERROR_MESSAGE } from './structuralPaste'

/** #71：复制 SES 内容粘贴到另一条的开头与结尾，章条结构与编号一致且正确。 */

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  document.body.replaceChildren()
})

const p = (id: string, text: string): JSONContent => ({ type: 'stdParagraph', attrs: { nodeId: id }, content: [{ type: 'text', text }] })
const clause = (id: string, level: number, title: string, ...children: JSONContent[]): JSONContent => ({
  type: 'clause', attrs: { nodeId: id, level, hasTitle: title !== '' },
  content: [{ type: 'clauseTitle', attrs: { level }, content: title ? [{ type: 'text', text: title }] : [] }, ...children],
})
const chapter = (id: string, title: string, ...children: JSONContent[]): JSONContent => ({
  type: 'chapter', attrs: { nodeId: id }, content: [{ type: 'chapterTitle', content: [{ type: 'text', text: title }] }, ...children],
})

/** 有题条之间：4 要求（4.1 甲、4.2 乙），5 其他（5.1 丙）。 */
const titledDoc = (): JSONContent => ({ type: 'doc', content: [
  chapter('ch1', '要求',
    clause('c1', 1, '甲', p('p1', '采购代理机构按照相关法律法规，'), p('p1b', '第二段')),
    clause('c2', 1, '乙', p('p2', '第二条正文'))),
  chapter('ch2', '其他', clause('c3', 1, '丙', p('p3', '目标条正文'))),
] })

/** 多级无题条：1.1 一般（1.1.1、1.1.2 无题），1.2 程序。 */
const untitledDoc = (): JSONContent => ({ type: 'doc', content: [
  chapter('ch1', '要求',
    clause('c1', 1, '一般', clause('c11', 2, '', p('p11', '采购代理机构按照相关法律法规，')), clause('c12', 2, '', p('p12', '组织采购活动。'))),
    clause('c2', 1, '程序', p('p2', '目标条正文'))),
] })

function editor(content: JSONContent) {
  const e = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(e)
  return e
}

function textPos(e: Editor, text: string) {
  let pos = -1
  e.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = at + node.text!.indexOf(text)
  })
  if (pos < 0) throw new Error(`找不到文字 ${text}`)
  return pos
}

/** 以生产剪贴板序列化复制 [from, to) 的文字范围，返回剪贴板 HTML（含 data-pm-slice 的打开深度）。 */
function copy(e: Editor, from: string, to: string) {
  const slice = e.state.doc.slice(textPos(e, from), textPos(e, to) + to.length)
  return e.view.serializeForClipboard(slice).dom.innerHTML
}

function pasteInto(e: Editor, html: string, target: string, where: 'start' | 'end') {
  const pos = textPos(e, target) + (where === 'start' ? 0 : target.length)
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)))
  e.view.pasteHTML(html)
}

/** 章条结构 + 显示编号（无法解析的编号显示为“?”，与编辑器一致）+ 条的 level。 */
function outline(e: Editor): string[] {
  const { labels } = semanticLabels(e.getJSON() as never)
  const lines: string[] = []
  const visit = (node: typeof e.state.doc, depth: number) => node.forEach(child => {
    const indent = '  '.repeat(depth)
    if (child.type.name === 'chapter' || child.type.name === 'clause') {
      const level = child.type.name === 'clause' ? ` L${child.attrs.level}` : ''
      lines.push(`${indent}${labels[child.attrs.nodeId]?.label ?? '?'}${level} ${child.firstChild!.textContent || '（空标题）'}`)
      visit(child, depth + 1)
    } else if (child.type.name === 'stdParagraph') {
      lines.push(`${indent}¶${child.textContent}`)
    }
  })
  visit(e.state.doc, 0)
  return lines
}

it('章、条、附录、前言、引言只作为上下文 defining，不保留粘贴内容左侧的外壳', () => {
  const schema = getSchema(createEditorExtensions())
  for (const name of CONTEXT_ONLY_DEFINING) {
    const spec = schema.nodes[name]!.spec
    expect(spec.definingAsContext, name).toBe(true)
    expect(spec.defining, name).toBeFalsy()
    expect(spec.definingForContent, name).toBeFalsy()
  }
  // 标题节点保持原有 defining
  expect(schema.nodes.chapterTitle!.spec.defining).toBe(true)
  expect(schema.nodes.clauseTitle!.spec.defining).toBe(true)
})

describe('粘贴到另一条的开头与结尾', () => {
  const cases: Array<[string, () => JSONContent, [string, string], string, Record<'start' | 'end', string[]>]> = [
    ['单段内的文字', titledDoc, ['采购代理', '法律法规'], '目标条正文', {
      start: ['1 要求', '  1.1 L1 甲', '    ¶采购代理机构按照相关法律法规，', '    ¶第二段', '  1.2 L1 乙', '    ¶第二条正文',
        '2 其他', '  2.1 L1 丙', '    ¶采购代理机构按照相关法律法规目标条正文'],
      end: ['1 要求', '  1.1 L1 甲', '    ¶采购代理机构按照相关法律法规，', '    ¶第二段', '  1.2 L1 乙', '    ¶第二条正文',
        '2 其他', '  2.1 L1 丙', '    ¶目标条正文采购代理机构按照相关法律法规'],
    }],
    ['同一条内的多段', titledDoc, ['采购代理', '第二段'], '目标条正文', {
      start: ['2 其他', '  2.1 L1 丙', '    ¶采购代理机构按照相关法律法规，', '    ¶第二段目标条正文'],
      end: ['2 其他', '  2.1 L1 丙', '    ¶目标条正文采购代理机构按照相关法律法规，', '    ¶第二段'],
    }],
    ['跨两个有题条（含后一条的标题）', titledDoc, ['采购代理', '第二条'], '目标条正文', {
      start: ['2 其他', '  2.1 L1 丙', '    ¶采购代理机构按照相关法律法规，', '    ¶第二段', '  2.2 L1 乙', '    ¶第二条目标条正文'],
      end: ['2 其他', '  2.1 L1 丙', '    ¶目标条正文采购代理机构按照相关法律法规，', '    ¶第二段', '  2.2 L1 乙', '    ¶第二条'],
    }],
    ['跨两个二级无题条，粘贴到一级条', untitledDoc, ['采购代理', '活动。'], '目标条正文', {
      start: ['1 要求', '  1.1 L1 一般', '    1.1.1 L2 （空标题）', '      ¶采购代理机构按照相关法律法规，', '    1.1.2 L2 （空标题）', '      ¶组织采购活动。',
        '  1.2 L1 程序', '    ¶采购代理机构按照相关法律法规，', '  1.3 L1 （空标题）', '    ¶组织采购活动。目标条正文'],
      end: ['1 要求', '  1.1 L1 一般', '    1.1.1 L2 （空标题）', '      ¶采购代理机构按照相关法律法规，', '    1.1.2 L2 （空标题）', '      ¶组织采购活动。',
        '  1.2 L1 程序', '    ¶目标条正文采购代理机构按照相关法律法规，', '  1.3 L1 （空标题）', '    ¶组织采购活动。'],
    }],
  ]

  for (const [name, content, [from, to], target, expected] of cases) {
    for (const where of ['start', 'end'] as const) {
      it(`${name} → ${where === 'start' ? '开头' : '结尾'}：不生成空章、空条，编号可解析，粘贴的条按落点层级`, () => {
        const e = editor(content())
        const original = outline(e)
        pasteInto(e, copy(e, from, to), target, where)
        const pasted = outline(e)
        const tail = expected[where]
        expect(pasted.slice(pasted.length - tail.length)).toEqual(tail)
        expect(pasted.join('\n')).not.toContain('?')
        // 没有新增章，也没有空标题的章（编辑器中显示为“请输入章标题”）
        expect(e.state.doc.content.content.filter(node => node.type.name === 'chapter')).toHaveLength(content().content!.length)
        expect(pasted.filter(line => !line.includes(' L') && line.endsWith('（空标题）'))).toEqual([])
        // 撤销恢复原状，重做与保存重开一致
        e.commands.undo()
        expect(outline(e)).toEqual(original)
        e.commands.redo()
        expect(outline(e)).toEqual(pasted)
        expect(outline(editor(JSON.parse(JSON.stringify(e.getJSON()))))).toEqual(pasted)
      })
    }
  }

  it('开头与结尾粘贴得到相同的章条结构（只有光标两侧文字的先后不同）', () => {
    const shape = (where: 'start' | 'end') => {
      const e = editor(titledDoc())
      pasteInto(e, copy(e, '采购代理', '第二条'), '目标条正文', where)
      return outline(e).map(line => line.replace(/¶.*/, '¶'))
    }
    expect(shape('start')).toEqual(shape('end'))
  })
})

describe('带章标题的内容不能粘贴进章条内部', () => {
  it.each(['start', 'end'] as const)('跨章复制（含后一章的章标题）粘贴到条的%s：拒绝并提示，文档不变', (where) => {
    const e = editor(titledDoc())
    const html = copy(e, '第二条', '目标条')
    const target = '第二段'
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, textPos(e, target))))
    const before = JSON.stringify(e.getJSON())
    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<{ message: string }>).detail.message)
    window.addEventListener('ses:paste-reference-error', listener)
    try {
      pasteInto(e, html, target, where)
    } finally {
      window.removeEventListener('ses:paste-reference-error', listener)
    }
    expect(messages).toEqual([STRUCTURAL_PASTE_ERROR_MESSAGE])
    expect(JSON.stringify(e.getJSON())).toBe(before)
  })
})
