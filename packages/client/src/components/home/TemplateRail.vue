<template>
  <div class="tpl-rail">
    <button
      v-for="t in TYPE_DEFS"
      :key="t.id"
      class="tpl-card"
      type="button"
      @click="$emit('pick', t.id)"
    >
      <span class="tpl-glyph">{{ t.glyph }}</span>
      <span class="tpl-text">
        <span class="tpl-name">{{ t.name }}</span>
        <span class="tpl-code">{{ t.code }}</span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { TYPE_DEFS } from '@/constants/standards'

defineEmits<{ (e: 'pick', type: string): void }>()
</script>

<style scoped>
/* 按标准类型新建：每张卡片直接带入该类型的编号前缀与固定称谓 */
.tpl-rail {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.tpl-card {
  display: flex; align-items: center; gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
  font-family: inherit;
  text-align: left;
}
.tpl-card:hover { border-color: var(--ses-accent); box-shadow: 0 6px 18px var(--ses-accent-ring); }
.tpl-card:focus-visible { outline: 2px solid var(--ses-accent-ring); outline-offset: 1px; }
.tpl-glyph {
  flex: 0 0 auto;
  width: 36px; height: 36px;
  border-radius: 8px;
  background: var(--ses-surface-2);
  font-family: var(--ses-font-zh-hei);
  font-weight: 700; font-size: 16px;
  color: var(--ses-ink);
  display: flex; align-items: center; justify-content: center;
}
.tpl-card:hover .tpl-glyph { background: var(--ses-accent-soft); color: var(--ses-accent); }
.tpl-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tpl-name { font-size: 13px; font-weight: 600; color: var(--ses-ink); }
.tpl-code { font-size: 11px; font-family: var(--ses-font-mono); color: var(--ses-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
