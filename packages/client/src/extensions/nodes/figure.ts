import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { normalizePageOrientation, readPageOrientation } from '../../utils/orientation'
import { jsonAttribute } from './json-attribute'
import { graphicAttributeProblem } from '@ses/shared'
import { guardImageAttributes, readImageSrc, readImageTitle } from '../../utils/imageSource'

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
      insertFigure: (attrs?: { src?: string; alt?: string; captionCn?: string }) => ReturnType
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
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          const schema = state.schema

          // 1. 表格单元格（tableCell / tableHeader）内：只插入行内图片 inlineImage，不添加图编号和图题
          for (let d = $from.depth; d > 0; d--) {
            const typeName = $from.node(d).type.name
            if (typeName === 'tableCell' || typeName === 'tableHeader') {
              const inlineImageType = schema.nodes.inlineImage
              if (!inlineImageType) return false
              const inlineNode = inlineImageType.create({
                src: attrs?.src || '',
                alt: attrs?.alt || '',
                size: null,
              })
              if (dispatch) {
                tr.replaceSelectionWith(inlineNode)
                dispatch(tr.scrollIntoView())
              }
              return true
            }
          }

          const figureType = schema.nodes.figure
          const figureImageType = schema.nodes.figureImage
          const figureCaptionType = schema.nodes.figureCaption
          if (!figureType || !figureImageType || !figureCaptionType) return false

          const captionContent = attrs?.captionCn ? [schema.text(attrs.captionCn)] : []
          const figureImageNode = figureImageType.create({ src: attrs?.src || '', alt: attrs?.alt || '' })
          const figureCaptionNode = figureCaptionType.create(null, captionContent)
          const figureNode = figureType.create(null, [figureImageNode, figureCaptionNode])

          // 2. 空白段落（stdParagraph / paragraph）且不在表格内：原地替换为带图编号和图题的 figure
          const parent = $from.parent
          const isEmptyParagraph =
            (parent.type.name === 'stdParagraph' || parent.type.name === 'paragraph') &&
            parent.content.size === 0
          if (isEmptyParagraph && $from.depth >= 1) {
            const container = $from.node($from.depth - 1)
            const index = $from.index($from.depth - 1)
            const isUntitledClauseFirstPara =
              container.type.name === 'clause' && container.attrs.hasTitle === false && index === 1
            if (!isUntitledClauseFirstPara && container.canReplaceWith(index, index + 1, figureType)) {
              const from = $from.before($from.depth)
              const to = $from.after($from.depth)
              if (dispatch) {
                tr.replaceWith(from, to, figureNode)
                const captionCursorPos = from + 1 + figureImageNode.nodeSize + figureCaptionNode.nodeSize - 1
                tr.setSelection(TextSelection.create(tr.doc, captionCursorPos))
                dispatch(tr.scrollIntoView())
              }
              return true
            }
          }

          // 3. 非空段落或其他块内（表格外）：在当前块之后插入带图编号和图题的 figure
          let insertPos: number | null = null
          for (let d = $from.depth; d > 0; d--) {
            const parentName = $from.node(d).type.name
            if (['chapter', 'clause', 'foreword', 'introduction', 'appendix'].includes(parentName)) {
              const childIndex = $from.index(d)
              const hasNodeAfter = !state.selection.empty && $from.nodeAfter !== null
              const insertIndex = d < $from.depth ? childIndex + 1 : hasNodeAfter ? childIndex + 1 : childIndex
              const candidatePos =
                d < $from.depth
                  ? $from.after(d + 1)
                  : hasNodeAfter
                    ? $from.pos + $from.nodeAfter!.nodeSize
                    : $from.pos
              if ($from.node(d).canReplaceWith(insertIndex, insertIndex, figureType)) {
                insertPos = candidatePos
                break
              }
            }
          }
          if (insertPos === null) {
            const hasRootNodeAfter = !state.selection.empty && $from.nodeAfter !== null
            const rootInsertIndex =
              $from.depth > 0 ? $from.index(0) + 1 : hasRootNodeAfter ? $from.index(0) + 1 : $from.index(0)
            const rootCandidatePos =
              $from.depth > 0
                ? $from.after(1)
                : hasRootNodeAfter
                  ? $from.pos + $from.nodeAfter!.nodeSize
                  : $from.pos
            if (state.doc.canReplaceWith(rootInsertIndex, rootInsertIndex, figureType)) {
              insertPos = rootCandidatePos
            }
          }
          if (insertPos !== null) {
            if (dispatch) {
              tr.insert(insertPos, figureNode)
              const captionCursorPos = insertPos + 1 + figureImageNode.nodeSize + figureCaptionNode.nodeSize - 1
              tr.setSelection(TextSelection.create(tr.doc, captionCursorPos))
              dispatch(tr.scrollIntoView())
            }
            return true
          }

          if (dispatch) {
            tr.replaceSelectionWith(figureNode)
            dispatch(tr.scrollIntoView())
          }
          return true
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
      // 外部图片在编辑器里显示占位图，真实地址在 data-external-src（见 utils/imageSource.ts）：解析时以它为准。
      src: { default: '', parseHTML: (element: HTMLElement) => readImageSrc(element, '') },
      alt: stringAttribute('alt', ''),
      width: { default: null },
      height: { default: null },
      /** Stable resource identity; src remains the legacy/editor rendering input. */
      resourceId: stringAttribute('resourceId'),
      /** Dimensions default to CSS pixels for legacy width/height attrs. */
      widthUnit: stringAttribute('widthUnit'),
      heightUnit: stringAttribute('heightUnit'),
      title: { default: null, parseHTML: (element: HTMLElement) => readImageTitle(element) },
    }
  },

  parseHTML() {
    // Outrank Tiptap's generic Image rule so the editor-only image node is not parsed twice.
    return [{ tag: 'img[data-type="figure-image"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'img',
      mergeAttributes(guardImageAttributes(HTMLAttributes), {
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
