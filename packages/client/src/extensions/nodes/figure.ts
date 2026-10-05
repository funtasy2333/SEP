import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { normalizePageOrientation, readPageOrientation } from '../../utils/orientation'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: {
      insertFigure: (attrs?: { src?: string; captionCn?: string }) => ReturnType
    }
  }
}

/**
 * 图节点
 * 包含图片和图题（中文+可选英文）
 * 编号格式：图1, 图2, ... 或附录中 图A.1, 图A.2, ...
 */
export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'figureImage figureCaption figureCaptionEn? figureDescription* figureGroup*',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null },
      /** 自动编号，如 "1", "A.1" */
      number: { default: null },
      orientation: {
        default: 'portrait',
        parseHTML: (element) => readPageOrientation(element),
        renderHTML: (attributes) => ({
          'data-orientation': normalizePageOrientation(attributes.orientation),
        }),
      },
      unit: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="std-figure"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-type': 'std-figure', class: 'std-figure' }),
      0,
    ]
  },

  addCommands() {
    return {
      insertFigure:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'figure',
              content: [
                {
                  type: 'figureImage',
                  attrs: { src: attrs?.src || '' },
                },
                {
                  type: 'figureCaption',
                  content: attrs?.captionCn ? [{ type: 'text', text: attrs.captionCn }] : [],
                },
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 图片内容节点
 */
export const FigureImage = Node.create({
  name: 'figureImage',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      width: { default: null },
      height: { default: null },
      /** Stable resource identity; src remains the legacy/editor rendering input. */
      resourceId: { default: null },
      /** Dimensions default to CSS pixels for legacy width/height attrs. */
      widthUnit: { default: null },
      heightUnit: { default: null },
      title: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-type="figure-image"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'figure-image',
        class: 'std-figure-image',
      }),
    ]
  },
})

/**
 * 中文图题
 */
export const FigureCaption = Node.create({
  name: 'figureCaption',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'figcaption[data-type="figure-caption"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'figcaption',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'figure-caption',
        class: 'std-figure-caption',
      }),
      0,
    ]
  },
})

/**
 * 英文图题
 */
export const FigureCaptionEn = Node.create({
  name: 'figureCaptionEn',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'figcaption[data-type="figure-caption-en"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'figcaption',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'figure-caption-en',
        class: 'std-figure-caption-en',
        lang: 'en',
      }),
      0,
    ]
  },
})
