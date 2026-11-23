<template>
  <aside
    class="table-floating-panel ses-scroll"
    :class="{ 'is-collapsed': collapsed }"
    data-testid="table-floating-panel"
    aria-label="表格工具"
  >
    <div class="tfp-header">
      <span class="tfp-title">表格工具</span>
      <button
        type="button"
        class="tfp-toggle"
        data-testid="table-panel-toggle"
        :aria-expanded="!collapsed"
        :title="collapsed ? '展开表格工具' : '收起表格工具'"
        @mousedown.prevent
        @click="collapsed = !collapsed"
      >{{ collapsed ? '展开' : '收起' }}</button>
    </div>

    <div v-if="!collapsed" class="tfp-body">
      <section class="tfp-section" aria-label="列宽">
        <div class="tfp-section-label">列宽</div>
        <div class="tfp-grid">
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-even-width"
            :title="isLandscape ? '将横页版心宽度均分给所有列（252 mm）' : '将纵向版心宽度均分给所有列（165 mm）'"
            @mousedown.prevent
            @click="emit('command', 'evenColWidths')"
          >均分列宽</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-auto-width"
            title="清除固定列宽，恢复自动列宽"
            @mousedown.prevent
            @click="emit('command', 'autoColWidths')"
          >自动列宽</button>
        </div>
      </section>

      <section class="tfp-section" aria-label="行与列">
        <div class="tfp-section-label">行与列</div>
        <div class="tfp-grid">
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-add-row-before"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'addRowBefore')"
          >上方插行</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-add-row-after"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'addRowAfter')"
          >下方插行</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-add-col-before"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'addColBefore')"
          >左侧插列</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-add-col-after"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'addColAfter')"
          >右侧插列</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-delete-row"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'deleteRow')"
          >删除行</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-delete-col"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'deleteCol')"
          >删除列</button>
        </div>
      </section>

      <section class="tfp-section" aria-label="单元格">
        <div class="tfp-section-label">单元格</div>
        <div class="tfp-grid">
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-merge-cells"
            :disabled="!inCell || !canMergeCells"
            @mousedown.prevent
            @click="emit('command', 'mergeCells')"
          >合并单元格</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-split-cell"
            :disabled="!inCell || !canSplitCell"
            @mousedown.prevent
            @click="emit('command', 'splitCell')"
          >拆分单元格</button>
        </div>
      </section>

      <section class="tfp-section" aria-label="表注与脚注">
        <div class="tfp-section-label">表注与脚注</div>
        <div class="tfp-grid">
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-add-note"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'addTableNote')"
          >添加表注</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-add-footnote"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'addTableFootnote')"
          >添加表脚注</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-ref-footnote"
            :disabled="!inCell"
            @mousedown.prevent
            @click="emit('command', 'referenceTableFootnote')"
          >引用表脚注</button>
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-del-footnote-ref"
            :disabled="!inCell || !canDeleteFootnoteRef"
            @mousedown.prevent
            @click="emit('command', 'deleteTableFootnoteRef')"
          >删除脚注标</button>
        </div>
      </section>

      <section class="tfp-section" aria-label="表格">
        <div class="tfp-section-label">表格</div>
        <div class="tfp-grid">
          <button
            type="button"
            class="tfp-btn"
            data-testid="table-panel-paragraph-after"
            title="表格后插入段落（Ctrl/Cmd+Enter）"
            @mousedown.prevent
            @click="emit('command', 'paragraphAfter')"
          >表后插段</button>
          <button
            type="button"
            class="tfp-btn is-danger"
            data-testid="table-panel-delete-table"
            @mousedown.prevent
            @click="emit('command', 'deleteTable')"
          >删除表格</button>
        </div>
      </section>
    </div>
  </aside>
</template>

<script lang="ts">
export type TablePanelCommand =
  | 'evenColWidths'
  | 'autoColWidths'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColBefore'
  | 'addColAfter'
  | 'deleteRow'
  | 'deleteCol'
  | 'mergeCells'
  | 'splitCell'
  | 'addTableNote'
  | 'addTableFootnote'
  | 'referenceTableFootnote'
  | 'deleteTableFootnoteRef'
  | 'paragraphAfter'
  | 'deleteTable'
</script>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  inCell: boolean
  isLandscape: boolean
  canMergeCells: boolean
  canSplitCell: boolean
  canDeleteFootnoteRef: boolean
}>()

const emit = defineEmits<{
  command: [command: TablePanelCommand]
}>()

const collapsed = ref(false)
</script>

<style scoped>
.table-floating-panel {
  pointer-events: auto;
  width: 204px;
  max-height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--ses-line);
  border-radius: var(--ses-r-md);
  background: color-mix(in oklch, var(--ses-surface) 95%, var(--ses-bg));
  box-shadow: var(--ses-shadow-2);
  backdrop-filter: blur(8px);
  font-family: var(--ses-font-ui);
}

.table-floating-panel.is-collapsed {
  width: auto;
  padding: 5px 8px;
  border-radius: 999px;
}

.tfp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tfp-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ses-ink);
  white-space: nowrap;
}

.tfp-toggle {
  padding: 2px 7px;
  border: 1px solid var(--ses-line-2);
  border-radius: 999px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-2);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.tfp-toggle:hover {
  background: var(--ses-accent-soft);
  border-color: color-mix(in oklch, var(--ses-accent) 30%, var(--ses-line));
  color: var(--ses-accent);
}

.tfp-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--ses-line);
}

.tfp-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tfp-section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ses-ink-3);
  letter-spacing: 0.02em;
}

.tfp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}

.tfp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--ses-line);
  border-radius: var(--ses-r-sm);
  background: var(--ses-surface);
  color: var(--ses-ink-2);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
}

.tfp-btn:hover:not([disabled]) {
  background: var(--ses-surface-3);
  border-color: var(--ses-line-2);
  color: var(--ses-ink);
}

.tfp-btn[disabled] {
  opacity: 0.38;
  cursor: not-allowed;
}

.tfp-btn.is-danger:not([disabled]) {
  color: var(--ses-err);
}

.tfp-btn.is-danger:hover:not([disabled]) {
  background: var(--ses-err-soft);
  border-color: color-mix(in oklch, var(--ses-err) 35%, var(--ses-line));
  color: var(--ses-err);
}
</style>
