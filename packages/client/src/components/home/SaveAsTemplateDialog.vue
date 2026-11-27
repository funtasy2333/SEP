<template>
  <el-dialog
    :model-value="modelValue"
    title="将标准文件存为模板"
    width="min(520px, calc(100vw - 24px))"
    align-center
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p v-if="document" class="save-lead">
      将复制「<strong>{{ document.meta?.titleCn || document.title }}</strong>」的正文结构、文件设置预设及封面/封底版式，生成可重复使用的自定义模板。
    </p>

    <el-form label-position="top" @submit.prevent="submit">
      <el-form-item label="模板名称" required>
        <el-input
          v-model="name"
          maxlength="120"
          placeholder="请输入模板名称"
          data-testid="save-template-name"
        />
      </el-form-item>
      <el-form-item label="模板说明（可选）">
        <el-input
          v-model="description"
          type="textarea"
          :rows="3"
          maxlength="500"
          placeholder="说明适用范围、包含章节或占位符约定"
          data-testid="save-template-desc"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="!name.trim() || !document?.id"
        data-testid="save-template-confirm"
        @click="submit"
      >
        保存为模板
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { StandardTemplate } from '@ses/shared'
import type { DocumentData } from '@/api/document'
import { useTemplateStore } from '@/stores/template'

const props = defineProps<{
  modelValue: boolean
  document: DocumentData | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved', template: StandardTemplate): void
}>()

const templateStore = useTemplateStore()
const name = ref('')
const description = ref('')
const submitting = ref(false)

watch(
  () => [props.modelValue, props.document] as const,
  ([open, doc]) => {
    if (!open || !doc) return
    const baseTitle = doc.meta?.titleCn || doc.title || '标准文件'
    name.value = `${baseTitle} 模板`
    description.value = ''
  },
  { immediate: true },
)

async function submit(): Promise<void> {
  if (!props.document?.id || !name.value.trim() || submitting.value) return
  submitting.value = true
  try {
    const created = await templateStore.createFromDocument(props.document.id, {
      name: name.value.trim(),
      description: description.value.trim() || undefined,
    })
    ElMessage.success(`已存为模板「${created.name}」`)
    emit('saved', created)
    emit('update:modelValue', false)
  } catch (error) {
    ElMessage.error(`保存模板失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.save-lead {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ses-ink-2);
}
</style>
