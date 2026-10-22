import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

/**
 * 块内容的注与示例（WP8.M G7-b，矩阵 M-5.6-05，设计 §4.7.2，D-M-05）。
 *
 * 生产的 `note`/`example`（note.ts）内容是 `inline*`，只能存单段文字；IR 的 `IRNote.content` 是块数组，可含多个段落与
 * 列项（GB/T 46687.2 5.6：non-normative-note 内容为 p、list 等）。把 `note` 的内容表达式改成块会让所有既有文档失效，
 * 因此这里**新增**节点而不动旧节点：
 * - `noteBlock` / `exampleBlock`：块组，内容 `(stdParagraph | stdList)+`，带 nodeId；
 * - 往返的 canonical 规则（irToPm）：内容恰为一个 id 为 `${注 id}.p0` 的段落 → 旧 `note`/`example`；其余（多块、含列项、
 *   段落 id 不是派生值）→ 本节点，子块各自保留 nodeId；
 * - 只出现在块位置（章/条/附录/前言/引言/单元格）；术语条目、表注行、图内仍用旧的单段 `note`/`example`。
 *
 * 本阶段只做「模型 + 显示」，不提供插入/转换入口（命令、斜杠菜单、工具栏都不识别这两个节点）。
 */

/** 注：编号标记（「注：」「注1：」）由 FootnoteLabels 按 Resolver 作用域写入 `.std-note-marker`，与 `Note` 的 NodeView 同款。 */
export const NoteBlock = Node.create({
  name: 'noteBlock',
  group: 'block',
  content: '(stdParagraph | stdList)+',
  defining: true,

  // 优先于通用的 div 规则；`data-type` 不同于旧 note（div[data-type="note"]），两者互不匹配。
  parseHTML() {
    return [{ tag: 'div[data-type="note-block"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'note-block', class: 'std-note std-note-block' }),
      0,
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      const marker = document.createElement('span')
      const contentDOM = document.createElement('div')
      dom.className = 'std-note std-note-editor std-note-block'
      dom.dataset.type = 'note-block'
      marker.className = 'std-note-marker'
      marker.contentEditable = 'false'
      contentDOM.className = 'std-note-content std-note-block-content'
      dom.append(marker, contentDOM)

      const updateAttributes = (current: typeof node) => {
        const nodeId = current.attrs.nodeId ?? ''
        if (dom.dataset.nodeId !== nodeId) dom.dataset.nodeId = nodeId
      }
      updateAttributes(node)

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

/** 示例：「示例：」「示例N：」标签由 FootnoteLabels 的 Decoration 写入 `data-resolved-label`，样式由 CSS 的 ::before 显示（单独成行，10.4.5）。 */
export const ExampleBlock = Node.create({
  name: 'exampleBlock',
  group: 'block',
  content: '(stdParagraph | stdList)+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="example-block"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'example-block', class: 'std-example std-example-block' }),
      0,
    ]
  },
})
