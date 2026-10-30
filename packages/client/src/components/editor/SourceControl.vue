<template>
  <button class="tbar-btn" title="为当前术语、正文、图或表添加或编辑来源" @mousedown.prevent @click="open">来源</button>
  <el-dialog v-model="visible" :title="`${location?.existing ? '编辑' : '插入'}${kindLabel}来源`" width="560px" append-to-body>
    <label for="source-annotation-text">来源内容</label>
    <el-input id="source-annotation-text" v-model="text" type="textarea" :rows="4" placeholder="例如：GB/T 123—2026，5.1，有修改" />
    <p>填写来源文字，系统自动添加来源标识。</p>
    <template #footer>
      <el-button v-if="location?.existing" type="danger" plain @click="save(null)">删除来源</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!text.trim()" @click="save(text)">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { Editor } from '@tiptap/core'
import { ElMessage } from 'element-plus'
import { findSourceAnnotation, saveSourceAnnotation, type SourceAnnotation } from '@/utils/sourceAnnotation'
const props = defineProps<{ editor: Editor | undefined }>()
const visible = ref(false)
const text = ref('')
const location = shallowRef<SourceAnnotation | null>(null)
let pendingEditor: Editor | undefined
const kindLabel = computed(() => ({ term: '术语', paragraph: '正文', figure: '图', table: '表' })[location.value?.kind ?? 'paragraph'])
function open() {
  const editor = props.editor
  if (!editor) return
  location.value = findSourceAnnotation(editor)
  if (!location.value) {
    ElMessage.warning('请将光标置于术语定义、正文段落、图题或表格中，再插入来源')
    return
  }
  pendingEditor = editor
  text.value = location.value.text
  visible.value = true
}
function save(value: string | null) {
  if (!pendingEditor || props.editor !== pendingEditor || !location.value || !saveSourceAnnotation(pendingEditor, location.value, value)) {
    ElMessage.warning('文档已变化，请关闭弹窗后重新选择来源位置')
    return
  }
  visible.value = false
  location.value = null
}
</script>

<style scoped>
label { display: block; margin-bottom: 8px; }
p { font-size: 12px; color: var(--el-text-color-secondary); }
</style>
