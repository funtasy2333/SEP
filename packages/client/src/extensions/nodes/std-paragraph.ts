import { Node, mergeAttributes } from '@tiptap/core'

/**
 * 标准正文段落
 * 替代默认的 paragraph 节点，带有标准格式（首行缩进等）
 */
export const StdParagraph = Node.create({
  name: 'stdParagraph',
  group: 'block',
  content: 'inline*',

  parseHTML() {
    // The generic Paragraph rule also matches every <p>. Give the persisted
    // semantic marker precedence so chapter children survive HTML round trips.
    return [{ tag: 'p[data-type="std-paragraph"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'p',
      mergeAttributes(HTMLAttributes, { 'data-type': 'std-paragraph', class: 'std-paragraph' }),
      0,
    ]
  },
})
