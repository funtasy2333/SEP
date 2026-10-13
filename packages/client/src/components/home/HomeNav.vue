<template>
  <header class="home-nav">
    <div class="nav-l">
      <router-link to="/" class="ses-brand">
        <SesLogo />
        <span class="ses-brand-label">标准编辑器</span>
      </router-link>
      <div class="brand-sep" />
      <nav class="home-nav-tabs">
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
    <div class="nav-r">
      <el-input
        v-model="searchValue"
        size="default"
        placeholder="搜索标准编号、题名、起草人…"
        class="nav-search"
        clearable
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
        <template #suffix>
          <span class="kbd-hint">⌘K</span>
        </template>
      </el-input>
      <el-button text :icon="Clock" />
      <el-button text :icon="Setting" />
      <span class="ses-avatar a1" style="width: 28px; height: 28px; font-size: 11px">李</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Search, Clock, Setting } from '@element-plus/icons-vue'
import SesLogo from '@/components/SesLogo.vue'

defineProps<{
  activeTab: string
  tabs: { id: string; label: string; count?: number }[]
}>()

defineEmits<{ (e: 'select-tab', id: string): void }>()

const searchValue = ref('')
</script>

<style scoped>
.home-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
}
.nav-l, .nav-r { display: flex; align-items: center; gap: 18px; }
.brand-sep { width: 1px; height: 18px; background: var(--ses-line-2); }

.home-nav-tabs { display: flex; align-items: center; gap: 2px; }
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
.nav-search { width: 260px; }
.kbd-hint { font-size: 10px; color: var(--ses-ink-4); font-family: var(--ses-font-mono); }

@media (max-width: 1100px) {
  .nav-l, .nav-r { gap: 12px; }
  .nav-search { width: 180px; }
  .home-nav-tab { padding: 6px 8px; }
}
@media (max-width: 900px) {
  .home-nav { height: auto; padding: 10px 16px; flex-wrap: wrap; gap: 10px; }
  .nav-l, .nav-r { width: 100%; min-width: 0; }
  .brand-sep { flex-shrink: 0; }
  .home-nav-tabs { flex: 1; min-width: 0; overflow-x: auto; }
  .home-nav-tab { flex-shrink: 0; white-space: nowrap; }
  .nav-search { flex: 1; width: auto; }
}
</style>
