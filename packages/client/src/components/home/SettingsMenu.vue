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
        :title="store.hasUnreadUpdate ? '设置（有新版本可用）' : undefined"
        aria-haspopup="menu"
        :aria-expanded="open"
      >
        <el-icon :size="18"><Setting /></el-icon>
        <span
          v-if="store.hasUnreadUpdate"
          class="settings-update-dot"
          data-test="settings-update-dot"
          aria-hidden="true"
        />
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
          <span class="menu-item-row">
            <span class="menu-item-label">升级…</span>
            <span
              v-if="store.hasAvailableUpdate"
              class="menu-item-badge"
              data-test="upgrade-badge"
            >有新版本</span>
          </span>
          <span v-if="!store.info.canUpgrade && store.info.upgradeBlockedReason" class="menu-item-reason" data-test="upgrade-reason">
            {{ store.info.upgradeBlockedReason }}
          </span>
        </button>

        <div class="menu-divider" />

        <button
          type="button"
          class="menu-item"
          role="menuitem"
          data-test="shortcut-item"
          :disabled="!canManageDesktop || creatingShortcuts"
          @click="handleCreateShortcuts"
        >
          <span class="menu-item-row">
            <span class="menu-item-label">{{ shortcutLabel }}</span>
            <span
              v-if="allShortcutsCreated && !creatingShortcuts"
              class="menu-item-badge neutral"
              data-test="shortcut-created-badge"
            >已创建</span>
          </span>
          <span v-if="desktopBlockedReason" class="menu-item-reason" data-test="desktop-reason">
            {{ desktopBlockedReason }}
          </span>
        </button>

        <div class="menu-item menu-toggle-item" data-test="autostart-item">
          <div class="menu-item-row">
            <span class="menu-item-label">开机后台自启</span>
            <el-switch
              :model-value="autoStartEnabled"
              size="small"
              data-test="autostart-switch"
              aria-label="开机后台自启"
              :loading="autoStartSaving"
              :disabled="!canManageDesktop || autoStartSaving"
              @change="handleToggleAutoStart"
            />
          </div>
          <span v-if="canManageDesktop || !desktopBlockedReason" class="menu-item-reason">
            登录系统后在后台静默启动，直接打开浏览器即可使用
          </span>
        </div>

        <div class="menu-divider" />

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
        <button type="button" class="retry" data-test="info-retry" @click="retryInfo">重试</button>
      </div>

      <p class="menu-note">关闭网页后 SES 仍在后台运行；要彻底退出，请使用『退出 SES』。</p>
    </div>
  </el-popover>

  <UpgradeDialog v-model="store.upgradeDialogOpen" />
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
const shuttingDown = ref(false)
const creatingShortcuts = ref(false)
const autoStartSaving = ref(false)

const versionLine = computed(() => (store.info ? describeVersion(store.info) : ''))
const desktopPlatform = computed(() => store.desktopStatus?.platform ?? store.info?.launcher ?? null)
const canManageDesktop = computed(() => {
  if (!store.desktopStatus) return false
  return store.desktopStatus.supported
})
const desktopBlockedReason = computed(() => {
  if (store.desktopError) return store.desktopError
  if (store.desktopStatus && !store.desktopStatus.supported) {
    return store.desktopStatus.unsupportedReason
  }
  return null
})
const allShortcutsCreated = computed(() =>
  Boolean(store.desktopStatus?.desktopShortcut && store.desktopStatus?.startMenuShortcut),
)
const autoStartEnabled = computed(() => Boolean(store.desktopStatus?.autoStart))

const shortcutLabel = computed(() => {
  if (creatingShortcuts.value) return '创建中…'
  if (desktopPlatform.value === 'windows') {
    return allShortcutsCreated.value ? '重建桌面与开始菜单快捷方式' : '创建桌面与开始菜单快捷方式'
  }
  if (desktopPlatform.value === 'macos') {
    return allShortcutsCreated.value ? '重建桌面与应用程序快捷方式' : '创建桌面与应用程序快捷方式'
  }
  return '创建桌面快捷方式'
})

function refreshOnOpen() {
  if (!store.info && !store.infoLoading) void store.loadInfo()
  if (!store.desktopLoading) void store.loadDesktopStatus()
}

// 打开菜单时加载或刷新系统信息与桌面集成状态。
watch(open, (value) => {
  if (value) refreshOnOpen()
})

function retryInfo() {
  void store.loadInfo()
  void store.loadDesktopStatus()
}

function openUpgrade() {
  if (!store.info?.canUpgrade) return
  open.value = false
  store.openUpgradeDialog()
}

async function handleCreateShortcuts() {
  if (!canManageDesktop.value || creatingShortcuts.value) return
  creatingShortcuts.value = true
  try {
    const { data } = await systemApi.createShortcuts()
    store.setDesktopShortcutResult(data)
    ElMessage.success(
      desktopPlatform.value === 'windows'
        ? '已创建桌面与开始菜单快捷方式'
        : desktopPlatform.value === 'macos'
          ? '已创建桌面与应用程序快捷方式'
          : '已创建桌面快捷方式',
    )
  } catch (error) {
    ElMessage.error(systemErrorMessage(error, '创建快捷方式失败，请稍后重试'))
  } finally {
    creatingShortcuts.value = false
  }
}

async function handleToggleAutoStart(value: string | number | boolean) {
  if (!canManageDesktop.value || autoStartSaving.value) return
  const next = Boolean(value)
  autoStartSaving.value = true
  try {
    const { data } = await systemApi.setAutoStart(next)
    store.setDesktopAutoStart(data.autoStart)
    ElMessage.success(data.autoStart ? '已开启开机后台自启' : '已关闭开机后台自启')
  } catch (error) {
    ElMessage.error(systemErrorMessage(error, '更新开机自启设置失败，请稍后重试'))
  } finally {
    autoStartSaving.value = false
  }
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
  position: relative;
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
.settings-update-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ses-err);
  box-shadow: 0 0 0 1.5px var(--ses-surface);
  pointer-events: none;
}

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
.menu-divider {
  margin: 4px 0;
  border-top: 1px solid var(--ses-line);
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
.menu-toggle-item {
  cursor: default;
}
.menu-toggle-item:hover {
  background: transparent;
}
.menu-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.menu-item-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.5;
  flex-shrink: 0;
}
.menu-item-badge.neutral {
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
}
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
