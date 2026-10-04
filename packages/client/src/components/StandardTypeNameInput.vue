<template>
  <el-form-item label="标准类型">
    <div class="standard-type-name" :aria-label="`标准类型名称输入，前缀${parts.prefix || '无'}，后缀${parts.suffix}`">
      <span v-if="parts.prefix" class="fixed-text">{{ parts.prefix }}</span>
      <el-input
        :model-value="modelValue"
        :disabled="disabled"
        placeholder="只填写中间名称"
        aria-label="标准类型名称"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <span class="fixed-text">{{ parts.suffix }}</span>
    </div>
  </el-form-item>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getCoverDesignationParts } from '@ses/shared'

const props = defineProps<{
  modelValue: string
  standardType: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const parts = computed(() => getCoverDesignationParts(props.standardType) ?? { prefix: '', suffix: '' })
</script>

<style scoped>
.standard-type-name {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.fixed-text {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  color: var(--ses-ink-2);
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}

.standard-type-name :deep(.el-input) {
  flex: 1 1 150px;
  min-width: min(120px, 100%);
}
</style>
