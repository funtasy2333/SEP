# 标准化文件编辑系统(Standards Editor System, SES)需求规格文档

> **2026-10-05 XML开发决策（用户确认）**：XML导入、导出只采用GB/T 46687.2—2026，完全切断GB/T 37967及SEP历史自定义XML，不开发兼容或转换器；独立NISO STS功能暂缓。JSON正文存储继续使用，原始数据不删除。实施范围及验收见 [Phase 5.5主计划](docs/dev-plan-phase-5.5.md) 和 [WP8 XML方案](docs/wp8-xml46687.md)。方案已修订，代码切换尚未实施。

> **2026-10-05 编辑器范围决策（用户确认）**：现阶段SES聚焦内容编写、文档结构、格式检查、引用管理及GB/T 46687.2 XML导入导出。GB/T 46687.1—2025、GB/T 46687.3—2026暂作背景资料，不增加实施或符合性目标，不扩大WP6/WP8，也不增加语义模型预留、技术指标抽取、对象/属性/关系建模、规则执行或检测结果判定任务。本文既有“语义”措辞在WP6/WP8中指文档要素、章条角色和XML字段含义；文档结构与交换完整性检查继续实施。

> **2026-10-14 协作模型与云端接入决策（用户确认）**：Phase 11 的多人协作主模型由「PR 式异步协作」改为「实时协同」（人与 AI 同时编辑同一份文档，修改实时可见），PR 式异步协作降为可选增强。原 WP9.4「AI 云端接入」并入 Phase 11，在服务器部署与用户管理之后实施。设计背景见 [WP9 人机共写方案](docs/wp9-ai-coauthoring.md)。

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
节点以标准文档语义及GB/T 1.1编写结构为基础，XML目标统一为GB/T 46687.2—2026；现有节点的语义补齐在Phase 5.5 WP6实施：
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
* 每个节点携带语义属性（id, type, level等），通过IR适配到新国标XML；TBX、MathML等不能假定与编辑器节点一对一
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
Phase 3：XML 序列化与结构化标注（旧XML规划已由Phase 5.5替换）
目标：ProseMirror JSON ↔ IR ↔ GB/T 46687.2—2026 XML双向转换，按WP6/WP8实施。
* XML导出：消费统一IR及Resolver，以 `standard/front/body/back` 表达元数据和全文，支持TBX、MathML、XHTML表格、引用及配套资源
* XML导入：解析/验证新国标XML及资源，经IR还原生产Schema；先完整校验再替换文档，保存重开保真
* 旧XML：37967和SEP早期格式均明确拒绝，不保留解析器、兼容选项或迁移任务
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
（2026-09-24 决策：**交付稿为 DOCX，PDF 仅供参考**。DOCX 从零生成 OOXML，不使用 docx.js，也不使用任何模板文件；此前参考的 .dotx 来自第三方编写工具的安装包，只作格式对照、不得随产品分发。实施规格见 docs/wp7-docx-delivery.md，以下原始条目中与此冲突的部分以该规格为准）
*  DOCX 导出（核心，~~使用 docx.js~~ 从零生成）
    * ~~映射现有6类 Word 模板~~ 6 类标准（国家标准、行业标准、地方标准、团体标准、企业标准、标准化指导性技术文件）的封面与版式按 GB/T 1.1-2020 自行实现
    * ~~映射 styles.config 中的66+段落/字符样式到 DOCX 样式~~ 样式表按 GB/T 1.1-2020 表 F.1 与附录 E 自行定义
    * 封面页生成（标准编号、名称、日期等）
    * 正文排版（页眉页脚、奇偶页、章节编号）
    * 表格、图片、公式的正确嵌入
    * 目次自动生成
*  PDF 导出
    * 方案A：基于 DOCX 的打印为 PDF
    * 方案B：基于排版后的 HTML，使用浏览器 print-to-pdf
    * 确保分页、页眉页脚正确
    * （现状：采用 IR → HTML → Vivliostyle 两遍构建；DOCX → LibreOffice → PDF 路径已废除）
*  模板管理（2026-09-24 变更：不再使用模板文件；「标准类型」只决定封面样式与编号前缀）
    * 用户可选择标准类型
    * ~~模板预览~~
—————
Phase 5.5：IR 中间表示与多渲染器重构
目标：以IR为枢纽统一输出，补齐新国标XML双向转换；WP6/WP8工期在原文/校验约定及数据模型差距明确后更新，不沿用原两周估算。
背景与动因：
*  编号逻辑在 docxExporter / htmlExporter / xmlSerializer 中重复实现三次，易不一致
*  早期 PDF 唯一路径为 DOCX → 服务端 LibreOffice，依赖重、跨平台脆弱（该路径现已废除）
*  现有导出器绑定浏览器 API（fetch/DOMParser/Blob），阻碍 Phase 9 CLI/MCP 的服务端导出
任务：
*  IR 双态设计（放 packages/shared，纯数据、平台无关）
    * Authoring IR：语义结构本体，不含编号（编号是派生数据），与 ProseMirror 文档一一对应；同时作为 Phase 10 AI 导入的 LLM 结构化输出契约（语义角色枚举封闭、可导出 JSON Schema）
    * Resolved IR：经 Resolver 解析后的渲染输入（编号、交叉引用文本、参考文献序号已就位）
    * 稳定nodeId终生不随编号改变，用于版本diff/合并、批注和AI寻址；导出xmlId由Resolver按GB/T 46687.2约定派生，通过labels关联。XML导入建立外部ID到内部nodeId映射，不能把显示编号用作内部身份
    * IR语义以GB/T 46687.2—2026正式文本为目标：章角色、无标题条、TBX多语种术语、MathML及式中说明、XHTML表格、图组/资源、注/示例、类型化文献、脚注/引用和索引。正文/示例的异写及DTD/XSD版本在WP8.1固定约定，不以旧草案或通用STS配置替代
*  Resolver（一次性结构解析，全系统唯一的编号实现）
    * 章/条/附录编号、图表/公式编号（附录内自动加字母前缀）
    * 注/示例编号规则：条款内单条不编号，多条编「注1/注2」（借鉴 ISO OSD，GB/T 1.1 同规则）
    * 交叉引用目标解析；参考文献按 GB/T 1.1 规则排序与编号
    * 编号策略实现为可配置策略对象（借鉴 OSD 项目级编号方案配置，适应不同标准类型）
    * 解析过程中产出结构问题报告（悬空段、编号断档、悬空引用等），供 Phase 6 持续质检复用
*  渲染器迁移（统一消费 Resolved IR）
    * WP6迁移JSON渲染并补齐IR/生产Schema、PM↔IR、引用/ID和资源数据；HTML等消费相同IR及Resolver
    * WP8只新增GB/T 46687.2—2026 XML双向实现：原文/校验约定、导出、导入、统一切换、真实流程及互操作验收。删除旧XML实现及所有调用fallback；独立NISO STS功能暂缓
    * ~~DOCX 模板填充渲染器（docxTemplateExporter）迁移~~（2026-09-24 变更：改为 WP7 系列从零生成 DOCX，docxTemplateExporter.ts 与 docxExporter.ts 直接删除，见 docs/wp7-docx-delivery.md）
    * DocMeta/StandardType 等类型迁至 packages/shared
    * JSON迁移保留golden回归；新XML按新国标语义、结构和资源保真验收，不保留旧XML字节一致性要求
*  PDF 渲染器（HTML + CSS Paged Media 分页引擎，替代 LibreOffice 路径）
    * 分页引擎首选 Vivliostyle（已确认）：原生支持 leader() 目次点线、GCPM 条文脚注、混合横竖页 PDF 输出（vivliostyle.js#751，2022 已实现）、CJK 排版（text-spacing / hanging-punctuation）；维护活跃
    * Paged.js 作为备选引擎；IR-HTML 渲染器保持引擎无关（输出语义 HTML + 打印样式表），引擎可替换
    * 横排宽表/宽图：IR 节点增加 orientation 属性，spike 中验证「命名页 landscape」与「竖排页内容旋转 90°」两种方案（纸质国标的页眉页码本就保持竖排）
    * 自动出件：vivliostyle-cli（Playwright/Chromium，npm 锁版本，跨平台一致）用于服务端与未来 CLI/MCP；浏览器内预览复用同一 HTML 渲染器
    * PDF 仅保留 Vivliostyle 版式预览；不再提供 LibreOffice 回退路径
*  先行 spike（1~2 天，全面投入前验收）
    * 毒场景清单：跨页长表（表头重复 +「表X（续）」续标题）、横排宽表、带编号公式、三级目次（点线 + target-counter 页码）、奇偶页眉镜像、前言/目次罗马页码与正文阿拉伯页码
    * 对照 GB/T 1.1 版式检查单逐项验收，通过后再迁移渲染器
*  测试补课
    * Resolver 单元测试（编号、附录、交叉引用、注/示例规则各情形）
    * 新XML→IR→生产Schema→保存重开→IR→新XML，规范化输出幂等及语义/资源保真；增加固定结构校验、旧格式拒绝、真实原文和独立互操作验收
——————
Phase 6：智能校验（~1.5周）
目标：辅助用户写出规范的标准文件
形态（借鉴 ISO OSD Content Quality Check）：校验规则基于 Phase 5.5 Resolver 的结构问题报告增量运行，编辑过程中以行内标记（警告图标 + 高亮）持续呈现，侧边面板仅作问题汇总视图
*  格式一致性检查
    * 悬空段检测：含子条款的条款不得直接挂正文（GB/T 1.1 悬置段规则；借鉴 OSD 提供「转为子条款 / 移动 / 删除」修复建议）
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
*  表格功能完善（已确认优先，对标 OSD）：单元格合并/拆分、行列增删、表头行标记（配合跨页重复与续表）、表内注/表脚注、单元格内文本格式
*  大纲条款级拖拽（已确认优先）：全层级拖拽排序与移级（Move up/down/left/right），带结构合法性校验，非法操作阻止并提示（借鉴 OSD）
*  快捷键体系完善
*  撤销/重做优化
*  大文档性能优化（虚拟滚动等）
*  文档导入（从 DOCX 导入为编辑器格式）
*  暗色模式
*  用户引导/帮助文档
（已确认延后：交叉引用插入 UI、上下文感知 Slash 过滤）

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
*  DOCX 智能导入（AI 解析 → Authoring IR 自动匹配）
    * 目标格式：Phase 5.5 的 Authoring IR；LLM 结构化输出受 IR JSON Schema 约束（角色枚举封闭，比直接生成 ProseMirror JSON 可靠）
    * 四步流水线（确定性优先、AI 兜底）：
        1. 确定性解析：解包 OOXML，提取「段落文本 + 样式名 + 缩进 + 编号文本 + 表格结构 + 图片」中间列表；公式经 OMML→LaTeX 独立处理器转换
        2. 混合分类：样式名精确命中官方模板的段落直接规则映射（零 AI 调用）；模糊段落分块送 LLM 判定语义角色，输出合法 IR 条目
        3. 规则校验 + 组装：层级合法性（PM schema content 约束）、悬空段/编号断档检测（复用 Phase 6 规则引擎）；剥离的原文编号作为「校验和」与 Resolver 重算编号逐条比对，不一致即标记待裁决（层级判错或原文编号本身有误）
        4. 导入预览确认：按置信度着色（规则命中=高 / AI 判定=中 / 编号不一致=待裁决），用户逐项修正后入库；支持保存自定义映射规则模板复用
    * 兜底路径（借鉴 ISO OSD）：结构先行 + 粘贴清洗 + 质检提示，用于 AI 解析失败或片段搬运场景
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
        * 后台配置skills和MCP，提供标准编辑skill、标准审查skill、标准库查询MCP等。
    * 编辑指令执行：LLM 返回结构化编辑指令（插入/修改/删除节点），前端 apply 到编辑器
    * LLM 后端：支持配置不同的 LLM 提供商（OpenAI、Anthropic、本地模型等）
*  AI 辅助校验增强
    * 在 Phase 6 智能校验基础上，增加 LLM 驱动的深层校验
    * 语义一致性检查（如范围章与后续章节的一致性）
    * 术语使用一致性（全文范围内同一概念是否使用了不同表述）
———————————

Phase 11：跨平台安装包与实时协同（~4周，范围已扩大，待重新估算）[P3]
目标：打包为独立安装包，支持开箱即用；支持服务器部署，以及多人与 AI 实时协同编辑
*  桌面安装包（Electron）
    * 使用 Electron 打包前端（Vue 3）+ 后端（NestJS）为桌面应用
    * 通过 electron-builder 生成安装包：
        * macOS：`.dmg`
        * Windows：`.exe` / `.msi`（使用 NSIS 或 WiX 安装器）
        * Linux：`.AppImage` / `.deb` / `.rpm`
    * 内置运行环境：
        * Node.js 运行时（Electron 自带）
        * better-sqlite3 作为默认本地数据库
        * PDF 版式预览使用 Vivliostyle 与 Poppler，不内置办公套件
    * 中国用户适配：
        * 安装包分发：支持国内 CDN / 镜像站下载
        * 依赖安装优先使用可用的国内镜像源
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
*  多人协作功能（2026-10-14 用户确认主模型：实时协同；PR 式异步协作降为可选增强）
    * 实时协同：多人与 AI 同时编辑同一份文档，修改实时可见
        * 技术路线：TipTap Collaboration + Yjs + WebSocket（Hocuspocus）；服务端持久化协同文档，并与 JSON 正文、版本记录保持一致
        * 协作感知：在线成员、各人的光标与选区
        * AI 参与：AI（MCP、Phase 10 编辑器内 AI 侧边栏）作为一个协同参与者写入，经同一个文档操作层；实时阶段替换操作层的内部实现（由「修订号 + 整篇保存」改为对协同文档执行操作），各入口的接口不变（见 WP9 方案）
        * 撤销只撤销自己的修改；断线期间的本地修改在重连后自动合并
        * 版本：手动与定期快照，版本记录标注参与者与来源（人 / AI）；diff 复用 Phase 4 版本比对能力，叠加 IR 结构化摘要（哪些章/条新增、修改、删除）
    * 修订与意见（与实时协同配合）：
        * 建议模式（Word 修订式）：修改以待接受的建议呈现，主笔人逐条接受或拒绝；AI 的修改可选择以建议方式提交
        * 批注评论锚定到具体节点（基于稳定节点 ID，Phase 5.5）
        * 领域加成：建议与评论的处理记录（提出人、修改内容、处理结果、理由）汇出《意见汇总处理表》，对接标准征求意见阶段的法定流程文档
    * 冲突预防：分章认领；条款级提示性锁定（防撞车提醒，非硬锁）
    * PR 式异步协作（可选增强）：协作者从主文档某一版本检出（fork）→ 在自己的工作区编辑 → 提交变更请求 → 主笔人审核 diff、处理意见 → 合并入主文档。适用于外部单位离线修改后提交的场景；合并策略沿用原方案（V1 变基制，V2 基于稳定节点 ID 的逐条修订与三方合并）
    * 用户管理：
        * 注册/登录（账号密码 + 可选 SSO）
        * 角色权限：主笔人、协作者、审阅者、只读
    * 文档阶段锁定（防止特定阶段被意外修改）
    * 通知与消息：
        * 建议、评论、@ 提醒
        * 建议接受/拒绝通知
        * 版本阶段变更通知
*  AI 云端接入（原 WP9.4，2026-10-14 并入本阶段；依赖上面的服务器部署与用户管理）
    * 远程 MCP 客户端（如 claude.ai 连接器）按 MCP 规范经 OAuth 授权接入；AI 的写入归属到授权用户，并受其角色权限约束
    * 导出文件的下载链接：存储与过期清理；关闭本地部署专用的「导出写到本机路径」
    * 云端部署前的安全收口：REST 接口全部纳入鉴权；HTML→PDF 接口限制外部地址抓取；变更推送支持多实例部署
