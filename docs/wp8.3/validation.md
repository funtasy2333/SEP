# WP8.3 外部裁判与矩阵核对

## 最终集成验证（2026-10-31）

基于 main `f37eae5197074c0c1c10057c6aac8c8c76f19567`。评审修复集成提交 `db541eabdf7602b913955217deed621abf87128b` 后，七项检查在干净的产品树 `2a6e04ddc2090d682530d456d2f1775d76775f93` 执行，检查期间 HEAD 与工作树均未变化；随后仅更新验收文档。Node 22.23.4，外部 XML 校验使用 lxml 与本地 xmllint，shared/io 强制 `REQUIRE_XML_VALIDATION=1`。

| 检查 | 结果 |
|---|---|
| shared 全套 | 138 文件、3511 项通过；含 188 行 shall/should 接收矩阵守护及 87 份 TS/Python 双引擎裁判对照 |
| shared `tsc --noEmit` | 通过 |
| io 全套 | 35 文件、521 项通过 |
| client Vitest `--maxWorkers=2` | 1527 项通过、2 项既有跳过；126 文件通过、2 文件跳过 |
| client build | 通过；保留既有大 chunk 提示 |
| server Jest `--runInBand` | 826/827 通过；唯一失败为 `mcp-e2e.spec.ts` 的 PDF 5c 环境基线，未跳过或改写该测试 |
| Python 全套 | 274 项通过 |

PDF 基线在开工前即存在：可用性探测只发现 CLI/poppler，实际 Vivliostyle 浏览器运行在当前环境失败。它不属于 XML 导入链路；本次没有将 server 全套标成全绿。新增 server XML/ZIP 跨端测试 15/15 通过，client 对应 17/17 通过。没有访问默认 `packages/server/data/ses.db`。

### PR 与评审

[Draft PR #67](https://github.com/funtasy2333/SEP/pull/67) 已创建，保持 draft、未合并。Codex 的两条 P2 已核实、修复并在线程回复后 resolve；回复前均用 `git log` 核对集成提交号。

修复阻断同一 `permissions` 内重复的版权声明、年份或持有人，以及重复的 `comm-ref`；按 C-S-21 同时阻断同名 `custom-meta`（含未知名称）。整文回归先证明 XML 内容模型接受这些重复结构，再核对映射错误的行号和重复项路径。IO 回归确认返回 `pmDoc:null`、不调用生产 Schema 校验器、选项及资源表不变；单值和不同名称正例保留原行为。

当前连接器没有 PR 事件订阅接口，GitHub CLI 认证不可用，因此未能核实通知订阅状态。Codex app 的 PR 附件工具两次调用及附件查询均超时；PR 本身与评审处理已通过 GitHub 连接器确认。没有将这些限制记为成功。

### 保真与样例

- 9 份 `valid` 原文均经真实生产 Schema 导入、JSON 保存重开；另两份合法不透明 ID 样例接受导入，其余 76 份负例按指定错误码和中文 XML 位置拒绝。原样例文件未改动。
- 四份原版 golden 全文进入同一 client/server IO 链路，核对引用目标身份、图表术语、MathML URI 树和资源字节，再导出并验证第二次往返固定点。
- `wp82`、`fullRenderer`、`wp6` 再导出与原 XML 逐字节相同。`wp8m` 唯一约定差异：表格单元格注的两段“单元格内注的第一段。”和“单元格内注的第二段。”合成一个段落，以 `<break/>` 分隔，并返回 `xml-normalized` 告警；测试逐字节验证这项替换，未忽略其他差异。
- 05/08 的各图片使用带有效 CRC 的可区分 PNG，核对多图、图组和表替代图的每份字节归属；BMP 等合法 `image/*` 也通过出包—导入—生产 Schema 保存重开，保持 MIME 与字节。未修改任何 JSON golden 或两份锁定夹具。
- `processing-meta@mathml-version="2.0"` 在导入时接受并告警，导出仍严格 3.0；Python 两引擎用临时导入 schema 副本验证原 XML，源 RNG、自定义 schema 和输入行号保持不变。

### 安全范围与限制

XML 为纯 TS URI 感知解析，拒绝 DOCTYPE/实体声明、外部实体、非预定义命名实体和处理指令。上限为 UTF-8 16 MiB、深度 128、连续解码文本 1 MiB、节点 500000；RNG 匹配和表网格各有 400 万计算预算。运行时不依赖 Python，不读取 XML 的外部 DTD。

ZIP 先检查原始中央目录、本地头、路径、唯一性、声明大小和描述符，再逐块计量、核对实际长度与 CRC。压缩输入 64 MiB、条目 1024、留存解压总量 128 MiB、单资源 32 MiB、XML 16 MiB、清单 1 MiB。拒绝遍历路径、大小写冲突、重叠、加密、多卷、ZIP64、缺文件和歧义资源。宿主 resolver 收到独立字节副本，包内字节优先；异常继续传播。

48 MiB DEFLATE 资源伪报 1 字节的实测触发 `xml-limit`。JSZip 3.10.1/pako 1.0.11 在 pause 后仍同步产生 131072 字节，回调全部丢弃，不存储或拼接。源码核对输入/输出块各 16 KiB、解码窗口 32 KiB，默认累计输出的回调被覆盖；上限约束可达的留存和拼接数据，并非解码器瞬时停产或进程 RSS 的严格上界。

项目未取得真实外部 XML/ZIP 样稿，因此只报告项目样例、原版 golden 和跨端生产 Schema 验收，未宣称真实互操作或真实规模验证通过。UI、旧入口删除、server HTTP/MCP 接入仍留 WP8.4。

## 外部裁判规则

外部裁判用于 XML 格式与语义回归，不执行产品导入、资源加载或生产 Schema 转换。本地自写样例与 lxml/xmllint 的结果不构成真实样稿互操作结论。

严格导入约定与 P1 建议专码对应如下（Python 保留原 V 规则作为错误码）：

| 规则 | Python | P1 建议码 | 内容 |
|---|---|---|---|
| R1 | V-17 | xml-annex-type-required | app 必须有直接 annex-type |
| R2 | V-8 | xml-xref-custom-type-required | custom xref 必须有 custom-type |
| R3 | V-17 | xml-ext-link-type-invalid | ext-link-type 必须为 uri |
| R4 | V-15 | xml-math-display-invalid | 行间显式 block、行内不得指定 |
| R5 | V-14 | xml-math-id-required | 公式直接 MathML 根须有 id |
| R6 | V-13 | xml-app-id-required | app 须有 id |
| R7 | V-13 | xml-bibl-ref-id-required | bibl/bibr 直接 ref 须有 id；norm-refs ref 不强制 |
| R8 | V-13 | xml-term-id-required | TBX termEntry 须有 id |
| R9 | V-18 | xml-paragraph-id-forbidden | 无命名空间 p 不得有无命名空间 id |
| R10 | V-17 | xml-section-label-required | body/app 后代 sec 须有非空直接 label |
| R11 | V-12 | xml-meta-order-invalid | 次序 A/B 任一非降序，B 告警；其他错误 |
| R12 | V-17 | xml-table-label-required | table-wrap 须有非空直接 label |
| R13 | V-9 | xml-term-definition-count | 各 langSet 中 definition 合计恰好一个 |

13 项此前 import 接受或告警，现按所列上下文 error；不按文件名处理。两种 MathML 前缀及默认命名空间均按 URI 识别。DOCTYPE 一律拒绝，不读取外部子集；多目标 rid 拒绝。已授权的引言条、array、disp-formula-group 和共享脚注不再产生旧 implementation 拒绝告警。格式检查不证明模型和资源可导入。

支持矩阵动态统计：391 行中 accept 203、required 156、format reject 25、not-applicable 7；shall/should 的 accept/required 为 188 行。M-4.1-02 从 accept 改 format reject；M-4.3.4-02、M-4.3.4-03、M-5.8-01、M-C.1-04、M-C.1-05、M-10.1.8-04 从 implementation reject 改 accept。原拒绝以外的矩阵行状态未变。

ID 以不透明关联键导入：V-7 和 `app_A`、`bib_1`、`tabfn_…` 等仅凭 ID 字面值作出的旧式检测只用于 export；import 接受合法唯一且引用可解析的 NCName，不按拼写判断类型。`uuid-id.xml` 与 `formula-id.xml` 因此是 import 正例、export 负例；其余 76 个无效样例仍在 import 被拒。结构性旧格式（命名空间、元素及文档结构）继续在两个档位拒绝，V-18 仍拒绝无命名空间 `p@id`。样例 oracle 共 87 个：9 个标准正例、2 个 opaque ID import 正例及 76 个 import 负例。
