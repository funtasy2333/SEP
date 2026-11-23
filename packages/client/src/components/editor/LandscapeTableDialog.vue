<template>
  <el-dialog
    :model-value="modelValue"
    width="min(1160px, 94vw)"
    top="4vh"
    class="ses-landscape-table-dlg"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    @keydown="handleDialogKeydown"
  >
    <template #header>
      <div class="lt-dlg-header">
        <div class="lt-dlg-title-row">
          <span class="lt-dlg-title" data-testid="landscape-dialog-title">{{ dialogTitle }}</span>
        </div>
        <button
          type="button"
          class="lt-dlg-close"
          aria-label="关闭弹窗"
          title="关闭（Esc）"
          @click="handleCancel"
        >×</button>
      </div>
    </template>

    <div class="lt-toolbar" role="toolbar" aria-label="横页表格编辑工具栏">
      <div class="tbar-group">
        <button
          type="button"
          class="tbar-btn icon-btn"
          :disabled="!modalEditor?.can().undo()"
          title="撤销（Ctrl/Cmd+Z）"
          aria-label="撤销"
          @mousedown.prevent
          @click="modalEditor?.chain().focus().undo().run()"
        >
          <el-icon><RefreshLeft /></el-icon>
        </button>
        <button
          type="button"
          class="tbar-btn icon-btn"
          :disabled="!modalEditor?.can().redo()"
          title="重做（Ctrl/Cmd+Shift+Z）"
          aria-label="重做"
          @mousedown.prevent
          @click="modalEditor?.chain().focus().redo().run()"
        >
          <el-icon><RefreshRight /></el-icon>
        </button>
      </div>

      <span class="tbar-sep" />

      <div class="tbar-group format-group">
        <button
          type="button"
          class="tbar-btn icon-btn"
          :class="{ 'is-active': modalEditor?.isActive('bold') }"
          title="加粗（Ctrl/Cmd+B）"
          aria-label="加粗"
          @mousedown.prevent
          @click="modalEditor?.chain().focus().toggleBold().run()"
        ><strong>B</strong></button>
        <button
          type="button"
          class="tbar-btn icon-btn"
          :class="{ 'is-active': modalEditor?.isActive('italic') }"
          title="斜体（Ctrl/Cmd+I）"
          aria-label="斜体"
          @mousedown.prevent
          @click="modalEditor?.chain().focus().toggleItalic().run()"
        ><em>I</em></button>
        <button
          type="button"
          class="tbar-btn icon-btn"
          :class="{ 'is-active': modalEditor?.isActive('underline') }"
          title="下划线（Ctrl/Cmd+U）"
          aria-label="下划线"
          @mousedown.prevent
          @click="modalEditor?.chain().focus().toggleUnderline().run()"
        ><u>U</u></button>
        <button
          type="button"
          class="tbar-btn icon-btn"
          :class="{ 'is-active': modalEditor?.isActive('strike') }"
          title="删除线"
          aria-label="删除线"
          @mousedown.prevent
          @click="modalEditor?.chain().focus().toggleStrike().run()"
        ><s>S</s></button>
      </div>

      <span class="tbar-sep" />

      <div class="tbar-group">
        <button
          type="button"
          class="tbar-btn"
          :disabled="!cursorAllowsInlineFormula"
          title="在文字中输入带上下标的量或变量符号（Ctrl/Cmd+Shift+M）"
          @mousedown.prevent
          @click="handleInlineFormula"
        >符号</button>
        <TableMenu
          :in-table="inTable"
          :in-cell="inCell"
          :modal-mode="true"
          @open="rememberTableSelection"
          @command="handleTableCommand"
        />
      </div>

      <span class="tbar-sep" />

      <div class="tbar-group lt-width-actions" aria-label="快速调整列宽">
        <button
          type="button"
          class="tbar-btn"
          data-testid="lt-even-width-btn"
          title="将横页宽度均分给所有列"
          @mousedown.prevent
          @click="distributeEvenWidths"
        >均分列宽</button>
        <button
          type="button"
          class="tbar-btn"
          data-testid="lt-reset-width-btn"
          title="清除手动设置的固定列宽（colwidth），恢复自动列宽"
          @mousedown.prevent
          @click="resetAutoWidths"
        >自动列宽</button>
      </div>
    </div>

    <div class="lt-canvas-scroll ses-scroll">
      <div class="lt-landscape-paper">
        <editor-content :editor="modalEditor" class="lt-editor-content" />
      </div>
    </div>

    <template #footer>
      <div class="lt-dlg-footer">
        <span class="lt-footer-hint">表题仅在主文档编辑，此处专心排版表格网格、列宽与表注（Ctrl/Cmd+S 完成并应用）</span>
        <div class="lt-footer-actions">
          <el-button data-testid="lt-cancel-btn" @click="handleCancel">取消</el-button>
          <el-button type="primary" data-testid="lt-apply-btn" @click="handleApply">完成并应用</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import type { SelectionBookmark } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshLeft, RefreshRight } from '@element-plus/icons-vue'
import type { PMJsonNode } from '@ses/shared'
import TableMenu from '@/components/editor/TableMenu.vue'
import { createLandscapeTableModalExtensions } from '@/extensions/editorExtensions'
import { canInsertInlineFormula } from '@/extensions/plugins/inlineFormulaEditing'
import {
  captureImageTarget,
  applyImageTarget,
  selectLocalImage,
  handleEmptyImageClick,
  handleEmptyImageKeydown,
} from '@/utils/imagePicker'
import {
  LANDSCAPE_TARGET_WIDTH_PX,
  buildColwidthTransaction,
  distributeColumnWidthsByWeights,
  extractStdTableForModal,
  getStdTableGridColwidths,
} from '@/utils/landscapeTable'

const props = withDefaults(defineProps<{
  modelValue: boolean
  tableJson: PMJsonNode | null
  tableLabel?: string
  beforeApply?: (modalDocJson: PMJsonNode) => boolean
}>(), {
  tableLabel: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  apply: [modalDocJson: PMJsonNode]
  requestTableFootnote: [mode: 'table-new' | 'table-reference']
}>()

const modalEditor = shallowRef<Editor | undefined>(undefined)
const revision = ref(0)
let initialSnapshot = ''
let tableSelection: { doc: PMNode; bookmark: SelectionBookmark } | null = null
let cancelling = false

const sessionInfo = computed(() => {
  if (!props.tableJson) return null
  return extractStdTableForModal(props.tableJson)
})

const dialogTitle = computed(() => {
  const parts: string[] = []
  if (props.tableLabel) parts.push(props.tableLabel)
  if (sessionInfo.value?.captionText) parts.push(sessionInfo.value.captionText)
  return parts.length > 0 ? `编辑横页表格 · ${parts.join('  ')}` : '编辑横页表格'
})

const cursorAllowsInlineFormula = computed(() => {
  void revision.value
  return Boolean(modalEditor.value && canInsertInlineFormula(modalEditor.value.state))
})

const inTable = computed(() => {
  void revision.value
  const ed = modalEditor.value
  return Boolean(ed && (ed.isActive('stdTable') || ed.isActive('table')))
})

const inCell = computed(() => {
  void revision.value
  const ed = modalEditor.value
  return Boolean(ed && (ed.isActive('tableCell') || ed.isActive('tableHeader')))
})

const isDirty = computed(() => {
  void revision.value
  if (!modalEditor.value || !initialSnapshot) return false
  return JSON.stringify(modalEditor.value.getJSON()) !== initialSnapshot
})

function destroyModalEditor(): void {
  tableSelection = null
  if (modalEditor.value) {
    modalEditor.value.destroy()
    modalEditor.value = undefined
  }
  initialSnapshot = ''
}

async function pickModalImage(pos: number): Promise<void> {
  const ed = modalEditor.value
  if (!ed || ed.isDestroyed || !ed.isEditable || !props.modelValue) return
  const target = captureImageTarget(ed, pos)
  try {
    const src = await selectLocalImage()
    if (!src) return
    if (!props.modelValue || modalEditor.value !== ed || ed.isDestroyed || !ed.isEditable || !applyImageTarget(ed, target, src)) {
      ElMessage.warning('未能在原位置插入图片，请重新选择位置')
    }
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '图片读取失败')
  }
}

function initModalEditor(): void {
  destroyModalEditor()
  if (!props.tableJson) return

  const { modalDoc } = extractStdTableForModal(props.tableJson)
  let baselineReady = false
  let userModified = false
  const editor = new Editor({
    extensions: createLandscapeTableModalExtensions(),
    content: modalDoc as never,
    onCreate({ editor: createdEditor }) {
      if (!userModified) {
        initialSnapshot = JSON.stringify(createdEditor.getJSON())
      }
      baselineReady = true
      revision.value += 1
    },
    onTransaction({ transaction }) {
      if (transaction.docChanged) {
        if (!baselineReady && transaction.getMeta('addToHistory') === false) {
          if (!userModified) initialSnapshot = JSON.stringify(editor.getJSON())
        } else {
          userModified = true
        }
      }
      revision.value += 1
    },
    editorProps: {
      handleClickOn(view, _pos, node, nodePos, _event, direct) {
        return handleEmptyImageClick(view, node, nodePos, direct, (pos) => {
          void pickModalImage(pos)
        })
      },
      handleKeyDown(view, event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          event.stopPropagation()
          handleApply()
          return true
        }
        return handleEmptyImageKeydown(view, event, (pos) => {
          void pickModalImage(pos)
        })
      },
    },
  })

  modalEditor.value = editor
  if (!baselineReady && !userModified) {
    initialSnapshot = JSON.stringify(editor.getJSON())
  }
  revision.value += 1
}

watch(
  () => [props.modelValue, props.tableJson] as const,
  ([open]) => {
    if (open && props.tableJson) {
      initModalEditor()
    } else if (!open) {
      destroyModalEditor()
    }
  },
  { immediate: true },
)

onBeforeUnmount(destroyModalEditor)

function rememberTableSelection(): void {
  if (modalEditor.value) {
    tableSelection = {
      doc: modalEditor.value.state.doc,
      bookmark: modalEditor.value.state.selection.getBookmark(),
    }
  }
}

function handleTableCommand(command: string): void {
  const ed = modalEditor.value
  if (!ed) return
  if (tableSelection && ed.state.doc.eq(tableSelection.doc)) {
    ed.view.dispatch(ed.state.tr.setSelection(tableSelection.bookmark.resolve(ed.state.doc)))
  }
  tableSelection = null

  const chain = ed.chain().focus()
  switch (command) {
    case 'addRowBefore':
      chain.addRowBefore().run()
      break
    case 'addRowAfter':
      chain.addRowAfter().run()
      break
    case 'deleteRow':
      chain.deleteRow().run()
      break
    case 'addColBefore':
      chain.addColumnBefore().run()
      break
    case 'addColAfter':
      chain.addColumnAfter().run()
      break
    case 'deleteCol':
      chain.deleteColumn().run()
      break
    case 'mergeCells':
      chain.mergeCells().run()
      break
    case 'splitCell':
      chain.splitCell().run()
      break
    case 'addTableNote':
      if (!chain.addTableNote().run()) ElMessage.warning('请将光标置于表格单元格内')
      break
    case 'addTableFootnote':
      emit('requestTableFootnote', 'table-new')
      break
    case 'referenceTableFootnote':
      emit('requestTableFootnote', 'table-reference')
      break
    case 'deleteTableFootnoteRef':
      if (!chain.deleteSelectedTableFootnoteRef().run()) ElMessage.warning('请先选中要删除的表脚注上标')
      break
  }
}

function handleInlineFormula(): void {
  const ed = modalEditor.value
  if (!ed) return
  if (!ed.commands.requestInlineFormula()) {
    ElMessage.info('符号只能放在表格单元格或表注/表脚注中；选中文字转为符号时，选区不能跨段或包含其他符号、公式、脚注')
  }
}

function distributeEvenWidths(): void {
  const ed = modalEditor.value
  if (!ed) return
  const stdTable = ed.state.doc.firstChild
  if (!stdTable || stdTable.type.name !== 'stdTable') return
  const info = getStdTableGridColwidths(stdTable)
  if (!info || info.colCount === 0) return
  const weights = Array(info.colCount).fill(1)
  const widths = distributeColumnWidthsByWeights(weights, LANDSCAPE_TARGET_WIDTH_PX)
  const tr = buildColwidthTransaction(ed.state, widths)
  if (tr) {
    ed.view.dispatch(tr)
    ed.view.focus()
  }
}

function resetAutoWidths(): void {
  const ed = modalEditor.value
  if (!ed) return
  const tr = buildColwidthTransaction(ed.state, null, {
    stdTablePos: 0,
    clearNominalColumns: true,
  })
  if (tr) {
    ed.view.dispatch(tr)
    ed.view.focus()
  }
}

function handleApply(): void {
  const ed = modalEditor.value
  if (!ed) {
    emit('update:modelValue', false)
    return
  }
  const payload = ed.getJSON() as PMJsonNode
  if (props.beforeApply && props.beforeApply(payload) === false) {
    return
  }
  emit('apply', payload)
  emit('update:modelValue', false)
}

async function handleCancel(): Promise<void> {
  if (cancelling) return
  if (!isDirty.value) {
    emit('update:modelValue', false)
    return
  }
  cancelling = true
  try {
    await ElMessageBox.confirm(
      '当前横页表格中有尚未应用的修改，取消后将丢失本次弹窗内的全部更改。',
      '放弃横页表格修改？',
      {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        type: 'warning',
      },
    )
    emit('update:modelValue', false)
  } catch {
    // 用户选择继续编辑
  } finally {
    cancelling = false
  }
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    event.stopPropagation()
    handleApply()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void handleCancel()
  }
}

defineExpose({
  getEditor: () => modalEditor.value,
  isDirty,
  hasUnsavedChanges: () => isDirty.value,
  apply: handleApply,
  cancel: handleCancel,
  distributeEvenWidths,
  resetAutoWidths,
})
</script>

<style scoped>
.lt-dlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.lt-dlg-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.lt-dlg-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ses-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lt-dlg-close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ses-ink-3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.lt-dlg-close:hover {
  background: var(--ses-surface-2);
  color: var(--ses-ink);
}

.lt-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 2px;
  padding: 6px 12px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
}

.tbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  flex-shrink: 0;
}

.tbar-sep {
  flex: 0 0 auto;
  width: 1px;
  height: 18px;
  margin: 0 6px;
  background: var(--ses-line-2);
}

.tbar-group :deep(.tbar-btn) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ses-ink-2);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: var(--ses-font-ui);
  white-space: nowrap;
  transition: background 0.1s ease, color 0.1s ease;
}

.tbar-group :deep(.tbar-btn:hover:not([disabled])) {
  background: var(--ses-surface-3);
  color: var(--ses-ink);
}

.tbar-btn.is-active {
  background: var(--ses-accent-soft);
  color: var(--ses-accent);
}

.tbar-btn[disabled] {
  opacity: 0.38;
  pointer-events: none;
}

.tbar-btn.icon-btn {
  width: 28px;
  padding: 0;
  justify-content: center;
}

.format-group strong,
.format-group em,
.format-group u,
.format-group s {
  font-family: var(--ses-font-zh-hei);
}

.lt-canvas-scroll {
  max-height: 70vh;
  overflow: auto;
  padding: 20px 24px 28px;
  background: var(--ses-bg);
}

.lt-landscape-paper {
  width: 1032px;
  margin: 0 auto;
  padding: 24px 40px;
  background: var(--ses-paper);
  border: 1px solid var(--ses-paper-edge);
  border-radius: var(--ses-r-lg);
  box-shadow: var(--ses-shadow-paper);
}

/* 弹窗子编辑器：严格 952px (252mm) 坐标，字体与表格边框样式与主编辑器保持完全一致 */
.lt-editor-content :deep(.tiptap) {
  outline: none;
  font-family: var(--ses-font-zh-song);
  font-size: var(--ses-doc-base, 15px);
  line-height: 1.85;
  color: oklch(0.18 0.014 270);
}

.lt-editor-content :deep(.tiptap ::selection) {
  background: var(--ses-accent-ring);
}

.lt-editor-content :deep(.tiptap .std-table-wrapper) {
  margin: 0;
  padding-top: 0;
  border-top: none;
}

.lt-editor-content :deep(.tiptap .std-table-wrapper[data-orientation="landscape"]::before) {
  display: none;
}

.lt-editor-content :deep(.tiptap .std-table-wrapper > .tableWrapper) {
  width: 952px;
  max-width: none;
  overflow-x: visible;
  margin: 0;
  padding: 0;
}

.lt-editor-content :deep(.tiptap table) {
  border-collapse: collapse;
  border: 2px solid #000;
  width: 100%;
  margin: 0;
}

.lt-editor-content :deep(.tiptap .std-table-wrapper > .tableWrapper > table) {
  min-width: 952px;
  margin: 0;
}

.lt-editor-content :deep(.tiptap table td),
.lt-editor-content :deep(.tiptap table th) {
  border: 1px solid #000;
  padding: 8px 4px;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--ses-font-ui);
  font-size: 13px;
}

.lt-editor-content :deep(.tiptap table td > p),
.lt-editor-content :deep(.tiptap table th > p),
.lt-editor-content :deep(.tiptap .std-table-cell-content > p) {
  text-indent: 0;
  margin: 4px 0;
}

.lt-editor-content :deep(.tiptap table th) {
  background: var(--ses-surface-2);
  font-weight: 400;
  text-align: center;
}

.lt-dlg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.lt-footer-hint {
  font-size: 12px;
  color: var(--ses-ink-3);
}

.lt-footer-actions {
  display: flex;
  gap: 8px;
}
</style>

<style>
.ses-landscape-table-dlg .el-dialog__body {
  padding: 0;
}
.ses-landscape-table-dlg .el-dialog__header {
  padding: 14px 20px;
  margin-right: 0;
}
.ses-landscape-table-dlg .el-dialog__footer {
  padding: 12px 20px;
}
</style>
