<template>
  <div class="version-panel">
    <div class="version-panel-header">
      <h3>版本历史</h3>
      <div class="header-actions">
        <el-button size="small" type="primary" @click="showCreateDialog = true">
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
        :class="{ selected: selectedVersionIds.includes(version.id!) }"
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
          </div>
          <span class="version-time">{{ formatTime(version.createdAt) }}</span>
        </div>
        <div v-if="version.note" class="version-note">{{ version.note }}</div>
        <div class="version-actions">
          <el-button link size="small" @click.stop="previewVersion(version)">预览</el-button>
          <el-button link size="small" @click.stop="restoreVersion(version)">回滚</el-button>
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
        <span>时间：{{ formatTime(previewVersionData.createdAt) }}</span>
        <span v-if="previewVersionData.note">备注：{{ previewVersionData.note }}</span>
      </div>
      <div class="preview-content" ref="previewContainer"></div>
    </el-dialog>

    <!-- 差异比对对话框 -->
    <el-dialog
      v-model="showDiff"
      title="版本差异比对"
      width="85%"
      append-to-body
      class="diff-dialog"
    >
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
      </div>

      <div class="diff-content" v-if="diffResult">
        <div
          v-for="(line, idx) in diffResult.lines"
          :key="idx"
          class="diff-line"
          :class="line.type"
        >
          <span class="line-no old-no">{{ line.oldLineNo ?? '' }}</span>
          <span class="line-no new-no">{{ line.newLineNo ?? '' }}</span>
          <span class="line-prefix">{{ linePrefixChar(line.type) }}</span>
          <span class="line-text">{{ line.text }}</span>
        </div>
        <div v-if="diffResult.lines.length === 0" class="diff-empty">
          两个版本完全相同，没有差异。
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useVersionStore } from '@/stores/version'
import { useDocumentStore } from '@/stores/document'
import { serializeToXml } from '@/serializer'
import { XmlFootnoteValidationError } from '@/serializer/xmlSerializer'
import { diffDocuments, type DiffResult } from '@/utils/docDiff'
import type { VersionData } from '@/api/version'

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

const createForm = reactive({
  versionNo: '',
  stage: documentStore.currentDocument?.stage || 'working_draft',
  note: '',
})

onMounted(async () => {
  await versionStore.fetchVersions(props.documentId)
  createForm.versionNo = versionStore.getNextVersionNo()
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

/** 创建版本快照 */
async function handleCreateVersion() {
  if (!createForm.versionNo.trim()) {
    ElMessage.warning('请输入版本号')
    return
  }

  creating.value = true
  try {
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
      versionNo: createForm.versionNo,
      stage: createForm.stage,
      content,
      xml,
      note: createForm.note || undefined,
    })

    await documentStore.updateDocument(props.documentId, { content })

    showCreateDialog.value = false
    createForm.versionNo = versionStore.getNextVersionNo()
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

/** 回滚到指定版本 */
async function restoreVersion(version: VersionData) {
  try {
    await ElMessageBox.confirm(
      `确定要回滚到版本 v${version.versionNo} 吗？当前未保存的编辑内容将丢失。`,
      '回滚确认',
      { type: 'warning', confirmButtonText: '确定回滚', cancelButtonText: '取消' },
    )

    const fullVersion = version.content
      ? version
      : await versionStore.fetchVersion(version.id!)

    if (fullVersion.content) {
      props.setContent(fullVersion.content)
      ElMessage.success(`已回滚到版本 v${version.versionNo}`)
      emit('close')
    }
  } catch {
    // 用户取消
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
