<template>
  <article
    class="template-card"
    :class="{ 'is-builtin': template.readonly }"
    data-testid="template-card"
  >
    <div class="tpl-card-head">
      <div class="tpl-badges">
        <span class="ses-type-chip" :data-type="template.baseType">
          {{ TYPE_LABELS[template.baseType] || template.baseType }}
        </span>
        <span class="source-badge" :class="`source-${template.source}`" data-testid="template-source-badge">
          {{ sourceLabel }}
        </span>
      </div>

      <el-dropdown v-if="!template.readonly" trigger="click" @command="onMenuCommand">
        <button class="tpl-more" type="button" title="更多模板操作" aria-label="更多模板操作">
          <el-icon><MoreFilled /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="derive">复制为新模板</el-dropdown-item>
            <el-dropdown-item command="export">导出 .sestpl</el-dropdown-item>
            <el-dropdown-item divided command="delete" style="color: var(--ses-err)">删除模板</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="tpl-card-body">
      <div class="tpl-title-row">
        <img
          v-if="template.coverLayout?.logo?.dataUrl"
          :src="template.coverLayout.logo.dataUrl"
          :alt="template.coverLayout.logo.alt || '模板徽标'"
          class="tpl-logo-thumb"
        />
        <div class="tpl-title-text">
          <h3 class="tpl-name">{{ template.name }}</h3>
          <div class="tpl-uid">{{ template.uid }}</div>
        </div>
      </div>

      <p class="tpl-desc">{{ template.description || '未填写模板说明' }}</p>

      <div class="tpl-meta-row">
        <span class="meta-chip">{{ STAGE_LABELS[template.defaultStage] || template.defaultStage }}</span>
        <span v-if="template.defaultMeta?.stdPrefix" class="meta-chip mono">{{ template.defaultMeta.stdPrefix }}</span>
        <span v-if="template.coverLayout?.logo?.dataUrl" class="meta-chip accent">含封面徽标</span>
        <span v-if="template.coverLayout?.notice?.text?.trim()" class="meta-chip accent">含附加声明</span>
        <span v-if="template.coverLayout?.backCover?.enabled" class="meta-chip accent">含独立封底</span>
        <span v-if="template.coverLayout?.watermark?.enabled" class="meta-chip accent">含正文水印</span>
      </div>
    </div>

    <footer class="tpl-card-foot">
      <el-button size="small" type="primary" data-testid="template-use-btn" @click="$emit('use', template)">
        使用此模板
      </el-button>
      <el-button
        v-if="!template.readonly"
        size="small"
        plain
        data-testid="template-edit-btn"
        @click="$emit('edit', template)"
      >
        编辑模板
      </el-button>
      <el-button
        v-else
        size="small"
        plain
        data-testid="template-derive-btn"
        @click="$emit('derive', template)"
      >
        基于此派生
      </el-button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MoreFilled } from '@element-plus/icons-vue'
import type { StandardTemplate, TemplateSource } from '@ses/shared'
import { STAGE_LABELS, TYPE_LABELS } from '@/constants/standards'

const props = defineProps<{
  template: StandardTemplate
}>()

const emit = defineEmits<{
  (e: 'use', template: StandardTemplate): void
  (e: 'edit', template: StandardTemplate): void
  (e: 'derive', template: StandardTemplate): void
  (e: 'export', template: StandardTemplate): void
  (e: 'delete', template: StandardTemplate): void
}>()

function assertNeverSource(source: never): never {
  throw new Error(`Unexpected template source: ${String(source)}`)
}

function formatSourceLabel(source: TemplateSource): string {
  switch (source) {
    case 'builtin':
      return '内置只读'
    case 'human':
      return '自定义'
    case 'agent':
      return 'AI 创建'
    case 'import':
      return '导入'
    default:
      return assertNeverSource(source)
  }
}

const sourceLabel = computed(() => formatSourceLabel(props.template.source))

function onMenuCommand(command: string) {
  if (command === 'derive') emit('derive', props.template)
  else if (command === 'export') emit('export', props.template)
  else if (command === 'delete') emit('delete', props.template)
}
</script>

<style scoped>
.template-card {
  display: flex;
  flex-direction: column;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.template-card:hover {
  border-color: var(--ses-line-2);
  box-shadow: var(--ses-shadow-2);
}

.tpl-card-head {
  padding: 13px 12px 0 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tpl-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.source-badge {
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
}

.source-badge.source-agent {
  background: color-mix(in oklch, var(--ses-accent) 14%, transparent);
  color: var(--ses-accent);
}

.source-badge.source-import {
  background: color-mix(in oklch, var(--ses-ok) 14%, transparent);
  color: var(--ses-ok);
}

.tpl-more {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ses-ink-3);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.tpl-more:hover {
  background: var(--ses-surface-3);
  color: var(--ses-ink);
}

.tpl-card-body {
  flex: 1;
  padding: 11px 15px 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tpl-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tpl-logo-thumb {
  width: 34px;
  height: 26px;
  object-fit: contain;
  border: 1px solid var(--ses-line);
  border-radius: 5px;
  padding: 2px;
  background: var(--ses-bg);
  flex-shrink: 0;
}

.tpl-title-text {
  min-width: 0;
}

.tpl-name {
  margin: 0;
  font-size: 14.5px;
  font-weight: 650;
  color: var(--ses-ink);
  line-height: 1.4;
}

.tpl-uid {
  margin-top: 2px;
  font-family: var(--ses-font-mono);
  font-size: 10px;
  color: var(--ses-ink-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tpl-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ses-ink-3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tpl-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: auto;
}

.meta-chip {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10.5px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
}

.meta-chip.mono {
  font-family: var(--ses-font-mono);
}

.meta-chip.accent {
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
}

.tpl-card-foot {
  padding: 10px 15px;
  border-top: 1px solid var(--ses-line);
  background: var(--ses-surface-2);
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
