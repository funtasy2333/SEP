<template>
  <header class="home-nav">
    <div class="nav-l">
      <router-link to="/" class="ses-brand">
        <SesLogo />
        <span class="ses-brand-label">标准编辑器</span>
      </router-link>
      <div class="brand-sep" />
      <nav class="home-nav-tabs" aria-label="标准库视图">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="home-nav-tab"
          :class="{ 'is-active': activeTab === tab.id }"
          @click="$emit('select-tab', tab.id)"
        >
          {{ tab.label }}
          <span v-if="tab.count !== undefined" class="count">{{ tab.count }}</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<script setup lang="ts">
import SesLogo from '@/components/SesLogo.vue'

defineProps<{
  activeTab: string
  tabs: { id: string; label: string; count?: number }[]
}>()

defineEmits<{ (e: 'select-tab', id: string): void }>()
</script>

<style scoped>
.home-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
}
.nav-l { display: flex; align-items: center; gap: 18px; min-width: 0; }
.brand-sep { flex-shrink: 0; width: 1px; height: 18px; background: var(--ses-line-2); }

.home-nav-tabs { display: flex; align-items: center; gap: 2px; min-width: 0; }
.home-nav-tab {
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ses-ink-3);
  border-radius: 6px;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
  font-family: inherit;
  white-space: nowrap;
}
.home-nav-tab:hover { color: var(--ses-ink); background: var(--ses-surface-2); }
.home-nav-tab.is-active { color: var(--ses-ink); background: var(--ses-surface-2); font-weight: 600; }
.home-nav-tab .count {
  font-size: 11px;
  padding: 1px 6px;
  background: var(--ses-surface-3);
  border-radius: 999px;
  color: var(--ses-ink-3);
  font-family: var(--ses-font-mono);
  font-weight: 500;
}
.home-nav-tab.is-active .count { background: var(--ses-accent-soft); color: var(--ses-accent); }

@media (max-width: 620px) {
  .home-nav { padding: 0 12px; }
  .nav-l { gap: 10px; }
  .home-nav-tab { padding: 6px 8px; }
}
</style>
