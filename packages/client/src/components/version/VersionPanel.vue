<template>
  <div class="version-panel">
    <div class="version-panel-header">
      <h3>版本历史</h3>
      <div class="header-actions">
        <el-button size="small" type="primary" @click="openCreateDialog">
          保存版本
        </el-button>
        <el-button size="small" @click="$emit('close')">关闭</el-button>
      </div>
    </div>

    <!-- 版本列表 -->
    <div class="version-list" v-loading="versionStore.loading">
      <div v-if="versionStore.sortedVersions.length === 0" class="empty-hint">
        暂无历史版本，点击"保存版本"创建第一个版本快照。
      </div>

      <div
        v-for="version in versionStore.sortedVersions"
        :key="version.id"
        class="version-item"
        :class="{ selected: selectedVersionIds.includes(version.id!), 'is-ai': version.source === 'ai' }"
        :data-source="version.source"
        @click="toggleSelect(version)"
      >
        <div class="version-item-header">
          <div class="version-item-left">
            <el-checkbox
              :model-value="selectedVersionIds.includes(version.id!)"
              @change="toggleSelect(version)"
              @click.stop
              size="small"
            />
            <span class="version-no">v{{ version.versionNo }}</span>
            <el-tag :type="stageTagType(version.stage)" size="small" effect="plain">
              {{ stageLabel(version.stage) }}
            </el-tag>
            <el-tag
              v-if="sourceLabel(version.source)"
              class="version-source-tag"
              :data-source="version.source"
              :title="version.client ? `写入方：${version.client}` : undefined"
              type="warning"
              size="small"
              :effect="version.source === 'ai' ? 'dark' : 'light'"
            >
              {{ sourceLabel(version.source) }}
            </el-tag>
          </div>
          <span class="version-time">{{ formatTime(version.createdAt) }}</span>
        </div>
        <div v-if="version.client" class="version-client">写入方：{{ version.client }}</div>
        <div v-if="version.note" class="version-note">{{ version.note }}</div>
        <div class="version-actions">
          <el-button link size="small" @click.stop="previewVersion(version)">预览</el-button>
          <el-button link size="small" @click.stop="restoreVersion(version)">回滚</el-button>
          <!-- 列表接口不返回 baseContent：探测到详情里有写入前内容的 AI 修改才提供这两个操作 -->
          <template v-if="canInspectAiChange(version)">
            <el-button link size="small" type="primary" data-action="view-ai-change" @click.stop="viewAiChange(version)">查看本次修改</el-button>
            <el-button link size="small" type="warning" data-action="rollback-ai-change" @click.stop="rollbackAiChange(version)">回滚到修改前</el-button>
          </template>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="version-panel-footer" v-if="selectedVersionIds.length === 2">
      <el-button type="primary" size="small" @click="compareSelected">
        比对选中的两个版本
      </el-button>
    </div>
    <div class="version-panel-footer hint" v-else-if="versionStore.sortedVersions.length >= 2">
      选择两个版本进行差异比对
    </div>

    <!-- 创建版本对话框 -->
    <el-dialog v-model="showCreateDialog" title="保存版本" width="440px" append-to-body>
      <el-form label-width="80px" :model="createForm">
        <el-form-item label="版本号">
          <el-input v-model="createForm.versionNo" placeholder="如 1.0、1.1" />
        </el-form-item>
        <el-form-item label="阶段">
          <el-select v-model="createForm.stage" style="width: 100%">
            <el-option label="工作草案" value="working_draft" />
            <el-option label="征求意见稿" value="comment_draft" />
            <el-option label="送审讨论稿" value="review_discussion_draft" />
            <el-option label="送审稿" value="review_draft" />
            <el-option label="报批稿" value="approval_draft" />
            <el-option label="公示稿" value="public_draft" />
            <el-option label="发布稿" value="published" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="createForm.note"
            type="textarea"
            :rows="3"
            placeholder="版本变更说明（可选）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateVersion" :loading="creating">确定</el-button>
      </template>
    </el-dialog>

    <!-- 预览对话框 -->
    <el-dialog
      v-model="showPreview"
      :title="`版本预览 — v${previewVersionData?.versionNo || ''}`"
      width="80%"
      append-to-body
      class="preview-dialog"
    >
      <div class="preview-meta" v-if="previewVersionData">
        <span>阶段：{{ stageLabel(previewVersionData.stage) }}</span>
        <span v-if="sourceLabel(previewVersionData.source)">
          来源：{{ sourceLabel(previewVersionData.source) }}<template v-if="previewVersionData.client">（{{ previewVersionData.client }}）</template>
        </span>
        <span>时间：{{ formatTime(previewVersionData.createdAt) }}</span>
        <span v-if="previewVersionData.note">备注：{{ previewVersionData.note }}</span>
      </div>
      <div class="preview-content" ref="previewContainer"></div>
    </el-dialog>

    <!-- 差异比对对话框 -->
    <el-dialog
      v-model="showDiff"
      :title="aiChangeVersion ? '本次 AI 修改' : '版本差异比对'"
      width="85%"
      append-to-body
      class="diff-dialog"
    >
      <!-- 查看 AI 修改：baseContent（写入前）→ content（写入后），只含这一批修改 -->
      <div class="diff-header" v-if="aiChangeVersion" data-testid="ai-change-header">
        <div class="diff-version old">
          <span class="diff-label">修改前</span>
          AI 写入前的内容
        </div>
        <span class="diff-arrow">→</span>
        <div class="diff-version new">
          <span class="diff-label">修改后</span>
          v{{ aiChangeVersion.versionNo }}
          <el-tag size="small" type="warning" effect="dark">{{ sourceLabel(aiChangeVersion.source) }}</el-tag>
          <span v-if="aiChangeVersion.client">{{ aiChangeVersion.client }}</span>
          <span class="diff-time">{{ formatTime(aiChangeVersion.createdAt) }}</span>
        </div>
      </div>
      <div class="diff-note" v-if="aiChangeVersion?.note">{{ aiChangeVersion.note }}</div>
      <div class="diff-header" v-if="diffVersions">
        <div class="diff-version old">
          <span class="diff-label">旧版本</span>
          v{{ diffVersions.old.versionNo }}
          <el-tag size="small" effect="plain" :type="stageTagType(diffVersions.old.stage)">
            {{ stageLabel(diffVersions.old.stage) }}
          </el-tag>
          <span class="diff-time">{{ formatTime(diffVersions.old.createdAt) }}</span>
        </div>
        <span class="diff-arrow">→</span>
        <div class="diff-version new">
          <span class="diff-label">新版本</span>
          v{{ diffVersions.new.versionNo }}
          <el-tag size="small" effect="plain" :type="stageTagType(diffVersions.new.stage)">
            {{ stageLabel(diffVersions.new.stage) }}
          </el-tag>
          <span class="diff-time">{{ formatTime(diffVersions.new.createdAt) }}</span>
        </div>
      </div>

      <div class="diff-stats" v-if="diffResult">
        <span class="stat-added">+{{ diffResult.stats.added }} 新增</span>
        <span class="stat-removed">-{{ diffResult.stats.removed }} 删除</span>
        <span class="stat-unchanged">{{ diffResult.stats.unchanged }} 未变</span>
        <el-checkbox v-if="aiChangeVersion" v-model="collapseUnchanged" size="small">仅显示修改处及上下文</el-checkbox>
      </div>

      <div class="diff-content" v-if="diffResult">
        <template v-for="(row, idx) in diffRows" :key="idx">
          <div v-if="row.type === 'skipped'" class="diff-line skipped">
            <span class="line-text">… 省略 {{ row.count }} 行未变内容 …</span>
          </div>
          <div v-else class="diff-line" :class="row.type">
            <span class="line-no old-no">{{ row.oldLineNo ?? '' }}</span>
            <span class="line-no new-no">{{ row.newLineNo ?? '' }}</span>
            <span class="line-prefix">{{ linePrefixChar(row.type) }}</span>
            <span class="line-text">{{ row.text }}</span>
          </div>
        </template>
        <div v-if="diffResult.lines.length === 0" class="diff-empty">
          两个版本完全相同，没有差异。
        </div>
        <div v-else-if="aiChangeVersion && diffResult.stats.added + diffResult.stats.removed === 0" class="diff-empty">
          此次修改没有改变可比较的文本内容（可能只涉及结构或属性）。
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useVersionStore } from '@/stores/version'
import { useDocumentStore } from '@/stores/document'
import { serializeToXml } from '@/serializer'
import { XmlFootnoteValidationError } from '@/serializer/xmlSerializer'
import { diffDocuments, type DiffLine, type DiffResult } from '@/utils/docDiff'
import { isRevisionConflict } from '@/utils/documentConflict'
import type { VersionData, VersionSource } from '@/api/version'

const props = defineProps<{
  documentId: number
  /** 获取当前编辑器内容的回调 */
  getContent: () => Record<string, unknown>
  /** 获取编辑器 ProseMirror doc 用于 XML 序列化 */
  getDoc: () => unknown | null
  /** 设置编辑器内容的回调 */
  setContent: (content: Record<string, unknown>) => void
}>()

const emit = defineEmits<{
  close: []
  /** 保存版本时发现文档已被他处修改（409），编辑器内容没有写入文档 */
  conflict: []
}>()

const versionStore = useVersionStore()
const documentStore = useDocumentStore()

const showCreateDialog = ref(false)
const showPreview = ref(false)
const showDiff = ref(false)
const creating = ref(false)
const previewContainer = ref<HTMLElement | null>(null)
const previewVersionData = ref<VersionData | null>(null)
const selectedVersionIds = ref<number[]>([])

const diffVersions = ref<{ old: VersionData; new: VersionData } | null>(null)
const diffResult = ref<DiffResult | null>(null)
/** 非空表示差异对话框正在展示这一批 AI 修改（baseContent → content），而不是两个版本的比较 */
const aiChangeVersion = ref<VersionData | null>(null)
const collapseUnchanged = ref(true)

const createForm = reactive({
  versionNo: '',
  stage: documentStore.currentDocument?.stage || 'working_draft',
  note: '',
})

/** 最近一次自动建议的版本号：表单里仍是它，说明用户没有手动改过，可以随最新列表更新。 */
let suggestedVersionNo = ''

function suggestVersionNo() {
  suggestedVersionNo = versionStore.getNextVersionNo()
  createForm.versionNo = suggestedVersionNo
}

function openCreateDialog() {
  // 面板打开期间列表可能被 AI 写入刷新过：没手动改过版本号时按最新列表重新建议。
  if (createForm.versionNo === suggestedVersionNo) suggestVersionNo()
  showCreateDialog.value = true
}

onMounted(async () => {
  await versionStore.fetchVersions(props.documentId)
  suggestVersionNo()
  void probeAiVersions()
})

// 列表被后台刷新（收到 AI 写入的推送）后，新出现的 AI 版本也要探测。
watch(() => versionStore.sortedVersions, () => { void probeAiVersions() })

/**
 * 版本列表不返回 baseContent（体积），只有详情接口返回。AI 版本逐个拉取详情，
 * 记下有没有写入前的内容：没有的（旧数据）不提供「查看本次修改」「回滚到修改前」。
 * 同时最多 3 个请求；探测失败的下次列表变化时再试。
 */
const aiBaseAvailable = ref<Record<number, boolean>>({})
const probingAiVersions = new Set<number>()

function hasBaseContent(version?: VersionData | null): boolean {
  return Boolean(version?.baseContent) && typeof version!.baseContent === 'object'
}

async function probeAiVersions() {
  const queue = versionStore.sortedVersions
    .filter((version) => version.source === 'ai' && version.id != null
      && !hasBaseContent(version) && !(version.id in aiBaseAvailable.value) && !probingAiVersions.has(version.id))
    .map((version) => version.id!)
  queue.forEach((id) => probingAiVersions.add(id))
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        aiBaseAvailable.value[id] = hasBaseContent(await versionStore.fetchVersion(id))
      } catch {
        // 探测失败：保持未知（不显示操作），下次列表变化时重试。
      } finally {
        probingAiVersions.delete(id)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
}

function canInspectAiChange(version: VersionData): boolean {
  return version.source === 'ai' && (hasBaseContent(version) || aiBaseAvailable.value[version.id!] === true)
}

type DiffRow = DiffLine | { type: 'skipped'; count: number }
const DIFF_CONTEXT_LINES = 2

/** 查看 AI 修改时默认折叠远离修改处的未变行；两版本比较保持原样全部显示。 */
const diffRows = computed<DiffRow[]>(() => {
  const lines = diffResult.value?.lines ?? []
  if (!aiChangeVersion.value || !collapseUnchanged.value) return lines
  const keep = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.type === 'unchanged') return
    const from = Math.max(0, index - DIFF_CONTEXT_LINES)
    const to = Math.min(lines.length - 1, index + DIFF_CONTEXT_LINES)
    for (let i = from; i <= to; i += 1) keep[i] = true
  })
  const rows: DiffRow[] = []
  let skipped = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) rows.push({ type: 'skipped', count: skipped })
      skipped = 0
      rows.push(line)
    } else {
      skipped += 1
    }
  })
  if (skipped > 0) rows.push({ type: 'skipped', count: skipped })
  return rows
})

/** 阶段显示标签 */
const stageLabels: Record<string, string> = {
  working_draft: '工作草案',
  comment_draft: '征求意见稿',
  review_discussion_draft: '送审讨论稿',
  review_draft: '送审稿',
  approval_draft: '报批稿',
  public_draft: '公示稿',
  published: '发布稿',
}

function stageLabel(stage: string): string {
  return stageLabels[stage] || stage
}

/** 非人工来源才显示标签；旧数据没有 source 时按 human 处理 */
const sourceLabels: Partial<Record<VersionSource, string>> = {
  ai: 'AI 修改',
  import: '导入',
}

function sourceLabel(source?: VersionSource): string {
  return source ? sourceLabels[source] ?? '' : ''
}

function stageTagType(stage: string): '' | 'success' | 'warning' | 'danger' | 'info' {
  const map: Record<string, '' | 'success' | 'warning' | 'danger' | 'info'> = {
    working_draft: 'info',
    comment_draft: '',
    review_discussion_draft: 'warning',
    review_draft: 'warning',
    approval_draft: '',
    public_draft: '',
    published: 'success',
  }
  return map[stage] || 'info'
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function linePrefixChar(type: string): string {
  if (type === 'added') return '+'
  if (type === 'removed') return '-'
  return ' '
}

/** 选中/取消选中版本 */
function toggleSelect(version: VersionData) {
  const id = version.id!
  const idx = selectedVersionIds.value.indexOf(id)
  if (idx >= 0) {
    selectedVersionIds.value.splice(idx, 1)
  } else {
    if (selectedVersionIds.value.length >= 2) {
      selectedVersionIds.value.shift()
    }
    selectedVersionIds.value.push(id)
  }
}

/**
 * 创建版本快照。整个流程（取内容 → 保存版本 → 把同一份内容写回文档）登记为该文档的一次本地写入：
 * 排在已有的自动保存之后执行，期间编辑器的 waitForPendingUpdates 不会返回，因此 AI 等外部写入到达时
 * 不会在中途被自动载入、也不会把本地 revision 前移到「内容仍是旧的」状态。
 * 外部写入发生在保存期间时，写回文档的 PUT 必然 409，走冲突分支，不会静默覆盖外部修改。
 */
async function handleCreateVersion() {
  if (!createForm.versionNo.trim()) {
    ElMessage.warning('请输入版本号')
    return
  }

  // 表单取点击确定时的值：排队等待期间用户可能还在改表单，但保存的是点击时确认的那一份。
  const { versionNo, stage, note } = createForm
  creating.value = true
  try {
    const saved = await documentStore.runDocumentWrite(props.documentId, async (put) => {
      // 轮到这次写入时才读取编辑器内容：前面排队的自动保存已结束，拿到的是最新的本地内容。
      const content = props.getContent()
      let xml: string | undefined
      try {
        const doc = props.getDoc()
        if (doc && typeof (doc as { toString: () => string }).toString === 'function') {
          // 尝试使用 ProseMirror doc 序列化 XML
          xml = serializeToXml(doc as Parameters<typeof serializeToXml>[0])
        }
      } catch (error) {
        if (error instanceof XmlFootnoteValidationError) throw error
        // Preserve legacy fallback for other XML failures; invalid footnote links block saving.
      }

      await versionStore.createVersion({
        documentId: props.documentId,
        versionNo,
        stage,
        content,
        xml,
        note: note || undefined,
        source: 'human',
      })

      try {
        await put({ content })
      } catch (error) {
        if (!isRevisionConflict(error)) throw error
        // 版本快照已保存，但文档在别处被改过，编辑器内容没有写入文档：交给编辑器的冲突处理。
        // 在写入任务结束之前就通知编辑器，这样它等到本地写入落定后处理外部修改时，已经处于冲突状态。
        showCreateDialog.value = false
        suggestVersionNo()
        createForm.note = ''
        ElMessage.warning('版本已保存，但文档已在其他地方被修改，当前编辑内容未保存')
        emit('conflict')
        return false
      }
      return true
    })
    if (!saved) return

    showCreateDialog.value = false
    suggestVersionNo()
    createForm.note = ''
    ElMessage.success('版本保存成功')
  } catch (e) {
    ElMessage.error(`版本保存失败: ${e}`)
  } finally {
    creating.value = false
  }
}

/** 预览版本 */
async function previewVersion(version: VersionData) {
  try {
    const fullVersion = version.content
      ? version
      : await versionStore.fetchVersion(version.id!)
    previewVersionData.value = fullVersion
    showPreview.value = true

    await nextTick()
    if (previewContainer.value && fullVersion.content) {
      // 将 JSON 内容转为纯文本预览
      const { docToText } = await import('@/utils/docDiff')
      const text = docToText(fullVersion.content)
      previewContainer.value.innerHTML = ''
      const pre = document.createElement('pre')
      pre.textContent = text
      pre.style.cssText = 'white-space: pre-wrap; font-size: 13px; line-height: 1.8; font-family: "SimSun", serif; padding: 16px;'
      previewContainer.value.appendChild(pre)
    }
  } catch (e) {
    ElMessage.error(`加载版本失败: ${e}`)
  }
}

/** 回滚前的二次确认。用户取消返回 false；确认框本身出错要让用户看到。 */
async function confirmRollback(message: string): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      message,
      '回滚确认',
      { type: 'warning', confirmButtonText: '确定回滚', cancelButtonText: '取消' },
    )
    return true
  } catch (error) {
    // Element Plus rejects with "cancel" or "close" when the user declines.
    // Other confirmation failures are operational errors and should be visible.
    const reason = error instanceof Error ? error.message : String(error)
    if (reason !== 'cancel' && reason !== 'close') ElMessage.error(`回滚失败: ${reason}`)
    return false
  }
}

/** 读取 AI 版本详情（含写入前内容）；没有写入前内容时提示并不再提供相关操作。 */
async function loadAiChange(version: VersionData): Promise<(VersionData & { baseContent: Record<string, unknown> }) | null> {
  const detail = await versionStore.fetchVersion(version.id!)
  if (!hasBaseContent(detail)) {
    aiBaseAvailable.value[version.id!] = false
    ElMessage.warning('该版本没有保存修改前的内容，无法查看或回滚本次修改')
    return null
  }
  return detail as VersionData & { baseContent: Record<string, unknown> }
}

/** 查看本次 AI 修改：只比较 baseContent → content，不混入其间人的编辑。 */
async function viewAiChange(version: VersionData) {
  try {
    const detail = await loadAiChange(version)
    if (!detail) return
    aiChangeVersion.value = detail
    diffVersions.value = null
    collapseUnchanged.value = true
    diffResult.value = diffDocuments(detail.baseContent, detail.content)
    showDiff.value = true
  } catch (error) {
    ElMessage.error(`加载本次修改失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 回滚到这一批 AI 修改之前：把编辑器内容设为 baseContent，后续经自动保存写回。 */
async function rollbackAiChange(version: VersionData) {
  if (!await confirmRollback(
    `确定要回滚到 AI 修改（v${version.versionNo}）之前的内容吗？`
    + '编辑器内容将替换为修改前的版本，此后的所有修改（包括人工编辑）和当前未保存的内容都会丢失。',
  )) return

  try {
    const detail = await loadAiChange(version)
    if (!detail) return
    props.setContent(detail.baseContent)
    ElMessage.success(`已回滚到 AI 修改（v${version.versionNo}）之前`)
    emit('close')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    ElMessage.error(`回滚失败: ${reason}`)
  }
}

/** 回滚到指定版本 */
async function restoreVersion(version: VersionData) {
  if (!await confirmRollback(`确定要回滚到版本 v${version.versionNo} 吗？当前未保存的编辑内容将丢失。`)) return

  try {
    const fullVersion = version.content
      ? version
      : await versionStore.fetchVersion(version.id!)

    if (!fullVersion.content) throw new Error('版本正文为空')
    props.setContent(fullVersion.content)
    ElMessage.success(`已回滚到版本 v${version.versionNo}`)
    emit('close')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    ElMessage.error(`回滚失败: ${reason}`)
  }
}

/** 比对选中的两个版本 */
async function compareSelected() {
  if (selectedVersionIds.value.length !== 2) return

  try {
    const [id1, id2] = selectedVersionIds.value
    const v1 = versionStore.versions.find(v => v.id === id1)!
    const v2 = versionStore.versions.find(v => v.id === id2)!

    // 加载完整内容
    const full1 = v1.content ? v1 : await versionStore.fetchVersion(id1)
    const full2 = v2.content ? v2 : await versionStore.fetchVersion(id2)

    // 按时间排序：旧的在左，新的在右
    const t1 = new Date(full1.createdAt || 0).getTime()
    const t2 = new Date(full2.createdAt || 0).getTime()
    const [oldVer, newVer] = t1 <= t2 ? [full1, full2] : [full2, full1]

    aiChangeVersion.value = null
    diffVersions.value = { old: oldVer, new: newVer }
    diffResult.value = diffDocuments(oldVer.content, newVer.content)
    showDiff.value = true
  } catch (e) {
    ElMessage.error(`比对失败: ${e}`)
  }
}
</script>

<style scoped>
.version-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.version-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
}

.version-panel-header h3 {
  margin: 0;
  font-size: 15px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.version-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.empty-hint {
  text-align: center;
  color: #999;
  padding: 40px 16px;
  font-size: 13px;
}

.version-item {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.version-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-light);
}

.version-item.selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.version-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.version-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-no {
  font-weight: 600;
  font-size: 14px;
}

.version-time {
  font-size: 12px;
  color: #999;
}

.version-source-tag {
  font-weight: 600;
}

.version-item.is-ai {
  border-left: 3px solid var(--el-color-warning);
}

.version-client {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding-left: 28px;
}

.version-client + .version-note {
  margin-top: 2px;
}

.version-note {
  margin-top: 6px;
  font-size: 12px;
  color: #666;
  padding-left: 28px;
}

.version-actions {
  margin-top: 6px;
  padding-left: 28px;
  display: flex;
  gap: 8px;
}

.version-panel-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--el-border-color);
  text-align: center;
}

.version-panel-footer.hint {
  font-size: 12px;
  color: #999;
}

/* === 差异比对 === */
.diff-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 12px;
  padding: 12px;
  background: #f8f8f8;
  border-radius: 6px;
}

.diff-version {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.diff-label {
  font-weight: 600;
  color: #666;
}

.diff-arrow {
  font-size: 18px;
  color: #999;
}

.diff-time {
  font-size: 12px;
  color: #999;
}

.diff-stats {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-bottom: 12px;
  font-size: 13px;
}

.stat-added { color: #22863a; }
.stat-removed { color: #cb2431; }
.stat-unchanged { color: #999; }

.diff-content {
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid #e1e4e8;
  border-radius: 6px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.diff-line {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid #f0f0f0;
}

.diff-line:last-child {
  border-bottom: none;
}

.diff-line.added {
  background: #e6ffec;
}

.diff-line.removed {
  background: #ffeef0;
}

.diff-line.unchanged {
  background: #fff;
}

.diff-line.skipped {
  background: #f6f8fa;
  color: #999;
  justify-content: center;
}

.diff-note {
  margin-bottom: 12px;
  text-align: center;
  font-size: 13px;
  color: #666;
}

.line-no {
  display: inline-block;
  width: 40px;
  min-width: 40px;
  text-align: right;
  padding: 0 8px;
  color: #bbb;
  border-right: 1px solid #e1e4e8;
  user-select: none;
  font-size: 11px;
}

.line-prefix {
  display: inline-block;
  width: 20px;
  min-width: 20px;
  text-align: center;
  font-weight: bold;
  user-select: none;
}

.added .line-prefix { color: #22863a; }
.removed .line-prefix { color: #cb2431; }

.line-text {
  flex: 1;
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-empty {
  text-align: center;
  padding: 40px;
  color: #999;
}

/* === 预览 === */
.preview-meta {
  display: flex;
  gap: 20px;
  padding: 8px 16px;
  background: #f8f8f8;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #666;
}

.preview-content {
  max-height: 500px;
  overflow-y: auto;
  border: 1px solid #e1e4e8;
  border-radius: 6px;
  background: #fff;
}
</style>
