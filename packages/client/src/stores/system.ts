import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  systemApi,
  type Channel,
  type DesktopShortcutResult,
  type DesktopStatus,
  type SystemInfo,
  type UpdateCheck,
} from '@/api/system'

export type SystemMode = 'normal' | 'exited' | 'upgrading'

export const UPDATE_DISMISSED_STORAGE_KEY = 'ses.update.dismissedTarget'
export const UPDATE_CHECK_CACHE_STORAGE_KEY = 'ses.update.autoCheckCache'
export const UPDATE_CHECK_CACHE_TTL_MS = 30 * 60 * 1000

interface UpdateCheckCacheEntry {
  checkedAt: number
  channel: Channel
  currentVersion: string
  currentCommit: string | null
  result: UpdateCheck
}

function readDismissedTarget(): string | null {
  try {
    const value = localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY)
    return value && value.trim() ? value : null
  } catch {
    return null
  }
}

function isTransientGithubError(result: UpdateCheck): boolean {
  return !result.available && Boolean(result.reason?.startsWith('无法连接 GitHub'))
}

function readUpdateCache(currentInfo: SystemInfo, channel: Channel): UpdateCheck | null {
  try {
    const raw = localStorage.getItem(UPDATE_CHECK_CACHE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UpdateCheckCacheEntry> | null
    if (
      !parsed ||
      typeof parsed.checkedAt !== 'number' ||
      !Number.isFinite(parsed.checkedAt) ||
      parsed.channel !== channel ||
      parsed.currentVersion !== currentInfo.version ||
      (parsed.currentCommit ?? null) !== (currentInfo.commit ?? null) ||
      !parsed.result ||
      typeof parsed.result !== 'object' ||
      parsed.result.channel !== channel
    ) {
      return null
    }
    const age = Date.now() - parsed.checkedAt
    if (age < 0 || age >= UPDATE_CHECK_CACHE_TTL_MS) return null
    if (isTransientGithubError(parsed.result)) return null
    return parsed.result
  } catch {
    return null
  }
}

function writeUpdateCache(currentInfo: SystemInfo, result: UpdateCheck) {
  if (isTransientGithubError(result)) return
  const defaultChannel: Channel = currentInfo.channel ?? 'stable'
  if (result.channel !== defaultChannel) return
  try {
    const entry: UpdateCheckCacheEntry = {
      checkedAt: Date.now(),
      channel: result.channel,
      currentVersion: currentInfo.version,
      currentCommit: currentInfo.commit ?? null,
      result,
    }
    localStorage.setItem(UPDATE_CHECK_CACHE_STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // 浏览器禁用存储或空间不足时仅保留当前会话状态
  }
}

export const useSystemStore = defineStore('system', () => {
  const info = ref<SystemInfo | null>(null)
  const infoLoading = ref(false)
  const infoError = ref<string | null>(null)
  const desktopStatus = ref<DesktopStatus | null>(null)
  const desktopLoading = ref(false)
  const desktopError = ref<string | null>(null)
  const mode = ref<SystemMode>('normal')
  /** 升级交接时间（毫秒时间戳）：遮罩只认更新时间晚于它的升级结果，避免把上一次的结果当成本次。 */
  const handoffAt = ref<number | null>(null)
  const updateCheck = ref<UpdateCheck | null>(null)
  const upgradeDialogOpen = ref(false)
  const dismissedTarget = ref<string | null>(readDismissedTarget())

  let loadSeq = 0
  let desktopLoadSeq = 0
  let autoChecked = false

  const updateTargetKey = computed<string | null>(() => {
    const check = updateCheck.value
    if (!check?.available || !check.latest) return null
    return `${check.channel}:${check.latest.commit}`
  })

  const hasAvailableUpdate = computed(() => Boolean(info.value?.canUpgrade && updateTargetKey.value))

  const hasUnreadUpdate = computed(
    () => hasAvailableUpdate.value && dismissedTarget.value !== updateTargetKey.value,
  )

  async function loadInfo() {
    const seq = ++loadSeq
    infoLoading.value = true
    try {
      const { data } = await systemApi.info()
      if (seq !== loadSeq) return
      info.value = data
      infoError.value = null
    } catch {
      if (seq !== loadSeq) return
      infoError.value = '无法读取系统信息'
    } finally {
      if (seq === loadSeq) infoLoading.value = false
    }
  }

  async function loadDesktopStatus() {
    const seq = ++desktopLoadSeq
    desktopLoading.value = true
    try {
      const { data } = await systemApi.desktopStatus()
      if (seq !== desktopLoadSeq) return
      desktopStatus.value = data
      desktopError.value = null
    } catch {
      if (seq !== desktopLoadSeq) return
      desktopError.value = '无法读取桌面集成状态'
    } finally {
      if (seq === desktopLoadSeq) desktopLoading.value = false
    }
  }

  function setDesktopShortcutResult(result: DesktopShortcutResult) {
    desktopStatus.value = {
      supported: desktopStatus.value?.supported ?? true,
      unsupportedReason: null,
      platform: desktopStatus.value?.platform ?? info.value?.launcher ?? null,
      desktopShortcut: result.desktopShortcut,
      startMenuShortcut: result.startMenuShortcut,
      autoStart: desktopStatus.value?.autoStart ?? false,
    }
    desktopError.value = null
  }

  function setDesktopAutoStart(autoStart: boolean) {
    desktopStatus.value = {
      supported: desktopStatus.value?.supported ?? true,
      unsupportedReason: null,
      platform: desktopStatus.value?.platform ?? info.value?.launcher ?? null,
      desktopShortcut: desktopStatus.value?.desktopShortcut ?? false,
      startMenuShortcut: desktopStatus.value?.startMenuShortcut ?? false,
      autoStart,
    }
    desktopError.value = null
  }

  function recordUpdateCheck(result: UpdateCheck) {
    updateCheck.value = result
    if (info.value) {
      writeUpdateCache(info.value, result)
    }
  }

  async function checkForUpdateInBackground() {
    const currentInfo = info.value
    if (currentInfo?.canUpgrade !== true || autoChecked) return
    autoChecked = true

    const targetChannel: Channel = currentInfo.channel ?? 'stable'
    const cached = readUpdateCache(currentInfo, targetChannel)
    if (cached) {
      updateCheck.value = cached
      return
    }

    try {
      const response = await systemApi.checkUpdate(targetChannel)
      const data = response?.data
      if (!data) return
      if (
        info.value?.canUpgrade !== true ||
        info.value.version !== currentInfo.version ||
        (info.value.commit ?? null) !== (currentInfo.commit ?? null)
      ) {
        return
      }
      recordUpdateCheck(data)
    } catch {
      // 后台自动检查静默失败，不打扰用户
    }
  }

  function dismissCurrentUpdate() {
    const key = updateTargetKey.value
    if (!key) return
    dismissedTarget.value = key
    try {
      localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, key)
    } catch {
      // 无法持久化时仅在当前会话隐藏
    }
  }

  function openUpgradeDialog() {
    if (!info.value?.canUpgrade) return
    upgradeDialogOpen.value = true
  }

  function markExited() {
    mode.value = 'exited'
  }

  function beginUpgrade(since: number = Date.now()) {
    handoffAt.value = since
    mode.value = 'upgrading'
  }

  return {
    info,
    infoLoading,
    infoError,
    desktopStatus,
    desktopLoading,
    desktopError,
    mode,
    handoffAt,
    updateCheck,
    upgradeDialogOpen,
    dismissedTarget,
    updateTargetKey,
    hasAvailableUpdate,
    hasUnreadUpdate,
    loadInfo,
    loadDesktopStatus,
    setDesktopShortcutResult,
    setDesktopAutoStart,
    checkForUpdateInBackground,
    recordUpdateCheck,
    dismissCurrentUpdate,
    openUpgradeDialog,
    markExited,
    beginUpgrade,
  }
})
