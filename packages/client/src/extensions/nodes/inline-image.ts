import { mergeAttributes, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

/** Tiptap 的隐式解析会把形如 007 / true 的字符串转型；这些属性都是文本。 */
function stringAttribute(name: string, defaultValue: string | null = null) {
  return { default: defaultValue, parseHTML: (element: HTMLElement) => element.getAttribute(name) ?? defaultValue }
}

/**
 * 行内图（WP8.M G3，M-8.3-02；NISO STS `inline-graphic`）：行内原子节点，与行内公式 `formulaInline` 同属 `inline` 组。
 * 只放在段落类文本块里（Resolver 校验：标题、图表题、术语条目、脚注内不允许，违反时文档校验报 error）。
 *
 * 属性：`src`（显示用，data URL 或资源地址）、`resourceId`（指向文档级资源 figureResource，复用既有引用键，
 * 粘贴时由 ensureNodeId 的两张重映射表一并处理）、`alt`、`size`（8.3 表 2 的 S/M/L = 单/双/三倍行高；size:T 仅块级 graphic 可用，不收；缺省按行高自适应）。
 * 没有 nodeId：IR 里行内图不是实体（WP6 契约：纯行内叶子）。
 *
 * 不需要 NodeView：renderHTML + CSS（`.std-inline-image`、`[data-size]`）即可显示；本阶段不做插入菜单。
 * 加载期不得访问 window/document（服务端打包也会加载本文件，见 editorSchema.ts）。
 */
export const InlineImage = Node.create({
  name: 'inlineImage',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      src: stringAttribute('src', ''),
      resourceId: stringAttribute('resourceId'),
      alt: stringAttribute('alt', ''),
      size: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-size'),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.size ? { 'data-size': attributes.size } : {}),
      },
    }
  },

  parseHTML() {
    // 压过 Tiptap 的通用 Image 规则（img[src]），行内图只认带 data-type 的元素，仿 figure.ts 的 FigureImage。
    return [{ tag: 'img[data-type="inline-image"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['img', mergeAttributes(HTMLAttributes, {
      'data-type': 'inline-image',
      class: 'std-inline-image',
    })]
  },
})
