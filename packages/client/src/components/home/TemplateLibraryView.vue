<template>
  <section class="template-library" data-testid="template-library-view">
    <div class="lib-toolbar">
      <el-input
        v-model="searchText"
        class="lib-search"
        placeholder="搜索模板名称、说明或 UID"
        :prefix-icon="Search"
        clearable
        data-testid="template-search-input"
      />
      <div class="lib-filters" role="group" aria-label="按标准类型筛选模板">
        <button
          v-for="item in filterTypes"
          :key="item.id"
          type="button"
          class="chip"
          :class="{ 'is-active': typeFilter === item.id }"
          @click="typeFilter = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="lib-actions">
        <input
          ref="importInputRef"
          type="file"
          accept=".sestpl,application/json"
          hidden
          data-testid="template-import-input"
          @change="handleImportFile"
        />
        <el-button plain data-testid="template-agent-guide-btn" @click="guideOpen = true">
          让 AI 创建模板
        </el-button>
        <el-button plain :disabled="importBusy" data-testid="template-import-btn" @click="triggerImport">
          导入 .sestpl
        </el-button>
        <el-button type="primary" :loading="creating" data-testid="template-create-btn" @click="handleCreateCustom">
          <el-icon><Plus /></el-icon>
          <span>新建自定义模板</span>
        </el-button>
      </div>
    </div>

    <div class="lib-section">
      <div class="section-head">
        <h2>自定义模板</h2>
        <span class="section-count">{{ filteredCustom.length }} 个</span>
      </div>
      <div v-if="filteredCustom.length === 0" class="empty-box" data-testid="custom-templates-empty">
        <p v-if="customTemplates.length === 0">还没有自定义模板。可以从内置模板派生、将已有标准存为模板，或让 AI Agent 创建。</p>
        <p v-else>没有符合当前筛选条件的自定义模板。</p>
      </div>
      <div v-else class="tpl-grid">
        <TemplateCard
          v-for="tpl in filteredCustom"
          :key="tpl.uid"
          :template="tpl"
          @use="$emit('use-template', $event)"
          @edit="$emit('edit-template', $event)"
          @derive="handleDerive"
          @export="handleExport"
          @delete="handleDelete"
        />
      </div>
    </div>

    <div class="lib-section">
      <div class="section-head">
        <h2>内置标准模板（GB/T 1.1—2020）</h2>
        <span class="section-count">{{ filteredBuiltin.length }} 个</span>
      </div>
      <div class="tpl-grid">
        <TemplateCard
          v-for="tpl in filteredBuiltin"
          :key="tpl.uid"
          :template="tpl"
          @use="$emit('use-template', $event)"
          @derive="handleDerive"
        />
      </div>
    </div>

    <AgentTemplateGuideDialog v-model="guideOpen" />

    <TemplateImportDialog
      v-model="importDialogOpen"
      :preview="importPreview"
      :applying="importApplying"
      @choose="onImportChoice"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { createDefaultDocumentContent, type StandardTemplate } from '@ses/shared'
import { templateApi, type TemplateImportPreview } from '@/api/template'
import { useTemplateStore } from '@/stores/template'
import { TYPE_DEFS } from '@/constants/standards'
import TemplateCard from '@/components/home/TemplateCard.vue'
import AgentTemplateGuideDialog from '@/components/home/AgentTemplateGuideDialog.vue'
import TemplateImportDialog from '@/components/home/TemplateImportDialog.vue'

const emit = defineEmits<{
  (e: 'use-template', template: StandardTemplate): void
  (e: 'edit-template', template: StandardTemplate): void
}>()

const templateStore = useTemplateStore()
const searchText = ref('')
const typeFilter = ref('all')
const guideOpen = ref(false)
const creating = ref(false)
const importBusy = ref(false)
const importApplying = ref(false)
const importDialogOpen = ref(false)
const importPreview = ref<TemplateImportPreview | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)
let pendingImportFile: File | null = null

const filterTypes = [
  { id: 'all', label: '全部' },
  ...TYPE_DEFS.map((t) => ({ id: t.id, label: t.name })),
]

const customTemplates = computed(() => templateStore.customTemplates)
const builtinTemplates = computed(() => templateStore.builtinTemplates)

function matchesFilter(tpl: StandardTemplate): boolean {
  if (typeFilter.value !== 'all' && tpl.baseType !== typeFilter.value) return false
  const kw = searchText.value.trim().toLowerCase()
  if (!kw) return true
  return [tpl.name, tpl.description, tpl.uid].some((field) => field.toLowerCase().includes(kw))
}

const filteredCustom = computed(() => customTemplates.value.filter(matchesFilter))
const filteredBuiltin = computed(() => builtinTemplates.value.filter(matchesFilter))

async function handleCreateCustom() {
  if (creating.value) return
  creating.value = true
  try {
    const baseType = typeFilter.value === 'all' ? 'group' : (typeFilter.value as StandardTemplate['baseType'])
    const content = createDefaultDocumentContent({
      titleCn: '{{titleCn}}',
      standardType: baseType,
    })
    const created = await templateStore.createTemplate({
      name: '新建自定义模板',
      description: '',
      baseType,
      defaultStage: 'working_draft',
      defaultMeta: {},
      content,
    })
    ElMessage.success('已创建自定义模板')
    emit('edit-template', created)
  } catch (error) {
    ElMessage.error(`创建模板失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    creating.value = false
  }
}

async function handleDerive(template: StandardTemplate) {
  try {
    const created = await templateStore.createTemplate({
      name: `${template.name}（自定义）`,
      description: template.description,
      baseType: template.baseType,
      defaultStage: template.defaultStage,
      defaultMeta: JSON.parse(JSON.stringify(template.defaultMeta ?? {})),
      coverLayout: template.coverLayout ? JSON.parse(JSON.stringify(template.coverLayout)) : undefined,
      content: JSON.parse(JSON.stringify(template.content)),
      fromTemplateId: template.id,
    })
    ElMessage.success(`已基于「${template.name}」派生模板`)
    emit('edit-template', created)
  } catch (error) {
    ElMessage.error(`派生模板失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleExport(template: StandardTemplate) {
  try {
    const blob = await templateApi.exportPackage(template.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${template.name || template.uid}.sestpl`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出 .sestpl 模板包')
  } catch (error) {
    ElMessage.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleDelete(template: StandardTemplate) {
  if (typeof template.id !== 'number') return
  try {
    await ElMessageBox.confirm(
      `确定删除自定义模板「${template.name}」？已有基于该模板创建的标准文件不会受影响。`,
      '删除模板',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
    await templateStore.deleteTemplate(template.id)
    ElMessage.success('已删除模板')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function triggerImport() {
  if (importBusy.value || !importInputRef.value) return
  importInputRef.value.value = ''
  importInputRef.value.click()
}

async function handleImportFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importBusy.value) return

  importBusy.value = true
  try {
    const preview = await templateApi.previewImport(file)
    if (preview.status === 'new') {
      const imported = await templateApi.importPackage(file, 'new')
      await templateStore.fetchTemplates()
      ElMessage.success(`已导入模板「${imported.name}」`)
      return
    }
    pendingImportFile = file
    importPreview.value = preview
    importDialogOpen.value = true
  } catch (error) {
    ElMessage.error(`模板导入失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    importBusy.value = false
  }
}

async function onImportChoice(mode: 'update' | 'new' | null) {
  const file = pendingImportFile
  const preview = importPreview.value
  if (!mode || !file) {
    pendingImportFile = null
    importPreview.value = null
    importDialogOpen.value = false
    return
  }

  importApplying.value = true
  try {
    const target = mode === 'update' && preview?.existing && typeof preview.existing.id === 'number'
      ? { targetId: preview.existing.id, baseRevision: preview.existing.revision }
      : undefined
    const imported = await templateApi.importPackage(file, mode, target)
    await templateStore.fetchTemplates()
    ElMessage.success(mode === 'update' ? `已更新模板「${imported.name}」` : `已另存为新模板「${imported.name}」`)
    importDialogOpen.value = false
    pendingImportFile = null
    importPreview.value = null
  } catch (error) {
    ElMessage.error(`模板导入失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    importApplying.value = false
  }
}
</script>

<style scoped>
.template-library {
  display: grid;
  gap: 24px;
}

.lib-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}

.lib-search {
  width: 260px;
}

.lib-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  height: 30px;
  padding: 0 11px;
  border: 1px solid var(--ses-line);
  border-radius: 999px;
  background: var(--ses-surface);
  color: var(--ses-ink-3);
  font-size: 12px;
  cursor: pointer;
}

.chip.is-active {
  border-color: var(--ses-accent);
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
  font-weight: 600;
}

.lib-actions {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.lib-section {
  display: grid;
  gap: 12px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--ses-ink);
}

.section-count {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
  font-size: 11px;
}

.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 14px;
}

.empty-box {
  padding: 24px 18px;
  border: 1px dashed var(--ses-line);
  border-radius: 12px;
  background: var(--ses-surface);
  color: var(--ses-ink-3);
  font-size: 13px;
}

.empty-box p {
  margin: 0;
}
</style>
