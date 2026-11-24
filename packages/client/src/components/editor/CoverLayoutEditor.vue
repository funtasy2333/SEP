<template>
  <div class="cover-layout-editor" data-testid="cover-layout-editor">
    <div class="layout-block">
      <div class="block-head">
        <div>
          <h3>封面徽标</h3>
          <p>支持 PNG / JPEG（≤ 2 MB），仅在打印与导出 DOCX / PDF 时生效。</p>
        </div>
        <div class="block-actions">
          <input
            ref="fileInputRef"
            type="file"
            accept="image/png,image/jpeg"
            class="sr-only-input"
            data-testid="cover-logo-file-input"
            :disabled="disabled"
            @change="onFileSelected"
          />
          <el-button size="small" :disabled="disabled" data-testid="cover-logo-upload-btn" @click="triggerFilePicker">
            {{ logo ? '更换徽标' : '上传徽标' }}
          </el-button>
          <el-button
            v-if="logo"
            size="small"
            plain
            type="danger"
            :disabled="disabled"
            data-testid="cover-logo-clear-btn"
            @click="clearLogo"
          >
            清除徽标
          </el-button>
        </div>
      </div>

      <p v-if="uploadError" class="inline-error" role="alert" data-testid="cover-logo-error">{{ uploadError }}</p>

      <div v-if="logo" class="logo-config">
        <div class="logo-preview-box">
          <img :src="logo.dataUrl" :alt="logo.alt || '封面徽标预览'" class="logo-thumb" />
        </div>
        <div class="logo-fields">
          <el-form-item label="徽标位置">
            <el-radio-group
              :model-value="logo.position"
              :disabled="disabled"
              data-testid="cover-logo-position"
              @update:model-value="(val: string | number | boolean | undefined) => updateLogoPosition(val as CoverLogoPosition)"
            >
              <el-radio-button value="top_left">左上角独立徽标</el-radio-button>
              <el-radio-button value="center">封面居中下方</el-radio-button>
              <el-radio-button value="replace_mark" :disabled="replaceMarkBlocked">替换右上角标志</el-radio-button>
            </el-radio-group>
            <div v-if="replaceMarkBlocked" class="field-hint is-warn" data-testid="replace-mark-hint">
              国家标准与指导性技术文件受法定版式限制，禁止替换右上角 GB 标志。
            </div>
          </el-form-item>

          <div class="size-row">
            <el-form-item label="宽度 (mm)">
              <el-input-number
                :model-value="logo.widthMm"
                :min="COVER_LOGO_MIN_MM"
                :max="COVER_LOGO_MAX_WIDTH_MM"
                :precision="1"
                :step="1"
                :disabled="disabled"
                controls-position="right"
                data-testid="cover-logo-width"
                @update:model-value="(val: number | undefined) => updateLogoDimension('widthMm', val)"
              />
            </el-form-item>
            <el-form-item label="高度 (mm)">
              <el-input-number
                :model-value="logo.heightMm"
                :min="COVER_LOGO_MIN_MM"
                :max="COVER_LOGO_MAX_HEIGHT_MM"
                :precision="1"
                :step="1"
                :disabled="disabled"
                controls-position="right"
                data-testid="cover-logo-height"
                @update:model-value="(val: number | undefined) => updateLogoDimension('heightMm', val)"
              />
            </el-form-item>
            <el-form-item label="替代文本（可选）" class="alt-field">
              <el-input
                :model-value="logo.alt ?? ''"
                :disabled="disabled"
                maxlength="120"
                placeholder="例如：团体徽标"
                @update:model-value="(val: string) => updateLogoAlt(val)"
              />
            </el-form-item>
          </div>
        </div>
      </div>
    </div>

    <div class="layout-block">
      <div class="block-head">
        <div>
          <h3>封面附加声明</h3>
          <p>用于在封面补充版权归属、内部受控或试用说明，留空则不显示。</p>
        </div>
      </div>
      <div class="notice-grid">
        <el-form-item label="声明内容">
          <el-input
            type="textarea"
            :rows="2"
            :maxlength="COVER_NOTICE_MAX_LENGTH"
            show-word-limit
            :disabled="disabled"
            :model-value="noticeText"
            placeholder="例如：本文件仅供试点单位内部试用，未经许可不得翻印。"
            data-testid="cover-notice-text"
            @update:model-value="updateNoticeText"
          />
        </el-form-item>
        <el-form-item label="声明位置">
          <el-radio-group
            :model-value="noticePosition"
            :disabled="disabled"
            data-testid="cover-notice-position"
            @update:model-value="(val: string | number | boolean | undefined) => updateNoticePosition(val as CoverNoticePosition)"
          >
            <el-radio-button value="above_dates">发布/实施日期上方</el-radio-button>
            <el-radio-button value="below_issuer">发布单位下方</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </div>
    </div>

    <div class="layout-block">
      <div class="block-head">
        <div>
          <h3>独立封底 / 版权页</h3>
          <p>启用后在标准正文与附录结束线之后追加独立末页，自动隐藏页眉、页脚与页码。</p>
        </div>
        <el-switch
          :model-value="Boolean(modelValue?.backCover?.enabled)"
          :disabled="disabled"
          active-text="启用封底"
          data-testid="back-cover-switch"
          @update:model-value="(val: string | number | boolean) => toggleBackCover(Boolean(val))"
        />
      </div>

      <div v-if="modelValue?.backCover?.enabled" class="back-cover-fields">
        <el-form-item label="封底标题">
          <el-input
            :model-value="modelValue.backCover.title ?? ''"
            :maxlength="BACK_COVER_FIELD_MAX_LENGTH"
            :disabled="disabled"
            placeholder="例如：版权与出版信息"
            data-testid="back-cover-title"
            @update:model-value="(val: string) => updateBackCoverField('title', val)"
          />
        </el-form-item>
        <el-form-item label="版权声明">
          <el-input
            type="textarea"
            :rows="2"
            :model-value="modelValue.backCover.copyrightNotice ?? ''"
            :maxlength="BACK_COVER_FIELD_MAX_LENGTH"
            :disabled="disabled"
            placeholder="例如：© 2026 归口单位 版权所有"
            data-testid="back-cover-copyright"
            @update:model-value="(val: string) => updateBackCoverField('copyrightNotice', val)"
          />
        </el-form-item>
        <div class="two-col">
          <el-form-item label="出版 / 组织说明">
            <el-input
              :model-value="modelValue.backCover.publisherInfo ?? ''"
              :maxlength="BACK_COVER_FIELD_MAX_LENGTH"
              :disabled="disabled"
              placeholder="例如：由标准化技术委员会归口组织编写"
              @update:model-value="(val: string) => updateBackCoverField('publisherInfo', val)"
            />
          </el-form-item>
          <el-form-item label="联系方式 / 地址">
            <el-input
              :model-value="modelValue.backCover.contactInfo ?? ''"
              :maxlength="BACK_COVER_FIELD_MAX_LENGTH"
              :disabled="disabled"
              placeholder="例如：std@example.org / 北京市海淀区"
              @update:model-value="(val: string) => updateBackCoverField('contactInfo', val)"
            />
          </el-form-item>
        </div>
        <el-form-item label="附加备注">
          <el-input
            type="textarea"
            :rows="2"
            :model-value="modelValue.backCover.note ?? ''"
            :maxlength="BACK_COVER_FIELD_MAX_LENGTH"
            :disabled="disabled"
            placeholder="可选的版次、印次或反馈说明"
            @update:model-value="(val: string) => updateBackCoverField('note', val)"
          />
        </el-form-item>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  BACK_COVER_FIELD_MAX_LENGTH,
  COVER_LOGO_ALLOWED_MIMES,
  COVER_LOGO_MAX_BYTES,
  COVER_LOGO_MAX_HEIGHT_MM,
  COVER_LOGO_MAX_WIDTH_MM,
  COVER_LOGO_MIN_MM,
  COVER_NOTICE_MAX_LENGTH,
  cloneCoverLayout,
  isReplaceMarkForbidden,
  parseCoverLogoDataUrl,
  validateCoverLayout,
  type BackCoverConfig,
  type CoverLayoutConfig,
  type CoverLogoConfig,
  type CoverLogoPosition,
  type CoverNoticePosition,
} from '@ses/shared'

const props = defineProps<{
  modelValue?: CoverLayoutConfig
  standardType: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: CoverLayoutConfig | undefined): void
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploadError = ref('')
const preferredNoticePosition = ref<CoverNoticePosition>(props.modelValue?.notice?.position ?? 'above_dates')

watch(
  () => props.modelValue?.notice?.position,
  (pos) => {
    if (pos) preferredNoticePosition.value = pos
  },
)

const logo = computed(() => props.modelValue?.logo)
const noticeText = computed(() => props.modelValue?.notice?.text ?? '')
const noticePosition = computed<CoverNoticePosition>(
  () => props.modelValue?.notice?.position ?? preferredNoticePosition.value,
)
const replaceMarkBlocked = computed(() => isReplaceMarkForbidden(props.standardType))

function emitNormalized(next: CoverLayoutConfig | undefined): void {
  if (!next) {
    emit('update:modelValue', undefined)
    return
  }
  const cleaned: CoverLayoutConfig = {}
  if (next.logo && next.logo.dataUrl) {
    cleaned.logo = { ...next.logo }
  }
  if (next.notice && next.notice.text.trim().length > 0) {
    cleaned.notice = {
      text: next.notice.text,
      position: next.notice.position,
    }
  }
  if (next.backCover?.enabled) {
    const bc: BackCoverConfig = { enabled: true }
    if (next.backCover.title) bc.title = next.backCover.title
    if (next.backCover.copyrightNotice) bc.copyrightNotice = next.backCover.copyrightNotice
    if (next.backCover.publisherInfo) bc.publisherInfo = next.backCover.publisherInfo
    if (next.backCover.contactInfo) bc.contactInfo = next.backCover.contactInfo
    if (next.backCover.note) bc.note = next.backCover.note
    cleaned.backCover = bc
  }
  emit('update:modelValue', Object.keys(cleaned).length > 0 ? cleaned : undefined)
}

function triggerFilePicker(): void {
  uploadError.value = ''
  fileInputRef.value?.click()
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10
}

function computeLogoSizeMm(naturalWidth: number, naturalHeight: number): { widthMm: number; heightMm: number } {
  if (!naturalWidth || !naturalHeight) {
    return { widthMm: 28, heightMm: 14 }
  }
  const ratio = naturalWidth / naturalHeight
  let widthMm = 28
  let heightMm = widthMm / ratio
  if (heightMm > COVER_LOGO_MAX_HEIGHT_MM) {
    heightMm = COVER_LOGO_MAX_HEIGHT_MM
    widthMm = heightMm * ratio
  }
  if (widthMm > COVER_LOGO_MAX_WIDTH_MM) {
    widthMm = COVER_LOGO_MAX_WIDTH_MM
    heightMm = widthMm / ratio
  }
  if (heightMm < COVER_LOGO_MIN_MM) {
    heightMm = COVER_LOGO_MIN_MM
    widthMm = Math.min(COVER_LOGO_MAX_WIDTH_MM, heightMm * ratio)
  }
  if (widthMm < COVER_LOGO_MIN_MM) {
    widthMm = COVER_LOGO_MIN_MM
    heightMm = Math.min(COVER_LOGO_MAX_HEIGHT_MM, widthMm / ratio)
  }
  return {
    widthMm: clamp(widthMm, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_WIDTH_MM),
    heightMm: clamp(heightMm, COVER_LOGO_MIN_MM, COVER_LOGO_MAX_HEIGHT_MM),
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('读取图片失败'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ width: 0, height: 0 })
      return
    }
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = dataUrl
  })
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!(COVER_LOGO_ALLOWED_MIMES as readonly string[]).includes(file.type)) {
    uploadError.value = '仅支持 PNG 或 JPEG 图片作为封面徽标。'
    return
  }
  if (file.size > COVER_LOGO_MAX_BYTES) {
    uploadError.value = '封面徽标文件大小不能超过 2 MB。'
    return
  }

  try {
    const dataUrl = await readFileAsDataUrl(file)
    const parsed = parseCoverLogoDataUrl(dataUrl)
    if (!parsed || parsed.bytes > COVER_LOGO_MAX_BYTES) {
      uploadError.value = '封面徽标须为 2 MB 以内的有效 PNG / JPEG 图片。'
      return
    }
    const existing = props.modelValue?.logo
    const dims = await readImageDimensions(dataUrl)
    const computedSize = computeLogoSizeMm(dims.width, dims.height)
    const defaultPos: CoverLogoPosition = existing?.position
      ? existing.position
      : replaceMarkBlocked.value
        ? 'top_left'
        : 'top_left'

    const nextLogo: CoverLogoConfig = {
      dataUrl,
      position: replaceMarkBlocked.value && defaultPos === 'replace_mark' ? 'top_left' : defaultPos,
      widthMm: computedSize.widthMm,
      heightMm: computedSize.heightMm,
      ...(existing?.alt ? { alt: existing.alt } : {}),
    }

    const base = cloneCoverLayout(props.modelValue) ?? {}
    base.logo = nextLogo
    const validation = validateCoverLayout(base, props.standardType)
    if (!validation.valid) {
      uploadError.value = validation.errors[0]?.message ?? '封面徽标参数校验失败。'
      return
    }
    uploadError.value = ''
    emitNormalized(base)
  } catch {
    uploadError.value = '读取封面徽标图片失败，请重试。'
  }
}

function clearLogo(): void {
  uploadError.value = ''
  const next = cloneCoverLayout(props.modelValue)
  if (!next) return
  delete next.logo
  emitNormalized(next)
}

function updateLogoPosition(position: CoverLogoPosition): void {
  if (!logo.value) return
  if (position === 'replace_mark' && replaceMarkBlocked.value) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.logo = { ...logo.value, position }
  emitNormalized(next)
}

function updateLogoDimension(field: 'widthMm' | 'heightMm', value: number | undefined): void {
  if (!logo.value || typeof value !== 'number' || !Number.isFinite(value)) return
  const max = field === 'widthMm' ? COVER_LOGO_MAX_WIDTH_MM : COVER_LOGO_MAX_HEIGHT_MM
  const clamped = clamp(value, COVER_LOGO_MIN_MM, max)
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.logo = { ...logo.value, [field]: clamped }
  emitNormalized(next)
}

function updateLogoAlt(alt: string): void {
  if (!logo.value) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  const updated: CoverLogoConfig = { ...logo.value }
  if (alt.trim()) updated.alt = alt
  else delete updated.alt
  next.logo = updated
  emitNormalized(next)
}

function updateNoticeText(text: string): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  if (text.trim().length > 0) {
    next.notice = {
      text,
      position: noticePosition.value,
    }
  } else {
    delete next.notice
  }
  emitNormalized(next)
}

function updateNoticePosition(position: CoverNoticePosition): void {
  preferredNoticePosition.value = position
  if (!props.modelValue?.notice?.text?.trim()) return
  const next = cloneCoverLayout(props.modelValue) ?? {}
  next.notice = {
    text: props.modelValue.notice.text,
    position,
  }
  emitNormalized(next)
}

function toggleBackCover(enabled: boolean): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  if (enabled) {
    next.backCover = {
      ...(next.backCover ?? {}),
      enabled: true,
    }
  } else {
    delete next.backCover
  }
  emitNormalized(next)
}

function updateBackCoverField(
  field: 'title' | 'copyrightNotice' | 'publisherInfo' | 'contactInfo' | 'note',
  value: string,
): void {
  const next = cloneCoverLayout(props.modelValue) ?? {}
  const current: BackCoverConfig = {
    ...(next.backCover ?? { enabled: true }),
    enabled: true,
  }
  if (value.length > 0) {
    current[field] = value
  } else {
    delete current[field]
  }
  next.backCover = current
  emitNormalized(next)
}
</script>

<style scoped>
.cover-layout-editor {
  display: grid;
  gap: 16px;
  padding-top: 14px;
}

.layout-block {
  padding: 13px 14px;
  border: 1px solid var(--ses-line);
  border-radius: 10px;
  background: color-mix(in oklch, var(--ses-bg) 45%, var(--ses-surface));
}

.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.block-head h3 {
  margin: 0;
  color: var(--ses-ink);
  font-size: 12px;
  font-weight: 650;
}

.block-head p {
  margin: 3px 0 0;
  color: var(--ses-ink-4);
  font-size: 10.5px;
  line-height: 1.5;
}

.block-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.sr-only-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.inline-error {
  margin: 10px 0 0;
  color: var(--ses-err);
  font-size: 11px;
}

.logo-config {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-top: 12px;
}

.logo-preview-box {
  width: 88px;
  height: 68px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 6px;
  border: 1px dashed var(--ses-line);
  border-radius: 8px;
  background: var(--ses-surface);
}

.logo-thumb {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.logo-fields {
  flex: 1 1 auto;
  min-width: 0;
}

.size-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(110px, 140px)) minmax(0, 1fr);
  gap: 10px;
}

.field-hint.is-warn {
  margin-top: 4px;
  color: var(--ses-warn);
  font-size: 10.5px;
}

.notice-grid,
.back-cover-fields {
  margin-top: 12px;
}

.two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 720px) {
  .logo-config,
  .two-col,
  .size-row {
    grid-template-columns: minmax(0, 1fr);
    flex-direction: column;
  }
}
</style>
