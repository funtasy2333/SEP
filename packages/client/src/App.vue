<template>
  <router-view />
</template>

<script setup lang="ts">
// Global app shell. Theme + density attributes are set on <html> so
// they can be toggled at runtime (e.g. from a settings dialog).
// Defaults are applied lazily — the styles in tokens.css already cover
// the unset case, so this is just bookkeeping for future toggles.
import { onMounted } from 'vue'

onMounted(() => {
  const html = document.documentElement
  if (!html.dataset.sesTheme) html.dataset.sesTheme = 'light'
  if (!html.dataset.sesDensity) html.dataset.sesDensity = 'regular'
})
</script>

<style>
/* Imported reset is in app.css — no per-file global styles here. */
</style>
