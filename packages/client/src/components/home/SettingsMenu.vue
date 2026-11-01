<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-end"
    :width="300"
    :show-arrow="false"
    popper-class="settings-menu-popper"
  >
    <template #reference>
      <button
        type="button"
        class="settings-btn"
        aria-label="设置"
        aria-haspopup="menu"
        :aria-expanded="open"
      >
        <el-icon :size="18"><Setting /></el-icon>
      </button>
    </template>

    <div class="settings-menu" role="menu" aria-label="设置">
      <template v-if="store.info">
        <div class="menu-version" data-test="version-line">{{ versionLine }}</div>

        <button
          type="button"
          class="menu-item"
          role="menuitem"
          data-test="upgrade-item"
          :disabled="!store.info.canUpgrade"
          @click="openUpgrade"
        >
          <span class="menu-item-label">升级…</span>
          <span v-if="!store.info.canUpgrade && store.info.upgradeBlockedReason" class="menu-item-reason" data-test="upgrade-reason">
            {{ store.info.upgradeBlockedReason }}
          </span>
        </button>

        <button
          type="button"
          class="menu-item danger"
          role="menuitem"
          data-test="shutdown-item"
          :disabled="!store.info.canShutdown || shuttingDown"
          @click="confirmShutdown"
        >
          <span class="menu-item-label">退出 SES</span>
          <span v-if="!store.info.canShutdown && store.info.shutdownBlockedReason" class="menu-item-reason" data-test="shutdown-reason">
            {{ store.info.shutdownBlockedReason }}
          </span>
        </button>
      </template>

      <div v-else-if="store.infoLoading" class="menu-state" data-test="info-loading">正在读取系统信息…</div>
      <div v-else class="menu-state error" data-test="info-error">
        <span>{{ store.infoError || '无法读取系统信息' }}</span>
        <button type="button" class="retry" data-test="info-retry" @click="store.loadInfo()">重试</button>
      </div>

      <p class="menu-note">关闭网页后 SES 仍在后台运行；要彻底退出，请使用『退出 SES』。</p>
    </div>
  </el-popover>

  <UpgradeDialog v-model="upgradeOpen" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting } from '@element-plus/icons-vue'
import { systemApi, systemErrorMessage } from '@/api/system'
import { useSystemStore } from '@/stores/system'
import { describeVersion } from '@/utils/systemVersion'
import UpgradeDialog from './UpgradeDialog.vue'

const store = useSystemStore()
const open = ref(false)
const upgradeOpen = ref(false)
const shuttingDown = ref(false)

const versionLine = computed(() => (store.info ? describeVersion(store.info) : ''))

// 打开菜单时若还没有信息（启动时加载失败或仍在加载），再试一次。
watch(open, (value) => {
  if (value && !store.info && !store.infoLoading) void store.loadInfo()
})

function openUpgrade() {
  if (!store.info?.canUpgrade) return
  open.value = false
  upgradeOpen.value = true
}

async function confirmShutdown() {
  if (!store.info?.canShutdown || shuttingDown.value) return
  open.value = false
  try {
    await ElMessageBox.confirm(
      '退出后所有 SES 页面都将无法使用，再次使用请双击『启动SES』。未保存的修改请先保存。',
      '退出 SES',
      { type: 'warning', confirmButtonText: '退出 SES', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  shuttingDown.value = true
  try {
    await systemApi.shutdown()
    store.markExited()
  } catch (error) {
    ElMessage.error(systemErrorMessage(error, '退出失败，请稍后重试'))
  } finally {
    shuttingDown.value = false
  }
}
</script>

<style scoped>
.settings-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--ses-r-sm);
  background: transparent;
  color: var(--ses-ink-3);
  cursor: pointer;
}
.settings-btn:hover, .settings-btn[aria-expanded='true'] { color: var(--ses-ink); background: var(--ses-surface-2); }
.settings-btn:focus-visible { outline: 2px solid var(--ses-accent); outline-offset: 1px; }

.settings-menu { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.menu-version {
  padding: 4px 8px 8px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--ses-line);
  font-size: 12px;
  color: var(--ses-ink-3);
  font-family: var(--ses-font-mono);
  word-break: break-all;
}
.menu-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: var(--ses-r-sm);
  background: transparent;
  color: var(--ses-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover:not(:disabled) { background: var(--ses-surface-2); }
.menu-item:focus-visible { outline: 2px solid var(--ses-accent); outline-offset: -2px; }
.menu-item.danger { color: var(--ses-err); }
.menu-item:disabled { cursor: not-allowed; color: var(--ses-ink-4); }
.menu-item-reason { font-size: 12px; line-height: 1.5; color: var(--ses-ink-3); }

.menu-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; color: var(--ses-ink-3); }
.menu-state.error { color: var(--ses-err); }
.retry {
  flex-shrink: 0;
  padding: 2px 10px;
  border: 1px solid var(--ses-line-2);
  border-radius: var(--ses-r-sm);
  background: var(--ses-surface);
  color: var(--ses-ink-2);
  font: inherit;
  cursor: pointer;
}
.retry:hover { border-color: var(--ses-accent); color: var(--ses-accent); }

.menu-note {
  margin: 4px 0 0;
  padding: 8px 8px 2px;
  border-top: 1px solid var(--ses-line);
  font-size: 12px;
  line-height: 1.6;
  color: var(--ses-ink-3);
}
</style>
