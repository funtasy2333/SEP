<template>
  <div class="home-page">
    <HomeNav :active-tab="navTab" :tabs="navTabs" @select-tab="navTab = $event" />

    <main class="home-body">
      <!-- Page head -->
      <div class="home-head">
        <div>
          <h1>我的标准库</h1>
          <p class="sub">{{ store.documents.length }} 份起草中文件 · 上次保存于 {{ lastSaved }}</p>
        </div>
        <div class="actions">
          <el-button :icon="Download">批量导出</el-button>
          <el-button type="primary" :icon="Plus" @click="openNewDoc()">新建标准文件</el-button>
        </div>
      </div>

      <!-- Stats -->
      <StatCards :stats="stats" />

      <!-- Template rail -->
      <TemplateRail @pick="openNewDoc" />

      <!-- Filters & view toggle -->
      <div class="list-toolbar">
        <div class="list-toolbar-l">
          <button
            v-for="t in typeFilters"
            :key="t.id"
            class="chip"
            :class="{ 'is-active': typeFilter === t.id }"
            @click="typeFilter = t.id"
          >
            {{ t.label }}
            <span class="count">{{ counts[t.id] || 0 }}</span>
          </button>
        </div>
        <div class="list-toolbar-r">
          <el-select v-model="stageFilter" size="small" style="width: 130px">
            <el-option value="all" label="所有阶段" />
            <el-option v-for="(label, k) in STAGE_LABELS" :key="k" :value="k" :label="label" />
          </el-select>
          <el-select v-model="sort" size="small" style="width: 120px">
            <el-option value="updated" label="最近更新" />
            <el-option value="title" label="标题 A-Z" />
            <el-option value="stage" label="阶段" />
          </el-select>
          <div class="view-toggle">
            <button :class="{ 'is-active': view === 'grid' }" @click="view = 'grid'">
              <el-icon><Grid /></el-icon> 卡片
            </button>
            <button :class="{ 'is-active': view === 'list' }" @click="view = 'list'">
              <el-icon><List /></el-icon> 列表
            </button>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div v-if="filtered.length === 0" class="empty-state">
        <el-icon :size="40"><Document /></el-icon>
        <h3>没有匹配的文档</h3>
        <p>试试调整筛选条件，或新建一份标准。</p>
        <el-button type="primary" :icon="Plus" @click="openNewDoc()">新建标准文件</el-button>
      </div>

      <div v-else-if="view === 'grid'" class="doc-grid">
        <DocCard
          v-for="d in filtered"
          :key="d.id"
          :doc="d"
          @open="openDocument"
          @delete="handleDelete"
        />
      </div>

      <el-table
        v-else
        v-loading="store.loading"
        :data="filtered"
        :show-header="true"
        @row-click="openDocument"
        class="doc-list-table"
      >
        <el-table-column prop="meta.standardNo" label="标准编号" width="170">
          <template #default="{ row }">
            <span style="font-family: var(--ses-font-mono); font-size: 12px; color: var(--ses-ink-3)">
              {{ row.meta?.standardNo || '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="文件题名" min-width="240">
          <template #default="{ row }">
            <span style="font-weight: 500; color: var(--ses-ink)">{{ row.meta?.titleCn || row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="120">
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
            <span style="color: var(--ses-ink-3); font-size: 12.5px">
              {{ formatDate(row.updatedAt) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button type="danger" text size="small" @click.stop="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </main>

    <NewDocDialog v-model="newDocOpen" :initial-type="newDocType" @create="handleCreate" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Plus, Grid, List, Document } from '@element-plus/icons-vue'

import { useDocumentStore } from '@/stores/document'
import type { DocumentData } from '@/api/document'
import { STAGE_LABELS, TYPE_LABELS } from '@/constants/standards'

import HomeNav from '@/components/home/HomeNav.vue'
import StatCards, { type Stat } from '@/components/home/StatCards.vue'
import TemplateRail from '@/components/home/TemplateRail.vue'
import DocCard from '@/components/home/DocCard.vue'
import NewDocDialog from '@/components/home/NewDocDialog.vue'

const router = useRouter()
const store = useDocumentStore()

const navTab = ref('all')
const typeFilter = ref('all')
const stageFilter = ref<'all' | string>('all')
const sort = ref<'updated' | 'title' | 'stage'>('updated')
const view = ref<'grid' | 'list'>('grid')
const newDocOpen = ref(false)
const newDocType = ref<string | undefined>(undefined)

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

const filtered = computed(() => {
  let arr = [...store.documents]
  if (typeFilter.value !== 'all') {
    arr = arr.filter((d) => d.meta?.standardType === typeFilter.value)
  }
  if (stageFilter.value !== 'all') {
    arr = arr.filter((d) => d.stage === stageFilter.value)
  }
  if (sort.value === 'title') {
    arr.sort((a, b) => (a.meta?.titleCn || a.title).localeCompare(b.meta?.titleCn || b.title))
  } else if (sort.value === 'stage') {
    arr.sort((a, b) => a.stage.localeCompare(b.stage))
  } else {
    arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  }
  return arr
})

const navTabs = computed(() => [
  { id: 'all',        label: '全部文档',  count: store.documents.length },
  { id: 'mine',       label: '我的草案',  count: counts.value.working_draft || 0 },
  { id: 'collab',     label: '协作中' },
  { id: 'templates',  label: '模板库' },
  { id: 'trash',      label: '回收站' },
])

const stats = computed<Stat[]>(() => [
  { label: '我的起草', value: store.documents.filter((d) => d.stage === 'working_draft').length, unit: '份', trend: '本周 +1', trendUp: true },
  { label: '待审阅',   value: store.documents.filter((d) => ['review_draft','review_discussion_draft'].includes(d.stage)).length, unit: '份', trend: '今天 +1', live: true },
  { label: '本月发布', value: store.documents.filter((d) => d.stage === 'published').length, unit: '份', trend: 'vs 上月 +25%', trendUp: true },
  { label: '未读评论', value: 0, unit: '条', trend: '—' },
])

const lastSaved = computed(() => {
  const arr = store.documents
    .map((d) => d.updatedAt)
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => b.localeCompare(a))
  if (!arr[0]) return '——'
  const date = new Date(arr[0])
  return date.toLocaleString('zh-CN')
})

onMounted(() => {
  store.fetchDocuments()
})

function openNewDoc(type?: string) {
  newDocType.value = type
  newDocOpen.value = true
}

async function handleCreate(form: {
  type: string
  stage: string
  stdNo: string
  titleCn: string
  titleEn: string
  icsCode: string
  ccsCode: string
  issuer: string
  applicant: string
}) {
  const doc = await store.createDocument({
    title: form.titleCn,
    meta: {
      titleCn: form.titleCn,
      titleEn: form.titleEn || undefined,
      standardNo: form.stdNo || undefined,
      icsCode: form.icsCode || undefined,
      ccsCode: form.ccsCode || undefined,
      standardType: form.type,
      issuer: form.issuer || undefined,
      applicant: form.applicant || undefined,
    },
    stage: form.stage,
    content: {},
  })
  newDocOpen.value = false
  ElMessage.success('创建成功')
  router.push({ name: 'editor', params: { id: doc.id! } })
}

function openDocument(row: DocumentData) {
  router.push({ name: 'editor', params: { id: row.id! } })
}

async function handleDelete(row: DocumentData) {
  await ElMessageBox.confirm(`确定删除文档"${row.meta?.titleCn || row.title}"吗？`, '确认删除', {
    type: 'warning',
  })
  await store.deleteDocument(row.id!)
  ElMessage.success('已删除')
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
  padding: 32px 32px 80px;
  flex: 1;
}

.home-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 24px;
}
.home-head h1 {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.01em;
  margin: 0 0 6px;
  color: var(--ses-ink);
}
.home-head .sub { color: var(--ses-ink-3); font-size: 13.5px; margin: 0; }
.home-head .actions { display: flex; gap: 10px; }

.list-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.list-toolbar-l { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.list-toolbar-r { display: flex; align-items: center; gap: 8px; }

.chip {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ses-ink-2);
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  transition: all 0.12s ease;
  font-family: inherit;
}
.chip:hover { background: var(--ses-surface-2); border-color: var(--ses-line-2); }
.chip.is-active {
  background: var(--ses-ink);
  color: oklch(0.98 0.003 270);
  border-color: var(--ses-ink);
}
.chip .count {
  font-size: 11px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
  font-family: var(--ses-font-mono);
  font-weight: 500;
}
.chip.is-active .count { background: oklch(0.3 0.014 270); color: oklch(0.85 0.005 270); }

.view-toggle {
  display: flex;
  background: var(--ses-surface-2);
  border-radius: 6px;
  padding: 2px;
}
.view-toggle button {
  height: 24px; padding: 0 10px;
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

.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(296px, 1fr));
  gap: 16px;
}

.empty-state {
  padding: 64px 24px;
  text-align: center;
  background: var(--ses-surface);
  border: 2px dashed var(--ses-line-2);
  border-radius: 16px;
  color: var(--ses-ink-3);
}
.empty-state h3 { margin: 16px 0 4px; font-size: 16px; color: var(--ses-ink); }
.empty-state p { color: var(--ses-ink-3); font-size: 13px; margin: 0 0 16px; }

.doc-list-table { border: 1px solid var(--ses-line); border-radius: 12px; overflow: hidden; }
</style>
