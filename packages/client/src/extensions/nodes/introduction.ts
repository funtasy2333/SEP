import { Node, mergeAttributes } from '@tiptap/core'

/**
 * 引言节点
 * 标准文件的引言部分（可选）
 */
export const Introduction = Node.create({
  name: 'introduction',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'section[data-type="introduction"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-type': 'introduction', class: 'std-introduction' }),
      0,
    ]
  },
})
