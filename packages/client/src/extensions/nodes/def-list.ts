import { mergeAttributes, Node } from '@tiptap/core'
import type { DOMOutputSpec } from '@tiptap/pm/model'

/**
 * 缩略语表（WP8.M G2，M-10.1.4-01/-03/-04/-05）：块级定义列表，内容为若干 `whereItem`
 * （`whereTerm` 缩略语 + `whereDefinition` 释义），与公式的“式中”共用项节点（P8），
 * 因此项的 nodeId、粘贴重映射与 Enter/Tab/Backspace 编辑行为（whereListEditing）天然可用。
 *
 * 不并入公式的 `whereList`：后者没有 nodeId，给它补 id 会让每篇旧公式文档在打开时变脏并触动公式 JSON golden。
 * 导出恒写 `def-list[@list-content="abbreviation"]`（WP8.2）。本阶段不做插入菜单，只保证导入的结构能正确显示与保存重开。
 *
 * 加载期不得访问 window/document（服务端打包也会加载本文件，见 editorSchema.ts）。
 */
export const DefList = Node.create({
  name: 'defList',
  group: 'block',
  content: 'whereItem+',
  defining: true,

  parseHTML() {
    // priority 51：压过通用块规则，沿用 semantic.ts 的写法
    return [{ tag: 'dl[data-type="def-list"]', priority: 51 }]
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    return ['dl', mergeAttributes(HTMLAttributes, {
      'data-type': 'def-list',
      class: 'std-def-list',
    }), 0]
  },
})
