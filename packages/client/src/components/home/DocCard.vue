<template>
  <article
    class="doc-card"
    :class="{ 'is-pinned': pinned }"
    tabindex="0"
    :aria-label="`打开 ${doc.meta?.titleCn || doc.title}`"
    @click="$emit('open', doc)"
    @keydown.enter.self="$emit('open', doc)"
  >
    <div class="doc-card-head">
      <span class="ses-type-chip" :data-type="doc.meta?.standardType">
        {{ typeLabel(doc.meta?.standardType) }}
      </span>
      <el-dropdown trigger="click" @click.stop @command="onAction">
        <button class="doc-more" type="button" title="更多操作" aria-label="更多操作" @click.stop>
          <el-icon><MoreFilled /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="duplicate">复制为新文件</el-dropdown-item>
            <el-dropdown-item divided command="delete" style="color: var(--ses-err)">移入回收站</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="doc-card-body">
      <div class="doc-card-stdno">{{ doc.meta?.standardNo || '— · 待编号' }}</div>
      <h3 class="doc-card-title">{{ doc.meta?.titleCn || doc.title }}</h3>
      <div v-if="doc.meta?.titleEn" class="doc-card-titleen">{{ doc.meta.titleEn }}</div>
    </div>

    <!-- 编制阶段：按 7 个阶段的先后位置显示，不推算百分比 -->
    <div class="doc-card-stage" :title="`第 ${stageIndex + 1} / ${STAGES.length} 阶段：${stageLabel(doc.stage)}`">
      <span class="ses-stage" :class="doc.stage">
        <span class="dot" />
        {{ stageLabel(doc.stage) }}
      </span>
      <span class="stage-track" aria-hidden="true">
        <span
          v-for="(stage, index) in STAGES"
          :key="stage"
          class="stage-tick"
          :class="{ 'is-done': index <= stageIndex }"
        />
      </span>
    </div>

    <div class="doc-card-foot">
      <span class="doc-icon-meta" title="章数">
        <el-icon><Files /></el-icon>
        {{ chapterCount }} 章
      </span>
      <span class="doc-time" :title="exactTime">{{ doc.updatedAt ? `更新于 ${formattedTime}` : '未更新' }}</span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Files, MoreFilled } from '@element-plus/icons-vue'
import type { DocumentData } from '@/api/document'
import { STAGES, STAGE_LABELS, TYPE_LABELS } from '@/constants/standards'

const props = defineProps<{
  doc: DocumentData
  pinned?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', doc: DocumentData): void
  (e: 'delete', doc: DocumentData): void
  (e: 'duplicate', doc: DocumentData): void
}>()

function stageLabel(s: string) { return STAGE_LABELS[s] || s }
function typeLabel(s?: string) { return s ? TYPE_LABELS[s] || s : '—' }

const stageIndex = computed(() => (STAGES as readonly string[]).indexOf(props.doc.stage))

const chapterCount = computed(() => {
  const content = props.doc.content as { content?: { type: string }[] } | undefined
  if (!content?.content) return 0
  return content.content.filter((n) => n.type === 'chapter').length
})

const formattedTime = computed(() => {
  const d = props.doc.updatedAt
  if (!d) return '未更新'
  const date = new Date(d)
  const diff = Date.now() - date.getTime()
  const hr = diff / 3_600_000
  if (hr < 1) return Math.max(1, Math.floor(diff / 60_000)) + ' 分钟前'
  if (hr < 24) return Math.floor(hr) + ' 小时前'
  if (hr < 24 * 7) return Math.floor(hr / 24) + ' 天前'
  return date.toLocaleDateString('zh-CN')
})

const exactTime = computed(() => props.doc.updatedAt ? new Date(props.doc.updatedAt).toLocaleString('zh-CN') : '')

function onAction(cmd: string) {
  if (cmd === 'delete') emit('delete', props.doc)
  if (cmd === 'duplicate') emit('duplicate', props.doc)
}
</script>

<style scoped>
.doc-card {
  display: flex; flex-direction: column;
  background: var(--ses-surface);
  border: 1px solid var(--ses-line);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  position: relative;
  text-align: left;
}
.doc-card:hover {
  border-color: var(--ses-line-2);
  box-shadow: var(--ses-shadow-2);
}
.doc-card:focus-visible { outline: 2px solid var(--ses-accent-ring); outline-offset: 2px; }
.doc-card.is-pinned::before {
  content: ""; position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: var(--ses-accent);
}

.doc-card-head {
  padding: 14px 12px 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
}
.doc-card-body { padding: 10px 16px 14px; flex: 1; }
.doc-card-stdno {
  font-family: var(--ses-font-mono);
  font-size: 11.5px;
  color: var(--ses-ink-3);
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.doc-card-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--ses-ink);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.doc-card-titleen {
  font-size: 11.5px;
  color: var(--ses-ink-3);
  font-style: italic;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-card-stage {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 0 16px 14px;
}
.stage-track { display: flex; gap: 3px; }
.stage-tick { width: 12px; height: 4px; border-radius: 2px; background: var(--ses-surface-3); }
.stage-tick.is-done { background: var(--ses-accent); }

.doc-card-foot {
  padding: 10px 16px;
  border-top: 1px solid var(--ses-line);
  display: flex; align-items: center; justify-content: space-between;
  background: var(--ses-surface-2);
}
.doc-icon-meta {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px;
  color: var(--ses-ink-3);
}
.doc-time { font-size: 11.5px; color: var(--ses-ink-3); }

.doc-more {
  width: 26px; height: 26px;
  border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ses-ink-3);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.doc-more:hover { background: var(--ses-surface-3); color: var(--ses-ink); }
</style>
