import { Node, mergeAttributes } from '@tiptap/core'

function stringAttribute(name: string, defaultValue: string | null = null) {
  return { default: defaultValue, parseHTML: (element: HTMLElement) => element.getAttribute(name) ?? defaultValue }
}

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
      standardNo: stringAttribute('standardNo', ''),
      standardType: stringAttribute('standardType', ''),
      titleCn: stringAttribute('titleCn', ''),
      titleEn: stringAttribute('titleEn', ''),
      publishDate: stringAttribute('publishDate', ''),
      implementDate: stringAttribute('implementDate', ''),
      issuer: stringAttribute('issuer', ''),
      ccsCode: stringAttribute('ccsCode', ''),
      icsCode: stringAttribute('icsCode', ''),
      replaces: stringAttribute('replaces', ''),
      consistency: stringAttribute('consistency', ''),
      filingNo: stringAttribute('filingNo', ''),
      industryName: stringAttribute('industryName', ''),
      regionName: stringAttribute('regionName', ''),
      coverDesignation: stringAttribute('coverDesignation', ''),
      applicant: stringAttribute('applicant'),
      proposer: stringAttribute('proposer'),
      technicalCommittee: stringAttribute('technicalCommittee'),
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
