<template>
  <div class="template-editor-view" v-loading="loading" data-testid="template-editor-view">
    <header class="tpl-nav">
      <div class="nav-l">
        <a class="back-link" href="#" @click.prevent="goLibrary">
          <el-icon><ArrowLeft /></el-icon>
          <span>返回模板库</span>
        </a>
        <div class="brand-sep" />
        <div class="tpl-crumb">
          <span class="ses-type-chip" :data-type="draft.baseType">{{ TYPE_LABELS[draft.baseType] || draft.baseType }}</span>
          <span class="crumb-title">{{ draft.name || template?.name || '模板编辑' }}</span>
          <span v-if="template && !template.readonly" class="rev-badge">rev {{ template.revision }}</span>
        </div>
      </div>

      <nav class="ed-tabs" aria-label="模板编辑视图">
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'body' }" @click="activeTab = 'body'">
          正文骨架<span v-if="bodyDirty" class="tab-dirty-mark" />
        </button>
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'meta' }" @click="activeTab = 'meta'">
          模板与元信息预设<span v-if="metaDirty" class="tab-dirty-mark" />
        </button>
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'layout' }" @click="activeTab = 'layout'">
          封面与封底版式
        </button>
      </nav>

      <div class="nav-r">
        <span class="ses-save-pill" :class="{ 'is-saving': saving, 'is-dirty': !saving && dirty }">
          <span class="dot" />
          <template v-if="saving">保存中…</template>
          <template v-else-if="isReadonly">内置只读</template>
          <template v-else-if="dirty">有未保存修改</template>
          <template v-else-if="lastSaved">已保存 {{ lastSaved }}</template>
          <template v-else>已同步</template>
        </span>

        <el-button
          v-if="!isReadonly && template?.hasPreviousContent"
          size="small"
          plain
          :disabled="saving"
          data-testid="template-revert-btn"
          @click="handleRevert"
        >撤回上次修改</el-button>

        <el-button
          v-if="isReadonly && template"
          size="small"
          type="primary"
          plain
          data-testid="template-readonly-derive-btn"
          @click="handleDeriveReadonly"
        >派生为自定义模板</el-button>

        <el-button
          size="small"
          plain
          :disabled="!template"
          data-testid="template-export-pkg-btn"
          @click="handleExportPackage"
        >导出 .sestpl</el-button>

        <el-button
          size="small"
          plain
          :disabled="!template || previewing"
          data-testid="template-preview-docx-btn"
          @click="handlePreviewDocx"
        >预览样稿 DOCX</el-button>

        <el-button
          size="small"
          plain
          :disabled="!template || previewing || !pdfSupported"
          :title="pdfButtonTitle"
          data-testid="template-preview-pdf-btn"
          @click="handlePreviewPdf"
        >预览样稿 PDF</el-button>

        <el-button
          v-if="!isReadonly"
          size="small"
          type="primary"
          :loading="saving"
          :disabled="!dirty || !draft.name.trim()"
          data-testid="template-save-btn"
          @click="handleSave"
        >保存模板</el-button>
      </div>
    </header>

    <div v-if="isReadonly" class="readonly-banner" role="alert">
      <span>当前为系统内置只读模板；可直接导出 .sestpl 或下载样稿，如需修改请派生为自定义模板。</span>
      <el-button size="small" type="primary" plain @click="handleDeriveReadonly">派生为自定义模板</el-button>
    </div>

    <div v-show="activeTab === 'body'" class="body-tab">
      <StandardEditorToolbar :core="editorCore" :disabled="isReadonly">
        <template #extra>
          <el-dropdown trigger="click" @command="insertPlaceholder">
            <button class="tbar-btn" type="button" data-testid="insert-placeholder-btn" title="在光标处插入模板占位符">
              占位符 <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="item in PLACEHOLDER_TOKENS" :key="item.token" :command="item.token">
                  <span>{{ item.label }}</span>
                  <small style="margin-left: 10px; opacity: 0.65">{{ item.token }}</small>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </StandardEditorToolbar>
      <StandardEditorCanvas :core="editorCore" :disabled="isReadonly" />
    </div>

    <div v-show="activeTab === 'meta'" class="meta-tab ses-scroll">
      <div class="meta-container">
        <el-form label-position="top" :model="draft" class="meta-form">
          <section class="meta-card">
            <h2>模板信息与标准类型</h2>
            <div class="field-grid">
              <el-form-item label="模板名称" class="span-2" required>
                <el-input v-model="draft.name" :disabled="isReadonly || saving" placeholder="请输入模板名称" data-testid="template-name-input" />
              </el-form-item>
              <el-form-item label="模板说明" class="span-2">
                <el-input
                  v-model="draft.description"
                  type="textarea"
                  :rows="2"
                  :disabled="isReadonly || saving"
                  placeholder="说明适用范围、包含结构与占位符约定"
                />
              </el-form-item>
              <el-form-item label="适用标准类别">
                <el-select
                  :model-value="draft.baseType"
                  :disabled="isReadonly || saving"
                  class="full-width"
                  data-testid="template-base-type-select"
                  @update:model-value="onBaseTypeChange"
                >
                  <el-option v-for="t in TYPE_DEFS" :key="t.id" :label="t.name" :value="t.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="默认编制阶段">
                <el-select v-model="draft.defaultStage" :disabled="isReadonly || saving" class="full-width">
                  <el-option v-for="stage in STAGES" :key="stage" :label="STAGE_LABELS[stage]" :value="stage" />
                </el-select>
              </el-form-item>
              <StandardTypeNameInput
                v-if="supportsCustomDesignation"
                v-model="coverDesignationName"
                class="span-2"
                :standard-type="draft.baseType"
                :disabled="isReadonly || saving"
              />
            </div>
          </section>

          <section class="meta-card">
            <h2>元信息预设（新建标准时自动预填）</h2>
            <div class="field-grid">
              <el-form-item label="标准编号前缀（stdPrefix）">
                <el-input v-model="draft.stdPrefix" :disabled="isReadonly || saving" placeholder="例如 T/XXX、Q/XXX" />
              </el-form-item>
              <el-form-item label="备案号">
                <el-input v-model="draft.filingNo" :disabled="isReadonly || saving" placeholder="适用时填写" />
              </el-form-item>
              <el-form-item label="ICS 分类号">
                <el-input v-model="draft.icsCode" :disabled="isReadonly || saving" placeholder="如 35.240.99" />
              </el-form-item>
              <el-form-item label="CCS 分类号">
                <el-input v-model="draft.ccsCode" :disabled="isReadonly || saving" placeholder="如 L 70" />
              </el-form-item>
              <el-form-item label="提出单位">
                <el-input v-model="draft.proposer" :disabled="isReadonly || saving" />
              </el-form-item>
              <el-form-item label="归口单位">
                <el-input v-model="draft.technicalCommittee" :disabled="isReadonly || saving" />
              </el-form-item>
              <el-form-item label="发布单位">
                <el-input v-model="draft.issuer" :disabled="isReadonly || saving" />
              </el-form-item>
              <el-form-item label="起草单位">
                <el-input v-model="draft.applicant" :disabled="isReadonly || saving" />
              </el-form-item>
              <el-form-item label="代替标准">
                <el-input v-model="draft.replaces" :disabled="isReadonly || saving" />
              </el-form-item>
              <el-form-item label="一致性程度标识">
                <el-input v-model="draft.consistency" :disabled="isReadonly || saving" />
              </el-form-item>
            </div>
          </section>
        </el-form>
      </div>
    </div>

    <div v-show="activeTab === 'layout'" class="layout-tab">
      <div class="layout-left ses-scroll">
        <CoverLayoutEditor
          v-model="draft.coverLayout"
          :standard-type="draft.baseType"
          :disabled="isReadonly || saving"
        />
      </div>
      <div class="layout-right">
        <div class="preview-header">
          <span>封面与封底实时预览（打印样式）</span>
          <small>与导出 DOCX / PDF 版式一致</small>
        </div>
        <iframe
          class="preview-frame"
          sandbox=""
          :srcdoc="previewHtml"
          title="封面与封底实时预览"
          data-testid="template-cover-preview-iframe"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowLeft } from '@element-plus/icons-vue'
import {
  COVER_LAYOUT_PRINT_CSS,
  COVER_PRINT_CSS,
  PDF_EXPORT_DISABLED_MESSAGE,
  PDF_EXPORT_ENABLED,
  cloneCoverLayout,
  createDefaultDocumentContent,
  downgradeCoverLayoutForStandardType,
  getCoverDesignationParts,
  irMetaFromDocumentMeta,
  renderBackCoverHtml,
  renderCoverHtml,
  type CoverLayoutConfig,
  type DocumentMeta,
  type DocumentStage,
  type IRDocMeta,
  type StandardTemplate,
  type StandardType,
  type TemplateDefaultMeta,
} from '@ses/shared'
import { templateApi } from '@/api/template'
import { useTemplateStore } from '@/stores/template'
import { STAGES, STAGE_LABELS, TYPE_DEFS, TYPE_LABELS } from '@/constants/standards'
import { useStandardEditorCore } from '@/composables/useStandardEditorCore'
import { useCoverDesignationDraft } from '@/composables/useCoverDesignationDraft'
import { replaceEditorDocument } from '@/utils/editorDocument'
import { sameCoverLayout } from '@/utils/documentSettings'
import StandardEditorToolbar from '@/components/editor/StandardEditorToolbar.vue'
import StandardEditorCanvas from '@/components/editor/StandardEditorCanvas.vue'
import StandardTypeNameInput from '@/components/StandardTypeNameInput.vue'
import CoverLayoutEditor from '@/components/editor/CoverLayoutEditor.vue'

interface TemplateDraft {
  name: string
  description: string
  baseType: StandardType
  defaultStage: DocumentStage
  stdPrefix: string
  icsCode: string
  ccsCode: string
  proposer: string
  technicalCommittee: string
  issuer: string
  applicant: string
  replaces: string
  consistency: string
  filingNo: string
  industryName: string
  regionName: string
  coverDesignation: string
  coverLayout?: CoverLayoutConfig
}

const PLACEHOLDER_TOKENS = [
  { token: '{{titleCn}}', label: '标准中文名称' },
  { token: '{{titleEn}}', label: '标准英文名称' },
  { token: '{{standardNo}}', label: '标准编号' },
  { token: '{{proposer}}', label: '提出单位' },
  { token: '{{technicalCommittee}}', label: '归口单位' },
  { token: '{{issuer}}', label: '发布单位' },
  { token: '{{applicant}}', label: '起草单位' },
  { token: '{{icsCode}}', label: 'ICS 分类号' },
  { token: '{{ccsCode}}', label: 'CCS 分类号' },
  { token: '{{replaces}}', label: '代替标准' },
  { token: '{{consistency}}', label: '采标一致性标识' },
  { token: '{{publishDate}}', label: '发布日期' },
  { token: '{{implementDate}}', label: '实施日期' },
  { token: '{{filingNo}}', label: '备案号' },
]

const route = useRoute()
const router = useRouter()
const templateStore = useTemplateStore()

const routeId = computed(() => String(route.params.id ?? ''))
const loading = ref(true)
const saving = ref(false)
const previewing = ref(false)
const lastSaved = ref('')
const activeTab = ref<'body' | 'meta' | 'layout'>('body')
const template = ref<StandardTemplate | null>(null)
const bodyDirty = ref(false)
const capabilities = ref<{ htmlToPdf: boolean }>({ htmlToPdf: false })

function emptyDraft(): TemplateDraft {
  return {
    name: '',
    description: '',
    baseType: 'national',
    defaultStage: 'working_draft',
    stdPrefix: '',
    icsCode: '',
    ccsCode: '',
    proposer: '',
    technicalCommittee: '',
    issuer: '',
    applicant: '',
    replaces: '',
    consistency: '',
    filingNo: '',
    industryName: '',
    regionName: '',
    coverDesignation: '',
    coverLayout: undefined,
  }
}

const draft = ref<TemplateDraft>(emptyDraft())
const baseline = ref<TemplateDraft>(emptyDraft())

const isReadonly = computed(() => Boolean(template.value?.readonly))
const supportsCustomDesignation = computed(() => getCoverDesignationParts(draft.value.baseType) !== undefined)

const designationDraft = useCoverDesignationDraft({
  getDraft: () => draft.value,
  getType: (d) => d.baseType,
  setType: (d, type) => { d.baseType = type as StandardType },
})

const coverDesignationName = computed({
  get: designationDraft.getName,
  set: designationDraft.setName,
})

function sameDraft(a: TemplateDraft, b: TemplateDraft): boolean {
  return a.name === b.name
    && a.description === b.description
    && a.baseType === b.baseType
    && a.defaultStage === b.defaultStage
    && a.stdPrefix === b.stdPrefix
    && a.icsCode === b.icsCode
    && a.ccsCode === b.ccsCode
    && a.proposer === b.proposer
    && a.technicalCommittee === b.technicalCommittee
    && a.issuer === b.issuer
    && a.applicant === b.applicant
    && a.replaces === b.replaces
    && a.consistency === b.consistency
    && a.filingNo === b.filingNo
    && a.industryName === b.industryName
    && a.regionName === b.regionName
    && a.coverDesignation === b.coverDesignation
    && sameCoverLayout(a.coverLayout, b.coverLayout)
}

const metaDirty = computed(() => !sameDraft(draft.value, baseline.value))
const dirty = computed(() => !isReadonly.value && (bodyDirty.value || metaDirty.value))

const pdfSupported = computed(() => PDF_EXPORT_ENABLED && capabilities.value.htmlToPdf)
const pdfButtonTitle = computed(() => (PDF_EXPORT_ENABLED ? '下载 PDF 样稿' : PDF_EXPORT_DISABLED_MESSAGE))

function buildPresetMeta(): DocumentMeta {
  return {
    standardType: draft.value.baseType,
    titleCn: draft.value.name || '标准名称示例',
    standardNo: draft.value.stdPrefix ? `${draft.value.stdPrefix} XXXXX—2026` : 'GB/T XXXXX—2026',
    icsCode: draft.value.icsCode || undefined,
    ccsCode: draft.value.ccsCode || undefined,
    proposer: draft.value.proposer || undefined,
    technicalCommittee: draft.value.technicalCommittee || undefined,
    issuer: draft.value.issuer || undefined,
    applicant: draft.value.applicant || undefined,
    replaces: draft.value.replaces || undefined,
    consistency: draft.value.consistency || undefined,
    filingNo: draft.value.filingNo || undefined,
    industryName: draft.value.industryName || undefined,
    regionName: draft.value.regionName || undefined,
    coverDesignation: draft.value.coverDesignation || undefined,
    coverLayout: cloneCoverLayout(draft.value.coverLayout),
  }
}

const editorCore = useStandardEditorCore({
  onUpdate: () => {
    if (!isReadonly.value) bodyDirty.value = true
  },
  onSaveShortcut: () => {
    void handleSave()
  },
  getForewordMeta: () => buildPresetMeta(),
  getUnavailable: () => isReadonly.value,
  getResourceKey: () => routeId.value,
})
const { editor, hasUnappliedLandscapeEdits } = editorCore

const previewHtml = computed(() => {
  const irMeta: IRDocMeta = {
    standardType: 'gb',
    ...irMetaFromDocumentMeta(buildPresetMeta()),
  }
  const coverHtml = renderCoverHtml(irMeta, draft.value.defaultStage, draft.value.coverLayout)
  const backHtml = draft.value.coverLayout?.backCover?.enabled
    ? renderBackCoverHtml(irMeta, draft.value.coverLayout.backCover)
    : ''
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<style>',
    COVER_PRINT_CSS,
    COVER_LAYOUT_PRINT_CSS,
    'body{margin:0;padding:16px;background:#e8eaef;display:grid;gap:18px;justify-items:center;}',
    '.ses-cover-page,.ses-back-cover{background:#fff;box-shadow:0 4px 16px rgba(0,0,0,.1);padding:20mm 18mm;box-sizing:border-box;width:190mm;min-height:250mm;}',
    '</style></head><body>',
    coverHtml,
    backHtml,
    '</body></html>',
  ].join('')
})

function draftFromTemplate(tpl: StandardTemplate): TemplateDraft {
  const dm = tpl.defaultMeta ?? {}
  return {
    name: tpl.name,
    description: tpl.description ?? '',
    baseType: tpl.baseType,
    defaultStage: tpl.defaultStage,
    stdPrefix: dm.stdPrefix ?? '',
    icsCode: dm.icsCode ?? '',
    ccsCode: dm.ccsCode ?? '',
    proposer: dm.proposer ?? '',
    technicalCommittee: dm.technicalCommittee ?? '',
    issuer: dm.issuer ?? '',
    applicant: dm.applicant ?? '',
    replaces: dm.replaces ?? '',
    consistency: dm.consistency ?? '',
    filingNo: dm.filingNo ?? '',
    industryName: dm.industryName ?? '',
    regionName: dm.regionName ?? '',
    coverDesignation: dm.coverDesignation ?? '',
    coverLayout: cloneCoverLayout(tpl.coverLayout),
  }
}

function hydrateTemplate(tpl: StandardTemplate) {
  template.value = tpl
  const nextDraft = draftFromTemplate(tpl)
  draft.value = { ...nextDraft, coverLayout: cloneCoverLayout(nextDraft.coverLayout) }
  baseline.value = { ...nextDraft, coverLayout: cloneCoverLayout(nextDraft.coverLayout) }
  bodyDirty.value = false
  lastSaved.value = tpl.updatedAt ? new Date(tpl.updatedAt).toLocaleTimeString('zh-CN') : ''

  const currentEditor = editor.value
  if (currentEditor) {
    const content = tpl.content && Object.keys(tpl.content).length > 0
      ? tpl.content
      : createDefaultDocumentContent({ standardType: tpl.baseType, titleCn: '{{titleCn}}' })
    replaceEditorDocument(currentEditor, content, true, false)
    currentEditor.setEditable(!tpl.readonly, false)
  }
}

function defaultMetaFromDraft(d: TemplateDraft): TemplateDefaultMeta {
  const out: TemplateDefaultMeta = {}
  if (d.stdPrefix.trim()) out.stdPrefix = d.stdPrefix.trim()
  if (d.icsCode.trim()) out.icsCode = d.icsCode.trim()
  if (d.ccsCode.trim()) out.ccsCode = d.ccsCode.trim()
  if (d.proposer.trim()) out.proposer = d.proposer.trim()
  if (d.technicalCommittee.trim()) out.technicalCommittee = d.technicalCommittee.trim()
  if (d.issuer.trim()) out.issuer = d.issuer.trim()
  if (d.applicant.trim()) out.applicant = d.applicant.trim()
  if (d.replaces.trim()) out.replaces = d.replaces.trim()
  if (d.consistency.trim()) out.consistency = d.consistency.trim()
  if (d.filingNo.trim()) out.filingNo = d.filingNo.trim()
  if (d.industryName.trim()) out.industryName = d.industryName.trim()
  if (d.regionName.trim()) out.regionName = d.regionName.trim()
  if (d.coverDesignation.trim()) out.coverDesignation = d.coverDesignation.trim()
  return out
}

function onBaseTypeChange(type: StandardType) {
  designationDraft.changeType(type)
  const { coverLayout, downgraded } = downgradeCoverLayoutForStandardType(draft.value.coverLayout, type)
  if (downgraded) {
    draft.value.coverLayout = coverLayout
    ElMessage.warning('国家标准和指导性技术文件禁止替换右上角标志，已将封面徽标位置调整为左上角。')
  }
}

function insertPlaceholder(token: string) {
  if (!editor.value || isReadonly.value) return
  editor.value.chain().focus().insertContent(token).run()
}

async function handleSave(): Promise<boolean> {
  const current = template.value
  const currentEditor = editor.value
  if (!current || current.readonly || typeof current.id !== 'number' || !currentEditor || saving.value) return false
  if (!draft.value.name.trim()) {
    ElMessage.warning('模板名称不能为空')
    return false
  }

  saving.value = true
  try {
    const updated = await templateStore.updateTemplate(current.id, {
      baseRevision: current.revision,
      name: draft.value.name.trim(),
      description: draft.value.description.trim(),
      baseType: draft.value.baseType,
      defaultStage: draft.value.defaultStage,
      defaultMeta: defaultMetaFromDraft(draft.value),
      coverLayout: cloneCoverLayout(draft.value.coverLayout) ?? null,
      content: currentEditor.getJSON() as Record<string, unknown>,
    })
    hydrateTemplate(updated)
    ElMessage.success('模板已保存')
    return true
  } catch (error) {
    ElMessage.error(`保存模板失败：${error instanceof Error ? error.message : String(error)}`)
    return false
  } finally {
    saving.value = false
  }
}

async function handleRevert() {
  const current = template.value
  if (!current || current.readonly || typeof current.id !== 'number') return
  try {
    await ElMessageBox.confirm(
      '将回退正文骨架到上一次修改前的版本（仅单步撤回，不可连续回退）。确认继续？',
      '撤回上次修改',
      { confirmButtonText: '确认撤回', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }

  saving.value = true
  try {
    const reverted = await templateStore.revertTemplate(current.id, current.revision)
    hydrateTemplate(reverted)
    ElMessage.success('已撤回至上一次修改前的内容')
  } catch (error) {
    ElMessage.error(`撤回失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    saving.value = false
  }
}

async function handleDeriveReadonly() {
  const current = template.value
  if (!current) return
  try {
    const created = await templateStore.createTemplate({
      name: `${current.name}（自定义）`,
      description: current.description,
      baseType: current.baseType,
      defaultStage: current.defaultStage,
      defaultMeta: JSON.parse(JSON.stringify(current.defaultMeta ?? {})),
      coverLayout: cloneCoverLayout(current.coverLayout),
      content: JSON.parse(JSON.stringify(current.content)),
      fromTemplateId: current.id,
    })
    ElMessage.success('已派生自定义模板')
    router.push({ name: 'template-editor', params: { id: String(created.id) } })
  } catch (error) {
    ElMessage.error(`派生失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function handleExportPackage() {
  if (!template.value) return
  try {
    const blob = await templateApi.exportPackage(template.value.id)
    downloadBlob(blob, `${draft.value.name || template.value.name || template.value.uid}.sestpl`)
    ElMessage.success('已导出 .sestpl 模板包')
  } catch (error) {
    ElMessage.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function ensureSavedBeforePreview(): Promise<boolean> {
  if (!dirty.value) return true
  const saved = await handleSave()
  return saved
}

async function handlePreviewDocx() {
  if (!template.value || previewing.value) return
  if (!(await ensureSavedBeforePreview())) return
  previewing.value = true
  try {
    const blob = await templateApi.previewDocx(template.value.id)
    downloadBlob(blob, `${draft.value.name || template.value.name}-样稿.docx`)
    ElMessage.success('已生成 DOCX 样稿')
  } catch (error) {
    ElMessage.error(`生成 DOCX 样稿失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    previewing.value = false
  }
}

async function handlePreviewPdf() {
  if (!template.value || previewing.value || !pdfSupported.value) return
  if (!(await ensureSavedBeforePreview())) return
  previewing.value = true
  try {
    const blob = await templateApi.previewPdf(template.value.id)
    downloadBlob(blob, `${draft.value.name || template.value.name}-样稿.pdf`)
    ElMessage.success('已生成 PDF 样稿')
  } catch (error) {
    ElMessage.error(`生成 PDF 样稿失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    previewing.value = false
  }
}

function goLibrary() {
  router.push({ name: 'home', query: { tab: 'templates' } })
}

function guardBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !hasUnappliedLandscapeEdits()) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(async () => {
  if (!dirty.value && !hasUnappliedLandscapeEdits()) return true
  try {
    await ElMessageBox.confirm(
      '当前模板仍有未保存修改，离开后将丢失这些修改。',
      '离开模板编辑器？',
      { confirmButtonText: '离开并放弃修改', cancelButtonText: '继续编辑', type: 'warning' },
    )
    return true
  } catch {
    return false
  }
})

onMounted(async () => {
  window.addEventListener('beforeunload', guardBeforeUnload)
  try {
    const tpl = await templateStore.fetchTemplate(routeId.value)
    hydrateTemplate(tpl)
  } catch {
    ElMessage.error('模板加载失败')
    goLibrary()
  } finally {
    loading.value = false
  }

  try {
    const resp = await fetch('/api/convert/capabilities')
    if (resp.ok) capabilities.value = await resp.json()
  } catch {
    // 忽略能力探测失败
  }
})

watch(editor, (ed) => {
  if (ed && template.value) {
    hydrateTemplate(template.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', guardBeforeUnload)
})
</script>

<style scoped>
.template-editor-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--ses-bg);
}

.tpl-nav {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 0 16px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  flex-shrink: 0;
}

.nav-l, .nav-r {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.nav-r {
  justify-content: flex-end;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ses-ink-2);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.back-link:hover {
  color: var(--ses-accent);
}

.brand-sep {
  width: 1px;
  height: 16px;
  background: var(--ses-line);
}

.tpl-crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.crumb-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ses-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rev-badge {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-4);
  font-family: var(--ses-font-mono);
  font-size: 10.5px;
}

.ed-tabs {
  display: inline-flex;
  padding: 3px;
  background: var(--ses-surface-2);
  border-radius: 8px;
  gap: 2px;
}

.ed-tab {
  position: relative;
  border: 0;
  background: transparent;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ses-ink-3);
  cursor: pointer;
}

.ed-tab.is-active {
  background: var(--ses-surface);
  color: var(--ses-ink);
  box-shadow: var(--ses-shadow-1);
}

.tab-dirty-mark {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 5px;
  border-radius: 50%;
  background: var(--ses-warn);
  vertical-align: middle;
}

.readonly-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: color-mix(in oklch, var(--ses-warn) 10%, var(--ses-surface));
  border-bottom: 1px solid color-mix(in oklch, var(--ses-warn) 30%, var(--ses-line));
  font-size: 12.5px;
  color: var(--ses-ink-2);
}

.body-tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.meta-tab {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px 20px 48px;
}

.meta-container {
  max-width: 860px;
  margin: 0 auto;
}

.meta-form {
  display: grid;
  gap: 18px;
}

.meta-card {
  padding: 18px 20px;
  border: 1px solid var(--ses-line);
  border-radius: 12px;
  background: var(--ses-surface);
}

.meta-card h2 {
  margin: 0 0 14px;
  font-size: 14px;
  font-weight: 650;
  color: var(--ses-ink);
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.span-2 {
  grid-column: 1 / -1;
}

.full-width {
  width: 100%;
}

.layout-tab {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(380px, 1fr) minmax(380px, 1fr);
}

.layout-left {
  overflow: auto;
  padding: 18px 20px 36px;
  border-right: 1px solid var(--ses-line);
  background: var(--ses-surface);
}

.layout-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #e8eaef;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  font-size: 12px;
  font-weight: 600;
  color: var(--ses-ink-2);
}

.preview-header small {
  font-weight: 400;
  color: var(--ses-ink-4);
}

.preview-frame {
  flex: 1;
  width: 100%;
  border: 0;
}

@media (max-width: 980px) {
  .tpl-nav {
    grid-template-columns: 1fr;
    padding: 10px 14px;
    gap: 8px;
  }
  .layout-tab {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
