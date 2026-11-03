<template>
  <el-dialog
    :model-value="modelValue"
    title="升级 SES"
    width="min(560px, calc(100vw - 32px))"
    class="upgrade-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    :before-close="beforeClose"
    append-to-body
    @update:model-value="(value: boolean) => emit('update:modelValue', value)"
  >
    <div class="upgrade-body">
      <el-radio-group v-model="channel" class="channel-group" :disabled="busy" aria-label="升级通道" @change="onChannelChange">
        <el-radio value="stable">稳定版</el-radio>
        <el-radio value="commit">每次提交（开发版，可能不稳定）</el-radio>
      </el-radio-group>

      <div class="current-row">
        <span class="label">当前版本</span>
        <span class="current-version" data-test="current-version">{{ currentVersionText }}</span>
        <el-button size="small" :loading="checking" :disabled="busy" data-test="check-btn" @click="runCheck">检查更新</el-button>
      </div>

      <p v-if="checkError" class="inline-error" role="alert" data-test="check-error">{{ checkError }}</p>

      <section v-if="check" class="check-result" data-test="check-result">
        <template v-if="check.available && check.latest">
          <div class="latest-head">
            <span class="label">最新{{ check.channel === 'commit' ? '提交' : '版本' }}</span>
            <span class="latest-version" data-test="latest-version">{{ latestText }}</span>
            <span v-if="check.latest.publishedAt" class="published" data-test="published-at">发布于 {{ formatDateTime(check.latest.publishedAt) }}</span>
          </div>

          <div v-if="check.latest.notes" class="notes-block">
            <div class="label">发布说明</div>
            <pre class="notes" data-test="release-notes">{{ check.latest.notes }}</pre>
          </div>

          <div v-if="check.commits.length" class="commits-block">
            <div class="label">
              包含的提交（{{ check.commits.length }}）<template v-if="check.commits.length > COMMIT_LIMIT">，仅显示最近 {{ COMMIT_LIMIT }} 条</template>
            </div>
            <ul class="commits" data-test="commit-list">
              <li v-for="commit in shownCommits" :key="commit.sha">
                <code class="sha">{{ shortSha(commit.sha) }}</code>
                <span class="msg">{{ commit.message }}</span>
                <span class="date">{{ formatDate(commit.date) }}</span>
              </li>
            </ul>
          </div>

          <a
            v-if="check.latest.url"
            class="release-link"
            :href="check.latest.url"
            target="_blank"
            rel="noopener"
            data-test="release-link"
          >查看发布页面</a>
        </template>
        <p v-else class="unavailable" data-test="unavailable">{{ check.reason || '当前已是最新版本。' }}</p>
      </section>

      <section v-if="starting || progress" class="progress-block" data-test="progress">
        <div class="progress-label">{{ progressLabel }}</div>
        <el-progress
          v-if="progressPercent !== null"
          :percentage="progressPercent"
          :stroke-width="8"
        />
        <el-progress
          v-else
          :percentage="100"
          :indeterminate="true"
          :duration="2"
          :show-text="false"
          :stroke-width="8"
        />
        <div v-if="progressBytesText" class="progress-bytes" data-test="progress-bytes">{{ progressBytesText }}</div>
      </section>

      <p v-if="upgradeError" class="inline-error" role="alert" data-test="upgrade-error">{{ upgradeError }}</p>
    </div>

    <template #footer>
      <el-button :disabled="busy" @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button
        type="primary"
        :disabled="!canStart"
        :loading="starting"
        data-test="upgrade-btn"
        @click="startUpgrade"
      >{{ upgradeError ? '重试升级' : '立即升级' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import {
  httpStatusOf,
  isNoResponse,
  systemApi,
  systemErrorMessage,
  type Channel,
  type DownloadStatus,
  type UpdateCheck,
} from '@/api/system'
import { useSystemStore } from '@/stores/system'
import { describeVersion, formatDateTime, formatMegabytes, shortSha } from '@/utils/systemVersion'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const COMMIT_LIMIT = 50
const POLL_INTERVAL_MS = 1000

const store = useSystemStore()
const channel = ref<Channel>('stable')
const checking = ref(false)
const check = ref<UpdateCheck | null>(null)
const checkError = ref<string | null>(null)
const starting = ref(false)
const progress = ref<DownloadStatus | null>(null)
const upgradeError = ref<string | null>(null)

let checkSeq = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollSeq = 0
let startedAt = 0

const polling = computed(() => progress.value !== null && progress.value.phase !== 'error')
const busy = computed(() => starting.value || polling.value)
const canStart = computed(() => Boolean(check.value?.available && check.value.latest) && !busy.value)
const shownCommits = computed(() => (check.value?.commits ?? []).slice(0, COMMIT_LIMIT))
const currentVersionText = computed(() => (store.info ? describeVersion(store.info) : '未知'))

const latestText = computed(() => {
  const latest = check.value?.latest
  if (!latest) return ''
  const sha = shortSha(latest.commit)
  if (check.value?.channel === 'commit') return latest.version ? `${latest.version} · ${sha}` : sha
  return latest.version ?? sha
})

const progressPercent = computed(() => {
  const status = progress.value
  if (!status?.totalBytes || status.totalBytes <= 0) return null
  return Math.min(100, Math.floor((status.receivedBytes / status.totalBytes) * 100))
})

const progressLabel = computed(() => {
  if (starting.value && !progress.value) return '正在提交升级请求…'
  switch (progress.value?.phase) {
    case 'verifying': return '正在校验升级包…'
    case 'handing-off':
    case 'handed-off': return '正在交接给升级程序…'
    case 'error': return '下载失败'
    default: return '正在下载升级包…'
  }
})

const progressBytesText = computed(() => {
  const status = progress.value
  if (!status) return ''
  if (status.totalBytes && status.totalBytes > 0) {
    return `${formatMegabytes(status.receivedBytes)} / ${formatMegabytes(status.totalBytes)}`
  }
  return status.receivedBytes > 0 ? `已下载 ${formatMegabytes(status.receivedBytes)}` : ''
})

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('zh-CN')
}

function resetAll() {
  checkSeq += 1
  stopPolling()
  channel.value = store.info?.channel ?? 'stable'
  check.value = null
  checkError.value = null
  checking.value = false
  starting.value = false
  progress.value = null
  upgradeError.value = null
}

watch(() => props.modelValue, (open) => {
  if (open) resetAll()
  else stopPolling()
}, { immediate: true })

function beforeClose(done: () => void) {
  if (!busy.value) done()
}

function onChannelChange() {
  checkSeq += 1
  checking.value = false
  check.value = null
  checkError.value = null
  upgradeError.value = null
}

async function runCheck() {
  const seq = ++checkSeq
  const requested = channel.value
  checking.value = true
  checkError.value = null
  upgradeError.value = null
  check.value = null
  try {
    const { data } = await systemApi.checkUpdate(requested)
    if (seq === checkSeq) check.value = data
  } catch (error) {
    if (seq === checkSeq) checkError.value = systemErrorMessage(error, '检查更新失败，请稍后重试')
  } finally {
    if (seq === checkSeq) checking.value = false
  }
}

async function startUpgrade() {
  const latest = check.value?.latest
  if (!check.value?.available || !latest || busy.value) return
  try {
    await ElMessageBox.confirm(
      '升级期间 SES 会停止几分钟，正在编辑的文档请先保存；升级前会自动备份数据库；升级后不支持降级。',
      '确认升级',
      { type: 'warning', confirmButtonText: '立即升级', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  upgradeError.value = null
  starting.value = true
  startedAt = Date.now()
  try {
    await systemApi.startUpdate(check.value.channel, latest.commit)
  } catch (error) {
    starting.value = false
    if (httpStatusOf(error) === 409) {
      check.value = null
      upgradeError.value = '状态已变化，请重新检查更新'
    } else {
      upgradeError.value = systemErrorMessage(error, '无法开始升级，请稍后重试')
    }
    return
  }
  starting.value = false
  progress.value = { phase: 'downloading', receivedBytes: 0, totalBytes: null, error: null, startedAt: null }
  schedulePoll(++pollSeq)
}

function stopPolling() {
  pollSeq += 1
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll(seq: number) {
  pollTimer = setTimeout(() => void poll(seq), POLL_INTERVAL_MS)
}

function handOff() {
  stopPolling()
  progress.value = null
  store.beginUpgrade(startedAt)
  emit('update:modelValue', false)
}

async function poll(seq: number) {
  try {
    const { data } = await systemApi.updateStatus()
    if (seq !== pollSeq) return
    progress.value = data
    if (data.phase === 'handing-off' || data.phase === 'handed-off') return handOff()
    if (data.phase === 'error') {
      stopPolling()
      upgradeError.value = data.error || '下载升级包失败，请重试'
      return
    }
  } catch (error) {
    if (seq !== pollSeq) return
    // 服务已停止（升级程序接管）时请求会失败，这是预期；4xx 才是真正的错误。
    const status = httpStatusOf(error)
    if (isNoResponse(error) || (status !== undefined && status >= 500)) return handOff()
    stopPolling()
    progress.value = null
    upgradeError.value = systemErrorMessage(error, '无法读取升级进度')
    return
  }
  schedulePoll(seq)
}

onBeforeUnmount(stopPolling)
</script>

<style scoped>
.upgrade-body { display: flex; flex-direction: column; gap: 14px; font-size: 13px; color: var(--ses-ink); }
.channel-group { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.label { font-size: 12px; color: var(--ses-ink-3); }
.current-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.current-version { font-family: var(--ses-font-mono); font-size: 12px; color: var(--ses-ink-2); flex: 1; min-width: 0; word-break: break-all; }

.check-result {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px;
  border: 1px solid var(--ses-line);
  border-radius: var(--ses-r-md);
  background: var(--ses-surface-2);
}
.latest-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.latest-version { font-weight: 600; font-family: var(--ses-font-mono); }
.published { font-size: 12px; color: var(--ses-ink-3); }
.notes {
  margin: 4px 0 0;
  max-height: 160px; overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--ses-line);
  border-radius: var(--ses-r-sm);
  background: var(--ses-surface);
  font: inherit; font-size: 12px; line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.commits {
  list-style: none; margin: 4px 0 0; padding: 0;
  max-height: 160px; overflow: auto;
  border: 1px solid var(--ses-line);
  border-radius: var(--ses-r-sm);
  background: var(--ses-surface);
}
.commits li { display: flex; align-items: baseline; gap: 8px; padding: 5px 10px; font-size: 12px; border-bottom: 1px solid var(--ses-line); }
.commits li:last-child { border-bottom: 0; }
.commits .sha { flex-shrink: 0; font-family: var(--ses-font-mono); color: var(--ses-accent); }
.commits .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.commits .date { flex-shrink: 0; color: var(--ses-ink-3); }
.release-link { align-self: flex-start; font-size: 12px; color: var(--ses-accent); }
.unavailable { margin: 0; color: var(--ses-ink-2); line-height: 1.6; }

.progress-block { display: flex; flex-direction: column; gap: 6px; }
.progress-label { font-size: 12px; color: var(--ses-ink-2); }
.progress-bytes { font-size: 12px; color: var(--ses-ink-3); font-family: var(--ses-font-mono); }
.inline-error { margin: 0; color: var(--ses-err); line-height: 1.6; }

@media (max-width: 620px) {
  .commits li { flex-wrap: wrap; }
  .commits .msg { flex-basis: 100%; order: 3; white-space: normal; }
}
</style>
