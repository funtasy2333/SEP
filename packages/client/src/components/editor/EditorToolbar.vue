<template>
  <div class="editor-toolbar">
    <!-- 撤销/重做 -->
    <el-button-group>
      <el-tooltip content="撤销" placement="bottom">
        <el-button :icon="RefreshLeft" :disabled="!editor?.can().undo()" @click="editor?.chain().focus().undo().run()" />
      </el-tooltip>
      <el-tooltip content="重做" placement="bottom">
        <el-button :icon="RefreshRight" :disabled="!editor?.can().redo()" @click="editor?.chain().focus().redo().run()" />
      </el-tooltip>
    </el-button-group>

    <el-divider direction="vertical" />

    <!-- 文本格式 -->
    <el-button-group>
      <el-tooltip content="加粗" placement="bottom">
        <el-button :type="editor?.isActive('bold') ? 'primary' : ''" @click="editor?.chain().focus().toggleBold().run()">
          <strong>B</strong>
        </el-button>
      </el-tooltip>
      <el-tooltip content="斜体" placement="bottom">
        <el-button :type="editor?.isActive('italic') ? 'primary' : ''" @click="editor?.chain().focus().toggleItalic().run()">
          <em>I</em>
        </el-button>
      </el-tooltip>
    </el-button-group>

    <el-divider direction="vertical" />

    <!-- 标准文档结构 -->
    <el-dropdown trigger="click" @command="handleInsertElement">
      <el-button type="primary">
        插入要素 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="chapter">章 (Chapter)</el-dropdown-item>
          <el-dropdown-item command="clause1">一级条 (Clause)</el-dropdown-item>
          <el-dropdown-item command="clause2">二级条</el-dropdown-item>
          <el-dropdown-item command="clause3">三级条</el-dropdown-item>
          <el-dropdown-item divided command="termDef">术语定义</el-dropdown-item>
          <el-dropdown-item divided command="stdTable">标准表格</el-dropdown-item>
          <el-dropdown-item command="figure">图</el-dropdown-item>
          <el-dropdown-item command="formula">公式</el-dropdown-item>
          <el-dropdown-item divided command="note">注</el-dropdown-item>
          <el-dropdown-item command="example">示例</el-dropdown-item>
          <el-dropdown-item divided command="listDash">列表（破折号）</el-dropdown-item>
          <el-dropdown-item command="listAlpha">列表（字母编号）</el-dropdown-item>
          <el-dropdown-item command="listNumeric">列表（数字编号）</el-dropdown-item>
          <el-dropdown-item divided command="appendixNorm">附录（规范性）</el-dropdown-item>
          <el-dropdown-item command="appendixInfo">附录（资料性）</el-dropdown-item>
          <el-dropdown-item divided command="bibliography">参考文献</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-divider direction="vertical" />

    <!-- 表格操作 -->
    <el-button-group>
      <el-tooltip content="插入基础表格" placement="bottom">
        <el-button @click="insertBasicTable">表格</el-button>
      </el-tooltip>
      <el-tooltip content="水平分割线" placement="bottom">
        <el-button @click="editor?.chain().focus().setHorizontalRule().run()">——</el-button>
      </el-tooltip>
    </el-button-group>
  </div>
</template>

<script setup lang="ts">
import { type Editor } from '@tiptap/vue-3'
import { RefreshLeft, RefreshRight, ArrowDown } from '@element-plus/icons-vue'

const props = defineProps<{
  editor: Editor | undefined
}>()

function handleInsertElement(command: string) {
  if (!props.editor) return
  const e = props.editor

  switch (command) {
    case 'chapter':
      e.chain().focus().insertChapter().run()
      break
    case 'clause1':
      e.chain().focus().insertClause({ level: 1 }).run()
      break
    case 'clause2':
      e.chain().focus().insertClause({ level: 2 }).run()
      break
    case 'clause3':
      e.chain().focus().insertClause({ level: 3 }).run()
      break
    case 'termDef':
      e.chain().focus().insertTermDef().run()
      break
    case 'stdTable':
      e.chain().focus().insertStdTable({ rows: 3, cols: 3 }).run()
      break
    case 'figure':
      e.chain().focus().insertFigure().run()
      break
    case 'formula':
      e.chain().focus().insertFormula().run()
      break
    case 'note':
      e.chain().focus().insertNote().run()
      break
    case 'example':
      e.chain().focus().insertExample().run()
      break
    case 'listDash':
      e.chain().focus().insertStdList({ listType: 'dash' }).run()
      break
    case 'listAlpha':
      e.chain().focus().insertStdList({ listType: 'alpha' }).run()
      break
    case 'listNumeric':
      e.chain().focus().insertStdList({ listType: 'numeric' }).run()
      break
    case 'appendixNorm':
      e.chain().focus().insertAppendix({ normative: true }).run()
      break
    case 'appendixInfo':
      e.chain().focus().insertAppendix({ normative: false }).run()
      break
    case 'bibliography':
      e.chain().focus().insertBibliography().run()
      break
  }
}

function insertBasicTable() {
  props.editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}
</script>

<style scoped>
.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  flex-wrap: wrap;
  gap: 4px;
}
</style>
