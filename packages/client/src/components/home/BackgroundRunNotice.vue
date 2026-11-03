<template>
  <div v-if="visible" class="bg-notice" role="note" data-test="background-run-notice">
    <el-icon class="bg-notice-icon" :size="16"><InfoFilled /></el-icon>
    <span class="bg-notice-text">关闭网页后 SES 仍在后台运行；要彻底退出，请点击右上角『设置』→『退出 SES』。</span>
    <button type="button" class="bg-notice-close" aria-label="关闭提示" data-test="notice-close" @click="dismiss">
      <el-icon :size="14"><Close /></el-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Close, InfoFilled } from '@element-plus/icons-vue'
import { useSystemStore } from '@/stores/system'

const BACKGROUND_RUN_NOTICE_KEY = 'ses.notice.backgroundRun.dismissed'

const store = useSystemStore()

function readDismissed(): boolean {
  try {
    return localStorage.getItem(BACKGROUND_RUN_NOTICE_KEY) !== null
  } catch {
    return false
  }
}

// 读取失败时照常显示；写入失败时仅本次隐藏（本组件内记住）。
const dismissed = ref(readDismissed())
const visible = computed(() => store.info?.launcher != null && !dismissed.value)

function dismiss() {
  dismissed.value = true
  try {
    localStorage.setItem(BACKGROUND_RUN_NOTICE_KEY, '1')
  } catch {
    // 无法持久化，仅本次隐藏。
  }
}
</script>

<style scoped>
.bg-notice {
  display: flex; align-items: flex-start; gap: 10px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--ses-line);
  border-radius: var(--ses-r-md);
  background: var(--ses-info-soft);
  color: var(--ses-ink-2);
  font-size: 13px;
  line-height: 1.6;
}
.bg-notice-icon { flex-shrink: 0; margin-top: 3px; color: var(--ses-info); }
.bg-notice-text { flex: 1; min-width: 0; }
.bg-notice-close {
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: var(--ses-r-xs);
  background: transparent; color: var(--ses-ink-3);
  cursor: pointer;
}
.bg-notice-close:hover { color: var(--ses-ink); background: var(--ses-surface-3); }
.bg-notice-close:focus-visible { outline: 2px solid var(--ses-accent); }
</style>
