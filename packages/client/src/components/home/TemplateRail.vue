<template>
  <div class="tpl-rail">
    <div class="tpl-rail-head">
      <div class="head-eyebrow">
        <el-icon><MagicStick /></el-icon>
        快速起草
      </div>
      <div class="head-title">新建标准文件</div>
      <div class="head-sub">选择标准类型即时套用 GB/T 1.1 模板。</div>
    </div>
    <button
      v-for="t in templates"
      :key="t.type"
      class="tpl-card"
      @click="$emit('pick', t.type)"
    >
      <div class="tpl-glyph">{{ t.glyph }}</div>
      <div class="tpl-name">{{ t.name }}</div>
      <div class="tpl-code">{{ t.code }}</div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { MagicStick } from '@element-plus/icons-vue'

defineEmits<{ (e: 'pick', type: string): void }>()

const templates = [
  { type: 'national',   glyph: '国', name: '国家标准', code: 'GB / GB/T' },
  { type: 'industry',   glyph: '行', name: '行业标准', code: 'SJ / DL / …' },
  { type: 'local',      glyph: '地', name: '地方标准', code: 'DB' },
  { type: 'group',      glyph: '团', name: '团体标准', code: 'T/' },
  { type: 'enterprise', glyph: '企', name: '企业标准', code: 'Q/' },
]
</script>

<style scoped>
.tpl-rail {
  display: grid;
  grid-template-columns: 1fr repeat(5, auto);
  gap: 8px;
  align-items: stretch;
  padding: 14px;
  background: linear-gradient(135deg, var(--ses-accent-soft) 0%, var(--ses-surface) 60%);
  border: 1px solid var(--ses-line);
  border-radius: 12px;
  margin-bottom: 28px;
}
.tpl-rail-head {
  padding: 4px 10px 4px 6px;
  display: flex; flex-direction: column; justify-content: center;
}
.head-eyebrow {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ses-accent);
  display: flex; align-items: center; gap: 8px;
}
.head-title { font-size: 16px; font-weight: 600; color: var(--ses-ink); margin-top: 4px; }
.head-sub   { font-size: 12px; color: var(--ses-ink-3); margin-top: 2px; }

.tpl-card {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px;
  width: 132px;
  padding: 14px 12px;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.12s ease;
  font-family: inherit;
}
.tpl-card:hover {
  border-color: var(--ses-accent);
  background: var(--ses-paper);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px var(--ses-accent-ring);
}
.tpl-glyph {
  font-family: var(--ses-font-zh-hei);
  font-weight: 700; font-size: 18px;
  color: var(--ses-ink);
  letter-spacing: 0.05em;
  width: 44px; height: 44px;
  background: var(--ses-surface-2);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.tpl-card:hover .tpl-glyph { background: var(--ses-accent-soft); color: var(--ses-accent); }
.tpl-name { font-size: 12.5px; font-weight: 500; color: var(--ses-ink); }
.tpl-code { font-size: 10.5px; font-family: var(--ses-font-mono); color: var(--ses-ink-3); }
</style>
