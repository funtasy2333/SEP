import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bibliography: {
      insertBibliography: () => ReturnType
      insertBibEntry: (attrs?: { text?: string }) => ReturnType
    }
  }
}

/**
 * 参考文献节点
 * 包含参考文献标题和条目列表
 */
export const Bibliography = Node.create({
  name: 'bibliography',
  group: 'block',
  content: 'bibliographyTitle bibEntry+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'section[data-type="bibliography"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'bibliography',
        class: 'std-bibliography',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      insertBibliography:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'bibliography',
              content: [
                {
                  type: 'bibliographyTitle',
                  content: [{ type: 'text', text: '参考文献' }],
                },
                {
                  type: 'bibEntry',
                },
              ],
            })
            .run()
        },
      insertBibEntry:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'bibEntry',
              content: attrs?.text ? [{ type: 'text', text: attrs.text }] : [],
            })
            .run()
        },
    }
  },
})

/**
 * 参考文献标题
 */
export const BibliographyTitle = Node.create({
  name: 'bibliographyTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'h2[data-type="bibliography-title"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'h2',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'bibliography-title',
        class: 'std-bibliography-title',
      }),
      0,
    ]
  },
})

/**
 * 参考文献条目
 * 格式如：[1] GB/T xxxx-xxxx 标准名称
 */
export const BibEntry = Node.create({
  name: 'bibEntry',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      /** 引用序号，如 "1", "2" */
      index: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="bib-entry"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'bib-entry', class: 'std-bib-entry' }),
      0,
    ]
  },
})
