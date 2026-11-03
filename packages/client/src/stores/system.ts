import { defineStore } from 'pinia'
import { ref } from 'vue'
import { systemApi, type SystemInfo } from '@/api/system'

export type SystemMode = 'normal' | 'exited' | 'upgrading'

export const useSystemStore = defineStore('system', () => {
  const info = ref<SystemInfo | null>(null)
  const infoLoading = ref(false)
  const infoError = ref<string | null>(null)
  const mode = ref<SystemMode>('normal')
  /** 升级交接时间（毫秒时间戳）：遮罩只认更新时间晚于它的升级结果，避免把上一次的结果当成本次。 */
  const handoffAt = ref<number | null>(null)

  let loadSeq = 0

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

  function markExited() {
    mode.value = 'exited'
  }

  function beginUpgrade(since: number = Date.now()) {
    handoffAt.value = since
    mode.value = 'upgrading'
  }

  return { info, infoLoading, infoError, mode, handoffAt, loadInfo, markExited, beginUpgrade }
})
