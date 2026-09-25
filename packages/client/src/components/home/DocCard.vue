<template>
  <article class="doc-card" :class="{ 'is-pinned': pinned }" @click="$emit('open', doc)">
    <div class="doc-card-head">
      <span class="ses-type-chip" :data-type="doc.meta?.standardType">
        {{ typeLabel(doc.meta?.standardType) }}
      </span>
      <span class="ses-stage" :class="doc.stage">
        <span class="dot" />
        {{ stageLabel(doc.stage) }}
      </span>
    </div>

    <div class="doc-card-body">
      <div class="doc-card-stdno">{{ doc.meta?.standardNo || '— · 待编号' }}</div>
      <h3 class="doc-card-title">{{ doc.meta?.titleCn || doc.title }}</h3>
      <div v-if="doc.meta?.titleEn" class="doc-card-titleen">{{ doc.meta.titleEn }}</div>
    </div>

    <div class="doc-card-progress">
      <div class="doc-progress-head">
        <span>编写进度</span>
        <span style="font-family: var(--ses-font-mono)">{{ progress }}%</span>
      </div>
      <div class="doc-progress-bar"><div class="doc-progress-fill" :style="{ width: progress + '%' }" /></div>
    </div>

    <div class="doc-card-foot">
      <div class="meta-l">
        <span class="doc-icon-meta" title="章节数">
          <el-icon><Files /></el-icon>
          {{ chapterCount }}
        </span>
      </div>
      <div class="meta-r">
        <span class="doc-time">{{ formattedTime }}</span>
        <el-dropdown trigger="click" @click.stop @command="onAction">
          <button class="doc-more" @click.stop>
            <el-icon><MoreFilled /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="duplicate">复制</el-dropdown-item>
              <el-dropdown-item divided command="delete" style="color: var(--ses-err)">删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Files, MoreFilled } from '@element-plus/icons-vue'
import type { DocumentData } from '@/api/document'
import { STAGE_LABELS, TYPE_LABELS } from '@/constants/standards'

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

// Lightweight progress heuristic until a real metric exists.
// Phase 6 (智能校验) would supply this.
const progress = computed(() => {
  const stageProgress: Record<string, number> = {
    working_draft: 30,
    comment_draft: 60,
    review_discussion_draft: 70,
    review_draft: 85,
    approval_draft: 95,
    public_draft: 98,
    published: 100,
  }
  return stageProgress[props.doc.stage] ?? 0
})

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
  transition: all 0.15s ease;
  position: relative;
  text-align: left;
}
.doc-card:hover {
  border-color: var(--ses-line-2);
  transform: translateY(-2px);
  box-shadow: var(--ses-shadow-2);
}
.doc-card.is-pinned::before {
  content: ""; position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: var(--ses-accent);
}

.doc-card-head {
  padding: 14px 16px 0;
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 10px;
}
.doc-card-body { padding: 12px 16px 14px; flex: 1; }
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

.doc-card-progress { padding: 0 16px 12px; }
.doc-progress-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px;
  color: var(--ses-ink-3);
  margin-bottom: 5px;
}
.doc-progress-bar { height: 4px; background: var(--ses-surface-2); border-radius: 2px; overflow: hidden; }
.doc-progress-fill { height: 100%; background: var(--ses-accent); border-radius: 2px; transition: width 0.3s ease; }

.doc-card-foot {
  padding: 12px 16px;
  border-top: 1px solid var(--ses-line);
  display: flex; align-items: center; justify-content: space-between;
  background: var(--ses-surface-2);
}
.meta-l, .meta-r { display: flex; align-items: center; gap: 8px; }

.doc-icon-meta {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px;
  color: var(--ses-ink-3);
  font-family: var(--ses-font-mono);
}
.doc-time { font-size: 11px; color: var(--ses-ink-3); }

.doc-more {
  width: 24px; height: 24px;
  border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ses-ink-3);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.doc-more:hover { background: var(--ses-surface-3); color: var(--ses-ink); }
</style>
