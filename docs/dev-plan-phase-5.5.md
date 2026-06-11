# Phase 5.5 开发计划：IR 中间表示与多渲染器重构

> **本文档的使用方式**：这是一份实施规格书，供执行开发的 AI 模型（或开发者）直接遵循。
> 架构决策、类型骨架、工作包边界和验收标准均已定稿，**执行时不要更改本文档定义的接口与约束**；
> 发现规格有矛盾或缺漏时，停下来向主导人报告，不要自行决定。
> 背景与需求出处见 [ses-requirements.md](../ses-requirements.md) 的 Phase 5.5 章节。
> 每个工作包（WP）对应一个独立分支与一次代码审查，按编号顺序执行（标注「可并行」的除外）。

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
          ┌──────────┬────────────┼────────────┬──────────────┐
          ▼          ▼            ▼            ▼              ▼
       XML 37967   JSON       语义 HTML     DOCX 模板填充   NISO STS XML
       渲染器       渲染器     +打印 CSS      渲染器          渲染器
                                  │
                                  ▼
                       Vivliostyle（浏览器预览 /
                       vivliostyle-cli 服务端出 PDF）
```

### 1.1 全局不变式（审查时逐条检查，违反即打回）

1. `packages/shared` 中的所有新代码**不得引用任何浏览器或 Node 专有 API**
   （无 `fetch`/`DOMParser`/`Blob`/`window`/`fs`/`path`），必须是同构纯 TypeScript。
2. **编号逻辑只存在于 Resolver**。任何渲染器中出现章/条/图/表/公式/注的计数器、
   编号拼接（如 `5.1.2`、`图A.1`）即为违规。渲染器只消费 `labels` 中的现成字符串。
3. 渲染器是**无状态纯函数**：`(doc, labels, options) => string`，同样的输入必须产出
   字节级相同的输出（DOCX zip 时间戳等不可避免项除外，需在测试中归一化）。
4. IR 必须可 `JSON.stringify` 往返无损（无类实例、无函数、无 `undefined` 字段语义依赖）。
5. 不引入本计划未列出的运行时依赖。如确有必要，先报告并说明理由，批准后再加。

---

## 2. IR 设计规范

### 2.1 双态模型

- **Authoring IR**：语义结构本体，与 ProseMirror 文档一一对应，**不含任何编号**。
  编号是派生数据。
- **Resolved 形态**：不复制树。`resolve()` 返回原 `doc` + `labels`（按 nodeId 索引的
  编号/标签映射）+ `problems`（结构问题报告）。渲染器消费 `(doc, labels)` 二元组。

### 2.2 核心类型骨架（packages/shared/src/ir/types.ts）

以下骨架为**定稿接口**，字段可按实现需要补充，已有字段不得改名、改型：

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
  // NISO STS sec-type 对齐：范围/规范性引用文件/术语和定义章需要特殊渲染
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
  // 「式中：」键值对（NISO STS: disp-formula > legend > def-list）
  whereList: { id: NodeId; term: IRInline[]; definition: IRInline[] }[]
}

export interface IRNote    { kind: 'note';    id: NodeId; content: IRBlock[] }
export interface IRExample { kind: 'example'; id: NodeId; content: IRBlock[] }

export interface IRTermEntry {
  kind: 'termEntry'; id: NodeId
  term: IRInline[]; termEn?: IRInline[]
  definition: IRBlock[]
  source?: IRInline[]        // 最多一个定义、最多一个来源（对齐 ISO OSD/NISO STS 约束）
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
  xmlId: string      // 导出 XML 用 ID，按 NISO 风格派生："sec_5.1.2" / "tab_A.1" / "formula_3"
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
- **导出 xmlId**（派生层）：`resolve()` 时按 NISO 风格从编号确定性派生
  （`sec_1`、`sec_5.1.2`、`sec_A`、`tab_1`、`fig_A.1`、`formula_3`、`bib_2`），
  存放于 `ResolvedLabel.xmlId`，渲染 XML 时使用。命名细节以
  `rules/` 下《标准机器语言表达 第2部分》附录 E 与 IEC/ISO Coding Guidelines 3.4 为准，
  **拿不准时查原 PDF，不要凭 OCR markdown 猜**。
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

### 2.5 IR 语义角色 ↔ NISO STS 元素速查（渲染器 WP8 的映射基准）

| IR | NISO STS（新国标草案） |
|---|---|
| IRDoc | `<standard>` + `<front>/<body>/<back>` |
| meta | `<std-meta>`（ics/ccs/title-wrap/std-ident/release-date…） |
| foreword / introduction | `<sec sec-type="foreword|intro">` |
| IRChapter(secType) | `<sec sec-type="scope|norm-refs|terms">`，普通章不带 sec-type |
| IRClause | 嵌套 `<sec>`；无标题条：只有 `<label>` 无 `<title>`（草案 5.3.3.6） |
| IRAppendix | `<app content-type="norm-annex|inform-annex">` + `<annex-type>` |
| IRTable | `<table-wrap>` + `<label>/<caption>` |
| IRFigure | `<fig>` + `<label>/<caption>/<graphic>` |
| IRFormula | `<disp-formula>` + `<label>` + `<mml:math>`；whereList → `<legend><def-list>` |
| IRNote | `<non-normative-note>` |
| IRExample | `<non-normative-example>` |
| IRTermEntry | `<term-sec>`（TBX 结构，以原 PDF 为准） |
| IRBibEntry | `<ref-list>` + `<ref><mixed-citation>` |
| crossRef | `<xref rid="...">` |

---

## 3. 工作包

> 预估总量约 2~2.5 周。WP0 与 WP1 可并行启动；WP4/WP6/WP7/WP8 在 WP3 完成后可并行。

### WP0：Vivliostyle 毒场景 spike（1~2 天，可与 WP1 并行）

- **产出**：`spike/vivliostyle-gbt11/` 目录：`index.html`（手写静态样例）、
  `print.css`、`README.md`（验收记录表）。不进入生产代码。
- **场景清单**（一项都不能少）：
  1. 三级目次：`leader('.')` 点线 + `target-counter` 页码；
  2. 前言/目次罗马页码（Ⅰ Ⅱ Ⅲ），正文从阿拉伯数字 1 重新起页；
  3. 奇偶页眉镜像（奇数页右侧标准号、偶数页左侧），页边距 上37/下35/左右28mm；
  4. 跨页长表：`<thead>` 重复 + 验证能否用 Vivliostyle 钩子注入「表X（续）」；
  5. 横排宽表两种方案对比：命名页 `size: A4 landscape` vs 竖排页内容 `rotate(90deg)`，
     记录哪种在 `vivliostyle build` 输出的 PDF 中正确；
  6. 带编号公式（KaTeX 渲染 + 编号右对齐 + 式中键值列表）；
  7. 章标题黑体 15pt / 正文宋体 12pt 等字体字号验证。
- **验收**：README 中逐项记录 通过/不通过/workaround，附输出 PDF 截图。
  **任何一项不通过先停下报告**，由主导人决定对策，不要自行换方案。
- 工具：`pnpm dlx @vivliostyle/cli build spike/vivliostyle-gbt11/index.html -o spike/out.pdf`

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

- **产出**：
  - `packages/shared/src/renderers/html.ts`：`renderHtml(doc, labels, opts): string`，
    语义 HTML（沿用现 htmlExporter 的 data-* 风格，nodeId 写入 `data-node-id`）；
  - `packages/shared/src/renderers/printCss.ts`：导出 GB/T 1.1 打印样式字符串
    （@page 版心/奇偶页眉/页码、目次 target-counter、字体栈宋体/黑体/Times New Roman）；
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

### WP6：XML(37967) 与 JSON 渲染器迁移（1.5 天，依赖 WP3）

- 先做 **golden 基线**：用 `example/sample-standard.xml` + 全要素 fixture 经现有
  `xmlSerializer`/`jsonExporter` 生成输出，存入 `packages/client/src/serializer/__fixtures__/golden/`。
- 迁移：`packages/shared/src/renderers/xml37967.ts`、`json.ts`，删除其中编号逻辑；
  client 侧改薄壳。
- **验收**：新输出 vs golden 逐字节一致（允许清单内的已知差异需在 PR 中逐条说明并获批准）；
  XML 往返测试：`parseXmlToJson(render(...))` 后再 render 一次输出幂等。

### WP7：DOCX 模板渲染器迁移 + 废弃 docxExporter（1.5 天，依赖 WP3）

- `DocMeta`/`StandardType` 迁至 shared（`IRDocMeta` 已覆盖则做类型别名过渡）；
- `docxTemplateExporter.ts` 改为消费 `(doc, labels)`，删除其内部编号上下文；
  模板 fetch 与 JSZip 保留在 client 层（浏览器依赖允许存在于 client）；
- golden 基线同 WP6（DOCX 解 zip 后比对 `word/document.xml`，时间戳字段归一化）；
- **删除 `docxExporter.ts`**（从零构建版，已确认废弃），清理 `serializer/index.ts` 导出。
- **验收**：golden 一致；Word/WPS 实际打开导出文件无报错（PR 附截图）。

### WP8：NISO STS / 新国标 XML 渲染器（2 天，依赖 WP3，可后置）

- `packages/shared/src/renderers/nisoSts.ts`，映射表见 2.5 节；
- 元数据、`sec-type`、无标题条、`disp-formula/legend/def-list`、`app content-type`、
  `ref-list/mixed-citation` 为必做项；MathML 转换（LaTeX→MathML）暂以
  `<tex-math>` 包裹原文输出并 TODO 标注，不引入转换依赖；
- 导出菜单增加「XML（NISO STS·征求意见稿）」入口，标注 beta。
- **验收**：全要素 fixture 输出经 XML well-formed 校验；标签用法与 `rules/` 原 PDF
  附录 C/D/E 抽查一致（PR 中列出抽查的 10 个标签及出处页码）。

---

## 4. 测试与回归策略汇总

| 层 | 工具 | 要求 |
|---|---|---|
| shared 单测 | vitest | Resolver ≥30 用例；渲染器快照测试；nodeId 唯一性 |
| golden 回归 | vitest + fixtures | WP6/WP7 迁移前先落 golden，迁移后比对 |
| XML 往返 | vitest | 37967：parse→render 幂等 |
| 端到端 | 手动 + PR 截图 | PDF 七场景、Word 打开 DOCX |

## 5. 工程与协作约定

1. **分支/PR**：每个 WP 一个分支 `feat/wp<N>-<slug>`，一个 PR；PR 描述必须含
   「验收标准逐项自查表」。审查通过才合并，审查意见必须逐条回应。
2. **允许新增的依赖**（已批准）：shared→vitest（dev）；server→`@vivliostyle/cli`、
   `playwright-chromium`。其余先问。
3. **不要顺手重构**：与本 WP 无关的代码不动（包括格式化）。发现问题记录在 PR 描述
   的「发现的问题」一节，由主导人决定是否另开任务。
4. **查证优先级**：GB/T 1.1-2020 原文 > `rules/` 原 PDF > OCR markdown > 任何模型记忆。
   读中文标准 PDF 用图像方式渲染阅读，不要相信文本提取结果。
5. 提交信息遵循仓库现有 conventional commits 风格（中文描述可）。

## 6. 后续阶段衔接（本计划不实施，仅供理解走向）

- Phase 6 持续质检直接消费 `ResolveResult.problems`，新增规则只在 Resolver/规则层扩展；
- Phase 9 CLI/MCP 复用 shared 渲染器 + vivliostyle-cli，无需新导出代码；
- Phase 10 AI 导入以 Authoring IR 为 LLM 输出契约（届时为 types.ts 补 JSON Schema 导出）;
- Phase 11 PR 协作依赖本阶段的 nodeId 与版本 diff。
