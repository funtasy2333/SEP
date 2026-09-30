import { Node, mergeAttributes } from '@tiptap/core'

/**
 * 封面页节点
 * 包含标准文件的封面信息
 */
export const CoverPage = Node.create({
  name: 'coverPage',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      standardNo: { default: '' },
      titleCn: { default: '' },
      titleEn: { default: '' },
      publishDate: { default: '' },
      implementDate: { default: '' },
      issuer: { default: '' },
      ccsCode: { default: '' },
      icsCode: { default: '' },
      replaces: { default: '' },
      consistency: { default: '' },
      filingNo: { default: '' },
      industryName: { default: '' },
      regionName: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-type="cover-page"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-type': 'cover-page', class: 'cover-page' }),
      0,
    ]
  },
})
