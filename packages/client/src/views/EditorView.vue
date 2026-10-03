<template>
  <div class="editor-view" v-loading="loading">
    <!-- =====================  TOP NAV  ===================== -->
    <header class="ed-nav">
      <div class="nav-l">
        <a class="ses-brand" @click.prevent="goHome" href="#">
          <div class="ses-brand-mark" />
          <span>标准编辑器</span>
        </a>
        <div class="brand-sep" />
        <div class="doc-crumb" :title="store.currentDocument?.meta?.titleCn || store.currentDocument?.title">
          <span class="std-no">{{ store.currentDocument?.meta?.standardNo || '— · 待编号' }}</span>
          <span class="dot-sep">·</span>
          <span class="crumb-title">{{ store.currentDocument?.meta?.titleCn || store.currentDocument?.title || '加载中…' }}</span>
          <el-icon class="caret"><ArrowDownIcon /></el-icon>
        </div>
      </div>

      <nav class="ed-tabs">
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'edit' }"     @click="activeTab = 'edit'">文件编辑</button>
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'settings' }" @click="activeTab = 'settings'">文件设置</button>
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'preview' }"  @click="activeTab = 'preview'">预览</button>
      </nav>

      <div class="nav-r">
        <span class="ses-save-pill" :class="{ 'is-saving': saving }">
          <span class="dot" />
          <template v-if="saving">保存中…</template>
          <template v-else-if="lastSaved">已保存 {{ lastSaved }}</template>
          <template v-else>未保存</template>
        </span>
        <div class="ses-avatar-stack">
          <span class="ses-avatar a1" title="李工 · 起草人">李</span>
          <span class="ses-avatar a2" title="王老师 · 审核人">王</span>
          <span class="ses-avatar a3" title="陈主任 · 批准人">陈</span>
        </div>
        <el-button text @click="handleViewHistory">
          <el-icon><Clock /></el-icon>
          <span>{{ showVersionPanel ? '关闭历史' : '版本历史' }}</span>
        </el-button>
        <el-button type="primary" @click="handleExport">
          <el-icon><Download /></el-icon>
          <span>导出</span>
        </el-button>
      </div>
    </header>

    <!-- =====================  EDIT TAB  ===================== -->
    <template v-if="activeTab === 'edit'">
      <!-- Toolbar -->
      <div class="ed-toolbar">
        <div class="tbar-outline-head">
          <span>文档结构</span>
          <el-dropdown trigger="click" @command="handleAddStructure">
            <button class="add-btn" title="添加章节结构"><el-icon><Plus /></el-icon></button>
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
        </div>

        <div class="tbar-groups">
          <!-- 结构要素 -->
          <div class="tbar-group">
            <el-dropdown trigger="click" @command="handleInsertClause">
              <button class="tbar-btn" title="将当前段落或条标题设为所选层级">条 <el-icon><ArrowDownIcon /></el-icon></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="lv in 5" :key="lv" :command="String(lv)">{{ ['一','二','三','四','五'][lv-1] }}级条</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-dropdown trigger="click" @command="handleInsertClauseNoTitle">
              <button class="tbar-btn" title="将当前段落或条标题设为无题条">无题条 <el-icon><ArrowDownIcon /></el-icon></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="lv in 4" :key="lv" :command="String(lv)">{{ ['一','二','三','四'][lv-1] }}级无题条</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-dropdown trigger="click" @command="handleInsertList">
              <button class="tbar-btn">列项 <el-icon><ArrowDownIcon /></el-icon></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="dash">破折号列项（一级）</el-dropdown-item>
                  <el-dropdown-item command="alpha">字母编号列项（一级）</el-dropdown-item>
                  <el-dropdown-item command="numeric">数字编号列项（二级）</el-dropdown-item>
                  <el-dropdown-item command="dot">间隔号列项（二级）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <!-- 内容要素 -->
          <div class="tbar-group">
            <el-dropdown trigger="click" @command="handleInsertNote">
              <button class="tbar-btn">注 <el-icon><ArrowDownIcon /></el-icon></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="note">注</el-dropdown-item>
                  <el-dropdown-item command="footnote">脚注</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <button class="tbar-btn" @click="handleInsertExample('example')">示例</button>
            <el-dropdown trigger="click" @command="handleInsertTermDef">
              <button class="tbar-btn">术语定义 <el-icon><ArrowDownIcon /></el-icon></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="lv in 5" :key="lv" :command="String(lv)">{{ ['一','二','三','四','五'][lv-1] }}级术语条</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <button class="tbar-btn" @click="handleInsertFormula()">公式</button>
          </div>

          <!-- 媒体 -->
          <div class="tbar-group">
            <el-dropdown trigger="click" @command="handleTableCommand">
              <button class="tbar-btn">表格 <el-icon><ArrowDownIcon /></el-icon></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="insert">插入表格 (3×3)</el-dropdown-item>
                  <el-dropdown-item divided command="addTableNote">添加表注行</el-dropdown-item>
                  <el-dropdown-item command="addTableFootnote">添加表脚注行（插入上标）</el-dropdown-item>
                  <el-dropdown-item command="referenceTableFootnote">引用已有表脚注</el-dropdown-item>
                  <el-dropdown-item command="deleteTableFootnoteRef">删除当前上标引用</el-dropdown-item>
                  <el-dropdown-item divided command="addRowBefore">上方插入行</el-dropdown-item>
                  <el-dropdown-item command="addRowAfter">下方插入行</el-dropdown-item>
                  <el-dropdown-item command="deleteRow">删除行</el-dropdown-item>
                  <el-dropdown-item divided command="addColBefore">左侧插入列</el-dropdown-item>
                  <el-dropdown-item command="addColAfter">右侧插入列</el-dropdown-item>
                  <el-dropdown-item command="deleteCol">删除列</el-dropdown-item>
                  <el-dropdown-item divided command="mergeCells">合并单元格</el-dropdown-item>
                  <el-dropdown-item command="splitCell">拆分单元格</el-dropdown-item>
                  <el-dropdown-item divided command="deleteTable">删除表格</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <button class="tbar-btn" @click="handleInsertFigure()">图片</button>
            <button class="tbar-btn" @click="insertStdParagraph()">段落</button>
          </div>

          <!-- 图表方向 -->
          <div v-if="activeOrientationNodeType()" class="tbar-group" aria-label="图表版面方向">
            <span class="tbar-label">版面</span>
            <button
              class="tbar-btn"
              :class="{ 'is-active': isActivePageOrientation('portrait') }"
              title="将所选图或表设为纵向页面"
              @click="setActivePageOrientation('portrait')"
            >纵向</button>
            <button
              class="tbar-btn"
              :class="{ 'is-active': isActivePageOrientation('landscape') }"
              title="将所选图或表设为横向页面"
              @click="setActivePageOrientation('landscape')"
            >横向</button>
          </div>

          <!-- 格式 -->
          <div class="tbar-group format-group">
            <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('bold') }"      @click="editor?.chain().focus().toggleBold().run()"><strong>B</strong></button>
            <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('italic') }"    @click="editor?.chain().focus().toggleItalic().run()"><em>I</em></button>
            <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('underline') }" @click="toggleUnderline()"><u>U</u></button>
            <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('strike') }"    @click="editor?.chain().focus().toggleStrike().run()"><s>S</s></button>
          </div>

          <!-- 撤销 / 重做 -->
          <div class="tbar-group">
            <button class="tbar-btn icon-btn" :disabled="!editor?.can().undo()" @click="editor?.chain().focus().undo().run()" title="撤销 Ctrl+Z">
              <el-icon><RefreshLeft /></el-icon>
            </button>
            <button class="tbar-btn icon-btn" :disabled="!editor?.can().redo()" @click="editor?.chain().focus().redo().run()" title="重做 Ctrl+Shift+Z">
              <el-icon><RefreshRight /></el-icon>
            </button>
          </div>

          <!-- 代码 / 导入 / 帮助 -->
          <div class="tbar-group">
            <button class="tbar-btn" @click="showXmlCode = true">
              <span style="font-family: var(--ses-font-mono); font-weight: 700">&lt;/&gt;</span>
              源码
            </button>
            <button class="tbar-btn" @click="triggerXmlImport">导入 XML</button>
            <button class="tbar-btn icon-btn" @click="showHelp = true" title="帮助">?</button>
          </div>
        </div>

        <!-- search -->
        <div class="tbar-search">
          <el-input
            v-model="searchText"
            size="small"
            placeholder="搜索…"
            :prefix-icon="Search"
            clearable
            @keyup.enter="handleSearch"
          />
        </div>
      </div>

      <!-- Editor body: outline + canvas + (optional) version sidebar -->
      <div class="ed-body ses-scroll">
        <DocumentOutline :editor="editor" />
        <div class="ed-main">
          <SesEditorContent :editor="editor" />
        </div>
        <transition name="slide-right">
          <div class="version-sidebar" v-if="showVersionPanel">
            <VersionPanel
              :document-id="documentId"
              :get-content="getEditorContent"
              :get-doc="getEditorDoc"
              :set-content="setEditorContent"
              @close="showVersionPanel = false"
            />
          </div>
        </transition>
      </div>

      <!-- Slash command (mounted globally) -->
      <SlashMenu @execute="handleSlashCommand" />
    </template>

    <!-- =====================  SETTINGS TAB  ===================== -->
    <div v-else-if="activeTab === 'settings'" class="tab-placeholder">
      <el-empty description="文件设置（开发中）" />
    </div>

    <!-- =====================  PREVIEW TAB  ===================== -->
    <div v-else-if="activeTab === 'preview'" class="tab-placeholder">
      <el-empty description="GB/T 1.1 文档预览（开发中）" />
    </div>

    <!-- =====================  CODE VIEW DIALOG  ===================== -->
    <el-dialog v-model="showXmlCode" title="查看文档代码" width="900px" class="ses-code-dlg">
      <div class="code-dlg-head">
        <el-radio-group v-model="codeViewFormat" size="small">
          <el-radio-button value="xml">XML · GB/T 37967</el-radio-button>
          <el-radio-button value="json">语义 JSON</el-radio-button>
          <el-radio-button value="html">语义 HTML</el-radio-button>
          <el-radio-button value="raw">原始 JSON</el-radio-button>
        </el-radio-group>
        <div style="display: flex; gap: 8px">
          <el-button size="small" @click="copyCodeContent">复制</el-button>
          <el-button size="small" @click="downloadCodeContent">下载</el-button>
        </div>
      </div>
      <pre class="xml-code">{{ codeViewContent }}</pre>
    </el-dialog>

    <input ref="xmlFileInput" type="file" accept=".xml" style="display: none" @change="handleXmlFileImport" />

    <!-- =====================  HELP DIALOG  ===================== -->
    <el-dialog v-model="showHelp" title="键盘快捷键 / 帮助" width="520px">
      <div class="help-content">
        <h4>快捷键</h4>
        <ul>
          <li><kbd>Ctrl</kbd> + <kbd>B</kbd> 加粗</li>
          <li><kbd>Ctrl</kbd> + <kbd>I</kbd> 斜体</li>
          <li><kbd>Ctrl</kbd> + <kbd>Z</kbd> 撤销</li>
          <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> 重做</li>
          <li><kbd>Ctrl</kbd> + <kbd>S</kbd> 保存</li>
          <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> 插入脚注</li>
          <li><kbd>/</kbd> 智能插入菜单</li>
        </ul>
        <h4>文档结构</h4>
        <p>使用左上角"+"按钮添加章节结构（前言、引言、章、附录、参考文献）。点击正文段落或选中其中的文字后，使用“条”“无题条”设置整段格式；新条之后的正文归入该条，直到下一个同级条。一级条置于章或附录内，其他级别置于上一级条内。含子条时保留原层级，可切换有题/无题；先调整子条结构再改层级或段落。需要新条时，先回车建立空段再设置格式。</p>
        <p>术语中英文名称同列显示：Tab 从中文名进入英文名，Enter 进入定义；在定义中 Enter 新建续段，末尾空续段再次 Enter 退出术语。使用工具栏插入列项、注、示例、公式、表格、图片等内容要素。选中图或表后，可切换纵向或横向版面。</p>
      </div>
    </el-dialog>

    <!-- =====================  EXPORT DIALOG  ===================== -->
    <el-dialog v-model="showExport" title="导出文档" width="560px">
      <p style="margin: 0 0 16px; color: var(--ses-ink-3); font-size: 13px">选择导出格式：</p>
      <el-alert
        v-if="exportError"
        :title="exportError"
        type="error"
        :closable="false"
        show-icon
        style="margin-bottom: 14px"
      />
      <p style="margin: 0 0 12px; color: var(--ses-ink-3); font-size: 12px">
        DOCX 目次：增删章条后需重新导出以更新目次条目；页码由 Word 更新。续表与长脚注分页请用 Word 校对。
        真实标准文稿的整体验收尚未完成；部分封面素材来源或清晰度有限，正式交付前请核对。
      </p>
      <div class="export-grid">
        <button
          class="export-card primary"
          :disabled="exportingFormat !== null"
          @click="handleExportFormat('docx')"
        >
          <span class="ec-glyph">W</span>
          <span class="ec-label">DOCX</span>
          <span class="ec-sub">{{ exportingFormat === 'docx' ? '正在生成…' : '测试版 · 真实文稿交付验收待完成' }}</span>
        </button>
        <button
          v-if="capabilities.htmlToPdf"
          class="export-card"
          :disabled="exportingFormat !== null"
          @click="handleExportFormat('pdf')"
        >
          <span class="ec-glyph">PDF</span>
          <span class="ec-label">版式预览（GB/T 1.1 排版）</span>
          <span class="ec-sub">{{ exportingFormat === 'pdf' ? '正在转换…' : '自动生成目次页码' }}</span>
        </button>
        <button class="export-card" :disabled="exportingFormat !== null" @click="handleExportFormat('xml')">
          <span class="ec-glyph">&lt;/&gt;</span>
          <span class="ec-label">XML</span>
          <span class="ec-sub">GB/T 37967 元数据</span>
        </button>
        <button class="export-card" :disabled="exportingFormat !== null" @click="handleExportFormat('html')">
          <span class="ec-glyph">&#9636;</span>
          <span class="ec-label">HTML</span>
          <span class="ec-sub">语义化标注</span>
        </button>
        <button class="export-card" :disabled="exportingFormat !== null" @click="handleExportFormat('json')">
          <span class="ec-glyph">{ }</span>
          <span class="ec-label">JSON</span>
          <span class="ec-sub">完整树形结构</span>
        </button>
      </div>
    </el-dialog>

    <el-dialog
      v-model="showFootnoteDialog"
      :title="footnoteDialogTitle"
      width="560px"
      destroy-on-close
      @closed="clearFootnoteDialog"
    >
      <template v-if="footnoteDialogMode === 'table-reference'">
        <el-form label-width="92px">
          <el-form-item label="表脚注">
            <el-select v-model="selectedTableFootnoteId" placeholder="选择本表已有脚注" style="width: 100%">
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
      <template #footer>
        <el-button @click="showFootnoteDialog = false">取消</el-button>
        <el-button
          v-if="footnoteDialogMode === 'table-edit'"
          type="danger"
          plain
          @click="deleteTableFootnoteDefinition"
        >删除表脚注定义</el-button>
        <el-button
          v-if="footnoteDialogMode === 'body-edit'"
          type="danger"
          plain
          @click="deleteBodyFootnote"
        >删除脚注</el-button>
        <el-button type="primary" @click="saveFootnoteDialog">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>


<script setup lang="ts">
import { createDefaultDocumentContent } from '@/utils/newDocument'
import { setClauseFormat, setParagraphFormat } from '@/utils/structureEditing'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { useRoute, useRouter } from 'vue-router'
// Underline is included in StarterKit (tiptap v3)
import { Plus, Search, RefreshLeft, RefreshRight, ArrowDown as ArrowDownIcon, Clock, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { documentApi } from '@/api/document'
import { useDocumentStore } from '@/stores/document'
import SesEditorContent from '@/components/editor/EditorContent.vue'
import DocumentOutline from '@/components/editor/DocumentOutline.vue'
import SlashMenu from '@/components/editor/SlashMenu.vue'
import VersionPanel from '@/components/version/VersionPanel.vue'

import { useEditor } from '@tiptap/vue-3'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { canInsertBodyFootnote } from '@/extensions/nodes/footnotes'
import { getTableFootnoteEntries } from '@/extensions/nodes/std-table'
import {
  serializeToXml, parseXmlToEditorJson,
  prepareXmlImportDocumentUpdate,
  exportSemanticJson, exportSemanticHtml,
  buildPdfExportRequest, buildDocxBlob,
} from '@/serializer'
import { irMetaFromDocumentMeta, pmToIr, resolve, type IRDocMeta, type PMJsonNode } from '@ses/shared'

const route = useRoute()
const router = useRouter()
const store = useDocumentStore()

const loading = ref(true)
const saving = ref(false)
const lastSaved = ref('')
const activeTab = ref<'edit' | 'settings' | 'preview'>('edit')
const searchText = ref('')
const showXmlCode = ref(false)
const showHelp = ref(false)
const showExport = ref(false)
const codeViewFormat = ref<'xml' | 'json' | 'html' | 'raw'>('xml')
const xmlFileInput = ref<HTMLInputElement | null>(null)
const showVersionPanel = ref(false)
const documentId = computed(() => Number(route.params.id))
const exportingFormat = ref<'docx' | 'pdf' | null>(null)
const exportError = ref('')
type FootnoteDialogMode = 'body-new' | 'body-edit' | 'table-new' | 'table-edit' | 'table-reference' | null
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
/** 出件能力（服务端探测）：htmlToPdf=Vivliostyle 管线 */
const capabilities = ref<{ htmlToPdf: boolean }>({
  htmlToPdf: true,
})

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
const dirty = ref(false)
const contentReady = ref(false)
let importingXml = false

function scheduleAutoSave() {
  if (!contentReady.value) return
  dirty.value = true
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => {
    handleSave()
  }, 3000)
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

function isActivePageOrientation(orientation: 'portrait' | 'landscape'): boolean {
  const nodeType = activeOrientationNodeType()
  const currentEditor = editor.value
  if (!nodeType || !currentEditor) return false
  return currentEditor.getAttributes(nodeType).orientation === orientation
}

function setActivePageOrientation(orientation: 'portrait' | 'landscape') {
  const nodeType = activeOrientationNodeType()
  if (nodeType) editor.value?.chain().focus().updateAttributes(nodeType, { orientation }).run()
}

const editor = useEditor({
  extensions: createEditorExtensions(),
  content: '',
  onUpdate() {
    scheduleAutoSave()
  },
  editorProps: {
    handleKeyDown(_view, event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        handleSave()
        return true
      }
      return false
    },
  },
})

const codeViewContent = computed(() => {
  if (!editor.value) return ''
  const doc = editor.value.state.doc

  switch (codeViewFormat.value) {
    case 'xml':
      try {
        return serializeToXml(doc)
      } catch (e) {
        return `XML 序列化错误: ${e}`
      }
    case 'json':
      try {
        return JSON.stringify(exportSemanticJson(doc), null, 2)
      } catch (e) {
        return `JSON 导出错误: ${e}`
      }
    case 'html':
      try {
        return exportSemanticHtml(doc)
      } catch (e) {
        return `HTML 导出错误: ${e}`
      }
    case 'raw':
      return JSON.stringify(editor.value.getJSON(), null, 2)
    default:
      return ''
  }
})

onMounted(async () => {
  window.addEventListener('ses:request-footnote-dialog', openBodyFootnoteDialog)
  window.addEventListener('ses:edit-footnote', handleFootnoteEditEvent)
  const id = Number(route.params.id)
  try {
    await store.fetchDocument(id)
    if (store.currentDocument?.content && Object.keys(store.currentDocument.content).length > 0) {
      editor.value?.commands.setContent(store.currentDocument.content)
    } else {
      // 新文档加载默认结构
      editor.value?.commands.setContent(createDefaultDocumentContent(store.currentDocument?.meta))
    }
    contentReady.value = true
  } catch {
    ElMessage.error('文档加载失败')
    router.push('/')
  } finally {
    loading.value = false
  }
  // 探测服务端 PDF 出件能力。
  try {
    const resp = await fetch('/api/convert/capabilities')
    if (resp.ok) capabilities.value = await resp.json()
  } catch {
    // 忽略：保持默认能力
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('ses:request-footnote-dialog', openBodyFootnoteDialog)
  window.removeEventListener('ses:edit-footnote', handleFootnoteEditEvent)
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  if (dirty.value && !importingXml && editor.value && store.currentDocument) {
    const content = editor.value.getJSON()
    const currentId = store.currentDocument.id
    if (currentId != null) {
      void documentApi.update(currentId, { content })
    }
  }
  editor.value?.destroy()
})

async function handleSave() {
  if (!editor.value || !store.currentDocument || importingXml) return
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null }
  saving.value = true
  try {
    const content = editor.value.getJSON()
    await store.updateDocument(store.currentDocument.id!, { content })
    dirty.value = false
    lastSaved.value = new Date().toLocaleTimeString('zh-CN')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

function goHome() {
  router.push('/')
}

// === 左侧 "+" 按钮：插入章节结构 ===
/**
 * 查找文档中各结构元素的位置，用于智能插入
 */
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
      // 前言插入到文档最前面
      editor.value.chain().focus().insertContentAt(0, {
        type: 'foreword',
        content: [{ type: 'paragraph' }],
      }).run()
      break
    case 'introduction':
      if (pos.hasIntroduction) {
        ElMessage.warning('引言已存在')
        return
      }
      // 引言插入在前言之后、第一章之前
      {
        const insertAt = pos.forewordEnd > 0 ? pos.forewordEnd : (pos.firstChapterPos > 0 ? pos.firstChapterPos : 0)
        editor.value.chain().focus().insertContentAt(insertAt, {
          type: 'introduction',
          content: [{ type: 'paragraph' }],
        }).run()
      }
      break
    case 'chapter':
      // 章插入到最后一章之后（附录之前）
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
      // 附录插入到最后一个附录之后，或最后一章之后
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
      // 参考文献插入到文档末尾
      editor.value.chain().focus().insertContentAt(editor.value.state.doc.content.size, {
        type: 'bibliography',
        content: [
          { type: 'bibliographyTitle', content: [{ type: 'text', text: '参考文献' }] },
          { type: 'bibEntry', content: [{ type: 'text', text: '[1] ' }] },
        ],
      }).run()
      break
  }
}

// isInsideChapterOrClause / findInsertPosInChapterOrClause removed (unused)

// === 获取插入位置（如果光标在空段落中，返回替换范围；否则返回插入点） ===
function getInsertRange(): { from: number; to: number } | null {
  if (!editor.value) return null
  const { $from } = editor.value.state.selection
  // 检查光标是否在空的 stdParagraph 中
  if ($from.parent.type.name === 'stdParagraph' && $from.parent.textContent === '') {
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'stdParagraph') {
        return { from: $from.before(d), to: $from.after(d) }
      }
    }
  }
  // 否则，在当前块之后插入
  const insertPos = getInsertAfterCurrentBlock()
  if (insertPos === null) return null
  return { from: insertPos, to: insertPos }
}

// === 工具栏：条 ===
function handleInsertClause(level: string) {
  if (editor.value && !setClauseFormat(editor.value, Number(level))) {
    ElMessage.warning('当前结构不能设置该级别：须有对应上级；含子条或会破坏后续条结构时，请先调整条结构')
  }
}

function handleInsertClauseNoTitle(level: string) {
  if (editor.value && !setClauseFormat(editor.value, Number(level), false)) {
    ElMessage.warning('当前结构不能设置该级别：须有对应上级；含子条或会破坏后续条结构时，请先调整条结构')
  }
}

// === 工具栏：表格 ===
function handleTableCommand(command: string) {
  if (!editor.value) return
  const chain = editor.value.chain().focus()
  switch (command) {
    case 'insert': {
      const pos = getInsertAfterCurrentBlock()
      if (pos !== null) {
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
      }
      break
    }
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
      chain.deleteTable().run()
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
  }
}

// === 工具栏：列项 ===
function handleInsertList(listType: string) {
  editor.value?.chain().focus().insertStdList({ listType }).run()
}

// === 工具栏：注 ===
function handleInsertNote(command: string) {
  if (command === 'note') {
    editor.value?.chain().focus().insertNote().run()
  } else if (command === 'footnote') {
    openBodyFootnoteDialog()
  }
}

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

function currentTableLocation(): { node: import('@tiptap/pm/model').Node; pos: number } | null {
  if (!editor.value) return null
  const { $from } = editor.value.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'stdTable') return { node, pos: $from.before(depth) }
  }
  return null
}

function selectionIsInTableCell(): boolean {
  if (!editor.value) return false
  const { $from, $to } = editor.value.state.selection
  if ($from.parent !== $to.parent) return false
  let foundCell = false
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const type = $from.node(depth).type.name
    if (type === 'tableCell' || type === 'tableHeader') foundCell = true
    if (type === 'stdTable') return foundCell
  }
  return false
}

function collectTableFootnotes(): Array<{ id: string; label: string; text: string }> {
  const table = currentTableLocation()
  if (!table || !editor.value) return []
  const { doc: irDoc } = pmToIr(editor.value.getJSON() as PMJsonNode)
  const labels = resolve(irDoc).labels
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
  if (!editor.value || !selectionIsInTableCell()) {
    ElMessage.warning('请将光标置于标准表格的单元格内')
    return
  }
  const options = collectTableFootnotes()
  if (mode === 'table-reference' && options.length === 0) {
    ElMessage.info('当前表格还没有可引用的表脚注')
    return
  }
  footnoteDialogMode.value = mode
  footnoteNodeId.value = ''
  footnoteOriginalContent.value = []
  footnoteText.value = ''
  tableFootnoteOptions.value = options
  selectedTableFootnoteId.value = options[0]?.id || ''
  showFootnoteDialog.value = true
}

function openFootnoteById(nodeId: string, table: boolean) {
  if (!editor.value) return
  const found: { target: import('@tiptap/pm/model').Node | null } = { target: null }
  editor.value.state.doc.descendants((node) => {
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

function saveFootnoteDialog() {
  const currentEditor = editor.value
  const mode = footnoteDialogMode.value
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
    saved = replaceTableFootnoteContent(footnoteNodeId.value, content)
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

function replaceTableFootnoteContent(nodeId: string, content: PMJsonNode[]): boolean {
  const currentEditor = editor.value
  if (!currentEditor) return false
  const found: { target: { node: import('@tiptap/pm/model').Node; pos: number } | null } = { target: null }
  currentEditor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableFootnoteEntry' && node.attrs.nodeId === nodeId) found.target = { node, pos }
  })
  if (!found.target) return false
  const nodes = content.map((item) => currentEditor.schema.nodeFromJSON(item))
  const tr = currentEditor.state.tr.replaceWith(found.target.pos + 1, found.target.pos + found.target.node.nodeSize - 1, nodes)
  currentEditor.view.dispatch(tr)
  return true
}

async function deleteBodyFootnote() {
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
  const currentEditor = editor.value
  if (!currentEditor || !footnoteNodeId.value) return
  const deleted = currentEditor.commands.deleteTableFootnoteEntry({ nodeId: footnoteNodeId.value })
  if (!deleted) {
    ElMessage.warning('该表脚注仍有上标引用。请先删除对应上标引用，再删除定义。')
    return
  }
  currentEditor.view.focus()
  showFootnoteDialog.value = false
}

// === 工具栏：示例 ===
function handleInsertExample(command: string) {
  if (command === 'example') {
    const pos = getInsertAfterCurrentBlock()
    if (pos === null) return
    editor.value?.chain().focus().insertContentAt(pos, { type: 'example' }).run()
  }
}

// === 工具栏：术语定义 ===
function handleInsertTermDef(level: string) {
  const range = getInsertRange()
  if (range === null) {
    ElMessage.warning('请先将光标置于章节内部再插入术语定义')
    return
  }
  const lv = Number(level)
  const { tr } = editor.value!.state
  const schema = editor.value!.state.schema
  // 手动构建节点以避免 insertContentAt 自动补充额外节点
  const termDefNode = schema.nodes.termDef.create(
    { level: lv },
    [
      schema.nodes.termName.create(null, []),
      schema.nodes.termDefinition.create(null, []),
    ],
  )
  tr.replaceWith(range.from, range.to, termDefNode)
  // 光标设置到 termName 内部: from + termDef(+1) + termName(+1)
  tr.setSelection(TextSelection.create(tr.doc, range.from + 2))
  editor.value!.view.dispatch(tr)
  editor.value!.view.focus()
}

/**
 * 在当前块之后（同一结构节点内）插入内容
 */
function getInsertAfterCurrentBlock(): number | null {
  if (!editor.value) return null
  const { $from } = editor.value.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const parentName = $from.node(d).type.name
    if (['chapter', 'clause', 'foreword', 'introduction', 'appendix'].includes(parentName)) {
      return $from.after(d + 1 <= $from.depth ? d + 1 : d)
    }
  }
  return $from.after($from.depth)
}

// === 段落：格式覆盖保留条正文，已是段落时不新增空段 ===
function insertStdParagraph() {
  if (editor.value && !setParagraphFormat(editor.value)) {
    ElMessage.warning('当前位置不能直接改为段落；请先调整子条或同级条结构，原文与结构已保留')
  }
}

// === 公式 ===
function handleInsertFormula() {
  const pos = getInsertAfterCurrentBlock()
  if (pos === null) return
  editor.value!.chain().focus().insertContentAt(pos, {
    type: 'formula',
    content: [
      { type: 'formulaContent', content: [{ type: 'text', text: 'E = mc^2' }] },
    ],
  }).run()
}

// === 图片 ===
function handleInsertFigure() {
  const pos = getInsertAfterCurrentBlock()
  if (pos === null) return
  editor.value!.chain().focus().insertContentAt(pos, {
    type: 'figure',
    content: [
      { type: 'figureImage', attrs: { src: '' } },
      { type: 'figureCaption' },
    ],
  }).run()
}

// === Slash Command ===
function handleSlashCommand(command: string) {
  if (!editor.value) return
  // 删除输入的 / 字符
  const { from } = editor.value.state.selection
  const textBefore = editor.value.state.doc.textBetween(Math.max(0, from - 1), from)
  if (textBefore === '/') {
    editor.value.chain().focus().deleteRange({ from: from - 1, to: from }).run()
  }

  if (command.startsWith('clause:')) {
    const level = command.split(':')[1]
    handleInsertClause(level)
  } else if (command.startsWith('clauseNoTitle:')) {
    const level = command.split(':')[1]
    handleInsertClauseNoTitle(level)
  } else if (command.startsWith('termDef:')) {
    const level = command.split(':')[1]
    handleInsertTermDef(level)
  } else if (command.startsWith('list:')) {
    const listType = command.split(':')[1]
    handleInsertList(listType)
  } else {
    switch (command) {
      case 'paragraph': insertStdParagraph(); break
      case 'table': handleTableCommand('insert'); break
      case 'formula': handleInsertFormula(); break
      case 'figure': handleInsertFigure(); break
      case 'note': handleInsertNote('note'); break
      case 'footnote': handleInsertNote('footnote'); break
      case 'example': handleInsertExample('example'); break
      case 'termDef': handleInsertTermDef('1'); break
    }
  }
}

// === 下划线 ===
function toggleUnderline() {
  editor.value?.chain().focus().toggleUnderline().run()
}

// === 搜索 ===
function handleSearch() {
  if (!editor.value || !searchText.value) return
  const text = searchText.value
  const { doc } = editor.value.state
  let found = false
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.isText && node.text?.includes(text)) {
      const start = pos + node.text.indexOf(text)
      editor.value!.chain().focus().setTextSelection({ from: start, to: start + text.length }).run()
      found = true
      return false
    }
  })
  if (!found) {
    ElMessage.info('未找到匹配内容')
  }
}

// === 查看历史（占位） ===
function handleViewHistory() {
  showVersionPanel.value = !showVersionPanel.value
}

/** 获取编辑器 JSON 内容（用于版本快照） */
function getEditorContent(): Record<string, unknown> {
  return editor.value?.getJSON() || {}
}

/** 获取编辑器 ProseMirror Doc（用于 XML 序列化） */
function getEditorDoc() {
  return editor.value?.state.doc || null
}

/** 设置编辑器内容（用于版本回滚） */
function setEditorContent(content: Record<string, unknown>) {
  editor.value?.commands.setContent(content)
}

// === 导出 ===
function handleExport() {
  exportError.value = ''
  showExport.value = true
}

/** 从文档元数据构建 IR 元数据覆盖项 */
function buildDocMeta(): Partial<IRDocMeta> {
  return irMetaFromDocumentMeta(store.currentDocument?.meta)
}

async function handleExportFormat(format: 'docx' | 'pdf' | 'xml' | 'html' | 'json') {
  if (!editor.value) return
  if (exportingFormat.value !== null) return

  const doc = editor.value.state.doc
  const footnoteError = getFootnoteExportError(doc)
  if (footnoteError) {
    exportError.value = footnoteError
    ElMessage.error(footnoteError)
    return
  }
  const meta = buildDocMeta()
  const docTitle = meta.title || store.currentDocument?.meta?.titleCn || '标准文件'

  if (format === 'docx') {
    exportingFormat.value = format
    exportError.value = ''
    try {
      const { blob, warnings } = await buildDocxBlob({
        pmDoc: doc,
        documentMeta: store.currentDocument?.meta,
        stage: store.currentDocument?.stage,
      })

      downloadBlob(blob, `${docTitle}.docx`)
      const coverIssues = warnings.filter((warning) => warning.code === 'cover-asset-approximation' || warning.code === 'cover-field-missing')
      if (coverIssues.length) {
        const notes = [
          ...(coverIssues.some((warning) => warning.code === 'cover-asset-approximation') ? ['部分封面素材的来源或清晰度有限，请核对后使用。'] : []),
          ...(coverIssues.some((warning) => warning.code === 'cover-field-missing') ? ['部分封面信息未填写，请补齐后核对。'] : []),
        ]
        ElMessage.warning({ message: `DOCX 已导出。${notes.join('')}`, duration: 8000 })
      } else {
        ElMessage.success('DOCX 文件已导出')
      }
      showExport.value = false
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      exportError.value = `DOCX 导出失败：${detail}`
      ElMessage.error(exportError.value)
    } finally {
      exportingFormat.value = null
    }
    return
  }

  if (format === 'pdf') {
    exportingFormat.value = format
    exportError.value = ''
    // IR→HTML→服务端两遍构建（GB/T 1.1 版式，KaTeX 预渲染 + 目次页码注入）
    try {
      const req = buildPdfExportRequest(doc, meta)
      const resp = await fetch('/api/convert/html-to-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText)
        throw new Error(`服务器转换失败 (${resp.status}): ${errText}`)
      }
      const pdfBlob = await resp.blob()
      downloadBlob(pdfBlob, `${docTitle}.pdf`)
      ElMessage.success('PDF 文件已导出')
      showExport.value = false
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      exportError.value = `PDF 导出失败：${detail}`
      ElMessage.error(exportError.value)
    } finally {
      exportingFormat.value = null
    }
    return
  }

  showExport.value = false
  try {
    let content = ''
    let filename = ''
    let mimeType = ''

    switch (format) {
      case 'xml':
        content = serializeToXml(doc)
        filename = `${docTitle}.xml`
        mimeType = 'application/xml'
        break
      case 'html':
        content = exportSemanticHtml(doc)
        filename = `${docTitle}.html`
        mimeType = 'text/html'
        break
      case 'json':
        content = JSON.stringify(exportSemanticJson(doc), null, 2)
        filename = `${docTitle}.json`
        mimeType = 'application/json'
        break
      default:
        return
    }

    downloadFile(content, filename, mimeType)
    ElMessage.success(`${format.toUpperCase()} 文件已导出`)
  } catch (e) {
    ElMessage.error(`导出失败: ${e}`)
  }
}

/** 下载文件辅助函数 */
function downloadFile(content: string, filename: string, mimeType: string) {
  downloadBlob(new Blob([content], { type: `${mimeType};charset=utf-8` }), filename)
}

/** 下载 Blob（PDF/DOCX 等二进制）辅助函数 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 复制代码内容 */
function copyCodeContent() {
  const doc = editor.value?.state.doc
  if (doc) {
    const footnoteError = getFootnoteExportError(doc)
    if (footnoteError) {
      ElMessage.error(footnoteError)
      return
    }
  }
  const content = codeViewContent.value
  navigator.clipboard.writeText(content).then(() => {
    ElMessage.success('已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败')
  })
}

/** 下载代码内容 */
function downloadCodeContent() {
  const formatInfo: Record<string, { ext: string; mime: string }> = {
    xml: { ext: 'xml', mime: 'application/xml' },
    json: { ext: 'json', mime: 'application/json' },
    html: { ext: 'html', mime: 'text/html' },
    raw: { ext: 'json', mime: 'application/json' },
  }
  const info = formatInfo[codeViewFormat.value] || formatInfo.raw
  const doc = editor.value?.state.doc
  if (doc) {
    const footnoteError = getFootnoteExportError(doc)
    if (footnoteError) {
      ElMessage.error(footnoteError)
      return
    }
  }
  const titleCn = doc?.attrs.titleCn || '标准文件'
  downloadFile(codeViewContent.value, `${titleCn}.${info.ext}`, info.mime)
}

function getFootnoteExportError(doc: import('@tiptap/pm/model').Node): string {
  const { doc: irDoc } = pmToIr(doc.toJSON() as PMJsonNode)
  const errors = resolve(irDoc).problems.filter((problem) =>
    problem.severity === 'error'
    && ['dangling-footnote', 'unreferenced-footnote', 'invalid-footnote'].includes(problem.code),
  )
  if (!errors.length) return ''
  const details = [...new Set(errors.map((problem) => problem.message))]
  return `脚注校验未通过，暂不能导出：${details.join('；')}`
}

// === 导入 XML ===
function triggerXmlImport() {
  xmlFileInput.value?.click()
}

function handleXmlFileImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const currentEditor = editor.value
  const currentDocument = store.currentDocument
  if (!file || !currentEditor) return
  if (saving.value || importingXml) {
    input.value = ''
    ElMessage.warning('文档正在保存或导入，请稍后再导入 XML')
    return
  }
  if (!currentDocument?.id) {
    input.value = ''
    ElMessage.error('当前文档不可用，无法导入 XML')
    return
  }
  const currentDocumentId = currentDocument.id

  importingXml = true
  const wasEditable = currentEditor.isEditable
  const wasDirty = dirty.value
  currentEditor.setEditable(false)
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  let persisted = false
  const finishImport = () => {
    if (!currentEditor.isDestroyed) currentEditor.setEditable(wasEditable)
    importingXml = false
    input.value = ''
    if (!persisted && wasDirty && !currentEditor.isDestroyed) scheduleAutoSave()
  }

  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const xmlString = e.target?.result
      if (typeof xmlString !== 'string') throw new Error('无法读取 XML 文件内容')
      const pmJson = parseXmlToEditorJson(xmlString, currentEditor.schema.topNodeType.name)
      // Parse against the live production schema before making any persistent or editor changes.
      const validatedDoc = currentEditor.schema.nodeFromJSON(pmJson)
      validatedDoc.check()
      const validatedJson = validatedDoc.toJSON()
      if (currentEditor.isDestroyed || store.currentDocument?.id !== currentDocumentId) {
        throw new Error('当前文档已切换，请重新导入')
      }
      const update = prepareXmlImportDocumentUpdate(validatedJson, currentDocument.meta)

      saving.value = true
      await store.updateDocument(currentDocumentId, {
        title: update.title,
        meta: update.meta,
        content: validatedJson,
      })
      persisted = true
      currentEditor.commands.setContent(validatedJson, { emitUpdate: false })
      dirty.value = false
      lastSaved.value = new Date().toLocaleTimeString('zh-CN')
      ElMessage.success('XML 文件导入成功')
    } catch (err) {
      ElMessage.error(`XML 导入失败: ${err}`)
    } finally {
      saving.value = false
      finishImport()
    }
  }
  reader.onerror = () => {
    ElMessage.error('XML 文件读取失败')
    finishImport()
  }
  try {
    reader.readAsText(file, 'UTF-8')
  } catch (err) {
    ElMessage.error(`XML 文件读取失败: ${err}`)
    finishImport()
  }
}
</script>

<style scoped>
/* === editor view shell === */
.editor-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--ses-bg);
}

/* === top nav === */
.ed-nav {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 16px;
  height: 48px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  flex-shrink: 0;
}
.nav-l, .nav-r { display: flex; align-items: center; gap: 12px; }
.nav-r { justify-content: flex-end; }
.brand-sep { width: 1px; height: 14px; background: var(--ses-line-2); margin: 0 4px; }

.doc-crumb {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 6px;
  font-size: 12.5px; color: var(--ses-ink-2);
  cursor: pointer;
  max-width: 360px;
}
.doc-crumb:hover { background: var(--ses-surface-2); }
.doc-crumb .std-no { color: var(--ses-ink-3); font-family: var(--ses-font-mono); font-size: 11.5px; }
.doc-crumb .dot-sep { color: var(--ses-ink-4); }
.doc-crumb .crumb-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.doc-crumb .caret { color: var(--ses-ink-4); font-size: 10px; }

.ed-tabs {
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--ses-surface-2);
  border-radius: 8px;
}
.ed-tab {
  padding: 5px 14px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ses-ink-3);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
}
.ed-tab:hover { color: var(--ses-ink); }
.ed-tab.is-active {
  background: var(--ses-surface);
  color: var(--ses-ink);
  font-weight: 600;
  box-shadow: var(--ses-shadow-1);
}

/* === toolbar === */
.ed-toolbar {
  display: grid;
  grid-template-columns: 280px 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  height: 56px;
  flex-shrink: 0;
}

.tbar-outline-head {
  display: flex; align-items: center; justify-content: space-between;
  padding-right: 12px;
  border-right: 1px solid var(--ses-line);
  height: 36px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ses-ink-3);
}
.tbar-outline-head .add-btn {
  width: 22px; height: 22px;
  border-radius: 5px;
  background: var(--ses-surface-3);
  color: var(--ses-ink-2);
  display: inline-flex; align-items: center; justify-content: center;
  border: 0;
  cursor: pointer;
}
.tbar-outline-head .add-btn:hover { background: var(--ses-accent); color: white; }

.tbar-groups {
  display: flex; align-items: center; gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.tbar-groups::-webkit-scrollbar { display: none; }

.tbar-group {
  display: flex; align-items: center; gap: 4px;
  height: 36px;
  padding: 0 6px;
  background: var(--ses-surface-2);
  border-radius: 8px;
  flex-shrink: 0;
}
.tbar-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px;
  padding: 0 9px;
  border-radius: 5px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ses-ink-2);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: all 0.1s ease;
}
.tbar-btn:hover {
  background: var(--ses-surface);
  color: var(--ses-ink);
  box-shadow: var(--ses-shadow-1);
}
.tbar-btn.is-active { background: var(--ses-accent-soft); color: var(--ses-accent); }
.tbar-btn[disabled] { opacity: 0.4; pointer-events: none; }
.tbar-btn.icon-btn { width: 26px; padding: 0; justify-content: center; }

.format-group strong, .format-group em, .format-group u, .format-group s {
  font-family: var(--ses-font-zh-hei);
}

.tbar-search { width: 180px; }
:deep(.tbar-search .el-input__wrapper) {
  border-radius: 6px;
}

/* === body === */
.ed-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.ed-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 0%, oklch(0.92 0.02 285 / 0.25), transparent 600px),
    var(--ses-bg);
}

/* === version sidebar slide === */
.version-sidebar {
  width: 380px;
  min-width: 380px;
  border-left: 1px solid var(--ses-line);
  background: var(--ses-surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.slide-right-enter-active, .slide-right-leave-active { transition: all 0.3s ease; }
.slide-right-enter-from,  .slide-right-leave-to     { transform: translateX(100%); opacity: 0; }

/* === placeholder tabs === */
.tab-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* === code dialog === */
.code-dlg-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.xml-code {
  background: oklch(0.18 0.014 270);
  color: oklch(0.92 0.005 270);
  padding: 16px;
  border-radius: var(--ses-r-md);
  max-height: 500px;
  overflow: auto;
  font-size: 12px;
  font-family: var(--ses-font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
}

/* === help dialog === */
.help-content h4 { margin: 12px 0 8px; font-size: 13px; font-weight: 600; color: var(--ses-ink); }
.help-content ul { padding-left: 20px; }
.help-content li { margin: 6px 0; font-size: 13px; color: var(--ses-ink-2); }
.help-content p { margin: 6px 0; font-size: 13px; color: var(--ses-ink-2); line-height: 1.6; }

/* === export dialog === */
.dlg-field-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ses-ink-2);
  margin-bottom: 10px;
}
.export-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.export-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 16px 12px;
  background: var(--ses-surface);
  border: 1.5px solid var(--ses-line);
  border-radius: var(--ses-r-md);
  cursor: pointer;
  transition: all 0.12s ease;
  font-family: inherit;
}
.export-card:hover {
  border-color: var(--ses-accent);
  background: var(--ses-accent-soft);
  transform: translateY(-2px);
}
.export-card.primary {
  background: var(--ses-accent);
  border-color: var(--ses-accent);
  color: white;
}
.export-card.primary:hover { background: var(--ses-accent-2); }
.export-card[disabled] { opacity: 0.5; cursor: wait; }
.ec-glyph {
  font-family: var(--ses-font-mono);
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 4px;
}
.ec-label {
  min-width: 0;
  max-width: 100%;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.ec-sub {
  font-size: 10.5px;
  color: var(--ses-ink-3);
  text-align: center;
}
.export-card.primary .ec-sub { color: oklch(0.95 0.005 270 / 0.85); }
</style>
