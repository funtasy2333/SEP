<template>
  <div class="editor-view" v-loading="loading">
    <!-- =====================  TOP NAV：文档级操作  ===================== -->
    <header class="ed-nav">
      <div class="nav-l">
        <a class="ses-brand" @click.prevent="goHome" href="#" title="返回标准库">
          <SesLogo />
          <span class="ses-brand-label">标准编辑器</span>
        </a>
        <div class="brand-sep" />
        <div
          class="doc-crumb"
          role="button"
          tabindex="0"
          :title="`${store.currentDocument?.meta?.titleCn || store.currentDocument?.title || ''}（点击编辑文件信息）`"
          @click="activeTab = 'settings'"
          @keydown.enter.prevent="activeTab = 'settings'"
        >
          <span class="std-no">{{ store.currentDocument?.meta?.standardNo || '— · 待编号' }}</span>
          <span class="crumb-title">{{ store.currentDocument?.meta?.titleCn || store.currentDocument?.title || '加载中…' }}</span>
        </div>
      </div>

      <nav class="ed-tabs" aria-label="编辑器视图">
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'edit' }" @click="activeTab = 'edit'">
          文件编辑<span v-if="dirty" class="tab-dirty-mark" aria-label="正文有未保存修改" />
        </button>
        <button class="ed-tab" :class="{ 'is-active': activeTab === 'settings' }" @click="activeTab = 'settings'">
          文件设置<span v-if="settingsDirty" class="tab-dirty-mark settings-mark" aria-label="设置有未保存修改" />
        </button>
      </nav>

      <div class="nav-r">
        <span class="ses-save-pill" :class="{ 'is-saving': saving, 'is-conflict': saveConflict, 'is-dirty': !saving && !saveConflict && (dirty || settingsDirty) }">
          <span class="dot" />
          <template v-if="persistenceOperation === 'settings-save'">设置保存中…</template>
          <template v-else-if="persistenceOperation === 'xml-import'">导入中…</template>
          <template v-else-if="saving">保存中…</template>
          <template v-else-if="saveConflict">存在冲突 · 未保存</template>
          <template v-else-if="settingsDirty">设置待保存</template>
          <template v-else-if="dirty">正文待保存</template>
          <template v-else-if="lastSaved">已保存 {{ lastSaved }}</template>
          <template v-else-if="documentLoaded">已保存</template>
          <template v-else>未保存</template>
        </span>

        <div class="nav-actions" role="toolbar" aria-label="文档操作">
          <button
            class="nav-btn"
            type="button"
            title="查看文档源码（XML / JSON / HTML）"
            @click="showXmlCode = true"
          ><span class="nav-glyph" aria-hidden="true">&lt;/&gt;</span><span class="nav-btn-label">源码</span></button>
          <button
            class="nav-btn"
            type="button"
            title="从 XML 文件导入，替换当前正文"
            :disabled="documentUnavailable"
            @click="triggerXmlImport"
          ><el-icon><Upload /></el-icon><span class="nav-btn-label">导入 XML</span></button>
          <button
            class="nav-btn"
            type="button"
            :class="{ 'is-active': showVersionPanel }"
            :aria-pressed="showVersionPanel"
            title="版本历史"
            @click="handleViewHistory"
          ><el-icon><Clock /></el-icon><span class="nav-btn-label">版本历史</span></button>
          <div class="nav-split" :class="{ 'is-active': showValidationPanel }">
            <button
              class="nav-btn"
              type="button"
              title="打开或关闭质量检查结果"
              :aria-label="showValidationPanel ? '关闭质量检查' : '打开质量检查'"
              :aria-expanded="showValidationPanel"
              @click="toggleValidationPanel"
            ><el-icon><CircleCheck /></el-icon><span class="nav-btn-label">质量检查</span></button>
            <button
              class="nav-btn nav-validation-run"
              data-testid="editor-validation-run"
              type="button"
              :disabled="!validationCanRun"
              :aria-label="validationRunLabel"
              @click="handleManualValidation"
            >{{ validationRunLabel }}</button>
          </div>
          <button class="nav-btn" type="button" title="快捷键与帮助" aria-label="帮助" @click="showHelp = true">
            <el-icon><QuestionFilled /></el-icon>
          </button>
        </div>

        <el-button type="primary" aria-label="导出" @click="handleExport">
          <el-icon><Download /></el-icon>
          <span>导出</span>
        </el-button>
      </div>
    </header>

    <!-- 保存冲突：关闭对话框后仍保留，避免误以为已保存 -->
    <div v-if="saveConflict" class="conflict-banner" role="alert" aria-label="保存冲突提示">
      <el-icon class="conflict-banner-icon"><WarningFilled /></el-icon>
      <span class="conflict-banner-text">{{ externalConflictBanner(saveConflict.cause) }}</span>
      <el-button size="small" type="danger" plain @click="conflictDialogVisible = true">处理冲突</el-button>
    </div>

    <div v-if="documentUnavailable" class="unavailable-banner" role="alert" aria-label="文档已不可用">
      <el-icon class="conflict-banner-icon"><WarningFilled /></el-icon>
      <span class="conflict-banner-text">{{ unavailableMessage }} 本页未保存内容仍保留；返回标准库并重新打开后才能继续编辑。</span>
      <el-button size="small" type="danger" plain @click="goHome">返回标准库</el-button>
    </div>

    <!-- =====================  EDIT TAB  ===================== -->
    <template v-if="activeTab === 'edit'">
      <!-- 工具栏：只放正文编辑操作，按「历史 / 文字 / 设为 / 插入 / 对象」排列；放不下时换行，不再隐藏按钮 -->
      <div class="ed-toolbar" role="toolbar" aria-label="正文编辑" :inert="documentUnavailable">
        <div class="tbar-group">
          <button
            class="tbar-btn icon-btn"
            :class="{ 'is-active': showOutline }"
            :aria-pressed="showOutline"
            :title="showOutline ? '隐藏文档结构' : '显示文档结构'"
            :aria-label="showOutline ? '隐藏文档结构' : '显示文档结构'"
            @click="showOutline = !showOutline"
          ><el-icon><Memo /></el-icon></button>
        </div>
        <span class="tbar-sep" />

        <div class="tbar-group">
          <button class="tbar-btn icon-btn" :disabled="!editor?.can().undo()" @click="editor?.chain().focus().undo().run()" title="撤销（Ctrl+Z）" aria-label="撤销">
            <el-icon><RefreshLeft /></el-icon>
          </button>
          <button class="tbar-btn icon-btn" :disabled="!editor?.can().redo()" @click="editor?.chain().focus().redo().run()" title="重做（Ctrl+Shift+Z）" aria-label="重做">
            <el-icon><RefreshRight /></el-icon>
          </button>
        </div>
        <span class="tbar-sep" />

        <div class="tbar-group format-group">
          <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('bold') }" title="加粗（Ctrl+B）" aria-label="加粗" @click="editor?.chain().focus().toggleBold().run()"><strong>B</strong></button>
          <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('italic') }" title="斜体（Ctrl+I）" aria-label="斜体" @click="editor?.chain().focus().toggleItalic().run()"><em>I</em></button>
          <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('underline') }" title="下划线（Ctrl+U）" aria-label="下划线" @click="toggleUnderline()"><u>U</u></button>
          <button class="tbar-btn icon-btn" :class="{ 'is-active': editor?.isActive('strike') }" title="删除线" aria-label="删除线" @click="editor?.chain().focus().toggleStrike().run()"><s>S</s></button>
        </div>
        <span class="tbar-sep" />

        <!-- 设为：改变光标所在段落的结构角色 -->
        <div class="tbar-group" aria-label="将当前段落设为">
          <span class="tbar-label">设为</span>
          <button class="tbar-btn" title="将当前段落恢复为正文段落" @click="insertStdParagraph()">正文</button>
          <el-dropdown trigger="click" @command="handleInsertClause">
            <button class="tbar-btn" title="将当前段落或条标题设为所选层级的条">条 <el-icon><ArrowDownIcon /></el-icon></button>
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
            <button class="tbar-btn" title="将当前段落设为列项">列项 <el-icon><ArrowDownIcon /></el-icon></button>
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
        <span class="tbar-sep" />

        <!-- 插入：在光标处加入内容要素 -->
        <div class="tbar-group" aria-label="插入内容要素">
          <span class="tbar-label">插入</span>
          <ReferenceControl :editor="editor" />
          <SourceControl :editor="editor" />
          <el-dropdown trigger="click" @command="handleInsertNote">
            <button class="tbar-btn" title="设置注或插入脚注">注 <el-icon><ArrowDownIcon /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="note">注</el-dropdown-item>
                <el-dropdown-item command="footnote">脚注（Ctrl+Shift+F）</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button class="tbar-btn" title="在当前段落后插入示例" @click="handleInsertExample('example')">示例</button>
          <el-dropdown trigger="click" @command="handleInsertTermDef">
            <button class="tbar-btn" title="插入术语条目">术语 <el-icon><ArrowDownIcon /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="lv in 5" :key="lv" :command="String(lv)">{{ ['一','二','三','四','五'][lv-1] }}级术语条</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button class="tbar-btn" title="在当前段落后插入公式" @click="handleInsertFormula()">公式</button>
          <button
            class="tbar-btn"
            :disabled="!cursorAllowsInlineFormula"
            title="插入行内公式；选中带上下标的文字时转为公式（Ctrl/Cmd+Shift+M）"
            @click="handleInlineFormula()"
          >行内公式</button>
          <TableMenu
            :in-table="editor?.isActive('stdTable') || editor?.isActive('table') || false"
            :in-cell="editor?.isActive('tableCell') || editor?.isActive('tableHeader') || false"
            @open="rememberTableSelection"
            @command="handleTableCommand"
          />
          <button class="tbar-btn" title="在当前段落后插入图" @click="handleInsertFigure()">图片</button>
        </div>

        <!-- 上下文工具：只在光标位于公式、图或表时出现 -->
        <template v-if="cursorInFormula">
          <span class="tbar-sep" />
          <div class="tbar-group tbar-context" aria-label="公式">
            <span class="tbar-label">公式</span>
            <button class="tbar-btn" title="为光标所在公式添加一条式中符号说明" @click="handleAddWhereItem()">添加式中</button>
          </div>
        </template>
        <template v-if="activeOrientationNodeType()">
          <span class="tbar-sep" />
          <div class="tbar-group tbar-context" aria-label="图表版面方向">
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
        </template>

        <div class="tbar-search">
          <el-input
            v-model="searchText"
            size="small"
            placeholder="查找正文，回车定位"
            :prefix-icon="Search"
            clearable
            @keyup.enter="handleSearch"
          />
        </div>
      </div>

      <!-- Editor body: outline + canvas + one optional sidebar -->
      <div class="ed-body ses-scroll">
        <transition name="slide-left">
          <div v-show="showOutline" class="outline-host" :inert="documentUnavailable">
            <DocumentOutline :editor="editor">
              <template #actions>
                <el-dropdown trigger="click" @command="handleAddStructure">
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
        <div class="ed-main">
          <SesEditorContent :editor="editor" />
        </div>
        <transition name="slide-right">
          <div class="version-sidebar" data-testid="version-sidebar" v-if="showVersionPanel">
            <VersionPanel
              :document-id="documentId"
              :get-content="getEditorContent"
              :get-doc="getEditorDoc"
              :set-content="setEditorContent"
              :read-only="documentUnavailable"
              @close="showVersionPanel = false"
              @conflict="enterSaveConflict('version-save')"
            />
          </div>
        </transition>
        <transition name="slide-right">
          <div class="version-sidebar validation-sidebar" v-if="showValidationPanel">
            <ValidationPanel
              :state="validation.state.value"
              :report="validation.report.value"
              :conversion="validation.conversion.value"
              :anchors="validation.anchors.value"
              :error="validation.error.value"
              :can-run="validationCanRun"
              @run="handleManualValidation"
              @locate="validation.locate"
              @close="showValidationPanel = false"
            />
          </div>
        </transition>
      </div>

      <!-- Slash command (mounted globally) -->
      <SlashMenu v-if="!documentUnavailable" @execute="handleSlashCommand" />
    </template>

    <!-- Keep the independent settings draft mounted while switching tabs. -->
    <div v-show="activeTab === 'settings'" class="settings-host" :inert="documentUnavailable">
      <DocumentSettingsPanel
        v-if="settingsDraft"
        :draft="settingsDraft"
        :dirty="settingsDirty"
        :saving="persistenceOperation !== null"
        :save-error="settingsSaveError"
        @save="handleSettingsSave"
        @reset="resetSettingsDraft"
      />
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
          <el-button size="small" :disabled="Boolean(codeViewError)" @click="copyCodeContent">复制</el-button>
          <el-button size="small" :disabled="Boolean(codeViewError)" @click="downloadCodeContent">下载</el-button>
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
          <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> 行内公式</li>
          <li><kbd>/</kbd> 智能插入菜单</li>
        </ul>
        <h4>文档结构</h4>
        <p>界面分三层：顶栏是整份文件的操作（源码、导入、版本历史、质量检查、导出）；工具栏只处理正文，「设为」改变当前段落的角色，「插入」加入新的内容要素；光标位于公式、图或表时，工具栏右侧会出现对应的上下文工具（添加式中、纵向/横向版面）。</p>
        <p>使用左侧「文档结构」面板的「添加」按钮添加章节结构（前言、引言、章、附录、参考文献）；工具栏最左侧的按钮可隐藏或显示该面板。点击正文段落或选中其中的文字后，使用“条”“无题条”设置整段格式；新条之后的正文归入该条，直到下一个同级条。一级条置于章或附录内，其他级别置于上一级条内。含子条时保留原层级，可切换有题/无题；先调整子条结构再改层级或段落。需要新条时，先回车建立空段再设置格式。</p>
        <p>术语中英文名称同列显示：Tab 从中文名进入英文名，Enter 进入定义；在定义中 Enter 新建续段，末尾空续段再次 Enter 退出术语。使用工具栏「设为」设置列项，「插入」加入注、示例、术语、公式、表格、图片等内容要素。选中图或表后，可切换纵向或横向版面。</p>
        <p>行内公式：在正文、列项、注、示例、表格单元格、术语定义中按 Ctrl/Cmd+Shift+M（或工具栏「行内公式」）插入；先选中 q<sub>V</sub> 这类带上下标的文字再按，可把它转为公式。点击公式可重新编辑。</p>
      </div>
    </el-dialog>

    <!-- =====================  EXPORT DIALOG  ===================== -->
    <el-dialog v-model="showExport" title="导出文档" width="560px">
      <p style="margin: 0 0 16px; color: var(--ses-ink-3); font-size: 13px">选择导出格式：</p>
      <el-alert
        v-if="exportError"
        class="export-error"
        type="error"
        :closable="false"
        show-icon
      >
        <template #title>
          <span class="export-error-text">{{ exportError }}</span>
          <ol v-if="exportErrorItems.length" class="export-error-items" aria-label="阻止导出的内容明细">
            <li v-for="(item, index) in exportErrorItems" :key="index">{{ item }}</li>
          </ol>
        </template>
      </el-alert>
      <p style="margin: 0 0 12px; color: var(--ses-ink-3); font-size: 12px">
        DOCX 目次：增删章条后需重新导出以更新目次条目；页码由 Word 更新。续表与长脚注分页请用 Word 校对；横排页条文脚注分隔线的长度仍待完善。
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
        <button class="export-card" :disabled="exportingFormat !== null" @click="handleExportFormat('ses')">
          <span class="ec-glyph">SES</span>
          <span class="ec-label">SES 文档包</span>
          <span class="ec-sub">{{ exportingFormat === 'ses' ? '正在打包…' : '携带正文、文件设置与全部版本' }}</span>
        </button>
      </div>
    </el-dialog>

    <!-- =====================  SAVE CONFLICT DIALOG  ===================== -->
    <el-dialog
      v-model="conflictDialogVisible"
      :title="externalConflictTitle(saveConflict?.cause)"
      width="520px"
      class="ses-conflict-dlg"
      append-to-body
      :close-on-click-modal="false"
    >
      <p class="conflict-lead">当前内容未保存。在处理之前，自动保存与手动保存都已暂停，编辑器中的内容仍然保留。</p>
      <p v-if="conflictDetail" class="conflict-detail">{{ conflictDetail }}</p>
      <ul class="conflict-options">
        <li><strong>重新加载</strong>：放弃本页尚未保存的修改，载入服务端的最新内容后继续编辑。</li>
        <li><strong>另存为副本</strong>：把本页当前内容保存为一份新文档，原文档保持服务端现有内容不变。</li>
      </ul>
      <template #footer>
        <el-button :disabled="resolvingConflict !== null" @click="conflictDialogVisible = false">稍后处理</el-button>
        <el-button
          :loading="resolvingConflict === 'copy'"
          :disabled="resolvingConflict === 'reload'"
          @click="handleConflictSaveAsCopy"
        >另存为副本</el-button>
        <el-button
          type="danger"
          :loading="resolvingConflict === 'reload'"
          :disabled="resolvingConflict === 'copy'"
          @click="handleConflictReload"
        >重新加载</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showFootnoteDialog"
      :title="footnoteDialogTitle"
      width="560px"
      destroy-on-close
      @closed="clearFootnoteDialog"
    >
      <div :inert="documentUnavailable">
      <template v-if="footnoteDialogMode === 'table-reference'">
        <el-form label-width="92px">
          <el-form-item label="表脚注">
          <el-select v-model="selectedTableFootnoteId" :disabled="documentUnavailable" placeholder="选择本表已有脚注" style="width: 100%">
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
          :disabled="documentUnavailable"
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
          :disabled="documentUnavailable"
          @click="deleteTableFootnoteDefinition"
        >删除表脚注定义</el-button>
        <el-button
          v-if="footnoteDialogMode === 'body-edit'"
          type="danger"
          plain
          :disabled="documentUnavailable"
          @click="deleteBodyFootnote"
        >删除脚注</el-button>
        <el-button type="primary" :disabled="documentUnavailable" @click="saveFootnoteDialog">确定</el-button>
      </template>
    </el-dialog>

    <WhereConversionDialog
      v-model="showWhereConversion"
      :rows="whereConversion?.rows ?? []"
      @confirm="applyWhereConversion"
    />

    <MathInputDialog
      v-model="showMathDialog"
      :initial-latex="mathDialogLatex"
      :title="mathDialogTitle"
      @confirm="handleMathConfirm"
    />
  </div>
</template>


<script setup lang="ts">
import { getDocxExportFeedback } from '@/utils/docxExportFeedback'
import { exportErrorViewOf, exportErrorViewOfText, type ExportErrorView } from '@/utils/exportErrorView'
import { createDefaultDocumentContent, createDefaultForeword } from '@/utils/newDocument'
import {
  COVER_SETTINGS_KEYS,
  documentMetaFromSettingsDraft,
  documentSettingsDraftFromDocument,
  synchronizeCoverMetadata,
  type DocumentSettingsDraft,
} from '@/utils/documentSettings'
import { setClauseFormat, setListFormat, setParagraphFormat, structureFailureMessage, type StructureAction, type StructureResult } from '@/utils/structureEditing'
import { countLegacyUntitledClauses } from '@/utils/untitledClause'
import { createDocumentDuplicate } from '@/utils/duplicateDocument'
import { isRevisionConflict } from '@/utils/documentConflict'
import { startDocumentChangeSync, type DocumentChangeSync, type ExternalChange } from '@/utils/documentChangeSync'
import {
  externalCauseOf,
  externalConflictBanner,
  externalConflictCauseSentence,
  externalConflictTitle,
  externalUpdateNotice,
  type ExternalCause,
} from '@/utils/externalChange'
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { NodeSelection, TextSelection, type SelectionBookmark } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
// Underline is included in StarterKit (tiptap v3)
import { Plus, Search, RefreshLeft, RefreshRight, ArrowDown as ArrowDownIcon, Clock, Download, WarningFilled, Upload, CircleCheck, QuestionFilled, Memo, DArrowLeft } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { documentApi, type DocumentData } from '@/api/document'
import { useDocumentStore } from '@/stores/document'
import { useVersionStore } from '@/stores/version'
import SesEditorContent from '@/components/editor/EditorContent.vue'
import TableMenu from '@/components/editor/TableMenu.vue'
import ReferenceControl from '@/components/editor/ReferenceControl.vue'
import SourceControl from '@/components/editor/SourceControl.vue'
import SesLogo from '@/components/SesLogo.vue'
import DocumentOutline from '@/components/editor/DocumentOutline.vue'
import DocumentSettingsPanel from '@/components/editor/DocumentSettingsPanel.vue'
import SlashMenu from '@/components/editor/SlashMenu.vue'
import MathInputDialog from '@/components/editor/MathInputDialog.vue'
import WhereConversionDialog from '@/components/editor/WhereConversionDialog.vue'
import { convertLegacyWhereDescription, type WhereConversionRow } from '@/utils/whereListConversion'
import VersionPanel from '@/components/version/VersionPanel.vue'
import ValidationPanel from '@/components/editor/ValidationPanel.vue'

import { useEditor } from '@tiptap/vue-3'
import { installRemoteDocument, replaceEditorDocument } from '@/utils/editorDocument'
import { createEditorExtensions } from '@/extensions/editorExtensions'
import { createDocumentValidationExtension } from '@/extensions/plugins/documentValidation'
import { useDocumentValidation } from '@/composables/useDocumentValidation'
import { hasNodeIdIssues, normalizeNodeIds } from '@/extensions/plugins/ensureNodeId'
import { canInsertBodyFootnote } from '@/extensions/nodes/footnotes'
import {
  formulaHasLegacyDescription, selectedFormula,
} from '@/extensions/plugins/whereListEditing'
import {
  canInsertInlineFormula, INLINE_FORMULA_EVENT, sameInlineLocation, type InlineFormulaRequest,
} from '@/extensions/plugins/inlineFormulaEditing'
import { getTableFootnoteEntries } from '@/extensions/nodes/std-table'
import {
  serializeToXml, parseXmlToEditorJson,
  prepareXmlImportDocumentUpdate,
  exportSemanticJson, exportSemanticHtml,
  buildPdfExportRequest, buildDocxBlob,
} from '@/serializer'
import { irMetaFromDocumentMeta, pmToIr, resolve, type DocumentMeta, type IRDocMeta, type PMJsonNode } from '@ses/shared'
import { checkExportGuard, getFootnoteExportError } from '@ses/io'

const route = useRoute()
const router = useRouter()
const store = useDocumentStore()

const loading = ref(true)
const documentLoaded = ref(false)
const saving = ref(false)
const lastSaved = ref('')
const activeTab = ref<'edit' | 'settings'>('edit')
const persistenceOperation = ref<'body-save' | 'settings-save' | 'xml-import' | null>(null)
/**
 * 保存冲突：任一保存路径收到 409（文档在别处被修改）后非空。
 * 与 persistenceOperation 相互独立——后者只描述正在进行的请求，冲突在请求失败后仍然存在，
 * 直到用户选择「重新加载」或「另存为副本」。冲突期间不再安排自动保存，手动保存也不会发出请求。
 */
type SaveConflictSource = 'body-save' | 'settings-save' | 'xml-import' | 'version-save' | 'external'
const saveConflict = ref<{ source: SaveConflictSource; cause?: ExternalCause } | null>(null)
const conflictDialogVisible = ref(false)
const resolvingConflict = ref<'reload' | 'copy' | null>(null)
const conflictDetail = computed(() => {
  const conflict = saveConflict.value
  const bySource = {
    'body-save': '',
    'settings-save': '文件设置的修改也尚未保存，草稿仍保留在「文件设置」中。',
    'xml-import': '本次 XML 导入未生效，编辑器内容保持不变。',
    'version-save': '版本快照已保存，但当前编辑内容没有写入文档。',
    // 变更推送先于任何保存发现外部修改：此时是否有设置草稿取决于当下状态。
    external: settingsDirty.value ? '文件设置的修改也尚未保存，草稿仍保留在「文件设置」中。' : '',
  }[conflict?.source ?? 'body-save']
  return [externalConflictCauseSentence(conflict?.cause), bySource].filter(Boolean).join('')
})
const settingsDraft = ref<DocumentSettingsDraft | null>(null)
const settingsBaseline = ref('')
const settingsSaveError = ref(false)
const settingsDirty = computed(() => Boolean(settingsDraft.value)
  && JSON.stringify(settingsDraft.value) !== settingsBaseline.value)
const searchText = ref('')
const showXmlCode = ref(false)
const showHelp = ref(false)
const showExport = ref(false)
const codeViewFormat = ref<'xml' | 'json' | 'html' | 'raw'>('xml')
const xmlFileInput = ref<HTMLInputElement | null>(null)
const showVersionPanel = ref(false)
const showValidationPanel = ref(false)
/** 文档结构面板：窄屏默认收起，把宽度留给正文 */
const showOutline = ref(typeof window === 'undefined' || window.innerWidth > 960)
const documentId = computed(() => Number(route.params.id))
const documentUnavailable = computed(() => store.isDocumentUnavailable(documentId.value))
const unavailableMessage = ref('文档已移入回收站或当前页面已失效。')
const exportingFormat = ref<'docx' | 'pdf' | 'ses' | null>(null)
/** 导出对话框中的错误提示：概述一行；导出被阻止时另有逐条明细（每条一行），其他导出错误没有明细。 */
const exportError = ref('')
const exportErrorItems = ref<string[]>([])
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
let suppressEditorUpdate = false
let bodyChangeVersion = 0
let bodySavePromise: Promise<boolean> | null = null

watch(settingsDraft, () => {
  if (settingsDirty.value) settingsSaveError.value = false
}, { deep: true })

function scheduleAutoSave() {
  if (!contentReady.value) return
  bodyChangeVersion += 1
  dirty.value = true
  queueAutoSave()
}

function queueAutoSave(delay = 3000) {
  // 冲突未解决前不安排自动保存：再保存只会得到同样的 409。
  if (saveConflict.value || documentUnavailable.value) return
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(() => { void handleSave() }, delay)
}

/**
 * 进入冲突状态并弹出处理提示；已在冲突中时只重新弹出提示。
 * cause 为已知的外部修改原因（变更推送先于保存发现了修改），用于让提示说明是 AI 还是别处修改的。
 */
function enterSaveConflict(source: SaveConflictSource, cause?: ExternalCause) {
  clearAutoSaveTimer()
  if (!saveConflict.value) saveConflict.value = { source, ...(cause ? { cause } : {}) }
  conflictDialogVisible.value = true
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
  extensions: [...createEditorExtensions(), createDocumentValidationExtension()],
  content: '',
  onUpdate() {
    if (!suppressEditorUpdate) scheduleAutoSave()
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

const validation = useDocumentValidation({
  editor,
  documentId,
  documentMeta: () => store.currentDocument?.meta,
  contentReady,
  documentUnavailable,
})
const validationCanRun = computed(() => contentReady.value
  && !documentUnavailable.value
  && validation.state.value !== 'running')
const validationRunLabel = computed(() => validation.state.value === 'running' ? '检查中…'
  : validation.state.value === 'current' || validation.state.value === 'stale' ? '重新检查'
    : validation.state.value === 'failed' ? '重试检查'
      : '检查文档')

async function handleManualValidation() {
  activeTab.value = 'edit'
  showValidationPanel.value = true
  showVersionPanel.value = false
  const outcome = await validation.run()
  if (outcome === 'composing') ElMessage.warning('请先完成当前中文输入，再检查文档')
}

function toggleValidationPanel() {
  showValidationPanel.value = !showValidationPanel.value
  if (showValidationPanel.value) {
    activeTab.value = 'edit'
    showVersionPanel.value = false
  }
}

function hydrateSettingsDraft(document = store.currentDocument) {
  if (!document) {
    settingsDraft.value = null
    settingsBaseline.value = ''
    return
  }
  const draft = documentSettingsDraftFromDocument(document as {
    title: string
    meta: DocumentMeta
    stage: string
    content: Record<string, unknown>
  })
  settingsDraft.value = draft
  settingsBaseline.value = JSON.stringify(draft)
  settingsSaveError.value = false
}

function resetSettingsDraft() {
  if (persistenceOperation.value !== null) return
  hydrateSettingsDraft()
  ElMessage.success('已恢复为最近一次保存的设置')
}

/** Update just the cover attributes so body nodes, selection and undo history stay intact. */
function synchronizeEditorCover(meta: DocumentMeta): Record<string, unknown> {
  const currentEditor = editor.value
  if (!currentEditor) return {}
  const synchronizedJson = synchronizeCoverMetadata(currentEditor.getJSON(), meta)
  const synchronizedDoc = currentEditor.schema.nodeFromJSON(synchronizedJson)
  const state = currentEditor.state
  const transaction = state.tr
  let coverPosition = -1
  state.doc.forEach((node, position) => {
    if (coverPosition < 0 && node.type.name === 'coverPage') {
      coverPosition = position
    }
  })

  const nextCoverIndex = synchronizedDoc.content.content.findIndex((node) => node.type.name === 'coverPage')
  if (nextCoverIndex < 0) throw new Error('无法建立封面元数据节点')
  const nextCover = synchronizedDoc.child(nextCoverIndex)
  if (coverPosition >= 0) {
    transaction.setNodeMarkup(coverPosition, nextCover.type, nextCover.attrs, nextCover.marks)
  } else {
    transaction.insert(0, nextCover)
  }

  for (const key of COVER_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(state.doc.attrs, key)
      && state.doc.attrs[key] !== synchronizedDoc.attrs[key]) {
      transaction.setDocAttribute(key, synchronizedDoc.attrs[key])
    }
  }

  if (transaction.docChanged) {
    transaction.setMeta('addToHistory', false)
    suppressEditorUpdate = true
    try {
      currentEditor.view.dispatch(transaction)
    } finally {
      suppressEditorUpdate = false
    }
  }
  return synchronizeCoverMetadata(currentEditor.getJSON(), meta)
}

function getSynchronizedEditorDoc() {
  const currentEditor = editor.value
  const currentDocument = store.currentDocument
  if (!currentEditor || !currentDocument) return currentEditor?.state.doc ?? null
  const synchronizedJson = synchronizeCoverMetadata(currentEditor.getJSON(), currentDocument.meta)
  return currentEditor.schema.nodeFromJSON(synchronizedJson)
}

function clearAutoSaveTimer() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
}

async function handleSettingsSave() {
  if (documentUnavailable.value) return
  const currentDocument = store.currentDocument
  const draft = settingsDraft.value
  const currentEditor = editor.value
  if (!currentDocument?.id || !draft || !currentEditor) return
  if (saveConflict.value) {
    conflictDialogVisible.value = true
    return
  }
  if (persistenceOperation.value !== null) {
    if (dirty.value && persistenceOperation.value !== 'body-save') queueAutoSave()
    return
  }

  const title = draft.titleCn.trim()
  if (!title) {
    ElMessage.warning('标准中文名称不能为空')
    return
  }

  const draftSnapshot = { ...draft, titleCn: title }
  const meta = documentMetaFromSettingsDraft(currentDocument.meta, draftSnapshot)
  clearAutoSaveTimer()
  persistenceOperation.value = 'settings-save'
  saving.value = true
  settingsSaveError.value = false
  const bodyVersionAtSave = bodyChangeVersion
  try {
    const content = synchronizeCoverMetadata(currentEditor.getJSON(), meta)
    // Validate the candidate against the live production schema without changing editor state.
    const validatedContent = currentEditor.schema.nodeFromJSON(content)
    validatedContent.check()
    const updated = await store.updateDocument(currentDocument.id, {
      title,
      meta,
      stage: draftSnapshot.stage,
      content,
    })
    // Apply only cover attributes after persistence succeeds; the request may have overlapped body edits.
    synchronizeEditorCover(meta)
    hydrateSettingsDraft(updated)
    if (bodyChangeVersion === bodyVersionAtSave) dirty.value = false
    else dirty.value = true
    lastSaved.value = new Date().toLocaleTimeString('zh-CN')
    ElMessage.success('文件设置已保存')
  } catch (error) {
    settingsSaveError.value = true
    // 409：设置草稿与正文都保留，由冲突提示接管，不再弹出泛化的失败消息。
    if (isRevisionConflict(error)) enterSaveConflict('settings-save')
    else ElMessage.error(`设置保存失败，草稿已保留${error instanceof Error ? `：${error.message}` : ''}`)
  } finally {
    persistenceOperation.value = null
    saving.value = false
    if (dirty.value) queueAutoSave()
  }
}

const codeViewResult = computed(() => {
  if (!editor.value) return { content: '', error: '' }
  const doc = getSynchronizedEditorDoc() || editor.value.state.doc
  try {
    const format = codeViewFormat.value
    const content = format === 'xml' ? serializeToXml(doc)
      : format === 'json' ? JSON.stringify(exportSemanticJson(doc), null, 2)
      : format === 'html' ? exportSemanticHtml(doc)
      : JSON.stringify(doc.toJSON(), null, 2)
    return { content, error: '' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { content: '', error: `${codeViewFormat.value.toUpperCase()} 导出错误：${detail}` }
  }
})
const codeViewError = computed(() => codeViewResult.value.error)
const codeViewContent = computed(() => codeViewResult.value.error || codeViewResult.value.content)

onMounted(async () => {
  window.addEventListener('ses:request-footnote-dialog', openBodyFootnoteDialog)
  window.addEventListener(INLINE_FORMULA_EVENT, handleInlineFormulaEvent)
  window.addEventListener('ses:edit-footnote', handleFootnoteEditEvent)
  window.addEventListener('ses:paste-reference-error', handleAmbiguousPasteReference)
  window.addEventListener('ses:reference-missing', handleMissingReference)
  window.addEventListener('beforeunload', guardUnsavedSettings)
  const id = Number(route.params.id)
  try {
    await store.fetchDocument(id)
    documentLoaded.value = true
    const updatedAt = store.currentDocument?.updatedAt
    lastSaved.value = updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN') : ''
    hydrateSettingsDraft()
    let needsNodeIdPersistence = false
    // 旧稿的无题条（条文在 clauseTitle）：载入事务里由编辑器规范化，数量在载入前统计，用于提示与保存。
    let legacyUntitledClauses = 0
    if (store.currentDocument?.content && Object.keys(store.currentDocument.content).length > 0) {
      if (editor.value) {
        const candidate = editor.value.schema.nodeFromJSON(store.currentDocument.content)
        candidate.check()
        needsNodeIdPersistence = hasNodeIdIssues(candidate)
        legacyUntitledClauses = countLegacyUntitledClauses(candidate)
        replaceEditorDocument(editor.value, store.currentDocument.content)
      }
    } else {
      // 新文档加载默认结构
      if (editor.value) {
        const initialContent = createDefaultDocumentContent(store.currentDocument?.meta)
        const candidate = editor.value.schema.nodeFromJSON(initialContent)
        candidate.check()
        needsNodeIdPersistence = hasNodeIdIssues(candidate)
        replaceEditorDocument(editor.value, initialContent)
      }
    }
    contentReady.value = true
    // 文档已载入、本地 revision 已确定：开始订阅变更。连接成功后会再读取一次 revision 与本地比较，
    // 补上「读取文档」与「订阅生效」之间可能错过的修改。连接失败不影响编辑。
    startChangeSync()
    noteLegacyUntitledClauses(legacyUntitledClauses)
    if (needsNodeIdPersistence) {
      // The NodeId plugin has already normalized the live editor state. Persist
      // that exact document now so a cold reopen does not generate new anchors.
      scheduleAutoSave()
      await handleSave()
    }
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
  window.removeEventListener(INLINE_FORMULA_EVENT, handleInlineFormulaEvent)
  window.removeEventListener('ses:edit-footnote', handleFootnoteEditEvent)
  window.removeEventListener('ses:paste-reference-error', handleAmbiguousPasteReference)
  window.removeEventListener('ses:reference-missing', handleMissingReference)
  window.removeEventListener('beforeunload', guardUnsavedSettings)
  changeSyncStopped = true
  changeSync?.stop()
  changeSync = null
  releaseIdleWaiters()
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  // 冲突状态下内容已无法写回服务端（会得到同样的 409），离开前已由路由守卫确认放弃。
  if (dirty.value && !importingXml && !saveConflict.value && !documentUnavailable.value && editor.value && store.currentDocument) {
    const content = synchronizeCoverMetadata(editor.value.getJSON(), store.currentDocument.meta)
    const currentId = store.currentDocument.id
    const baseRevision = store.currentDocument.revision
    if (currentId != null) {
      // 离开时的兜底保存同样带 baseRevision。此时页面已无法再让用户选择，409 只能提示未保存。
      void (async () => {
        try {
          await documentApi.update(currentId, { content, baseRevision })
        } catch (error) {
          if (isRevisionConflict(error)) ElMessage.warning('文档已在其他地方被修改，离开前的修改未保存')
          else throw error
        }
      })()
    }
  }
  editor.value?.destroy()
})

function guardUnsavedSettings(event: BeforeUnloadEvent) {
  if (!dirty.value && !settingsDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

function handleAmbiguousPasteReference(event: Event) {
  const message = event instanceof CustomEvent && typeof event.detail?.message === 'string'
    ? event.detail.message
    : '粘贴内容含重复引用目标，无法确定关联，请先修正源内容'
  ElMessage.error(message)
}

function handleMissingReference() {
  ElMessage.warning('找不到被引用的内容，目标可能已删除；请重新选择引用目标')
}

onBeforeRouteLeave(async () => {
  if (documentUnavailable.value) {
    if (!dirty.value && !settingsDirty.value) return true
    try {
      await ElMessageBox.confirm(
        '文档已不可用，本页尚未保存的正文和文件设置将在离开后丢失。',
        '离开不可用文档？',
        { confirmButtonText: '离开并放弃修改', cancelButtonText: '继续查看', type: 'warning' },
      )
      return true
    } catch {
      return false
    }
  }
  // 冲突状态下无法保存：只能让用户确认放弃，或留下来选择重新加载 / 另存为副本。
  if (saveConflict.value) return await confirmLeaveWithSaveConflict()
  if (!await saveDirtyBodyBeforeRouteLeave()) return false
  if (!settingsDirty.value) return true
  try {
    await ElMessageBox.confirm(
      '文件设置中有尚未保存的修改，离开后这些修改将丢失。',
      '离开文件设置？',
      { confirmButtonText: '离开并放弃修改', cancelButtonText: '继续编辑', type: 'warning' },
    )
    // The user can still edit the body while the settings confirmation is open.
    return await saveDirtyBodyBeforeRouteLeave()
  } catch {
    return false
  }
})

async function confirmLeaveWithSaveConflict(): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      '文档已在其他地方被修改，当前编辑内容尚未保存，离开后这些修改将丢失。',
      '离开并放弃修改？',
      { confirmButtonText: '离开并放弃修改', cancelButtonText: '留在此页', type: 'warning' },
    )
    return true
  } catch {
    return false
  }
}

async function saveDirtyBodyBeforeRouteLeave(): Promise<boolean> {
  if (persistenceOperation.value === 'body-save') {
    const saved = await (bodySavePromise ?? Promise.resolve(false))
    if (!saved) {
      // 保存因 409 失败时，冲突提示已经弹出，不再叠加泛化的失败消息。
      if (!saveConflict.value) ElMessage.warning('正文保存失败，请重试后再离开')
      return false
    }
  } else if (persistenceOperation.value !== null) {
    ElMessage.warning('文档仍在保存或导入，请稍后再离开')
    return false
  }
  if (!dirty.value) return true
  const saved = await handleSave()
  if (!saved || dirty.value) {
    if (!saveConflict.value) ElMessage.warning('正文尚未保存成功，请重试后再离开')
    return false
  }
  return true
}

function handleSave(): Promise<boolean> {
  if (!editor.value || !store.currentDocument || importingXml || documentUnavailable.value) return Promise.resolve(false)
  if (saveConflict.value) {
    // 冲突未解决：再保存只会得到同样的 409，改为重新弹出冲突提示。
    conflictDialogVisible.value = true
    return Promise.resolve(false)
  }
  if (persistenceOperation.value !== null) {
    if (persistenceOperation.value === 'body-save') return bodySavePromise ?? Promise.resolve(false)
    if (dirty.value) queueAutoSave()
    return Promise.resolve(false)
  }
  clearAutoSaveTimer()
  persistenceOperation.value = 'body-save'
  saving.value = true
  const currentEditor = editor.value
  const currentDocumentId = store.currentDocument.id!
  const persistedMeta = store.currentDocument.meta
  try {
    synchronizeEditorCover(persistedMeta)
  } catch (error) {
    persistenceOperation.value = null
    saving.value = false
    ElMessage.error(`封面元数据同步失败：${error instanceof Error ? error.message : String(error)}`)
    return Promise.resolve(false)
  }
  clearAutoSaveTimer()
  const changeVersionAtStart = bodyChangeVersion
  const promise = (async (): Promise<boolean> => {
    try {
      const content = synchronizeCoverMetadata(currentEditor.getJSON(), persistedMeta)
      await store.updateDocument(currentDocumentId, { content })
      if (bodyChangeVersion === changeVersionAtStart) dirty.value = false
      lastSaved.value = new Date().toLocaleTimeString('zh-CN')
      return true
    } catch (error) {
      // 409：编辑器内容基于过期的修订号，暂停自动保存并让用户选择如何处理；内容仍保留在编辑器中。
      if (isRevisionConflict(error)) enterSaveConflict('body-save')
      else ElMessage.error('保存失败；正文仍保留在编辑器中')
      return false
    } finally {
      persistenceOperation.value = null
      saving.value = false
      // A failed snapshot stays dirty, but only edits made during this request
      // require another autosave. Otherwise wait for a new edit or manual save.
      if (dirty.value && bodyChangeVersion !== changeVersionAtStart) queueAutoSave()
    }
  })()
  bodySavePromise = promise
  void promise.finally(() => { if (bodySavePromise === promise) bodySavePromise = null })
  return promise
}

/** 冲突处理一：放弃本地未保存修改，载入服务端最新内容。 */
async function handleConflictReload() {
  const currentEditor = editor.value
  const documentToReload = store.currentDocument
  if (!currentEditor || !documentToReload?.id || resolvingConflict.value) return
  try {
    await ElMessageBox.confirm(
      '重新加载将放弃本页尚未保存的修改（包括文件设置草稿），并载入服务端的最新内容。此操作不能撤销。',
      '放弃本地修改并重新加载？',
      { confirmButtonText: '放弃修改并重新加载', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }

  resolvingConflict.value = 'reload'
  try {
    // 只读取、不碰 store：fetchDocument 会立即把远端 revision 与 meta 装进 store.currentDocument，
    // 内容随后若装不进编辑器，冲突期间仍可用的「保存版本」会带着旧内容和新 revision 写入，静默覆盖远端修改。
    const latest = await store.readDocument(documentToReload.id)
    // 读取期间页面已离开（或 store 已切到别的文档）：不再改动编辑器与 store。
    if (changeSyncStopped || currentEditor.isDestroyed || store.currentDocument?.id !== latest.id) return
    const hasContent = Boolean(latest.content) && Object.keys(latest.content).length > 0
    const content = hasContent ? latest.content : createDefaultDocumentContent(latest.meta)
    // 先用生产 schema 校验，通过后才改动编辑器；失败时保持冲突状态、本地内容，store 的 revision 与 meta 也不变。
    const candidate = currentEditor.schema.nodeFromJSON(content)
    candidate.check()
    const needsNodeIdPersistence = hasNodeIdIssues(candidate)
    const legacyUntitledClauses = countLegacyUntitledClauses(candidate)
    // 重载不进入撤销历史：否则 Ctrl+Z 会把旧内容带回并在下一次自动保存时覆盖最新版本；
    // 此前的撤销记录也一并清空（与自动载入外部修改相同，见 installRemoteDocument）。
    installRemoteDocument(currentEditor, content)
    // 编辑器已换成服务端内容，store 必须同步成同一份。冲突时服务端 revision 正常都大于本地，adoptDocument 会前进；
    // 它返回 false 只可能是 revision 相等（store 已是这份文档）或比本地更小（服务端回滚 / 从备份恢复）。
    // 「重新加载」以服务端为准，后一种情形若保留较大的本地 revision，之后每次保存的 baseRevision 都对不上服务端，永远 409，
    // 所以直接装入读到的文档（与原先 fetchDocument 的结果一致）。上面已确认仍是同一份文档，不会冲掉别的文档。
    if (!store.adoptDocument(latest)) store.currentDocument = latest
    hydrateSettingsDraft(latest)
    dirty.value = false
    lastSaved.value = latest.updatedAt ? new Date(latest.updatedAt).toLocaleTimeString('zh-CN') : ''
    saveConflict.value = null
    conflictDialogVisible.value = false
    ElMessage.success('已载入最新内容')
    // 与首次打开一致：规范化补出的 nodeId 需要立即持久化，冲突已解除，自动保存恢复。
    if (needsNodeIdPersistence) scheduleAutoSave()
    noteLegacyUntitledClauses(legacyUntitledClauses)
  } catch (error) {
    ElMessage.error(`重新加载失败，本页内容保持不变${error instanceof Error ? `：${error.message}` : ''}`)
  } finally {
    resolvingConflict.value = null
  }
}

/** 冲突处理二：把当前编辑器内容（及未保存的文件设置）存成新文档，原文档保持服务端版本不变。 */
async function handleConflictSaveAsCopy() {
  const currentEditor = editor.value
  const sourceDocument = store.currentDocument
  if (!currentEditor || !sourceDocument || resolvingConflict.value) return
  resolvingConflict.value = 'copy'
  try {
    // 未保存的设置草稿（标题非空时）一并带入副本，避免冲突时丢失这部分修改。
    const draft = settingsDraft.value
    const draftMeta = draft && settingsDirty.value && draft.titleCn.trim()
      ? documentMetaFromSettingsDraft(sourceDocument.meta, { ...draft, titleCn: draft.titleCn.trim() })
      : null
    const duplicate = createDocumentDuplicate({
      title: draftMeta ? draftMeta.titleCn : sourceDocument.title,
      meta: draftMeta ?? sourceDocument.meta,
      content: currentEditor.getJSON(),
    })
    // 阶段不在 meta 里，createDocumentDuplicate 固定为工作草案：带入设置草稿时阶段也用草稿的值。
    const copyData = draftMeta && draft ? { ...duplicate, stage: draft.stage } : duplicate
    const copy = await store.createDocument(copyData)
    ElMessage.success('已另存为副本')
    // 内容已保存在副本中：清除本页的冲突与未保存状态，避免离开时再被拦截或触发兜底保存。
    saveConflict.value = null
    conflictDialogVisible.value = false
    dirty.value = false
    clearAutoSaveTimer()
    if (settingsDraft.value) settingsBaseline.value = JSON.stringify(settingsDraft.value)
    // 进入副本的编辑器（App.vue 的 router-view 以路径为 key，会重建编辑器页面）。
    void router.push({ name: 'editor', params: { id: copy.id! } })
  } catch (error) {
    ElMessage.error(`另存为副本失败，当前内容仍保留在编辑器中${error instanceof Error ? `：${error.message}` : ''}`)
  } finally {
    resolvingConflict.value = null
  }
}

// === 变更推送：感知 AI 或其他地方对文档的修改（设计文档 §6.2） ===
// 规则（订阅与 revision 比较在 utils/documentChangeSync.ts，这里只决定「怎么处理」）：
// - revision 不大于本地已知值（含自己保存产生的事件）：忽略；保存进行中收到事件则等保存落定后再比较；
// - system 事件（服务端只补齐 nodeId，语义不变）：静默追上 revision，不改内容、不提示；
// - 已处于冲突状态：只补上原因文案，不再次弹窗；
// - 有未保存的正文/设置草稿：直接进入冲突状态（暂停自动保存），提示是 AI 还是别处修改，不等下一次保存 409；
// - 其余：读取最新内容，通过生产 schema 校验后载入编辑器（不进入撤销历史、保留光标位置），提示来源。
let changeSync: DocumentChangeSync | null = null
let changeSyncStopped = false
const idleWaiters: Array<() => void> = []

watch(persistenceOperation, (operation) => {
  if (operation === null) releaseIdleWaiters()
})

function releaseIdleWaiters() {
  idleWaiters.splice(0).forEach((resolve) => resolve())
}

/**
 * 等到本页没有进行中或排队的写入：store 里排队的写入（正文、设置、导入、版本面板保存都经过它）
 * 以及本页的保存/导入流程（persistenceOperation）都已结束，本地 revision 因此是最新的。
 */
async function waitForLocalWrites(): Promise<void> {
  const id = documentId.value
  while (!changeSyncStopped) {
    await store.waitForPendingUpdates(id)
    if (persistenceOperation.value === null) return
    await new Promise<void>((resolve) => { idleWaiters.push(resolve) })
  }
}

function hasUnsavedLocalChanges(): boolean {
  // store 里排队或进行中的写入（如版本面板的保存）不经过 persistenceOperation。读取最新内容期间才开始的这类写入，
  // 带的是读取之前的本地内容：此时再载入外部修改并前移 revision，它的 PUT 会静默覆盖外部修改，所以同样视为本地有未落定的修改。
  return dirty.value || settingsDirty.value || persistenceOperation.value !== null || importingXml
    || store.hasPendingUpdates(documentId.value)
}

function startChangeSync() {
  // 页面在文档加载期间就被离开时，onBeforeUnmount 已经执行过，不能再建立连接。
  if (changeSyncStopped) return
  const id = documentId.value
  changeSync = startDocumentChangeSync({
    documentId: id,
    getLocalRevision: () => (store.currentDocument?.id === id ? store.currentDocument.revision : undefined),
    readRevision: async () => (await store.readDocument(id)).revision,
    settle: waitForLocalWrites,
    onExternalChange: handleExternalChange,
    onEvent(event) {
      // AI 与 SES 导入都会在同一事务里追加版本记录；版本面板开着时立即刷新列表。
      if ((event.source !== 'ai' && event.source !== 'import') || !showVersionPanel.value) return
      void useVersionStore().fetchVersions(id, { silent: true }).catch(() => undefined)
    },
  })
}

/** 返回 false 表示这次没有处理成功（读取或校验失败），同一 revision 之后还会再上报。 */
async function handleExternalChange(change: ExternalChange): Promise<boolean> {
  const currentEditor = editor.value
  const current = store.currentDocument
  if (changeSyncStopped || !currentEditor || currentEditor.isDestroyed || !current?.id || current.id !== documentId.value) return false
  if (change.lifecycle === 'deleted' || change.lifecycle === 'restored') {
    markDocumentUnavailable(change.lifecycle)
    return true
  }
  if (change.revision <= current.revision) return true
  const cause = externalCauseOf(change)

  if (saveConflict.value) {
    // 已经在冲突里：本页内容反正要由用户选择如何处理，只把原因补进提示，不再弹窗。
    // 原因只会变得更具体（没有 → 别处修改 → AI 修改），不会倒退。
    const known = saveConflict.value.cause
    if (change.source !== 'system' && (!known || (known.kind !== 'ai' && cause.kind === 'ai'))) {
      saveConflict.value = { ...saveConflict.value, cause }
    }
    return true
  }
  if (change.source === 'system') {
    store.adoptRevision(current.id, change.revision)
    return true
  }
  if (hasUnsavedLocalChanges()) {
    enterSaveConflict('external', cause)
    return true
  }
  return await loadExternalRevision(cause)
}

async function loadExternalRevision(cause: ExternalCause): Promise<boolean> {
  const currentEditor = editor.value
  const id = store.currentDocument?.id
  if (!currentEditor || !id) return false
  let latest: DocumentData
  try {
    latest = await store.readDocument(id)
  } catch (error) {
    if (isNotFoundError(error)) {
      markDocumentUnavailable()
      return true
    }
    ElMessage.warning({ message: '文档已在其他地方更新，但读取最新内容失败；稍后保存时会提示冲突', grouping: true })
    return false
  }

  // 读取期间用户可能已经开始输入、开始保存，或页面已经离开：以读取完成这一刻的状态为准。
  const current = store.currentDocument
  if (changeSyncStopped || currentEditor.isDestroyed || current?.id !== id) return true
  if (latest.revision <= current.revision) return true
  if (saveConflict.value) return true
  if (hasUnsavedLocalChanges()) {
    enterSaveConflict('external', cause)
    return true
  }

  const hasContent = Boolean(latest.content) && Object.keys(latest.content).length > 0
  const content = hasContent ? latest.content : createDefaultDocumentContent(latest.meta)
  let needsNodeIdPersistence: boolean
  let legacyUntitledClauses: number
  try {
    // 先用生产 schema 校验，通过后才改动编辑器与本地 revision：装不进去时不能让 revision 前进，
    // 否则之后的自动保存会带着新 revision 把外部修改静默覆盖。
    const candidate = currentEditor.schema.nodeFromJSON(content)
    candidate.check()
    needsNodeIdPersistence = hasNodeIdIssues(candidate)
    legacyUntitledClauses = countLegacyUntitledClauses(candidate)
  } catch (error) {
    ElMessage.error({
      message: `文档已被更新，但最新内容无法载入编辑器，本页内容保持不变${error instanceof Error ? `：${error.message}` : ''}`,
      grouping: true,
    })
    return false
  }
  installRemoteDocument(currentEditor, content)
  store.adoptDocument(latest)
  hydrateSettingsDraft(latest)
  dirty.value = false
  lastSaved.value = latest.updatedAt ? new Date(latest.updatedAt).toLocaleTimeString('zh-CN') : ''
  ElMessage.info({ message: externalUpdateNotice(cause), grouping: true })
  // 与首次打开一致：规范化补出的 nodeId 需要持久化。
  if (needsNodeIdPersistence) scheduleAutoSave()
  noteLegacyUntitledClauses(legacyUntitledClauses)
  return true
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const response = (error as { response?: unknown }).response
  if (typeof response !== 'object' || response === null) return false
  return (response as { status?: unknown }).status === 404
}

function markDocumentUnavailable(lifecycle?: 'deleted' | 'restored') {
  unavailableMessage.value = lifecycle === 'restored'
    ? '文档已恢复，但本页仍是删除前的旧版本。'
    : '文档已移入回收站或当前页面已失效。'
  store.markDocumentUnavailable(documentId.value)
  clearAutoSaveTimer()
  if (editor.value && !editor.value.isDestroyed) editor.value.setEditable(false, false)
  stopChangeSync()
}

function stopChangeSync() {
  changeSyncStopped = true
  changeSync?.stop()
  changeSync = null
  releaseIdleWaiters()
}

watch(documentUnavailable, (unavailable) => {
  if (!unavailable) return
  clearAutoSaveTimer()
  if (editor.value && !editor.value.isDestroyed) editor.value.setEditable(false, false)
  stopChangeSync()
})

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
      // 隐藏封面保持最前；新前言与新建模板一致。
      {
        const cover = editor.value.state.doc.firstChild
        const insertAt = cover?.type.name === 'coverPage' ? cover.nodeSize : 0
        editor.value.chain().focus().insertContentAt(insertAt, createDefaultForeword(store.currentDocument?.meta)).run()
      }
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
/** 结构格式命令失败时按原因码给出不同提示（缺少上级、跳级、悬置段落、无题条分条、位置不允许……）。 */
function warnStructureFailure(result: StructureResult, action: StructureAction = 'clause') {
  if (!result.ok) ElMessage.warning(structureFailureMessage(result.reason, action))
}

function handleInsertClause(level: string) {
  if (editor.value) warnStructureFailure(setClauseFormat(editor.value, Number(level)))
}

function handleInsertClauseNoTitle(level: string) {
  if (editor.value) warnStructureFailure(setClauseFormat(editor.value, Number(level), false))
}

/** 旧稿的无题条（条文放在 clauseTitle）已由编辑器规范化为 IR 模型：需要持久化，并告知用户。 */
function noteLegacyUntitledClauses(count: number) {
  if (count <= 0) return
  scheduleAutoSave()
  ElMessage.info(`已将 ${count} 处无题条的条文移入正文段`)
}

// === 工具栏：表格 ===
let tableSelection: { doc: PMNode; bookmark: SelectionBookmark } | null = null
function rememberTableSelection() {
  if (editor.value) tableSelection = { doc: editor.value.state.doc, bookmark: editor.value.state.selection.getBookmark() }
}
function handleTableCommand(command: string) {
  if (!editor.value) return
  // Dropdown focus can turn a rectangular CellSelection into its native text range.
  // Restore the selection captured before opening, only while the document is unchanged.
  if (tableSelection && editor.value.state.doc.eq(tableSelection.doc)) {
    editor.value.view.dispatch(editor.value.state.tr.setSelection(tableSelection.bookmark.resolve(editor.value.state.doc)))
  }
  tableSelection = null
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
  }
}

// === 工具栏：列项 ===
// 列项是格式命令：选中的列项/段落转为目标类型，空段落处保持插入新列表。
function handleInsertList(listType: string) {
  if (editor.value) warnStructureFailure(setListFormat(editor.value, listType), 'list')
}

// === 工具栏：注 ===
function handleInsertNote(command: string) {
  if (command === 'note') {
    if (editor.value && !editor.value.chain().focus().insertNote().run()) {
      ElMessage.warning('请在段落或列项中设置注；当前选区的原文已保留')
    }
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
  if (documentUnavailable.value) return
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
  if (documentUnavailable.value) return
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
  if (documentUnavailable.value) return
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
  if (documentUnavailable.value) return
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
  if (documentUnavailable.value) return
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
  if (documentUnavailable.value) return
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
  if (editor.value) warnStructureFailure(setParagraphFormat(editor.value), 'paragraph')
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

// === 行内公式与式中符号（docs/phase7-inline-formula.md）===
const showMathDialog = ref(false)
const mathDialogLatex = ref('')
const mathDialogRequest = ref<InlineFormulaRequest | null>(null)
// 打开弹窗时的文档（不放进响应式：确认时要按对象身份判断文档是否被替换过）。
let mathDialogDoc: PMNode | null = null
const cursorInFormula = computed(() => !!editor.value && selectedFormula(editor.value.state) !== null)
const cursorAllowsInlineFormula = computed(() => !!editor.value && canInsertInlineFormula(editor.value.state))
const mathDialogTitle = computed(() => {
  const request = mathDialogRequest.value
  const inWhereTerm = request?.mode === 'where' || editor.value?.state.doc.resolve(Math.min(request?.pos ?? 0, editor.value.state.doc.content.size)).parent.type.name === 'whereTerm'
  const noun = inWhereTerm ? '式中符号' : '行内公式'
  return request?.mode === 'edit' ? `编辑${noun}` : request?.mode === 'replace' ? `转为${noun}` : `插入${noun}`
})

function openMathDialog(request: InlineFormulaRequest) {
  mathDialogRequest.value = request
  mathDialogDoc = editor.value?.state.doc ?? null
  mathDialogLatex.value = request.latex
  showMathDialog.value = true
}

function handleInlineFormulaEvent(event: Event) {
  const detail = (event as CustomEvent<InlineFormulaRequest>).detail
  if (detail) openMathDialog(detail)
}

/** 工具栏「行内公式」：与 Ctrl/Cmd+Shift+M 相同，无选区时插入，选中文字时转为公式。 */
function handleInlineFormula() {
  const ed = editor.value
  if (!ed) return
  if (!ed.commands.requestInlineFormula()) {
    ElMessage.info('行内公式只能放在正文、列项、注、示例、表格单元格、术语定义等位置；选中文字转公式时，选区不能跨段或包含其他公式、脚注')
  }
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
  // 条目在确认时才写入（handleMathConfirm 的 where 分支），取消输入不会留下空条目。
  if (!ed.can().addWhereItem({ pos: formula.pos })) return
  openMathDialog({ mode: 'where', pos: formula.pos, nodeId: formula.node.attrs.nodeId ?? undefined, latex: '' })
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
  // 弹窗期间公式被修改（含远端同步）时不覆盖，避免丢失新内容。
  if (!node || JSON.stringify(node.toJSON()) !== pending.source) {
    ElMessage.warning('公式已被修改，请重新转换')
    return
  }
  const replacement = ed.schema.nodeFromJSON(pending.formula)
  ed.view.dispatch(ed.state.tr.replaceWith(pending.pos, pending.pos + node.nodeSize, replacement).scrollIntoView())
  ed.commands.focus()
  ElMessage.success('已转换为结构化式中')
}

function handleMathConfirm(latex: string) {
  const ed = editor.value
  const request = mathDialogRequest.value
  const openedDoc = mathDialogDoc
  mathDialogRequest.value = null
  mathDialogDoc = null
  if (!ed || !request) return
  // 弹窗期间可能载入了外部修订（整篇替换文档）：插入与替换只认原来那一处，位置之前有增删时拒绝。
  const located = (pos: number) => !!openedDoc && sameInlineLocation(openedDoc, ed.state.doc, pos)
  let applied = false
  if (request.mode === 'where') {
    // 弹窗期间公式可能被远端修订挪走或删除：只认原来那个公式。
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
      case 'whereItem': handleAddWhereItem(); break
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
  if (showValidationPanel.value) showValidationPanel.value = false
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
  if (editor.value) replaceEditorDocument(editor.value, content)
}

// === 导出 ===
function setExportError(view: ExportErrorView) {
  exportError.value = view.summary
  exportErrorItems.value = view.items
}

function clearExportError() {
  setExportError(exportErrorViewOfText(''))
}

function handleExport() {
  if (persistenceOperation.value !== null) {
    ElMessage.warning('文档保存或导入完成后再导出')
    return
  }
  if (settingsDirty.value) {
    ElMessage.warning('文件设置有未保存修改，请先保存或重置')
    activeTab.value = 'settings'
    return
  }
  clearExportError()
  showExport.value = true
}

/** 从文档元数据构建 IR 元数据覆盖项 */
function buildDocMeta(): Partial<IRDocMeta> {
  return irMetaFromDocumentMeta(store.currentDocument?.meta)
}

async function handleExportFormat(format: 'docx' | 'pdf' | 'xml' | 'html' | 'json' | 'ses') {
  if (!editor.value) return
  if (exportingFormat.value !== null) return
  if (persistenceOperation.value !== null) {
    ElMessage.warning('文档保存或导入完成后再导出')
    return
  }
  if (settingsDirty.value) {
    ElMessage.warning('文件设置有未保存修改，请先保存或重置')
    activeTab.value = 'settings'
    showExport.value = false
    return
  }

  // SES 是完整文档包，不受 DOCX/XML/HTML 等单格式出件能力边界限制。
  if (format === 'ses') {
    const requestedDocumentId = documentId.value
    const initialDocument = store.currentDocument
    if (!initialDocument?.id || initialDocument.id !== requestedDocumentId || documentUnavailable.value) return

    exportingFormat.value = 'ses'
    clearExportError()
    try {
      if (dirty.value) {
        const saved = await handleSave()
        if (!saved) return
      }
      await waitForLocalWrites()

      const currentDocument = store.currentDocument
      if (
        documentId.value !== requestedDocumentId
        || currentDocument?.id !== requestedDocumentId
        || documentUnavailable.value
        || saveConflict.value
      ) return
      if (dirty.value) {
        ElMessage.warning('正文仍有未保存修改，请保存后再导出')
        return
      }
      if (settingsDirty.value) {
        ElMessage.warning('文件设置有未保存修改，请先保存或重置')
        activeTab.value = 'settings'
        return
      }

      const currentTitle = buildDocMeta().title || currentDocument.meta?.titleCn || '标准文件'
      const result = await documentApi.exportSesPackage(requestedDocumentId)
      downloadBlob(result.blob, `${currentTitle}.ses`)
      showExport.value = false
      if (result.warningCount > 0) {
        const details = result.warnings.map((warning) => warning.message).filter(Boolean)
        const truncated = result.warningsTruncated ? '（部分告警明细未包含）' : ''
        const detailText = details.length > 0 ? `：${details.join('；')}` : ''
        ElMessage.warning(`SES 文档包已导出；${result.warningCount} 处外部图片引用未打包${detailText}${truncated}`)
      } else {
        ElMessage.success('SES 文档包已导出')
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setExportError(exportErrorViewOfText(`SES 文档包导出失败：${detail}`))
      ElMessage.error(exportError.value)
    } finally {
      exportingFormat.value = null
    }
    return
  }

  const doc = getSynchronizedEditorDoc() || editor.value.state.doc
  // 脚注校验与输出边界检查（json 不检查）；判定与提示文本见 @ses/io 的 exportGuard
  const guardFailure = checkExportGuard(doc, format)
  if (guardFailure) {
    setExportError(exportErrorViewOf(guardFailure))
    ElMessage.error(guardFailure.message)
    return
  }
  const meta = buildDocMeta()
  const docTitle = meta.title || store.currentDocument?.meta?.titleCn || '标准文件'

  if (format === 'docx') {
    exportingFormat.value = format
    clearExportError()
    try {
      const { blob, warnings } = await buildDocxBlob({
        pmDoc: doc,
        documentMeta: store.currentDocument?.meta,
        stage: store.currentDocument?.stage,
      })

      downloadBlob(blob, `${docTitle}.docx`)
      ElMessage(getDocxExportFeedback(warnings))
      showExport.value = false
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setExportError(exportErrorViewOfText(`DOCX 导出失败：${detail}`))
      ElMessage.error(exportError.value)
    } finally {
      exportingFormat.value = null
    }
    return
  }

  if (format === 'pdf') {
    exportingFormat.value = format
    clearExportError()
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
      setExportError(exportErrorViewOfText(`PDF 导出失败：${detail}`))
      ElMessage.error(exportError.value)
    } finally {
      exportingFormat.value = null
    }
    return
  }

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
    showExport.value = false
    ElMessage.success(`${format.toUpperCase()} 文件已导出`)
  } catch (e) {
    setExportError(exportErrorViewOfText(`导出失败：${e instanceof Error ? e.message : String(e)}`))
    ElMessage.error(exportError.value)
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
  if (codeViewError.value) return
  if (persistenceOperation.value !== null || settingsDirty.value) {
    ElMessage.warning(settingsDirty.value ? '文件设置有未保存修改，请先保存或重置' : '文档保存或导入完成后再复制')
    return
  }
  const doc = getSynchronizedEditorDoc()
  if (doc && !['json', 'raw'].includes(codeViewFormat.value)) {
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
  if (codeViewError.value) return
  if (persistenceOperation.value !== null || settingsDirty.value) {
    ElMessage.warning(settingsDirty.value ? '文件设置有未保存修改，请先保存或重置' : '文档保存或导入完成后再下载')
    return
  }
  const formatInfo: Record<string, { ext: string; mime: string }> = {
    xml: { ext: 'xml', mime: 'application/xml' },
    json: { ext: 'json', mime: 'application/json' },
    html: { ext: 'html', mime: 'text/html' },
    raw: { ext: 'json', mime: 'application/json' },
  }
  const info = formatInfo[codeViewFormat.value] || formatInfo.raw
  const doc = getSynchronizedEditorDoc()
  if (doc && !['json', 'raw'].includes(codeViewFormat.value)) {
    const footnoteError = getFootnoteExportError(doc)
    if (footnoteError) {
      ElMessage.error(footnoteError)
      return
    }
  }
  const titleCn = store.currentDocument?.meta?.titleCn || store.currentDocument?.title || '标准文件'
  downloadFile(codeViewContent.value, `${titleCn}.${info.ext}`, info.mime)
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
  if (documentUnavailable.value) {
    input.value = ''
    ElMessage.warning('文档已不可用，不能导入 XML')
    return
  }
  if (saveConflict.value) {
    input.value = ''
    conflictDialogVisible.value = true
    return
  }
  if (persistenceOperation.value !== null || importingXml) {
    input.value = ''
    ElMessage.warning('文档正在保存或导入，请稍后再导入 XML')
    return
  }
  if (settingsDirty.value) {
    input.value = ''
    ElMessage.warning('文件设置有未保存修改，请先保存或重置')
    activeTab.value = 'settings'
    return
  }
  if (!currentDocument?.id) {
    input.value = ''
    ElMessage.error('当前文档不可用，无法导入 XML')
    return
  }
  const currentDocumentId = currentDocument.id

  importingXml = true
  persistenceOperation.value = 'xml-import'
  saving.value = true
  const wasEditable = currentEditor.isEditable
  const wasDirty = dirty.value
  currentEditor.setEditable(false)
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  let persisted = false
  const finishImport = () => {
    if (!currentEditor.isDestroyed && !documentUnavailable.value) currentEditor.setEditable(wasEditable)
    importingXml = false
    persistenceOperation.value = null
    saving.value = false
    input.value = ''
    if (!persisted && wasDirty && !currentEditor.isDestroyed && !documentUnavailable.value) scheduleAutoSave()
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
      const validatedJson = normalizeNodeIds(validatedDoc).toJSON()
      if (currentEditor.isDestroyed || store.currentDocument?.id !== currentDocumentId) {
        throw new Error('当前文档已切换，请重新导入')
      }
      const update = prepareXmlImportDocumentUpdate(validatedJson, currentDocument.meta)
      const meta = { ...currentDocument.meta, ...update.meta }
      const content = synchronizeCoverMetadata(validatedJson, meta)
      const finalCandidate = currentEditor.schema.nodeFromJSON(content)
      finalCandidate.check()
      const normalizedContent = normalizeNodeIds(finalCandidate).toJSON()
      const updated = await store.updateDocument(currentDocumentId, {
        title: update.title,
        meta,
        content: normalizedContent,
      })
      persisted = true
      if (currentEditor.isDestroyed || store.currentDocument?.id !== currentDocumentId) {
        throw new Error('当前文档已切换，导入结果已保存但无法安装到此编辑器')
      }
      // The candidate has already passed the production schema and NodeId rules.
      // Install only after persistence succeeds so a failed request cannot alter
      // the live selection or undo history.
      replaceEditorDocument(currentEditor, normalizedContent, false)
      hydrateSettingsDraft(updated)
      dirty.value = false
      lastSaved.value = new Date().toLocaleTimeString('zh-CN')
      ElMessage.success('XML 文件导入成功')
    } catch (err) {
      // 409：导入结果没有写入文档，编辑器内容保持不变；由冲突提示接管。
      if (isRevisionConflict(err)) enterSaveConflict('xml-import')
      else ElMessage.error(`XML 导入失败: ${err}`)
    } finally {
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

/* === top nav：文档级操作 === */
.ed-nav {
  display: grid;
  /* 右侧按实际宽度占位，左侧标题让位截断，避免中间的视图切换与右侧按钮重叠 */
  grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  height: 52px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  flex-shrink: 0;
}
.nav-l, .nav-r { display: flex; align-items: center; gap: 12px; min-width: 0; }
.nav-r { justify-content: flex-end; gap: 10px; }
.brand-sep { flex: 0 0 auto; width: 1px; height: 16px; background: var(--ses-line-2); }

.doc-crumb {
  display: flex; flex-direction: column; justify-content: center;
  min-width: 0; max-width: 420px;
  padding: 3px 8px; margin-left: -4px;
  border: 0; border-radius: 6px;
  background: transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  line-height: 1.3;
}
.doc-crumb:hover { background: var(--ses-surface-2); }
.doc-crumb:focus-visible { outline: 2px solid var(--ses-accent-ring); outline-offset: 1px; }
.doc-crumb .std-no { color: var(--ses-ink-3); font-family: var(--ses-font-mono); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.doc-crumb .crumb-title { font-size: 13px; font-weight: 600; color: var(--ses-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.ed-tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--ses-surface-2);
  border-radius: 8px;
}
.ed-tab {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 5px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ses-ink-3);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.ed-tab:hover { color: var(--ses-ink); }
.ed-tab.is-active {
  background: var(--ses-surface);
  color: var(--ses-ink);
  font-weight: 600;
  box-shadow: var(--ses-shadow-1);
}
.tab-dirty-mark { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--ses-warn); box-shadow: 0 0 0 2px var(--ses-warn-soft); }
.tab-dirty-mark.settings-mark { background: var(--ses-accent); box-shadow: 0 0 0 2px var(--ses-accent-soft); }

.ses-save-pill.is-dirty .dot { background: var(--ses-warn); }

/* 文档操作：同一种低调按钮，开启的面板用强调色标出；整页只有「导出」是主按钮 */
.nav-actions {
  display: flex; align-items: center; gap: 2px;
  padding-left: 10px;
  border-left: 1px solid var(--ses-line);
}
.nav-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 32px;
  min-width: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ses-ink-2);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;
}
.nav-btn:hover { background: var(--ses-surface-2); color: var(--ses-ink); }
.nav-btn:focus-visible, .tbar-btn:focus-visible { outline: 2px solid var(--ses-accent-ring); outline-offset: 1px; }
.nav-btn.is-active { background: var(--ses-accent-soft); color: var(--ses-accent); }
.nav-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.nav-btn .el-icon { font-size: 15px; }
.nav-glyph { font-family: var(--ses-font-mono); font-size: 12px; font-weight: 700; }

.nav-split {
  display: inline-flex; align-items: center;
  margin: 0 2px;
  border: 1px solid var(--ses-line-2);
  border-radius: 7px;
}
.nav-split .nav-btn { height: 30px; }
.nav-split .nav-btn:first-child { border-radius: 6px 0 0 6px; }
.nav-split.is-active { border-color: var(--ses-accent); }
.nav-split.is-active > .nav-btn:first-child { background: var(--ses-accent-soft); color: var(--ses-accent); }
.nav-validation-run {
  border-left: 1px solid var(--ses-line-2);
  border-radius: 0 6px 6px 0;
  color: var(--ses-accent);
  font-weight: 600;
}
.nav-split.is-active .nav-validation-run { border-left-color: var(--ses-accent); }
.nav-validation-run:hover { background: var(--ses-accent-soft); color: var(--ses-accent); }

/* === save conflict (409) === */
.ses-save-pill.is-conflict { background: var(--ses-err-soft); color: oklch(0.4 0.18 25); font-weight: 600; }
.ses-save-pill.is-conflict .dot { background: var(--ses-err); }
.conflict-banner,
.unavailable-banner {
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0;
  padding: 8px 16px;
  background: var(--ses-err-soft);
  border-bottom: 1px solid var(--ses-err);
  color: oklch(0.4 0.18 25);
  font-size: 13px;
}
.unavailable-banner {
  background: var(--ses-warn-soft);
  border-bottom-color: var(--ses-warn);
  color: var(--ses-ink);
}
.unavailable-banner .conflict-banner-icon { color: var(--ses-warn); }
.conflict-banner-icon { flex: 0 0 auto; font-size: 16px; color: var(--ses-err); }
.conflict-banner-text { flex: 1; min-width: 0; }
.conflict-lead { margin: 0 0 8px; line-height: 1.7; }
.conflict-detail { margin: 0 0 8px; color: var(--ses-ink-2); line-height: 1.7; }
.conflict-options { margin: 8px 0 0; padding-left: 18px; color: var(--ses-ink-2); font-size: 13px; line-height: 1.8; }

/* === toolbar：正文编辑 === */
.ed-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 2px;
  min-height: 44px;
  padding: 6px 12px;
  background: var(--ses-surface);
  border-bottom: 1px solid var(--ses-line);
  box-shadow: 0 1px 2px oklch(0.21 0.014 270 / 0.03);
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.tbar-group {
  display: flex; align-items: center; gap: 1px;
  height: 32px;
  flex-shrink: 0;
}
.tbar-sep {
  flex: 0 0 auto;
  width: 1px; height: 18px;
  margin: 0 6px;
  background: var(--ses-line-2);
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
  display: inline-flex; align-items: center; gap: 3px;
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
.tbar-group :deep(.tbar-btn .el-icon) { font-size: 11px; color: var(--ses-ink-4); }
.tbar-group :deep(.tbar-btn:hover) {
  background: var(--ses-surface-3);
  color: var(--ses-ink);
}
.tbar-btn.is-active { background: var(--ses-accent-soft); color: var(--ses-accent); }
.tbar-btn.is-active .el-icon { color: var(--ses-accent); }
.tbar-btn[disabled] { opacity: 0.38; pointer-events: none; }
.tbar-btn.icon-btn { width: 28px; padding: 0; justify-content: center; }
.tbar-group :deep(.tbar-btn.icon-btn .el-icon) { font-size: 15px; color: inherit; }

/* 上下文工具：浅色底与常驻工具区分，提示它们只作用于当前公式、图或表 */
.tbar-context {
  padding: 0 4px;
  border-radius: 8px;
  background: var(--ses-accent-soft);
}
.tbar-context .tbar-label { color: var(--ses-accent); }

.format-group strong, .format-group em, .format-group u, .format-group s {
  font-family: var(--ses-font-zh-hei);
}

.tbar-search { width: 200px; margin-left: auto; flex-shrink: 0; }
:deep(.tbar-search .el-input__wrapper) {
  border-radius: 6px;
}

/* === body === */
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
  display: inline-flex; align-items: center; gap: 4px;
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
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border: 0; border-radius: 6px;
  background: transparent;
  color: var(--ses-ink-3);
  cursor: pointer;
}
.outline-icon-btn:hover { background: var(--ses-surface-2); color: var(--ses-ink); }
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
.validation-sidebar { min-width: 0; padding: 0; }
:deep(.ProseMirror .ses-validation-mark) {
  position: relative;
  box-shadow: inset 3px 0 currentColor;
  outline: 2px solid currentColor;
  outline-offset: 1px;
}
:deep(.ProseMirror .ses-validation-mark::after) {
  position: absolute;
  z-index: 4;
  top: 2px;
  right: 3px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  background: var(--ses-validation-badge);
  color: white;
  content: attr(data-validation-count);
  font: 700 10px/16px sans-serif;
  text-align: center;
}
:deep(.ProseMirror .ses-validation-error) { color: #bc3030; --ses-validation-badge: #bc3030; }
:deep(.ProseMirror .ses-validation-warning) { color: #a96500; --ses-validation-badge: #a96500; }
:deep(.ProseMirror .ses-validation-suggestion) { color: #2865a5; --ses-validation-badge: #2865a5; }
.slide-right-enter-active, .slide-right-leave-active { transition: all 0.3s ease; }
.slide-right-enter-from,  .slide-right-leave-to     { transform: translateX(100%); opacity: 0; }
.slide-left-enter-active, .slide-left-leave-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.slide-left-enter-from,  .slide-left-leave-to     { transform: translateX(-24px); opacity: 0; }

/* 窄屏：结构面板与侧栏浮在正文上方，不再挤占纸面宽度 */
@media (max-width: 960px) {
  .ed-body > .outline-host { position: absolute; top: 0; left: 0; bottom: 0; z-index: 20; box-shadow: 8px 0 24px #1d213322; }
}
@media (max-width: 1100px) {
  .ed-body > .version-sidebar { position: absolute; top: 0; right: 0; bottom: 0; z-index: 20; width: min(92vw, 380px); min-width: min(92vw, 320px); box-shadow: -8px 0 24px #1d213322; }
}

/* === settings tab === */
.settings-host { flex: 1; min-height: 0; display: flex; overflow: hidden; }

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
/* 导出被阻止的提示：概述一行，明细逐条一行；明细区限高并在内部滚动，使下方的格式卡片不必滚动对话框即可看到。 */
.export-error { align-items: flex-start; margin-bottom: 14px; }
/* el-alert 的内容列是 flex 项，缺省 min-width:auto 会被不可折行的长路径撑开并被 overflow:hidden 裁掉 */
.export-error :deep(.el-alert__content) { flex: 1; min-width: 0; }
.export-error :deep(.el-alert__icon) { margin-top: 4px; }
.export-error :deep(.el-alert__title) { font-size: 13px; line-height: 1.6; }
.export-error-text { display: block; font-weight: 600; overflow-wrap: anywhere; word-break: break-all; }
.export-error-items {
  max-height: clamp(96px, 24vh, 220px);
  margin: 6px 0 0;
  padding: 0 8px 0 20px;
  overflow-y: auto;
  font-size: 12px;
  font-weight: normal;
  line-height: 1.55;
}
.export-error-items li { padding: 2px 0; overflow-wrap: anywhere; word-break: break-all; }
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

/* 中等宽度：文档操作只留图标（悬停有提示），检查按钮保留文字 */
@media (max-width: 1366px) {
  .nav-actions .nav-btn-label { display: none; }
  .nav-actions .nav-btn { padding: 0 7px; }
  .nav-actions .nav-validation-run { padding: 0 9px; }
}
@media (max-width: 1180px) {
  .tbar-label { display: none; }
  .tbar-search { width: 160px; }
}
@media (max-width: 1000px) {
  .ed-nav {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'nav-left nav-right' 'nav-tabs nav-tabs';
    gap: 6px 10px;
    height: auto;
    min-height: 52px;
    padding: 7px 10px;
  }
  .nav-l { grid-area: nav-left; }
  .ed-tabs { grid-area: nav-tabs; justify-self: center; }
  .nav-r { grid-area: nav-right; gap: 6px; }
  .doc-crumb { max-width: min(300px, 34vw); }
  .tbar-search { width: 100%; margin-left: 0; order: 10; }
}
@media (max-width: 620px) {
  .ed-nav { padding: 6px 8px; }
  .nav-l { gap: 7px; }
  .brand-sep, .doc-crumb .std-no { display: none; }
  .doc-crumb { max-width: 34vw; padding: 4px 5px; }
  .doc-crumb .crumb-title { font-size: 11px; }
  .nav-r { gap: 4px; }
  .nav-actions { padding-left: 4px; }
  .nav-r > .el-button span { display: none; }
  .nav-r > .el-button { padding: 7px 9px; }
  .ses-save-pill { padding: 4px 7px; font-size: 9px; }
  .ed-tab { padding: 5px 10px; font-size: 11px; }
}
</style>
