# WP8.2 验收记录

本文件由 T2.6 汇总最终验收；以下按任务追加各自的记录。

## T2.4a-1：骨架、公共部分与输出边界（基线 `5e25430`）

### 输出边界基线的变化（设计 §1.3.5、§6.3）

`outputBoundary.ts` 对 XML46687 不再与旧 XML 完全相同：各领域的放行项登记在 `renderers/xml46687Parts/<域>.ts` 的 `XML46687_*_BOUNDARY` 常量里，
`renderers/xml46687Boundary.ts` 汇总成 `XML46687_DECLARED_DIFFERENCES`（导出自 `@ses/shared`）。所有“XML46687 与 XML 的差别”改为**计算值**：

- 差集（XML 阻断而 XML46687 放行的问题）里每一条必须落在某个已声明差异内，XML46687 不得比 XML 多阻断；
- 已声明的差异必须被真正触发（新增放行而不登记、或登记了却没有真正放行，都会使测试失败）。

受影响且已改写的测试：shared `outputBoundaryXml46687.test.ts`（差异集合断言、逐项正例、仍阻断清单、两处陷阱回归）、`wp8mG1.test.ts`、`wp8mG6.test.ts`、
`xml46687.contract.test.ts`（占位用例改为真实管线断言）；client `wp8mIntegration.test.ts`、`wp8mG1.test.ts`、`wp8mG6.test.ts`、
`wp8mPersistence.acceptance.test.ts`（opt-in 验收，基线“XML−XML46687=2”改为“等于被声明差异覆盖的问题数”）。
T2.4b/T2.4c 之后再放行字段，这几处无需再改。

### 实测数字（WP8.M 全要素 IR，`createWp8mIrDoc()`）

| 格式 | 问题数 | 说明 |
|---|---|---|
| HTML | 15 | 与 WP8.M 验收一致（图例、图中示例、行内图、列宽、单元格样式、资源） |
| DOCX | 15 | 同上 |
| XML（旧） | 33 | 含 2 个罗马列项（旧序列化器降为阿拉伯数字，故阻断） |
| XML46687 | 24 | T2.4a-1 之后；T2.4b/T2.4c 放行后继续减少 |
| 差集 | 9 | = 引言条 `front.introductionClauses` 1 + `stdRef`/`mixedCitation` 的 mark 类型 6 + 罗马列项 2；全部在 `XML46687_DECLARED_DIFFERENCES` 内 |

opt-in 的真实 API/SQLite 保存重开验收（`wp8mPersistence.acceptance.test.ts`，需要 `WP8M_API_URL`/`WP8M_EVIDENCE_FILE`）**本任务没有运行**：
只改了它的边界断言（上述计算值），断言逻辑与 `wp8mIntegration.test.ts` 同构且已在后者中运行；真实验收留给 T2.6/WP8.4 一并执行。

### 黄金样例与外部校验

- 骨架夹具（`renderers/__tests__/xml46687SkeletonFixture.ts`，元数据、前言/引言/引言条、章/条/无标题条/附录、行内标记与引用、脚注、外链、
  列项、注/示例/警告/摘录/代码）的 XML 文件快照：`renderers/__tests__/__snapshots__/xml46687.skeleton.xml`；
  `python3 -I scripts/xml46687/validate.py --json --profile export` 对它 `valid:true`、`errors:[]`，warning 恰为引言条“导入暂拒”的三条
  （`W-IMPL-REJECT`，M-4.3.4-02/03 的 import 仍为 reject，WP8.3 改 accept）；`sts_compat.py` 零未解释偏差。
- `fullRendererFixture()` 含表、图、公式、术语与参考文献，T2.4a-1 的领域桩无法导出，它的 XML 黄金样例留给 T2.6（`xml46687.stubs.test.ts` 钉住“当前不能导出”）。
- 外部校验辅助 `pythonValidationAvailable()` / `shouldSkipValidation()`（`xml46687PythonValidation.ts`）：缺 python3/lxml/xmllint 时跳过并打印提示；
  `REQUIRE_XML_VALIDATION=1` 时缺环境即失败（验收命令固定带该变量）。

### 矩阵覆盖断言骨架

`wp82MatrixCoverage.test.ts`：强制开关 `ENFORCE_COVERAGE` 为 `false`，只报告缺口（T2.4a-1 结束时需覆盖 186 行、已引用 84 行；缺的 102 行全属 T2.4b/T2.4c 的域，
以及少数跨域行）；恒强制“标题里出现的矩阵 id 都存在于矩阵”。T2.6 把开关改为 `true`。
