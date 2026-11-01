import { onBeforeUnmount, watch } from 'vue'
import { useSystemStore } from '@/stores/system'

/**
 * 关闭或刷新网页时让浏览器弹出自带的确认框，提醒 SES 仍在后台运行。
 * 仅在由启动脚本运行（launcher 非 null）且页面仍处于正常模式时注册；
 * 退出或升级期间注销，升级成功后的自动刷新不会被拦住。
 * 提示文字由浏览器决定，无法定制。
 */
export function useBackgroundRunGuard() {
  const store = useSystemStore()
  let registered = false

  function handler(event: BeforeUnloadEvent) {
    event.preventDefault()
    event.returnValue = ''
  }

  function sync() {
    const shouldGuard = store.mode === 'normal' && store.info?.launcher != null
    if (shouldGuard && !registered) {
      window.addEventListener('beforeunload', handler)
      registered = true
    } else if (!shouldGuard && registered) {
      window.removeEventListener('beforeunload', handler)
      registered = false
    }
  }

  const stop = watch(() => [store.mode, store.info?.launcher ?? null], sync, { immediate: true, flush: 'sync' })

  onBeforeUnmount(() => {
    stop()
    if (registered) window.removeEventListener('beforeunload', handler)
    registered = false
  })
}
