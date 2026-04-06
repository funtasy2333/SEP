import { Node } from '@tiptap/core'

/**
 * 标准文档根节点
 * 代表整个标准文件，携带文档元数据
 */
export const StandardDoc = Node.create({
  name: 'standardDoc',
  topNode: true,
  content: 'coverPage? foreword? introduction? chapter+ appendix* bibliography?',

  addAttributes() {
    return {
      standardNo: { default: null },
      icsCode: { default: null },
      ccsCode: { default: null },
      titleCn: { default: '' },
      titleEn: { default: '' },
      publishDate: { default: null },
      implementDate: { default: null },
      standardType: { default: 'national' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="standard-doc"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-type': 'standard-doc', class: 'standard-doc' }, 0]
  },
})
