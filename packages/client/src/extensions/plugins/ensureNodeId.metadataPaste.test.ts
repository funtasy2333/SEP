// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { DOMParser, DOMSerializer, Fragment } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../editorExtensions'

type Json = Record<string, any>

type FallbackCase = {
  name: string
  collisionId: string
  fallback: Json
  target: Json
  targetType: 'paragraph' | 'formula'
  findCopiedTarget: (editor: Editor) => any
  fallbackId: (attrs: Json) => string
}

function paragraph(nodeId: string, text: string) {
  return { type: 'stdParagraph', attrs: { nodeId }, content: [{ type: 'text', text }] }
}

function chapter(nodeId: string, title: string, content: Json[]) {
  return {
    type: 'chapter', attrs: { nodeId }, content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: title }] },
      ...content,
    ],
  }
}

function createContentDoc(fallback: Json[], content: Json[]) {
  return { type: 'doc', attrs: { titleParts: fallback }, content }
}

function fallbackCases(): FallbackCase[] {
  const titleId = 'fallback-title-entity'
  const formulaId = 'fallback-title-formula'
  return [
    {
      name: 'root titlePart entity ID',
      collisionId: titleId,
      fallback: { id: titleId, lang: 'zh', role: 'main', content: [{ text: '原始题名' }] },
      target: paragraph(titleId, '复制目标段'),
      targetType: 'paragraph',
      findCopiedTarget: editor => allNodes(editor).find(node => node.type.name === 'stdParagraph' && node.textContent === '复制目标段'),
      fallbackId: attrs => attrs.titleParts[0].id,
    },
    {
      name: 'root titlePart inline formula ID',
      collisionId: formulaId,
      fallback: {
        id: 'fallback-title-owner', lang: 'zh', role: 'main',
        content: [{ text: '原题名公式' }, { text: '', formula: { id: formulaId, latex: 'x=1' } }],
      },
      target: {
        type: 'stdParagraph', attrs: { nodeId: 'copy-formula-paragraph' }, content: [
          { type: 'formulaInline', attrs: { nodeId: formulaId, latex: 'x=1' } },
        ],
      },
      targetType: 'formula',
      findCopiedTarget: editor => allNodes(editor).find(node => node.type.name === 'formulaInline' && node.attrs.latex === 'x=1'),
      fallbackId: attrs => attrs.titleParts[0].content.find((inline: Json) => inline.formula)?.formula.id,
    },
  ]
}

function allNodes(editor: Editor): any[] {
  const nodes: any[] = []
  editor.state.doc.descendants(node => { nodes.push(node) })
  return nodes
}

function nodeById(editor: Editor, id: string): any {
  return allNodes(editor).find(node => node.attrs.nodeId === id)
}

function textNodeContaining(editor: Editor, value: string): any {
  return allNodes(editor).find(node => node.isText && node.text?.includes(value))
}

function refTarget(editor: Editor, text: string): string | null {
  const node = textNodeContaining(editor, text)
  const mark = node?.marks.find((candidate: any) => candidate.type.name === 'crossRef')
  return typeof mark?.attrs.targetId === 'string' ? mark.attrs.targetId : null
}

function chapterHtml(editor: Editor, nodeId: string): string {
  const chapterNode = nodeById(editor, nodeId)
  if (!chapterNode) throw new Error(`Missing chapter ${nodeId}`)
  const container = document.createElement('div')
  container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.from(chapterNode)))
  return container.innerHTML
}

function selectTopLevelNode(editor: Editor, nodeId: string) {
  let pos = -1
  editor.state.doc.forEach((node, offset) => {
    if (node.attrs.nodeId === nodeId) pos = offset
  })
  if (pos < 0) throw new Error(`Missing top-level node ${nodeId}`)
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
}

function assertNoModelReferenceErrors(editor: Editor) {
  const ir = pmToIr(editor.getJSON() as PMJsonNode).doc
  expect(ir.unsupportedContent ?? []).toEqual([])
  const errors = resolve(ir).problems.filter(problem =>
    ['duplicate-id', 'dangling-xref', 'dangling-typed-ref', 'dangling-footnote', 'invalid-footnote'].includes(problem.code),
  )
  expect(errors).toEqual([])
}

function parseHtmlRoundtrip(editor: Editor, doc: any) {
  const container = document.createElement('div')
  container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content))
  const parsed = DOMParser.fromSchema(editor.schema).parse(container)
  return parsed
}

function textMarkNames(node: any, text: string): string[] {
  let names: string[] = []
  node.descendants((child: any) => {
    if (child.isText && child.text === text) names = child.marks.map((mark: any) => mark.type.name)
  })
  return names
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('paste ID remapping against root metadata fallback entities', () => {
  it.each(fallbackCases())('rekeys a local $targetType target colliding with a $name fallback ID', testCase => {
    const copiedTargetId = testCase.collisionId
    const sourceContent = createContentDoc([], [
      chapter('copy-chapter', '复制章节', [
        testCase.target,
        {
          type: 'stdParagraph', attrs: { nodeId: 'copy-reference-paragraph' }, content: [
            { type: 'text', text: '内部引用', marks: [{ type: 'crossRef', attrs: { targetId: copiedTargetId, refType: testCase.targetType } }] },
            { type: 'text', text: '外部引用', marks: [{ type: 'crossRef', attrs: { targetId: 'existing-chapter', refType: 'chapter' } }] },
          ],
        },
      ]),
      chapter('existing-chapter', '源中的外部目标', [paragraph('source-existing-paragraph', '外部目标')]),
    ])
    const destinationContent = createContentDoc([testCase.fallback], [
      chapter('paste-slot', '待替换章节', [paragraph('paste-slot-paragraph', '粘贴位置')]),
      chapter('existing-chapter', '目标文档中的既有章节', [paragraph('existing-paragraph', '既有目标')]),
    ])

    const source = new Editor({ extensions: createEditorExtensions(), content: sourceContent })
    const destination = new Editor({ extensions: createEditorExtensions(), content: destinationContent })
    try {
      const sourceBefore = structuredClone(source.getJSON())
      const destinationFallbackBefore = structuredClone(destination.getJSON().attrs?.titleParts)
      assertNoModelReferenceErrors(source)
      assertNoModelReferenceErrors(destination)

      const html = chapterHtml(source, 'copy-chapter')
      selectTopLevelNode(destination, 'paste-slot')
      destination.view.pasteHTML(html)

      const copiedTarget = testCase.findCopiedTarget(destination)
      expect(copiedTarget).toBeDefined()
      expect(copiedTarget.attrs.nodeId).not.toBe(copiedTargetId)
      expect(refTarget(destination, '内部引用')).toBe(copiedTarget.attrs.nodeId)
      expect(refTarget(destination, '外部引用')).toBe('existing-chapter')
      expect(destination.getJSON().attrs?.titleParts).toEqual(destinationFallbackBefore)
      expect(testCase.fallbackId(destination.getJSON().attrs as Json)).toBe(copiedTargetId)
      expect(source.getJSON()).toEqual(sourceBefore)
      assertNoModelReferenceErrors(destination)
    } finally {
      source.destroy()
      destination.destroy()
    }
  })
})

describe('standard paragraph HTML round trips', () => {
  it('keeps stdParagraph type, node IDs and marks across two complete chapter DOM cycles while plain p stays generic', () => {
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: {
        type: 'doc',
        content: [
          chapter('roundtrip-chapter', '往返章节', [
            { type: 'stdParagraph', attrs: { nodeId: 'std-paragraph-one' }, content: [
              { type: 'text', text: '粗体标准段落', marks: [{ type: 'bold' }] },
            ] },
            { type: 'stdParagraph', attrs: { nodeId: 'std-paragraph-two' }, content: [
              { type: 'text', text: '斜体标准段落', marks: [{ type: 'italic' }] },
            ] },
          ]),
          { type: 'paragraph', attrs: { nodeId: 'ordinary-paragraph' }, content: [
            { type: 'text', text: '普通 HTML 段落', marks: [{ type: 'bold' }] },
          ] },
        ],
      },
    })

    try {
      let parsed = editor.state.doc
      for (let cycle = 0; cycle < 2; cycle += 1) parsed = parseHtmlRoundtrip(editor, parsed)

      const parsedChapter = parsed.child(0)
      expect(parsedChapter.type.name).toBe('chapter')
      expect(parsedChapter.attrs.nodeId).toBe('roundtrip-chapter')
      expect(parsedChapter.child(0).type.name).toBe('chapterTitle')
      const standardParagraphs = parsedChapter.content.content.filter(node => node.type.name === 'stdParagraph')
      expect(standardParagraphs.map(node => node.attrs.nodeId)).toEqual([
        'std-paragraph-one', 'std-paragraph-two',
      ])
      expect(textMarkNames(standardParagraphs[0], '粗体标准段落')).toContain('bold')
      expect(textMarkNames(standardParagraphs[1], '斜体标准段落')).toContain('italic')

      const ordinaryParagraph = parsed.content.content.find(node => node.attrs.nodeId === 'ordinary-paragraph')
      expect(ordinaryParagraph?.type.name).toBe('paragraph')
      expect(textMarkNames(ordinaryParagraph, '普通 HTML 段落')).toContain('bold')
    } finally {
      editor.destroy()
    }
  })
})
