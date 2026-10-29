<template>
  <button class="tbar-btn" title="选择并引用本文件中的章、条、术语或图表" @mousedown.prevent @click="open">引用</button>
  <el-dialog v-model="visible" title="引用本文件内容" width="640px" append-to-body>
    <div class="reference-filters">
      <el-select v-model="type" aria-label="引用类型" placeholder="全部类型">
        <el-option label="全部类型" value="" />
        <el-option v-for="(label, value) in referenceTypes" :key="value" :label="label" :value="value" />
      </el-select>
      <el-input v-model="query" aria-label="筛选引用目标" placeholder="按编号或标题筛选" clearable />
    </div>
    <div class="reference-targets" role="radiogroup" aria-label="引用目标">
      <label v-for="target in filtered" :key="target.id" class="reference-target">
        <input v-model="selected" type="radio" name="internal-reference" :value="target.id" />
        <span>{{ target.text }}<span v-if="target.title">　{{ target.title }}</span></span>
      </label>
      <p v-if="!filtered.length">没有匹配的引用目标。</p>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="!filtered.some(target => target.id === selected)" @click="insert">插入引用</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { SelectionBookmark } from '@tiptap/pm/state'
import { ElMessage } from 'element-plus'
import { collectInternalReferences, insertInternalReference, referenceTypes, type InternalReferenceTarget } from '@/utils/internalReference'

const props = defineProps<{ editor: Editor | undefined }>()
const visible = ref(false)
const type = ref('')
const query = ref('')
const selected = ref('')
const targets = ref<InternalReferenceTarget[]>([])
let pending: { editor: Editor; doc: PMNode; bookmark: SelectionBookmark } | null = null
const filtered = computed(() => targets.value.filter(target => (!type.value || target.type === type.value)
  && `${target.text} ${target.title}`.toLowerCase().includes(query.value.trim().toLowerCase())))

function open() {
  const editor = props.editor
  if (!editor || !editor.isEditable) return
  const selection = editor.state.selection
  if (!selection.$from.sameParent(selection.$to) || !selection.$from.parent.inlineContent
    || !selection.$from.parent.type.allowsMarkType(editor.schema.marks.crossRef!)) {
    ElMessage.warning('请将光标置于文字中，或选中同一段内要替换为引用的文字')
    return
  }
  pending = { editor, doc: editor.state.doc, bookmark: selection.getBookmark() }
  targets.value = collectInternalReferences(editor)
  selected.value = ''
  type.value = ''
  query.value = ''
  visible.value = true
}
function insert() {
  if (!pending || props.editor !== pending.editor || !insertInternalReference(pending.editor, selected.value, pending.doc, pending.bookmark)) {
    ElMessage.warning('文档或引用目标已变化，请关闭弹窗后重新选择插入位置')
    return
  }
  visible.value = false
  pending = null
}
</script>

<style scoped>
.reference-filters { display: flex; gap: 12px; margin-bottom: 12px; }
.reference-filters .el-select { width: 150px; flex-shrink: 0; }
.reference-targets { max-height: 360px; overflow-y: auto; }
.reference-target { display: flex; gap: 10px; padding: 10px 6px; cursor: pointer; border-bottom: 1px solid var(--el-border-color-lighter); }
.reference-target:hover { background: var(--el-fill-color-light); }
</style>
