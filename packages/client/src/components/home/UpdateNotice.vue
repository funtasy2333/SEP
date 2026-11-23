<template>
  <div v-if="store.hasUnreadUpdate" class="update-notice" role="note" data-test="update-notice">
    <el-icon class="update-notice-icon" :size="16"><Bell /></el-icon>
    <span class="update-notice-text" data-test="update-notice-text">{{ message }}</span>
    <div class="update-notice-actions">
      <button
        type="button"
        class="update-notice-btn primary"
        data-test="update-notice-open"
        @click="store.openUpgradeDialog()"
      >查看更新</button>
      <button
        type="button"
        class="update-notice-btn"
        data-test="update-notice-dismiss"
        @click="store.dismissCurrentUpdate()"
      >忽略此版本</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Bell } from '@element-plus/icons-vue'
import type { Channel } from '@/api/system'
import { useSystemStore } from '@/stores/system'
import { shortSha } from '@/utils/systemVersion'

const store = useSystemStore()

function formatLatestLabel(channel: Channel, version: string | null, commit: string): string {
  const sha = shortSha(commit)
  switch (channel) {
    case 'stable':
      return version ? `SES ${version}` : `SES ${sha}`
    case 'commit':
      return `提交版 ${sha}`
    default: {
      const exhaustive: never = channel
      return String(exhaustive)
    }
  }
}

const message = computed(() => {
  const check = store.updateCheck
  const latest = check?.latest
  if (!check || !latest) return ''
  const label = formatLatestLabel(check.channel, latest.version, latest.commit)
  const countSuffix = check.commits.length > 0 ? `，包含 ${check.commits.length} 项更新` : ''
  return `发现新版本 ${label}${countSuffix}`
})
</script>

<style scoped>
.update-notice {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--ses-accent-ring);
  border-radius: var(--ses-r-md);
  background: var(--ses-accent-soft);
  color: var(--ses-ink);
  font-size: 13px;
  line-height: 1.6;
}
.update-notice-icon { flex-shrink: 0; color: var(--ses-accent); }
.update-notice-text { flex: 1; min-width: 0; font-weight: 500; }
.update-notice-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.update-notice-btn {
  padding: 4px 10px;
  border: 1px solid var(--ses-line-2);
  border-radius: var(--ses-r-sm);
  background: var(--ses-surface);
  color: var(--ses-ink-2);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  cursor: pointer;
  white-space: nowrap;
}
.update-notice-btn:hover { color: var(--ses-ink); border-color: var(--ses-ink-4); }
.update-notice-btn.primary {
  border-color: var(--ses-accent);
  background: var(--ses-accent);
  color: #ffffff;
  font-weight: 500;
}
.update-notice-btn.primary:hover {
  border-color: var(--ses-accent-2);
  background: var(--ses-accent-2);
}
.update-notice-btn:focus-visible {
  outline: 2px solid var(--ses-accent-ring);
  outline-offset: 1px;
}

@media (max-width: 620px) {
  .update-notice { flex-wrap: wrap; }
  .update-notice-actions { width: 100%; justify-content: flex-end; }
}
</style>
