import { mergeAttributes, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

/**
 * 图例（WP8.M G3，M-8.5-01～06；NISO STS `fig/legend`）：图下的符号说明，内容为可选标题 + 若干 `whereItem`
 * （`whereTerm` 符号 + `whereDefinition` 释义）。
 *
 * 项节点与公式的“式中”、缩略语表共用（P8），因此项的 nodeId、粘贴重映射与 Enter/Tab/Backspace 编辑行为（whereListEditing）
 * 天然可用。容器不属于任何节点组，只能出现在 `figure` 内（figure.ts 的内容表达式 `… figureLegend? note* example*`）。
 * IR 侧是 `IRFigure.legend`，图例项不赋标签、不可被引用（C-T-31）。
 *
 * 本阶段不做插入菜单，只保证导入的结构能正确显示与保存重开；HTML/DOCX/XML 的排版本阶段暂不做（边界报 unsupported-output）。
 * 加载期不得访问 window/document（服务端打包也会加载本文件，见 editorSchema.ts）。
 */
export const FigureLegend = Node.create({
  name: 'figureLegend',
  content: 'figureLegendTitle? whereItem+',
  defining: true,

  parseHTML() {
    // priority 51：压过通用块规则，沿用 semantic.ts 的写法
    return [{ tag: 'div[data-type="figure-legend"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'figure-legend',
      class: 'std-figure-legend',
    }), 0]
  },
})

/** 图例标题（可选，如“图例”或“说明”）；IR 侧是 `IRLegend.title`。 */
export const FigureLegendTitle = Node.create({
  name: 'figureLegendTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'p[data-type="figure-legend-title"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['p', mergeAttributes(HTMLAttributes, {
      'data-type': 'figure-legend-title',
      class: 'std-figure-legend-title',
    }), 0]
  },
})
