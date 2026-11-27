import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { useEditor, type Editor } from '@tiptap/vue-3'
import type { Extensions } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ElMessage } from 'element-plus'
import type { DocumentMeta, PMJsonNode } from '@ses/shared'
import type { TablePanelCommand } from '@/components/editor/TableFloatingPanel.vue'
import { createDefaultForeword } from '@/utils/newDocument'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { SearchHighlight, clearSearch, getSearchState, scrollToCurrentSearchMatch, stepSearch } from '@/extensions/plugins/searchHighlight'
import { canInsertBodyFootnote } from '@/extensions/nodes/footnotes'
import type { BlockFormulaRequest } from '@/extensions/nodes/formula'
import { formulaHasLegacyDescription, selectedFormula } from '@/extensions/plugins/whereListEditing'
import { canInsertInlineFormula, INLINE_FORMULA_EVENT, sameInlineLocation, type InlineFormulaRequest } from '@/extensions/plugins/inlineFormulaEditing'
import { getTableFootnoteEntries } from '@/extensions/nodes/std-table'
import { resolveEditorLabels } from '@/utils/semanticLabels'
import { setFigureSizePreset, type FigureSizePreset } from '@/utils/figureSize'
import { normalizePageOrientation } from '@/utils/orientation'
import { insertParagraphAfterTable, setClauseFormat, setListFormat, setParagraphFormat, structureFailureMessage, type StructureAction, type StructureResult } from '@/utils/structureEditing'
import { listNumberingMessage, setListNumbering, type ListNumberingMode } from '@/utils/listNumbering'
import { convertLegacyWhereDescription, type WhereConversionRow } from '@/utils/whereListConversion'
import {
  EXPAND_LANDSCAPE_TABLE_EVENT,
  buildActiveTableAutoWidthTransaction,
  buildActiveTableEvenWidthTransaction,
  buildMergedStdTableNode,
  findActiveStdTableLocation,
  findStdTableByTarget,
  isEffectiveLandscapeStdTable,
  type ExpandLandscapeTableDetail,
} from '@/utils/landscapeTable'
import {
  applyImageTarget,
  captureImageTarget,
  handleEmptyImageClick,
  handleEmptyImageKeydown,
  selectLocalImage,
} from '@/utils/imagePicker'

export type FootnoteDialogMode = 'body-new' | 'body-edit' | 'table-new' | 'table-edit' | 'table-reference' | null
export type EditorTableCommand = TablePanelCommand | 'insert' | 'expandLandscape'

export interface StandardEditorCoreOptions {
  extraExtensions?: Extensions
  onUpdate?: () => void
  onSaveShortcut?: () => void
  getForewordMeta?: () => Partial<DocumentMeta> | undefined
  getUnavailable?: () => boolean
  getResourceKey?: () => string | number
}

export interface LandscapeDialogHandle {
  getEditor: () => Editor | undefined
  hasUnsavedChanges?: () => boolean
}

export interface StandardEditorCore {
  editor: ShallowRef<Editor | undefined>
  docRevision: Ref<number>
  showOutline: Ref<boolean>
  edMainRef: Ref<HTMLElement | null>
  tablePanelAutoCollapse: ComputedRef<boolean>
  searchText: Ref<string>
  searchStatus: Ref<string>
  cursorInFormula: ComputedRef<boolean>
  cursorAllowsInlineFormula: ComputedRef<boolean>
  isInTable: ComputedRef<boolean>
  isInTableCell: ComputedRef<boolean>
  isActiveTableLandscape: ComputedRef<boolean>
  canMergeCells: ComputedRef<boolean>
  canSplitCell: ComputedRef<boolean>
  canDeleteTableFootnoteRef: ComputedRef<boolean>
  hasContextRow: ComputedRef<boolean>
  hasContextShelf: ComputedRef<boolean>
  showMathDialog: Ref<boolean>
  mathDialogLatex: Ref<string>
  mathDialogDisplayMode: ComputedRef<boolean>
  mathDialogTitle: ComputedRef<string>
  showWhereConversion: Ref<boolean>
  whereConversion: Ref<{ pos: number; source: string; formula: PMJsonNode; rows: WhereConversionRow[] } | null>
  showLandscapeDialog: Ref<boolean>
  landscapeDialogRef: Ref<LandscapeDialogHandle | null>
  landscapeDialogTableJson: Ref<PMJsonNode | null>
  landscapeDialogTableLabel: Ref<string>
  showFootnoteDialog: Ref<boolean>
  footnoteDialogMode: Ref<FootnoteDialogMode>
  footnoteDialogTitle: ComputedRef<string>
  footnoteText: Ref<string>
  tableFootnoteOptions: Ref<Array<{ id: string; label: string; text: string }>>
  selectedTableFootnoteId: Ref<string>
  setSuppressUpdate: (suppressed: boolean) => void
  withSuppressedUpdate: <T>(fn: () => T) => T
  getEditorContent: () => Record<string, unknown>
  getEditorDoc: () => PMNode | undefined
  activeEditor: () => Editor | undefined
  activeOrientationNodeType: () => 'figure' | 'stdTable' | undefined
  selectedFigureImagePos: () => number | undefined
  resizeSelectedFigure: (preset: FigureSizePreset) => void
  activeAppendixPos: () => number | undefined
  activeAppendixOrientation: () => 'portrait' | 'landscape' | undefined
  setActiveAppendixOrientation: (orientation: 'portrait' | 'landscape') => void
  isOrientationLockedByAppendix: () => boolean
  activeOrientationShortLabel: () => string
  activeOrientationLabel: () => string
  orientationLockedHint: () => string
  orientationButtonTitle: (orientation: 'portrait' | 'landscape') => string
  isActivePageOrientation: (orientation: 'portrait' | 'landscape') => boolean
  setActivePageOrientation: (orientation: 'portrait' | 'landscape') => void
  toggleUnderline: () => void
  insertStdParagraph: () => void
  handleInsertClause: (level: string) => void
  handleInsertClauseNoTitle: (level: string) => void
  handleInsertList: (listType: string) => void
  handleInsertNote: (command: string) => void
  handleInsertExample: (command: string) => void
  handleInsertTermDef: (level: string) => void
  handleInsertFormula: (triggerPos?: number) => void
  handleInlineFormula: () => void
  handleAddWhereItem: () => void
  handleInsertFigure: (pos?: number, slashPos?: number) => Promise<void>
  handleAddStructure: (command: string) => void
  handleSlashCommand: (command: string) => void
  handleTableCommand: (command: EditorTableCommand) => void
  handleSearchKeydown: (event: Event | KeyboardEvent) => void
  handleSearchClear: () => void
  handleBlockFormulaEvent: (event: Event) => void
  openWhereConversion: (formulaPos: number) => void
  applyWhereConversion: () => void
  handleMathConfirm: (latex: string) => void
  openActiveLandscapeTable: () => void
  canApplyLandscapeDialog: () => boolean
  handleLandscapeDialogApply: (modalDocJson: PMJsonNode) => void
  hasUnappliedLandscapeEdits: () => boolean
  openTableFootnoteDialog: (mode: 'table-new' | 'table-reference') => void
  clearFootnoteDialog: () => void
  saveFootnoteDialog: () => void
  deleteBodyFootnote: () => Promise<void>
  deleteTableFootnoteDefinition: () => Promise<void>
}

const SECTION_INSERT_CONTAINERS = new Set(['chapter', 'clause', 'foreword', 'introduction', 'appendix'])
const TABLE_PANEL_MIN_CANVAS_WIDTH = 1136

function assertNeverTableCommand(command: never): never {
  throw new Error(`Unhandled table command: ${String(command)}`)
}

export function useStandardEditorCore(options: StandardEditorCoreOptions = {}): StandardEditorCore {
  const showOutline = ref(typeof window === 'undefined' || window.innerWidth > 960)
  const docRevision = ref(0)
  const searchText = ref('')
  const searchStatus = ref('')
  const edMainRef = ref<HTMLElement | null>(null)
  const edMainWidth = ref(0)
  const tablePanelAutoCollapse = computed(() => edMainWidth.value > 0 && edMainWidth.value < TABLE_PANEL_MIN_CANVAS_WIDTH)
  let suppressEditorUpdate = false

  function isUnavailable(): boolean {
    return options.getUnavailable?.() ?? false
  }

  function setSuppressUpdate(suppressed: boolean): void {
    suppressEditorUpdate = suppressed
  }

  function withSuppressedUpdate<T>(fn: () => T): T {
    suppressEditorUpdate = true
    try {
      return fn()
    } finally {
      suppressEditorUpdate = false
    }
  }

  const showLandscapeDialog = ref(false)
  const landscapeDialogTableJson = ref<PMJsonNode | null>(null)
  const landscapeDialogTableLabel = ref('')
  const landscapeDialogTarget = ref<{ nodeId?: string; pos: number; openingSnapshot: string } | null>(null)
  const landscapeDialogRef = ref<LandscapeDialogHandle | null>(null)

  const editor = useEditor({
    extensions: [...createEditorExtensions(), ...(options.extraExtensions ?? []), SearchHighlight],
    content: '',
    onTransaction() {
      docRevision.value += 1
      syncSearchStatus()
    },
    onUpdate() {
      if (!suppressEditorUpdate) options.onUpdate?.()
    },
    editorProps: {
      handleClickOn(view, _pos, node, nodePos, _event, direct) {
        return handleEmptyImageClick(view, node, nodePos, direct, (pos) => {
          void handleInsertFigure(pos)
        })
      },
      handleKeyDown(view, event) {
        if (handleEmptyImageKeydown(view, event, (pos) => {
          void handleInsertFigure(pos)
        })) {
          return true
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault()
          if (!showLandscapeDialog.value) options.onSaveShortcut?.()
          return true
        }
        return false
      },
    },
  })

  watch(edMainRef, (el, _prev, onCleanup) => {
    if (!el) {
      edMainWidth.value = 0
      return
    }
    const syncWidth = () => {
      edMainWidth.value = el.clientWidth
    }
    syncWidth()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncWidth)
      observer.observe(el)
      onCleanup(() => observer.disconnect())
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', syncWidth)
      onCleanup(() => window.removeEventListener('resize', syncWidth))
    }
  }, { immediate: true })

  function activeEditor(): Editor | undefined {
    if (showLandscapeDialog.value) {
      return landscapeDialogRef.value?.getEditor() ?? editor.value
    }
    return editor.value
  }

  function activeOrientationNodeType(): 'figure' | 'stdTable' | undefined {
    const currentEditor = editor.value
    if (!currentEditor) return undefined
    const selection = currentEditor.state.selection
    if (selection instanceof NodeSelection) {
      if (selection.node.type.name === 'figure' || selection.node.type.name === 'stdTable') {
        return selection.node.type.name
      }
    }
    for (let depth = selection.$from.depth; depth >= 0; depth -= 1) {
      const nodeType = selection.$from.node(depth).type.name
      if (nodeType === 'figure' || nodeType === 'stdTable') return nodeType
    }
    return undefined
  }

  function selectedFigureImagePos(): number | undefined {
    const ed = editor.value
    const selection = ed?.state.selection
    return ed?.isEditable && selection instanceof NodeSelection && selection.node.type.name === 'figureImage' && selection.node.attrs.src
      ? selection.from : undefined
  }

  function resizeSelectedFigure(preset: FigureSizePreset) {
    const ed = editor.value
    const pos = selectedFigureImagePos()
    if (ed && pos !== undefined) setFigureSizePreset(ed.view, pos, preset)
  }

  function activeAppendixPos(): number | undefined {
    const currentEditor = editor.value
    if (!currentEditor) return undefined
    const { $from } = currentEditor.state.selection
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === 'appendix') return $from.before(depth)
    }
    const selected = currentEditor.state.selection instanceof NodeSelection ? currentEditor.state.selection.node : null
    return selected?.type.name === 'appendix' ? currentEditor.state.selection.from : undefined
  }

  function activeAppendixOrientation(): 'portrait' | 'landscape' | undefined {
    const pos = activeAppendixPos()
    if (pos === undefined || !editor.value) return undefined
    return normalizePageOrientation(editor.value.state.doc.nodeAt(pos)?.attrs.orientation)
  }

  function setActiveAppendixOrientation(orientation: 'portrait' | 'landscape') {
    const currentEditor = editor.value
    const pos = activeAppendixPos()
    if (!currentEditor || pos === undefined || activeAppendixOrientation() === orientation) return
    currentEditor.chain().focus().command(({ tr }) => {
      tr.setNodeAttribute(pos, 'orientation', orientation === 'landscape' ? 'landscape' : null)
      return true
    }).run()
  }

  function isOrientationLockedByAppendix(): boolean {
    return Boolean(activeOrientationNodeType() && activeAppendixOrientation() === 'landscape')
  }

  function activeOrientationShortLabel(): string {
    return activeOrientationNodeType() === 'figure' ? '当前图' : '当前表'
  }

  function activeOrientationLabel(): string {
    return activeOrientationNodeType() === 'figure' ? '当前图版面方向' : '当前表版面方向'
  }

  function orientationLockedHint(): string {
    const target = activeOrientationNodeType() === 'figure' ? '图' : '表'
    return `当前附录已设为整节横排，内部图表统一按横向排版（仅 PDF/HTML 与 DOCX 生效）；如需仅此${target}横排，请先将整篇附录切回纵向`
  }

  function orientationButtonTitle(orientation: 'portrait' | 'landscape'): string {
    if (isOrientationLockedByAppendix()) return orientationLockedHint()
    const target = activeOrientationNodeType() === 'figure' ? '图' : '表'
    return orientation === 'landscape' ? `将当前${target}设为横向页面` : `将当前${target}设为纵向页面`
  }

  function isActivePageOrientation(orientation: 'portrait' | 'landscape'): boolean {
    const nodeType = activeOrientationNodeType()
    const currentEditor = editor.value
    if (!nodeType || !currentEditor) return false
    if (isOrientationLockedByAppendix()) return orientation === 'landscape'
    return normalizePageOrientation(currentEditor.getAttributes(nodeType).orientation) === orientation
  }

  function setActivePageOrientation(orientation: 'portrait' | 'landscape') {
    if (isOrientationLockedByAppendix()) return
    const nodeType = activeOrientationNodeType()
    if (nodeType) editor.value?.chain().focus().updateAttributes(nodeType, { orientation }).run()
  }

  function findStructurePositions() {
    if (!editor.value) return null
    const doc = editor.value.state.doc
    let firstChapterPos = -1
    let lastChapterEnd = -1
    let lastAppendixEnd = -1
    let hasForeword = false
    let hasIntroduction = false
    let hasBibliography = false
    let forewordEnd = -1

    doc.forEach((node, offset) => {
      const name = node.type.name
      if (name === 'foreword') {
        hasForeword = true
        forewordEnd = offset + node.nodeSize
      } else if (name === 'introduction') {
        hasIntroduction = true
      } else if (name === 'chapter') {
        if (firstChapterPos === -1) firstChapterPos = offset
        lastChapterEnd = offset + node.nodeSize
      } else if (name === 'appendix') {
        lastAppendixEnd = offset + node.nodeSize
      } else if (name === 'bibliography') {
        hasBibliography = true
      }
    })

    return { firstChapterPos, lastChapterEnd, lastAppendixEnd, hasForeword, hasIntroduction, hasBibliography, forewordEnd }
  }

  function handleAddStructure(command: string) {
    if (!editor.value) return
    const pos = findStructurePositions()
    if (!pos) return

    switch (command) {
      case 'foreword':
        if (pos.hasForeword) {
          ElMessage.warning('前言已存在')
          return
        }
        {
          const cover = editor.value.state.doc.firstChild
          const insertAt = cover?.type.name === 'coverPage' ? cover.nodeSize : 0
          const meta = options.getForewordMeta?.()
          const forewordMeta = meta ? ({ titleCn: '', ...meta } as DocumentMeta) : undefined
          editor.value.chain().focus().insertContentAt(insertAt, createDefaultForeword(forewordMeta)).run()
        }
        break
      case 'introduction':
        if (pos.hasIntroduction) {
          ElMessage.warning('引言已存在')
          return
        }
        {
          const insertAt = pos.forewordEnd > 0 ? pos.forewordEnd : (pos.firstChapterPos > 0 ? pos.firstChapterPos : 0)
          editor.value.chain().focus().insertContentAt(insertAt, {
            type: 'introduction',
            content: [{ type: 'paragraph' }],
          }).run()
        }
        break
      case 'chapter':
        {
          const insertAt = pos.lastChapterEnd > 0 ? pos.lastChapterEnd : editor.value.state.doc.content.size
          editor.value.chain().focus().insertContentAt(insertAt, {
            type: 'chapter',
            content: [
              { type: 'chapterTitle' },
              { type: 'stdParagraph' },
            ],
          }).setTextSelection(insertAt + 2).scrollIntoView().run()
        }
        break
      case 'appendixNorm':
      case 'appendixInfo':
        {
          const insertAt = pos.lastAppendixEnd > 0 ? pos.lastAppendixEnd : (pos.lastChapterEnd > 0 ? pos.lastChapterEnd : editor.value.state.doc.content.size)
          const isNorm = command === 'appendixNorm'
          editor.value.chain().focus().insertContentAt(insertAt, {
            type: 'appendix',
            attrs: { normative: isNorm },
            content: [
              { type: 'appendixLabel', content: [{ type: 'text', text: isNorm ? '（规范性）' : '（资料性）' }] },
              { type: 'appendixTitle' },
              { type: 'stdParagraph' },
            ],
          }).setTextSelection(insertAt + 2 + (isNorm ? '（规范性）'.length : '（资料性）'.length) + 2).run()
        }
        break
      case 'bibliography':
        if (pos.hasBibliography) {
          ElMessage.warning('参考文献已存在')
          return
        }
        editor.value.chain().focus().insertContentAt(editor.value.state.doc.content.size, {
          type: 'bibliography',
          content: [
            { type: 'bibliographyTitle', content: [{ type: 'text', text: '参考文献' }] },
            { type: 'bibEntry' },
          ],
        }).run()
        break
    }
  }

  function getInsertAfterCurrentBlockInSection(): number | null {
    if (!editor.value) return null
    const { selection } = editor.value.state
    const { $from } = selection
    if (selection instanceof NodeSelection) {
      if ($from.depth > 0 && SECTION_INSERT_CONTAINERS.has($from.parent.type.name)) {
        return selection.to
      }
      if (SECTION_INSERT_CONTAINERS.has(selection.node.type.name)) {
        return selection.to - 1
      }
    }
    for (let d = $from.depth; d > 0; d--) {
      const parentName = $from.node(d).type.name
      if (SECTION_INSERT_CONTAINERS.has(parentName)) {
        return d + 1 <= $from.depth ? $from.after(d + 1) : $from.end(d)
      }
    }
    return null
  }

  function getInsertAfterCurrentBlock(): number | null {
    if (!editor.value) return null
    const { $from } = editor.value.state.selection
    for (let d = $from.depth; d > 0; d--) {
      const parentName = $from.node(d).type.name
      if (SECTION_INSERT_CONTAINERS.has(parentName)) {
        return $from.after(d + 1 <= $from.depth ? d + 1 : d)
      }
    }
    return $from.after($from.depth)
  }

  function getInsertRange(): { from: number; to: number } | null {
    if (!editor.value) return null
    const { $from } = editor.value.state.selection
    if ($from.parent.type.name === 'stdParagraph' && $from.parent.textContent === '') {
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'stdParagraph') {
          return { from: $from.before(d), to: $from.after(d) }
        }
      }
    }
    const insertPos = getInsertAfterCurrentBlock()
    if (insertPos === null) return null
    return { from: insertPos, to: insertPos }
  }

  function warnStructureFailure(result: StructureResult, action: StructureAction = 'clause') {
    if (!result.ok) ElMessage.warning(structureFailureMessage(result.reason, action))
  }

  function handleInsertClause(level: string) {
    if (editor.value) warnStructureFailure(setClauseFormat(editor.value, Number(level)))
  }

  function handleInsertClauseNoTitle(level: string) {
    if (editor.value) warnStructureFailure(setClauseFormat(editor.value, Number(level), false))
  }

  const isInTable = computed(() => {
    void docRevision.value
    const ed = editor.value
    return Boolean(ed && (ed.isActive('stdTable') || ed.isActive('table')))
  })

  const isInTableCell = computed(() => {
    void docRevision.value
    const ed = editor.value
    return Boolean(ed && (ed.isActive('tableCell') || ed.isActive('tableHeader')))
  })

  const isActiveTableLandscape = computed(() => {
    void docRevision.value
    return activeLandscapeStdTable() !== null
  })

  const canMergeCells = computed(() => {
    void docRevision.value
    return Boolean(editor.value?.can().mergeCells())
  })

  const canSplitCell = computed(() => {
    void docRevision.value
    return Boolean(editor.value?.can().splitCell())
  })

  const canDeleteTableFootnoteRef = computed(() => {
    void docRevision.value
    return Boolean(editor.value?.can().deleteSelectedTableFootnoteRef())
  })

  const showMathDialog = ref(false)
  const mathDialogLatex = ref('')
  const mathDialogRequest = ref<InlineFormulaRequest | BlockFormulaRequest | null>(null)
  let mathDialogDoc: PMNode | null = null
  const cursorInFormula = computed(() => !!editor.value && selectedFormula(editor.value.state) !== null)
  const cursorAllowsInlineFormula = computed(() => !!editor.value && canInsertInlineFormula(editor.value.state))
  const mathDialogDisplayMode = computed(() => mathDialogRequest.value?.mode === 'block-insert' || mathDialogRequest.value?.mode === 'block-edit')
  const mathDialogTitle = computed(() => {
    const request = mathDialogRequest.value
    if (request?.mode === 'block-insert') return '插入公式'
    if (request?.mode === 'block-edit') return '编辑公式'
    const ed = request?.mode === 'where' ? editor.value : activeEditor()
    const inWhereTerm = request?.mode === 'where' || ed?.state.doc.resolve(Math.min(request?.pos ?? 0, ed.state.doc.content.size)).parent.type.name === 'whereTerm'
    const noun = inWhereTerm ? '式中符号' : '符号'
    return request?.mode === 'edit' ? `编辑${noun}` : request?.mode === 'replace' ? `转为${noun}` : `插入${noun}`
  })

  const hasContextRow = computed(() => {
    void docRevision.value
    return Boolean(
      cursorInFormula.value
      || activeOrientationNodeType()
      || selectedFigureImagePos() !== undefined
      || activeAppendixPos() !== undefined,
    )
  })

  const hasContextShelf = computed(() => hasContextRow.value || isInTable.value)

  function activeLandscapeStdTable(): { node: PMNode; pos: number } | null {
    const ed = editor.value
    if (!ed) return null
    const loc = findActiveStdTableLocation(ed.state)
    if (!loc) return null
    return isEffectiveLandscapeStdTable(ed.state.doc, loc.pos) ? loc : null
  }

  function openLandscapeTableDialogAt(target: { nodeId?: string; pos?: number }): void {
    const ed = editor.value
    if (!ed || isUnavailable()) return
    const found = findStdTableByTarget(ed.state.doc, target)
    if (!found || !isEffectiveLandscapeStdTable(ed.state.doc, found.pos)) return
    const nodeId = typeof found.node.attrs.nodeId === 'string' && found.node.attrs.nodeId
      ? found.node.attrs.nodeId
      : undefined
    let label = ''
    try {
      if (nodeId) {
        const labels = resolveEditorLabels(ed.state.doc)
        label = labels[nodeId]?.label ?? ''
      }
    } catch {
      label = ''
    }
    const tableJson = found.node.toJSON() as PMJsonNode
    landscapeDialogTarget.value = {
      ...(nodeId ? { nodeId } : {}),
      pos: found.pos,
      openingSnapshot: JSON.stringify(tableJson),
    }
    landscapeDialogTableLabel.value = label
    landscapeDialogTableJson.value = tableJson
    showLandscapeDialog.value = true
  }

  function openActiveLandscapeTable(): void {
    const active = activeLandscapeStdTable()
    if (!active) {
      ElMessage.warning('请将光标置于横向表格内')
      return
    }
    const nodeId = typeof active.node.attrs.nodeId === 'string' && active.node.attrs.nodeId
      ? active.node.attrs.nodeId
      : undefined
    openLandscapeTableDialogAt({ pos: active.pos, ...(nodeId ? { nodeId } : {}) })
  }

  function handleExpandLandscapeTableEvent(event: Event): void {
    const detail = (event as CustomEvent<ExpandLandscapeTableDetail>).detail
    if (!detail) return
    openLandscapeTableDialogAt(detail)
  }

  watch(showLandscapeDialog, (open) => {
    if (!open) {
      landscapeDialogTarget.value = null
      landscapeDialogTableJson.value = null
      landscapeDialogTableLabel.value = ''
    }
  })

  function resolveApplyableLandscapeTable(): { node: PMNode; pos: number } | null {
    const ed = editor.value
    const target = landscapeDialogTarget.value
    if (!ed || !ed.isEditable || isUnavailable() || !target) return null
    const found = findStdTableByTarget(ed.state.doc, target)
    if (!found) {
      ElMessage.warning('主文档中已找不到原表格，未能应用修改')
      return null
    }
    if (JSON.stringify(found.node.toJSON()) !== target.openingSnapshot) {
      ElMessage.warning('该表格在弹窗打开期间已被更新，未覆盖最新内容；请复制需要的修改后取消并重新展开编辑')
      return null
    }
    return found
  }

  function canApplyLandscapeDialog(): boolean {
    return resolveApplyableLandscapeTable() !== null
  }

  function handleLandscapeDialogApply(modalDocJson: PMJsonNode): void {
    const ed = editor.value
    const found = resolveApplyableLandscapeTable()
    if (!ed || !found) return
    try {
      const mergedNode = buildMergedStdTableNode(found.node, modalDocJson)
      const tr = ed.state.tr.replaceWith(found.pos, found.pos + found.node.nodeSize, mergedNode)
      const afterTablePos = found.pos + 1
      if (afterTablePos <= tr.doc.content.size) {
        tr.setSelection(TextSelection.near(tr.doc.resolve(afterTablePos)))
      }
      ed.view.dispatch(tr.scrollIntoView())
      ed.view.focus()
    } catch (error) {
      ElMessage.error(`应用横页表格修改失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function hasUnappliedLandscapeEdits(): boolean {
    return Boolean(showLandscapeDialog.value && landscapeDialogRef.value?.hasUnsavedChanges?.())
  }

  function handleTableCommand(command: EditorTableCommand) {
    if (!editor.value) return
    const chain = editor.value.chain().focus()
    switch (command) {
      case 'insert': {
        const pos = getInsertAfterCurrentBlockInSection()
        if (pos === null) {
          ElMessage.warning('请先将光标置于章、条、前言、引言或附录内部再插入表格（表格末尾可用「表后插段」或 Ctrl/Cmd+Enter 继续书写）')
          break
        }
        editor.value.chain().focus().insertContentAt(pos, {
          type: 'stdTable',
          content: [
            { type: 'tableCaption' },
            { type: 'table', content: Array.from({ length: 3 }, (_, r) => ({
              type: 'tableRow',
              content: Array.from({ length: 3 }, () => ({
                type: r === 0 ? 'tableHeader' : 'tableCell',
                content: [{ type: 'paragraph' }],
              })),
            })) },
          ],
        }).run()
        break
      }
      case 'evenColWidths': {
        const tr = buildActiveTableEvenWidthTransaction(editor.value.state)
        if (tr) editor.value.view.dispatch(tr)
        editor.value.view.focus()
        break
      }
      case 'autoColWidths': {
        const tr = buildActiveTableAutoWidthTransaction(editor.value.state)
        if (tr) editor.value.view.dispatch(tr)
        editor.value.view.focus()
        break
      }
      case 'paragraphAfter':
        warnStructureFailure(insertParagraphAfterTable(editor.value), 'table')
        break
      case 'expandLandscape':
        openActiveLandscapeTable()
        break
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
      case 'deleteTable':
        if (!chain.deleteTable().run()) ElMessage.warning('请将光标置于表格内或选中整张表格')
        break
      case 'addTableNote':
        if (!chain.addTableNote().run()) ElMessage.warning('请将光标置于标准表格的单元格内')
        break
      case 'addTableFootnote':
        openTableFootnoteDialog('table-new')
        break
      case 'referenceTableFootnote':
        openTableFootnoteDialog('table-reference')
        break
      case 'deleteTableFootnoteRef':
        if (!chain.deleteSelectedTableFootnoteRef().run()) ElMessage.warning('请先选中要删除的表脚注上标')
        break
      default:
        assertNeverTableCommand(command)
    }
  }

  function handleInsertList(listType: string) {
    if (listType.startsWith('numbering:')) {
      handleListNumbering(listType === 'numbering:continue' ? 'continue' : 'restart')
      return
    }
    if (editor.value) warnStructureFailure(setListFormat(editor.value, listType), 'list')
  }

  function handleListNumbering(mode: ListNumberingMode) {
    const e = editor.value
    if (!e) return
    const tr = e.state.tr
    const result = setListNumbering(e.state, tr, mode)
    if (result.ok && result.changed) {
      e.view.dispatch(tr.scrollIntoView())
      e.view.focus()
    }
    const message = listNumberingMessage(result, mode)
    if (result.ok) ElMessage.success(message)
    else ElMessage.warning(message)
  }

  function handleInsertNote(command: string) {
    if (command === 'note') {
      if (editor.value && !editor.value.chain().focus().insertNote().run()) {
        ElMessage.warning('请在段落或列项中设置注；当前选区的原文已保留')
      }
    } else if (command === 'footnote') {
      openBodyFootnoteDialog()
    }
  }

  const showFootnoteDialog = ref(false)
  const footnoteDialogMode = ref<FootnoteDialogMode>(null)
  const footnoteDialogTitle = computed(() => ({
    'body-new': '插入脚注',
    'body-edit': '编辑脚注',
    'table-new': '添加表脚注',
    'table-edit': '编辑表脚注',
    'table-reference': '引用已有表脚注',
  }[footnoteDialogMode.value || 'body-new']))
  const footnoteText = ref('')
  const footnoteNodeId = ref('')
  const footnoteOriginalContent = ref<PMJsonNode[]>([])
  const selectedTableFootnoteId = ref('')
  const tableFootnoteOptions = ref<Array<{ id: string; label: string; text: string }>>([])

  function plainTextFromInlines(content: PMJsonNode[]): string {
    return content.map((node) => {
      if (node.type === 'text') return node.text || ''
      if (node.type === 'hardBreak') return '\n'
      if (node.type === 'footnoteRef' && Array.isArray(node.attrs?.content)) return plainTextFromInlines(node.attrs.content as PMJsonNode[])
      return ''
    }).join('')
  }

  function inlineContentFromText(text: string): PMJsonNode[] {
    const content: PMJsonNode[] = []
    text.split(/\r?\n/).forEach((line, index) => {
      if (index > 0) content.push({ type: 'hardBreak' })
      if (line) content.push({ type: 'text', text: line })
    })
    return content
  }

  function currentTableLocation(targetEditor = activeEditor()): { node: PMNode; pos: number } | null {
    if (!targetEditor) return null
    const { $from } = targetEditor.state.selection
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      if (node.type.name === 'stdTable') return { node, pos: $from.before(depth) }
    }
    return null
  }

  function selectionIsInTableCell(targetEditor = activeEditor()): boolean {
    if (!targetEditor) return false
    const { $from, $to } = targetEditor.state.selection
    if ($from.parent !== $to.parent) return false
    let foundCell = false
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const type = $from.node(depth).type.name
      if (type === 'tableCell' || type === 'tableHeader') foundCell = true
      if (type === 'stdTable') return foundCell
    }
    return false
  }

  function collectTableFootnotes(targetEditor = activeEditor()): Array<{ id: string; label: string; text: string }> {
    const table = currentTableLocation(targetEditor)
    if (!table || !targetEditor) return []
    const labels = resolveEditorLabels(targetEditor.state.doc, { wrapStandaloneTable: true })
    const result: Array<{ id: string; label: string; text: string }> = []
    getTableFootnoteEntries(table.node).forEach((node) => {
      const id = typeof node.attrs.nodeId === 'string' ? node.attrs.nodeId : ''
      if (!id) return
      result.push({
        id,
        label: labels[id]?.label || '?',
        text: plainTextFromInlines((node.toJSON().content || []) as PMJsonNode[]),
      })
    })
    return result
  }

  function openBodyFootnoteDialog() {
    if (isUnavailable()) return
    const currentEditor = editor.value
    if (!currentEditor) return
    const selection = currentEditor.state.selection
    if (selection instanceof NodeSelection && selection.node.type.name === 'footnoteRef') {
      const nodeId = String(selection.node.attrs.nodeId || '')
      if (nodeId) openFootnoteById(nodeId, false)
      return
    }
    if (!canInsertBodyFootnote(selection)) {
      const $from = selection.$from
      const ancestors = Array.from({ length: $from.depth + 1 }, (_, index) => $from.node(index).type.name)
      const reason = ancestors.includes('stdTable') || ancestors.includes('table')
        ? '表格内请使用“添加表脚注”或“引用已有表脚注”。'
        : ancestors.includes('termDef') || ancestors.includes('termDefinition') || ancestors.includes('termName')
          ? '术语条及其定义中不能插入条文脚注。'
          : '请将光标或选区置于正文普通段落中；标题和封面不支持脚注。'
      ElMessage.warning(reason)
      return
    }
    footnoteDialogMode.value = 'body-new'
    footnoteNodeId.value = ''
    footnoteOriginalContent.value = []
    footnoteText.value = ''
    showFootnoteDialog.value = true
  }

  function openTableFootnoteDialog(mode: 'table-new' | 'table-reference') {
    if (isUnavailable()) return
    const targetEditor = activeEditor()
    if (!targetEditor || !selectionIsInTableCell(targetEditor)) {
      ElMessage.warning('请将光标置于标准表格的单元格内')
      return
    }
    const optionsList = collectTableFootnotes(targetEditor)
    if (mode === 'table-reference' && optionsList.length === 0) {
      ElMessage.info('当前表格还没有可引用的表脚注')
      return
    }
    footnoteDialogMode.value = mode
    footnoteNodeId.value = ''
    footnoteOriginalContent.value = []
    footnoteText.value = ''
    tableFootnoteOptions.value = optionsList
    selectedTableFootnoteId.value = optionsList[0]?.id || ''
    showFootnoteDialog.value = true
  }

  function openFootnoteById(nodeId: string, table: boolean) {
    if (isUnavailable()) return
    const targetEditor = table ? activeEditor() : editor.value
    if (!targetEditor) return
    const found: { target: PMNode | null } = { target: null }
    targetEditor.state.doc.descendants((node) => {
      if (table) {
        if (node.type.name === 'tableFootnoteEntry' && node.attrs.nodeId === nodeId) found.target = node
      } else if (node.type.name === 'footnoteRef' && node.attrs.nodeId === nodeId) found.target = node
    })
    if (!found.target) {
      ElMessage.warning('找不到对应脚注内容；请检查脚注引用与定义。')
      return
    }
    const json = found.target.toJSON() as PMJsonNode
    const content = table
      ? (json.content || [])
      : (Array.isArray(json.attrs?.content) ? json.attrs.content as PMJsonNode[] : [])
    footnoteDialogMode.value = table ? 'table-edit' : 'body-edit'
    footnoteNodeId.value = nodeId
    footnoteOriginalContent.value = content
    footnoteText.value = plainTextFromInlines(content)
    showFootnoteDialog.value = true
  }

  function handleFootnoteEditEvent(event: Event) {
    const detail = (event as CustomEvent<{ nodeId?: string; table?: boolean }>).detail
    if (detail?.nodeId) openFootnoteById(detail.nodeId, detail.table === true)
  }

  function clearFootnoteDialog() {
    footnoteDialogMode.value = null
    footnoteNodeId.value = ''
    footnoteOriginalContent.value = []
    footnoteText.value = ''
    selectedTableFootnoteId.value = ''
    tableFootnoteOptions.value = []
  }

  function replaceTableFootnoteContent(nodeId: string, content: PMJsonNode[], currentEditor = activeEditor()): boolean {
    if (!currentEditor) return false
    const found: { target: { node: PMNode; pos: number } | null } = { target: null }
    currentEditor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableFootnoteEntry' && node.attrs.nodeId === nodeId) found.target = { node, pos }
    })
    if (!found.target) return false
    const nodes = content.map((item) => currentEditor.schema.nodeFromJSON(item))
    const tr = currentEditor.state.tr.replaceWith(found.target.pos + 1, found.target.pos + found.target.node.nodeSize - 1, nodes)
    currentEditor.view.dispatch(tr)
    return true
  }

  function saveFootnoteDialog() {
    if (isUnavailable()) return
    const mode = footnoteDialogMode.value
    const currentEditor = mode && mode.startsWith('table-') ? activeEditor() : editor.value
    if (!currentEditor || !mode) return

    if (mode === 'table-reference') {
      if (!selectedTableFootnoteId.value || !currentEditor.commands.insertTableFootnoteRef({ targetId: selectedTableFootnoteId.value })) {
        ElMessage.warning('无法在当前表格插入引用，请确认光标仍位于原表格内。')
        return
      }
      currentEditor.view.focus()
      showFootnoteDialog.value = false
      return
    }

    if (!footnoteText.value.trim()) {
      ElMessage.warning('脚注内容不能为空')
      return
    }
    const content = footnoteText.value === plainTextFromInlines(footnoteOriginalContent.value)
      ? footnoteOriginalContent.value
      : inlineContentFromText(footnoteText.value)
    let saved = false
    if (mode === 'body-new') {
      saved = currentEditor.commands.insertFootnoteRef({ content })
    } else if (mode === 'body-edit') {
      saved = currentEditor.commands.updateFootnoteRef({ nodeId: footnoteNodeId.value, content })
    } else if (mode === 'table-new') {
      saved = currentEditor.commands.insertTableFootnote({ content })
    } else if (mode === 'table-edit') {
      saved = replaceTableFootnoteContent(footnoteNodeId.value, content, currentEditor)
    }
    if (!saved) {
      ElMessage.warning(mode.startsWith('table-')
        ? '无法在当前表格保存表脚注，请确认光标仍位于原表格内。'
        : '脚注所在段落已变化，请重新选择正文段落后再试。')
      return
    }
    currentEditor.view.focus()
    showFootnoteDialog.value = false
  }

  async function deleteBodyFootnote() {
    if (isUnavailable()) return
    const currentEditor = editor.value
    if (!currentEditor || !footnoteNodeId.value) return
    const deleted = currentEditor.commands.deleteFootnoteRef({ nodeId: footnoteNodeId.value })
    if (!deleted) {
      ElMessage.warning('脚注已不存在，请重新打开脚注编辑框。')
      return
    }
    currentEditor.view.focus()
    showFootnoteDialog.value = false
  }

  async function deleteTableFootnoteDefinition() {
    if (isUnavailable()) return
    const currentEditor = activeEditor()
    if (!currentEditor || !footnoteNodeId.value) return
    const deleted = currentEditor.commands.deleteTableFootnoteEntry({ nodeId: footnoteNodeId.value })
    if (!deleted) {
      ElMessage.warning('该表脚注仍有上标引用。请先删除对应上标引用，再删除定义。')
      return
    }
    currentEditor.view.focus()
    showFootnoteDialog.value = false
  }

  function handleInsertExample(command: string) {
    if (command === 'example') {
      const pos = getInsertAfterCurrentBlock()
      if (pos === null) return
      editor.value?.chain().focus().insertContentAt(pos, { type: 'example' }).run()
    }
  }

  function handleInsertTermDef(level: string) {
    const range = getInsertRange()
    if (range === null) {
      ElMessage.warning('请先将光标置于章节内部再插入术语定义')
      return
    }
    const lv = Number(level)
    const { tr } = editor.value!.state
    const schema = editor.value!.state.schema
    const termDefNode = schema.nodes.termDef.create(
      { level: lv },
      [
        schema.nodes.termName.create(null, []),
        schema.nodes.termDefinition.create(null, []),
      ],
    )
    tr.replaceWith(range.from, range.to, termDefNode)
    tr.setSelection(TextSelection.create(tr.doc, range.from + 2))
    editor.value!.view.dispatch(tr)
    editor.value!.view.focus()
  }

  function insertStdParagraph() {
    if (editor.value) warnStructureFailure(setParagraphFormat(editor.value), 'paragraph')
  }

  function handleInsertFormula(triggerPos?: number) {
    if (editor.value?.commands.insertFormula({ triggerPos }) === false) {
      ElMessage.info('此处无法插入公式，请将光标放在正文中')
    }
  }

  function openMathDialog(request: InlineFormulaRequest | BlockFormulaRequest) {
    const targetEditor = (request.mode === 'block-insert' || request.mode === 'block-edit' || request.mode === 'where')
      ? editor.value
      : activeEditor()
    mathDialogRequest.value = request
    mathDialogDoc = targetEditor?.state.doc ?? null
    mathDialogLatex.value = request.latex
    showMathDialog.value = true
  }

  watch(showMathDialog, (open) => {
    if (!open) {
      mathDialogRequest.value = null
      mathDialogDoc = null
    }
  })

  function handleBlockFormulaEvent(event: Event) {
    const detail = (event as CustomEvent<BlockFormulaRequest>).detail
    if (detail) openMathDialog(detail)
  }

  function handleInlineFormulaEvent(event: Event) {
    const detail = (event as CustomEvent<InlineFormulaRequest>).detail
    if (detail) openMathDialog(detail)
  }

  function handleInlineFormula() {
    const ed = editor.value
    if (!ed) return
    if (!ed.commands.requestInlineFormula()) {
      ElMessage.info('符号只能放在正文、列项、注、示例、表格单元格、术语定义等位置；选中文字转为符号时，选区不能跨段或包含其他符号、公式、脚注')
    }
  }

  const showWhereConversion = ref(false)
  const whereConversion = ref<{ pos: number; source: string; formula: PMJsonNode; rows: WhereConversionRow[] } | null>(null)

  function openWhereConversion(formulaPos: number) {
    const node = editor.value?.state.doc.nodeAt(formulaPos)
    if (!node || node.type.name !== 'formula') return
    const source = node.toJSON() as PMJsonNode
    const { formula, rows } = convertLegacyWhereDescription(source)
    if (!rows.length) return
    whereConversion.value = { pos: formulaPos, source: JSON.stringify(source), formula, rows }
    showWhereConversion.value = true
  }

  function applyWhereConversion() {
    const ed = editor.value
    const pending = whereConversion.value
    whereConversion.value = null
    if (!ed || !pending) return
    const node = ed.state.doc.nodeAt(pending.pos)
    if (!node || JSON.stringify(node.toJSON()) !== pending.source) {
      ElMessage.warning('公式已被修改，请重新转换')
      return
    }
    const replacement = ed.schema.nodeFromJSON(pending.formula)
    ed.view.dispatch(ed.state.tr.replaceWith(pending.pos, pending.pos + node.nodeSize, replacement).scrollIntoView())
    ed.commands.focus()
    ElMessage.success('已转换为结构化式中')
  }

  function handleAddWhereItem() {
    const ed = editor.value
    if (!ed) return
    const formula = selectedFormula(ed.state)
    if (!formula) {
      ElMessage.info('请先把光标放在公式内')
      return
    }
    if (formulaHasLegacyDescription(formula.node)) {
      openWhereConversion(formula.pos)
      return
    }
    if (!ed.can().addWhereItem({ pos: formula.pos })) return
    openMathDialog({ mode: 'where', pos: formula.pos, nodeId: formula.node.attrs.nodeId ?? undefined, latex: '' })
  }

  function handleMathConfirm(latex: string) {
    const request = mathDialogRequest.value
    const ed = (request?.mode === 'block-insert' || request?.mode === 'block-edit' || request?.mode === 'where')
      ? editor.value
      : activeEditor()
    const openedDoc = mathDialogDoc
    if (!ed?.isEditable || !request) return
    const located = (pos: number) => !!openedDoc && sameInlineLocation(openedDoc, ed.state.doc, pos)
    let applied = false
    if (request.mode === 'block-insert') {
      applied = located(request.pos) && ed.commands.insertFormula({ pos: request.pos, triggerPos: request.triggerPos, latex })
      if (applied) ed.commands.focus()
    } else if (request.mode === 'block-edit') {
      const before = openedDoc?.nodeAt(request.pos)
      const current = request.pos < ed.state.doc.content.size ? ed.state.doc.nodeAt(request.pos) : null
      applied = !!before && !!current?.eq(before) && ed.commands.updateBlockFormula({ pos: request.pos, latex })
      if (applied) ed.commands.focus()
    } else if (request.mode === 'where') {
      const node = ed.state.doc.nodeAt(request.pos)
      applied = node?.type.name === 'formula' && (node.attrs.nodeId ?? undefined) === request.nodeId
        && ed.chain().focus().addWhereItem({ pos: request.pos, latex }).run()
    } else if (request.mode === 'edit') {
      applied = ed.chain().focus().updateFormulaInline({ pos: request.pos, latex, nodeId: request.nodeId }).run()
    } else if (request.mode === 'replace') {
      applied = located(request.pos) && located(request.to ?? request.pos) && ed.chain().focus().replaceSelectionWithFormula({
        from: request.pos, to: request.to ?? request.pos, text: request.text ?? '', latex,
      }).run()
    } else if (located(request.pos)) {
      applied = ed.chain().focus().setTextSelection(request.pos).insertInlineFormula({ latex }).run()
    }
    if (!applied) ElMessage.warning('文档已变化，未能写入公式，请重新选择位置')
  }

  async function handleInsertFigure(pos?: number, slashPos?: number) {
    const ed = editor.value
    if (!ed || !ed.isEditable) return
    if (pos === undefined && !ed.can().insertFigure()) {
      ElMessage.info('此处无法插入图片，请将光标放在正文或表格单元格中')
      return
    }
    const resourceKey = options.getResourceKey?.()
    const target = captureImageTarget(ed, pos, slashPos)
    try {
      const src = await selectLocalImage()
      if (!src) return
      if (editor.value !== ed || options.getResourceKey?.() !== resourceKey || !applyImageTarget(ed, target, src)) {
        ElMessage.warning('未能在原位置插入图片，请重新选择位置')
      }
    } catch (error) {
      ElMessage.warning(error instanceof Error ? error.message : '图片读取失败')
    }
  }

  function handleSlashCommand(command: string) {
    if (!editor.value) return
    const { from } = editor.value.state.selection
    const textBefore = editor.value.state.doc.textBetween(Math.max(0, from - 1), from)
    if (command === 'formula') {
      handleInsertFormula(textBefore === '/' ? from - 1 : undefined)
      return
    }
    if (command === 'figure') {
      void handleInsertFigure(undefined, textBefore === '/' ? from - 1 : undefined)
      return
    }
    if (textBefore === '/') {
      editor.value.chain().focus().deleteRange({ from: from - 1, to: from }).run()
    }

    if (command.startsWith('clause:')) {
      handleInsertClause(command.split(':')[1]!)
    } else if (command.startsWith('clauseNoTitle:')) {
      handleInsertClauseNoTitle(command.split(':')[1]!)
    } else if (command.startsWith('termDef:')) {
      handleInsertTermDef(command.split(':')[1]!)
    } else if (command.startsWith('list:')) {
      handleInsertList(command.split(':')[1]!)
    } else {
      switch (command) {
        case 'paragraph': insertStdParagraph(); break
        case 'table': handleTableCommand('insert'); break
        case 'whereItem': handleAddWhereItem(); break
        case 'note': handleInsertNote('note'); break
        case 'footnote': handleInsertNote('footnote'); break
        case 'example': handleInsertExample('example'); break
        case 'termDef': handleInsertTermDef('1'); break
      }
    }
  }

  function toggleUnderline() {
    editor.value?.chain().focus().toggleUnderline().run()
  }

  function syncSearchStatus() {
    const currentEditor = editor.value
    if (!currentEditor) { searchStatus.value = ''; return }
    const state = getSearchState(currentEditor.state)
    searchStatus.value = !state.query ? '' : state.matches.length === 0 ? '0/0' : `${state.current + 1}/${state.matches.length}`
  }

  function runSearch(direction: 1 | -1) {
    const currentEditor = editor.value
    const text = searchText.value
    if (!currentEditor || !text) return
    const { state, wrapped } = stepSearch(currentEditor.view, text, direction)
    syncSearchStatus()
    if (state.matches.length === 0) {
      ElMessage.info('未找到匹配内容')
      return
    }
    scrollToCurrentSearchMatch(currentEditor.view)
    if (wrapped) {
      ElMessage.info(state.matches.length === 1 ? '仅有 1 处匹配' : direction === 1 ? '已到最后一处，回到第一处' : '已到第一处，回到最后一处')
    }
  }

  function handleSearchKeydown(event: Event | KeyboardEvent) {
    if (!(event instanceof KeyboardEvent)) return
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      runSearch(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      returnToEditorFromSearch()
    }
  }

  function returnToEditorFromSearch() {
    const currentEditor = editor.value
    if (!currentEditor) return
    const state = getSearchState(currentEditor.state)
    const match = state.current >= 0 ? state.matches[state.current] : null
    clearSearch(currentEditor.view)
    syncSearchStatus()
    const chain = currentEditor.chain().focus()
    if (match) chain.setTextSelection(match.to)
    chain.run()
  }

  function handleSearchClear() {
    if (editor.value) clearSearch(editor.value.view)
    syncSearchStatus()
  }

  watch(searchText, (text) => {
    const currentEditor = editor.value
    if (currentEditor && getSearchState(currentEditor.state).query && getSearchState(currentEditor.state).query !== text) {
      clearSearch(currentEditor.view)
      syncSearchStatus()
    }
  })

  function handleAmbiguousPasteReference(event: Event) {
    const message = event instanceof CustomEvent && typeof event.detail?.message === 'string'
      ? event.detail.message
      : '粘贴内容含重复引用目标，无法确定关联，请先修正源内容'
    ElMessage.error(message)
  }

  function handleMissingReference() {
    ElMessage.warning('找不到被引用的内容，目标可能已删除；请重新选择引用目标')
  }

  function getEditorContent(): Record<string, unknown> {
    if (!editor.value) return {}
    return editor.value.getJSON() as Record<string, unknown>
  }

  function getEditorDoc() {
    return editor.value?.state.doc
  }

  onMounted(() => {
    window.addEventListener('ses:request-footnote-dialog', openBodyFootnoteDialog)
    window.addEventListener(INLINE_FORMULA_EVENT, handleInlineFormulaEvent)
    window.addEventListener('ses:edit-footnote', handleFootnoteEditEvent)
    window.addEventListener(EXPAND_LANDSCAPE_TABLE_EVENT, handleExpandLandscapeTableEvent)
    window.addEventListener('ses:paste-reference-error', handleAmbiguousPasteReference)
    window.addEventListener('ses:reference-missing', handleMissingReference)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('ses:request-footnote-dialog', openBodyFootnoteDialog)
    window.removeEventListener(INLINE_FORMULA_EVENT, handleInlineFormulaEvent)
    window.removeEventListener('ses:edit-footnote', handleFootnoteEditEvent)
    window.removeEventListener(EXPAND_LANDSCAPE_TABLE_EVENT, handleExpandLandscapeTableEvent)
    window.removeEventListener('ses:paste-reference-error', handleAmbiguousPasteReference)
    window.removeEventListener('ses:reference-missing', handleMissingReference)
  })

  return {
    editor,
    docRevision,
    showOutline,
    edMainRef,
    tablePanelAutoCollapse,
    searchText,
    searchStatus,
    cursorInFormula,
    cursorAllowsInlineFormula,
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
    landscapeDialogRef,
    landscapeDialogTableJson,
    landscapeDialogTableLabel,
    showFootnoteDialog,
    footnoteDialogMode,
    footnoteDialogTitle,
    footnoteText,
    tableFootnoteOptions,
    selectedTableFootnoteId,
    setSuppressUpdate,
    withSuppressedUpdate,
    getEditorContent,
    getEditorDoc,
    activeEditor,
    activeOrientationNodeType,
    selectedFigureImagePos,
    resizeSelectedFigure,
    activeAppendixPos,
    activeAppendixOrientation,
    setActiveAppendixOrientation,
    isOrientationLockedByAppendix,
    activeOrientationShortLabel,
    activeOrientationLabel,
    orientationLockedHint,
    orientationButtonTitle,
    isActivePageOrientation,
    setActivePageOrientation,
    toggleUnderline,
    insertStdParagraph,
    handleInsertClause,
    handleInsertClauseNoTitle,
    handleInsertList,
    handleInsertNote,
    handleInsertExample,
    handleInsertTermDef,
    handleInsertFormula,
    handleInlineFormula,
    handleAddWhereItem,
    handleInsertFigure,
    handleAddStructure,
    handleSlashCommand,
    handleTableCommand,
    handleSearchKeydown,
    handleSearchClear,
    handleBlockFormulaEvent,
    openWhereConversion,
    applyWhereConversion,
    handleMathConfirm,
    openActiveLandscapeTable,
    canApplyLandscapeDialog,
    handleLandscapeDialogApply,
    hasUnappliedLandscapeEdits,
    openTableFootnoteDialog,
    clearFootnoteDialog,
    saveFootnoteDialog,
    deleteBodyFootnote,
    deleteTableFootnoteDefinition,
  }
}
