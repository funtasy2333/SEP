import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chapter: {
      insertChapter: (attrs?: { title?: string }) => ReturnType
    }
  }
}

/**
 * 章节点
 * 对应 GB/T 1.1 中的"章"，如：1 范围, 2 规范性引用文件, 3 术语和定义 ...
 * 章编号自动生成，由 AutoNumberPlugin 处理
 */
export const Chapter = Node.create({
  name: 'chapter',
  group: 'block',
  content: 'chapterTitle (clause | stdParagraph | stdTable | figure | formula | stdList | note | example | block)*',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 自动编号 (由插件计算) */
      number: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-type="chapter"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-type': 'chapter', class: 'std-chapter' }),
      0,
    ]
  },

  addCommands() {
    return {
      insertChapter:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'chapter',
              attrs,
              content: [
                {
                  type: 'chapterTitle',
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
 * 章标题节点
 * 渲染为 h1 级别标题
 */
export const ChapterTitle = Node.create({
  name: 'chapterTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'h2[data-type="chapter-title"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'h2',
      mergeAttributes(HTMLAttributes, { 'data-type': 'chapter-title', class: 'std-chapter-title' }),
      0,
    ]
  },
})
