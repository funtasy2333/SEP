import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    appendix: {
      insertAppendix: (attrs?: {
        title?: string
        normative?: boolean
      }) => ReturnType
    }
  }
}

/**
 * 附录节点
 * 对应 GB/T 1.1 中的附录
 * 类型：规范性附录 / 资料性附录
 * 编号：附录A, 附录B, ...
 */
export const Appendix = Node.create({
  name: 'appendix',
  group: 'block',
  content: 'appendixLabel appendixTitle (clause | stdParagraph | stdTable | figure | formula | stdList | note | example | block)*',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 附录编号字母，如 "A", "B" */
      letter: { default: null },
      /** 是否为规范性附录，false 为资料性附录 */
      normative: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'section[data-type="appendix"]',
        getAttrs(dom) {
          const el = dom as HTMLElement
          return {
            normative: el.getAttribute('data-normative') === 'true',
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'appendix',
        'data-normative': node.attrs.normative,
        class: 'std-appendix',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      insertAppendix:
        (attrs) =>
        ({ chain }) => {
          const normative = attrs?.normative ?? false
          return chain()
            .insertContent({
              type: 'appendix',
              attrs: { normative },
              content: [
                {
                  type: 'appendixLabel',
                  content: [
                    {
                      type: 'text',
                      text: normative ? '（规范性）' : '（资料性）',
                    },
                  ],
                },
                {
                  type: 'appendixTitle',
                  content: attrs?.title ? [{ type: 'text', text: attrs.title }] : [],
                },
                {
                  type: 'stdParagraph',
                },
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 附录标识（如 "附录A（规范性）"）
 */
export const AppendixLabel = Node.create({
  name: 'appendixLabel',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="appendix-label"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'appendix-label',
        class: 'std-appendix-label',
      }),
      0,
    ]
  },
})

/**
 * 附录标题
 */
export const AppendixTitle = Node.create({
  name: 'appendixTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'h2[data-type="appendix-title"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'h2',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'appendix-title',
        class: 'std-appendix-title',
      }),
      0,
    ]
  },
})
