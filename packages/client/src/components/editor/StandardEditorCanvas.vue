<template>
  <!-- Editor body: outline + canvas + optional sidebar -->
  <div class="ed-body ses-scroll">
    <transition name="slide-left">
      <div v-show="showOutline" class="outline-host" :inert="disabled">
        <DocumentOutline :editor="editor">
          <template #actions>
            <el-dropdown trigger="click" @command="core.handleAddStructure">
              <button class="outline-add-btn" title="添加前言、引言、章、附录或参考文献">
                <el-icon><Plus /></el-icon><span>添加</span>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="foreword">前言</el-dropdown-item>
                  <el-dropdown-item command="introduction">引言</el-dropdown-item>
                  <el-dropdown-item command="chapter">章</el-dropdown-item>
                  <el-dropdown-item divided command="appendixNorm">规范性附录</el-dropdown-item>
                  <el-dropdown-item command="appendixInfo">资料性附录</el-dropdown-item>
                  <el-dropdown-item divided command="bibliography">参考文献</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <button class="outline-icon-btn" title="隐藏文档结构" aria-label="隐藏文档结构" @click="showOutline = false">
              <el-icon><DArrowLeft /></el-icon>
            </button>
          </template>
        </DocumentOutline>
      </div>
    </transition>

    <div :ref="(el) => { core.edMainRef.value = el as HTMLElement | null }" class="ed-main" @[BLOCK_FORMULA_EVENT]="core.handleBlockFormulaEvent">
      <!-- 上下文工具：锚定在编辑区画布右上角，避免撑高工具栏或在打开右侧栏时遮挡侧栏按钮 -->
      <div
        v-if="hasContextShelf"
        class="tbar-context-shelf"
        :inert="disabled"
      >
        <div v-if="hasContextRow" class="tbar-context-row">
          <div v-if="cursorInFormula" class="tbar-group tbar-context" aria-label="公式">
            <span class="tbar-label">公式</span>
            <button class="tbar-btn" title="为光标所在公式添加一条式中符号说明" @click="core.handleAddWhereItem()">添加式中</button>
          </div>
          <div
            v-if="core.activeOrientationNodeType()"
            class="tbar-group tbar-context"
            :class="{ 'is-locked': core.isOrientationLockedByAppendix() }"
            :aria-label="core.activeOrientationLabel()"
            data-testid="node-orientation"
          >
            <span class="tbar-label">{{ core.activeOrientationShortLabel() }}</span>
            <button
              class="tbar-btn"
              :class="{ 'is-active': core.isActivePageOrientation('portrait') }"
              :disabled="core.isOrientationLockedByAppendix()"
              :title="core.orientationButtonTitle('portrait')"
              @click="core.setActivePageOrientation('portrait')"
            >纵向</button>
            <button
              class="tbar-btn"
              :class="{ 'is-active': core.isActivePageOrientation('landscape') }"
              :disabled="core.isOrientationLockedByAppendix()"
              :title="core.orientationButtonTitle('landscape')"
              @click="core.setActivePageOrientation('landscape')"
            >横向</button>
            <span
              v-if="core.isOrientationLockedByAppendix()"
              class="tbar-context-hint"
              data-testid="orientation-locked-hint"
              :title="core.orientationLockedHint()"
            >随附录</span>
            <button
              v-if="core.activeOrientationNodeType() === 'stdTable' && core.isActivePageOrientation('landscape')"
              type="button"
              class="tbar-btn tbar-expand-btn"
              data-testid="context-expand-landscape-btn"
              title="在 252mm 横向宽幅弹窗中编辑此表格"
              @click="core.openActiveLandscapeTable()"
            >展开编辑</button>
          </div>
          <div
            v-if="core.selectedFigureImagePos() !== undefined"
            class="tbar-group tbar-context"
            role="group"
            aria-label="图片尺寸"
            data-testid="image-size-controls"
          >
            <span class="tbar-label">图片尺寸</span>
            <button type="button" class="tbar-btn" @mousedown.prevent @click="core.resizeSelectedFigure('half')">半版宽</button>
            <button type="button" class="tbar-btn" @mousedown.prevent @click="core.resizeSelectedFigure('full')">通栏</button>
            <button type="button" class="tbar-btn" @mousedown.prevent @click="core.resizeSelectedFigure('reset')">恢复默认</button>
          </div>
          <div
            v-if="core.activeAppendixPos() !== undefined"
            class="tbar-group tbar-context tbar-context-section"
            aria-label="附录版面方向"
            data-testid="appendix-orientation"
          >
            <span class="tbar-label" title="控制整个附录的导出页面方向（仅用于 PDF/HTML 与 DOCX，不支持 XML）">整篇附录</span>
            <button
              class="tbar-btn"
              :class="{ 'is-active': core.activeAppendixOrientation() === 'portrait' }"
              title="整个附录排在纵向页面上"
              @click="core.setActiveAppendixOrientation('portrait')"
            >纵向</button>
            <button
              class="tbar-btn"
              :class="{ 'is-active': core.activeAppendixOrientation() === 'landscape' }"
              title="整个附录（编号、标题、引导文字和图表）从横向页面起排；仅用于 PDF/HTML 与 DOCX，XML 无法表达附录方向"
              @click="core.setActiveAppendixOrientation('landscape')"
            >横向</button>
            <span
              v-if="core.activeAppendixOrientation() === 'landscape'"
              class="tbar-context-hint"
              title="整节横向仅用于 PDF/HTML 与 DOCX；如需导出 XML 请改回纵向"
            >仅PDF/DOCX</span>
          </div>
        </div>
        <TableFloatingPanel
          v-if="isInTable"
          :in-cell="isInTableCell"
          :is-landscape="isActiveTableLandscape"
          :can-merge-cells="canMergeCells"
          :can-split-cell="canSplitCell"
          :can-delete-footnote-ref="canDeleteTableFootnoteRef"
          :auto-collapse="tablePanelAutoCollapse"
          @command="core.handleTableCommand"
        />
      </div>
      <SesEditorContent :editor="editor" />
    </div>

    <slot name="sidebar" />
  </div>

  <!-- Slash command (mounted globally) -->
  <SlashMenu v-if="!disabled" @execute="core.handleSlashCommand" />

  <el-dialog
    v-model="showFootnoteDialog"
    :title="footnoteDialogTitle"
    width="560px"
    destroy-on-close
    @closed="core.clearFootnoteDialog"
  >
    <div :inert="disabled">
      <template v-if="footnoteDialogMode === 'table-reference'">
        <el-form label-width="92px">
          <el-form-item label="表脚注">
            <el-select v-model="selectedTableFootnoteId" :disabled="disabled" placeholder="选择本表已有脚注" style="width: 100%">
              <el-option
                v-for="item in tableFootnoteOptions"
                :key="item.id"
                :label="`${item.label} ${item.text}`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </template>
      <template v-else>
        <el-input
          v-model="footnoteText"
          :disabled="disabled"
          type="textarea"
          :rows="6"
          :placeholder="footnoteDialogMode === 'body-new' ? '输入脚注正文' : '输入表脚注正文'"
          maxlength="2000"
          show-word-limit
        />
        <p v-if="footnoteDialogMode === 'body-new' || footnoteDialogMode === 'body-edit'" class="footnote-dialog-hint">
          条文脚注仅提供附加信息，不应包含要求型或推荐型条款（GB/T 1.1—2020 9.12.1）。编号由前言起按全文顺序生成。
        </p>
        <p v-else class="footnote-dialog-hint">
          表脚注可包含要求型条款；同一表脚注可多次引用（GB/T 1.1—2020 9.12.2）。编号按本表首次引用顺序生成。
        </p>
      </template>
    </div>
    <template #footer>
      <el-button @click="showFootnoteDialog = false">取消</el-button>
      <el-button
        v-if="footnoteDialogMode === 'table-edit'"
        type="danger"
        plain
        :disabled="disabled"
        @click="core.deleteTableFootnoteDefinition"
      >删除表脚注定义</el-button>
      <el-button
        v-if="footnoteDialogMode === 'body-edit'"
        type="danger"
        plain
        :disabled="disabled"
        @click="core.deleteBodyFootnote"
      >删除脚注</el-button>
      <el-button type="primary" :disabled="disabled" @click="core.saveFootnoteDialog">确定</el-button>
    </template>
  </el-dialog>

  <WhereConversionDialog
    v-model="showWhereConversion"
    :rows="whereConversion?.rows ?? []"
    @confirm="core.applyWhereConversion"
  />

  <MathInputDialog
    v-model="showMathDialog"
    :initial-latex="mathDialogLatex"
    :title="mathDialogTitle"
    :display-mode="mathDialogDisplayMode"
    @confirm="core.handleMathConfirm"
  />

  <LandscapeTableDialog
    :ref="(el) => { core.landscapeDialogRef.value = el as LandscapeDialogHandle | null }"
    v-model="showLandscapeDialog"
    :table-json="landscapeDialogTableJson"
    :table-label="landscapeDialogTableLabel"
    :before-apply="core.canApplyLandscapeDialog"
    @apply="core.handleLandscapeDialogApply"
    @request-table-footnote="core.openTableFootnoteDialog"
  />
</template>

<script setup lang="ts">
import { DArrowLeft, Plus } from '@element-plus/icons-vue'
import { BLOCK_FORMULA_EVENT } from '@/extensions/nodes/formula'
import type { LandscapeDialogHandle, StandardEditorCore } from '@/composables/useStandardEditorCore'
import SesEditorContent from '@/components/editor/EditorContent.vue'
import TableFloatingPanel from '@/components/editor/TableFloatingPanel.vue'
import DocumentOutline from '@/components/editor/DocumentOutline.vue'
import SlashMenu from '@/components/editor/SlashMenu.vue'
import MathInputDialog from '@/components/editor/MathInputDialog.vue'
import WhereConversionDialog from '@/components/editor/WhereConversionDialog.vue'
import LandscapeTableDialog from '@/components/editor/LandscapeTableDialog.vue'

const props = defineProps<{
  core: StandardEditorCore
  disabled?: boolean
}>()

const {
  editor,
  showOutline,
  tablePanelAutoCollapse,
  cursorInFormula,
  isInTable,
  isInTableCell,
  isActiveTableLandscape,
  canMergeCells,
  canSplitCell,
  canDeleteTableFootnoteRef,
  hasContextRow,
  hasContextShelf,
  showMathDialog,
  mathDialogLatex,
  mathDialogDisplayMode,
  mathDialogTitle,
  showWhereConversion,
  whereConversion,
  showLandscapeDialog,
  landscapeDialogTableJson,
  landscapeDialogTableLabel,
  showFootnoteDialog,
  footnoteDialogMode,
  footnoteDialogTitle,
  footnoteText,
  tableFootnoteOptions,
  selectedTableFootnoteId,
} = props.core
</script>

<style scoped>
.ed-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}
.outline-host {
  display: flex;
  flex-shrink: 0;
  min-height: 0;
}
.outline-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--ses-line-2);
  border-radius: 6px;
  background: var(--ses-surface);
  color: var(--ses-ink-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.outline-add-btn:hover { border-color: var(--ses-accent); color: var(--ses-accent); }
.outline-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ses-ink-3);
  cursor: pointer;
}
.outline-icon-btn:hover { background: var(--ses-surface-2); color: var(--ses-ink); }
.ed-main {
  position: relative;
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 0%, oklch(0.92 0.02 285 / 0.25), transparent 600px),
    var(--ses-bg);
}

.tbar-group {
  display: flex;
  align-items: center;
  gap: 1px;
  height: 32px;
  flex-shrink: 0;
}
.tbar-label {
  margin: 0 4px 0 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ses-ink-4);
  white-space: nowrap;
  user-select: none;
}
.tbar-group :deep(.tbar-btn) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ses-ink-2);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.1s ease, color 0.1s ease;
}
.tbar-group :deep(.tbar-btn:hover) {
  background: var(--ses-surface-3);
  color: var(--ses-ink);
}
.tbar-btn.is-active { background: var(--ses-accent-soft); color: var(--ses-accent); }
.tbar-btn[disabled] { opacity: 0.38; pointer-events: none; }

.tbar-context-shelf {
  position: absolute;
  top: 8px;
  right: 16px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: calc(100% - 32px);
  max-height: calc(100% - 20px);
  pointer-events: none;
}
.tbar-context-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}
.tbar-context {
  pointer-events: auto;
  padding: 0 6px;
  border: 1px solid color-mix(in oklch, var(--ses-accent) 24%, var(--ses-line));
  border-radius: 8px;
  background: color-mix(in oklch, var(--ses-surface) 92%, var(--ses-accent-soft));
  box-shadow: var(--ses-shadow-2);
  backdrop-filter: blur(8px);
}
.tbar-context .tbar-label { color: var(--ses-accent); }
.tbar-context-section {
  border-color: var(--ses-line-2);
  background: color-mix(in oklch, var(--ses-surface) 94%, var(--ses-surface-2));
}
.tbar-context-section .tbar-label { color: var(--ses-ink-2); }
.tbar-context.is-locked .tbar-btn.is-active[disabled] {
  opacity: 0.72;
}
.tbar-context-hint {
  margin: 0 2px 0 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--ses-surface-2);
  color: var(--ses-ink-3);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  user-select: none;
}
.tbar-expand-btn {
  margin-left: 4px;
  background: var(--ses-accent-soft) !important;
  color: var(--ses-accent) !important;
  font-weight: 600 !important;
}
.tbar-expand-btn:hover {
  background: var(--ses-accent) !important;
  color: #fff !important;
}

.slide-left-enter-active, .slide-left-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.slide-left-enter-from,  .slide-left-leave-to     { transform: translateX(-24px); opacity: 0; }

.footnote-dialog-hint {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ses-ink-3);
}

@media (max-width: 960px) {
  .ed-body > .outline-host { position: absolute; top: 0; left: 0; bottom: 0; z-index: 20; box-shadow: 8px 0 24px #1d213322; }
}
@media (max-width: 1100px) {
  .ed-body > :deep(.version-sidebar) {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    width: min(92vw, 380px);
    min-width: min(92vw, 320px);
    box-shadow: -8px 0 24px #1d213322;
  }
}
</style>
