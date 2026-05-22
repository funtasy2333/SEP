<template>
  <div class="home-stats">
    <div v-for="(s, i) in stats" :key="i" class="home-stat">
      <div class="stat-lbl">
        <span v-if="s.live" class="pulse" />
        {{ s.label }}
      </div>
      <div class="stat-val">
        {{ s.value }}
        <span v-if="s.unit" class="unit">{{ s.unit }}</span>
      </div>
      <div v-if="s.trend" class="stat-trend" :class="{ up: s.trendUp }">
        {{ s.trendUp ? '↗' : '→' }} {{ s.trend }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface Stat {
  label: string
  value: number | string
  unit?: string
  trend?: string
  trendUp?: boolean
  live?: boolean
}

defineProps<{ stats: Stat[] }>()
</script>

<style scoped>
.home-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}
.home-stat {
  padding: 18px 20px;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
  transition: all 0.15s ease;
}
.home-stat:hover { border-color: var(--ses-line-2); transform: translateY(-1px); }
.home-stat::after {
  content: "";
  position: absolute; right: -8px; bottom: -8px;
  width: 80px; height: 80px;
  background: radial-gradient(circle at center, var(--ses-accent-soft) 0%, transparent 60%);
  border-radius: 50%;
  opacity: 0.6;
  pointer-events: none;
}
.stat-lbl {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ses-ink-3);
  display: flex; align-items: center; gap: 8px;
}
.pulse {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ses-accent);
  box-shadow: 0 0 0 0 var(--ses-accent-ring);
  animation: statPulse 2s infinite;
}
@keyframes statPulse {
  0% { box-shadow: 0 0 0 0 var(--ses-accent-ring); }
  100% { box-shadow: 0 0 0 8px transparent; }
}
.stat-val {
  font-size: 32px;
  font-weight: 600;
  font-family: var(--ses-font-mono);
  color: var(--ses-ink);
  margin-top: 4px;
  display: flex; align-items: baseline; gap: 6px;
}
.stat-val .unit { font-size: 13px; font-weight: 500; color: var(--ses-ink-3); font-family: var(--ses-font-ui); }
.stat-trend {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--ses-ink-3);
}
.stat-trend.up { color: var(--ses-ok); }
</style>
