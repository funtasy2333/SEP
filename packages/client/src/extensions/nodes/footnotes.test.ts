// @vitest-environment happy-dom
import { Editor, getSchema } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { pmToIr, resolve, type PMJsonNode } from '@ses/shared'
import { createEditorExtensions } from '../editorExtensions'
import { parseXmlToEditorJson } from '../../serializer/xmlParser'

const editors: Editor[] = []

function createEditor() {
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
          { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
          { type: 'stdParagraph', content: [{ type: 'text', text: '保留的选中文字' }] },
          { type: 'stdList', attrs: { listType: 'dash' }, content: [
            { type: 'stdListItem', content: [{ type: 'text', text: '列项内容' }] },
          ] },
          { type: 'note', content: [{ type: 'text', text: '注内容' }] },
          { type: 'example', content: [{ type: 'text', text: '示例内容' }] },
          {
            type: 'stdTable',
            content: [
              { type: 'tableCaption', content: [{ type: 'text', text: '测试表' }] },
              { type: 'table', content: [{ type: 'tableRow', content: [
                { type: 'tableHeader', content: [{ type: 'paragraph' }] },
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
              ] }] },
            ],
          },
        ],
      }, {
        type: 'bibliography',
        content: [
          { type: 'bibliographyTitle', content: [{ type: 'text', text: '参考文献' }] },
          { type: 'bibEntry', content: [{ type: 'text', text: '文献内容' }] },
        ],
      }],
    },
  })
  editors.push(editor)
  return editor
}

function findTextblockPosition(editor: Editor, type: string, insideTable = false): number {
  let found: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null || node.type.name !== type) return found === null
    let inTable = false
    const $pos = editor.state.doc.resolve(pos + 1)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === 'stdTable') inTable = true
    }
    if (inTable === insideTable) found = pos + 1
    return found === null
  })
  if (found === null) throw new Error(`找不到 ${type}`)
  return found
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element
    editor.destroy()
    if (element instanceof HTMLElement) element.remove()
  }
})

describe('脚注编辑 schema 与命令', () => {
  it('生产 editor schema 注册表注行和脚注行', () => {
    const schema = getSchema(createEditorExtensions())
    expect(schema.nodes.tableFootnoteRow).toBeDefined()
    expect(schema.nodes.tableFootnoteEntry).toBeDefined()
    expect(schema.nodes.tableNoteRow).toBeDefined()
    expect(schema.nodes.footnoteRef).toBeDefined()
    expect(schema.nodes.tableFootnoteRef).toBeDefined()
  })

  it('删除最后一个未引用的表脚注定义时删除整行，并可撤销重做', () => {
    const editor = createEditor()
    const cellStart = findTextblockPosition(editor, 'paragraph', true)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellStart)))
    expect(editor.commands.insertTableFootnote({ content: [{ type: 'text', text: '待删除的定义' }] })).toBe(true)

    let targetId = ''
    let ref: { pos: number; nodeSize: number } | null = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableFootnoteEntry') targetId = String(node.attrs.nodeId)
      if (node.type.name === 'tableFootnoteRef') ref = { pos, nodeSize: node.nodeSize }
    })
    expect(targetId).toBeTruthy()
    expect(ref).toBeTruthy()

    editor.view.dispatch(closeHistory(editor.state.tr))
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, ref!.pos)))
    expect(editor.commands.deleteSelectedTableFootnoteRef()).toBe(true)
    let referenceCount = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableFootnoteRef') referenceCount += 1 })
    expect(referenceCount).toBe(0)

    editor.view.dispatch(closeHistory(editor.state.tr))
    expect(editor.commands.deleteTableFootnoteEntry({ nodeId: targetId })).toBe(true)
    const counts = () => {
      const result = { rows: 0, entries: 0, tables: 0 }
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'tableFootnoteRow') result.rows += 1
        if (node.type.name === 'tableFootnoteEntry') result.entries += 1
        if (node.type.name === 'stdTable') result.tables += 1
      })
      return result
    }
    expect(counts()).toEqual({ rows: 0, entries: 0, tables: 1 })
    expect(editor.state.doc.textContent).toContain('保留的选中文字')
    expect(editor.state.doc.textContent).not.toContain('待删除的定义')
    const footnoteProblems = () => resolve(pmToIr(editor.getJSON() as PMJsonNode).doc).problems
      .filter((problem) => ['dangling-footnote', 'unreferenced-footnote', 'invalid-footnote'].includes(problem.code))
    expect(footnoteProblems()).toEqual([])

    expect(editor.commands.undo()).toBe(true)
    expect(counts()).toEqual({ rows: 1, entries: 1, tables: 1 })
    expect(editor.state.doc.textContent).toContain('保留的选中文字')
    expect(editor.state.doc.textContent).toContain('待删除的定义')
    referenceCount = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableFootnoteRef') referenceCount += 1 })
    expect(referenceCount).toBe(0)

    expect(editor.commands.redo()).toBe(true)
    expect(counts()).toEqual({ rows: 0, entries: 0, tables: 1 })
    expect(editor.state.doc.textContent).toContain('保留的选中文字')
    expect(editor.state.doc.textContent).not.toContain('待删除的定义')
    expect(footnoteProblems()).toEqual([])
  })

  it('多条定义只删除选中的一条，删除最后一条时整行消失', () => {
    const editor = createEditor()
    const cellStart = findTextblockPosition(editor, 'paragraph', true)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellStart)))
    expect(editor.commands.insertTableFootnote({ content: [{ type: 'text', text: '定义甲' }] })).toBe(true)
    const nextCellStart = findTextblockPosition(editor, 'paragraph', true)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, nextCellStart)))
    expect(editor.commands.insertTableFootnote({ content: [{ type: 'text', text: '定义乙' }] })).toBe(true)

    const entryIds: string[] = []
    const refRanges: Array<{ pos: number; nodeSize: number }> = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableFootnoteEntry') entryIds.push(String(node.attrs.nodeId))
      if (node.type.name === 'tableFootnoteRef') refRanges.push({ pos, nodeSize: node.nodeSize })
    })
    expect(entryIds).toHaveLength(2)
    expect(refRanges).toHaveLength(2)
    let tr = editor.state.tr
    for (const ref of refRanges.sort((left, right) => right.pos - left.pos)) {
      tr = tr.delete(ref.pos, ref.pos + ref.nodeSize)
    }
    editor.view.dispatch(tr)

    expect(editor.commands.deleteTableFootnoteEntry({ nodeId: entryIds[0]! })).toBe(true)
    let remainingIds: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableFootnoteEntry') remainingIds.push(String(node.attrs.nodeId))
    })
    expect(remainingIds).toEqual([entryIds[1]])
    let rowCount = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableFootnoteRow') rowCount += 1 })
    expect(rowCount).toBe(1)

    expect(editor.commands.deleteTableFootnoteEntry({ nodeId: entryIds[1]! })).toBe(true)
    rowCount = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableFootnoteRow') rowCount += 1 })
    expect(rowCount).toBe(0)
    expect(editor.state.doc.textContent).toContain('保留的选中文字')
    const footnoteProblems = resolve(pmToIr(editor.getJSON() as PMJsonNode).doc).problems
      .filter((problem) => ['dangling-footnote', 'unreferenced-footnote', 'invalid-footnote'].includes(problem.code))
    expect(footnoteProblems).toEqual([])
  })

  it('选中文本后插入正文脚注并保留原文；表格命令同时建立稳定目标引用', () => {
    const editor = createEditor()
    const paragraphStart = findTextblockPosition(editor, 'stdParagraph')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, paragraphStart, paragraphStart + '保留的选中'.length)))
    expect(editor.commands.insertFootnoteRef({ content: [{ type: 'text', text: '正文脚注内容' }] })).toBe(true)
    let bodyText = ''
    let bodyRefId = ''
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'stdParagraph') bodyText = node.textContent
      if (node.type.name === 'footnoteRef') bodyRefId = String(node.attrs.nodeId)
    })
    expect(bodyText).toBe('保留的选中文字')
    expect(bodyRefId).toBeTruthy()

    const listItemStart = findTextblockPosition(editor, 'stdListItem')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, listItemStart)))
    expect(editor.commands.insertFootnoteRef({ content: [{ type: 'text', text: '列项脚注' }] })).toBe(true)
    const bibliographyStart = findTextblockPosition(editor, 'bibEntry')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, bibliographyStart)))
    expect(editor.commands.insertFootnoteRef({ content: [{ type: 'text', text: '文献脚注' }] })).toBe(true)
    for (const type of ['note', 'example']) {
      const position = findTextblockPosition(editor, type)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)))
      expect(editor.commands.insertFootnoteRef({ content: [{ type: 'text', text: `${type}脚注` }] })).toBe(true)
    }

    const cellStart = findTextblockPosition(editor, 'paragraph', true)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellStart)))
    expect(editor.commands.insertTableFootnote({ content: [{ type: 'text', text: '表脚注内容' }] })).toBe(true)
    let targetId = ''
    let refTargetId = ''
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableFootnoteEntry') targetId = String(node.attrs.nodeId)
      if (node.type.name === 'tableFootnoteRef') refTargetId = String(node.attrs.targetId)
    })
    expect(targetId).toBeTruthy()
    expect(refTargetId).toBe(targetId)
    expect(editor.state.selection.$from.parent.type.name).toBe('tableFootnoteEntry')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellStart)))
    expect(editor.commands.insertTableFootnoteRef({ targetId })).toBe(true)
    expect(editor.commands.deleteTableFootnoteEntry({ nodeId: targetId })).toBe(false)
    expect(editor.state.doc.textContent).toContain('表脚注内容')
    let refCount = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableFootnoteRef') refCount += 1 })
    expect(refCount).toBe(2)
    expect(editor.commands.addTableNote()).toBe(true)
    let tableNoteRowCount = 0
    editor.state.doc.descendants((node) => { if (node.type.name === 'tableNoteRow') tableNoteRowCount += 1 })
    expect(tableNoteRowCount).toBe(1)

    const sourceTableHolder: { value: { node: import('@tiptap/pm/model').Node; pos: number } | null } = { value: null }
    editor.state.doc.descendants((node, pos) => {
      if (!sourceTableHolder.value && node.type.name === 'stdTable') sourceTableHolder.value = { node, pos }
    })
    if (!sourceTableHolder.value) throw new Error('测试表格未创建')
    const sourceTable = sourceTableHolder.value
    const sourceTableJson = sourceTable.node.toJSON()
    editor.commands.insertContentAt(sourceTable.pos + sourceTable.node.nodeSize, sourceTableJson)

    const tableLinks: Array<{ entries: string[]; refs: string[] }> = []
    editor.state.doc.descendants((node) => {
      if (node.type.name !== 'stdTable') return
      const links = { entries: [] as string[], refs: [] as string[] }
      node.descendants((child) => {
        if (child.type.name === 'tableFootnoteEntry') links.entries.push(String(child.attrs.nodeId))
        if (child.type.name === 'tableFootnoteRef') links.refs.push(String(child.attrs.targetId))
      })
      tableLinks.push(links)
    })
    expect(tableLinks).toHaveLength(2)
    expect(tableLinks[1]!.entries[0]).not.toBe(tableLinks[0]!.entries[0])
    expect(tableLinks.every((table) => table.refs.every((target) => table.entries.includes(target)))).toBe(true)
    const { doc: irDoc } = pmToIr(editor.getJSON() as PMJsonNode)
    expect(resolve(irDoc).problems.filter((problem) => ['dangling-footnote', 'unreferenced-footnote'].includes(problem.code))).toEqual([])
  })

  it('共享编号把表注行中的多条注显示为注1和注2', async () => {
    const editor = createEditor()
    let transactionCount = 0
    editor.on('transaction', () => { transactionCount += 1 })
    const position = findTextblockPosition(editor, 'paragraph', true)
    const labels = () => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.std-table-note-row .std-note-marker'))
      .map((element) => element.textContent)

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)))
    expect(editor.commands.addTableNote()).toBe(true)
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    expect(labels()).toEqual(['注：'])

    const nextCellPosition = findTextblockPosition(editor, 'paragraph', true)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, nextCellPosition)))
    expect(editor.commands.addTableNote()).toBe(true)
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    expect(labels()).toEqual(['注1：', '注2：'])
    const stableTransactionCount = transactionCount
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    expect(transactionCount).toBe(stableTransactionCount)
  })

  it('XML 导入后表注显示注1/注2，表脚注定义按引用顺序同步排列', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const extensions = createEditorExtensions()
    const content = parseXmlToEditorJson(`<?xml version="1.0" encoding="UTF-8"?>
      <standard xmlns="urn:csbts:std:xml:1.0">
        <front><std-meta><std-ref>GB/T 1.1—2020</std-ref></std-meta></front>
        <body><sec id="sec-1"><title>范围</title>
          <table-wrap id="table-import-order">
            <caption><title>测试表 <xref ref-type="table-fn" rid="tfn-a">a</xref></title></caption>
            <table><tr><th><p>项目</p></th></tr><tr><td><p><xref ref-type="table-fn" rid="tfn-b">b</xref></p></td></tr></table>
            <table-wrap-foot>
              <non-normative-note><p>第一条表注。</p></non-normative-note>
              <non-normative-note><p>第二条表注。</p></non-normative-note>
              <fn fn-type="table" id="tfn-b"><label>b</label><p>定义 B。</p></fn>
              <fn fn-type="table" id="tfn-a"><label>a</label><p>定义 A。</p></fn>
            </table-wrap-foot>
          </table-wrap>
        </sec></body>
      </standard>`, 'doc')
    const editor = new Editor({ element, extensions, content })
    editors.push(editor)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))

    const entryIds: string[] = []
    const entryTexts: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableFootnoteEntry') {
        entryIds.push(String(node.attrs.nodeId))
        entryTexts.push(node.textContent)
      }
    })
    expect(entryIds).toEqual(['tfn-a', 'tfn-b'])
    expect(entryTexts).toEqual(['定义 A。', '定义 B。'])
    expect(Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.std-table-note-row .std-note-marker'))
      .map((marker) => marker.textContent)).toEqual(['注1：', '注2：'])
    expect(Array.from(editor.view.dom.querySelectorAll<HTMLElement>('[data-table-footnote-label]'))
      .map((marker) => marker.textContent)).toEqual(['a', 'b'])
  })

  it('嵌套 stdTable 的引用不参与外层表脚注定义排序', () => {
    const editor = createEditor()
    const original: { value: { node: import('@tiptap/pm/model').Node; pos: number } | null } = { value: null }
    editor.state.doc.descendants((node, pos) => {
      if (!original.value && node.type.name === 'stdTable') original.value = { node, pos }
    })
    if (!original.value) throw new Error('测试表格未创建')
    const originalTable = original.value

    const { schema } = editor
    const paragraph = (content: import('@tiptap/pm/model').Fragment | import('@tiptap/pm/model').Node[] = []) =>
      schema.nodes.paragraph.create(null, content)
    const nestedRef = schema.nodes.tableFootnoteRef.create({ nodeId: 'nested-ref', targetId: 'outer-b' })
    const nestedGrid = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [
        schema.nodes.tableCell.create(null, [paragraph([nestedRef])]),
      ]),
    ])
    const nestedTable = schema.nodes.stdTable.create({ id: 'nested-table' }, [
      schema.nodes.tableCaption.create(),
      nestedGrid,
    ])
    const outerRef = schema.nodes.tableFootnoteRef.create({ nodeId: 'outer-ref', targetId: 'outer-a' })
    const outerGrid = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [
        schema.nodes.tableCell.create(null, [nestedTable, paragraph([outerRef])]),
      ]),
    ])
    const entries = schema.nodes.tableFootnoteRow.create(null, [
      schema.nodes.tableFootnoteEntry.create({ nodeId: 'outer-a' }, [schema.text('定义 A')]),
      schema.nodes.tableFootnoteEntry.create({ nodeId: 'outer-b' }, [schema.text('定义 B')]),
    ])
    const replacement = schema.nodes.stdTable.create({ id: 'outer-table' }, [
      schema.nodes.tableCaption.create(),
      outerGrid,
      entries,
    ])

    editor.view.dispatch(editor.state.tr.replaceWith(
      originalTable.pos,
      originalTable.pos + originalTable.node.nodeSize,
      replacement,
    ))
    const outerEntryIds: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableFootnoteEntry' && String(node.attrs.nodeId).startsWith('outer-')) {
        outerEntryIds.push(String(node.attrs.nodeId))
      }
    })
    expect(outerEntryIds).toEqual(['outer-a', 'outer-b'])
  })

  it('DOMObserver 忽略标签变化；定义随首次引用排序，undo/redo 保留引用、正文和光标', async () => {
    const editor = createEditor()
    let transactionCount = 0
    editor.on('transaction', () => { transactionCount += 1 })
    const waitForDomObserver = (milliseconds = 40) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
    const getCellPositions = () => {
      const positions: number[] = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph') return
        const $pos = editor.state.doc.resolve(pos + 1)
        let inCell = false
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
          if ($pos.node(depth).type.name === 'tableCell' || $pos.node(depth).type.name === 'tableHeader') inCell = true
          if ($pos.node(depth).type.name === 'stdTable') break
        }
        if (inCell) positions.push(pos + 1)
      })
      return positions
    }
    const entryLabels = () => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.std-table-footnote-entry'))
      .map((element) => element.querySelector<HTMLElement>('[data-table-footnote-label]')?.textContent || '')

    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, getCellPositions()[0]!)))
    expect(editor.commands.insertTableFootnote({ content: [{ type: 'text', text: '表脚注一' }] })).toBe(true)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, getCellPositions()[1]!)))
    expect(editor.commands.insertTableFootnote({ content: [{ type: 'text', text: '表脚注二' }] })).toBe(true)
    await waitForDomObserver()
    expect(entryLabels()).toEqual(['a', 'b'])

    const entries: string[] = []
    const refs: Array<{ pos: number; targetId: string }> = []
    const entryPositions: Array<{ nodeId: string; pos: number }> = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableFootnoteEntry') {
        entries.push(String(node.attrs.nodeId))
        entryPositions.push({ nodeId: String(node.attrs.nodeId), pos })
      }
      if (node.type.name === 'tableFootnoteRef') refs.push({ pos, targetId: String(node.attrs.targetId) })
    })
    expect(entries).toHaveLength(2)
    expect(refs).toHaveLength(2)
    const selectedEntryId = entries[1]!
    const selectedEntryPos = entryPositions.find((entry) => entry.nodeId === selectedEntryId)!.pos
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, selectedEntryPos + 3)))
    editor.view.dispatch(editor.state.tr
      .setNodeAttribute(refs[0]!.pos, 'targetId', entries[1])
      .setNodeAttribute(refs[1]!.pos, 'targetId', entries[0]))
    await waitForDomObserver()
    const orderedEntryIds = () => {
      const ids: string[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'tableFootnoteEntry') ids.push(String(node.attrs.nodeId))
      })
      return ids
    }
    const orderedReferenceTargets = () => {
      const targets: string[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'tableFootnoteRef') targets.push(String(node.attrs.targetId))
      })
      return targets
    }
    expect(orderedEntryIds()).toEqual([entries[1], entries[0]])
    expect(orderedReferenceTargets()).toEqual([entries[1], entries[0]])
    expect(entryLabels()).toEqual(['a', 'b'])
    expect(editor.state.selection.$from.parent.type.name).toBe('tableFootnoteEntry')
    expect(editor.state.selection.$from.parent.attrs.nodeId).toBe(selectedEntryId)
    expect(editor.state.selection.from - editor.state.selection.$from.start()).toBe(2)

    expect(editor.commands.undo()).toBe(true)
    await waitForDomObserver()
    expect(orderedEntryIds()).toEqual(entries)
    expect(orderedReferenceTargets()).toEqual(entries)
    expect(entryLabels()).toEqual(['a', 'b'])
    expect(editor.state.doc.textContent).toContain('表脚注一')
    expect(editor.state.doc.textContent).toContain('表脚注二')
    expect(editor.state.selection.$from.parent.type.name).toBe('tableFootnoteEntry')
    expect(editor.state.selection.$from.parent.attrs.nodeId).toBe(selectedEntryId)

    expect(editor.commands.redo()).toBe(true)
    await waitForDomObserver()
    expect(orderedEntryIds()).toEqual([entries[1], entries[0]])
    expect(orderedReferenceTargets()).toEqual([entries[1], entries[0]])
    expect(entryLabels()).toEqual(['a', 'b'])
    expect(editor.state.selection.$from.parent.type.name).toBe('tableFootnoteEntry')
    expect(editor.state.selection.$from.parent.attrs.nodeId).toBe(selectedEntryId)
    const stableTransactionCount = transactionCount
    await waitForDomObserver(100)
    expect(transactionCount).toBe(stableTransactionCount)

    const editedId = selectedEntryId
    const editedEntry = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.std-table-footnote-entry'))
      .find((element) => element.dataset.nodeId === editedId)
    const contentDOM = editedEntry?.querySelector<HTMLElement>('.std-table-footnote-entry-content')
    expect(contentDOM).toBeTruthy()
    contentDOM!.replaceChildren(document.createTextNode('已编辑的表脚注正文'))
    await waitForDomObserver()
    let savedText = ''
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableFootnoteEntry' && node.attrs.nodeId === editedId) savedText = node.textContent
    })
    expect(savedText).toBe('已编辑的表脚注正文')
  })
})
