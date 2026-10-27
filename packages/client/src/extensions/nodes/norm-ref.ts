import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

/**
 * 规范性引用文件清单（GB/T 46687.2 4.4.2.3；GB/T 1.1—2020 8.6.3、10.3.4；WP8.M G1，矩阵 M-4.4.2.3-02/-03/-04）。
 *
 * 结构：`normRefList > (normRefStd | normRefMixed)+`；`normRefStd > normRefStdRef normRefStdTitle`。
 * 标准化文件条目用两个子节点而不是“显示文本 + 字段”：PM 树是唯一事实来源，编辑显示文字与 XML 的
 * `std-ref`/`title` 不会分叉。非标准化文件条目（normRefMixed）保持原有格式，单段行内内容。
 * 文件编号与文件名称之间的一个汉字间隔由 CSS 在显示阶段添加，不入内容（与 IR 一致）。
 *
 * 清单只在 secType 为 norm-refs 的章内合法（由 Resolver 判定，Schema 不限制位置）；
 * `normRefStd`、`normRefMixed` 及其子节点不属于任何 group，只能出现在 `normRefList` 内。
 * 本阶段只做“模型 + 显示”，没有插入入口。
 */
export const NormRefList = Node.create({
  name: 'normRefList',
  group: 'block',
  content: '(normRefStd | normRefMixed)+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="norm-ref-list"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'norm-ref-list', class: 'std-norm-ref-list' }), 0]
  },
})

/** 标准化文件条目：文件编号（std-ref）+ 文件名称（title），各为一段行内内容。 */
export const NormRefStd = Node.create({
  name: 'normRefStd',
  content: 'normRefStdRef normRefStdTitle',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="norm-ref-std"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'norm-ref-std', class: 'std-norm-ref std-norm-ref-std' }), 0]
  },
})

/** 文件编号（含“（所有部分）”）。 */
export const NormRefStdRef = Node.create({
  name: 'normRefStdRef',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'span[data-type="norm-ref-std-ref"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'norm-ref-std-ref', class: 'std-norm-ref-no' }), 0]
  },
})

/** 文件名称。 */
export const NormRefStdTitle = Node.create({
  name: 'normRefStdTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'span[data-type="norm-ref-std-title"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'norm-ref-std-title', class: 'std-norm-ref-title' }), 0]
  },
})

/** 非标准化文件条目（mixed-citation）：以其原有格式，单段行内内容。 */
export const NormRefMixed = Node.create({
  name: 'normRefMixed',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="norm-ref-mixed"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'norm-ref-mixed', class: 'std-norm-ref std-norm-ref-mixed' }), 0]
  },
})
