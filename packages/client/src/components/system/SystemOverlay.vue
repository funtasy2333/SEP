<template>
  <div v-if="store.mode !== 'normal'" class="system-overlay" role="alertdialog" aria-modal="true" :aria-label="ariaLabel">
    <div class="overlay-card">
      <template v-if="store.mode === 'exited'">
        <h2>SES 已退出</h2>
        <p data-test="exited-text">SES 已退出，可以关闭此页面。再次使用请双击『启动SES』。</p>
      </template>

      <template v-else>
        <template v-if="outcome === 'succeeded'">
          <h2>升级完成</h2>
          <p class="ok" data-test="upgrade-succeeded">已升级到 {{ last?.to }}</p>
          <p class="hint">页面将在 2 秒后自动刷新。</p>
          <div class="actions"><el-button type="primary" data-test="refresh-btn" @click="reloadNow">立即刷新</el-button></div>
        </template>

        <template v-else-if="outcome === 'rolled-back'">
          <h2>升级失败</h2>
          <p class="err" data-test="upgrade-rolled-back">升级失败，已恢复到原版本</p>
          <p v-if="last?.message" class="detail" data-test="upgrade-message">{{ last.message }}</p>
          <p class="hint">详细日志见 <code>{{ LOG_PATH }}</code></p>
          <div class="actions"><el-button type="primary" data-test="refresh-btn" @click="reloadNow">刷新页面</el-button></div>
        </template>

        <template v-else-if="outcome === 'failed'">
          <h2>升级失败</h2>
          <p class="err" data-test="upgrade-failed">升级失败，SES 未能自动恢复。</p>
          <p v-if="last?.message" class="detail" data-test="upgrade-message">{{ last.message }}</p>
          <p class="hint">详细日志见 <code>{{ LOG_PATH }}</code>。请双击『启动SES』重新启动。</p>
        </template>

        <template v-else>
          <h2>正在升级 SES</h2>
          <p>升级期间 SES 会停止，需要几分钟，请不要关闭此页面。完成后页面会自动刷新。</p>
          <ol class="steps">
            <li v-for="item in STEPS" :key="item">{{ item }}</li>
          </ol>
          <p v-if="last?.state === 'running' && freshLast" class="hint" data-test="upgrade-step">当前步骤：{{ last.step }}</p>
          <p v-if="timedOut" class="warn" data-test="upgrade-timeout">
            等待时间较长。请查看 <code>{{ LOG_PATH }}</code>，或双击『启动SES』。本页仍会继续等待。
          </p>
          <div class="spinner" aria-hidden="true" />
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { systemApi, type UpgradeStatusFile } from '@/api/system'
import { useSystemStore } from '@/stores/system'

const props = withDefaults(defineProps<{
  /** 升级成功后刷新页面的方式；测试中可替换。 */
  reload?: () => void
  pollIntervalMs?: number
  reloadDelayMs?: number
  timeoutMs?: number
}>(), {
  reload: () => window.location.reload(),
  pollIntervalMs: 3000,
  reloadDelayMs: 2000,
  timeoutMs: 20 * 60 * 1000,
})

const LOG_PATH = '.ses-run/upgrade.log'
const STEPS = ['停止服务', '替换程序文件', '安装依赖', '构建', '启动']

const store = useSystemStore()
const outcome = ref<'waiting' | 'succeeded' | 'rolled-back' | 'failed'>('waiting')
const last = ref<UpgradeStatusFile | null>(null)
const freshLast = ref(false)
const timedOut = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
let timeoutTimer: ReturnType<typeof setTimeout> | null = null
let polling = false

const ariaLabel = computed(() => (store.mode === 'exited' ? 'SES 已退出' : '正在升级 SES'))

function clearTimers() {
  if (pollTimer) clearInterval(pollTimer)
  if (reloadTimer) clearTimeout(reloadTimer)
  if (timeoutTimer) clearTimeout(timeoutTimer)
  pollTimer = reloadTimer = timeoutTimer = null
}

function reloadNow() {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = null
  props.reload()
}

async function pollOnce() {
  if (polling) return
  polling = true
  try {
    const { data } = await systemApi.info()
    if (store.mode !== 'upgrading' || outcome.value !== 'waiting') return
    const latest = data.upgrade?.last ?? null
    const updatedAt = latest ? Date.parse(latest.updatedAt) : Number.NaN
    // 只认交接之后产生的结果；之前升级留下的状态文件不算。
    const fresh = latest !== null && Number.isFinite(updatedAt) && updatedAt > (store.handoffAt ?? 0)
    freshLast.value = fresh
    if (!fresh || !latest) return
    last.value = latest
    if (latest.state === 'running') return
    outcome.value = latest.state
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    if (timeoutTimer) clearTimeout(timeoutTimer)
    timeoutTimer = null
    if (latest.state === 'succeeded') reloadTimer = setTimeout(reloadNow, props.reloadDelayMs)
  } catch {
    // 服务停止期间请求失败属正常，继续等待。
  } finally {
    polling = false
  }
}

function startWaiting() {
  clearTimers()
  outcome.value = 'waiting'
  last.value = null
  freshLast.value = false
  timedOut.value = false
  pollTimer = setInterval(() => void pollOnce(), props.pollIntervalMs)
  timeoutTimer = setTimeout(() => { timedOut.value = true }, props.timeoutMs)
}

watch(() => store.mode, (mode) => {
  if (mode === 'upgrading') startWaiting()
  else clearTimers()
}, { immediate: true })

onBeforeUnmount(clearTimers)
</script>

<style scoped>
.system-overlay {
  position: fixed; inset: 0; z-index: 9000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: color-mix(in oklch, var(--ses-bg) 94%, transparent);
  backdrop-filter: blur(4px);
}
.overlay-card {
  width: min(480px, 100%);
  padding: 28px 28px 24px;
  border: 1px solid var(--ses-line);
  border-radius: var(--ses-r-lg);
  background: var(--ses-surface);
  box-shadow: var(--ses-shadow-2);
  color: var(--ses-ink);
  font-size: 14px;
  line-height: 1.7;
}
h2 { margin: 0 0 10px; font-size: 18px; font-weight: 600; }
p { margin: 0 0 10px; }
.ok { color: var(--ses-ok); font-weight: 600; }
.err { color: var(--ses-err); font-weight: 600; }
.warn { padding: 8px 10px; border-radius: var(--ses-r-sm); background: var(--ses-warn-soft); color: var(--ses-ink-2); font-size: 13px; }
.detail { padding: 8px 10px; border-radius: var(--ses-r-sm); background: var(--ses-surface-2); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.hint { color: var(--ses-ink-3); font-size: 13px; }
code { font-family: var(--ses-font-mono); font-size: 12px; padding: 1px 5px; border-radius: var(--ses-r-xs); background: var(--ses-surface-3); }
.steps { margin: 0 0 12px; padding-left: 22px; color: var(--ses-ink-2); font-size: 13px; }
.actions { margin-top: 14px; display: flex; gap: 10px; }
.spinner {
  width: 22px; height: 22px; margin-top: 6px;
  border: 2px solid var(--ses-line-2); border-top-color: var(--ses-accent);
  border-radius: 50%;
  animation: ses-overlay-spin 0.9s linear infinite;
}
@keyframes ses-overlay-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 3s; } }
</style>
