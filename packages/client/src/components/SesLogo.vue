<template>
  <img class="ses-logo" :src="logoUrl" alt="SES" width="270" height="108" />
</template>

<script setup lang="ts">
import logoUrl from '@/assets/ses-logo-nav.png'
</script>

<style scoped>
.ses-logo {
  display: block;
  width: 90px;
  height: auto;
  flex-shrink: 0;
}
</style>
