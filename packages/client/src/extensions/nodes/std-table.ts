import { Node, mergeAttributes } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import type { DOMOutputSpec, Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { columnWidthProblem, generateNodeId, graphicAttributeProblem, type PMJsonNode } from '@ses/shared'
import { normalizePageOrientation, readPageOrientation } from '../../utils/orientation'
import { jsonAttribute } from './json-attribute'

function stringAttribute(name: string, defaultValue: string | null = null) {
  return { default: defaultValue, parseHTML: (element: HTMLElement) => element.getAttribute(name) ?? defaultValue }
}

function legacyTableFootnoteContentElement(element: HTMLElement): HTMLElement {
  const content = element.ownerDocument.createElement('span')
  for (const child of Array.from(element.childNodes)) {
    const copy = child.cloneNode(true)
    if (copy.nodeType === 1) {
      const copyElement = copy as HTMLElement
      if (copyElement.matches('[data-table-footnote-label]')) continue
      copyElement.querySelectorAll('[data-table-footnote-label]').forEach(label => label.remove())
    }
    content.append(copy)
  }
  return content
}

/**
 * `columns`（WP8.M G8，M-6.1-03）在 HTML 中的载体：`data-columns` 存 JSON，往返以它为准；
 * 同时为每个带有效宽度的列写自定义属性 `--ses-col-<n>`（n 从 1 起），供样式给 `<colgroup>` 的对应 `<col>` 设宽度
 * （见 styles/standard-nodes.css）。自定义属性只来自通过 {@link columnWidthProblem} 校验的值（有限正数 + 字母/% 记号式单位），
 * 不会把任意文本写进 style。
 */
function parseColumnsAttribute(element: HTMLElement): unknown {
  const raw = element.getAttribute('data-columns')
  if (raw === null || raw === '') return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function renderColumnsAttribute(attributes: Record<string, unknown>): Record<string, string> {
  const columns = attributes.columns
  if (!Array.isArray(columns) || columns.length === 0) return {}
  const variables: string[] = []
  columns.forEach((column: unknown, index) => {
    if (!column || typeof column !== 'object') return
    const { width, widthUnit } = column as { width?: unknown; widthUnit?: unknown }
    if (columnWidthProblem(width, widthUnit) === null) variables.push(`--ses-col-${index + 1}: ${String(width)}${String(widthUnit)}`)
  })
  return {
    'data-columns': JSON.stringify(columns),
    ...(variables.length > 0 ? { style: variables.join('; ') } : {}),
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    stdTable: {
      insertStdTable: (attrs?: {
        rows?: number
        cols?: number
        captionCn?: string
      }) => ReturnType
      addTableNote: () => ReturnType
      insertTableFootnote: (attrs: { content: PMJsonNode[] }) => ReturnType
      insertTableFootnoteRef: (attrs: { targetId: string }) => ReturnType
      deleteSelectedTableFootnoteRef: () => ReturnType
      deleteTableFootnoteEntry: (attrs: { nodeId: string }) => ReturnType
    }
  }
}

/** Only the active table's direct definition row owns its footnote targets. */
export function getTableFootnoteEntries(table: PMNode): PMNode[] {
  const entries: PMNode[] = []
  table.forEach((child) => {
    if (child.type.name !== 'tableFootnoteRow') return
    child.forEach((entry) => {
      if (entry.type.name === 'tableFootnoteEntry') entries.push(entry)
    })
  })
  return entries
}

/**
 * 标准表格节点
 * 包裹表格，添加中/英文表标题和表注
 * 编号格式：表1, 表2, ... 或附录中 表A.1, 表A.2, ...
 */
export const StdTable = Node.create({
  name: 'stdTable',
  group: 'block',
  content: 'tableCaption tableCaptionEn? table tableFootnote? tableNoteRow? tableFootnoteRow?',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 自动编号 */
      number: { default: null },
      unit: stringAttribute('unit'),
      /** 重复表头行数独立于单元格类型；null 兼容旧表格的自动推断。 */
      headerRowCount: { default: null },
      alternativeGraphic: jsonAttribute('data-alternative-graphic', value => {
        if (value == null) return
        const problem = graphicAttributeProblem(value, false, true)
        if (problem) throw new RangeError(`alternativeGraphic ${problem}`)
      }),
      /** 表格整体宽度与样式字段，均为JSON安全的标量。 */
      width: { default: null },
      widthUnit: stringAttribute('widthUnit'),
      layout: stringAttribute('layout'),
      borderModel: stringAttribute('borderModel'),
      textAlign: stringAttribute('textAlign'),
      verticalAlign: stringAttribute('verticalAlign'),
      borderColor: stringAttribute('borderColor'),
      borderWidth: { default: null },
      borderWidthUnit: stringAttribute('borderWidthUnit'),
      backgroundColor: stringAttribute('backgroundColor'),
      cellPadding: { default: null },
      cellPaddingUnit: stringAttribute('cellPaddingUnit'),
      /**
       * 列模型（名义列宽，M-6.1-03）：`{width, widthUnit, textAlign, verticalAlign}[]`，长度等于网格列数；
       * 缺省 null（P2：序列化时 null 属性被剔除，旧文档与 JSON golden 不变）。放在外层 stdTable 而不是内层 table：
       * 内层是 prosemirror-tables 的网格节点。与单元格的 `colwidth`（编辑器拖拽得到的 px）互相独立。
       */
      columns: {
        default: null,
        parseHTML: parseColumnsAttribute,
        renderHTML: renderColumnsAttribute,
      },
      orientation: {
        default: 'portrait',
        parseHTML: (element) => readPageOrientation(element),
        renderHTML: (attributes) => ({
          'data-orientation': normalizePageOrientation(attributes.orientation),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="std-table"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'std-table', class: 'std-table-wrapper' }),
      0,
    ]
  },

  addCommands() {
    return {
      insertStdTable:
        (attrs) =>
        ({ chain, editor }) => {
          const rows = attrs?.rows ?? 3
          const cols = attrs?.cols ?? 3

          // 构建表格单元格
          const headerCells = Array.from({ length: cols }, () => ({
            type: 'tableHeader',
            content: [{ type: 'paragraph' }],
          }))
          const bodyCells = Array.from({ length: cols }, () => ({
            type: 'tableCell',
            content: [{ type: 'paragraph' }],
          }))
          const tableRows = [
            { type: 'tableRow', content: headerCells },
            ...Array.from({ length: rows - 1 }, () => ({
              type: 'tableRow',
              content: bodyCells,
            })),
          ]

          // 检查 editor schema 中是否有 table 节点
          const hasTable = !!editor.schema.nodes.table

          return chain()
            .insertContent({
              type: 'stdTable',
              content: [
                {
                  type: 'tableCaption',
                  content: attrs?.captionCn
                    ? [{ type: 'text', text: attrs.captionCn }]
                    : [],
                },
                ...(hasTable
                  ? [{ type: 'table', content: tableRows }]
                  : []),
              ],
            })
            .run()
        },
      addTableNote:
        () =>
        ({ state, dispatch }) => {
          const location = findActiveStdTable(state.selection.$from)
          if (!location || !selectionInsideTableCell(state.selection.$from)) return false
          const { node: table, pos: tablePos } = location
          const note = state.schema.nodes.note.create(null, [])
          const children: PMNode[] = []
          let row = -1
          let noteIndex = 0
          table.forEach((child) => {
            if (child.type.name === 'tableNoteRow') {
              row = children.length
              noteIndex = child.childCount
              children.push(child.copy(child.content.append(Fragment.from(note))))
            } else children.push(child)
          })
          if (row < 0) {
            const footnoteRowIndex = children.findIndex((child) => child.type.name === 'tableFootnoteRow')
            row = footnoteRowIndex >= 0 ? footnoteRowIndex : children.length
            noteIndex = 0
            children.splice(row, 0, state.schema.nodes.tableNoteRow.create(null, [note]))
          }
          const updatedTable = table.type.create(table.attrs, children)
          if (dispatch) {
            const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, updatedTable)
            const notePos = childNodePos(updatedTable, tablePos, row, noteIndex)
            tr.setSelection(TextSelection.create(tr.doc, notePos + 1))
            dispatch(tr)
          }
          return true
        },
      insertTableFootnote:
        ({ content }) =>
        ({ state, dispatch }) => {
          const location = findActiveStdTable(state.selection.$from)
          if (!location || !selectionInsideTableCell(state.selection.$from)) return false
          const { pos: tablePos } = location
          const targetId = generateNodeId()
          const refId = generateNodeId()
          const inlineContent = content.map((item) => state.schema.nodeFromJSON(item))
          const entry = state.schema.nodes.tableFootnoteEntry.create({ nodeId: targetId }, inlineContent)
          const ref = state.schema.nodes.tableFootnoteRef.create({ nodeId: refId, targetId })
          const insertionPos = state.selection.to
          let tr = state.tr.insert(insertionPos, ref)
          const tableAfterReference = tr.doc.nodeAt(tablePos)
          if (!tableAfterReference || tableAfterReference.type.name !== 'stdTable') return false
          const children: PMNode[] = []
          let rowIndex = -1
          let entryIndex = 0
          tableAfterReference.forEach((child) => {
            if (child.type.name === 'tableFootnoteRow') {
              rowIndex = children.length
              entryIndex = child.childCount
              children.push(child.copy(child.content.append(Fragment.from(entry))))
            } else children.push(child)
          })
          if (rowIndex < 0) {
            rowIndex = children.length
            entryIndex = 0
            children.push(state.schema.nodes.tableFootnoteRow.create(null, [entry]))
          }
          const updatedTable = tableAfterReference.type.create(tableAfterReference.attrs, children)
          tr = tr.replaceWith(tablePos, tablePos + tableAfterReference.nodeSize, updatedTable)
          const entryPos = childNodePos(updatedTable, tablePos, rowIndex, entryIndex)
          tr.setSelection(TextSelection.create(tr.doc, entryPos + 1))
          if (dispatch) dispatch(tr)
          return true
        },
      insertTableFootnoteRef:
        ({ targetId }) =>
        ({ state, dispatch }) => {
          const location = findActiveStdTable(state.selection.$from)
          if (!location || !selectionInsideTableCell(state.selection.$from)) return false
          const targetExists = getTableFootnoteEntries(location.node)
            .some((entry) => entry.attrs.nodeId === targetId)
          if (!targetExists) return false
          const pos = state.selection.to
          const ref = state.schema.nodes.tableFootnoteRef.create({ nodeId: generateNodeId(), targetId })
          if (dispatch) {
            const tr = state.tr.insert(pos, ref)
            tr.setSelection(TextSelection.create(tr.doc, pos + ref.nodeSize))
            dispatch(tr)
          }
          return true
        },
      deleteSelectedTableFootnoteRef:
        () =>
        ({ state, dispatch }) => {
          const { selection } = state
          if (selection instanceof NodeSelection && selection.node.type.name === 'tableFootnoteRef') {
            if (dispatch) dispatch(state.tr.delete(selection.from, selection.to))
            return true
          }
          if (!selection.empty) return false
          const before = selection.$from.nodeBefore
          const after = selection.$from.nodeAfter
          if (before?.type.name === 'tableFootnoteRef') {
            if (dispatch) dispatch(state.tr.delete(selection.$from.pos - before.nodeSize, selection.$from.pos))
            return true
          }
          if (after?.type.name === 'tableFootnoteRef') {
            if (dispatch) dispatch(state.tr.delete(selection.$from.pos, selection.$from.pos + after.nodeSize))
            return true
          }
          return false
        },
      deleteTableFootnoteEntry:
        ({ nodeId }) =>
        ({ state, dispatch }) => {
          const found: { entry: { node: PMNode; pos: number } | null; referenced: boolean } = {
            entry: null,
            referenced: false,
          }
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'tableFootnoteEntry' && node.attrs.nodeId === nodeId) {
              found.entry = { node, pos }
              return false
            }
          })
          state.doc.descendants((node) => {
            if (node.type.name === 'tableFootnoteRef' && node.attrs.targetId === nodeId) found.referenced = true
          })
          if (!found.entry || found.referenced) return false
          let deleteFrom = found.entry.pos
          let deleteTo = found.entry.pos + found.entry.node.nodeSize
          const $entry = state.doc.resolve(found.entry.pos + 1)
          for (let depth = $entry.depth; depth > 0; depth -= 1) {
            const ancestor = $entry.node(depth)
            if (ancestor.type.name !== 'tableFootnoteRow') continue
            if (ancestor.childCount === 1) {
              deleteFrom = $entry.before(depth)
              deleteTo = deleteFrom + ancestor.nodeSize
            }
            break
          }
          if (dispatch) dispatch(state.tr.delete(deleteFrom, deleteTo))
          return true
        },
    }
  },
})

function findActiveStdTable($pos: import('@tiptap/pm/model').ResolvedPos): { node: PMNode; pos: number } | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'stdTable') return { node, pos: $pos.before(depth) }
  }
  return null
}

function selectionInsideTableCell($pos: import('@tiptap/pm/model').ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const type = $pos.node(depth).type.name
    if (type === 'tableCell' || type === 'tableHeader') return true
    if (type === 'stdTable') return false
  }
  return false
}

function childNodePos(parent: PMNode, parentPos: number, childIndex: number, innerChildIndex: number): number {
  let offset = 0
  for (let index = 0; index < childIndex; index += 1) offset += parent.child(index).nodeSize
  const child = parent.child(childIndex)
  if (child.type.name === 'tableNoteRow' || child.type.name === 'tableFootnoteRow') {
    offset += 1
    for (let index = 0; index < innerChildIndex; index += 1) offset += child.child(index).nodeSize
  }
  return parentPos + 1 + offset
}

/**
 * 中文表标题
 */
export const TableCaption = Node.create({
  name: 'tableCaption',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-caption"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'table-caption',
        class: 'std-table-caption',
      }),
      0,
    ]
  },
})

/**
 * 英文表标题
 */
export const TableCaptionEn = Node.create({
  name: 'tableCaptionEn',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-caption-en"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'table-caption-en',
        class: 'std-table-caption-en',
        lang: 'en',
      }),
      0,
    ]
  },
})

/**
 * 表注
 */
export const TableFootnote = Node.create({
  name: 'tableFootnote',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-footnote"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'table-footnote',
        class: 'std-table-footnote',
      }),
      0,
    ]
  },
})

/** 同一表格内普通表注的集合；每个 note 仍按既有“注/注1：”规则渲染。 */
export const TableNoteRow = Node.create({
  name: 'tableNoteRow',
  content: 'note+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-note-row"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-note-row', class: 'std-table-note-row' }), 0]
  },
})

/** 同一张表内脚注定义集合；引用上标指向其中具体 entry。 */
export const TableFootnoteRow = Node.create({
  name: 'tableFootnoteRow',
  content: 'tableFootnoteEntry+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-footnote-row"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'table-footnote-row', class: 'std-table-footnote-row' }), 0]
  },
})

/** 单个表脚注定义；编号只在不可编辑的 label 中展示，正文保持普通 inline 编辑。 */
export const TableFootnoteEntry = Node.create({
  name: 'tableFootnoteEntry',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{
      tag: 'p[data-type="table-footnote-entry"]',
      priority: 51,
      contentElement: element =>
        element.querySelector<HTMLElement>(':scope > .std-table-footnote-entry-content')
          ?? legacyTableFootnoteContentElement(element),
    }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'p',
      mergeAttributes(HTMLAttributes, { 'data-type': 'table-footnote-entry', class: 'std-table-footnote-entry' }),
      ['sup', { 'data-table-footnote-label': '' }, ''],
      ['span', { class: 'std-table-footnote-entry-content' }, 0],
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('p')
      const label = document.createElement('sup')
      const contentDOM = document.createElement('span')
      dom.className = 'std-table-footnote-entry'
      dom.dataset.type = 'table-footnote-entry'
      dom.contentEditable = 'true'
      label.dataset.tableFootnoteLabel = ''
      label.contentEditable = 'false'
      contentDOM.className = 'std-table-footnote-entry-content'
      dom.append(label, contentDOM)
      const updateAttributes = (current: typeof node) => {
        const nodeId = current.attrs.nodeId ?? ''
        if (dom.dataset.nodeId !== nodeId) dom.dataset.nodeId = nodeId
      }
      updateAttributes(node)
      label.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const id = dom.dataset.nodeId
        if (id) {
          if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ses:edit-footnote', { detail: { nodeId: id, table: true } }))
        }
      })
      return {
        dom,
        contentDOM,
        update(current) {
          if (current.type !== node.type) return false
          updateAttributes(current)
          return true
        },
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false
          const target = mutation.target
          return target !== contentDOM && !contentDOM.contains(target)
        },
      }
    }
  },
})
