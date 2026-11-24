<template>
  <el-dialog
    :model-value="modelValue"
    title="导入的模板与本地已有模板同 UID"
    width="min(680px, calc(100vw - 24px))"
    align-center
    @update:model-value="onDialogVisibleChange"
  >
    <div v-if="preview?.existing" class="import-preview" data-testid="template-import-diff">
      <p class="conflict-intro">
        本地已有模板「<strong>{{ preview.existing.name }}</strong>」（UID：<code>{{ preview.existing.uid }}</code>），与导入的「<strong>{{ preview.incoming.name }}</strong>」标识一致。
      </p>

      <div class="meta-compare">
        <div class="meta-row">
          <span class="meta-k">类别 / 阶段</span>
          <span class="meta-v">
            本地：{{ TYPE_LABELS[preview.existing.baseType] || preview.existing.baseType }} · {{ STAGE_LABELS[preview.existing.defaultStage] || preview.existing.defaultStage }}
            →
            导入：{{ TYPE_LABELS[preview.incoming.baseType] || preview.incoming.baseType }} · {{ STAGE_LABELS[preview.incoming.defaultStage] || preview.incoming.defaultStage }}
          </span>
        </div>
        <div class="meta-row">
          <span class="meta-k">版式扩展差异</span>
          <span class="meta-v">{{ coverLayoutDiffSummary }}</span>
        </div>
      </div>

      <div v-if="contentDiff" class="diff-section">
        <div class="diff-head">
          <span>正文骨架差异</span>
          <span class="diff-stats" data-testid="template-import-diff-stats">
            <em class="stat-add">+{{ contentDiff.stats.added }}</em>
            <em class="stat-del">-{{ contentDiff.stats.removed }}</em>
            <em class="stat-keep">未变 {{ contentDiff.stats.unchanged }} 行</em>
          </span>
        </div>
        <div class="diff-lines">
          <div v-if="changedLines.length === 0" class="diff-empty">正文骨架完全一致</div>
          <div
            v-for="(line, idx) in changedLines"
            :key="idx"
            class="diff-line"
            :class="`is-${line.type}`"
          >
            <span class="diff-prefix">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>
            <span class="diff-text">{{ line.text || '（空行）' }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button :disabled="applying" @click="choose(null)">取消</el-button>
      <el-button :disabled="applying" data-testid="template-import-new-btn" @click="choose('new')">
        另存为新模板
      </el-button>
      <el-button type="primary" :loading="applying" data-testid="template-import-update-btn" @click="choose('update')">
        更新现有模板
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { hasActiveCoverLayout } from '@ses/shared'
import type { TemplateImportPreview } from '@/api/template'
import { diffDocuments } from '@/utils/docDiff'
import { STAGE_LABELS, TYPE_LABELS } from '@/constants/standards'

const props = defineProps<{
  modelValue: boolean
  preview: TemplateImportPreview | null
  applying?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'choose', mode: 'update' | 'new' | null): void
}>()

const contentDiff = computed(() => {
  if (!props.preview?.existing) return null
  return diffDocuments(props.preview.existing.content, props.preview.incoming.content)
})

const changedLines = computed(() => {
  if (!contentDiff.value) return []
  return contentDiff.value.lines.filter((line) => line.type !== 'unchanged').slice(0, 60)
})

const coverLayoutDiffSummary = computed(() => {
  const existing = props.preview?.existing?.coverLayout
  const incoming = props.preview?.incoming?.coverLayout
  if (JSON.stringify(existing ?? null) === JSON.stringify(incoming ?? null)) {
    return hasActiveCoverLayout(incoming) ? '两者封面徽标/声明/封底配置一致' : '均未启用自定义封面与封底'
  }
  const describe = (cfg?: typeof incoming) => {
    const parts: string[] = []
    if (cfg?.logo?.dataUrl) parts.push(`徽标(${cfg.logo.position})`)
    if (cfg?.notice?.text?.trim()) parts.push('附加声明')
    if (cfg?.backCover?.enabled) parts.push('独立封底')
    return parts.length > 0 ? parts.join('、') : '无'
  }
  return `本地：${describe(existing)} → 导入：${describe(incoming)}`
})

function choose(mode: 'update' | 'new' | null) {
  emit('choose', mode)
}

function onDialogVisibleChange(value: boolean) {
  if (!value) {
    emit('choose', null)
  }
  emit('update:modelValue', value)
}
</script>

<style scoped>
.import-preview {
  display: grid;
  gap: 12px;
}

.conflict-intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ses-ink-2);
}

.meta-compare {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--ses-line);
  border-radius: 8px;
  background: var(--ses-surface-2);
  font-size: 12px;
}

.meta-row {
  display: flex;
  gap: 10px;
}

.meta-k {
  flex: 0 0 92px;
  color: var(--ses-ink-4);
  font-weight: 600;
}

.meta-v {
  color: var(--ses-ink-2);
}

.diff-section {
  border: 1px solid var(--ses-line);
  border-radius: 8px;
  overflow: hidden;
}

.diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--ses-surface-2);
  border-bottom: 1px solid var(--ses-line);
  font-size: 12px;
  font-weight: 600;
}

.diff-stats {
  display: flex;
  gap: 10px;
  font-family: var(--ses-font-mono);
  font-size: 11px;
}

.diff-stats em {
  font-style: normal;
}

.stat-add { color: var(--ses-ok); }
.stat-del { color: var(--ses-err); }
.stat-keep { color: var(--ses-ink-4); }

.diff-lines {
  max-height: 220px;
  overflow: auto;
  padding: 8px 0;
  font-family: var(--ses-font-mono);
  font-size: 11.5px;
  line-height: 1.55;
}

.diff-empty {
  padding: 12px;
  text-align: center;
  color: var(--ses-ink-4);
}

.diff-line {
  display: flex;
  gap: 8px;
  padding: 1px 12px;
}

.diff-line.is-added {
  background: color-mix(in oklch, var(--ses-ok) 12%, transparent);
}

.diff-line.is-removed {
  background: color-mix(in oklch, var(--ses-err) 12%, transparent);
}

.diff-prefix {
  width: 12px;
  flex: 0 0 auto;
  font-weight: 700;
}
</style>
