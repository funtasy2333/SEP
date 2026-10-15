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

.editor-content :deep(.tiptap h3) {
  font-size: 15px;
  font-weight: 700;
  margin: 16px 0 8px;
  font-family: var(--ses-font-zh-hei);
}

.editor-content :deep(.tiptap h4) {
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
  width: 100%;
  margin: 16px 0;
}

.editor-content :deep(.tiptap table td),
.editor-content :deep(.tiptap table th) {
  border: 1px solid oklch(0.7 0.014 270);
  padding: 8px 12px;
  min-width: 60px;
  font-family: var(--ses-font-ui);
  font-size: 13px;
}

/* 表格内普通段落不继承正文首行两字缩进。 */
.editor-content :deep(.tiptap table td > p),
.editor-content :deep(.tiptap table th > p),
.editor-content :deep(.tiptap .std-table-cell-content > p) {
  text-indent: 0;
}

.editor-content :deep(.tiptap table th) {
  background: var(--ses-surface-2);
  font-family: var(--ses-font-zh-hei);
  font-weight: 700;
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
