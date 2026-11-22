# WP8.5：GB/T 46687.2—2026 XML 最终验收报告

验收日期：2026-11-22  
分支：`feat/wp8.5-xml46687-acceptance`（基于 `main` 提交 `7542a80`，已合入 WP8.1 / WP8.M / WP8.2 / WP8.3 / WP8.4 及 PR #93～#96）

---

## 1. 验收环境与工具链版本

所有测试结果、哈希、退出码与截图均来自本机真实执行，离线校验，不联网下载任何 DTD/Schema/工具包，且全程未触碰仓库内默认数据库（`packages/server/data/` 不存在）。

| 工具 / 来源 | 实测版本 / 标识 | 用途 |
|---|---|---|
| Node.js | `v24.22.2` | 前端/后端/IO 运行时与脚本执行 |
| pnpm | `10.33.0` | Workspace 依赖与脚本管理 |
| Python 3 | `Python 3.11.2` | 外部 XML 校验脚本（`-I` 隔离模式） |
| lxml | `4.9.2` | RELAX NG 校验与语义规则 V-1～V-18（`validate.py`） |
| xmllint | `libxml version 20914`（`2.9.14`） | libxml2 CLI 独立进程 RELAX NG 与官方 NISO STS 1.2 DTD 对照（`sts_compat.py`） |
| OpenJDK | `17.0.21`（`2026-10-20`） | 运行独立 RELAX NG Java 引擎 |
| Jing | `20241231`（`~/.local/share/jing/jing.jar`） | 独立于 libxml2 的第二套 RELAX NG 校验引擎（`scripts/xml46687/jing_check.py`） |
| playwright-chromium | `1.49.1`（`packages/server/node_modules/playwright-chromium`） | 真实 Chromium Headless 浏览器 UI 端到端验收 |
| 真实国标原文 PDF | `rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf`<br>SHA-256: `4eca456336c1d794cf05c6bd24b79d9afe7295058cdb919179112022f48b85c6` | 真实国家标准全要素核对来源 |
| 真实国标原文 Markdown | `rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.md`<br>SHA-256: `4ff6bcdc1337457f3c4c76a9e4a7701e04293143d01b381c202e56c8e76f9986` | 同源文本检索与条款/页码映射 |

---

## 2. 最终冻结全量串行复验结果

在所有代码与脚本改动定稿后，以 `REQUIRE_XML_VALIDATION=1 REQUIRE_JING_VALIDATION=1` 串行执行以下 11 项全量复验（随后仅更新本验收报告与 `docs/wp8-xml46687.md` 状态）：

| # | 检查项与确切命令 | 退出码 | 实测结果 |
|---|---|---|---|
| 1 | `pnpm --filter @ses/shared exec tsc --noEmit` | `0` | 通过，0 错误 |
| 2 | `pnpm --filter @ses/io exec tsc --noEmit` | `0` | 通过，0 错误 |
| 3 | `pnpm --filter @ses/client exec vue-tsc -b --noEmit` | `0` | 通过，0 错误 |
| 4 | `pnpm --filter @ses/server exec tsc -p tsconfig.build.json --noEmit` | `0` | 生产构建类型检查通过，0 错误（注：默认 `tsconfig.json` 含既有 `*.spec.ts` 12 处基线类型错误，均在非 XML 模块，WP8.5 未改动 server 代码） |
| 5 | `REQUIRE_XML_VALIDATION=1 REQUIRE_JING_VALIDATION=1 pnpm --filter @ses/shared test` | `0` | **146 files passed，3,591 tests passed**（0 failed） |
| 6 | `REQUIRE_XML_VALIDATION=1 REQUIRE_JING_VALIDATION=1 pnpm --filter @ses/io test` | `0` | **37 files passed，538 tests passed**（0 failed） |
| 7 | `REQUIRE_XML_VALIDATION=1 REQUIRE_JING_VALIDATION=1 pnpm --filter @ses/client exec vitest run --maxWorkers=2` | `0` | **150 files passed \| 2 skipped（152），1,758 tests passed \| 2 skipped（1,760）**（2 项跳过为既有 opt-in 真库持久化测试，其中 `wp8mPersistence.acceptance.test.ts` 已在第 4 节独立真库冷重启跑通） |
| 8 | `pnpm --filter @ses/server test` | `0` | **39 suites passed，1,057 tests passed**（0 failed） |
| 9 | `python3 scripts/xml46687/test_validate.py` | `0` | **Ran 274 tests ... OK** |
| 10 | `python3 -I scripts/xml46687/matrix_coverage.py` | `0` | 矩阵 391 行；需覆盖元素 **133/133**、属性组合 **107/107**、format 拒绝 25 行（混入 schema：无）、implementation 拒绝 0 行；导出档强制 289 单元 / 105 探针全部通过 |
| 11 | `python3 -I scripts/xml46687/jing_check.py --json schemas/gbt46687.2/samples/valid/*.xml packages/shared/src/renderers/__tests__/__snapshots__/xml46687.{wp82,fullRenderer,wp8m,wp6}.xml` | `0` | **13/13 全部通过**（9 份 `samples/valid/*.xml` + 4 份 golden 快照，`valid: true`，0 errors） |

---

## 3. 对照 `docs/wp8-xml46687.md` §7 八大验证层逐层结论

| 验证层 | 核验状态 | 实测依据与关键数据 |
|---|---|---|
| **1. 语法** | **通过** | UTF-8 无 BOM、闭合/转义/命名空间（`mml`/`tbx`/`xlink`）严格校验；禁止 `DOCTYPE`、实体声明、外部实体与处理指令。`validate.py`、`test_validate.py`（274 项）与 TS 纯解析器全通过。 |
| **2. 结构** | **通过** | 三引擎 RELAX NG 校验全部 0 errors：`lxml 4.9.2` + `xmllint 2.9.14`（`validate.py --profile export/import`）+ 独立 Java 引擎 `Jing 20241231`（`scripts/xml46687/jing_check.py`）。`matrix_coverage.py` 确认 133/133 元素、107/107 属性组合与 105 个导出探针全通过；`sts_compat.py` 对照官方 NISO STS 1.2 DTD 未解释偏差 **0 个**。 |
| **3. 语义** | **通过** | 真实 `GB/T 1.1—2020` 样稿导出（`37,694` B、`802` 行，SHA-256 `eb7ca17f3aa3e18ddcb9de49c260cd6ff7e3a5a7927ed077f927138b590488c9`）验证：发布日期（`2020-03-31`）与实施日期（`2020-10-01`）严格分离；`std-ident` 分段与 `dated`/`undated` `std-ref`；双发布机构、ICS/CCS/归口/代替/版权完整；TBX 多语种（`zh`/`en`/`fr`）与领域/来源/`entailedTerm` 准确且**不伪造**未出现描述符；MathML 3.0（4 处 `<mml:math>`，无 `tex-math`/`annotation`/`alternatives`）；`75` 个 `@id` 全唯一、`22` 处 `<xref>` 与 `6` 处 `<tbx:entailedTerm>` 全部可解析；无 `ext_` 占位与 `DOCTYPE`；`manifest.json`、XML `xlink:href` 与 ZIP `resources/*`（3 份合法 PNG）一一对应。 |
| **4. 往返** | **通过** | `wp85RealStandardAcceptance.test.ts`（13/13 通过）与 UI E2E 步骤 10 验证：`buildXml46687Package` → `importXml46687Package`（0 errors）→ 生产 `createEditorSchema().nodeFromJSON(...).check()` → JSON 序列化/反序列化冷重开 → 二次 `buildXml46687Package`：**二次导出 `standard.xml` 与首次逐字节完全一致**（纯测试链路 SHA-256 `eb7ca17f...`，UI 编辑回滚后链路 SHA-256 `166ad89231b8b89c5b77f880b990dec18fc7d01ed60eb2a60bfecf46688bf064`），全部 PNG 资源 SHA-256 逐一完全一致。专项往返覆盖引言条（`sec_0`/`0.1`/`0.1.1`/无题条 `0.2`）、PR #94 行间公式 MathML、PR #95 横页表格+表脚注、PR #96 表/表头加粗外框。 |
| **5. 正反例** | **通过** | 正例：9 份 `samples/valid/*.xml` + 4 份 golden + 真实 `GB/T 1.1—2020` 样稿 + 引言条专项 + PR #94～#96 专项全部通过三引擎校验。负例：76 份结构/语义负例由 `test_validate.py` 与 TS 导入测试全覆盖；`sample-standard.xml`（SEP 旧格式）与 `gbt37967-root.xml`（GB/T 37967）在单元与真实 UI 均返回 `legacy-format` 拒绝且 `pmDoc: null`；缺失 `resources/fig_B.1.png` 的损坏 ZIP 返回 `xml-resource-missing` 拒绝；UI 实测负例失败时编辑器与服务端原稿哈希逐字节不变。 |
| **6. 真实流程** | **通过** | `packages/client/scripts/wp85-xml46687-e2e.mjs` 在真实 Headless Chromium + 隔离 SQLite（`127.0.0.1:3096` / `5196`）完整执行 11 步（见第 4 节）：UI 入口检查 → 导入 `.zip` → 3 类负例拒绝不覆盖 → 编辑保存 + 快照 A（三引擎 0 errors）→ 二次编辑 + 快照 B → **真实停机（PID `5852`）+ 端口拒绝 + 同库重启（PID `5985`）+ `ses.db` SHA-256 不变** → 回滚快照 A → UI 复制为新文件 → 源码视图 + UI 下载 `.zip` 与纯 `.xml` → 独立新文档二次 UI 导入 + 二次导出逐字节一致 → HTTP REST `GET /api/documents/:id/export/xml`（含图 `.zip` + 纯文本 `.xml`）。全程 `pageErrors: 0`、`consoleErrors: 0`。另独立跑通 `wp8mPersistence.acceptance.test.ts` 真实冷重启（PID `3510` → `3637`）。 |
| **7. 原文与互操作** | **部分通过（独立校验完成；外部第三方实样互操作受限未完成）** | 已完成：① 依据真实国家标准 `GB/T 1.1—2020` 原文构建全要素样稿并逐章核对（见第 5 节）；② 独立于 libxml2 的 Java RELAX NG 引擎 `Jing 20241231` 全部通过；③ 官方 NISO STS 1.2 DTD 对照 `sts_compat.py` 零未解释偏差。**未完成/受限**：仓库内无外部第三方机构/独立接收系统产出的真实 `GB/T 46687.2—2026` XML/ZIP 样稿，无法声称完成跨厂商真实样本互操作验收（详见第 7 节）。 |
| **8. 回归** | **通过** | ① PR #93～#96 既有客户端测试（`wp6Review`、`wp6FormulaEditing`、`LandscapeTableDialog`、`xmlCoverMetadata` 等）与四包全量单测全绿；② 非 XML 常规可排版子集回归（`wp85RealStandardAcceptance.test.ts` 第 8 节）验证语义 JSON、文件设置同步、HTML（含 PR #96 `.ses-table-block table, .ses-table-block thead { border: 2px solid #000; }`）与 DOCX（含 PR #95 `w:orient="landscape"` 与 PR #96 `w:sz="8"`）均正常。 |

---

## 4. 隔离真库冷重启与真实浏览器 UI E2E 实测证据

### 4.1 既有 opt-in 真库冷重开验收（`wp8mPersistence.acceptance.test.ts`）

- 隔离目录：`/tmp/wp85-acceptance/wp8m-server`（已清理），回环监听 `http://127.0.0.1:3097`
- Phase 1（`prepare`）：后端 PID **`3510`**，空库检查 `GET /api/documents` → `[]`，`prepare` 通过（1/1）；停机前 `data/ses.db` SHA-256：`c1f7eccd2a6984f3a7d08681c1ad2aef00d1ba3a00eb7b768408129d89878ec9`。
- 停机校验：`kill -TERM 3510` 后确认 `127.0.0.1:3097` 拒绝连接，停机后 `data/ses.db` SHA-256 不变（同上）。
- Phase 2（`WP8M_ACCEPTANCE_PHASE=reopen`）：同目录重启后端，新 PID **`3637`**（`3637 !== 3510`），`reopen` 通过（1/1，`sha256MatchesPrepare: true`，`boundaryCounts: { HTML: 9, DOCX: 9, XML: 33, XML46687: 0 }`），停机后 `data/ses.db` SHA-256 仍为 `c1f7eccd2a6984f3a7d08681c1ad2aef00d1ba3a00eb7b768408129d89878ec9`。

### 4.2 WP8.5 真实 Chromium UI 11 步 E2E + 冷重启 + HTTP REST（`wp85-xml46687-e2e.mjs`）

- 隔离监听：API `http://127.0.0.1:3096` / Vite `http://127.0.0.1:5196`，完整机器可读证据：[`docs/qa/wp8.5/e2e-evidence.json`](../qa/wp8.5/e2e-evidence.json)
- 冷重启记录：
  - 旧后端 PID：**`5852`** → 停机前 `ses.db` SHA-256：`5e1c1ea929e6f1cb4f780f8565f99b3b0ead6653778c921d11d56a1eaa42ecf8`
  - `SIGTERM` 停止后端口 `3096` 确认拒绝连接，停机后 `ses.db` SHA-256 不变
  - 同目录重启新 PID：**`5985`**（`5985 !== 5852`），重启后 `ses.db` SHA-256 不变；冷重开 `/editor/1` 后编辑标记 A、B 与版本快照 `v1.0`/`v1.1` 完整保留
- 关键 XML/ZIP 哈希与校验：
  - 版本快照 A（`v1.0`，id=1）XML：`37,725` B，SHA-256 `166ad89231b8b89c5b77f880b990dec18fc7d01ed60eb2a60bfecf46688bf064`，`validate.py`（0 errors / 0 warnings）+ `sts_compat.py`（0 未解释偏差）+ `jing_check.py`（0 errors）
  - UI 首次下载 `.zip`（`9,659` B）与独立新文档二次 UI 导入后二次下载 `.zip`：`standard.xml` SHA-256 均为 `166ad89231b8b89c5b77f880b990dec18fc7d01ed60eb2a60bfecf46688bf064`（逐字节一致），3 份 PNG 资源 SHA-256 逐一完全一致（`fig_B.1.png`: `9e02f30d...`, `inl_1.png`/`inl_2.png`: `49779094...`）
  - 无图纯文本标准 UI 下载：`纯文本标准验收样稿.xml`（`1,578` B，SHA-256 `ec2d366cf4fd22357ded69bb94c7134b64e5b8d9b99135da74b64ee79bdae85c`），直接下载单文件 `.xml`，三引擎 0 errors
  - HTTP REST `GET /api/documents/:id/export/xml`：
    - 含图文档 `id=1`：HTTP `200`，`Content-Type: application/zip`，`9,659` B，解包 XML 与 UI 导出逐字节一致，三引擎 0 errors
    - 纯文本文档 `id=3`：HTTP `200`，`Content-Type: application/xml; charset=utf-8`，`1,578` B，与 UI 导出逐字节一致，三引擎 0 errors
- 截图证据清单（均已目视复核）：
  1. [`docs/qa/wp8.5/01-ui-xml46687-entries.png`](../qa/wp8.5/01-ui-xml46687-entries.png)（144K）：导出对话框卡片仅含「XML（GB/T 46687.2—2026）」，无旧入口
  2. [`docs/qa/wp8.5/02-ui-import-zip-success.png`](../qa/wp8.5/02-ui-import-zip-success.png)（261K）：真实 UI 导入 `GB/T 1.1—2020` `.zip` 成功
  3. [`docs/qa/wp8.5/03-ui-reject-legacy-sep.png`](../qa/wp8.5/03-ui-reject-legacy-sep.png)（265K）：上传 SEP 旧格式被拒，修复后单行截断 toast 清晰完整且原稿未覆盖
  4. [`docs/qa/wp8.5/04-version-snapshot-a.png`](../qa/wp8.5/04-version-snapshot-a.png)（283K）：版本面板保存快照 A（`v1.0`）成功
  5. [`docs/qa/wp8.5/05-version-rollback.png`](../qa/wp8.5/05-version-rollback.png)（312K）：冷重启后回滚至快照 A，第 1 章范围清晰呈现标记 A 且不含标记 B
  6. [`docs/qa/wp8.5/06-source-view-xml46687.png`](../qa/wp8.5/06-source-view-xml46687.png)（251K）：源码视图展示 `XML（GB/T 46687.2—2026）`
  7. [`docs/qa/wp8.5/07-ui-export-card.png`](../qa/wp8.5/07-ui-export-card.png)（251K）：完整文档导出卡片
  8. [`docs/qa/wp8.5/08-ui-reimport-roundtrip.png`](../qa/wp8.5/08-ui-reimport-roundtrip.png)（226K）：独立新文档二次 UI 导入后附录 B 图 B.1（PNG 图、图例、图注、示例）与附录 C 表 C.1 渲染无损

---

## 5. 真实国家标准（`GB/T 1.1—2020`）逐章与要素核对表

样稿文件：[`packages/client/src/serializer/__fixtures__/wp85RealStandardGbt11.ts`](../../packages/client/src/serializer/__fixtures__/wp85RealStandardGbt11.ts)  
验收套件：[`packages/client/src/serializer/wp85RealStandardAcceptance.test.ts`](../../packages/client/src/serializer/wp85RealStandardAcceptance.test.ts)（13/13 通过）

| 模块 | GB/T 1.1—2020 原文依据 | GB/T 46687.2—2026 条款 | 核验覆盖要点 | 往返与三引擎结论 |
|---|---|---|---|---|
| 封面元数据 | 封面（第 I 页） | 4.3.2 | ICS `01.120`、CCS `A 00`、`std-ident` 分段、`dated`/`undated` `std-ref`、代替 `GB/T 1.1—2009`、中英分段题名 `main`/`compl`/`full`、发布日期 `2020-03-31` 与实施日期 `2020-10-01` 分离、双发布机构（国家市场监督管理总局 + 国家标准化管理委员会）、归口 `SAC/TC 286`、语言 `zh`、版权声明 | 0 errors，逐字节一致 |
| 前言 | 前言（第 V 页） | 4.3.3 | `sec[@id="sec_foreword"][@sec-type="foreword"]`、真实修订 `alpha-lower` 列项 + `dash` 列项 + `std` 引用 + 正文/附录交叉引用 | 0 errors，逐字节一致 |
| 引言 | 引言（第 VII 页） | 4.3.4 | 原文无子条形式 `sec[@id="sec_intro"][@sec-type="intro"]`；另设专项样稿验证含引言条 `sec_0` / `0.1` / `0.1.1` / 无题条 `0.2`（`sec-type="numbered-paragraph"`） | 0 errors，逐字节一致 |
| 第 1 章 范围 | 第 1 章（第 1 页） | 4.4.2.2 | `sec[@id="sec_1"][@sec-type="scope"]` + 条文注 | 0 errors，逐字节一致 |
| 第 2 章 规范性引用文件 | 第 2 章（第 1 页） | 4.4.2.3 | `ref-list[@content-type="norm-refs"]`、结构化 `std`（6 项）+ 含条文脚注的 `mixed-citation`（1 项） | 0 errors，逐字节一致 |
| 第 3 章 术语和定义 | 第 3 章（第 1–2 页） | 4.4.2.4、9.2 | 真实分组 3.1/3.2/3.3（9 条 `tbx:termEntry`）、多语种 `zh`/`en`/`fr`、领域 `tbx:subjectField`、定义、示例、注、来源、`tbx:entailedTerm`，不伪造未出现描述符 | 0 errors，逐字节一致 |
| 复杂表格与 PR #95/#96 | 表 3（第 8 页）、9.8.5（第 29 页） | 6.1～6.5 | 表 1：跨行/跨列 2 行复合表头（`headerRowCount=2`）、名义列宽 `%`、表单位、表注、表脚注与表内引用、2px 外框与表头加粗边框样式；表 2：横页表格 `orientation="landscape"` + 表单位 + 多表注 + 表脚注 | 0 errors，逐字节一致 |
| 核心条文与富文本 | 第 7 章（第 9–11 页）、9.10～9.12 | 5.1～5.7、10.1～10.2 | 无标题条、字母/阿拉伯/小写罗马/破折号/圆点列项、多块注/多块示例/警告、粗斜下划线删除线上下标、变量、行内代码、代码块、外链、条文脚注、交叉引用 | 0 errors，逐字节一致 |
| 数学公式与 PR #94 | 9.9（第 29–30 页） | 7.1～7.4 | 公式 (1) 原生 MathML 3.0 + LaTeX + 编号 + `whereList` + 公式注；公式 (2) KaTeX → MathML 3.0 + `whereList`；2 处行内 MathML；无 `tex-math`/`annotation` | 0 errors，逐字节一致 |
| 图与资源 | 图 B.1（第 39 页） | 8.1～8.6 | 真实有效 PNG 字节（`fig_B.1.png` + `inl_1.png` + `inl_2.png`）、图题、图例 `legend/def-list[@list-content="figure"]`、图注、图中示例、行内图 `inline-graphic` | 0 errors，资源 SHA-256 一致 |
| 附录 / 参考文献 / 索引 | 附录 A/B/C（第 37–42 页）、参考文献（第 60 页）、索引（第 61 页） | 4.5.2～4.5.4 | 附录 A（资料性）、附录 B（规范性含子条与图 B.1）、附录 C（规范性含子条与表 C.1）、参考文献（`std`×3 + 含 `<uri>` 的 `mixed-citation`）、索引（指向正文真实目标） | 0 errors，逐字节一致 |

---

## 6. 本次验收发现并修复的问题与目视观察项

### 6.1 已修复的 2 处真实问题
1. **`wp8mPersistence.acceptance.test.ts` 既有 opt-in 边界基线过时（`15 → 9`）**：
   - 原因：历史提交 `41b419bf` 为 HTML/DOCX 放行了 6 处行内图，同步更新了 `wp8mIntegration.test.ts` 和 `EditorView.exportBlocked.test.ts` 为 `9`，但漏更新默认跳过的 opt-in 真库测试 `packages/client/src/extensions/wp8mPersistence.acceptance.test.ts`。
   - 处理：同步更新该测试的 HTML/DOCX 预期阻断数至 `9`（与 `wp8mIntegration.test.ts` 一致），随后完成两阶段真库冷重启验证通过。
2. **批量 XML 错误导致 `ElMessage.error` toast 溢出视口上沿**：
   - 现象：目视检查首次 `03-ui-reject-legacy-sep.png` 时发现，导入 SEP 旧格式 `sample-standard.xml` 产生 93 条 `legacy-format` 错误，`EditorView.vue` 内联 `formatXmlProblems` 全量拼接至单个 toast，导致红色提示条严重超出视口顶部。
   - 修复：抽离带截断上限的纯函数 [`packages/client/src/utils/xmlProblems.ts`](../../packages/client/src/utils/xmlProblems.ts)（默认展示前 3 项，超出时附加 `……等共 N 项问题`），由 `EditorView.vue` 与 `VersionPanel.vue` 共用，新增单测 [`packages/client/src/utils/xmlProblems.test.ts`](../../packages/client/src/utils/xmlProblems.test.ts)（4/4 通过），重跑 UI E2E 并目视复核刷新后的 `03-ui-reject-legacy-sep.png` 清晰完整。

### 6.2 目视观察到的非阻断改进建议（未越权改动）
1. **`metadataBlock` 在编辑器顶部的展示间距偏紧凑**：如 `02-ui-import-zip-success.png` 所示，导入 XML 后 `metadataBlock` 直接以紧凑文本流呈现在「前言」上方；数据保真和编辑功能正常，后续可优化其视觉分隔或折叠交互。
2. **`@ses/server` 默认 `tsconfig.json` 含既有测试文件类型错误**：`tsc -p tsconfig.build.json --noEmit` 与 `nest build` 均 0 错误；默认 `tsc --noEmit` 在非 XML 测试（`document-ops.spec.ts`、`trash.spec.ts`、`mcp-export.spec.ts`、`ses-package*.spec.ts`）有 12 处既有基线错误，与 WP8.5 无关。

---

## 7. 已知限制与未完成边界（诚实声明）

严格依据 `docs/wp8-xml46687.md` §2 与 §7，以下客观边界仍保持**未完成 / 受限**状态，不在本报告中伪报通过：

1. **尚未完成外部第三方机构真实 XML/ZIP 样稿互操作实测**：
   - 本仓库目前不持有国家标准发布机构或第三方独立接收/出版系统产出的真实 `GB/T 46687.2—2026` XML/ZIP 样稿。
   - 本次验收已通过**独立 RELAX NG 校验引擎（Java `Jing 20241231`）**和**官方 NISO STS 1.2 DTD 对照（`sts_compat.py`）**验证了本系统依据真实国家标准 `GB/T 1.1—2020` 原文构建的全要素导出件，但这不等同于跨厂商/外部第三方样稿的接收与互操作验证；待取得外部真实样稿后，需使用 `importXml46687Package` 与三引擎校验补充外部互操作实测。
2. **项目自写 RELAX NG schema 性质与官方登记未联网核实**：
   - `schemas/gbt46687.2/ses-gbt46687-2.rng` 是依据国标原文与 WP8.1 约定编写的项目实现校验包，非国家标准官方发布的机器可读 DTD/XSD/RNG。
   - 依据 [`docs/wp8.1/source-record.md`](../wp8.1/source-record.md) §4 与 §6，仓库现存 76 页扫描件（`rules/GBT 46687.2-2026 …pdf`）全页清晰可读，WP8.1 已完成附录 F 全表（印刷页 69–70 / PDF 第 73–74 页，27 行）对照图像核验（早期草案中记录的“印刷页 69 黑色占位”不适用于本副本）；仍保持未核实/保留项为：扫描字形偶发难辨细节（全角/半角括号、示例 `=` 两侧排版空格）、国家标准全文公开系统网页登记链接（离线环境未联网核实）以及 [`docs/wp8.1/README.md`](../wp8.1/README.md) §2.2 记录的 18 行 `may`/示例级缺口。
