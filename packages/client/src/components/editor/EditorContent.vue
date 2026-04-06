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
  padding: 20px;
  background: #f5f5f5;
  display: flex;
  justify-content: center;
}

.editor-content {
  width: 210mm;
  min-height: 297mm;
  height: fit-content;
  background: white;
  padding: 40px 50px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  margin-bottom: 40px;
}

.editor-content :deep(.tiptap) {
  outline: none;
  font-family: 'SimSun', 'Songti SC', serif;
  font-size: 14px;
  line-height: 1.8;
}

.editor-content :deep(.tiptap h1) {
  font-size: 22px;
  font-weight: bold;
  text-align: center;
  margin: 20px 0 16px;
  font-family: 'SimHei', 'Heiti SC', sans-serif;
}

.editor-content :deep(.tiptap h2) {
  font-size: 16px;
  font-weight: bold;
  margin: 16px 0 12px;
  font-family: 'SimHei', 'Heiti SC', sans-serif;
}

.editor-content :deep(.tiptap h3) {
  font-size: 15px;
  font-weight: bold;
  margin: 12px 0 8px;
  font-family: 'SimHei', 'Heiti SC', sans-serif;
}

.editor-content :deep(.tiptap h4) {
  font-size: 14px;
  font-weight: bold;
  margin: 10px 0 6px;
  font-family: 'SimHei', 'Heiti SC', sans-serif;
}

/* 无题条：编号黑体，正文宋体 */
.editor-content :deep(.tiptap .std-clause[data-has-title="false"] > .std-clause-title) {
  font-family: 'SimSun', 'Songti SC', serif;
  font-weight: normal;
  font-size: 14px;
  text-indent: 2em;
  line-height: 1.8;
}

.editor-content :deep(.tiptap .std-clause[data-has-title="false"] > .std-clause-title::before) {
  font-family: 'SimHei', 'Heiti SC', sans-serif;
  font-weight: bold;
}

.editor-content :deep(.tiptap p) {
  margin: 6px 0;
  text-indent: 2em;
}

.editor-content :deep(.tiptap table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.editor-content :deep(.tiptap table td),
.editor-content :deep(.tiptap table th) {
  border: 1px solid #333;
  padding: 6px 10px;
  min-width: 60px;
}

.editor-content :deep(.tiptap table th) {
  background: #f0f0f0;
  font-weight: bold;
  text-align: center;
}

.editor-content :deep(.tiptap .is-empty::before) {
  content: attr(data-placeholder);
  float: left;
  color: #adb5bd;
  pointer-events: none;
  height: 0;
}
</style>
