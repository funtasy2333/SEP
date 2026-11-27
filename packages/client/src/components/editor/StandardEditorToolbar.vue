<template>
  <!-- 工具栏：只放正文编辑操作，按「历史 / 文字 / 设为 / 插入 / 对象」排列；放不下时换行，不再隐藏按钮 -->
  <div class="ed-toolbar" role="toolbar" aria-label="正文编辑" :inert="disabled">
    <div class="tbar-group">
      <button
        class="tbar-btn icon-btn"
        :class="{ 'is-active': showOutline }"
        :aria-pressed="showOutline"
        :title="showOutline ? '隐藏文档结构' : '显示文档结构'"
        :aria-label="showOutline ? '隐藏文档结构' : '显示文档结构'"
        @click="showOutline = !showOutline"
      ><el-icon><Memo /></el-icon></button>
    </div>
    <span class="tbar-sep" />

    <div class="tbar-group">
      <button class="tbar-btn icon-btn" :disabled="!editor?.can().undo()" @click="editor?.chain().focus().undo().run()" title="撤销（Ctrl/Cmd+Z）" aria-label="撤销">
        <el-icon><RefreshLeft /></el-icon>
      </button>
      <button class="tbar-btn icon-btn" :disabled="!editor?.can().redo()" @click="editor?.chain().focus().redo().run()" title="重做（Ctrl/Cmd+Shift+Z）" aria-label="重做">
        <el-icon><RefreshRight /></el-icon>
      </button>
    </div>
    <span class="tbar-sep" />

    <div class="tbar-group format-group">
      <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('bold') }" title="加粗（Ctrl/Cmd+B）" aria-label="加粗" @click="editor?.chain().focus().toggleBold().run()"><strong>B</strong></button>
      <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('italic') }" title="斜体（Ctrl/Cmd+I）" aria-label="斜体" @click="editor?.chain().focus().toggleItalic().run()"><em>I</em></button>
      <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('underline') }" title="下划线（Ctrl/Cmd+U）" aria-label="下划线" @click="core.toggleUnderline()"><u>U</u></button>
      <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('strike') }" title="删除线" aria-label="删除线" @click="editor?.chain().focus().toggleStrike().run()"><s>S</s></button>
    </div>
    <span class="tbar-sep" />

    <!-- 设为：改变光标所在段落的结构角色 -->
    <div class="tbar-group" aria-label="将当前段落设为">
      <span class="tbar-label">设为</span>
      <button class="tbar-btn" title="将当前段落恢复为正文段落" @click="core.insertStdParagraph()">正文</button>
      <el-dropdown trigger="click" @command="core.handleInsertClause">
        <button class="tbar-btn" title="将当前段落或条标题设为所选层级的条">条 <el-icon><ArrowDownIcon /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="lv in 5" :key="lv" :command="String(lv)">{{ ['一','二','三','四','五'][lv-1] }}级条</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="core.handleInsertClauseNoTitle">
        <button class="tbar-btn" title="将当前段落或条标题设为无题条">无题条 <el-icon><ArrowDownIcon /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="lv in 4" :key="lv" :command="String(lv)">{{ ['一','二','三','四'][lv-1] }}级无题条</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-dropdown trigger="click" @command="core.handleInsertList">
        <button class="tbar-btn" title="将当前段落设为列项">列项 <el-icon><ArrowDownIcon /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="dash">破折号列项（一级）</el-dropdown-item>
            <el-dropdown-item command="alpha">字母编号列项（一级）</el-dropdown-item>
            <el-dropdown-item command="numeric">数字编号列项（二级）</el-dropdown-item>
            <el-dropdown-item command="dot">间隔号列项（二级）</el-dropdown-item>
            <el-dropdown-item divided command="numbering:continue" title="接续本条中前面最近的同类型列项，例如 a）、b） 之后从 c） 起">继续前一列项编号</el-dropdown-item>
            <el-dropdown-item command="numbering:restart" title="本组列项从 a）、1） 起重新编号">重新编号</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <span class="tbar-sep" />

    <!-- 插入：在光标处加入内容要素 -->
    <div class="tbar-group" aria-label="插入内容要素">
      <span class="tbar-label">插入</span>
      <ReferenceControl :editor="editor" />
      <SourceControl :editor="editor" />
      <el-dropdown trigger="click" @command="core.handleInsertNote">
        <button class="tbar-btn" title="设置注或插入脚注">注 <el-icon><ArrowDownIcon /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="note">注</el-dropdown-item>
            <el-dropdown-item command="footnote">脚注（Ctrl/Cmd+Shift+F）</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <button class="tbar-btn" title="在当前段落后插入示例" @click="core.handleInsertExample('example')">示例</button>
      <el-dropdown trigger="click" @command="core.handleInsertTermDef">
        <button class="tbar-btn" title="插入术语条目">术语 <el-icon><ArrowDownIcon /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="lv in 5" :key="lv" :command="String(lv)">{{ ['一','二','三','四','五'][lv-1] }}级术语条</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <button class="tbar-btn" title="在当前段落后插入公式：单独成行，可编号；运算式请用公式输入" @click="core.handleInsertFormula()">公式</button>
      <button
        class="tbar-btn"
        :disabled="!cursorAllowsInlineFormula"
        title="在文字中输入带上下标的量或变量符号（如 qV、x²）；选中文字时转为符号（Ctrl/Cmd+Shift+M）。运算式请用「公式」"
        @click="core.handleInlineFormula()"
      >符号</button>
      <button
        class="tbar-btn"
        type="button"
        data-testid="toolbar-insert-table-btn"
        title="在当前段落后插入标准表格 (3×3)"
        @click="core.handleTableCommand('insert')"
      >表格</button>
      <button class="tbar-btn" title="在当前段落后插入图" @click="core.handleInsertFigure()">图片</button>
    </div>

    <slot name="extra" />

    <div class="tbar-search">
      <el-input
        v-model="searchText"
        size="small"
        placeholder="查找正文，回车下一处"
        title="回车：下一处；Shift+回车：上一处；Esc：回到正文"
        :prefix-icon="Search"
        clearable
        @keydown="core.handleSearchKeydown"
        @clear="core.handleSearchClear"
      >
        <template v-if="searchStatus" #suffix>
          <span class="tbar-search-count" data-testid="search-count">{{ searchStatus }}</span>
        </template>
      </el-input>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowDown as ArrowDownIcon, Memo, RefreshLeft, RefreshRight, Search } from '@element-plus/icons-vue'
import ReferenceControl from '@/components/editor/ReferenceControl.vue'
import SourceControl from '@/components/editor/SourceControl.vue'
import type { StandardEditorCore } from '@/composables/useStandardEditorCore'

const props = defineProps<{
  core: StandardEditorCore
  disabled?: boolean
}>()

const { editor, showOutline, searchText, searchStatus, cursorAllowsInlineFormula } = props.core
</script>

<style scoped>
.ed-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 2px;
  min-height: 44px;
  padding: 6px 12px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  box-shadow: 0 1px 2px oklch(0.21 0.014 270 / 0.03);
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.tbar-group {
  display: flex;
  align-items: center;
  gap: 1px;
  height: 32px;
  flex-shrink: 0;
}
.tbar-sep {
  flex: 0 0 auto;
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--ses-line-2);
}
.tbar-label {
  margin: 0 4px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ses-ink-4);
  white-space: nowrap;
  user-select: none;
}
.tbar-group :deep(.tbar-btn) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ses-ink-2);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.1s ease, color 0.1s ease;
}
.tbar-group :deep(.tbar-btn .el-icon) { font-size: 11px; color: var(--ses-ink-4); }
.tbar-group :deep(.tbar-btn:hover) {
  background: var(--ses-surface-3);
  color: var(--ses-ink);
}
.tbar-btn.is-active { background: var(--ses-accent-soft); color: var(--ses-accent); }
.tbar-btn.is-active .el-icon { color: var(--ses-accent); }
.tbar-btn[disabled] { opacity: 0.38; pointer-events: none; }
.tbar-btn.icon-btn { width: 28px; padding: 0; justify-content: center; }
.tbar-group :deep(.tbar-btn.icon-btn .el-icon) { font-size: 15px; color: inherit; }

.format-group strong, .format-group em, .format-group u, .format-group s {
  font-family: var(--ses-font-zh-hei);
}

.tbar-search { width: 200px; margin-left: auto; flex-shrink: 0; }
:deep(.tbar-search .el-input__wrapper) {
  border-radius: 6px;
}
.tbar-search-count {
  font-size: 12px;
  color: var(--ses-ink-3, #8a8a8a);
  font-variant-numeric: tabular-nums;
}
</style>
