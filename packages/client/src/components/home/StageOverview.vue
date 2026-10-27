<template>
  <div class="stage-overview" role="group" aria-label="按编制阶段筛选">
    <button
      class="stage-cell is-all"
      type="button"
      :class="{ 'is-active': active === 'all' }"
      :aria-pressed="active === 'all'"
      @click="$emit('select', 'all')"
    >
      <span class="stage-name">全部阶段</span>
      <span class="stage-count">{{ total }}</span>
    </button>
    <button
      v-for="(stage, index) in STAGES"
      :key="stage"
      class="stage-cell"
      type="button"
      :class="{ 'is-active': active === stage, 'is-empty': !counts[stage] }"
      :aria-pressed="active === stage"
      :title="`只看${STAGE_LABELS[stage]}`"
      @click="$emit('select', active === stage ? 'all' : stage)"
    >
      <span class="stage-name"><span class="stage-step">{{ index + 1 }}</span>{{ STAGE_LABELS[stage] }}</span>
      <span class="stage-count">{{ counts[stage] || 0 }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { STAGES, STAGE_LABELS } from '@/constants/standards'

defineProps<{
  counts: Record<string, number>
  total: number
  active: string
}>()

defineEmits<{ (e: 'select', stage: string): void }>()
</script>

<style scoped>
/* 编制阶段按先后顺序排成一条，数字是该阶段的文件数；点击即筛选，再点一次取消 */
.stage-overview {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 0;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 12px;
  overflow: hidden;
}
.stage-cell {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  min-width: 0;
  padding: 12px 14px;
  border: 0;
  border-left: 1px solid var(--ses-line);
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.stage-cell:first-child { border-left: 0; }
.stage-cell:hover { background: var(--ses-surface-2); }
.stage-cell:focus-visible { outline: 2px solid var(--ses-accent-ring); outline-offset: -2px; }
.stage-cell.is-active { background: var(--ses-accent-soft); box-shadow: inset 0 -2px 0 var(--ses-accent); }
.stage-name {
  display: flex; align-items: center; gap: 6px;
  max-width: 100%;
  font-size: 12px;
  color: var(--ses-ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stage-step {
  flex: 0 0 auto;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: var(--ses-surface-3);
  color: var(--ses-ink-3);
  font-size: 10px;
  font-family: var(--ses-font-mono);
  line-height: 16px;
  text-align: center;
}
.stage-count {
  font-size: 22px;
  font-weight: 600;
  font-family: var(--ses-font-mono);
  color: var(--ses-ink);
  line-height: 1;
}
.stage-cell.is-empty .stage-count { color: var(--ses-ink-5); }
.stage-cell.is-active .stage-name,
.stage-cell.is-active .stage-count { color: var(--ses-accent); }
.stage-cell.is-active .stage-step { background: var(--ses-accent); color: white; }

@media (max-width: 1000px) {
  .stage-overview { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .stage-cell:nth-child(4n + 1) { border-left: 0; }
  .stage-cell:nth-child(n + 5) { border-top: 1px solid var(--ses-line); }
}
@media (max-width: 560px) {
  .stage-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stage-cell { border-left: 0; border-top: 1px solid var(--ses-line); }
  .stage-cell:nth-child(2n) { border-left: 1px solid var(--ses-line); }
  .stage-cell:nth-child(-n + 2) { border-top: 0; }
}
</style>
