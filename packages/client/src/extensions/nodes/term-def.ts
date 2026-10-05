import { Node, mergeAttributes } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import type { DOMOutputSpec, Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

type TermFieldName = 'termName' | 'termNameEn' | 'termDefinition'

interface TermFieldPosition {
  node: PMNode
  start: number
  contentStart: number
}

function termDepthAt($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'termDef') return depth
  }
  return -1
}

function findTermField(
  term: PMNode,
  termStart: number,
  fieldName: TermFieldName,
): TermFieldPosition | undefined {
  let result: TermFieldPosition | undefined
  term.forEach((child, offset) => {
    if (!result && child.type.name === fieldName) {
      const start = termStart + 1 + offset
      result = { node: child, start, contentStart: start + 1 }
    }
  })
  return result
}

function selectTermField(editor: Editor, field: TermFieldPosition): boolean {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, field.contentStart))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

function handleTermEnter(editor: Editor): boolean {
  const { state } = editor
  const { $from, $to } = state.selection
  const fieldName = $from.parent.type.name

  if (fieldName === 'termName' || fieldName === 'termNameEn') {
    const depth = termDepthAt($from)
    if (depth < 0) return false
    const term = $from.node(depth)
    const definition = findTermField(term, $from.before(depth), 'termDefinition')
    return definition ? selectTermField(editor, definition) : false
  }

  if (fieldName === 'termDefinition') {
    // Keep the split within a single definition block; a cross-block selection
    // is left to ProseMirror's regular Enter handling.
    if ($to.parent !== $from.parent) return false
    const paragraphType = state.schema.nodes.stdParagraph
    if (!paragraphType) return false
    const tr = state.tr
    if (!state.selection.empty) tr.deleteSelection()
    const splitAt = tr.selection.from
    tr.split(splitAt, 1, [{ type: paragraphType }])
    editor.view.dispatch(tr.scrollIntoView())
    return true
  }

  if (fieldName === 'stdParagraph' && state.selection.empty && $from.parent.content.size === 0) {
    const depth = termDepthAt($from)
    if (depth < 0) return false
    const term = $from.node(depth)
    const continuation = $from.parent
    // Match pmToIr's first recognized source paragraph; subsequent source-like
    // paragraphs remain definition content there, so they must still block exit.
    let sourceIndex = -1
    for (let index = 0; index < term.childCount; index++) {
      const child = term.child(index)
      if (sourceIndex < 0 && child.type.name === 'stdParagraph' && /^\s*[[［]来源/.test(child.textContent)) sourceIndex = index
    }
    // Trailing annotations still belong to the term. The last definition
    // continuation can exit before them, without moving or deleting the annotations.
    for (let index = $from.index(depth) + 1; index < term.childCount; index++) {
      const child = term.child(index)
      const emptyPlaceholder = child.type.name === 'stdParagraph' && child.content.size === 0
      if (!['note', 'example', 'termSource'].includes(child.type.name) && index !== sourceIndex && !emptyPlaceholder) return false
    }
    const continuationPos = $from.before($from.depth)
    const termStart = $from.before(depth)
    const insertPos = termStart + term.nodeSize - continuation.nodeSize
    const nextParagraph = state.schema.nodes.stdParagraph?.create()
    if (!nextParagraph) return false
    const tr = state.tr.delete(continuationPos, continuationPos + continuation.nodeSize)
    tr.insert(insertPos, nextParagraph)
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1))
    editor.view.dispatch(tr.scrollIntoView())
    return true
  }

  return false
}

function handleTermTab(editor: Editor): boolean {
  const { state } = editor
  const { $from } = state.selection
  if ($from.parent.type.name !== 'termName' && $from.parent.type.name !== 'termNameEn') return false

  const depth = termDepthAt($from)
  if (depth < 0) return false
  const term = $from.node(depth)
  const termStart = $from.before(depth)

  if ($from.parent.type.name === 'termNameEn') {
    const definition = findTermField(term, termStart, 'termDefinition')
    return definition ? selectTermField(editor, definition) : false
  }

  const english = findTermField(term, termStart, 'termNameEn')
  if (english) return selectTermField(editor, english)

  const chinese = findTermField(term, termStart, 'termName')
  const englishType = state.schema.nodes.termNameEn
  if (!chinese || !englishType) return false
  const insertPos = chinese.start + chinese.node.nodeSize
  const englishNode = englishType.create()
  const tr = state.tr.insert(insertPos, englishNode)
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

function handleTermShiftTab(editor: Editor): boolean {
  const { state } = editor
  const { $from } = state.selection
  if ($from.parent.type.name !== 'termNameEn') return false

  const depth = termDepthAt($from)
  if (depth < 0) return false
  const chinese = findTermField($from.node(depth), $from.before(depth), 'termName')
  return chinese ? selectTermField(editor, chinese) : false
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    termDef: {
      insertTermDef: (attrs?: { level?: number; termCn?: string; termEn?: string }) => ReturnType
    }
  }
}

/**
 * 术语定义节点
 * 对应 GB/T 37967 中的 <term> 元素
 * 结构：术语名（标题） + 英文名 + 定义 + 注(可选) + 示例(可选)
 * 支持 1~5 级，与"条"一致
 */
export const TermDef = Node.create({
  name: 'termDef',
  group: 'block',
  content: 'termName termNameEn? termDefinition (stdParagraph | note | example | termDef | tbxLangSet | termSource)*',
  defining: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 术语编号，如 "3.1" */
      number: { default: null },
      /** 术语条层级 1-5 */
      level: { default: 1 },
    }
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="term-def"]',
      getAttrs(dom) {
        const el = dom as HTMLElement
        return {
          level: parseInt(el.getAttribute('data-level') || '1', 10),
        }
      },
    }]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'term-def',
        'data-level': node.attrs.level,
        class: `std-term-def std-term-def-level-${node.attrs.level}`,
      }),
      0,
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => handleTermEnter(editor),
      Tab: ({ editor }) => handleTermTab(editor),
      'Shift-Tab': ({ editor }) => handleTermShiftTab(editor),
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection
        // 光标在 termName 开头时，删除整个 termDef
        if ($from.parent.type.name === 'termName' && $from.parentOffset === 0) {
          // 找到 termDef 祖先
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'termDef') {
              // 仅在内容全部为空时删除
              if (node.textContent.trim() === '') {
                const pos = $from.before(d)
                editor.chain()
                  .deleteRange({ from: pos, to: pos + node.nodeSize })
                  .run()
                return true
              }
              break
            }
          }
        }
        return false
      },
    }
  },

  addCommands() {
    return {
      insertTermDef:
        (attrs) =>
        ({ chain }) => {
          const level = attrs?.level ?? 1
          return chain()
            .insertContent({
              type: 'termDef',
              attrs: { level },
              content: [
                {
                  type: 'termName',
                  content: attrs?.termCn ? [{ type: 'text', text: attrs.termCn }] : [],
                },
                {
                  type: 'termNameEn',
                  content: attrs?.termEn ? [{ type: 'text', text: attrs.termEn }] : [],
                },
                {
                  type: 'termDefinition',
                },
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 术语中文名（标题）
 */
export const TermName = Node.create({
  name: 'termName',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="term-name"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'term-name', class: 'std-term-name' }),
      0,
    ]
  },
})

/**
 * 术语英文名
 */
export const TermNameEn = Node.create({
  name: 'termNameEn',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="term-name-en"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'term-name-en',
        class: 'std-term-name-en',
        lang: 'en',
      }),
      0,
    ]
  },
})

/**
 * 术语定义
 */
export const TermDefinition = Node.create({
  name: 'termDefinition',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="term-definition"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'term-definition',
        class: 'std-term-definition',
      }),
      0,
    ]
  },
})

/** Typed source carrier so plain IR source values do not need a lossy text prefix. */
export const TermSource = Node.create({
  name: 'termSource',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-type="term-source"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'p',
      mergeAttributes(HTMLAttributes, { 'data-type': 'term-source', class: 'std-term-source' }),
      ['span', { class: 'std-term-source-label' }, '来源：'],
      ['span', { class: 'std-term-source-content' }, 0],
    ]
  },
})
