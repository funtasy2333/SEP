// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { pmToIr, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../editorExtensions'
import { serializeToXml } from '../../serializer/xmlSerializer'
import { buildDocxBlob } from '../../serializer/docxExporter'

type TermFields = {
  termEn?: string
  annotations?: Array<'note' | 'example'>
  definition?: string | Array<{
    type: 'text'
    text: string
    marks?: Array<{ type: 'bold' | 'italic' }>
  }>
}

type JsonNode = {
  type: string
  text?: string
  marks?: Array<{ type: string }>
  content?: JsonNode[]
}

function createEditor(fields: TermFields = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(),
    content: {
      type: 'doc',
      content: [{
        type: 'chapter',
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '术语和定义' }] },
          {
            type: 'termDef',
            attrs: { level: 1 },
            content: [
              { type: 'termName', content: [{ type: 'text', text: '中文术语' }] },
              ...(fields.termEn === undefined ? [] : [{
                type: 'termNameEn',
                content: [{ type: 'text', text: fields.termEn }],
              }]),
              {
                type: 'termDefinition',
                content: typeof fields.definition === 'string' || fields.definition === undefined
                  ? [{ type: 'text', text: fields.definition ?? '定义前后文' }]
                  : fields.definition,
              },
              ...(fields.annotations ?? []).map(type => ({
                type, content: [{ type: 'text', text: `原${type}内容` }],
              })),
            ],
          },
        ],
      }],
    },
  })
  return {
    editor,
    destroy() {
      editor.destroy()
      element.remove()
    },
  }
}

function setCaret(editor: Editor, nodeName: string, offset: number, occurrence = 0): void {
  let pos: number | undefined
  let seen = 0
  editor.state.doc.descendants((node, nodePos) => {
    if (pos === undefined && node.type.name === nodeName && seen++ === occurrence) {
      pos = nodePos + 1 + offset
      return false
    }
    return pos === undefined
  })
  if (pos === undefined) throw new Error(`找不到节点 ${nodeName}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

function setTextSelection(editor: Editor, nodeName: string, fromOffset: number, toOffset: number): void {
  let from: number | undefined
  let to: number | undefined
  editor.state.doc.descendants((node, nodePos) => {
    if (from === undefined && node.type.name === nodeName) {
      from = nodePos + 1 + fromOffset
      to = nodePos + 1 + toOffset
      return false
    }
    return from === undefined
  })
  if (from === undefined || to === undefined) throw new Error(`找不到节点 ${nodeName}`)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
}

function press(editor: Editor, key: string, shiftKey = false): void {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  }))
}

function childrenOfTermDef(editor: Editor): string[] {
  const types: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'termDef') {
      node.forEach((child) => types.push(child.type.name))
      return false
    }
    return true
  })
  return types
}

function termNode(editor: Editor): JsonNode | undefined {
  let result: JsonNode | undefined
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'termDef') {
      result = node.toJSON() as JsonNode
      return false
    }
    return true
  })
  return result
}

describe('真实 Tiptap 术语编辑器的键盘行为', () => {
  it('末尾注/示例不阻止连续两次 Enter 退出，注/示例和定义保持在原术语内', () => {
    for (const annotations of [['note'], ['example'], ['note', 'example']] as Array<Array<'note' | 'example'>>) {
      const { editor, destroy } = createEditor({ definition: '原定义', annotations })
      try {
        setCaret(editor, 'termDefinition', 3)
        const originalAnnotations = termNode(editor)?.content?.filter(node => annotations.includes(node.type as 'note' | 'example'))
        press(editor, 'Enter')
        expect(childrenOfTermDef(editor)).toEqual(['termName', 'termDefinition', 'stdParagraph', ...annotations])
        press(editor, 'Enter')
        expect(childrenOfTermDef(editor)).toEqual(['termName', 'termDefinition', ...annotations])
        expect(termNode(editor)?.content?.filter(node => annotations.includes(node.type as 'note' | 'example'))).toEqual(originalAnnotations)
        const chapter = editor.state.doc.firstChild!
        expect(chapter.lastChild?.type.name).toBe('stdParagraph')
        expect(editor.state.selection.$from.node(editor.state.selection.$from.depth - 1).type.name).toBe('chapter')
        expect(chapter.child(1).textContent).toBe('中文术语原定义' + annotations.map(type => `原${type}内容`).join(''))
        editor.state.doc.check()
      } finally { destroy() }
    }
  })
  it('Enter 从中文名或英文名进入下一行定义，并保留已有术语内容', () => {
    const { editor, destroy } = createEditor({ termEn: 'English term' })
    try {
      setCaret(editor, 'termName', 2)
      press(editor, 'Enter')
      expect(editor.state.selection.$from.parent.type.name).toBe('termDefinition')
      expect(editor.getText()).toContain('中文术语')
      expect(editor.getText()).toContain('English term')

      setCaret(editor, 'termNameEn', 2)
      press(editor, 'Enter')
      expect(editor.state.selection.$from.parent.type.name).toBe('termDefinition')
      expect(editor.getText()).toContain('English term')
    } finally {
      destroy()
    }
  })

  it('没有英文名时，中文名 Enter 直接进入定义', () => {
    const { editor, destroy } = createEditor()
    try {
      setCaret(editor, 'termName', 2)
      press(editor, 'Enter')
      expect(editor.state.selection.$from.parent.type.name).toBe('termDefinition')
      expect(childrenOfTermDef(editor)).toEqual(['termName', 'termDefinition'])
      expect(editor.state.doc.textContent).toContain('中文术语定义前后文')
    } finally {
      destroy()
    }
  })

  it('Tab 在中文名与英文名之间导航，可创建可选英文名；英文名可返回中文并继续到定义', () => {
    const { editor, destroy } = createEditor()
    try {
      setCaret(editor, 'termName', 2)
      press(editor, 'Tab')
      expect(childrenOfTermDef(editor)).toEqual(['termName', 'termNameEn', 'termDefinition'])
      expect(editor.state.selection.$from.parent.type.name).toBe('termNameEn')

      editor.commands.insertContentAt(
        editor.state.selection.from,
        'English term',
      )
      press(editor, 'Tab')
      expect(editor.state.selection.$from.parent.type.name).toBe('termDefinition')

      setCaret(editor, 'termNameEn', 3)
      press(editor, 'Tab', true)
      expect(editor.state.selection.$from.parent.type.name).toBe('termName')
      expect(editor.getText()).toContain('中文术语')
      expect(editor.getText()).toContain('English term')
    } finally {
      destroy()
    }
  })

  it('Enter 在定义中拆成兼容的 termDefinition 和 stdParagraph，删除选区并保留后半文字及 marks', async () => {
    const { editor, destroy } = createEditor({
      definition: [{ type: 'text', text: '定义前后文', marks: [{ type: 'bold' }] }],
    })
    try {
      setTextSelection(editor, 'termDefinition', 2, 3)
      press(editor, 'Enter')
      expect(childrenOfTermDef(editor)).toEqual(['termName', 'termDefinition', 'stdParagraph'])
      expect(editor.state.selection.$from.parent.type.name).toBe('stdParagraph')
      expect(editor.state.doc.textContent).toContain('定义后文')
      const term = termNode(editor)
      expect(term?.content?.[1]?.type).toBe('termDefinition')
      expect(term?.content?.[2]?.type).toBe('stdParagraph')
      expect(term?.content?.[1]?.content?.[0]).toMatchObject({ text: '定义', marks: [{ type: 'bold' }] })
      expect(term?.content?.[2]?.content?.[0]).toMatchObject({ text: '后文', marks: [{ type: 'bold' }] })
      const splitJson = editor.getJSON()
      expect(editor.schema.nodeFromJSON(splitJson).toJSON()).toEqual(splitJson)

      editor.commands.insertContentAt(editor.state.selection.from, '续段')
      const jsonTerm = termNode(editor)
      expect(jsonTerm?.content?.[2]?.type).toBe('stdParagraph')
      expect(jsonTerm?.content?.[2]?.content?.map((node) => node.text).join('')).toBe('续段后文')

      const editorJson = editor.getJSON()
      const pmDoc: PMJsonNode = {
        type: 'standardDoc',
        attrs: { standardType: 'national', titleCn: '术语测试' },
        content: editorJson.content,
      }
      const { doc: ir, warnings } = pmToIr(pmDoc)
      expect(warnings.some((warning) => warning.includes('术语条目'))).toBe(false)
      const entry = ir.body[0]?.children.find((child) => child.kind === 'termEntry')
      expect(entry?.kind).toBe('termEntry')
      if (entry?.kind === 'termEntry') {
        expect(entry.definition.map((paragraph) => {
          if (paragraph.kind !== 'paragraph') throw new Error('术语定义续段应映射为普通段落')
          return paragraph.content.map((inline) => inline.text).join('')
        }))
          .toEqual(['定义', '续段后文'])
      }

      const xml = serializeToXml(editor.state.doc)
      expect(xml).toMatch(/<def>\s*<p><bold>定义<\/bold><\/p>\s*<\/def>/)
      expect(xml).toContain('<p><bold>续段后文</bold></p>')

      const { blob } = await buildDocxBlob({ pmDoc, createdAt: '2026-10-02T00:00:00Z' })
      const zip = await JSZip.loadAsync(await blob.arrayBuffer())
      const docxXml = await zip.file('word/document.xml')!.async('string')
      const textRuns = Array.from(docxXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g), (match) => match[1])
      expect(textRuns).toContain('定义')
      expect(textRuns).toContain('续段后文')
      expect(textRuns.indexOf('定义')).toBeLessThan(textRuns.indexOf('续段后文'))
    } finally {
      destroy()
    }
  })

  it('续段可继续 Enter；末尾空续段 Enter 退出术语并建立普通段落', () => {
    const { editor, destroy } = createEditor({ definition: '前后' })
    try {
      setCaret(editor, 'termDefinition', 1)
      press(editor, 'Enter')
      expect(childrenOfTermDef(editor)).toEqual(['termName', 'termDefinition', 'stdParagraph'])
      expect(editor.state.selection.$from.parent.type.name).toBe('stdParagraph')

      setCaret(editor, 'stdParagraph', 1)
      press(editor, 'Enter')
      expect(childrenOfTermDef(editor)).toEqual(['termName', 'termDefinition', 'stdParagraph', 'stdParagraph'])

      setCaret(editor, 'stdParagraph', 0, 1)
      press(editor, 'Enter')
      expect(childrenOfTermDef(editor)).toEqual(['termName', 'termDefinition', 'stdParagraph'])
      const chapter = editor.state.doc.firstChild!
      expect(chapter.child(chapter.childCount - 1).type.name).toBe('stdParagraph')
      expect(chapter.lastChild?.textContent).toBe('')
      expect(editor.state.selection.$from.parent.type.name).toBe('stdParagraph')
    } finally {
      destroy()
    }
  })
})
