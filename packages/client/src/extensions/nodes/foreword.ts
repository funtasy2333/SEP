import { Node, mergeAttributes } from '@tiptap/core'

/**
 * 前言节点
 * 标准文件的前言部分
 */
export const Foreword = Node.create({
  name: 'foreword',
  group: 'block',
  content: 'block+',
  // 粘贴时只作为上下文 defining（definingAsContext，由 StructuralPaste 补上），见 plugins/structuralPaste.ts（#71）

  parseHTML() {
    return [{ tag: 'section[data-type="foreword"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-type': 'foreword', class: 'std-foreword' }),
      0,
    ]
  },
})
