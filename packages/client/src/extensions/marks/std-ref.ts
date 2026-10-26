import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * 正文中对标准化文件的引用（GB/T 46687.2 10.2；WP8.M G1，矩阵 M-10.2-01/-02）：被标记的文本即 `std-ref` 内容。
 * 无属性；与 mixedCitation 互斥（同一段文字不能既是标准化文件又是非标准化文件的引用）。
 * 不是交叉引用：不指向文档内目标，不参与 Resolver 的引用检查；HTML/DOCX 按普通文本输出（设计 §7.1、D-M-07）。
 */
export const StdRef = Mark.create({
  name: 'stdRef',
  inclusive: false,
  excludes: 'stdRef mixedCitation',

  parseHTML() {
    return [{ tag: 'span[data-type="std-ref"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'std-ref', class: 'std-std-ref' }), 0]
  },
})

/**
 * 正文中对非标准化文件的引用（GB/T 46687.2 10.1.7；矩阵 M-10.1.7-01）：保持原有格式。与 stdRef 互斥。
 */
export const MixedCitation = Mark.create({
  name: 'mixedCitation',
  inclusive: false,
  excludes: 'stdRef mixedCitation',

  parseHTML() {
    return [{ tag: 'span[data-type="mixed-citation"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'mixed-citation', class: 'std-mixed-citation' }), 0]
  },
})
