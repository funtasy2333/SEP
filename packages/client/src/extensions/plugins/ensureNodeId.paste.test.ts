// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, Slice } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, expect, it } from 'vitest'
import { pmToIr, resolve } from '@ses/shared'
import { createEditorExtensions } from '../editorExtensions'

function chapter(nodeId: string, number: string, paragraphs: Record<string, unknown>[]) {
  return {
    type: 'chapter',
    attrs: { nodeId, number },
    content: [
      { type: 'chapterTitle', content: [{ type: 'text', text: `第${number}章` }] },
      ...paragraphs,
    ],
  }
}

function targetParagraph(nodeId: string, label: string) {
  return { type: 'stdParagraph', attrs: { nodeId }, content: [{ type: 'text', text: label }] }
}

function createEditor(slotPosition: 'before' | 'after' = 'after') {
  const source = chapter('chapter-original', '1', [
    targetParagraph('copy-target', '内部目标'),
    {
      type: 'stdParagraph', attrs: { nodeId: 'copy-ref' }, content: [
        { type: 'text', text: '内部引用', marks: [{ type: 'crossRef', attrs: { targetId: 'copy-target', refType: 'paragraph' } }] },
        { type: 'text', text: ' 外部引用 ', marks: [{ type: 'crossRef', attrs: { targetId: 'outside-target', refType: 'paragraph' } }] },
        { type: 'footnoteRef', attrs: { nodeId: 'copy-footnote', content: [
          { type: 'text', text: '脚注中的引用', marks: [{ type: 'crossRef', attrs: { targetId: 'copy-target', refType: 'paragraph' } }] },
        ] } },
      ],
    },
  ])
  const outside = chapter('chapter-outside', '2', [targetParagraph('outside-target', '外部目标')])
  const slot = chapter('paste-slot', '3', [targetParagraph('slot-paragraph', '替换插入槽')])
  return new Editor({
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: slotPosition === 'before' ? [slot, source, outside] : [source, outside, slot] },
  })
}

function createRichPasteEditor() {
  const richChapter = (nodeId: string, number: string) => chapter(nodeId, number, [
    {
      type: 'termDef', attrs: { nodeId: 'copy-term', level: 1 }, content: [
        { type: 'termName', content: [{ type: 'text', text: '复制术语' }] },
        { type: 'termDefinition', content: [{ type: 'text', text: '术语定义' }] },
      ],
    },
    {
      type: 'termDef', attrs: { nodeId: 'copy-term-ref', level: 1 }, content: [
        { type: 'termName', content: [{ type: 'text', text: '术语引用 ', marks: [{ type: 'termRef', attrs: { targetId: 'copy-term' } }] }] },
        { type: 'termDefinition', content: [{ type: 'text', text: '另一个定义' }] },
      ],
    },
    {
      type: 'figure', attrs: { nodeId: 'copy-figure' }, content: [
        { type: 'figureImage', attrs: { src: 'https://example.org/copy.png', resourceId: 'copy-resource' } },
        { type: 'figureCaption', content: [{ type: 'text', text: '资源图' }] },
        { type: 'figureGroup', content: [{ type: 'figureResourceRef', attrs: { targetId: 'copy-resource' } }] },
      ],
    },
    {
      type: 'stdTable', attrs: { nodeId: 'copy-table' }, content: [
        { type: 'tableCaption', content: [{ type: 'text', text: '脚注表' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [
            { type: 'text', text: '表内引用' },
            { type: 'tableFootnoteRef', attrs: { nodeId: 'copy-table-call', targetId: 'copy-table-note' } },
          ] }] },
        ] }] },
        { type: 'tableFootnoteRow', content: [
          { type: 'tableFootnoteEntry', attrs: { nodeId: 'copy-table-note' }, content: [{ type: 'text', text: '表脚注定义' }] },
        ] },
      ],
    },
  ])
  const source = richChapter('rich-source', '1')
  const slot = chapter('rich-slot', '2', [targetParagraph('rich-slot-paragraph', '替换插入槽')])
  return new Editor({
    extensions: createEditorExtensions(),
    content: {
      type: 'doc',
      content: [source, slot, { type: 'figureResource', attrs: { nodeId: 'copy-resource', name: '资源', mediaType: 'image/png', data: 'data:image/png;base64,AA==' } }],
    },
  })
}

function createTablePasteEditor() {
  const tableChapter = (nodeId: string, number: string) => chapter(nodeId, number, [{
    type: 'stdTable', attrs: { nodeId: 'copy-table' }, content: [
      { type: 'tableCaption', content: [{ type: 'text', text: '脚注表' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [
          { type: 'text', text: '表内引用' },
          { type: 'tableFootnoteRef', attrs: { nodeId: 'copy-table-call', targetId: 'copy-table-note' } },
        ] }] },
      ] }] },
      { type: 'tableFootnoteRow', content: [
        { type: 'tableFootnoteEntry', attrs: { nodeId: 'copy-table-note' }, content: [{ type: 'text', text: '表脚注定义' }] },
      ] },
    ],
  }])
  return new Editor({
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: [
      tableChapter('table-source', '1'),
      chapter('table-slot', '2', [targetParagraph('table-slot-paragraph', '替换')]),
    ] },
  })
}

function richChapterAndResourceSlice(editor: Editor) {
  const source = editor.state.doc.content.content.find(node => node.attrs.nodeId === 'rich-source')!
  const resource = editor.state.doc.content.content.find(node => node.type.name === 'figureResource')!
  const serializer = DOMSerializer.fromSchema(editor.schema)
  const table = source.content.content.find(node => node.type.name === 'stdTable')!
  const chapterWithoutTable = source.copy(Fragment.fromArray(source.content.content.filter(node => node !== table)))
  const chapterWrapper = document.createElement('div')
  chapterWrapper.append(serializer.serializeNode(chapterWithoutTable))
  const wrapper = document.createElement('div')
  wrapper.append(chapterWrapper.firstElementChild!, serializer.serializeNode(resource))
  return wrapper.innerHTML
}

function createBibliographyPasteEditor() {
  return new Editor({
    extensions: createEditorExtensions(),
    content: {
      type: 'doc',
      content: [chapter('bib-host-chapter', '1', [targetParagraph('bib-host-paragraph', '正文')]), {
        type: 'bibliography', attrs: { nodeId: 'bib-root' }, content: [
          { type: 'bibliographyTitle', content: [{ type: 'text', text: '参考文献' }] },
          { type: 'bibEntry', attrs: { nodeId: 'bib-copy-target' }, content: [{ type: 'text', text: '被引用文献' }] },
          { type: 'bibEntry', attrs: { nodeId: 'bib-copy-ref' }, content: [{ type: 'text', text: '引用 ', marks: [{ type: 'bibRef', attrs: { targetId: 'bib-copy-target' } }] }] },
          { type: 'bibEntry', attrs: { nodeId: 'bib-slot' }, content: [{ type: 'text', text: '替换槽' }] },
        ],
      }],
    },
  })
}

function bibliographyEntriesHtml(editor: Editor) {
  const bibliography = editor.state.doc.content.content.find(node => node.type.name === 'bibliography')!
  const slice = new Slice(Fragment.fromArray([bibliography.child(1), bibliography.child(2)]), 0, 0)
  const wrapper = document.createElement('div')
  wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content))
  return wrapper.innerHTML
}

function indexBranchHtml(editor: Editor) {
  const sourceDoc = editor.schema.nodeFromJSON({
    type: 'doc',
    content: [
      chapter('index-source', '1', [targetParagraph('index-copy-target', '索引目标')]),
      {
        type: 'indexBlock', content: [{ type: 'indexGroup', attrs: { nodeId: 'index-copy-group' }, content: [{
          type: 'indexEntry', attrs: { nodeId: 'index-copy-entry' }, content: [
            { type: 'indexTerm', content: [{ type: 'text', text: '索引词' }] },
            { type: 'indexTarget', attrs: { targetId: 'index-copy-target' } },
            { type: 'indexSeeAlso', attrs: { targetId: 'index-copy-target' } },
          ],
        }] }],
      },
    ],
  })
  sourceDoc.check()
  const slice = new Slice(Fragment.fromArray([sourceDoc.child(0), sourceDoc.child(1)]), 0, 0)
  const wrapper = document.createElement('div')
  wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content))
  return wrapper.innerHTML
}

function sourceChapterSlice(editor: Editor) {
  const source = editor.state.doc.content.content.find(node => node.attrs.nodeId === 'chapter-original')!
  const slice = new Slice(Fragment.from(source), 0, 0)
  const wrapper = document.createElement('div')
  wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content))
  return wrapper.innerHTML
}

function sourceParagraphsHtml(editor: Editor) {
  const source = editor.state.doc.content.content.find(node => node.attrs.nodeId === 'chapter-original')!
  const slice = new Slice(Fragment.fromArray([source.child(1), source.child(2)]), 0, 0)
  const wrapper = document.createElement('div')
  wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content))
  return wrapper.innerHTML
}

function tableChapterHtml(editor: Editor) {
  const source = editor.state.doc.content.content.find(node => node.attrs.nodeId === 'table-source')!
  const wrapper = document.createElement('div')
  wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.from(source)))
  return wrapper.innerHTML
}

function duplicateDefinitionsHtml(editor: Editor, nodeId: string) {
  const first = editor.schema.nodeFromJSON(targetParagraph(nodeId, '副本目标甲'))
  const second = editor.schema.nodeFromJSON(targetParagraph(nodeId, '副本目标乙'))
  const wrapper = document.createElement('div')
  wrapper.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(Fragment.fromArray([first, second])))
  return wrapper.innerHTML
}

function nodePositionById(editor: Editor, nodeId: string): number {
  let position = -1
  editor.state.doc.forEach((node, offset) => {
    if (node.attrs.nodeId === nodeId) position = offset
  })
  return position
}

function anyNodePositionById(editor: Editor, nodeId: string): number {
  let position = -1
  editor.state.doc.descendants((node, offset) => {
    if (node.attrs.nodeId === nodeId) position = offset
  })
  return position
}

function selectNode(editor: Editor, nodeId: string) {
  const position = nodePositionById(editor, nodeId)
  if (position < 0) throw new Error(`找不到节点 ${nodeId}`)
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))
}

function selectAnyNode(editor: Editor, nodeId: string) {
  const position = anyNodePositionById(editor, nodeId)
  if (position < 0) throw new Error(`找不到节点 ${nodeId}`)
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))
}

function nodeById(editor: Editor, nodeId: string) {
  let found: any
  editor.state.doc.descendants((node) => {
    if (node.attrs.nodeId === nodeId) found = node
  })
  return found
}

function paragraphByText(editor: Editor, text: string, excludingId?: string) {
  let found: any
  editor.state.doc.descendants((node) => {
    if (['stdParagraph', 'paragraph'].includes(node.type.name)
      && node.textContent.includes(text)
      && node.attrs.nodeId !== excludingId) found = node
  })
  return found
}

function expectNoBrokenReferences(editor: Editor) {
  const { doc } = pmToIr(editor.getJSON() as any)
  expect(doc.unsupportedContent ?? []).toEqual([])
  const errors = resolve(doc).problems.filter(problem =>
    ['duplicate-id', 'dangling-xref', 'dangling-typed-ref', 'dangling-footnote', 'dangling-resource', 'dangling-index-target', 'invalid-footnote'].includes(problem.code),
  )
  expect(errors).toEqual([])
}

afterEach(() => {
  document.body.replaceChildren()
})

it.each(['before', 'after'] as const)('production view.pasteHTML 在原件%s插入语义 chapter 时保留原件并修复副本引用', (position) => {
  const editor = createEditor(position)
  try {
    const html = sourceChapterSlice(editor)
    selectNode(editor, 'paste-slot')
    editor.view.pasteHTML(html)

    const original = nodeById(editor, 'chapter-original')
    const originalTarget = nodeById(editor, 'copy-target')
    const originalRef = nodeById(editor, 'copy-ref')
    const copiedTarget = paragraphByText(editor, '内部目标', 'copy-target')
    const copiedRef = paragraphByText(editor, '内部引用', 'copy-ref')
    expect(original).toBeDefined()
    expect(originalTarget.textContent).toBe('内部目标')
    expect(originalRef.textContent).toContain('内部引用')
    expect(copiedTarget.attrs.nodeId).not.toBe('copy-target')
    expect(copiedRef.attrs.nodeId).not.toBe('copy-ref')
    const copiedMarks = copiedRef.content.content.flatMap((node: any) => node.marks.map((mark: any) => ({ type: mark.type.name, ...mark.attrs })))
    expect(copiedMarks.filter((mark: any) => mark.type === 'crossRef').map((mark: any) => mark.targetId)).toEqual([
      copiedTarget.attrs.nodeId,
      'outside-target',
    ])
    const copiedFootnotes: any[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'footnoteRef' && node.attrs.nodeId !== 'copy-footnote') copiedFootnotes.push(node)
    })
    expect(copiedFootnotes).toHaveLength(1)
    expect(copiedFootnotes[0]!.attrs.content[0].marks[0].attrs.targetId).toBe(copiedTarget.attrs.nodeId)
    expectNoBrokenReferences(editor)
  } finally {
    editor.destroy()
  }
})

it('cut/paste 后原分支已离开文档时保留其原始 ID', () => {
  const editor = createEditor('after')
  try {
    const html = sourceChapterSlice(editor)
    const source = nodePositionById(editor, 'chapter-original')
    const sourceNode = nodeById(editor, 'chapter-original')
    editor.view.dispatch(editor.state.tr.delete(source, source + sourceNode.nodeSize))
    selectNode(editor, 'paste-slot')
    editor.view.pasteHTML(html)
    expect(nodeById(editor, 'chapter-original')).toBeDefined()
    expect(nodeById(editor, 'copy-target').textContent).toBe('内部目标')
    expect(nodeById(editor, 'copy-ref').textContent).toContain('内部引用')
    expectNoBrokenReferences(editor)
  } finally {
    editor.destroy()
  }
})

it('真实段落光标粘贴若会合并并丢弃被内部引用的目标则拒绝且保留编辑器状态', () => {
  const editor = createEditor('after')
  const hostChapter = editor.schema.nodeFromJSON(chapter('host-chapter', '4', [targetParagraph('paste-host', '宿主')]))
  editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, hostChapter))
  const host = nodeById(editor, 'paste-host')
  let hostTextPosition = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === '宿主') hostTextPosition = pos + node.nodeSize
  })
  expect(host).toBeDefined()
  expect(hostTextPosition).toBeGreaterThan(0)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, hostTextPosition)))
  const html = sourceParagraphsHtml(editor)
  const beforePaste = editor.state
  const selectedFrom = editor.state.selection.from
  const selectedTo = editor.state.selection.to
  const messages: string[] = []
  const capture = (event: Event) => {
    const detail = (event as CustomEvent<{ message?: string }>).detail
    if (detail?.message) messages.push(detail.message)
  }
  window.addEventListener('ses:paste-reference-error', capture)
  try {
    editor.view.pasteHTML(html)
    expect(editor.state).toBe(beforePaste)
    expect(editor.state.selection.from).toBe(selectedFrom)
    expect(editor.state.selection.to).toBe(selectedTo)
    expect(nodeById(editor, 'paste-host').textContent).toBe('宿主')
    expect(messages).toEqual([
      '此粘贴位置会合并引用目标所在段落，无法保留内部引用关系；请在结构边界粘贴或调整选区',
    ])
  } finally {
    window.removeEventListener('ses:paste-reference-error', capture)
    editor.destroy()
  }
})

it('原件前粘贴与当前文档冲突的重复定义时拒绝并保留原目标、外部引用、选区和撤销历史', () => {
  const source = chapter('duplicate-source', '1', [targetParagraph('ambiguous-target', '原目标')])
  const external = chapter('duplicate-external', '2', [
    targetParagraph('duplicate-external-ref', '外部引用',),
    { type: 'stdParagraph', attrs: { nodeId: 'undo-target' }, content: [{ type: 'text', text: '历史起点' }] },
  ])
  // Replace the external paragraph content with a real crossRef mark.
  external.content[1] = {
    type: 'stdParagraph', attrs: { nodeId: 'duplicate-external-ref' }, content: [
      { type: 'text', text: '外部引用', marks: [{ type: 'crossRef', attrs: { targetId: 'ambiguous-target', refType: 'paragraph' } }] },
    ],
  }
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: [
      chapter('duplicate-slot', '0', [targetParagraph('duplicate-slot-paragraph', '粘贴槽')]),
      source,
      external,
    ] },
  })
  try {
    let undoTextPosition = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === '历史起点') undoTextPosition = pos + node.nodeSize
    })
    editor.view.dispatch(editor.state.tr.insertText('修改', undoTextPosition))
    selectNode(editor, 'duplicate-slot')
    const beforePaste = editor.state
    const originalSelection = editor.state.selection
    const html = duplicateDefinitionsHtml(editor, 'ambiguous-target')
    const messages: string[] = []
    const capture = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      if (detail?.message) messages.push(detail.message)
    }
    window.addEventListener('ses:paste-reference-error', capture)
    try {
      editor.view.pasteHTML(html)
    } finally {
      window.removeEventListener('ses:paste-reference-error', capture)
    }

    expect(editor.state).toBe(beforePaste)
    expect(editor.state.selection).toBe(originalSelection)
    expect(nodeById(editor, 'ambiguous-target').textContent).toBe('原目标')
    let externalTarget = ''
    nodeById(editor, 'duplicate-external-ref').descendants((node: any) => {
      for (const mark of node.marks) if (mark.type.name === 'crossRef') externalTarget = mark.attrs.targetId
    })
    expect(externalTarget).toBe('ambiguous-target')
    expect(messages).toEqual([
      '粘贴内容含重复节点 ID，与当前文档冲突，无法保留原件及引用关系；请先修正源内容',
    ])
    expect(nodeById(editor, 'undo-target').textContent).toBe('历史起点修改')
    expect(editor.commands.undo()).toBe(true)
    expect(nodeById(editor, 'undo-target').textContent).toBe('历史起点')
    expect(nodeById(editor, 'ambiguous-target').textContent).toBe('原目标')
    let targetAfterUndo = ''
    nodeById(editor, 'duplicate-external-ref').descendants((node: any) => {
      for (const mark of node.marks) if (mark.type.name === 'crossRef') targetAfterUndo = mark.attrs.targetId
    })
    expect(targetAfterUndo).toBe('ambiguous-target')
    expectNoBrokenReferences(editor)
  } finally {
    editor.destroy()
  }
})

it('生产 view.pasteHTML 同步重映射 termRef、figure resource、表脚注及脚注表目标', () => {
  const editor = createRichPasteEditor()
  try {
    const html = richChapterAndResourceSlice(editor)
    selectNode(editor, 'rich-slot')
    editor.view.pasteHTML(html)

    const terms: any[] = []
    const termReferences: any[] = []
    const figures: any[] = []
    const resources: any[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'termDef' && node.textContent.includes('复制术语')) terms.push(node)
      if (node.type.name === 'termDef' && node.textContent.includes('术语引用')) termReferences.push(node)
      if (node.type.name === 'figure' && node.textContent.includes('资源图')) figures.push(node)
      if (node.type.name === 'figureResource') resources.push(node)
    })
    expect(terms).toHaveLength(2)
    expect(figures).toHaveLength(2)
    expect(resources).toHaveLength(2)
    const copiedTerm = terms.find(node => node.attrs.nodeId !== 'copy-term')!
    const copiedTermRef = termReferences.find(node => node.attrs.nodeId !== 'copy-term-ref')!
    const copiedFigure = figures.find(node => node.attrs.nodeId !== 'copy-figure')!
    const copiedResource = resources.find(node => node.attrs.nodeId !== 'copy-resource')!
    expect(copiedTerm).toBeDefined()
    expect(copiedTermRef.attrs.nodeId).not.toBe('copy-term-ref')
    let copiedTermRefTarget = ''
    copiedTermRef.descendants((node: any) => {
      for (const mark of node.marks) if (mark.type.name === 'termRef') copiedTermRefTarget = mark.attrs.targetId
    })
    expect(copiedTermRefTarget).toBe(copiedTerm.attrs.nodeId)
    const copiedImages: any[] = []
    const copiedResourceRefs: any[] = []
    copiedFigure.descendants((node: any) => { if (node.type.name === 'figureImage') copiedImages.push(node) })
    copiedFigure.descendants((node: any) => { if (node.type.name === 'figureResourceRef') copiedResourceRefs.push(node) })
    expect(copiedImages[0].attrs.resourceId).toBe(copiedResource.attrs.nodeId)
    expect(copiedResourceRefs[0].attrs.targetId).toBe(copiedResource.attrs.nodeId)
    expectNoBrokenReferences(editor)
  } finally {
    editor.destroy()
  }
})

it('生产 view.pasteHTML 重映射同一 bibliography slice 内的 bibRef 目标', () => {
  const editor = createBibliographyPasteEditor()
  try {
    const html = bibliographyEntriesHtml(editor)
    selectAnyNode(editor, 'bib-slot')
    editor.view.pasteHTML(html)
    const entries: any[] = []
    editor.state.doc.descendants((node) => { if (node.type.name === 'bibEntry') entries.push(node) })
    const target = entries.find(node => node.textContent.includes('被引用文献') && node.attrs.nodeId !== 'bib-copy-target')
    const ref = entries.find(node => node.textContent.trim().startsWith('引用') && node.attrs.nodeId !== 'bib-copy-ref')
    expect(target).toBeDefined()
    expect(ref).toBeDefined()
    const targetId = ref.content.content.flatMap((node: any) => node.marks)
      .find((mark: any) => mark.type.name === 'bibRef')?.attrs.targetId
    expect(targetId).toBe(target.attrs.nodeId)
    expectNoBrokenReferences(editor)
  } finally {
    editor.destroy()
  }
})

it('生产 view.pasteHTML 复制完整表格章节时同步重映射表脚注定义与引用', () => {
  const editor = createTablePasteEditor()
  try {
    const html = tableChapterHtml(editor)
    selectNode(editor, 'table-slot')
    editor.view.pasteHTML(html)

    const entries: any[] = []
    const refs: any[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableFootnoteEntry') entries.push(node)
      if (node.type.name === 'tableFootnoteRef') refs.push(node)
    })
    expect(entries).toHaveLength(2)
    expect(refs).toHaveLength(2)
    expect(nodeById(editor, 'table-source')).toBeDefined()
    expect(nodeById(editor, 'copy-table-note').textContent).toBe('表脚注定义')
    expect(nodeById(editor, 'copy-table-call').attrs.targetId).toBe('copy-table-note')
    const copiedEntry = entries.find(node => node.attrs.nodeId !== 'copy-table-note')!
    const copiedRef = refs.find(node => node.attrs.nodeId !== 'copy-table-call')!
    expect(copiedEntry.textContent).toBe('表脚注定义')
    expect(copiedRef.attrs.targetId).toBe(copiedEntry.attrs.nodeId)
    expectNoBrokenReferences(editor)
  } finally {
    editor.destroy()
  }
})

it('生产 index slice 中 targetId 和 seeAlso 按唯一内部定义重映射', () => {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: [
      chapter('index-existing', '1', [targetParagraph('index-copy-target', '索引目标')]),
      chapter('index-slot', '2', [targetParagraph('index-slot-paragraph', '替换')]),
    ] },
  })
  try {
    const html = indexBranchHtml(editor)
    selectNode(editor, 'index-slot')
    editor.view.pasteHTML(html)
    const target = paragraphByText(editor, '索引目标', 'index-copy-target')
    const refs: any[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'indexTarget' || node.type.name === 'indexSeeAlso') refs.push(node)
    })
    expect(target).toBeDefined()
    expect(refs.map(node => node.attrs.targetId)).toEqual([target.attrs.nodeId, target.attrs.nodeId])
    expectNoBrokenReferences(editor)
  } finally {
    editor.destroy()
  }
})
