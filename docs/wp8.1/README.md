# WP8.1 原文、映射与校验约定：总索引

状态：2026-10-20 分片完成，**关键约定待用户确认**。在约定确认之前，WP8.2～8.5 不开工。
规格：[Phase 5.5 主计划](../dev-plan-phase-5.5.md) §3 WP8、[WP8 XML 实施方案](../wp8-xml46687.md)。

## 1. 文件

| 文件 | 内容 |
|---|---|
| [source-record.md](source-record.md) | 原文来源、SHA-256、页码换算（PDF 页 = 印刷页 + 4）、可读性检查、与征求意见稿的关系 |
| [conventions-S.md](conventions-S.md) | 第 4～5 章、附录 E/F/G：约定 C-S-01～37；xmlId 约定 X-01～26 及 Resolver 改动 R-1～9；校验包需求；原文矛盾清单；待决事项 D-S-01～13；旧格式判别特征 |
| [conventions-T.md](conventions-T.md) | 第 6～10 章：约定 C-T-01～56、原文不一致 F-T-01～23、待决事项 D-T-01～11、IR 差距 G-T-01～22 |
| [matrix-S.json](matrix-S.json)、[matrix-T.json](matrix-T.json) | 支持矩阵，共 391 行，id 全局唯一，字段定义见下 |
| `rules/GBT 46687.2-2026 …pdf` 及 OCR 稿 | 正式原文（扫描件 76 页）。OCR 稿只用于定位条款，所有结论以页面图像为准 |

矩阵字段：`id`、`domain`、`path`、`element`、`attributes[]`、`obligation`（shall/should/may/example-only）、`clause`、`printedPage`、`pdfPage`、`verifiedAgainstImage`、`irPath`、`pmNode`、`export`、`import`、`status`（mapped/gap-ir/gap-pm/gap-both/not-applicable）、`conventionRef`、`notes`。
WP8.2 起，测试应引用矩阵 id，并断言每个必做行（shall/should）都有测试覆盖。

## 2. 覆盖统计

| 状态 | 行数 |
|---|---:|
| mapped | 277 |
| not-applicable | 61 |
| gap-both | 41 |
| gap-ir | 8 |
| gap-pm | 4 |

其中 **33 行为必做（shall/should）缺口**，按领域分布如下：

| 领域 | 缺口 | 代表行 |
|---|---|---|
| 引用（14） | 规范性引用文件清单的结构化条目：`ref/std/std-ref/title` 与 `mixed-citation`；正文中以 `std` 引用标准化文件；缩略语 `def-list`；对列项的引用及列项 id | M-4.4.2.3-03、M-10.2-01、M-10.1.4-01、M-10.1.5-01 |
| 图（9） | 图例 `legend/def-list`；行内图 `inline-graphic`；生产 Schema 中图下的注和示例 | M-8.5-01～06、M-8.3-02、M-8.2-11、M-8.4-03 |
| 术语（3） | `tbx:subjectField`（领域）；`tbx:termEntry` 需要独立于 `term-sec` 的 id | M-9.2.9-01、M-9.2.1-05 |
| 章节（2） | 引言中的条（`sec_0`、`sec_0.1`） | M-4.3.4-02/03 |
| 表（2） | `col` 列宽模型；单元格边框样式 | M-6.1-03、M-6.3.3.1-01 |
| 其他（3） | 生产 PM 不支持罗马列项；注/示例内不能放块内容；参考文献标题 | M-5.7-04、M-5.6-05、M-4.5.3-02 |
| 公式（1） | 公式图片（命名依赖 PDF 页码，SES 不生成） | M-7.4-13（建议列为 not-applicable，待确认） |

## 3. 已统一的约定（两个分片一致，审查已对照原文图像抽查）

- **命名空间**：`xlink` = `http://www.w3.org/1999/xlink`，`mml` = `http://www.w3.org/1998/Math/MathML`，`tbx` = `urn:iso:std:iso:30042:ed-1`，均声明在根元素 `standard` 上（印刷页 2）。
- **公式**：只输出 MathML（`mml:math`）。全文没有 `tex-math`、`alternatives`、`annotation`；导入时遇到这些元素报 unsupported。
- **术语采用级别**：使用 `tbx:normativeAuthorization`，取值 preferredTerm / admittedTerm / deprecatedTerm。印刷页 37 有三处写作 `normativeAuthentication`，作为异写接受。描述符采用数据驱动：IR 有就输出，没有就省略，**不伪造**。
- **附录性质**：导出 `informative`/`normative`；导入另接受 `inform-annex`/`inform_annex`。章角色导出 `norm-refs`，导入另接受 `norm_refs`。
- **xmlId**：以附录 E 为主。相对于现有 Resolver 要改的几处：`bib_N` → `biblref_N`；`tabfn_tab_1_a` → `table-fn_<表号>.<k>`；新增 `term_<编号>`；术语条目中的注用 `nte_<术语号>-<k>`；XML 中不得出现 `ext_` 开头的 id。`sec_`、`tab_`、`fig_`、`formula_`、`fn_` 保持不变。导入时把 id 当作不透明标识，只校验合法、唯一、rid 可解析。
- **表**：表注、表脚注、通用单位都放在 `table-wrap-foot` 中；导入时 `tfoot` 先拒绝。
- **图资源**：`xlink:href` 取所属 `fig` 的导出 id，不带文件夹和扩展名，由资源清单对应到物理文件。
- **旧格式判别**：见 conventions-S §6。不能只凭根元素名 `standard` 判断。

## 4. 校验包需求（阻塞项 B2）

依据 `processing-meta` 示例、附录 C/D 引用的 Tag Library 1.2，以及 ISO 源指南的同一组声明，建议固定为：**NISO STS 1.2（2022）interchange 标签集 + MathML 3.0 + XHTML 表格 + TBX**。
4.1 示例中的 DOCTYPE（`NISO-STS-extended-1-mathml2.dtd`）与上述声明矛盾，不沿用，导出时不写 DOCTYPE（D-S-03）。
原文没有给出 DTD/XSD 下载地址，本环境也访问不到 niso-sts.org、w3.org，因此**至今未做任何结构校验**。
`ccs`、`implementation-date`、`equivalence` 标注为“中国标准特有”，需要项目自写扩展 schema，并标明“项目实现约定，非官方”（D-S-04）。

## 5. 待确认事项

关键项由主导人在会话中提交用户决定，其余默认采纳分片建议（详见各分片的 D 表）：

| 编号 | 事项 | 建议 |
|---|---|---|
| D-S-01 | 实施日期的写法 | `release-date`（发布日期）+ `implementation-date`（实施日期）；导入另接受 `date-type` 写法 |
| D-S-03 / D-T-04 | 标签集与 MathML 版本 | STS 1.2 interchange + MathML 3.0，不写 DOCTYPE |
| D-S-09 | 一般注/示例的 id | 只在被引用时输出 |
| D-S-12 / D-T-05 | 术语条目 id | `term_<编号>` |
| D-S-08、D-S-10、D-T-11 等 | 33 个必做缺口 | 见第 6 节 |
| D-T-10 | 正文脚注 `fn` 的位置 | 原文没有规定，需要决定 |
| D-S-06 | 行内颜色、字号等样式 | 原文第 5.1 条只允许七种格式：导出时报错并给出位置，用户确认后才丢弃 |

## 6. 工期估算（T1.6）

以下为子代理任务数，每个任务对应一次实现加审查。工期按每个任务 0.5～1 天折算，属于估算，不作为验收豁免。

| 阶段 | 任务 | 估算 |
|---|---|---|
| 补模型（若决定在 WP8 内补齐必做缺口） | 规范性引用文件结构化条目及正文 `std` 引用；缩略语定义列表（与图例、“式中”共用结构）；图例、行内图、图注/图示例进入生产 Schema；列项引用与列项 id；`subjectField`；引言中的条；罗马列项与注内块内容进入生产 Schema；`col` 和边框样式 | 6～8 个任务 |
| WP8.2 导出 | Resolver 的 xmlId 调整；渲染器骨架；表/图；公式/术语/引用/索引；MathML 与资源包准备 | 5～6 个任务 |
| WP8.3 导入 | DOM 适配与旧格式拒绝；内容模型校验与映射到 IR；生产 Schema 接入及资源包 | 4～5 个任务 |
| WP8.4 切换 | 替换各入口；删除旧实现并迁移测试 | 2～3 个任务 |
| WP8.5 验收 | 结构校验（需要校验包）、真实流程、真实样稿核对 | 2～3 个任务 |

不补模型时，缺口只能报 unsupported，WP8 无法按规格的“必做要素”验收。
