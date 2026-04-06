<template>
  <div class="editor-view" v-loading="loading">
    <!-- 顶部导航栏 -->
    <div class="top-nav">
      <div class="top-nav-left">
        <span class="app-title" @click="goHome">SES标准化文件编辑系统</span>
      </div>
      <div class="top-nav-center">
        <span class="nav-tab" :class="{ active: activeTab === 'edit' }" @click="activeTab = 'edit'">文件编辑</span>
        <span class="nav-tab" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">文件设置</span>
        <span class="nav-tab" :class="{ active: activeTab === 'preview' }" @click="activeTab = 'preview'">预览</span>
      </div>
      <div class="top-nav-right">
        <span class="nav-link" :class="{ active: showVersionPanel }" @click="handleViewHistory">
          {{ showVersionPanel ? '关闭历史' : '版本历史' }}
        </span>
        <span class="nav-link" @click="handleExport">导出</span>
        <span v-if="saving" class="save-hint">保存中...</span>
        <span v-else-if="lastSaved" class="save-hint">已保存 {{ lastSaved }}</span>
      </div>
    </div>

    <!-- 文件编辑 Tab -->
    <template v-if="activeTab === 'edit'">
      <!-- 工具栏 -->
      <div class="toolbar-area">
        <div class="toolbar-row-main">
          <!-- 左侧：文档结构标题 + "+" 按钮 -->
          <div class="toolbar-outline-header">
            <span>文档结构</span>
            <el-dropdown trigger="click" @command="handleAddStructure">
              <el-button :icon="Plus" size="small" circle />
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

          <!-- 右侧工具按钮区 -->
          <div class="toolbar-buttons">
            <!-- 结构要素（带下拉的按钮） -->
            <el-dropdown trigger="click" @command="handleInsertClause" size="small">
              <el-button size="small">条 <el-icon class="el-icon--right"><ArrowDownIcon /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="1">一级条</el-dropdown-item>
                  <el-dropdown-item command="2">二级条</el-dropdown-item>
                  <el-dropdown-item command="3">三级条</el-dropdown-item>
                  <el-dropdown-item command="4">四级条</el-dropdown-item>
                  <el-dropdown-item command="5">五级条</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-dropdown trigger="click" @command="handleInsertClauseNoTitle" size="small">
              <el-button size="small">无题条 <el-icon class="el-icon--right"><ArrowDownIcon /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="1">一级无题条</el-dropdown-item>
                  <el-dropdown-item command="2">二级无题条</el-dropdown-item>
                  <el-dropdown-item command="3">三级无题条</el-dropdown-item>
                  <el-dropdown-item command="4">四级无题条</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-dropdown trigger="click" @command="handleInsertList" size="small">
              <el-button size="small">列项 <el-icon class="el-icon--right"><ArrowDownIcon /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="dash">破折号列项</el-dropdown-item>
                  <el-dropdown-item command="alpha">字母编号列项</el-dropdown-item>
                  <el-dropdown-item command="numeric">数字编号列项</el-dropdown-item>
                  <el-dropdown-item command="roman">罗马数字列项</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-dropdown trigger="click" @command="handleInsertNote" size="small">
              <el-button size="small">注 <el-icon class="el-icon--right"><ArrowDownIcon /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="note">注</el-dropdown-item>
                  <el-dropdown-item command="footnote">脚注</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-button size="small" @click="handleInsertExample('example')">示例</el-button>

            <el-dropdown trigger="click" @command="handleInsertTermDef" size="small">
              <el-button size="small">术语定义 <el-icon class="el-icon--right"><ArrowDownIcon /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="1">一级术语条</el-dropdown-item>
                  <el-dropdown-item command="2">二级术语条</el-dropdown-item>
                  <el-dropdown-item command="3">三级术语条</el-dropdown-item>
                  <el-dropdown-item command="4">四级术语条</el-dropdown-item>
                  <el-dropdown-item command="5">五级术语条</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <el-button size="small" @click="handleInsertFormula()">插入公式</el-button>
            <el-dropdown trigger="click" @command="handleTableCommand" size="small">
              <el-button size="small">表格 <el-icon class="el-icon--right"><ArrowDownIcon /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="insert">插入表格 (3×3)</el-dropdown-item>
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
            <el-button size="small" @click="handleInsertFigure()">插入图片</el-button>
            <el-button size="small" @click="insertStdParagraph()">段落</el-button>

            <div class="toolbar-separator" />

            <!-- 撤销重做 -->
            <el-button-group>
              <el-tooltip content="撤销" placement="bottom">
                <el-button size="small" :icon="RefreshLeft" :disabled="!editor?.can().undo()" @click="editor?.chain().focus().undo().run()" />
              </el-tooltip>
              <el-tooltip content="重做" placement="bottom">
                <el-button size="small" :icon="RefreshRight" :disabled="!editor?.can().redo()" @click="editor?.chain().focus().redo().run()" />
              </el-tooltip>
            </el-button-group>
          </div>
        </div>

        <div class="toolbar-row-sub">
          <!-- 左侧搜索框 -->
          <div class="toolbar-search">
            <el-input
              v-model="searchText"
              size="small"
              placeholder="搜索..."
              :prefix-icon="Search"
              clearable
              @keyup.enter="handleSearch"
              style="width: 160px"
            />
          </div>

          <!-- 文本格式 -->
          <div class="toolbar-format">
            <el-button size="small" :type="editor?.isActive('bold') ? 'primary' : ''" @click="editor?.chain().focus().toggleBold().run()"><strong>B</strong></el-button>
            <el-button size="small" :type="editor?.isActive('italic') ? 'primary' : ''" @click="editor?.chain().focus().toggleItalic().run()"><em>I</em></el-button>
            <el-button size="small" :type="editor?.isActive('underline') ? 'primary' : ''" @click="toggleUnderline()"><u>U</u></el-button>
            <el-button size="small" :type="editor?.isActive('strike') ? 'primary' : ''" @click="editor?.chain().focus().toggleStrike().run()"><s>S</s></el-button>
          </div>

          <div class="toolbar-separator" />

          <!-- 查看代码 / 导入 / 帮助 -->
          <el-button size="small" @click="showXmlCode = true">查看代码</el-button>
          <el-button size="small" @click="triggerXmlImport">导入XML</el-button>
          <el-button size="small" @click="showHelp = true">帮助</el-button>
        </div>
      </div>

      <!-- 编辑器主体 -->
      <div class="editor-body">
        <DocumentOutline :editor="editor" />
        <div class="editor-main">
          <SesEditorContent :editor="editor" />
        </div>
        <!-- 版本历史面板（右侧抽屉） -->
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

      <!-- Slash Command 菜单 -->
      <SlashMenu @execute="handleSlashCommand" />
    </template>

    <!-- 文件设置 Tab (占位) -->
    <div v-else-if="activeTab === 'settings'" class="tab-placeholder">
      <el-empty description="文件设置（开发中）" />
    </div>

    <!-- 预览 Tab (占位) -->
    <div v-else-if="activeTab === 'preview'" class="tab-placeholder">
      <el-empty description="GB/T 1.1 文档预览（开发中）" />
    </div>

    <!-- 查看代码对话框（支持多种格式） -->
    <el-dialog v-model="showXmlCode" title="查看文档代码" width="75%">
      <div class="code-dialog-header">
        <el-radio-group v-model="codeViewFormat" size="small">
          <el-radio-button value="xml">XML (GB/T 37967)</el-radio-button>
          <el-radio-button value="json">语义 JSON</el-radio-button>
          <el-radio-button value="html">语义 HTML</el-radio-button>
          <el-radio-button value="raw">原始 JSON</el-radio-button>
        </el-radio-group>
        <el-button size="small" @click="copyCodeContent">复制</el-button>
        <el-button size="small" @click="downloadCodeContent">下载</el-button>
      </div>
      <pre class="xml-code">{{ codeViewContent }}</pre>
    </el-dialog>

    <!-- 导入 XML 文件 -->
    <input ref="xmlFileInput" type="file" accept=".xml" style="display: none" @change="handleXmlFileImport" />

    <!-- 帮助对话框 -->
    <el-dialog v-model="showHelp" title="帮助" width="520px">
      <div class="help-content">
        <h4>快捷键</h4>
        <ul>
          <li><kbd>Ctrl+B</kbd> 加粗</li>
          <li><kbd>Ctrl+I</kbd> 斜体</li>
          <li><kbd>Ctrl+Z</kbd> 撤销</li>
          <li><kbd>Ctrl+Shift+Z</kbd> 重做</li>
          <li><kbd>Ctrl+S</kbd> 保存</li>
        </ul>
        <h4>文档结构</h4>
        <p>使用左上角"+"按钮添加章节结构（前言、引言、章、附录、参考文献）。</p>
        <p>使用工具栏按钮插入条、列项、注、示例、公式、表格、图片等内容要素。</p>
      </div>
    </el-dialog>

    <!-- 导出对话框 -->
    <el-dialog v-model="showExport" title="导出文档" width="480px">
      <p>选择导出格式：</p>
      <div style="display: flex; gap: 12px; justify-content: center; margin: 24px 0; flex-wrap: wrap">
        <el-button size="large" @click="handleExportFormat('xml')">导出 XML</el-button>
        <el-button size="large" @click="handleExportFormat('html')">导出 HTML</el-button>
        <el-button size="large" @click="handleExportFormat('json')">导出 JSON</el-button>
        <el-button size="large" @click="handleExportFormat('pdf')" disabled>导出 PDF（开发中）</el-button>
        <el-button size="large" @click="handleExportFormat('docx')" disabled>导出 DOCX（开发中）</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { TextSelection } from '@tiptap/pm/state'
import { useRoute, useRouter } from 'vue-router'
import { useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
// Underline is included in StarterKit (tiptap v3)
import { Plus, Search, RefreshLeft, RefreshRight, ArrowDown as ArrowDownIcon } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useDocumentStore } from '@/stores/document'
import SesEditorContent from '@/components/editor/EditorContent.vue'
import DocumentOutline from '@/components/editor/DocumentOutline.vue'
import SlashMenu from '@/components/editor/SlashMenu.vue'
import VersionPanel from '@/components/version/VersionPanel.vue'

import {
  Chapter, ChapterTitle,
  Clause, ClauseTitle,
  StdParagraph,
  TermDef, TermName, TermNameEn, TermDefinition,
  StdTable, TableCaption, TableCaptionEn, TableFootnote,
  Figure, FigureImage, FigureCaption, FigureCaptionEn,
  Formula, FormulaContent, FormulaDescription,
  Note, Example,
  Foreword, Introduction,
  Appendix, AppendixLabel, AppendixTitle,
  Bibliography, BibliographyTitle, BibEntry,
  StdList, StdListItem,
  SlashCommand,
} from '@/extensions'
import { CrossRef } from '@/extensions'
import { serializeToXml, parseXmlToJson, exportSemanticJson, exportSemanticHtml } from '@/serializer'

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

/** 默认文档结构：前言 + 1范围 + 2规范性引用文件 + 3术语和定义 */
const defaultDocContent = {
  type: 'doc',
  content: [
    {
      type: 'foreword',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '本文件按照GB/T 1.1-2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草。' }] },
      ],
    },
    {
      type: 'chapter',
      attrs: { number: '1' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '范围' }] },
        { type: 'stdParagraph' },
      ],
    },
    {
      type: 'chapter',
      attrs: { number: '2' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '规范性引用文件' }] },
        { type: 'stdParagraph' },
      ],
    },
    {
      type: 'chapter',
      attrs: { number: '3' },
      content: [
        { type: 'chapterTitle', content: [{ type: 'text', text: '术语和定义' }] },
        { type: 'stdParagraph' },
      ],
    },
  ],
}

const editor = useEditor({
  extensions: [
    StarterKit.configure({ heading: false }),
    Table.configure({ resizable: true }),
    TableRow, TableCell, TableHeader,
    Image,
    Placeholder.configure({ placeholder: '开始编写标准内容...' }),
    // 自定义节点
    Chapter, ChapterTitle,
    Clause, ClauseTitle,
    StdParagraph,
    TermDef, TermName, TermNameEn, TermDefinition,
    StdTable, TableCaption, TableCaptionEn, TableFootnote,
    Figure, FigureImage, FigureCaption, FigureCaptionEn,
    Formula, FormulaContent, FormulaDescription,
    Note, Example,
    Foreword, Introduction,
    Appendix, AppendixLabel, AppendixTitle,
    Bibliography, BibliographyTitle, BibEntry,
    StdList, StdListItem,
    CrossRef,
    SlashCommand,
  ],
  content: '',
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
  const id = Number(route.params.id)
  try {
    await store.fetchDocument(id)
    if (store.currentDocument?.content && Object.keys(store.currentDocument.content).length > 0) {
      editor.value?.commands.setContent(store.currentDocument.content)
    } else {
      // 新文档加载默认结构
      editor.value?.commands.setContent(defaultDocContent)
    }
  } catch {
    ElMessage.error('文档加载失败')
    router.push('/')
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

async function handleSave() {
  if (!editor.value || !store.currentDocument) return
  saving.value = true
  try {
    const content = editor.value.getJSON()
    await store.updateDocument(store.currentDocument.id!, { content })
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
        }).setTextSelection(insertAt + 2).run()
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

// isInsideChapterOrClause removed (unused)

/**
 * 找到当前光标所在的章或条的末尾位置，用于在其内部追加子条
 */
function findInsertPosInChapterOrClause(): number | null {
  if (!editor.value) return null
  const { $from } = editor.value.state.selection
  // 从当前深度向上查找最近的 chapter、clause 或 appendix
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'chapter' || node.type.name === 'clause' || node.type.name === 'appendix' || node.type.name === 'termDef') {
      // 返回该节点内容的末尾位置（在节点关闭标签之前）
      const endPos = $from.end(d)
      return endPos
    }
  }
  return null
}

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
  const range = getInsertRange()
  if (range === null) {
    ElMessage.warning('请先将光标置于章节内部再插入条')
    return
  }
  const lv = Number(level)
  const { tr } = editor.value!.state
  const schema = editor.value!.state.schema
  const clauseNode = schema.nodes.clause.create(
    { level: lv, hasTitle: true },
    [schema.nodes.clauseTitle.create({ level: lv }, [])],
  )
  tr.replaceWith(range.from, range.to, clauseNode)
  // 光标放到 clauseTitle 内部: from + clause(+1) + clauseTitle(+1)
  tr.setSelection(TextSelection.create(tr.doc, range.from + 2))
  editor.value!.view.dispatch(tr)
  editor.value!.view.focus()
}

function handleInsertClauseNoTitle(level: string) {
  const range = getInsertRange()
  if (range === null) {
    ElMessage.warning('请先将光标置于章节内部再插入无题条')
    return
  }
  const lv = Number(level)
  const { tr } = editor.value!.state
  const schema = editor.value!.state.schema
  const clauseNode = schema.nodes.clause.create(
    { level: lv, hasTitle: false },
    [schema.nodes.clauseTitle.create({ level: lv }, [])],
  )
  tr.replaceWith(range.from, range.to, clauseNode)
  // 光标放到 clauseTitle 内部
  tr.setSelection(TextSelection.create(tr.doc, range.from + 2))
  editor.value!.view.dispatch(tr)
  editor.value!.view.focus()
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
  }
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

/**
 * 尝试将当前所在的块节点替换为目标类型，若无法替换则返回 false
 * 可替换的块：clause, note, example, stdParagraph
 */
function replaceCurrentBlock(targetType: string, targetContent?: object): boolean {
  if (!editor.value) return false
  const { $from } = editor.value.state.selection
  const replaceableTypes = ['clause', 'note', 'example', 'stdParagraph']
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (!replaceableTypes.includes(node.type.name)) continue
    // 已经是目标类型，无需替换
    if (node.type.name === targetType) return false
    const nodeStart = $from.before(d)
    const schema = editor.value.state.schema
    const targetNodeType = schema.nodes[targetType]
    if (!targetNodeType) return false
    // 提取纯文本内容
    const text = node.textContent
    let newNode
    try {
      newNode = targetNodeType.create(
        targetContent || null,
        text ? [schema.text(text)] : [],
      )
    } catch {
      return false
    }
    const { tr } = editor.value.state
    tr.replaceWith(nodeStart, nodeStart + node.nodeSize, newNode)
    // 将光标移入新节点内容区
    tr.setSelection(TextSelection.near(tr.doc.resolve(nodeStart + 1)))
    editor.value.view.dispatch(tr)
    return true
  }
  return false
}

// === 段落 ===
function insertStdParagraph() {
  // 如果当前块是可替换类型，则替换；否则插入新段落
  if (replaceCurrentBlock('stdParagraph')) return
  const pos = getInsertAfterCurrentBlock()
  if (pos === null) return
  editor.value!.chain().focus().insertContentAt(pos, { type: 'stdParagraph' }).run()
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
  showExport.value = true
}

function handleExportFormat(format: string) {
  if (!editor.value) return
  showExport.value = false

  const doc = editor.value.state.doc
  const titleCn = doc.attrs.titleCn || '标准文件'

  try {
    let content = ''
    let filename = ''
    let mimeType = ''

    switch (format) {
      case 'xml':
        content = serializeToXml(doc)
        filename = `${titleCn}.xml`
        mimeType = 'application/xml'
        break
      case 'html':
        content = exportSemanticHtml(doc)
        filename = `${titleCn}.html`
        mimeType = 'text/html'
        break
      case 'json':
        content = JSON.stringify(exportSemanticJson(doc), null, 2)
        filename = `${titleCn}.json`
        mimeType = 'application/json'
        break
      default:
        ElMessage.info(`${format.toUpperCase()} 导出功能开发中`)
        return
    }

    // 下载文件
    downloadFile(content, filename, mimeType)
    ElMessage.success(`${format.toUpperCase()} 文件已导出`)
  } catch (e) {
    ElMessage.error(`导出失败: ${e}`)
  }
}

/** 下载文件辅助函数 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
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
  const titleCn = doc?.attrs.titleCn || '标准文件'
  downloadFile(codeViewContent.value, `${titleCn}.${info.ext}`, info.mime)
}

// === 导入 XML ===
function triggerXmlImport() {
  xmlFileInput.value?.click()
}

function handleXmlFileImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !editor.value) return

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const xmlString = e.target?.result as string
      const pmJson = parseXmlToJson(xmlString)
      editor.value!.commands.setContent(pmJson)
      ElMessage.success('XML 文件导入成功')
    } catch (err) {
      ElMessage.error(`XML 导入失败: ${err}`)
    }
    // 清空 input 以便再次选择同一文件
    input.value = ''
  }
  reader.readAsText(file, 'UTF-8')
}
</script>

<style scoped>
.editor-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

/* === 顶部导航 === */
.top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 48px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

.app-title {
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.app-title:hover {
  color: var(--el-color-primary);
}

.top-nav-center {
  display: flex;
  gap: 4px;
}

.nav-tab {
  padding: 8px 20px;
  cursor: pointer;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  user-select: none;
}

.nav-tab:hover {
  color: var(--el-color-primary);
}

.nav-tab.active {
  color: var(--el-color-primary);
  border-bottom-color: var(--el-color-primary);
  font-weight: 600;
}

.top-nav-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.nav-link {
  cursor: pointer;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.nav-link:hover,
.nav-link.active {
  color: var(--el-color-primary);
}

.save-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* === 工具栏 === */
.toolbar-area {
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}

.toolbar-row-main {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  gap: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.toolbar-outline-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 180px;
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 600;
  padding-right: 12px;
  border-right: 1px solid var(--el-border-color-lighter);
}

.toolbar-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}

.toolbar-row-sub {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  gap: 8px;
}

.toolbar-search {
  width: 180px;
  flex-shrink: 0;
  padding-right: 12px;
  border-right: 1px solid var(--el-border-color-lighter);
}

.toolbar-format {
  display: flex;
  gap: 4px;
}

.toolbar-separator {
  width: 1px;
  height: 24px;
  background: var(--el-border-color-lighter);
  margin: 0 4px;
}

/* === 编辑器主体 === */
.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* === 版本历史侧边栏 === */
.version-sidebar {
  width: 380px;
  min-width: 380px;
  border-left: 1px solid var(--el-border-color);
  background: #fff;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* === 占位 Tab === */
.tab-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* === 代码查看对话框 === */
.code-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.xml-code {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 16px;
  border-radius: 6px;
  max-height: 500px;
  overflow: auto;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
}

/* === 帮助 === */
.help-content h4 {
  margin: 12px 0 8px;
}

.help-content ul {
  padding-left: 20px;
}

.help-content li {
  margin: 4px 0;
}

.help-content kbd {
  background: #eee;
  border: 1px solid #ccc;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 12px;
}

.help-content p {
  margin: 6px 0;
  font-size: 14px;
}
</style>
