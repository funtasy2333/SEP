<template>
  <div class="template-editor-view" v-loading="loading" data-testid="template-editor-view">
    <header class="tpl-nav">
      <div class="nav-l">
        <a class="back-link" href="#" @click.prevent="goLibrary">
          <el-icon><ArrowLeft /></el-icon>
          <span>返回模板库</span>
        </a>
        <div class="brand-sep" />
        <button
          type="button"
          class="tpl-crumb"
          title="点击跳转到模板与元信息预设"
          @click="activeTab = 'meta'"
        >
          <span class="ses-type-chip" :data-type="draft.baseType">{{ TYPE_LABELS[draft.baseType] || draft.baseType }}</span>
          <span class="crumb-title">{{ draft.name || template?.name || '模板编辑' }}</span>
          <span v-if="template && !template.readonly" class="rev-badge">rev {{ template.revision }}</span>
        </button>
      </div>

      <div
        class="ed-tabs"
        role="tablist"
        aria-label="模板编辑视图"
        @keydown="onTabKeydown"
      >
        <button
          v-for="(tab, idx) in TAB_DEFS"
          :key="tab.id"
          :id="`tpl-tab-${tab.id}`"
          :ref="(el) => setTabRef(idx, el)"
          type="button"
          role="tab"
          class="ed-tab"
          :aria-selected="activeTab === tab.id"
          :tabindex="activeTab === tab.id ? 0 : -1"
          :data-testid="`template-tab-${tab.id}`"
          @click="activeTab = tab.id"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tabDirtyMap[tab.id]" class="tab-dirty-mark" aria-label="该分页有未保存修改" />
        </button>
      </div>

      <div class="nav-r">
        <span class="ses-save-pill" aria-live="polite" :class="{ 'is-saving': saving, 'is-dirty': !saving && dirty }">
          <span class="dot" />
          <template v-if="saving">保存中…</template>
          <template v-else-if="isReadonly">内置只读</template>
          <template v-else-if="dirty">有未保存修改</template>
          <template v-else-if="lastSaved">已保存 {{ lastSaved }}</template>
          <template v-else>已同步</template>
        </span>

        <el-button
          size="small"
          plain
          :disabled="!template || previewing"
          data-testid="template-preview-docx-btn"
          @click="handlePreviewDocx"
        >
          预览 DOCX
        </el-button>

        <el-dropdown trigger="click" @command="onMoreCommand">
          <el-button size="small" plain :disabled="!template" data-testid="template-more-actions-btn">
            更多 <el-icon style="margin-left: 4px"><MoreFilled /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="export-pkg" data-testid="template-export-pkg-btn">
                导出 .sestpl 模板包
              </el-dropdown-item>
              <el-dropdown-item
                command="preview-pdf"
                :disabled="!template || previewing || !pdfSupported"
                :title="pdfSupported ? '下载 PDF 样稿' : PDF_EXPORT_DISABLED_MESSAGE"
                data-testid="template-preview-pdf-btn"
              >
                预览样稿 PDF{{ !pdfSupported ? '（未开启）' : '' }}
              </el-dropdown-item>
              <el-dropdown-item
                v-if="!isReadonly && template?.hasPreviousContent"
                divided
                command="revert"
                data-testid="template-revert-btn"
              >
                撤回上次正文修改
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button
          v-if="isReadonly && template"
          size="small"
          type="primary"
          plain
          data-testid="template-readonly-derive-btn"
          @click="handleDeriveReadonly"
        >
          派生为自定义模板
        </el-button>

        <el-button
          v-if="!isReadonly"
          size="small"
          type="primary"
          :loading="saving"
          :disabled="!dirty || !draft.name.trim()"
          data-testid="template-save-btn"
          @click="handleSave"
        >
          保存模板 <kbd class="save-kbd">⌘S</kbd>
        </el-button>
      </div>
    </header>

    <div v-if="isReadonly" class="readonly-banner" role="alert">
      <span>当前为系统内置只读模板；可直接导出 .sestpl 或下载样稿，如需修改请派生为自定义模板。</span>
      <el-button size="small" type="primary" plain @click="handleDeriveReadonly">派生为自定义模板</el-button>
    </div>

    <div
      v-show="activeTab === 'body'"
      role="tabpanel"
      aria-labelledby="tpl-tab-body"
      class="body-tab"
    >
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

    <div
      v-show="activeTab === 'meta'"
      role="tabpanel"
      aria-labelledby="tpl-tab-meta"
      class="meta-tab tpl-scroller"
    >
      <div class="meta-container">
        <section class="meta-preview-card" aria-label="模板封面摘要">
          <div class="summary-main">
            <div class="summary-code">
              <span class="summary-standard-no">{{ previewStdCode }}</span>
              <span class="ses-stage" :class="draft.defaultStage">
                <i class="dot" />{{ STAGE_LABELS[draft.defaultStage] || draft.defaultStage }}
              </span>
            </div>
            <div class="summary-designation">{{ previewDesignation }}</div>
            <div class="summary-title">{{ draft.name.trim() || '未命名标准模板' }}</div>
            <div class="summary-chips">
              <span class="summary-chip">{{ TYPE_LABELS[draft.baseType] || draft.baseType }}</span>
              <span v-if="draft.coverLayout?.logo?.dataUrl" class="summary-chip accent">含封面徽标</span>
              <span v-if="draft.coverLayout?.topRightMark && draft.coverLayout.topRightMark.mode !== 'default'" class="summary-chip accent">自定义右上角标志</span>
              <span v-if="draft.coverLayout?.notice?.text?.trim()" class="summary-chip accent">含附加声明</span>
              <span v-if="draft.coverLayout?.backCover?.enabled" class="summary-chip accent">含封面背面/版权页</span>
              <span v-if="draft.coverLayout?.watermark?.enabled" class="summary-chip accent">含正文水印</span>
            </div>
          </div>
          <el-button size="small" plain @click="activeTab = 'layout'">
            配置封面与水印版式 →
          </el-button>
        </section>

        <el-form label-position="top" :model="draft" class="meta-form">
          <section class="meta-card">
            <header class="meta-card-head">
              <span class="card-number">01</span>
              <div>
                <h2>模板信息与标准类型</h2>
                <p>模板显示名称、默认标准类别与封面题名规则</p>
              </div>
            </header>
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
            <header class="meta-card-head">
              <span class="card-number">02</span>
              <div>
                <h2>元信息预设（新建标准时自动预填）</h2>
                <p>标准号前缀、分类号、发布/起草等组织固定字段</p>
              </div>
            </header>
            <div class="field-grid">
              <el-form-item label="标准编号前缀（stdPrefix）">
                <el-input v-model="draft.stdPrefix" :disabled="isReadonly || saving" placeholder="例如 T/XXX、Q/XXX" />
              </el-form-item>
              <el-form-item label="备案号">
                <el-input v-model="draft.filingNo" :disabled="isReadonly || saving" placeholder="适用时填写" />
              </el-form-item>
              <el-form-item label="完整标准编号（可选）" class="span-2">
                <el-input
                  v-model="draft.standardNo"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 4 }"
                  :disabled="isReadonly || saving"
                  placeholder="每行填写一个完整标准编号，留空时使用前缀"
                  data-testid="template-standard-no-input"
                />
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
                <el-input
                  v-model="draft.issuer"
                  type="textarea"
                  :autosize="{ minRows: 1, maxRows: 4 }"
                  :disabled="isReadonly || saving"
                  placeholder="每行填写一个发布单位"
                  data-testid="template-issuer-input"
                />
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

    <div
      v-show="activeTab === 'layout'"
      role="tabpanel"
      aria-labelledby="tpl-tab-layout"
      class="layout-tab"
    >
      <div class="layout-left tpl-scroller">
        <el-form label-position="top" class="layout-form" @submit.prevent>
          <CoverLayoutEditor
            v-model="draft.coverLayout"
            :standard-type="draft.baseType"
            :disabled="isReadonly || saving"
          />
        </el-form>
      </div>
      <div ref="layoutRightRef" class="layout-right">
        <div class="preview-header">
          <div class="preview-title-group">
            <span>导出页序预览</span>
            <div class="page-seq-chips">
              <span class="seq-chip">第1页 封面</span>
              <span v-if="draft.coverLayout?.backCover?.enabled" class="seq-chip is-accent">第2页 版权页（不计页码）</span>
              <span v-if="draft.coverLayout?.watermark?.enabled" class="seq-chip is-accent">正文水印示例</span>
            </div>
          </div>
          <div class="preview-zoom-bar" role="group" aria-label="预览缩放比例">
            <button
              type="button"
              class="zoom-btn"
              :class="{ 'is-active': previewZoomMode === 'fit' }"
              data-testid="preview-zoom-fit"
              @click="previewZoomMode = 'fit'"
            >
              适应({{ Math.round(fitZoom * 100) }}%)
            </button>
            <button
              v-for="zoom in PREVIEW_ZOOM_OPTIONS"
              :key="zoom"
              type="button"
              class="zoom-btn"
              :class="{ 'is-active': previewZoomMode === zoom }"
              :data-testid="`preview-zoom-${Math.round(zoom * 100)}`"
              @click="previewZoomMode = zoom"
            >
              {{ Math.round(zoom * 100) }}%
            </button>
          </div>
        </div>
        <iframe
          class="preview-frame"
          sandbox=""
          :srcdoc="previewHtml"
          title="封面与版式实时预览"
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
import { ArrowDown, ArrowLeft, MoreFilled } from '@element-plus/icons-vue'
import {
  COVER_LAYOUT_PRINT_CSS,
  COVER_PRINT_CSS,
  JOINT_COVER_PRINT_CSS,
  PDF_EXPORT_DISABLED_MESSAGE,
  PDF_EXPORT_ENABLED,
  STANDARD_TYPE_PREFIXES,
  cloneCoverLayout,
  createDefaultDocumentContent,
  downgradeCoverLayoutForStandardType,
  getCoverDesignation,
  getCoverDesignationParts,
  irMetaFromDocumentMeta,
  metadataLines,
  renderBackCoverHtml,
  renderCoverHtml,
  renderWatermarkPreviewHtml,
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

type TabId = 'body' | 'meta' | 'layout'

const TAB_DEFS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'body', label: '正文骨架' },
  { id: 'meta', label: '模板与元信息预设' },
  { id: 'layout', label: '封面与封底版式' },
]

interface TemplateDraft {
  name: string
  description: string
  baseType: StandardType
  defaultStage: DocumentStage
  stdPrefix: string
  standardNo: string
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
const activeTab = ref<TabId>('body')
const tabButtonRefs = ref<Array<HTMLButtonElement | null>>([])
const template = ref<StandardTemplate | null>(null)
const bodyDirty = ref(false)
const capabilities = ref<{ htmlToPdf: boolean }>({ htmlToPdf: false })

function setTabRef(idx: number, el: unknown): void {
  tabButtonRefs.value[idx] = el instanceof HTMLButtonElement ? el : null
}

function onTabKeydown(event: KeyboardEvent): void {
  const currentIdx = TAB_DEFS.findIndex((t) => t.id === activeTab.value)
  let nextIdx = -1
  if (event.key === 'ArrowRight') nextIdx = (currentIdx + 1) % TAB_DEFS.length
  else if (event.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + TAB_DEFS.length) % TAB_DEFS.length
  else if (event.key === 'Home') nextIdx = 0
  else if (event.key === 'End') nextIdx = TAB_DEFS.length - 1
  if (nextIdx < 0) return

  event.preventDefault()
  const targetTab = TAB_DEFS[nextIdx]
  if (!targetTab) return
  activeTab.value = targetTab.id
  tabButtonRefs.value[nextIdx]?.focus()
}

function emptyDraft(): TemplateDraft {
  return {
    name: '',
    description: '',
    baseType: 'national',
    defaultStage: 'working_draft',
    stdPrefix: '',
    standardNo: '',
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

function sameMetaOnly(a: TemplateDraft, b: TemplateDraft): boolean {
  return a.name === b.name
    && a.description === b.description
    && a.baseType === b.baseType
    && a.defaultStage === b.defaultStage
    && a.stdPrefix === b.stdPrefix
    && a.standardNo === b.standardNo
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
}

const metaOnlyDirty = computed(() => !sameMetaOnly(draft.value, baseline.value))
const layoutDirty = computed(() => !sameCoverLayout(draft.value.coverLayout, baseline.value.coverLayout))
const tabDirtyMap = computed<Record<TabId, boolean>>(() => ({
  body: bodyDirty.value,
  meta: metaOnlyDirty.value,
  layout: layoutDirty.value,
}))
const dirty = computed(() => !isReadonly.value && (bodyDirty.value || metaOnlyDirty.value || layoutDirty.value))

const pdfSupported = computed(() => PDF_EXPORT_ENABLED && capabilities.value.htmlToPdf)

const previewStdCode = computed(() => metadataLines(draft.value.standardNo).join('\n')
  || `${draft.value.stdPrefix.trim() || STANDARD_TYPE_PREFIXES[draft.value.baseType]} XXXXX—2026`)

function buildPresetMeta(): DocumentMeta {
  const inherited = template.value?.defaultMeta
  return {
    standardType: draft.value.baseType,
    titleCn: draft.value.name || '标准名称示例',
    titleEn: inherited?.titleEn || undefined,
    standardNo: previewStdCode.value,
    publishDate: inherited?.publishDate || undefined,
    implementDate: inherited?.implementDate || undefined,
    icsCode: draft.value.icsCode || undefined,
    ccsCode: draft.value.ccsCode || undefined,
    proposer: draft.value.proposer || undefined,
    technicalCommittee: draft.value.technicalCommittee || undefined,
    issuer: metadataLines(draft.value.issuer).join('\n') || undefined,
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

const previewDesignation = computed(() => {
  const irMeta: IRDocMeta = {
    standardType: 'gb',
    ...irMetaFromDocumentMeta(buildPresetMeta()),
  }
  return getCoverDesignation(irMeta)
})

const bodyEditSeq = ref(0)

const editorCore = useStandardEditorCore({
  onUpdate: () => {
    if (!isReadonly.value) {
      bodyEditSeq.value += 1
      bodyDirty.value = true
    }
  },
  onSaveShortcut: () => {
    void handleSave()
  },
  getForewordMeta: () => buildPresetMeta(),
  getUnavailable: () => isReadonly.value,
  getResourceKey: () => routeId.value,
})
const { editor, hasUnappliedLandscapeEdits } = editorCore

const PREVIEW_ZOOM_OPTIONS = [0.4, 0.5, 0.65, 0.85, 1] as const
const previewZoomMode = ref<'fit' | number>('fit')
const layoutRightRef = ref<HTMLElement | null>(null)
const fitZoom = ref(0.5)

const previewZoom = computed(() => (previewZoomMode.value === 'fit' ? fitZoom.value : previewZoomMode.value))

function updateFitZoom(paneWidth: number): void {
  if (!paneWidth) return
  const next = Math.min(0.9, Math.max(0.35, Math.round(((paneWidth - 48) / 794) * 100) / 100))
  fitZoom.value = next
}

function wrapPreviewPages(html: string): string[] {
  const matches = html.match(/<section\b[\s\S]*?<\/section>/g)
  return matches && matches.length > 0 ? matches : [html]
}

const previewHtml = computed(() => {
  const irMeta: IRDocMeta = {
    standardType: 'gb',
    ...irMetaFromDocumentMeta(buildPresetMeta()),
  }
  const coverHtml = renderCoverHtml(irMeta, draft.value.defaultStage, draft.value.coverLayout)
  const wmHtml = draft.value.coverLayout?.watermark?.enabled
    ? renderWatermarkPreviewHtml(irMeta, draft.value.coverLayout.watermark)
    : ''
  const backHtml = draft.value.coverLayout?.backCover?.enabled
    ? renderBackCoverHtml(irMeta, draft.value.coverLayout.backCover)
    : ''
  const zoom = previewZoom.value
  const pageSlots = [
    ...wrapPreviewPages(coverHtml),
    ...(backHtml ? wrapPreviewPages(backHtml) : []),
    ...(wmHtml ? wrapPreviewPages(wmHtml) : []),
  ]
    .map((page) => `<div class="ses-page-slot"><div class="ses-page-scale">${page}</div></div>`)
    .join('')

  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<style>',
    'html{color-scheme:light;}',
    COVER_PRINT_CSS,
    JOINT_COVER_PRINT_CSS,
    COVER_LAYOUT_PRINT_CSS,
    'body{margin:0;padding:18px;background:transparent;display:flex;flex-direction:column;align-items:center;gap:18px;min-height:100vh;box-sizing:border-box;}',
    `.ses-page-slot{width:calc(210mm * ${zoom});height:calc(297mm * ${zoom});position:relative;flex:0 0 auto;background:#fff;color:#111;box-shadow:0 8px 26px rgba(15,23,42,.18);border-radius:2px;overflow:hidden;}`,
    `.ses-page-scale{width:210mm;height:297mm;transform:scale(${zoom});transform-origin:top left;background:#fff;color:#111;}`,
    'section.ses-cover,section.ses-back-cover,section.ses-body-preview{background:#fff;color:#111;width:210mm;height:297mm;min-height:297mm;margin:0;box-sizing:border-box;position:relative;}',
    '</style></head><body>',
    pageSlots,
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
    standardNo: dm.standardNo ?? '',
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
    editorCore.setSuppressUpdate(true)
    try {
      replaceEditorDocument(currentEditor, content, true, false)
    } finally {
      editorCore.setSuppressUpdate(false)
    }
    currentEditor.setEditable(!tpl.readonly, false)
  }
}

const EDITABLE_DEFAULT_META_KEYS = [
  'stdPrefix',
  'standardNo',
  'icsCode',
  'ccsCode',
  'proposer',
  'technicalCommittee',
  'issuer',
  'applicant',
  'replaces',
  'consistency',
  'filingNo',
  'industryName',
  'regionName',
  'coverDesignation',
] as const

function defaultMetaFromDraft(d: TemplateDraft, existing?: TemplateDefaultMeta): TemplateDefaultMeta {
  const out: TemplateDefaultMeta = existing ? JSON.parse(JSON.stringify(existing)) : {}
  if (out.standardType !== undefined) {
    out.standardType = d.baseType
  }
  for (const key of EDITABLE_DEFAULT_META_KEYS) {
    const trimmed = key === 'standardNo' || key === 'issuer' ? metadataLines(d[key]).join('\n') : d[key].trim()
    if (trimmed) out[key] = trimmed
    else delete out[key]
  }
  return out
}

function onBaseTypeChange(type: StandardType) {
  designationDraft.changeType(type)
  const { coverLayout, downgraded } = downgradeCoverLayoutForStandardType(draft.value.coverLayout, type)
  if (downgraded) {
    draft.value.coverLayout = coverLayout
    ElMessage.warning('国家标准和指导性技术文件禁止修改或替换右上角标志，已自动恢复默认标志并将徽标位置调整为左上角。')
  }
}

function insertPlaceholder(token: string) {
  if (!editor.value || isReadonly.value) return
  editor.value.chain().focus().insertContent(token).run()
}

function onMoreCommand(command: string) {
  if (command === 'export-pkg') void handleExportPackage()
  else if (command === 'preview-pdf') void handlePreviewPdf()
  else if (command === 'revert') void handleRevert()
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
  const submittedBodySeq = bodyEditSeq.value
  const submittedDraft: TemplateDraft = {
    ...draft.value,
    coverLayout: cloneCoverLayout(draft.value.coverLayout),
  }
  try {
    const updated = await templateStore.updateTemplate(current.id, {
      baseRevision: current.revision,
      name: submittedDraft.name.trim(),
      description: submittedDraft.description.trim(),
      baseType: submittedDraft.baseType,
      defaultStage: submittedDraft.defaultStage,
      defaultMeta: defaultMetaFromDraft(submittedDraft, current.defaultMeta),
      coverLayout: cloneCoverLayout(submittedDraft.coverLayout) ?? null,
      content: currentEditor.getJSON() as Record<string, unknown>,
    })

    template.value = updated
    const savedDraft = draftFromTemplate(updated)
    baseline.value = { ...savedDraft, coverLayout: cloneCoverLayout(savedDraft.coverLayout) }
    lastSaved.value = updated.updatedAt ? new Date(updated.updatedAt).toLocaleTimeString('zh-CN') : ''

    if (sameMetaOnly(draft.value, submittedDraft)) {
      const preservedLayout = cloneCoverLayout(draft.value.coverLayout)
      draft.value = { ...savedDraft, coverLayout: preservedLayout }
    }
    if (sameCoverLayout(draft.value.coverLayout, submittedDraft.coverLayout)) {
      draft.value.coverLayout = cloneCoverLayout(savedDraft.coverLayout)
    }
    if (bodyEditSeq.value === submittedBodySeq) {
      bodyDirty.value = false
    }

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

function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (!isReadonly.value && dirty.value) void handleSave()
  }
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

let previewResizeObserver: ResizeObserver | null = null

onMounted(async () => {
  window.addEventListener('beforeunload', guardBeforeUnload)
  window.addEventListener('keydown', onGlobalKeydown)

  if (typeof ResizeObserver !== 'undefined' && layoutRightRef.value) {
    updateFitZoom(layoutRightRef.value.clientWidth)
    previewResizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0
      updateFitZoom(width)
    })
    previewResizeObserver.observe(layoutRightRef.value)
  }

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
  window.removeEventListener('keydown', onGlobalKeydown)
  previewResizeObserver?.disconnect()
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
  gap: 12px;
  min-height: 52px;
  padding: 0 16px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  flex-shrink: 0;
}

.nav-l, .nav-r {
  display: flex;
  align-items: center;
  gap: 8px;
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
  flex-shrink: 0;
}

.tpl-crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}

.tpl-crumb:hover {
  background: var(--ses-surface-2);
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
  flex-shrink: 0;
}

.ed-tabs {
  display: inline-flex;
  padding: 3px;
  background: var(--ses-surface-2);
  border-radius: 8px;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.ed-tab {
  position: relative;
  border: 0;
  background: transparent;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ses-ink-3);
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}

.ed-tab:hover {
  color: var(--ses-ink);
}

.ed-tab[aria-selected="true"] {
  background: var(--ses-surface);
  color: var(--ses-ink);
}

/* 非纯色激活指示：高对比/强制颜色模式下依然保留底部指示线，且不改变尺寸 */
.ed-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset: auto 10px 0;
  border-block-end: 2px solid var(--ses-accent);
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

.save-kbd {
  margin-left: 6px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.35);
  color: inherit;
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

.tpl-scroller {
  --scrollbar-thumb: var(--ses-ink-4);
  --scrollbar-track: transparent;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  scrollbar-gutter: stable;
}

@supports not (scrollbar-color: auto) {
  .tpl-scroller {
    scrollbar-width: auto;
  }
  .tpl-scroller::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .tpl-scroller::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 4px;
  }
  .tpl-scroller::-webkit-scrollbar-track {
    background: var(--scrollbar-track);
  }
}

.meta-tab {
  container-type: inline-size;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px 20px 48px;
}

.meta-container {
  max-width: 860px;
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.meta-preview-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border: 1px solid var(--ses-line);
  border-radius: 12px;
  background: linear-gradient(135deg, var(--ses-surface) 0%, color-mix(in oklch, var(--ses-accent-soft) 45%, var(--ses-surface)) 100%);
  box-shadow: var(--ses-shadow-1);
}

.summary-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.summary-code {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--ses-font-mono);
  font-size: 12px;
  color: var(--ses-ink-3);
}

.summary-designation {
  font-size: 12px;
  color: var(--ses-ink-3);
}

.summary-standard-no {
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.summary-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ses-ink);
}

.summary-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.summary-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-2);
  font-size: 11px;
  font-weight: 500;
}

.summary-chip.accent {
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
  font-weight: 600;
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

.meta-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.card-number {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
  font-family: var(--ses-font-mono);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.meta-card-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: var(--ses-ink);
}

.meta-card-head p {
  margin: 2px 0 0;
  font-size: 11.5px;
  color: var(--ses-ink-4);
}

.field-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0 16px;
}

@container (min-width: 560px) {
  .field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
  grid-template-columns: minmax(420px, 46%) minmax(380px, 54%);
}

.layout-left {
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px 18px 36px;
  border-right: 1px solid var(--ses-line);
  background: var(--ses-surface);
}

.layout-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background-color: color-mix(in oklch, var(--ses-bg) 88%, var(--ses-ink) 7%);
  background-image: radial-gradient(color-mix(in oklch, var(--ses-ink) 14%, transparent) 1px, transparent 1px);
  background-size: 16px 16px;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 10px;
  padding: 8px 14px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  font-size: 12px;
  font-weight: 600;
  color: var(--ses-ink-2);
}

.preview-title-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.page-seq-chips {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.seq-chip {
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
  font-size: 10.5px;
  font-weight: 500;
}

.seq-chip.is-accent {
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
  font-weight: 600;
}

.preview-zoom-bar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--ses-line);
  border-radius: 6px;
  background: var(--ses-surface-2);
  flex-shrink: 0;
}

.zoom-btn {
  border: 0;
  background: transparent;
  padding: 3px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--ses-ink-3);
  cursor: pointer;
  white-space: nowrap;
}

.zoom-btn:hover {
  color: var(--ses-ink);
}

.zoom-btn.is-active {
  background: var(--ses-surface);
  color: var(--ses-accent);
  font-weight: 600;
  box-shadow: var(--ses-shadow-1);
}

.preview-frame {
  flex: 1;
  width: 100%;
  border: 0;
  background: transparent;
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
  .layout-left {
    border-right: 0;
    border-bottom: 1px solid var(--ses-line);
  }
  .meta-preview-card {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
