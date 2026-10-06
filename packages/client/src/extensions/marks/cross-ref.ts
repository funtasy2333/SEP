import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    crossRef: {
      setCrossRef: (attrs: { refId: string; refType: string }) => ReturnType
      unsetCrossRef: () => ReturnType
    }
  }
}

/**
 * 交叉引用标记
 * 用于引用文档内的章、条、表、图、公式、附录等
 * refType: chapter | clause | table | figure | formula | appendix | bibEntry
 */
export const CrossRef = Mark.create({
  name: 'crossRef',
  inclusive: false,

  addAttributes() {
    return {
      /** 被引用元素的 id */
      refId: { default: null, parseHTML: element => element.getAttribute('refId') },
      /** 新IR契约的稳定目标ID；refId继续用于旧PM文档兼容。 */
      targetId: { default: null, parseHTML: element => element.getAttribute('targetId') },
      /** 引用类型 */
      refType: { default: 'chapter', parseHTML: element => element.getAttribute('refType') ?? 'chapter' },
      /** 显示文本（自动生成的编号文本） */
      refText: { default: null, parseHTML: element => element.getAttribute('refText') },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-type="cross-ref"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }) {
    const targetId = HTMLAttributes.targetId || HTMLAttributes.refId
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'cross-ref',
        class: 'std-cross-ref',
        href: targetId ? `#${targetId}` : null,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setCrossRef:
        (attrs) =>
        ({ commands }) => {
          return commands.setMark(this.name, attrs)
        },
      unsetCrossRef:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },
})
