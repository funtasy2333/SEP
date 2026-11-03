<template>
  <!-- 以路径为 key：编辑器页面只在 onMounted 里按 :id 加载文档，从一份文档直接进入另一份（如冲突时「另存为副本」）必须重建页面 -->
  <router-view :key="$route.path" />
  <SystemOverlay />
</template>

<script setup lang="ts">
// Global app shell. Theme + density attributes are set on <html> so
// they can be toggled at runtime (e.g. from a settings dialog).
// Defaults are applied lazily — the styles in tokens.css already cover
// the unset case, so this is just bookkeeping for future toggles.
import { onMounted } from 'vue'
import SystemOverlay from '@/components/system/SystemOverlay.vue'
import { useBackgroundRunGuard } from '@/composables/useBackgroundRunGuard'
import { useSystemStore } from '@/stores/system'

const systemStore = useSystemStore()
useBackgroundRunGuard()

onMounted(() => {
  const html = document.documentElement
  if (!html.dataset.sesTheme) html.dataset.sesTheme = 'light'
  if (!html.dataset.sesDensity) html.dataset.sesDensity = 'regular'
  void systemStore.loadInfo()
})
</script>

<style>
/* Imported reset is in app.css — no per-file global styles here. */
</style>
