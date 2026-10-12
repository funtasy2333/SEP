// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { afterEach, expect, it } from 'vitest'
import { createEditorExtensions } from './editorExtensions'

function fixture() {
  return {
    type: 'doc',
    content: [
      {
        type: 'chapter',
        attrs: { nodeId: 'footnote-html-chapter' },
        content: [
          { type: 'chapterTitle', content: [{ type: 'text', text: '表脚注往返' }] },
          {
            type: 'stdTable',
            attrs: { nodeId: 'footnote-html-table' },
            content: [
              { type: 'tableCaption', content: [{ type: 'text', text: '测试表' }] },
              {
                type: 'table',
                content: [
                  {
                    type: 'tableRow',
                    attrs: { nodeId: 'footnote-html-row' },
                    content: [
                      {
                        type: 'tableCell',
                        attrs: { nodeId: 'footnote-html-cell' },
                        content: [{
                          type: 'paragraph',
                          content: [
                            { type: 'text', text: '数据' },
                            { type: 'tableFootnoteRef', attrs: { nodeId: 'footnote-html-ref', targetId: 'footnote-html-entry' } },
                          ],
                        }],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'tableFootnoteRow',
                content: [{
                  type: 'tableFootnoteEntry',
                  attrs: { nodeId: 'footnote-html-entry' },
                  content: [
                    { type: 'text', text: '含强调定义', marks: [{ type: 'bold' }] },
                    {
                      type: 'text',
                      text: '；见本章',
                      marks: [{ type: 'crossRef', attrs: { targetId: 'footnote-html-chapter', refType: 'chapter' } }],
                    },
                  ],
                }],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        attrs: { nodeId: 'ordinary-html-paragraph' },
        content: [{ type: 'text', text: '普通外部段落' }],
      },
    ],
  }
}

function domRoundtrip(editor: Editor, doc: any, displayLabel: string) {
  const container = document.createElement('div')
  container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content))
  const label = container.querySelector<HTMLElement>('[data-table-footnote-label]')
  expect(label).not.toBeNull()
  label!.textContent = displayLabel
  return DOMParser.fromSchema(editor.schema).parse(container)
}

function findNode(doc: any, typeName: string) {
  let result: any
  doc.descendants((node: any) => {
    if (!result && node.type.name === typeName) result = node
  })
  return result
}

function findNodeById(doc: any, id: string) {
  let result: any
  doc.descendants((node: any) => {
    if (!result && node.attrs.nodeId === id) result = node
  })
  return result
}

function findTextNode(node: any, text: string) {
  let result: any
  node.descendants((child: any) => {
    if (!result && child.isText && child.text === text) result = child
  })
  return result
}

afterEach(() => {
  document.body.replaceChildren()
})

it('preserves table footnote row, definition IDs, marks and targets across two production DOM round trips', () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: fixture() })
  try {
    const first = domRoundtrip(editor, editor.state.doc, '⑴')
    const second = domRoundtrip(editor, first, '展示编号 2')

    const chapter = findNode(second, 'chapter')
    const table = findNode(second, 'stdTable')
    const footnoteRow = findNode(second, 'tableFootnoteRow')
    const entry = findNode(second, 'tableFootnoteEntry')
    const ref = findNode(second, 'tableFootnoteRef')
    expect(chapter?.attrs.nodeId).toBe('footnote-html-chapter')
    expect(table?.child(table.childCount - 1).type.name).toBe('tableFootnoteRow')
    expect(footnoteRow?.childCount).toBe(1)
    expect(entry?.attrs.nodeId).toBe('footnote-html-entry')
    expect(entry?.textContent).toBe('含强调定义；见本章')
    expect(findTextNode(entry, '含强调定义')?.marks.map((mark: any) => mark.type.name)).toContain('bold')
    const crossRef = findTextNode(entry, '；见本章')?.marks.find((mark: any) => mark.type.name === 'crossRef')
    expect(crossRef?.attrs.targetId).toBe('footnote-html-chapter')
    expect(ref?.attrs.nodeId).toBe('footnote-html-ref')
    expect(ref?.attrs.targetId).toBe('footnote-html-entry')
    const ordinaryParagraph = findNodeById(second, 'ordinary-html-paragraph')
    expect(ordinaryParagraph?.type.name).toBe('paragraph')
    expect(ordinaryParagraph?.textContent).toBe('普通外部段落')
  } finally {
    editor.destroy()
  }
})

it('reads legacy typed footnote paragraphs without a content slot and excludes their display label', () => {
  const editor = new Editor({ extensions: createEditorExtensions(), content: fixture() })
  try {
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content))
    const entryElement = container.querySelector<HTMLElement>('p[data-type="table-footnote-entry"]')!
    const contentSlot = entryElement.querySelector<HTMLElement>(':scope > .std-table-footnote-entry-content')!
    entryElement.querySelector<HTMLElement>(':scope > [data-table-footnote-label]')!.textContent = '旧展示编号'
    for (const child of Array.from(contentSlot.childNodes)) entryElement.append(child.cloneNode(true))
    contentSlot.remove()

    const parsed = DOMParser.fromSchema(editor.schema).parse(container)
    const entry = findNode(parsed, 'tableFootnoteEntry')
    expect(entry?.attrs.nodeId).toBe('footnote-html-entry')
    expect(entry?.textContent).toBe('含强调定义；见本章')
    expect(entry?.textContent).not.toContain('旧展示编号')
    expect(findTextNode(entry, '含强调定义')?.marks.map((mark: any) => mark.type.name)).toContain('bold')
    const crossRef = findTextNode(entry, '；见本章')?.marks.find((mark: any) => mark.type.name === 'crossRef')
    expect(crossRef?.attrs.targetId).toBe('footnote-html-chapter')
  } finally {
    editor.destroy()
  }
})
