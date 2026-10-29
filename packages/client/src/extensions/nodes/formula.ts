import { Node, mergeAttributes } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import katex from 'katex'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: {
      insertFormula: () => ReturnType
    }
  }
}

const formulaPluginKey = new PluginKey('formulaPreview')

export const FormulaGroup = Node.create({
  name: 'formulaGroup', group: 'block', content: 'formula+', defining: true,
  addAttributes() { return { numbered: { default: false } } },
  parseHTML() { return [{ tag: 'div[data-type="formula-group"]' }] },
  renderHTML({ HTMLAttributes }): DOMOutputSpec { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'formula-group' }), 0] },
})

/**
 * 公式节点
 * 包含公式内容和编号
 */
export const Formula = Node.create({
  name: 'formula',
  group: 'block',
  content: 'formulaContent formulaDescription? formulaNote* whereList?',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: { default: null },
      number: { default: null },
      /** 未编号公式也必须在生产JSON中保留，避免重开时改变后续编号。 */
      numbered: { default: null },
      /** 原生 MathML 原文，作为不经 LaTeX 反译的权威表示保留。 */
      mathml: { default: null, parseHTML: (element) => element.getAttribute('mathml') },
      /** 可用的 LaTeX 编辑源；不要求从 MathML 反向推导。 */
      latex: { default: null, parseHTML: (element) => element.getAttribute('latex') },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="formula"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'formula', class: 'std-formula' }),
      0,
    ]
  },

  addCommands() {
    return {
      insertFormula:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: 'formula',
              content: [
                { type: 'formulaContent', content: [{ type: 'text', text: 'E = mc^2' }] },
              ],
            })
            .run()
        },
    }
  },
})

/**
 * 公式内容 - 支持 LaTeX 输入并实时预览
 */
export const FormulaContent = Node.create({
  name: 'formulaContent',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="formula-content"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'formula-content',
        class: 'std-formula-content',
      }),
      0,
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: formulaPluginKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'formulaContent') {
                const latex = node.textContent.trim()
                if (latex) {
                  try {
                    const html = katex.renderToString(latex, {
                      throwOnError: false,
                      displayMode: true,
                    })
                    // Add a widget decoration after the formula content node
                    const endPos = pos + node.nodeSize
                    decorations.push(
                      Decoration.widget(endPos, () => {
                        const el = document.createElement('div')
                        el.className = 'std-formula-preview'
                        el.innerHTML = html
                        return el
                      })
                    )
                  } catch {
                    // Invalid LaTeX, skip preview
                  }
                }
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

/**
 * 公式说明（式中...）
 */
export const FormulaDescription = Node.create({
  name: 'formulaDescription',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="formula-description"]' }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'formula-description',
        class: 'std-formula-description',
      }),
      0,
    ]
  },
})
