<template>
  <div class="editor-content-wrapper">
    <editor-content :editor="editor" class="editor-content" />
  </div>
</template>

<script setup lang="ts">
import { EditorContent } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/vue-3'

import '@/styles/standard-nodes.css'
import 'katex/dist/katex.min.css'

defineProps<{
  editor: Editor | undefined
}>()
</script>

<style scoped>
.editor-content-wrapper {
  flex: 1;
  overflow-y: auto;
  padding: 32px 24px 80px;
  background:
    radial-gradient(circle at 50% 0%, oklch(0.92 0.02 285 / 0.25), transparent 600px),
    var(--ses-bg);
  display: flex;
  justify-content: center;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}
.editor-content-wrapper::-webkit-scrollbar { width: 10px; }
.editor-content-wrapper::-webkit-scrollbar-thumb {
  background: var(--ses-line-2);
  border-radius: 5px;
  border: 3px solid transparent;
  background-clip: padding-box;
}
.editor-content-wrapper::-webkit-scrollbar-thumb:hover {
  background: var(--ses-ink-4);
  background-clip: padding-box;
  border: 3px solid transparent;
}

.editor-content {
  width: min(810px, 100%);
  min-height: 1100px;
  height: fit-content;
  background: var(--ses-paper);
  border: 1px solid var(--ses-paper-edge);
  border-radius: var(--ses-r-xl);
  padding: 56px 72px;
  box-shadow: var(--ses-shadow-paper);
  position: relative;
  overflow: hidden;
}
.editor-content::before {
  content: "";
  position: absolute; left: 0; right: 0; top: 0;
  height: 4px;
  background: linear-gradient(90deg,
    var(--ses-accent) 0%, var(--ses-accent) 38%,
    oklch(0.85 0.005 270) 38%, oklch(0.85 0.005 270) 100%);
}

.editor-content :deep(.tiptap) {
  outline: none;
  font-family: var(--ses-font-zh-song);
  font-size: var(--ses-doc-base, 15px);
  line-height: 1.85;
  color: oklch(0.18 0.014 270);
}
.editor-content :deep(.tiptap ::selection) {
  background: var(--ses-accent-ring);
}

.editor-content :deep(.tiptap h1) {
  font-size: 22px;
  font-weight: 700;
  text-align: center;
  margin: 20px 0 16px;
  font-family: var(--ses-font-zh-hei);
  letter-spacing: 0.04em;
}

.editor-content :deep(.tiptap h2) {
  font-size: 16px;
  font-weight: 700;
  margin: 24px 0 12px;
  font-family: var(--ses-font-zh-hei);
}

/* h3/h4 的通用标题样式不作用于条标题：条标题（h3–h6，按级别渲染）统一由 styles/standard-nodes.css 的 .std-clause-title 按类名定义 */
.editor-content :deep(.tiptap h3:not(.std-clause-title)) {
  font-size: 15px;
  font-weight: 700;
  margin: 16px 0 8px;
  font-family: var(--ses-font-zh-hei);
}

.editor-content :deep(.tiptap h4:not(.std-clause-title)) {
  font-size: 14px;
  font-weight: 700;
  margin: 12px 0 6px;
  font-family: var(--ses-font-zh-hei);
}

/* 无题条：clauseTitle 只显示编号（黑体）；条文在首个正文段（宋体）。编号与首段同行的布局见 styles/standard-nodes.css */
.editor-content :deep(.tiptap .std-clause[data-has-title="false"] > .std-clause-title) {
  font-family: var(--ses-font-zh-hei);
  font-weight: 700;
}

.editor-content :deep(.tiptap .std-clause[data-has-title="false"] > .std-clause-title::before) {
  font-family: var(--ses-font-zh-hei);
  font-weight: 700;
}

.editor-content :deep(.tiptap p) {
  margin: 6px 0;
  text-indent: 2em;
  text-wrap: pretty;
}

.editor-content :deep(.tiptap table) {
  border-collapse: collapse;
  border: 2px solid #000;
  width: 100%;
  margin: 16px 0;
}

/* 超宽表在自身 .tableWrapper 内局部横向滚动；横页表（含横向附录内表格）采用 Option A 等比缩放预览以消除横向滚动条。 */
.editor-content :deep(.tiptap .std-table-wrapper > .tableWrapper) {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
  margin: 12px 0;
  padding: 1px;
}
.editor-content :deep(.tiptap .std-table-wrapper > .tableWrapper > table) {
  margin: 0;
}
.editor-content :deep(.tiptap .std-table-wrapper[data-orientation="landscape"] > .tableWrapper),
.editor-content :deep(.tiptap .std-appendix[data-orientation="landscape"] .std-table-wrapper > .tableWrapper) {
  overflow: hidden;
  position: relative;
}
.editor-content :deep(.tiptap .std-table-wrapper[data-orientation="landscape"] > .tableWrapper > table),
.editor-content :deep(.tiptap .std-appendix[data-orientation="landscape"] .std-table-wrapper > .tableWrapper > table) {
  /* TableView 会内联写 min-width（如 75px），用 !important 让未定像素总宽的横表按 252mm（约 952px）计算网格后整体等比缩放预览。 */
  min-width: 952px !important;
  transform-origin: top left;
}
/* 缩放状态下禁用拖拽列宽手柄，避免缩放鼠标位移污染 952px 坐标下的 colwidth */
.editor-content :deep(.tiptap .std-table-wrapper[data-orientation="landscape"] > .tableWrapper[data-landscape-scale] .column-resize-handle),
.editor-content :deep(.tiptap .std-appendix[data-orientation="landscape"] .std-table-wrapper > .tableWrapper[data-landscape-scale] .column-resize-handle) {
  pointer-events: none;
  display: none;
}
/* 主编辑器横向表格「展开编辑」入口按钮（Decoration.widget，不入文档模型） */
.editor-content :deep(.tiptap .std-table-wrapper) {
  position: relative;
}
.editor-content :deep(.tiptap .ses-expand-landscape-btn) {
  position: absolute;
  top: 12px;
  right: 0;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid color-mix(in oklch, var(--ses-accent) 32%, var(--ses-line-2));
  border-radius: 6px;
  background: color-mix(in oklch, var(--ses-surface) 94%, var(--ses-accent-soft));
  color: var(--ses-accent);
  font-family: var(--ses-font-ui);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  box-shadow: var(--ses-shadow-1);
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.editor-content :deep(.tiptap .ses-expand-landscape-btn:hover) {
  background: var(--ses-accent);
  border-color: var(--ses-accent);
  color: #fff;
}
.editor-content :deep(.tiptap .std-appendix[data-orientation="landscape"] .std-table-wrapper .ses-expand-landscape-btn) {
  top: 2px;
}

.editor-content :deep(.tiptap table td),
.editor-content :deep(.tiptap table th) {
  border: 1px solid #000;
  padding: 8px 12px;
  min-width: 60px;
  font-family: var(--ses-font-ui);
  font-size: 13px;
}

/* 合并单元格的最小宽度不能按每个可见单元格叠加：
   导入表可能有很多逻辑列。保留 TableView 的列宽与拖拽设置，
   让浏览器在正文宽度内按内容分配空间。 */
.editor-content :deep(.tiptap .std-table-wrapper table td),
.editor-content :deep(.tiptap .std-table-wrapper table th) {
  min-width: 0;
  padding-inline: 4px;
  overflow-wrap: anywhere;
}

/* 表格内普通段落不继承正文首行两字缩进。 */
.editor-content :deep(.tiptap table td > p),
.editor-content :deep(.tiptap table th > p),
.editor-content :deep(.tiptap .std-table-cell-content > p) {
  text-indent: 0;
}

.editor-content :deep(.tiptap table th) {
  background: var(--ses-surface-2);
  font-weight: 400;
  text-align: center;
}

.editor-content :deep(.tiptap .is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--ses-ink-4);
  pointer-events: none;
  height: 0;
}
</style>
