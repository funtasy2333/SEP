import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { normalizePageOrientation, readPageOrientation } from '../../utils/orientation'
import { jsonAttribute } from './json-attribute'
import { graphicAttributeProblem } from '@ses/shared'

function stringAttribute(name: string, defaultValue: string | null = null) {
  return { default: defaultValue, parseHTML: (element: HTMLElement) => element.getAttribute(name) ?? defaultValue }
}

export const FigureSet = Node.create({
  name: 'figureSet', group: 'block', content: 'figureLegend? figure+', defining: true,
  parseHTML() { return [{ tag: 'div[data-type="figure-set"]' }] },
  renderHTML({ HTMLAttributes }): DOMOutputSpec { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'figure-set' }), 0] },
})

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
 *
 * WP8.M G3：尾部追加 `figureLegend? note* example*`——图例（M-8.5-01～06）、图注（M-8.2-11）、图中示例（M-8.4-03）。
 * 顺序固定“注在前、示例在后”（IR 的 notes / examples 是两个数组，PM 若允许交错，往返会改变作者顺序，D-M-09）；
 * 图内的注与示例沿用单段的 `note` / `example` 节点，标签由 Resolver 按“作用域 = 本图”给出（注：/注n：、示例：/示例n：）。
 * 旧文档（没有这些子节点）仍然合法，不需要迁移。
 */
export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'figureImage figureCaption figureCaptionEn? figureDescription* figureGroup* figureLegend? note* example*',
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
      unit: stringAttribute('unit'),
      primaryGraphic: jsonAttribute('data-primary-graphic', value => {
        if (value == null) return
        const problem = graphicAttributeProblem(value, true, true)
        if (problem) throw new RangeError(`primaryGraphic ${problem}`)
      }),
      additionalGraphics: jsonAttribute('data-additional-graphics', value => {
        if (value == null) return
        if (!Array.isArray(value)) throw new RangeError('additionalGraphics 必须是数组')
        const problem = value.map(graphic => graphicAttributeProblem(graphic, false, true)).find(Boolean)
        if (problem) throw new RangeError(`additionalGraphics ${problem}`)
      }),
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
      src: stringAttribute('src', ''),
      alt: stringAttribute('alt', ''),
      width: { default: null },
      height: { default: null },
      /** Stable resource identity; src remains the legacy/editor rendering input. */
      resourceId: stringAttribute('resourceId'),
      /** Dimensions default to CSS pixels for legacy width/height attrs. */
      widthUnit: stringAttribute('widthUnit'),
      heightUnit: stringAttribute('heightUnit'),
      title: stringAttribute('title'),
    }
  },

  parseHTML() {
    // Outrank Tiptap's generic Image rule so the editor-only image node is not parsed twice.
    return [{ tag: 'img[data-type="figure-image"]', priority: 51 }]
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
