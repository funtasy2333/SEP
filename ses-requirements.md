# 标准化文件编辑系统(Standards Editor System, SES)需求规格文档

## 1. 项目背景
随着标准化工作的不断深入，对标准文件编辑的规范性和效率提出了更高的要求。本项目旨在开发一套专业的标准文件编辑系统，解决现有标准编写过程中的痛点问题。

## 2. 系统目标
开发一个面向标准化组织的在线文档编辑系统，实现标准文件的高效、规范化编写和管理。

## 3. 功能需求详细说明

### 3.1 内容与格式分离
- 实现标准内容的逻辑结构与最终呈现格式的解耦
- 支持按照GB/T 1.1-2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》自动生成标准文件
- 提供多种输出格式：
  - DOCX文件(符合GB/T 1.1要求)
  - PDF文件(保留格式、可打印)
- 支持自定义模板配置，适应不同类型标准文件的格式要求

### 3.2 内容结构化标注
- 提供结构化标注功能，支持多种标记格式：
  - XML标注
  - JSON标注
  - HTML语义化标注
- 标注内容包括但不限于：
  - 章节结构
  - 条款
  - 段落
  - 列表项
  - 表格
  - 图片
  - 交叉引用
  - 参考文献
- 支持层级结构标注，便于内容管理和自动化处理

### 3.3 版本管理
- 手动版本控制功能
- 支持标准草案不同阶段版本管理：
  - 工作草案
  - 征求意见稿
  - 送审稿
  - 报批稿
  - 发布稿
- 版本对比功能
  - 可视化展示版本间差异
  - 支持版本回滚
- 版本历史记录导出

### 3.4 编辑界面与交互
- 选用成熟的富文本编辑器内核：
  - Tiptap
- 界面功能：
  - 所见即所得(WYSIWYG)编辑模式
  - 智能内容要素选择器
    - 快速插入章节
    - 快速插入条款
    - 表格智能生成
    - 图片及图题插入
    - 列表项格式化
- 智能校验功能
  - 格式一致性检查
  - 标准术语规范性检查
  - 引用和交叉引用有效性检查

下面给出一个基于 **TipTap**（及其底层 **ProseMirror**）进行二次开发的整体思路，帮助你实现以下核心需求：

1. **内容与格式分离**  
2. **XML 标记**（文档结构化）  
3. **版本管理**  
4. **文档输出与发布**  

思路会从总体架构、数据流设计、TipTap 自定义开发、版本管理策略、以及文档输出流程等几个方面展开。你可以根据自己团队的技术栈和项目规模进行取舍和调整。

---

## 一、总体架构与核心流程

1. **前端层（基于 TipTap）**  
   - 提供一个类似“Word”的所见即所得（WYSIWYG）界面，让用户编辑文档内容；  
   - TipTap 负责处理用户的所有输入操作、生成对应的 ProseMirror 文档结构；  
   - 我们会在此层做“**自定义 Node/Mark**”、以及“**序列化/反序列化**”逻辑，把编辑器内部数据和后台的 XML 进行互相转换。

2. **后台服务层**  
   - 提供 REST 或 GraphQL API 给前端调用；  
   - 负责**版本管理**、**XML 存储**、**文档输出**等业务逻辑；  
   - （可选）在这里可以进行权限校验、审计日志等。

3. **存储与版本控制**  
   - 你可以使用数据库（如 PostgreSQL/MySQL/MongoDB 等）来保存文档的 XML 或 ProseMirror JSON；  
   - 或者使用 Git/SVN 等版本控制系统来跟踪文档的改动；  
   - 每次用户保存或提交时，都要生成一个新版本，方便后续回溯。

4. **文档输出与发布**  
   - 在后台根据存储的 XML 做进一步处理，如：  
     - 使用 XSLT 将 XML 转为 PDF（通过 Apache FOP 或 LaTeX 等），或者转为 HTML/Word；  
     - 或者将 ProseMirror JSON 转为 HTML，再用 Pandoc / wkhtmltopdf 等实现 PDF/Word 输出。

**核心逻辑**：**前端始终操作 TipTap/ProseMirror 文档** → **与 XML 的双向转换** → **版本管理 + 输出**。

---

## 二、TipTap 的自定义开发要点

### 2.1 TipTap 核心概念

- **Editor**：TipTap 的主入口，管理所有扩展（Extensions）及编辑器状态；  
- **Schema**（源于 ProseMirror）：定义编辑器中可出现的节点（Node）和内联标记（Mark），以及它们的属性、可嵌套结构；  
- **Extensions**：可插拔的功能模块，用于**定义节点/标记**、**命令/快捷键**、**菜单栏**等；  
- **Parser / Serializer**：将外部格式（XML/HTML/Markdown/JSON等）与 ProseMirror Doc 相互转换。

### 2.2 规划编辑器数据结构（Schema）

1. **列出你的标准文档常见结构**  
   - 章节、段落、表格、图片、引用、术语、参考文献、附录等；  
   - 你可以为它们设定各自的 XML 标签，例如 `<chapter>`、`<clause>`、`<table>`、`<figure>` 等；  
   - TipTap/ProseMirror 这边对应定义一个 Node 类型，比如 `chapterNode`, `clauseNode`, `tableNode` 等。

2. **自定义 Node/Mark**  
   - 在 TipTap 中编写对应的 Extension，定义 name、schema、parseDOM、renderHTML 等。  
   - **parseDOM**：从 HTML/DOM 解析该节点；  
   - **renderHTML**：将编辑器中的节点渲染为对应的 HTML。  
   - 例如，“章节”在编辑器里可以显示为一个带特定样式的 block-level element；后台可以再把它映射到 `<chapter>` 的 XML 标签。

3. **确保你可以扩展“属性”**  
   - 如果 `<chapter>` 需要属性（如 `id="chap1"`、`title="..."`），你可以在 Node schema 里设置 `attrs: { id: { default: null }, title: { default: '' } }` 等。

### 2.3 自定义序列化/反序列化（XML ↔ ProseMirror Doc）

- **思路**：  
  - 当用户在前端加载一个文档时，从后台获取 XML，解析成 TipTap/ProseMirror 文档结构；  
  - 用户编辑完后，点击保存时，将 ProseMirror 文档序列化回 XML 并发送给后台。

- **实现方式**：  
  1. **XML → (中间)HTML → ProseMirror**  
     - 你可以先将 XML 用 XSLT 转成一份带有特殊自定义标签/类名的 HTML，然后用 TipTap 的 `parseHTML` 载入；  
     - 载入时，通过 Node/Mark 的 `parseDOM` 规则识别特定标签/类名，构建相应的节点；  
  2. **ProseMirror → (中间)HTML → XML**  
     - 从 TipTap Editor 中拿到 HTML（`editor.getHTML()`），再用 XSLT 或自定义脚本将其还原回 XML；  
     - 或直接写一个**ProseMirror Node → XML** 的自定义遍历器，按节点类型输出对应的 XML 标签。  
  3. **ProseMirror JSON**  
     - TipTap 中也可以 `editor.getJSON()` 得到内部 JSON，然后你自行编写函数将 JSON 转成 XML；  
     - 反向时，从 XML 转 JSON，再加载到编辑器。

- **注意点**：  
  - 如何在 HTML/JSON 中“保留” XML 的属性、层级信息，以便能往返转换；  
  - 对于表格、图片、引用等复杂结构，需要仔细设计解析/序列化逻辑；  
  - 可考虑在 DOM 元素上加自定义属性（如 `data-type="chapter"`, `data-id="ch1"`）来辅助识别。

---

## 三、版本管理与数据库设计

1. **存储结构**  
   - **XML 存储**：后台数据库存一份完整 XML 文本；  
   - **ProseMirror JSON 存储**（可选）：有的团队会把编辑器 JSON 也存下来，加载时可直接还原编辑器状态，省去 XML→HTML→ProseMirror 的过程。  
   - **元数据**：如文档标题、作者、时间、版本号、阶段（CD/DIS/FDIS）等，存在关系型表或文档型数据库都可以。  

2. **版本管理方式**  
   - **数据库表**：在 `documents` 表中，每次更新插入一条新记录，用自增或 UUID 标识版本；  
   - **Git 方式**：将 XML 或 JSON 文件托管在 Git 仓库，commit 代表一次版本；  
   - 二者皆可：也可以在数据库表和 Git 间同步，满足审计和历史回溯需求。

3. **检出/提交流程**  
   - 当用户打开文档时，前端向后端请求最新版本或指定版本的 XML/JSON，加载进 TipTap；  
   - 用户编辑后点击保存，序列化为 XML/JSON 发给后台，后台产生新版本记录。

4. **对比查看**  
   - 如果需要做“差异比对”，可基于 XML diff / ProseMirror diff / Git diff 实现；  
   - 前端可展示哪些段落新增、哪些被删改等信息。

---

## 四、文档输出与发布

1. **XML 内容** → Word/PDF/HTML  
   - **XSLT**：  
     - 你可以准备 XSLT 脚本，将自定义 XML 转成 XSL-FO，再用 Apache FOP 生成 PDF，或转成 (X)HTML；  
     - 也可以转成 DocBook 再用 DocBook 工具链输出各种格式。  
   - **Pandoc**：  
     - 如果最终想要 Word 文档，也可先把自定义 XML 转换成 Pandoc 支持的格式（DocBook / TEI / Markdown 等），再由 Pandoc 输出 .docx / PDF / HTML；  
   - **自定义脚本**：  
     - 小规模项目也可以自己写脚本把 XML 解析后，用一些模板引擎（如 Jinja2、Freemarker 等）生成 HTML/PDF 等。

2. **自动化流程**  
   - 每次文档定稿或到达某个里程碑（如 WD → CD → DIS），可点击“导出”按钮，调用后台的转换逻辑，一键生成需要发布的 Word/PDF；  
   - 把输出文件存入发布系统或归档目录，供外部访问下载。

3. **发布后记录**  
   - 在数据库/版本库中标记已发布的版本号，避免与继续编写的草案混淆；  
   - 如果需要对外公开，可在前端展示下载链接或提供 API。

---

## 五、前后端通讯与项目结构

1. **前端**：  
   - 采用 React/Vue/Angular 任一框架都可以，只需把 TipTap 集成进去；  
   - 组织代码：  
     - `EditorPage` 组件（负责渲染 TipTap Editor、工具栏、保存按钮等）；  
     - `editorExtensions.js`（定义所有 TipTap Extensions：自定义节点/标记/菜单命令等）；  
     - `xmlUtils.js`（实现序列化/反序列化逻辑）。  

2. **后端**：  
   - 使用 Java/Spring Boot、Python/FastAPI、Node.js/NestJS 等都行；  
   - 提供几个关键 API：  
     1. **GET /document/{id}/{version}**：获取指定版本的文档 XML 或 JSON；  
     2. **POST /document/{id}**：提交新版本文档；  
     3. **POST /document/{id}/export**：导出 Word/PDF 等；  
     4. （可选）**GET /document/diff**：获取两个版本间的差异。  

3. **数据存储**：  
   - `documents` 表（或集合）：`id`, `version`, `xmlContent`, `createdBy`, `createdAt` 等；  
   - 视情况也可把 `prosemirror_json` 字段单独存一下，用于快速加载。

---

## 六、开发步骤与里程碑

分阶段开发计划
Phase 0：项目初始化与基础架构（~1周）
目标：搭建开发环境，跑通最小闭环
*  初始化 Vue 3 + Vite + TypeScript 项目
*  集成 Tiptap v2，实现基础编辑器渲染
*  集成 Element Plus UI 框架
*  搭建基础页面布局（侧边栏 + 编辑区 + 工具栏）
*  配置 IndexedDB (Dexie.js) 本地存储
*  实现文档的基本创建/保存/加载闭环

Phase 1：自定义 Schema 与核心节点（~2周）
目标：定义标准文档的完整数据结构
基于 GB/T 37967-2019 和现有 styles.config 中的66+样式，开发自定义 Tiptap 节点：
核心节点开发：
* StandardDoc — 文档根节点，含元数据属性（标准号、ICS分类号、CCS分类号等）
*  CoverPage — 封面节点（标准名称、编号、发布/实施日期、密级等）
*  Chapter — 章节节点（自动编号，对应 章标题 样式）
*  Clause — 条款节点（1-5级，对应 一级条标题~五级条标题）
*  StdParagraph — 标准正文段落
*  TermDef — 术语定义节点（中文名、英文名、定义、注、示例）
*  StdTable — 标准表格节点（含表标题，支持中英文）
*  Figure — 图节点（含图题，支持中英文）
*  Formula — 公式节点
*  StdList — 列表节点（破折号列项、数字编号、字母编号、罗马数字等多种类型）
*  Note / Example — 注和示例节点
*  Appendix — 附录节点（含附录标识、附录内各级标题）
*  CrossRef — 交叉引用标记
*  BibRef — 参考文献条目
*  Footnote — 脚注（条文脚注、图表脚注）
Schema 设计原则：
* 每个节点携带语义属性（id, type, level 等），与 XML 标签一一对应
* parseHTML / renderHTML 使用 data-* 属性保留语义信息
* 层级约束通过 ProseMirror Schema 的 content 表达式严格限定
————————
Phase 2：编辑器界面与交互（~2周）
目标：实现所见即所得的标准文件编辑体验
*  工具栏开发
    * 文档结构操作（插入章、条、附录等）
    * 文本格式（加粗、斜体、上下标等）
    * 表格操作（创建、合并/拆分单元格）
    * 图片插入与图题管理
    * 公式编辑
    * 列表类型切换
*  智能内容要素选择器（Slash Command 或侧边面板）
    * 输入 / 弹出节点类型菜单
    * 快速插入：章节、条款、术语、表格、图、公式、注、示例、附录等
    * 上下文感知：根据当前位置过滤可插入的节点类型
*  文档大纲面板
    * 侧边栏展示文档结构树
    * 点击跳转到对应位置
    * 拖拽调整章节顺序
* 自动编号系统
    * 章节编号（1, 2, 3...）
    * 条款编号（3.1, 3.1.1...）
    * 图/表编号（图1, 表1...；附录内自动加附录字母前缀：图A.1, 表B.2）
    * 附录编号（附录A, 附录B...）
    * 编号随增删自动更新（通过 CSS counter 实时响应文档结构变化）
*  数字与单位之间自动添加空格
    * 依据 GB 3101—1993，数值与单位符号间应留一空格（如 `5 kg`、`28.4 °C`、`100 MPa`）
    * 例外（不自动加空格）：平面角度 `°` `′` `″`（GB 3101 明文例外），以及 `%` `‰`（按中文排版惯例）
    * 实现方式：Tiptap InputRule，在用户键入"数字+单位"组合的最后一个字符时自动插入半角空格
—————————
Phase 3：XML 序列化与结构化标注（~2周）
目标：实现 ProseMirror JSON ↔ GB/T 37967-2019 XML 的双向转换
*  XML 序列化器 (ProseMirror Doc → XML)
    * 遍历文档树，按节点类型输出对应 XML 标签
    * 符合 GB/T 37967-2019 的 <standard><content> 根结构
    * 正确处理 <basic_info>, <term>, <technology>, <appendix>, <reference> 等节点
    * CDATA 处理、语言属性（lang="en"）、图片路径等
*  XML 解析器 (XML → ProseMirror Doc)
    * 解析 GB/T 37967 XML，还原为 ProseMirror 文档结构
    * 处理属性映射（t_id, tech_itiid 等 → 节点 attrs）
*  JSON 标注导出
    * 将文档结构导出为 JSON 格式（基于 ProseMirror JSON 的语义增强版）
*  HTML 语义化导出
    * 导出带语义标签/data-* 属性的 HTML
———————
Phase 4：版本管理（~1.5周）
目标：本地版本控制与差异比对
*  版本存储模型（IndexedDB）
    * 文档表：id, title, currentVersion, stage, createdAt, updatedAt
    * 版本表：id, docId, version, content(JSON), xml, stage, note, createdAt
    * 阶段枚举：工作草案 → 征求意见稿 → 送审稿 → 报批稿 → 发布稿
*  手动版本创建
    * 用户点击"保存版本"时创建新版本快照
    * 支持版本备注说明
*  版本列表与浏览
    * 展示版本历史时间线
    * 点击任意版本预览内容（只读模式）
    * 支持回滚到指定版本
*  版本差异比对
    * 基于 ProseMirror JSON diff 或文本 diff 实现
    * 可视化展示新增（绿色）、删除（红色）、修改（黄色）
    * 支持选择任意两个版本进行比对
* 版本历史导出
    * 导出版本变更记录（CSV/PDF）
———————————

Phase 5：文档导出（~2周）
目标：生成符合 GB/T 1.1-2020 的标准文件
*  DOCX 导出（核心，使用 docx.js）
    * 映射现有6类 Word 模板（国家标准、行业标准、地方标准、团体标准、企业标准、标准化指导性技术文件）
    * 映射 styles.config 中的66+段落/字符样式到 DOCX 样式
    * 封面页生成（标准编号、名称、日期等）
    * 正文排版（页眉页脚、奇偶页、章节编号）
    * 表格、图片、公式的正确嵌入
    * 目次自动生成
*  PDF 导出
    * 方案A：基于 DOCX 的打印为 PDF
    * 方案B：基于排版后的 HTML，使用浏览器 print-to-pdf
    * 确保分页、页眉页脚正确
*  模板管理
    * 用户可选择标准类型模板
    * 模板预览
—————
Phase 6：智能校验（~1.5周）
目标：辅助用户写出规范的标准文件
*  格式一致性检查
    * 章节编号连续性
    * 标题层级正确性（不跳级）
    * 表/图编号连续性
    * 列表格式一致性
*  标准术语规范性检查
    * 常用标准化术语词库
    * 提示不规范用语并给出建议
*  引用与交叉引用检查
    * 检测悬空引用（引用的章节/表/图不存在）
    * 检测未被引用的参考文献
    * 规范性引用文件格式检查
*  校验结果面板
    * 侧边栏展示所有问题列表
    * 按严重程度分级（错误/警告/建议）
    * 点击问题跳转到对应位置
——————
Phase 7：优化与完善（~1周）
*  快捷键体系完善
*  撤销/重做优化
*  大文档性能优化（虚拟滚动等）
*  文档导入（从 DOCX 导入为编辑器格式）
*  暗色模式
*  用户引导/帮助文档

Phase 8：Markdown 语法支持（~1.5周）[P2]
目标：支持 Markdown 语法直接映射到标准条款，提供高效的纯键盘写作模式
*  Markdown 输入模式
    * 基于 TipTap Markdown 扩展，建立 Markdown 语法到自定义 Schema 节点的映射规则
    * `#` → Chapter，`##`~`######` → Clause（1~5级）
    * 普通段落 → StdParagraph
    * `-` / `*` → StdList，`1.` → 数字编号列表
    * `>` → Note / Example（通过上下文或前缀区分）
    * `![图题](url)` → Figure，表格语法 → StdTable
    * 公式语法（如 `$$...$$`）→ Formula
*  无题条的处理策略
    * 标准文件中存在大量无标题条款（如 `5.1`、`5.2` 只有编号没有标题）
    * Markdown 的 `##` 语法天然需要标题文字，无法直接表达无题条
    * 策略：忽略无题条的 Markdown 快速输入，用户通过 slash command 或工具栏插入无题条
*  Markdown 导入
    * 支持粘贴 Markdown 文本自动转换为 SES 文档结构
———————————

Phase 9：MCP / CLI 支持（~2周）[P2]
目标：提供编程接口，支持 AI Agent 和自动化工具操作 SES 编辑标准
*  SES CLI 工具（ses-cli）
    * 基于 Node.js 实现命令行工具，封装对后端 REST API 的调用
    * 核心命令：
        * `ses create` — 创建新标准文档
        * `ses open <id>` — 打开文档
        * `ses add chapter/clause/term/table/figure/appendix` — 添加文档要素
        * `ses edit <path>` — 编辑指定节点内容
        * `ses validate` — 执行校验
        * `ses export docx/pdf/xml` — 导出文档
        * `ses version create/list/diff` — 版本管理
    * 支持 JSON 输出模式（`--json`），便于脚本和 Agent 解析
*  MCP Server（Model Context Protocol）
    * 基于 NestJS 后端暴露 MCP 协议的 tool 接口
    * Tool 列表：
        * `create_document` — 创建标准文档（含元数据：标准号、ICS、CCS 等）
        * `get_document_structure` — 获取文档结构树
        * `add_chapter` / `add_clause` / `add_term` — 添加结构要素
        * `update_content` — 更新指定节点内容
        * `insert_table` / `insert_figure` — 插入表格/图
        * `validate_document` — 执行智能校验
        * `export_document` — 导出为 DOCX/PDF/XML
        * `get_validation_results` — 获取校验结果
    * MCP Server 和 CLI 共享同一层 service 逻辑，避免重复实现
    * 支持 Claude Code 等 Agent 通过 MCP 直接操作 SES
*  API 文档与示例
    * 提供 OpenAPI/Swagger 文档
    * 提供 Agent 使用示例（Claude Code / 其他 LLM Agent）
———————————

Phase 10：AI 集成（~3周）[P3]
目标：将 AI 能力深度集成到编辑系统中，提升标准编写效率和质量
*  DOCX 智能导入
    * 解析 DOCX 文件的段落样式，智能匹配到 SES Schema 节点
    * 样式识别策略：
        * 精确匹配：标准模板样式名（如"标题 1"→ Chapter，"正文"→ StdParagraph）
        * 模糊匹配：利用 LLM 识别非标准样式名的语义（如"章标题"、"一级标题"等变体）
        * 结构推断：根据编号格式、缩进层级、字体大小等特征推断节点类型
    * 导入预览与确认界面
        * 展示每个段落的识别结果和匹配置信度
        * 用户可手动调整不正确的映射
        * 支持保存自定义映射规则模板，复用于后续导入
    * 基于现有 convert 模块扩展
*  AI 侧边栏（对话式辅助编辑）
    * 在编辑器右侧嵌入 AI 对话面板
    * 上下文感知：
        * 将当前文档的 ProseMirror JSON 或 XML 序列化后作为 LLM 上下文
        * 支持选中文本片段作为聚焦上下文
        * 感知光标位置和当前编辑的章节/条款
    * 辅助能力：
        * 内容生成：根据用户描述生成条款草稿
        * 内容润色：改进术语用词、语句表达的规范性
        * 结构建议：根据标准类型建议文档结构
        * 校验解释：解释校验错误并给出修复建议
        * 术语查询：查找相关标准中的术语定义
    * 编辑指令执行：LLM 返回结构化编辑指令（插入/修改/删除节点），前端 apply 到编辑器
    * LLM 后端：支持配置不同的 LLM 提供商（OpenAI、Anthropic、本地模型等）
*  AI 辅助校验增强
    * 在 Phase 6 智能校验基础上，增加 LLM 驱动的深层校验
    * 语义一致性检查（如范围章与后续章节的一致性）
    * 术语使用一致性（全文范围内同一概念是否使用了不同表述）
———————————

Phase 11：跨平台安装包与多人协作（~4周）[P3]
目标：打包为独立安装包，支持开箱即用；支持服务器部署和多人协作
*  桌面安装包（Electron）
    * 使用 Electron 打包前端（Vue 3）+ 后端（NestJS）为桌面应用
    * 通过 electron-builder 生成安装包：
        * macOS：`.dmg`
        * Windows：`.exe` / `.msi`（使用 NSIS 或 WiX 安装器）
        * Linux：`.AppImage` / `.deb` / `.rpm`
    * 内置运行环境：
        * Node.js 运行时（Electron 自带）
        * better-sqlite3 作为默认本地数据库
        * LibreOffice（DOCX→PDF 转换）：
            * 方案A：内置 LibreOffice 精简版（体积较大但开箱即用）
            * 方案B：首次使用时引导安装，提供一键安装脚本
    * 中国用户适配：
        * 安装包分发：支持国内 CDN / 镜像站下载
        * 依赖安装（如 LibreOffice）：优先使用清华/中科大/阿里等国内镜像源
        * 安装向导支持中文界面
    * 自动更新机制（electron-updater）
*  服务器部署模式
    * 支持将后端部署为独立服务器（Docker 镜像 + docker-compose）
    * 数据库切换：
        * 单机模式：better-sqlite3（默认，零配置）
        * 服务器模式：PostgreSQL / MySQL（通过配置文件切换）
    * 部署文档：
        * Docker 一键部署脚本
        * 手动部署指南（适用于无 Docker 环境）
        * 提供 docker-compose.yml 模板（含数据库、后端、Nginx）
*  多人协作功能
    * 基于 TipTap Collaboration 扩展 + Yjs 实现实时协同编辑
    * WebSocket 服务器（基于 Hocuspocus 或自建）
    * 用户管理：
        * 注册/登录（账号密码 + 可选 SSO）
        * 角色权限：管理员、编辑者、审阅者、只读
    * 协作功能：
        * 实时光标/选区同步（显示协作者位置）
        * 评论与批注（行内批注 + 回复线程）
        * 修订模式（Track Changes，类似 Word 审阅功能）
        * 文档锁定（防止特定阶段被意外修改）
    * 通知与消息：
        * 文档变更通知
        * 评论/批注提醒
        * 版本阶段变更通知
