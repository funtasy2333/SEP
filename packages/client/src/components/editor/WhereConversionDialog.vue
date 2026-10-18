<template>
  <el-dialog
    :model-value="modelValue"
    title="转换为结构化式中"
    width="640px"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="where-conv-intro">
      将文字形式的式中说明拆成「符号 | 释义」条目，符号转换为公式。请核对转换结果，确认后可用 Ctrl+Z 撤销。
    </p>
    <table class="where-conv-table">
      <thead>
        <tr><th>原符号</th><th>转换后</th><th>释义</th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index" :class="{ 'is-kept': row.latex === null }">
          <td>{{ row.termText || '（无）' }}</td>
          <td>
            <span v-if="row.latex !== null" class="where-conv-formula" v-html="render(row.latex)" />
            <span v-else class="where-conv-kept" :title="row.reason">保留为文字</span>
          </td>
          <td class="where-conv-definition">{{ row.definitionText }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="rows.some(row => row.latex === null)" class="where-conv-hint">
      标为「保留为文字」的符号转换后仍是普通文字，可之后点击符号格重新输入为公式。
    </p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" class="where-conv-confirm" @click="handleConfirm">转换</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { WhereConversionRow } from '@/utils/whereListConversion'

defineProps<{ modelValue: boolean; rows: WhereConversionRow[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: [] }>()

function render(latex: string): string {
  return katex.renderToString(latex, { displayMode: false, throwOnError: false })
}

function handleConfirm(): void {
  emit('confirm')
  emit('update:modelValue', false)
}
</script>

<style scoped>
.where-conv-intro,
.where-conv-hint {
  margin: 0 0 10px;
  color: #666;
  font-size: 13px;
}

.where-conv-hint {
  margin: 10px 0 0;
}

.where-conv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.where-conv-table th,
.where-conv-table td {
  border: 1px solid #ebeef5;
  padding: 6px 8px;
  text-align: left;
  vertical-align: middle;
}

.where-conv-table th {
  background: #f5f7fa;
  font-weight: 500;
}

.where-conv-formula {
  font-size: 16px;
}

.where-conv-kept {
  color: #b88230;
}

.where-conv-definition {
  color: #555;
}
</style>
