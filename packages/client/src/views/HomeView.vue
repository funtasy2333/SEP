<template>
  <div class="home-page">
    <HomeNav :active-tab="navTab" :tabs="navTabs" @select-tab="selectTab" />

    <main class="home-body">
      <!-- Page head -->
      <div class="home-head">
        <div>
          <h1>{{ isTrashView ? '回收站' : '标准库' }}</h1>
          <p class="sub">
            <template v-if="isTrashView">{{ store.trashDocuments.length }} 份已移入回收站的文件；可恢复，或永久删除</template>
            <template v-else>共 {{ store.documents.length }} 份文件<template v-if="lastSaved"> · 最近更新于 {{ lastSaved }}</template></template>
          </p>
        </div>
        <div class="actions">
          <template v-if="isTrashView">
            <el-button
              type="danger"
              :disabled="store.trashDocuments.length === 0 || trashActionId !== null || emptyingTrash"
              :loading="emptyingTrash"
              @click="handleEmptyTrash"
            >清空回收站</el-button>
          </template>
          <template v-else>
            <el-button :disabled="sesImportBusy" @click="triggerSesImport">导入 .ses</el-button>
            <el-dropdown split-button type="primary" trigger="click" @click="openNewDoc()" @command="openNewDoc">
              <span class="new-doc-label"><el-icon><Plus /></el-icon>新建标准文件</span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="t in TYPE_DEFS" :key="t.id" :command="t.id">新建{{ t.name }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </div>

      <section v-if="isTrashView" class="trash-view" aria-label="回收站文档">
        <el-table
          v-loading="store.trashLoading"
          :data="store.trashDocuments"
          row-key="id"
          empty-text="回收站为空"
          class="doc-list-table"
        >
          <el-table-column prop="meta.standardNo" label="标准编号" width="180">
            <template #default="{ row }">
              <span class="trash-standard-no">{{ row.meta?.standardNo || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="文件题名" min-width="240">
            <template #default="{ row }">
              <span class="trash-title">{{ row.meta?.titleCn || row.title }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型 / 阶段" width="200">
            <template #default="{ row }">
              <span>{{ TYPE_LABELS[row.meta?.standardType] || '—' }} · {{ STAGE_LABELS[row.stage] || row.stage }}</span>
            </template>
          </el-table-column>
          <el-table-column label="删除时间" width="190">
            <template #default="{ row }"><span>{{ formatDate(row.deletedAt) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button
                type="primary"
                text
                size="small"
                :disabled="trashActionId !== null || emptyingTrash"
                :loading="trashActionId === row.id && trashAction === 'restore'"
                @click.stop="handleRestore(row)"
              >恢复</el-button>
              <el-button
                type="danger"
                text
                size="small"
                :disabled="trashActionId !== null || emptyingTrash"
                :loading="trashActionId === row.id && trashAction === 'permanent'"
                @click.stop="handlePermanentDelete(row)"
              >永久删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 标准库为空：直接给出按类型新建的入口 -->
      <section v-else-if="libraryEmpty" class="welcome" aria-label="开始起草">
        <h2>开始起草第一份标准</h2>
        <p>选择标准类型，系统按 GB/T 1.1—2020 生成封面、前言和章条骨架；编号与题名之后可在“文件设置”中修改。</p>
        <TemplateRail @pick="openNewDoc" />
      </section>

      <template v-else>
        <!-- 编制阶段概览：真实数量，点击筛选 -->
        <StageOverview :counts="stageCounts" :total="store.documents.length" :active="stageFilter" @select="stageFilter = $event" />

        <!-- 查找、类型筛选与视图 -->
        <div class="list-toolbar">
          <el-input
            ref="searchInput"
            v-model="searchText"
            class="list-search"
            placeholder="搜索标准编号或题名（Ctrl/⌘ K）"
            :prefix-icon="Search"
            clearable
          />
          <div class="list-toolbar-l" role="group" aria-label="按标准类型筛选">
            <button
              v-for="t in typeFilters"
              :key="t.id"
              class="chip"
              type="button"
              :class="{ 'is-active': typeFilter === t.id }"
              :aria-pressed="typeFilter === t.id"
              @click="typeFilter = t.id"
            >
              {{ t.label }}
              <span class="count">{{ counts[t.id] || 0 }}</span>
            </button>
          </div>
          <div class="list-toolbar-r">
            <el-select v-model="sort" size="default" class="sort-select" aria-label="排序">
              <el-option value="updated" label="最近更新" />
              <el-option value="title" label="按题名" />
              <el-option value="stage" label="按编制阶段" />
            </el-select>
            <div class="view-toggle" role="group" aria-label="显示方式">
              <button type="button" :class="{ 'is-active': view === 'grid' }" :aria-pressed="view === 'grid'" title="卡片" @click="setView('grid')">
                <el-icon><Grid /></el-icon><span>卡片</span>
              </button>
              <button type="button" :class="{ 'is-active': view === 'list' }" :aria-pressed="view === 'list'" title="列表" @click="setView('list')">
                <el-icon><List /></el-icon><span>列表</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="filtersActive" class="filter-summary">
          <span>显示 {{ filtered.length }} / {{ store.documents.length }} 份</span>
          <button type="button" class="link-btn" @click="clearFilters">清除筛选</button>
        </div>

        <!-- Content -->
        <div v-if="filtered.length === 0" class="empty-state">
          <el-icon :size="36"><Document /></el-icon>
          <h3>没有匹配的文件</h3>
          <p>换个关键词或筛选条件试试。</p>
          <el-button @click="clearFilters">清除筛选</el-button>
        </div>

        <div v-else-if="view === 'grid'" class="doc-grid">
          <DocCard
            v-for="d in filtered"
            :key="d.id"
            :doc="d"
            @open="openDocument"
            @delete="handleDelete"
            @duplicate="handleDuplicate"
          />
        </div>

        <el-table
          v-else
          v-loading="store.loading"
          :data="filtered"
          :show-header="true"
          row-class-name="doc-list-row"
          @row-click="openDocument"
          class="doc-list-table"
        >
          <el-table-column prop="meta.standardNo" label="标准编号" width="180">
            <template #default="{ row }">
              <span class="list-std-no">{{ row.meta?.standardNo || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="文件题名" min-width="240">
            <template #default="{ row }">
              <span class="list-title">{{ row.meta?.titleCn || row.title }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="130">
            <template #default="{ row }">
              <span class="ses-type-chip" :data-type="row.meta?.standardType">
                {{ TYPE_LABELS[row.meta?.standardType] || '—' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="阶段" width="130">
            <template #default="{ row }">
              <span class="ses-stage" :class="row.stage">
                <span class="dot" />
                {{ STAGE_LABELS[row.stage] || row.stage }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">
              <span class="list-time">{{ formatDate(row.updatedAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" @click.stop="handleDuplicate(row)">复制</el-button>
              <el-button type="danger" text size="small" @click.stop="handleDelete(row)">移入回收站</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </main>

    <input
      ref="sesImportInput"
      class="ses-import-input"
      type="file"
      accept=".ses"
      hidden
      @change="handleSesFileChange"
    />

    <NewDocDialog v-model="newDocOpen" :initial-type="newDocType" @create="handleCreate" />

    <el-dialog
      v-model="sesImportDialogVisible"
      :title="sesImportPrompt?.kind === 'trash' ? '文档位于回收站' : '发现本地已有同一文档'"
      width="520px"
      class="ses-import-dialog"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      @close="finishSesImportChoice(null)"
      @opened="focusDefaultSesImportAction"
    >
      <p v-if="sesImportPreview?.match" class="ses-import-title">
        本地文档：<strong>{{ sesImportPreview.match.title }}</strong>
      </p>
      <p v-for="(detail, index) in sesImportPrompt?.details || []" :key="index" class="ses-import-detail">
        {{ detail }}
      </p>
      <p v-if="sesImportPrompt?.kind === 'match'" class="ses-import-recommendation">推荐操作：更新现有文档。</p>
      <template #footer>
        <template v-if="sesImportPrompt?.kind === 'trash'">
          <el-button :disabled="sesImportApplying" @click="finishSesImportChoice(null)">取消</el-button>
          <el-button ref="sesImportCopyButton" type="primary" autofocus :disabled="sesImportApplying" @click="finishSesImportChoice('new')">另存为新文档</el-button>
        </template>
        <template v-else>
          <el-button ref="sesImportUpdateButton" type="primary" autofocus :disabled="sesImportApplying" @click="finishSesImportChoice('update')">更新现有文档</el-button>
          <el-button :disabled="sesImportApplying" @click="finishSesImportChoice('new')">另存为新文档</el-button>
          <el-button :disabled="sesImportApplying" @click="finishSesImportChoice(null)">取消</el-button>
        </template>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Grid, List, Document, Search } from '@element-plus/icons-vue'
import type { InputInstance } from 'element-plus'

import { useDocumentStore } from '@/stores/document'
import { documentApi, type DocumentData, type SesImportPreview, type TrashDocumentData } from '@/api/document'
import { createNewDocument, type NewDocForm } from '@/utils/newDocument'
import { createDocumentDuplicate } from '@/utils/duplicateDocument'
import { sesImportErrorMessage, sesImportPromptOf, sesImportStatus, type SesImportPrompt } from '@/utils/sesPackageImport'
import { STAGES, STAGE_LABELS, TYPE_DEFS, TYPE_LABELS } from '@/constants/standards'

import HomeNav from '@/components/home/HomeNav.vue'
import StageOverview from '@/components/home/StageOverview.vue'
import TemplateRail from '@/components/home/TemplateRail.vue'
import DocCard from '@/components/home/DocCard.vue'
import NewDocDialog from '@/components/home/NewDocDialog.vue'

const router = useRouter()
const store = useDocumentStore()

const navTab = ref('all')
const typeFilter = ref('all')
const stageFilter = ref<'all' | string>('all')
const sort = ref<'updated' | 'title' | 'stage'>('updated')
const VIEW_STORAGE_KEY = 'ses.home.view'
const view = ref<'grid' | 'list'>(readStoredView())
const searchText = ref('')
const searchInput = ref<InputInstance>()
const newDocOpen = ref(false)
const newDocType = ref<string | undefined>(undefined)
const trashActionId = ref<number | null>(null)
const trashAction = ref<'restore' | 'permanent' | null>(null)
const emptyingTrash = ref(false)
const isTrashView = computed(() => navTab.value === 'trash')
const sesImportInput = ref<HTMLInputElement | null>(null)
const sesImportBusy = ref(false)
const sesImportApplying = ref(false)
const sesImportDialogVisible = ref(false)
const sesImportPreview = ref<SesImportPreview | null>(null)
const sesImportPrompt = ref<SesImportPrompt | null>(null)
let sesImportResolver: ((choice: 'update' | 'new' | null) => void) | null = null
let sesImportStopped = false
type FocusableButtonRef = { $el?: { focus?: () => void } }
const sesImportUpdateButton = ref<FocusableButtonRef | null>(null)
const sesImportCopyButton = ref<FocusableButtonRef | null>(null)

watch(sesImportDialogVisible, (visible) => {
  if (visible || !sesImportResolver) return
  const resolve = sesImportResolver
  sesImportResolver = null
  sesImportPreview.value = null
  sesImportPrompt.value = null
  resolve(null)
})

const typeFilters = [
  { id: 'all', label: '全部' },
  { id: 'national', label: '国家' },
  { id: 'industry', label: '行业' },
  { id: 'local', label: '地方' },
  { id: 'group', label: '团体' },
  { id: 'enterprise', label: '企业' },
  { id: 'guidance', label: '指导性' },
]

const counts = computed(() => {
  const r: Record<string, number> = { all: store.documents.length }
  for (const d of store.documents) {
    const t = d.meta?.standardType || 'other'
    r[t] = (r[t] || 0) + 1
  }
  return r
})

const stageCounts = computed(() => {
  const r: Record<string, number> = {}
  for (const d of store.documents) r[d.stage] = (r[d.stage] || 0) + 1
  return r
})

const libraryEmpty = computed(() => !store.loading && store.documents.length === 0)
const filtersActive = computed(() => typeFilter.value !== 'all' || stageFilter.value !== 'all' || searchText.value.trim() !== '')

const stageOrder = (stage: string) => {
  const index = (STAGES as readonly string[]).indexOf(stage)
  return index === -1 ? STAGES.length : index
}

const filtered = computed(() => {
  let arr = [...store.documents]
  if (typeFilter.value !== 'all') {
    arr = arr.filter((d) => d.meta?.standardType === typeFilter.value)
  }
  if (stageFilter.value !== 'all') {
    arr = arr.filter((d) => d.stage === stageFilter.value)
  }
  const keyword = searchText.value.trim().toLowerCase()
  if (keyword) {
    arr = arr.filter((d) => [d.meta?.standardNo, d.meta?.titleCn, d.meta?.titleEn, d.title]
      .some((field) => field?.toLowerCase().includes(keyword)))
  }
  if (sort.value === 'title') {
    arr.sort((a, b) => (a.meta?.titleCn || a.title).localeCompare(b.meta?.titleCn || b.title, 'zh-CN'))
  } else if (sort.value === 'stage') {
    arr.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage))
  } else {
    arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  }
  return arr
})

function clearFilters() {
  typeFilter.value = 'all'
  stageFilter.value = 'all'
  searchText.value = ''
}

function readStoredView(): 'grid' | 'list' {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function setView(next: 'grid' | 'list') {
  view.value = next
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, next)
  } catch {
    // 浏览器禁用存储时只影响偏好记忆
  }
}

function focusSearchShortcut(event: KeyboardEvent) {
  if (isTrashView.value || libraryEmpty.value) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchInput.value?.focus()
  }
}

const navTabs = computed(() => [
  { id: 'all',   label: '标准库', count: store.documents.length },
  { id: 'trash', label: '回收站', count: store.trashDocuments.length },
])

const lastSaved = computed(() => {
  const arr = store.documents
    .map((d) => d.updatedAt)
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => b.localeCompare(a))
  if (!arr[0]) return ''
  const date = new Date(arr[0])
  return date.toLocaleString('zh-CN')
})

onMounted(() => {
  window.addEventListener('keydown', focusSearchShortcut)
  void store.fetchDocuments().catch((error) => {
    ElMessage.error(`标准库加载失败${error instanceof Error ? `：${error.message}` : ''}`)
  })
  void store.fetchTrash().catch((error) => {
    ElMessage.warning(`回收站数量刷新失败${error instanceof Error ? `：${error.message}` : ''}`)
  })
})

onBeforeUnmount(() => {
  sesImportStopped = true
  window.removeEventListener('keydown', focusSearchShortcut)
  if (sesImportResolver) finishSesImportChoice(null)
})

async function selectTab(tab: string) {
  navTab.value = tab
  if (tab !== 'trash') return
  try {
    await store.fetchTrash()
  } catch (error) {
    ElMessage.error(`回收站加载失败${error instanceof Error ? `：${error.message}` : ''}`)
  }
}

function openNewDoc(type?: string) {
  newDocType.value = type
  newDocOpen.value = true
}

async function handleCreate(form: NewDocForm) {
  const doc = await store.createDocument(createNewDocument(form))
  newDocOpen.value = false
  ElMessage.success('创建成功')
  router.push({ name: 'editor', params: { id: doc.id! } })
}

function openDocument(row: DocumentData) {
  router.push({ name: 'editor', params: { id: row.id! } })
}

async function handleDelete(row: DocumentData) {
  try {
    await ElMessageBox.confirm(
      `“${row.meta?.titleCn || row.title}”将移入回收站；正文和版本历史会保留，可之后恢复。`,
      '移入回收站？',
      { confirmButtonText: '移入回收站', cancelButtonText: '取消', type: 'warning' },
    )
  } catch (error) {
    if (!isConfirmationCancel(error)) ElMessage.error(`删除确认失败：${errorText(error)}`)
    return
  }
  try {
    await store.deleteDocument(row.id!)
    ElMessage.success('已移入回收站')
    // Refresh the nav count and summary; failure here does not undo the successful soft delete.
    void store.fetchTrash().catch((error) => {
      ElMessage.warning(`已移入回收站，但数量刷新失败：${errorText(error)}`)
    })
  } catch (error) {
    ElMessage.error(`移入回收站失败：${errorText(error)}`)
  }
}

async function handleRestore(row: TrashDocumentData) {
  if (trashActionId.value !== null || emptyingTrash.value) return
  trashActionId.value = row.id
  trashAction.value = 'restore'
  try {
    await store.restoreDocument(row.id)
    ElMessage.success('文档已恢复到标准库')
  } catch (error) {
    ElMessage.error(`恢复失败：${errorText(error)}`)
  } finally {
    trashActionId.value = null
    trashAction.value = null
  }
}

async function handlePermanentDelete(row: TrashDocumentData) {
  if (trashActionId.value !== null || emptyingTrash.value) return
  trashActionId.value = row.id
  trashAction.value = 'permanent'
  try {
    await ElMessageBox.confirm(
      `永久删除“${row.meta?.titleCn || row.title}”会同时清除全部版本历史，无法恢复。`,
      '永久删除？',
      { confirmButtonText: '永久删除', cancelButtonText: '取消', type: 'warning' },
    )
    await store.permanentlyDeleteDocument(row.id, row.revision)
    ElMessage.success('文档及其版本历史已永久删除')
  } catch (error) {
    if (!isConfirmationCancel(error)) ElMessage.error(`永久删除失败：${errorText(error)}`)
  } finally {
    trashActionId.value = null
    trashAction.value = null
  }
}

async function handleEmptyTrash() {
  if (emptyingTrash.value || trashActionId.value !== null || store.trashDocuments.length === 0) return
  const snapshot = store.trashDocuments.map(({ id, revision }) => ({ id, revision }))
  emptyingTrash.value = true
  try {
    await ElMessageBox.confirm(
      `清空回收站会永久删除当前列出的 ${snapshot.length} 份文件及全部版本历史，无法恢复。`,
      '清空回收站？',
      { confirmButtonText: '清空回收站', cancelButtonText: '取消', type: 'warning' },
    )
    // Freeze the visible rows when the confirmation opens. Rows arriving while it is open remain in the bin.
    await store.emptyTrash(snapshot)
    ElMessage.success(`已永久删除 ${snapshot.length} 份文件及其版本历史`)
  } catch (error) {
    if (!isConfirmationCancel(error)) ElMessage.error(`清空回收站失败：${errorText(error)}`)
  } finally {
    emptyingTrash.value = false
  }
}

function isConfirmationCancel(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error)
  return reason === 'cancel' || reason === 'close'
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function handleDuplicate(row: DocumentData) {
  const copy = await store.createDocument(createDocumentDuplicate(row))
  ElMessage.success('已复制')
  router.push({ name: 'editor', params: { id: copy.id! } })
}

function triggerSesImport() {
  if (sesImportBusy.value || isTrashView.value || !sesImportInput.value) return
  // 即使上一次文件选择器被取消，也允许再次选择同一个文件。
  sesImportInput.value.value = ''
  sesImportInput.value.click()
}

function askSesImportChoice(preview: SesImportPreview, prompt: SesImportPrompt): Promise<'update' | 'new' | null> {
  sesImportPreview.value = preview
  sesImportPrompt.value = prompt
  sesImportDialogVisible.value = true
  return new Promise((resolve) => { sesImportResolver = resolve })
}

function finishSesImportChoice(choice: 'update' | 'new' | null) {
  const resolve = sesImportResolver
  sesImportResolver = null
  sesImportDialogVisible.value = false
  if (!choice) {
    sesImportPreview.value = null
    sesImportPrompt.value = null
  }
  resolve?.(choice)
}

function focusDefaultSesImportAction() {
  const button = sesImportPrompt.value?.kind === 'trash'
    ? sesImportCopyButton.value
    : sesImportUpdateButton.value
  button?.$el?.focus?.()
}

async function completeSesImport(document: DocumentData) {
  if (sesImportStopped) return
  ElMessage.success('SES 文档包已导入')
  router.push({ name: 'editor', params: { id: document.id! } })
  // 导入已成功；列表刷新只更新首页摘要，失败不应改写导入结果。
  void store.fetchDocuments().catch(async (error) => {
    ElMessage.warning(`文档已导入，但标准库列表刷新失败：${await sesImportErrorMessage(error)}`)
  })
}

async function handleSesFileChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (!file || sesImportBusy.value || isTrashView.value) {
    input.value = ''
    return
  }

  sesImportBusy.value = true
  try {
    const preview = await documentApi.previewSesImport(file)
    if (sesImportStopped) return
    const prompt = sesImportPromptOf(preview)
    if (prompt.kind === 'new') {
      const imported = await documentApi.importSesPackage(file, 'new')
      await completeSesImport(imported)
      return
    }

    const choice = await askSesImportChoice(preview, prompt)
    if (!choice || sesImportStopped) return
    sesImportApplying.value = true
    const target = choice === 'update' && preview.match
      ? { targetId: preview.match.id, baseRevision: preview.match.revision }
      : undefined
    const imported = choice === 'new'
      ? await documentApi.importSesPackage(file, 'new')
      : await documentApi.importSesPackage(file, 'update', target!)
    await completeSesImport(imported)
  } catch (error) {
    if (sesImportStatus(error) === 409) {
      ElMessage.error('该文档在你确认期间被修改，请重新导入')
    } else {
      ElMessage.error(await sesImportErrorMessage(error))
    }
  } finally {
    input.value = ''
    sesImportBusy.value = false
    sesImportApplying.value = false
  }
}

function formatDate(s?: string) {
  if (!s) return ''
  return new Date(s).toLocaleString('zh-CN')
}
</script>

<style scoped>
.home-page {
  min-height: 100vh;
  display: flex; flex-direction: column;
  background: var(--ses-bg);
}
.home-body {
  max-width: 1240px;
  width: 100%;
  margin: 0 auto;
  padding: 28px 32px 80px;
  flex: 1;
}

.home-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 16px;
  margin-bottom: 20px;
}
.home-head h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.01em;
  margin: 0 0 6px;
  color: var(--ses-ink);
}
.home-head .sub { color: var(--ses-ink-3); font-size: 13px; margin: 0; }
.home-head .actions { display: flex; gap: 10px; flex-shrink: 0; }
.new-doc-label { display: inline-flex; align-items: center; gap: 6px; }

/* === 空库欢迎 === */
.welcome {
  padding: 32px;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 16px;
}
.welcome h2 { margin: 0 0 6px; font-size: 18px; color: var(--ses-ink); }
.welcome p { margin: 0 0 20px; font-size: 13px; line-height: 1.7; color: var(--ses-ink-3); }

/* === 查找与筛选 === */
.list-toolbar {
  display: flex; align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 20px 0 12px;
}
.list-search { width: 280px; }
.list-toolbar-l { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.list-toolbar-r { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.sort-select { width: 130px; }

.chip {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ses-ink-2);
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
  font-family: inherit;
}
.chip:hover { background: var(--ses-surface-2); border-color: var(--ses-line-2); }
.chip.is-active {
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
  border-color: var(--ses-accent);
}
.chip .count {
  font-size: 11px;
  color: var(--ses-ink-4);
  font-family: var(--ses-font-mono);
}
.chip.is-active .count { color: var(--ses-accent); }
.chip:focus-visible, .view-toggle button:focus-visible { outline: 2px solid var(--ses-accent-ring); outline-offset: 1px; }

.view-toggle {
  display: flex;
  background: var(--ses-surface-2);
  border-radius: 6px;
  padding: 2px;
}
.view-toggle button {
  height: 28px; padding: 0 10px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--ses-ink-3);
  display: inline-flex; align-items: center; gap: 5px;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
}
.view-toggle button.is-active {
  background: var(--ses-surface);
  color: var(--ses-ink);
  box-shadow: var(--ses-shadow-1);
  font-weight: 500;
}

.filter-summary {
  display: flex; align-items: center; gap: 10px;
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--ses-ink-3);
}
.link-btn {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ses-accent);
  font: inherit;
  cursor: pointer;
}
.link-btn:hover { text-decoration: underline; }

.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.empty-state {
  padding: 56px 24px;
  text-align: center;
  background: var(--ses-surface);
  border: 1px dashed var(--ses-line-2);
  border-radius: 14px;
  color: var(--ses-ink-4);
}
.empty-state h3 { margin: 14px 0 4px; font-size: 15px; color: var(--ses-ink); }
.empty-state p { color: var(--ses-ink-3); font-size: 13px; margin: 0 0 16px; }

.doc-list-table { border: 1px solid var(--ses-line); border-radius: 12px; overflow: hidden; }
.doc-list-table :deep(.doc-list-row) { cursor: pointer; }
.list-std-no { font-family: var(--ses-font-mono); font-size: 12px; color: var(--ses-ink-3); }
.list-title { font-weight: 500; color: var(--ses-ink); }
.list-time { color: var(--ses-ink-3); font-size: 12.5px; }
.trash-view { margin-top: 8px; }
.trash-standard-no { font-family: var(--ses-font-mono); font-size: 12px; color: var(--ses-ink-3); }
.trash-title { font-weight: 500; color: var(--ses-ink); }

@media (max-width: 1000px) {
  .list-search { width: 100%; }
  .list-toolbar-r { margin-left: 0; }
}
@media (max-width: 620px) {
  .home-body { padding: 20px 16px 64px; }
  .home-head { flex-direction: column; align-items: stretch; }
  .home-head .actions { justify-content: flex-start; }
  .welcome { padding: 20px; }
  .view-toggle button span { display: none; }
}
</style>
