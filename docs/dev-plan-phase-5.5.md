# Phase 5.5 开发计划：IR 中间表示与多渲染器重构

> **本文档的使用方式**：这是一份实施规格书，供执行开发的 AI 模型（或开发者）直接遵循。
> 架构决策、类型骨架、工作包边界和验收标准均已定稿，**执行时不要更改本文档定义的接口与约束**；
> 发现规格有矛盾或缺漏时，停下来向主导人报告，不要自行决定。
> 背景与需求出处见 [ses-requirements.md](../ses-requirements.md) 的 Phase 5.5 章节。
> 每个工作包（WP）对应一个独立分支与一次代码审查，按编号顺序执行（标注「可并行」的除外）。
>
> **2026-09-30 后续决策**：DOCX → LibreOffice → PDF 转换预览及其安装引导已废除；下文涉及该回退路径的历史实施条目不再适用。PDF 仅保留 IR → HTML → Vivliostyle 两遍构建。
>
> **2026-10-05 XML 决策（用户确认）**：XML 导入、导出统一采用 **GB/T 46687.2—2026**，完全切断 GB/T 37967 和 SEP 历史自定义 XML；不保留旧格式解析、导出、兼容开关或迁移器。独立 NISO STS 功能暂不开发。WP6 改为 JSON 渲染迁移及新 XML 所需的数据模型补齐，WP8 改为新国标 XML 双向转换与统一切换。具体规格见 [WP8 XML 实施方案](wp8-xml46687.md)。本条是开发目标，代码切换尚未实施。

---

## 1. 架构总览

```
                    ┌────────────────────────────┐
                    │  Tiptap / ProseMirror 文档   │  packages/client
                    └─────────────┬──────────────┘
                                  │ pmToIr()（纯 JSON 变换）
                    ┌─────────────▼──────────────┐
                    │  Authoring IR（无编号）       │  packages/shared
                    └─────────────┬──────────────┘
                                  │ resolve(doc, strategy)
                    ┌─────────────▼──────────────┐
                    │  ResolveResult              │  packages/shared
                    │  = doc + labels + problems  │
                    └─────────────┬──────────────┘
          ┌──────────────┬────────────┼──────────────┐
          ▼              ▼            ▼              ▼
       XML 46687.2      JSON       语义 HTML       DOCX 包
       渲染器           渲染器     +打印 CSS        渲染器
                                  │
                                  ▼
                       Vivliostyle（浏览器预览 /
                       vivliostyle-cli 服务端出 PDF）
```

XML 导入走 `GB/T 46687.2 XML + 配套资源 → 解析/验证 → Authoring IR → irToPm → 编辑器`。
shared 只处理纯数据；DOM 解析、公式转换、文件和资源读取位于 client/server 适配层。旧 XML 的识别仅用于明确拒绝，不进行兼容解析。

### 1.1 全局不变式（审查时逐条检查，违反即打回）

1. `packages/shared` 中的所有新代码**不得引用任何浏览器或 Node 专有 API**
   （无 `fetch`/`DOMParser`/`Blob`/`window`/`fs`/`path`），必须是同构纯 TypeScript。
2. **编号逻辑只存在于 Resolver**。任何渲染器中出现章/条/图/表/公式/注的计数器、
   编号拼接（如 `5.1.2`、`图A.1`）即为违规。渲染器只消费 `labels` 中的现成字符串。
3. 渲染器是**无状态纯函数**：`(doc, labels, options) => string`，同样的输入必须产出
   字节级相同的输出（DOCX zip 时间戳等不可避免项除外，需在测试中归一化）。
4. IR 必须可 `JSON.stringify` 往返无损（无类实例、无函数、无 `undefined` 字段语义依赖）。
5. 不引入本计划未列出的运行时依赖。如确有必要，先报告并说明理由，批准后再加。
6. XML 只提供 GB/T 46687.2—2026 一种格式；正文内容、公式、引用或资源无法无损映射时，
   返回明确问题并阻止导入/导出，禁止静默跳过、降级为旧格式或以空文档覆盖原文。

> **2026-09-24 修订（DOCX）**：DOCX 渲染器对不变式 2、3、5 的适用方式已修订——章条等编号委托 Word 原生编号并以
> 一致性测试对齐 Resolver；返回 `DocxPackage` 纯数据而非 string；唯一新增依赖为 client 的 `mathml2omml@0.5.0`。
> 以 [wp7-docx-delivery.md](wp7-docx-delivery.md) §1.4 为准。

---

## 2. IR 设计规范

### 2.1 双态模型

- **Authoring IR**：语义结构本体，与 ProseMirror 文档一一对应，**不含任何编号**。
  编号是派生数据。
- **Resolved 形态**：不复制树。`resolve()` 返回原 `doc` + `labels`（按 nodeId 索引的
  编号/标签映射）+ `problems`（结构问题报告）。渲染器消费 `(doc, labels)` 二元组。

### 2.2 核心类型骨架（packages/shared/src/ir/types.ts）

以下是既有基础接口骨架；新XML所需扩展以第2.6节及WP8规格为准。
现有JSON正文已使用的字段保持语义，新增字段/节点须贯通生产Schema和全部消费边界；
确需调整已有字段时，在实施PR中列出存储及输出影响，不以旧XML兼容限制新模型：

```ts
export type NodeId = string  // 稳定内部 ID，见 2.3

export interface IRDoc {
  schemaVersion: 1
  meta: IRDocMeta
  front: { foreword: IRBlock[]; introduction: IRBlock[] }
  body: IRChapter[]
  appendices: IRAppendix[]
  bibliography: IRBibEntry[]
}

// 从现有 docxExporter.ts 的 DocMeta/StandardType 迁移而来并保持兼容
export interface IRDocMeta {
  title?: string; titleEn?: string; stdCode?: string
  icsCode?: string; ccsCode?: string
  standardType: 'gb' | 'industry' | 'local' | 'group' | 'enterprise' | 'guide'
  issuer?: string; applicant?: string
  publishDate?: string; implementDate?: string
}

export interface IRChapter {
  kind: 'chapter'; id: NodeId
  // GB/T 46687.2 sec-type：范围/规范性引用文件/术语和定义章需要特殊渲染
  secType: 'scope' | 'norm-refs' | 'terms' | 'general'
  title: IRInline[]
  children: IRChapterChild[]
}
export type IRChapterChild = IRClause | IRBlock | IRTermEntry

export interface IRClause {
  kind: 'clause'; id: NodeId
  level: 1 | 2 | 3 | 4 | 5
  titled: boolean            // 无标题条（GB/T 1.1 无题条）titled=false 且 title=[]
  title: IRInline[]
  children: IRClauseChild[]
}
export type IRClauseChild = IRClause | IRBlock | IRTermEntry

export interface IRAppendix {
  kind: 'appendix'; id: NodeId
  normative: boolean         // 规范性/资料性
  title: IRInline[]
  children: IRClauseChild[]
}

export type IRBlock =
  | IRParagraph | IRList | IRTable | IRFigure
  | IRFormula | IRNote | IRExample

export interface IRParagraph { kind: 'paragraph'; id: NodeId; content: IRInline[] }

export interface IRList {
  kind: 'list'; id: NodeId
  listType: 'dash' | 'number' | 'alpha' | 'roman' | 'romanUpper' | 'boxed'
  items: { id: NodeId; content: (IRParagraph | IRList)[] }[]
}

export interface IRTable {
  kind: 'table'; id: NodeId
  caption: IRInline[]; captionEn?: IRInline[]
  orientation: 'portrait' | 'landscape'   // 横排宽表
  headerRowCount: number                   // 跨页重复表头依据
  rows: IRTableRow[]
  notes: IRNote[]                          // 表注（表内注，编号独立于正文注）
}
export interface IRTableRow {
  id: NodeId
  cells: { id: NodeId; colspan: number; rowspan: number; content: IRBlock[] }[]
}

export interface IRFigure {
  kind: 'figure'; id: NodeId
  caption: IRInline[]; captionEn?: IRInline[]
  orientation: 'portrait' | 'landscape'
  src: string                // 资源引用（dataURL 或资源 key，与现状一致）
  notes: IRNote[]
}

export interface IRFormula {
  kind: 'formula'; id: NodeId
  latex: string
  numbered: boolean
  // 「式中：」键值对（GB/T 46687.2: disp-formula > legend > def-list）
  whereList: { id: NodeId; term: IRInline[]; definition: IRInline[] }[]
}

export interface IRNote    { kind: 'note';    id: NodeId; content: IRBlock[] }
export interface IRExample { kind: 'example'; id: NodeId; content: IRBlock[] }

export interface IRTermEntry {
  kind: 'termEntry'; id: NodeId
  term: IRInline[]; termEn?: IRInline[]
  definition: IRBlock[]
  source?: IRInline[]        // 基础术语字段；TBX 多语种及描述符扩展见 2.6
  notes: IRNote[]; examples: IRExample[]
}

export interface IRBibEntry { kind: 'bibEntry'; id: NodeId; content: IRInline[] }

// ---------- 行内 ----------
export interface IRInline {
  text: string
  marks?: IRMark[]
}
export type IRMark =
  | { type: 'bold' } | { type: 'italic' } | { type: 'underline' }
  | { type: 'sub' }  | { type: 'sup' }
  | { type: 'crossRef'; targetId: NodeId }   // 引用文本由 Resolver 解析，不存死文本

// ---------- Resolve 结果 ----------
export interface ResolveResult {
  doc: IRDoc
  labels: Record<NodeId, ResolvedLabel>
  problems: IRProblem[]
  bibliographyOrder: NodeId[]   // 按正文出现顺序
}
export interface ResolvedLabel {
  label: string      // 人读编号："5.1.2" / "表A.1" / "注2" / "(3)" / "附录B"
  xmlId: string      // 新国标 XML ID："sec_5.1.2" / "tab_A.1" / "formula_3"
  refText: string    // 交叉引用処的展示文本："5.1.2" / "表A.1" / "公式(3)"
}
export interface IRProblem {
  code: 'hanging-paragraph' | 'dangling-xref' | 'heading-skip'
      | 'duplicate-id' | 'missing-id' | 'empty-section'
  nodeId: NodeId | null
  severity: 'error' | 'warning'
  message: string    // 中文，面向最终用户
}
```

### 2.3 nodeId 规范（双层 ID，重要）

- **内部 nodeId**（稳定层）：节点创建时生成一次、终生不变的随机 ID
  （nanoid 风格 12 位字母数字，由 shared 提供 `generateNodeId()`，不引入 nanoid 依赖，
  用 `crypto.getRandomValues`/`globalThis.crypto` 同构实现）。
  作用：版本 diff/合并、批注锚定、AI 编辑指令寻址。**绝不由编号派生**（编号随增删变化）。
- **导出 xmlId**（派生层）：`resolve()` 时按 GB/T 46687.2 的 ID 约定从编号确定性派生
  （`sec_1`、`sec_5.1.2`、`sec_A`、`tab_1`、`fig_A.1`、`formula_3`、`bibref_2`），
  存放于 `ResolvedLabel.xmlId`，渲染 XML 时使用。命名细节以
  GB/T 46687.2—2026 正式文本正文和附录 E 为依据；正文/示例/附录的异写在 WP8.1
  固化统一的实现约定，**拿不准时查原 PDF，不要凭 OCR markdown 猜**。
- 两层通过 `labels` 映射关联，渲染器与协作功能各取所需。

### 2.4 编号策略接口（可配置）

```ts
export interface NumberingStrategy {
  chapter(seq: number): string                       // "5"
  clause(path: number[]): string                     // [5,1,2] -> "5.1.2"
  appendix(seq: number): string                      // 1 -> "附录A"（返回含"附录"前缀）
  appendixLetter(seq: number): string                // 1 -> "A"
  figure(seq: number, appendixLetter?: string): string   // "图1" / "图A.1"
  table(seq: number, appendixLetter?: string): string    // "表1" / "表A.1"
  formula(seq: number, appendixLetter?: string): string  // "(1)" / "(A.1)"
  // 注/示例：同一作用域内单条不编号，多条编号（GB/T 1.1 与 ISO 同规则）
  note(index: number, totalInScope: number): string      // "注：" / "注1："
  example(index: number, totalInScope: number): string   // "示例：" / "示例1："
  bibEntry(seq: number): string                          // "[1]"
}
export const gbT11Strategy: NumberingStrategy  // 默认实现，规则以 GB/T 1.1-2020 为准
```

固定规则（写进 Resolver，不属于策略）：图/表/公式在正文全文连续编号、不按章重置；
进入附录后按附录字母前缀重新计数；交叉引用解析失败产出 `dangling-xref` problem。

### 2.5 IR 语义角色 ↔ GB/T 46687.2—2026 元素速查

| IR | GB/T 46687.2—2026（细化及校验见 WP8.1） |
|---|---|
| IRDoc | `<standard>` + `<front>/<body>/<back>` |
| meta | `front/std-meta`（ics/ccs/title-wrap/std-ident；发布/实施日期语义分别映射） |
| foreword / introduction | `front/sec`，分别为 `sec-type="foreword"`、`"intro"` |
| IRChapter(secType) | `<sec>` 的 `sec-type` 分别为 `scope`、`norm-refs`、`terms`；普通章不带 sec-type |
| IRClause | 嵌套 `<sec>`；无标题条 `sec-type="numbered-paragraph"`，有 `<label>` 无 `<title>`（4.4.2.5） |
| IRAppendix | `back/app-group/app` + `<annex-type>`；规范性/资料性属性值存在原文异写，须由 WP8.1 固定 |
| IRTable | `<table-wrap>` + `<label>/<caption>` + XHTML `<table>`；表注/表脚注分开 |
| IRFigure | `<fig>` + `<label>/<caption>/<graphic xlink:href="…">`；含配套资源 |
| IRFormula / 行内公式 | `<disp-formula>` / `<inline-formula>` + `<mml:math>`；whereList → `<legend><def-list>` |
| IRNote | `<non-normative-note>` |
| IRExample | `<non-normative-example>` |
| IRTermEntry | `<term-sec>` 内 `<tbx:termEntry>/<tbx:langSet>/<tbx:tig>`；术语注/示例用 TBX 标签 |
| 引用文件 / IRBibEntry | `<ref-list>/<ref>`；标准用 `<std>`，其他文献用 `<mixed-citation>` |
| crossRef / 脚注 | `<xref ref-type="…" rid="…">`，目标 ID 唯一；脚注用 `<fn>` |
| 索引 | `back/index`，包括索引标题、分组、条目及参见 |
| XML 技术处理信息 | `standard/processing-meta`，与标准业务元数据分开 |

这张表不是完整内容模型。独立 NISO STS 入口暂缓；新国标所使用的 STS、MathML、TBX、XLink 技术仍在 WP8 范围内。

### 2.6 新国标的数据模型补齐（WP6，新增字段可扩展）

第2.2节是原有基础骨架，不能据此认为目前 IR 已覆盖新国标。以当前 `types.ts` 及生产
Schema 为基线，在保持已用字段语义的前提下增加新字段/节点，配套更新 PM↔IR、JSON、
Resolver 及消费这些数据的输出边界。需要改动既有接口时，在实施 PR 中明确列出影响。

| 数据领域 | 必须表达的内容 |
|---|---|
| 元数据 | 题名分段/多语种、编号组成、文本语言、发布机构、采用一致性、代替关系、版权；保留现有文件设置数据 |
| 术语 | TBX语言集、每语言多个术语组、词性/采用级别/术语类型/领域/来源、定义/注/示例；不得从中英文名称臆造描述符 |
| 公式 | 原生MathML及可用的LaTeX编辑源、行内/行间公式、公式注、“式中”及引用关系；保留不可逆的MathML原文 |
| 表/图及资源 | 单元格类型、跨度、单位、注/脚注、必要样式、宽度和方向；图组、图说明及可序列化资源清单 |
| 文本/引用/索引 | 变量、完整样式、警告/引文/代码、类型化文献、外链、术语间引用、索引条目与目标 |

新信息必须经过生产 Schema 保存、重开和 JSON 往返保持；无法表达的必做要素属于工作包未完成，
不能以扩展字段被忽略、只保存显示文字或只通过自家 XML 往返来替代。

---

## 3. 工作包

> 原总量估算属于初版计划。2026-10-05 扩展后的 WP6/WP8 不沿用原“1.5天/2天”估算；
> 当前后续顺序为 **WP6 → WP8.1～WP8.5**。WP8.1 的原文/校验约定准备可与 WP6 并行，
> 完整 XML 双向实现依赖 WP6 数据模型完成。工期在 WP8.1 明确实际差距后更新，不作为验收豁免。
>
> **2026-09-24 调整**：交付稿改为 DOCX、PDF 仅供参考。WP0–WP5 已完成，PDF 线停止投入；WP7 扩为
> WP7.1–WP7.6 系列并优先执行，WP6、WP8 后置。WP7 系列以 [wp7-docx-delivery.md](wp7-docx-delivery.md) 为准。

### WP0：Vivliostyle 毒场景 spike（1~2 天，可与 WP1 并行）

- **产出**：`spike/vivliostyle-gbt11/` 目录：`index.html`（手写静态样例）、
  `print.css`、`README.md`（验收记录表）。不进入生产代码。
- **场景清单**（一项都不能少）：
  1. 三级目次：`leader('.')` 点线 + `target-counter` 页码；
  2. 前言/目次罗马页码（Ⅰ Ⅱ Ⅲ），正文从阿拉伯数字 1 重新起页；
  3. 奇偶页眉镜像（奇数页右侧标准号、偶数页左侧），版式尺寸按本文档「GB/T 1.1
     版式规范（定稿）」执行（注意：不是 37/35/28/28 对称版心，那是旧 docxExporter
     的错误常量）；
  4. 跨页长表：`<thead>` 重复 + 验证能否用 Vivliostyle 钩子注入「表X（续）」；
  5. 横排宽表两种方案对比：命名页 `size: A4 landscape` vs 竖排页内容 `rotate(90deg)`，
     记录哪种在 `vivliostyle build` 输出的 PDF 中正确；
  6. 带编号公式（KaTeX 渲染 + 编号右对齐 + 式中键值列表）；
  7. 字号字体验证：章/条编号及标题五号黑体、条文五号宋体、前置标题三号黑体、
     表内文字小五宋体等，逐项按表 F.1。
- **验收**：README 中逐项记录 通过/不通过/workaround，附输出 PDF 截图。
  **任何一项不通过先停下报告**，由主导人决定对策，不要自行换方案。
- 工具：`pnpm --package=@vivliostyle/cli@11.0.1 dlx vivliostyle build spike/vivliostyle-gbt11/index.html -o spike/out.pdf`
  （版本锁定 11.0.1：spike 结论绑定该版本行为，升级须复验）

#### WP0 审查补充结论（2026-06-11，主导人实测定稿，约束 WP4/WP5）

1. **文档内部链接与命名横排页互斥（上游 bug，已实证）**：HTML 中存在任何
   `<a href="#…">` 内部链接时，Vivliostyle（CLI 11.0.1 / Core 2.43.1）输出的
   命名页 `size: A4 landscape` 失效、整本回落竖排。与 target-counter、leader、
   表格、嵌套命名页均无关（逐项二分排除）。
2. **`counter-reset: page` 与横排页可共存**（已实测）：正文页脚从 1 起编 + 横排页
   同时成立，前提是文档中无内部链接。
3. **目次页码与分区页码采用两遍构建**（决策一，定稿）：最终一遍的 HTML 不含任何
   内部链接与 target-counter，目次页码为注入的纯文本。
4. **「表X（续）」是 GB/T 1.1-2020 9.8.3 的规范性要求**（"随后接排该表的各页上应
   重复表编号，后接表题（可选）和'（续）'或'（第#页/共*页）'……续表均应重复表头和
   '关于单位的陈述'"）。V1 先落实表头 + 单位陈述重复，（续）标题进 V2（决策二，定稿）。
5. **spike 的版式参数（字号、页边距、页码位置等）不符合 GB/T 1.1 附录 E/F，
   不得作为 WP4 的样式基准**。spike 的价值在机制验证（分页引擎能力），版式参数
   一律以下方「GB/T 1.1-2020 版式规范（定稿）」为准。

#### GB/T 1.1-2020 版式规范（定稿，按原 PDF 图像页核定）

查证口径：

- 以 `rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf`
  渲染图像为准；该 PDF 含 FzBookMaker 私有字体，文本提取会乱码，仓库 OCR markdown
  只作条款定位索引。
- 引用出处按 GB/T 1.1-2020 的条、图、表编号记录；必要时按“PDF 物理页 =
  印刷页 + 7”定位原图像（例：印刷页 58 的表 F.1 为 PDF 第 65 页）。
- 标准封面和终结线素材以 `docs/素材/` 下已提取文件为准，避免重新绘制专用字、
  文件代号标志、发布机构和终结线。

页面布局（A4 210mm × 297mm）：

| 项 | 规定 | 出处 |
|---|---|---|
| 幅面 | A4，210mm × 297mm，允许公差 ±1mm；特殊情况下（如图、表不能缩小时）可按实际需要加宽和/或延长 | 10.1.1 |
| 完整出版顺序 | 封面（必备）→ 目次（可选）→ 前言（必备）→ 引言（可选）→ 正文 → 附录 → 参考文献 → 索引。封面渲染必须按 10.3.1、图 E.5/E.6/E.7、表 F.1 #01-13，并复用 `docs/素材/` 中的封面素材；如某次 print 变体暂从目次开始，PR 必须列为范围差距 | 6.2.2、8.1、8.2、9.6.2、10.3.1 |
| 书眉文件编号 | 距纸顶 25mm；单数页右对齐、双数页左对齐；五号黑体；**无下划线**（图 E.1/E.2 及标准正文实页书眉均无下划线；原"短下划线"为误记，2026-06-15 对照原件订正）；从目次页起每页编排 | 图 E.1/E.2、10.1.3、表 F.1 #47 |
| 版心 | 书眉编号下方空 5mm 起；**单数页左 25mm / 右 20mm，双数页左 20mm / 右 25mm（镜像）** | 图 E.1/E.2 |
| 页码 | 版心外侧下角（单数页右下、双数页左下）；距纸底 20mm、距外侧纸边 24mm；小五号宋体 | 图 E.1/E.2、10.1.3、表 F.1 #48 |
| 页码分区 | 目次页起用正体大写罗马数字（Ⅰ Ⅱ Ⅲ…）；正文首页起用阿拉伯数字从 1 另编 | 10.1.3 |
| 正文首页 | 必须从**单数页**开始；必要时插入空白页，空白页不印书眉、页码或正文但参与物理分页；书眉编号下空 15mm 排文件名称（三号黑体居中，名称多元素间空一个汉字，**print 只输出中文名称**，英文译名只在封面，表 F.1 #09），名称下空 12mm 排「1 范围」 | 10.1.4、图 E.3、表 F.1 #20 |
| 目次/前言/引言 间距 | 书眉下空 **15mm** 排标题（"目次"/"前言"/"引言"，三号黑体居中），标题下空 **12mm** 排首行内容；前言、引言均另起一面 | 图 E.8/E.9、10.3.2、10.3.3 |
| 参考文献/索引 | 均另起一面；标题居中；参考文献格式按图 E.10，索引格式按图 E.11 | 10.3.6、图 E.10/E.11 |
| 附录 | 每个附录均另起一面；“附录A”“（规范性）/（资料性）”“附录标题”三行分别居中 | 9.6.2、10.4.1、图 E.12 |
| 末页终结线 | 文件最后一个要素内容之下必须有终结线：居中粗实线，长度为版心宽度 1/4（版心 165mm 时约 41mm）；必须与最后一个要素内容在同一页，不准另起一面。实现时使用 `docs/素材/终结线.jpg`，按 1/4 版心宽缩放 | 10.1.5 |

字号字体（表 F.1 摘录；pt 为换算值）：

| 用途 | 字体 | 字号 | 出处 |
|---|---|---|---|
| 封面国家标准称谓“中华人民共和国国家标准” | 宋体，加粗 | 一号（26pt） | 表 F.1 #06 原列“专用字”，按原件核定 |
| 封面行业标准称谓“中华人民共和国××行业标准” | 黑体 | 小一（24pt） | 表 F.1 #07 原列“专用字”，按原件核定 |
| 封面文件名称 | 黑体 | 一号 | 表 F.1 #08 |
| 封面英文译名、一致性程度标识、发布日期/实施日期 | 黑体 | 四号 | 表 F.1 #09-11 |
| 目次/前言/引言的标题行 | 黑体 | 三号（16pt） | 表 F.1 #14/#16/#18 |
| 目次/前言/引言内容 | 宋体 | 五号（10.5pt） | 表 F.1 #15/#17/#19 |
| 正文首页文件名称 | 黑体 | 三号（16pt） | 表 F.1 #20 |
| 正文首页重要提示及其内容 | 黑体 | 五号（10.5pt） | 表 F.1 #21 |
| 章、条编号及标题 | 黑体 | **五号（10.5pt，与正文同字号）** | 表 F.1 #33 |
| 条文、列项及其编号 | 宋体 | **五号（10.5pt，不是 12pt）** | 表 F.1 #34 |
| 术语条目编号、术语及英文对应词 | 黑体 | 五号 | 表 F.1 #22/#23 |
| 术语条目内容、标明来源的“来源” | 宋体 | 五号 | 表 F.1 #24/#35 |
| 附录编号 /（规范性）（资料性）/ 附录标题（三行） | 黑体 | 五号 | 表 F.1 #25-27 |
| 附录内容 | 宋体 | 五号 | 表 F.1 #28 |
| 参考文献/索引标题行 | 黑体 | 五号（注意：不用三号） | 表 F.1 #29/#31 |
| 参考文献/索引内容 | 宋体 | 五号 | 表 F.1 #30/#32 |
| 图/表编号及图题/表题 | 黑体 | 五号 | 表 F.1 #36 |
| 分图编号、分图题 | 黑体 | 小五 | 表 F.1 #37 |
| 续图/续表「（续）」「（第#页/共*页）」 | 宋体 | 五号 | 表 F.1 #38 |
| 图、表右上方「关于单位的陈述」 | 宋体 | 小五（9pt） | 表 F.1 #39 |
| 图中的数字和文字 | 宋体 | 六号（7.5pt） | 表 F.1 #40 |
| 表中的数字和文字 | 宋体 | 小五（9pt；以表形式编写的术语标准表内文字用五号） | 表 F.1 #40 注 a |
| 「注：」「注X：」「示例：」「示例X：」标识 | 黑体 | 小五（9pt） | 表 F.1 #41/#43 |
| 注、示例、脚注的内容 | 宋体 | 小五（9pt） | 表 F.1 #42/#44/#45 |
| 书眉文件编号 | 黑体 | 五号 | 表 F.1 #47 |
| 页码 | 宋体 | 小五 | 表 F.1 #48 |

其他排版规则：

- **封面素材**（10.3.1、图 E.5/E.6/E.7）：文件代号标志使用 `docs/素材/GB标志.png`、
  `docs/素材/DB标志.tiff`、`docs/素材/Q标志.tif`；国家标准发布机构使用
  `docs/素材/国家标准发布机构.tiff`；不得用普通文本或临摹 SVG 替代这些专用素材。
- **封面文字**（10.3.1、表 F.1 #01-13）：应标明文件名称、层次/类别、文件代号、
  文件编号、ICS、CCS、发布日期、实施日期、发布机构等；国家标准、行业标准封面还应标明英文译名。
  国家标准称谓“中华人民共和国国家标准”按宋体一号加粗排，行业标准称谓“中华人民共和国××行业标准”
  按黑体小一排；文件名称多行时行距 3mm；文件编号中代号与顺序号之间空半个汉字，顺序号与年份号之间用一字线形式连接。
- **章、条和段**（10.2.1）：章/条编号顶格起排，编号后空一个汉字接标题；章编号和标题单独占一行、上下各空一行；条编号和标题单独占一行、上下各空半行；段首空两个汉字起排，回行顶格。
- **无标题条**（10.2.1）：条编号顶格起排（不缩进），编号后空一个汉字接排条文。
- **列项**（10.2.2）：第一层次破折号或字母编号空两个汉字起排，后续文字和回行位于版心左边第 5 个汉字；第二层次间隔号或数字编号空四个汉字起排，后续文字和回行位于第 7 个汉字。
- **术语条目**（10.3.5、表 F.1 #22-24）：条目编号单独占一行、顶格、上下无空行；术语与英文对应词同一行（术语后空一个汉字接英文对应词，除原文需要外英文小写，均五号黑体）；定义/来源/注/示例各项另行、空两个汉字起排（五号宋体）。
- **目次编排**（10.3.2、图 E.8）：第一层次条空 1 个汉字、第二层次条空 2 个汉字起排；标题与页码之间由"……"点线连接、**页码右对齐紧贴版心右缘、不加括号、点线直抵页码（不留大间隙）**；
- **规范性引用文件/参考文献清单**（10.3.4、10.3.6）：每项空两个汉字起排，回行顶格，文件之后不加标点；文件编号或“（所有部分）”与文件名称之间空一个汉字；参考文献序号与文件编号之间也空一个汉字。
- **正文首页文件名称、图题、表题**：GB/T 1.1-2020 只给出正文首页中文文件名称和中文图题/表题版式；英文译名仅在封面列为表 F.1 #09。print 变体不输出正文首页英文名、英文图题、英文表题；screen 预览可保留 IR 中的英文数据。
- **图/表基本编排**（10.4.2）：每幅图与其前面的条文、每个表与其后面的条文之间宜空一行；图编号/表编号后空一个汉字接图题/表题；图题置于图下方居中，表题置于表上方居中；图题/表题上下各空半行。
- **图/表转页接排**（9.7.3、9.8.3、表 F.1 #38）：续图、续表页应重复编号，可接题名，并追加“（续）”或“（第#页/共*页）”；续图重复“关于单位的陈述”，续表重复表头和“关于单位的陈述”。WP4 V1 未实现续题时必须在 PR 中列为已知差距，最终出版能力不得遗漏。
- **表格线和表内内容**（10.4.2.2、9.8.4）：表外框线、表头框线以及表中的注/表脚注所在框线均为粗实线；表内段落宜空一个汉字起排、回行顶格；数字宜居中并按个位或小数点对齐；空单元格用一字线形式的连接号表示；表中所有量单位相同时，右上方用“单位为……”替代各栏单位符号。
- **数学公式**（9.9.2、10.4.3）：公式另行居中；编号右端对齐，公式与编号之间用点线引导；较长公式按 =、+、−、±、⊥ 等符号之后优先回行；“式中：”空两个汉字起排并单独占一行，释义各行空两个汉字，用破折号连接且各行破折号对齐。
- **注、脚注、图脚注、表脚注**（10.4.4）：注均另行空两个汉字起排，回行与注内容文字位置左对齐；条文脚注文字和回行置于版心左边第 5 个汉字，脚注分隔细实线长度为版心宽度 1/4；图脚注置于版心左边第 4 个汉字，表脚注置于表左框线第 4 个汉字。
- **示例**（10.4.5）：示例另行空两个汉字起排；“示例：”或“示例X：”宜单独占一行；文字类示例回行宜顶格；用于区分示例的线框为细实线。
- 层次编排、要素编排的逐条细节见 `rules/` 下 GB/T 1.1-2020 OCR markdown
  第 10 章（10.2 层次的编排、10.3 要素的编排、10.4 要素表述形式的编排），
  WP4 实施时逐条对照，OCR 有疑义处以原 PDF 为准（图像方式阅读）。

### WP1：shared 包 IR 类型 + nodeId 工具 + 测试基建（1 天）

- **产出**：
  - `packages/shared/src/ir/types.ts`（第 2.2 节骨架的完整版）；
  - `packages/shared/src/ir/nodeId.ts`（`generateNodeId()`，同构）;
  - `packages/shared/src/ir/index.ts` 导出；
  - shared 包接入 vitest（`packages/shared/vitest.config.ts`），`pnpm -F shared test` 可跑。
- **验收**：类型编译通过；nodeId 生成 10 万次无碰撞测试；不变式 1/4/5 满足。

### WP2：nodeId 进 Tiptap Schema（0.5 天，依赖 WP1）

- **修改**：`packages/client/src/extensions/nodes/*.ts` 全部块级节点增加
  `attrs: { nodeId: { default: null } }`，`renderHTML` 写 `data-node-id`，`parseHTML` 读回。
- 新增 ProseMirror plugin（`extensions/plugins/ensureNodeId.ts`）：
  事务后扫描，给缺 nodeId 的块级节点补 ID；**粘贴产生的重复 nodeId 必须重新生成**
  （同文档内 ID 唯一是硬约束）。
- **验收**：新建/粘贴/拆分节点后文档内 nodeId 全部存在且唯一（写成插件单测）；
  旧文档打开后自动补齐 ID 不报错。

### WP3：pmToIr 转换器 + Resolver（3 天，依赖 WP1/WP2）

- **产出**：
  - `packages/shared/src/ir/pmToIr.ts`：输入 ProseMirror JSON（纯对象，**不依赖
    @tiptap 包**，按 `type` 字符串分发），输出 `IRDoc`。未知节点类型收集进警告列表返回。
  - `packages/shared/src/ir/resolve.ts`：`resolve(doc, strategy = gbT11Strategy): ResolveResult`。
  - `packages/shared/src/ir/strategies.ts`：`gbT11Strategy`。
- **Resolver 必须覆盖**：章/条编号（含无题条）、附录字母、图/表/公式全文连续编号 +
  附录前缀、注/示例单条不编号多条编号（作用域 = 最近的条或章）、表内注独立计数、
  交叉引用解析（`refText`）、参考文献按出现顺序、xmlId 派生（2.3 节）、
  problems 产出（hanging-paragraph：有子条的条/章直接含正文段；heading-skip：层级跳级；
  dangling-xref；duplicate-id）。
- **测试（重点投入，目标 ≥30 个用例）**：`packages/shared/src/ir/__tests__/`，
  手工构造的 PM JSON fixture 覆盖每条编号规则与每种 problem。
  fixture 中必须包含一个「全要素文档」（每种节点至少出现一次），后续 WP 复用。
- **验收**：全部测试通过；同一输入两次 resolve 输出深度相等（纯函数）。

### WP4：HTML 渲染器 + GB/T 1.1 打印样式（3 天，依赖 WP3，可与 WP6/7/8 并行）

- **开工首日先行验证**（10 分钟微测试，不通过立即报告）：
  `break-before: right`（正文首页单数页起排）+ `@page :blank`（空白页计数不印）+
  `counter-reset: page`（正文从 1 起编）三者组合在 vivliostyle build 下的行为——
  该组合落在 spike 已发现的命名页计数 bug 邻域，是版式规范中唯一未经 spike
  验证的机制（镜像版心、外侧页码 margin box、书眉（五号黑体、无下划线）均为标准用法，无需预验证）。
- **产出**：
  - `packages/shared/src/renderers/html.ts`：`renderHtml(doc, labels, opts): string`，
    语义 HTML（沿用现 htmlExporter 的 data-* 风格，nodeId 写入 `data-node-id`）；
  - `packages/shared/src/renderers/printCss.ts`：导出 GB/T 1.1 打印样式字符串，
    全部尺寸与字号**严格按 WP0 节末「GB/T 1.1-2020 版式规范（定稿）」表执行**
    （镜像版心、外侧下角页码、书眉（五号黑体、无下划线）、五号正文等；目次页码不用 target-counter，
    由 WP5 两遍构建注入）；字体栈宋体/黑体 + Times New Roman 西文；
    渲染器须按「封面（启用时）→ 目次 → 前言 → 引言 → 正文」输出前置页顺序；
    封面启用时必须使用 `docs/素材/` 中的封面素材，若暂不输出封面需在 PR 中列为范围差距；
    正文首页置入文件名称（三号黑体）并保证从单数页开始；
  - 公式：KaTeX 渲染**不在 shared 做**（KaTeX 依赖 DOM 字体度量不可靠），HTML 中输出
    `<span class="ses-formula" data-latex="...">`，由消费端（client 预览页/出件管线）渲染。
  - 横排内容容器：采用命名页方案（WP0 方案A），旋转方案已废弃。
  - **打印变体 HTML 不得含内部链接**（WP0 审查结论 1）：`renderHtml` 增加
    `variant: 'screen' | 'print'`。print 变体中交叉引用输出纯文本（labels.refText），
    目次条目不带 `<a>`，页码列输出固定宽度占位元素
    `<span class="toc-page" data-target="...">　</span>`（由 WP5 注入数字，占位与
    成品宽度一致以保证两遍构建分页不漂移）；screen 变体保留链接供预览/语义导出。
  - 表的「关于单位的陈述」与表头一并纳入可重复的表头结构（thead），满足
    GB/T 1.1 9.8.3 续表重复表头和单位陈述的要求；「表X（续）」本期不实现
    （已知差距，出处 9.8.3，进 V2）。
- **替换**：`packages/client/src/serializer/htmlExporter.ts` 改为薄壳调用 shared 渲染器
  （保留原导出菜单行为）。
- **验收**：全要素 fixture 渲染输出快照测试；旧 htmlExporter 输出与新输出的语义等价性
  人工 diff 记录在 PR 描述中（编号必须逐个一致）。

### WP5：PDF 出件管线（2.5 天，依赖 WP4 + WP0 结论）

- **服务端**：`packages/server/src/convert/` 新增 `POST /api/convert/html-to-pdf`，
  内部为**两遍构建管线**（WP0 审查结论 3，决策一定稿）：
  1. KaTeX 预渲染：`katex.renderToString(latex, { output: 'html' })` 替换
     `.ses-formula` 占位，内联 KaTeX 核心 CSS（字体内嵌或系统回退，禁用 CDN）；
  2. 第一遍 `vivliostyle build`（print 变体 HTML，目次页码为占位符）；
  3. 页码提取：用 poppler `pdftotext` 按页扫描，定位各目次目标的标题文本所在页
     （标题文本 + data-target 唯一对应；分区页码 = 物理页 − 分区起始页 + 1）；
  4. 注入：将页码以纯文本写入 `.toc-page` 占位元素；
  5. 第二遍 `vivliostyle build` 产出最终 PDF（占位定宽保证与第一遍分页一致，
     实现时须断言两遍页数相同，不一致即报错返回）。
  页脚分区编号用 `counter-reset: page`（front 罗马 / body 阿拉伯，
  已实测与横排命名页共存）。调用方式优先编程 API，不可用则 execFile。
  依赖加入 server package（`@vivliostyle/cli`、`katex`、playwright-chromium 锁版本，
  poppler 作为系统依赖检测并给出安装指引）。
- **客户端**：导出面板 PDF 卡片改走 IR→HTML→新端点；原 LibreOffice 路径改为
  第二张卡片「高保真（Word 排版）」，`ConvertService` 未检测到 LibreOffice 时隐藏。
- **验收**：全要素 fixture 一键导出 PDF 成功；WP0 七个场景在真实管线复验通过；
  LibreOffice 未安装的环境不再出现报错弹窗。

### WP6：JSON 渲染迁移与新国标数据模型补齐（依赖 WP3）

- 用当前生产 JSON 导出器和全要素文档建立 JSON golden；迁移为
  `packages/shared/src/renderers/json.ts`，client 改薄壳，编号只消费 Resolver。
- 按第2.6节补齐 IR、生产 Schema、PM→IR 及新增 `irToPm` 双向适配；记录字段、
  默认值、JSON存储版本、引用关联和新增信息对 DOCX/HTML 消费边界的影响。
- 补齐新国标ID派生及术语、文献、索引等引用目标；导入XML的外部ID映射到稳定内部nodeId，
  导出仍采用统一xmlId；不得以显示编号替代内部ID。
- 列出所有现有XML调用入口和XML依赖的存储/版本路径，交由WP8统一切换；只读盘点旧XML存量。
  不迁移旧XML渲染器，不新增 `xml37967.ts`，不开发旧XML解析或转换器。
- **验收**：原有JSON行为按golden回归，新增语义字段按明确扩展契约验证；新要素经
  `生产Schema → PM → IR → PM → 保存重开` 和JSON往返无损，引用及编号一致。
  旧XML字节一致性不再作为验收要求。既有生产旧XML实现只允许存续到WP8统一切换，不能作为新接口继续扩展。

### WP7：DOCX 交付稿（已由 WP7 系列取代）

> **2026-09-24 起本节作废**，改为 WP7.1–WP7.6 系列，完整规格见 [wp7-docx-delivery.md](wp7-docx-delivery.md)。要点：
> DOCX 为交付稿、**从零生成、不使用任何模板文件**（仓库中的 `.dotx` 为第三方工具模板，只作格式对照、不得分发）；
> 编号「可编辑优先」（Word 原生编号 + 一致性测试）；现有 `docxTemplateExporter.ts`/`docxExporter.ts` 在 WP7.1
> 直接删除，不再做迁移，也不做 golden 比对。

### WP8：GB/T 46687.2—2026 XML 双向转换与旧格式切断（依赖 WP6）

实施详情及逐项验收见 [wp8-xml46687.md](wp8-xml46687.md)，按以下阶段分支/审查：

1. **WP8.1 原文、映射与校验约定**：正式文本条款矩阵、原文异写的统一约定、DTD/XSD及扩展规则、真实样稿来源；固定支持范围和缺口。
2. **WP8.2 导出**：`packages/shared/src/renderers/xml46687.ts`，消费IR/labels及预处理MathML、资源清单；完整表达第4～10章的必做要素。
3. **WP8.3 导入**：client解析适配→shared纯数据映射→IR→生产Schema；资源、MathML、TBX、ID/引用保真，先完整校验再替换文档。
4. **WP8.4 统一切换**：XML上传/下载、源码查看/复制、版本快照和其他调用统一新格式；删除旧实现、旧菜单/开关及兼容测试，明确拒绝旧XML。
5. **WP8.5 验收**：语法、结构校验、语义/资源完整性、正负例、生产流程、真实标准原文及独立互操作验证。

不得以 `<tex-math>` TODO、只通过well-formed或只抽查10个标签宣称完成；独立NISO STS渲染器/入口暂不开发。

---

## 4. 测试与回归策略汇总

| 层 | 工具 | 要求 |
|---|---|---|
| shared 单测 | vitest | Resolver ≥30 用例；渲染器快照测试；nodeId 唯一性 |
| JSON golden 回归 | vitest + fixtures | WP6固化原有JSON语义；新增字段有明确扩展契约，不保留旧XML golden |
| 新国标 XML 往返 | vitest + fixtures | 46687.2：XML→IR→生产Schema→保存重开→IR→XML，语义/资源保真及规范化输出幂等 |
| XML 结构/语义 | 固定DTD/XSD及项目语义校验 | 命名空间、元素/属性模型、唯一ID、引用、日期、TBX/MathML、配套资源；版本和约定记录见WP8.1 |
| 旧格式拒绝 | vitest + 浏览器流程 | 真正37967及SEP旧XML均拒绝；不清空当前文档，不写入失败导入，不回退到旧解析器 |
| 端到端 | 手动 + PR 截图 | PDF 七场景、Word 打开 DOCX |
| 新XML互操作 | 原文核对 + 独立校验/实现 | 真实标准稿的全要素核对；不能只以自家parser/renderer互相通过认定符合性 |

## 5. 工程与协作约定

1. **分支/PR**：每个 WP 一个分支 `feat/wp<N>-<slug>`，一个 PR；PR 描述必须含
   「验收标准逐项自查表」。审查通过才合并，审查意见必须逐条回应。
2. **允许新增的依赖**（已批准）：shared→vitest（dev）；server→`@vivliostyle/cli`、
   `playwright-chromium`。新XML公式预处理优先复用client现有KaTeX，不在shared引入DOM/Node依赖；
   DTD/XSD校验工具和版本在WP8.1记录。确需新增运行时依赖时仍按不变式5处理。
3. **不要顺手重构**：与本 WP 无关的代码不动（包括格式化）。发现问题记录在 PR 描述
   的「发现的问题」一节，由主导人决定是否另开任务。
4. **查证优先级**：`rules/` 下 GB/T 1.1-2020 原 PDF 的渲染图像页 > 仓库 OCR markdown
   （仅作条款定位）> 任何模型记忆。读中文标准 PDF 用图像方式渲染阅读，不要相信文本提取结果。
   XML规格以GB/T 46687.2—2026正式原文为准，不用旧征求意见稿、37967或通用STS配置替代；
   来源与原文异写的处理依据必须进入WP8.1交付记录。
5. 提交信息遵循仓库现有 conventional commits 风格（中文描述可）。

## 6. 后续阶段衔接（本计划不实施，仅供理解走向）

- Phase 6 持续质检直接消费 `ResolveResult.problems`，新增规则只在 Resolver/规则层扩展；
- Phase 9 CLI/MCP 复用 shared 渲染器 + vivliostyle-cli，无需新导出代码；
- Phase 10 AI 导入以 Authoring IR 为 LLM 输出契约（届时为 types.ts 补 JSON Schema 导出）;
- Phase 11 PR 协作依赖本阶段的 nodeId 与版本 diff。
