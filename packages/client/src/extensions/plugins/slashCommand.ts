import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export interface SlashMenuItem {
  label: string
  description: string
  command: string
  /** 仅在这些父节点类型中显示 */
  allowedIn?: string[]
  /** 在这些父节点类型中隐藏 */
  disabledIn?: string[]
  group?: string
}

const ALL_ITEMS: SlashMenuItem[] = [
  // 结构要素
  { label: '一级条', description: '插入带标题的一级条', command: 'clause:1', group: '结构', allowedIn: ['chapter', 'appendix'] },
  { label: '二级条', description: '插入带标题的二级条', command: 'clause:2', group: '结构', allowedIn: ['chapter', 'clause', 'appendix'] },
  { label: '三级条', description: '插入带标题的三级条', command: 'clause:3', group: '结构', allowedIn: ['chapter', 'clause', 'appendix'] },
  { label: '一级无题条', description: '插入一级无题条', command: 'clauseNoTitle:1', group: '结构', allowedIn: ['chapter', 'clause', 'appendix'] },
  { label: '二级无题条', description: '插入二级无题条', command: 'clauseNoTitle:2', group: '结构', allowedIn: ['chapter', 'clause', 'appendix'] },
  { label: '三级无题条', description: '插入三级无题条', command: 'clauseNoTitle:3', group: '结构', allowedIn: ['chapter', 'clause', 'appendix'] },
  { label: '四级无题条', description: '插入四级无题条', command: 'clauseNoTitle:4', group: '结构', allowedIn: ['chapter', 'clause', 'appendix'] },
  // 内容要素
  { label: '段落', description: '插入标准段落', command: 'paragraph', group: '内容' },
  { label: '表格', description: '插入3×3表格', command: 'table', group: '内容' },
  { label: '公式', description: '插入LaTeX公式', command: 'formula', group: '内容' },
  { label: '图片', description: '插入图片', command: 'figure', group: '内容' },
  { label: '注', description: '插入注释', command: 'note', group: '内容' },
  { label: '脚注', description: '在正文、列项、注、示例或文献中插入脚注引用', command: 'footnote', group: '内容', allowedIn: ['stdParagraph', 'paragraph', 'stdListItem', 'bibEntry', 'note', 'example'] },
  { label: '示例', description: '插入示例', command: 'example', group: '内容' },
  { label: '一级术语条', description: '插入一级术语定义', command: 'termDef:1', group: '术语', allowedIn: ['chapter', 'clause', 'appendix', 'termDef'] },
  { label: '二级术语条', description: '插入二级术语定义', command: 'termDef:2', group: '术语', allowedIn: ['chapter', 'clause', 'appendix', 'termDef'] },
  { label: '三级术语条', description: '插入三级术语定义', command: 'termDef:3', group: '术语', allowedIn: ['chapter', 'clause', 'appendix', 'termDef'] },
  // 列项
  { label: '破折号列项', description: '插入破折号列项', command: 'list:dash', group: '列项' },
  { label: '字母编号列项', description: '插入a) b) c)列项', command: 'list:alpha', group: '列项' },
  { label: '数字编号列项', description: '插入1) 2) 3)列项', command: 'list:numeric', group: '列项' },
]

const slashPluginKey = new PluginKey('slashCommand')

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: slashPluginKey,
        props: {
          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            if (event.key === '/') {
              // 延迟到 / 字符插入编辑器后再弹出菜单，避免 / 进入搜索框
              setTimeout(() => {
                const { $from } = view.state.selection
                const parentNames: string[] = []
                for (let d = $from.depth; d > 0; d--) {
                  parentNames.push($from.node(d).type.name)
                }

                const filteredItems = ALL_ITEMS.filter(item => {
                  if (item.allowedIn) {
                    return item.allowedIn.some(name => parentNames.includes(name))
                  }
                  if (item.disabledIn) {
                    return !item.disabledIn.some(name => parentNames.includes(name))
                  }
                  return true
                })

                const coords = view.coordsAtPos($from.pos)
                const customEvent = new CustomEvent('slash-command', {
                  detail: {
                    items: filteredItems,
                    coords: { left: coords.left, top: coords.bottom + 4 },
                  },
                })
                window.dispatchEvent(customEvent)
              }, 0)
            }

            return false
          },
        },
      }),
    ]
  },
})
