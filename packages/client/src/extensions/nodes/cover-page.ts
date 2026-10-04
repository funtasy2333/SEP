import { Node, mergeAttributes } from '@tiptap/core'

/**
 * 封面元数据容器：属性供导出读取，子段落仅保留旧文档/schema兼容。
 * 不呈现可编辑正文，避免输入被只读取属性的导出链忽略。
 */
export const CoverPage = Node.create({
  name: 'coverPage',
  group: 'block',
  content: 'block+',
  defining: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      standardNo: { default: '' },
      standardType: { default: '' },
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
      coverDesignation: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-type="cover-page"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-type': 'cover-page', class: 'cover-page', hidden: '', 'aria-hidden': 'true', contenteditable: 'false' }),
      0,
    ]
  },
})
