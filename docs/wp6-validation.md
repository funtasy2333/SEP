# WP6 验收记录

状态：按调整后 WP6 方案实施，内部数据契约回归与最新复审修复记录见下文；待 PR 审阅及合并。2026-10-06 已重新对照 main，完整完成范围与限制见 [方案审计](wp6-plan-audit.md)。按用户确认的调整方案实施。基线为 `origin/main` 的 `e4690a320233b23122df0ba9a510b30ced16fbe2`；开发分支 `codex/wp6-json-model`。本记录不表示 GB/T 46687.2—2026 XML、外部互操作或 Word 真实稿件验收完成。

## 交付契约

- `renderSemanticJson(PMJsonNode, labels, options?)` 保持现有 PM JSON 导出形状；client 只准备 Resolver 输入及调用渲染器。旧文档缺编号节点 ID 时使用导出临时 ID 与 child-index path 回填标签，不修改原文档。
- `renderJson(IRDoc, labels)` 通过 `irToPm` 输出原生 IR 的语义 JSON；不能表示的内容抛出带位置的 `IRToPmError`。
- `irToPm` 默认生产编辑器 `doc` 根；`standardDoc` 仅为显式选项。数据模型、生产 Schema 和优先级见 [模型契约](wp6-model-contract.md)。
- 基础 IR 保持 `schemaVersion: 1`。新增语义使用 `extensionVersion: 1`；未知版本产生错误诊断。旧文档无新增语义时不强加新版标签。
- 普通保存、版本、复制继续存 PM JSON。旧 XML 存量与调用边界见 [存储及旧 XML 盘点](wp6-storage-xml-inventory.md)。旧 XML 实现只存续至 WP8，不新建 XML37967 渲染器或兼容迁移器。

## 兼容与输出边界

JSON byte golden 固定为迁移前生产 Schema 下的 `sample-standard.xml` 和 `all-elements` fullFixture；文件、基线和 SHA-256 见 `packages/client/src/serializer/__fixtures__/golden/manifest.json`。黄金文件测试只读。

三个旧计数器边界行为改为 Resolver 的统一规则：章下直接二级条 `1.0.1 → 1.1`（同时报告跳级），第 3 章首个二级术语 `3.0.1 → 3.1`，第 27 个附录 `[ → AA`。不声称所有异常输入都保持旧字节输出。

现有 DOCX、HTML（含 PDF 打印 HTML）和旧 XML 没有实现新增结构化信息的完整排版/交换。因此，对非空新字段、新角色和无法映射的正文，出口返回 `unsupported-output`，包含字段路径、关联节点和原因；JSON 保留完整内容。错误不是成功导出，不能据此宣称新信息已经完成打印或 XML 交付。既有 DocumentMeta 标量设置继续沿用原来的版面契约；提出/归口/起草单位的保存保真，不代表本次新增了这些字段的自动正文排版。

嵌套表格明确拒绝。无内容的 Tiptap 自动尾段可跳过；非空根段落没有 IR 正文位置时明确诊断。历史 blockquote、codeBlock 与嵌套 termDef 改为保留类型/结构，不能继续通过旧降级方式假装没有信息损失。脚注的既有格式与位置限制继续生效。

## 验收项目

| 项目 | 证据 | 结果 |
|---|---|---|
| 旧 JSON 两组 byte golden / 缺 ID / 原型键安全 / Resolver 边界编号 | client `jsonExporter.test.ts`、shared `renderers/json.test.ts` | 通过 |
| 新元数据、TBX、公式、表图资源、样式、文献、索引的生产 Schema | `createWp6Fixture()`、production schema tests | 通过 |
| 新建原生 IR → PM → Schema → IR | shared/client WP6 model tests | 通过 |
| 逐记录核对生产属性、非文本公式 marks、代码及文献链接显示文本 | `wp6Projection.test.ts` | 通过 |
| 重复/缺失 ID、typed refs、资源/索引引用、外部 ID 定义和引用同改 | shared Resolver / external ID tests | 通过 |
| 实际 SQLite 保存、编辑、版本、副本、服务端重启后重开 | `wp6Persistence.acceptance.test.ts`（显式隔离 API） | 通过 |
| 浏览器编辑保存、刷新、语义 JSON 原文核对及未支持出口报错 | 隔离本地实例 | 通过 |
| 旧 shared/client/server 回归和构建 | pnpm tests/build | 通过 |

API 验收仅在显式指定的空本地数据库和非默认服务端端口运行；默认测试不访问用户数据库。prepare 和 reopen 分开执行，reopen 之前必须实际停止、重启隔离服务端。不能以单次 JSON stringify 代替冷重开证据。

## 最终验证证据

- shared：42 个测试文件、893 项通过；`tsc --noEmit` 通过。
- client：33 个测试文件、211 项通过；隔离 API 验收默认跳过 1 项，另行显式运行。`vue-tsc -b` 与 Vite 构建通过，仅保留现有大包体提示。
- server：2 个 Jest suite、23 项通过；Nest 构建通过。未新增依赖或修改 lockfile。
- 两组 JSON golden 及其迁移前源文件 SHA-256 固定，未更新黄金文件来掩盖回归。兼容差异见上述编号边界记录。

实际 API/SQLite 验收采用独立临时工作目录 `tmp-e2e/wp6-storage`、服务端端口 3096；Vite 5196 只代理到该实例。prepare 完成保存/编辑、JSON 版本快照和副本；停止原进程后实际重启服务，再执行 reopen，原稿、副本和版本逐字段相等。主工作区业务数据库全程只读。

浏览器随后修改验收稿并保存、刷新，发现并修复实际加载入口丢根属性的问题。最后保存稿带 `extensionVersion: 1`、根级回退数据与“根属性已保留/浏览器验收”标记；再次停止并重启隔离服务（原 PID 51141 → 新 PID 63963），重开编辑器。页面实际语义 JSON 经生产 Schema 还原后与 API 保存稿全字段相等，PM→IR 的元数据、TBX、表图、公式、文献、索引等完整相等，术语编号为 `1.1.1`。先以源码面板的实际导出原文核对，再在新浏览器标签执行首次 JSON 下载。下载文件 `/Users/funtasy/Downloads/WP6 隔离验收稿.json` 与面板原文逐字段相同，并再次执行 browser 验收。浏览器工具不回传重复 Blob 下载事件，验收以实际下载文件读取为准。

最终浏览器语义 JSON（仅夹具）SHA-256：`7d120b92e344af68cea77d9cf10f9b408da55c1e57961b048482d67ef9a50e81`。开发机器的原始日志保存在 `/private/tmp/wp6-*.log`，不作为仓库运行依赖。

可复用验收入口为 `extensions/wp6Persistence.acceptance.test.ts`：显式提供 `WP6_API_URL`、`WP6_EVIDENCE_FILE`，分 `prepare`（默认）、`reopen`、`browser` 运行；browser 另提供 `WP6_BROWSER_EXPORT_FILE`。prepare 强制空数据库、回环主机和非默认服务端端口。不得对用户业务数据库执行 prepare。

| 命令 | 结果 |
|---|---|
| shared `pnpm test` / `pnpm exec tsc --noEmit` | 通过 |
| client `pnpm exec vitest run --maxWorkers=2` / `pnpm build` | 通过 |
| server `pnpm exec jest --runInBand` / `pnpm build` | 通过 |
| opt-in API prepare → 真实服务重启 → reopen | 通过 |
| 浏览器编辑保存 → 真实服务重启 → browser 原文全字段核对 | 通过 |

新增语义被未支持出口拒绝时，导出面板保持打开并提示保留 JSON；源码转换失败时复制和下载按钮禁用，不能把诊断文字下载成成功 XML。源码禁用通过生产组件回归，出口面板通过实际浏览器验证。截图仅含测试夹具：

![未支持 HTML 时保留 JSON 选项](qa/wp6-output-boundary.png)

主工作区现有素材修改和未跟踪目录均保留；主素材文件 SHA-256 保持 `8134494f8e129a1880f44725c7f61bda39833149bbb30451e07834f2657809c8`。该基线为 2026-10-05 初始验收状态；2026-10-06 main 已为 e0e9ab09（调整方案 PR #46 合入），开发分支已合入该 main，最新审计以此为准。

## 后续边界

WP8 负责原文元素/属性矩阵、正式 ID 约定、唯一 XML46687.2 双向转换、校验及真实外部互操作。当前描述符 kind/value 与外部 ID 映射是项目数据契约，不是具体 TBX/XML 标准元素认证。新增 MathML 保存原文和编辑源；本次不保证编辑器已把所有原生 MathML 排成数学视觉效果。

## Codex review 修复验收（2026-10-06）

PR #45 在 `9ad90668` 和 `df27182a` 上的两轮 review 共提出 7 条 P2 问题。本次逐条修复：

| Review 问题 | 处理与回归证据 |
|---|---|
| 脚注 crossRef 的 canonical targetId 被误判缺目标 | 与普通引用统一使用 targetId ?? refId；生产 Schema 往返后 Resolver 无 invalid-footnote |
| 简单列项丢段落稳定 ID | 无法保留的原生 IR 段落 ID 通过 IRToPmError 拒绝；五种受支持列表的派生段落 ID 及对应引用往返有效 |
| 显式章角色被标题推断覆盖 | 生产 chapter.secType 持久化并优先读取；四种角色均覆盖非标准标题或与标题相反的角色 |
| 罗马列项被静默降级 | roman/romanUpper 均返回带位置诊断，不改为 numeric |
| 公式 numbered:false 被 Schema 丢弃 | 新增 nullable 生产属性，显式 false 保留；后续 Resolver 标签保持；旧文档默认编号及 JSON byte golden 不变 |
| 表头行数被单元格类型推断覆盖 | 独立保存 headerRowCount，覆盖显式 0/1/2 与混合单元格标志；旧文档缺省继续推断 |
| 显式列表级别被规范化 | 与生产固定级别冲突时拒绝，覆盖嵌套 StarterList 分支 |

先运行生产 Schema 回归复现：最初 9 个用例中 8 个失败；修复后通过。随后补旧属性缺省、非法显式值和五种生产列表段落引用用例，`wp6Review.test.ts` 共 21 项通过；shared `irToPm.test.ts` 新增 4 项列表边界用例。

本次 shared 完整回归 897 项通过，tsc --noEmit 通过；client 完整回归 227 项通过、隔离 API 用例仍默认跳过 1 项，最后追加的 5 项生产列表用例定向验证通过（client 总计 232 项）；client 类型检查与 Vite 构建通过，仍只有已有大包体提示；server 23 项 Jest 回归通过。未修改 golden、依赖、lockfile 或数据库结构。本次未重复运行历史 API/浏览器冷重开验收，新增字段的生产加载及往返由 Schema 回归覆盖；前述冷重开证据属于 2026-10-05 的验收记录。

范围仍为 WP6 文档作者模型保真及转换错误边界，不扩展技术对象语义建模或 WP8 XML 标准符合性任务。PR 仍待合并；本次测试结果不代表 Codex review 已重新审核批准。

## 326168b3 复审修复验收（2026-10-06）

新复审提出 3 条 P2：注/示例段落 ID 丢失、文本样式 HTML 回读丢失、表格单元格单位 HTML 回读丢失。本次已逐条修复：

- IR 投影对独立 note/example、术语 notes/examples、表 notes 五种入口校验派生段落 ID；不匹配时拒绝转换并返回 path/nodeId。有效 ID 回读保留，指向注段落及注中指向章节的 crossRef 均无 Resolver error。warning 段落 ID 保留；相邻公式说明、whereList、表脚注是行内数据，图注明确拒绝，未发现同类段落 ID 静默丢失。
- `wp6HtmlRoundtrip.test.ts` 使用生产 Schema 的 DOMSerializer/DOMParser 复现 HTML 路径，初始 12 项全部失败。修复后 14 项通过，覆盖七个样式属性、样式与加粗叠加、连续三次 HTML 往返、td/th 单位及原单元格正文、跨度/列宽/格式保持、外部普通表格、有无单位、相邻数值度量和公式/表头布尔数值属性。单位显示标签排除于粘贴正文，避免重复污染内容。
- shared 完整回归 42 个文件、899 项通过；client 完整回归 35 个文件、246 项通过，隔离 API 验收默认跳过 1 项。shared tsc、client vue-tsc/Vite 构建通过，仅现有大包体提示。未改 golden、依赖、lockfile、数据库；本轮 HTML 验证使用生产 DOM 路径，未重复真实浏览器或 SQLite 冷重开验收。

此次仅处理复审已确认的问题和紧邻的单位标签内容问题，不扩展 WP8 或技术对象建模范围。新提交仍需自动复审；完成修复不等于已获 Codex 批准。

## bd0c6eb3 复审及相邻约束验收（2026-10-06）

本轮 3 条 P2 已修复：表脚注引用只投影为 atom，非空正文和行内公式保留普通 marks；proposer/technicalCommittee 非空时阻断未消费这些字段的 HTML/DOCX/XML；空 warning/quote 在 IR→PM 阶段产生可定位诊断。

同时核对生产 Schema 的最小子项规则，为空列表、Starter 列项缺少首段或首块非段落、空表格/行/单元格、空 TBX languageSet/TIG、空索引组、完全无内容 doc 根和无章节 standardDoc 根补齐 IRToPmError。空段落自身是合法内容，已验证多段 Starter 列项的空首段可正常加载及回读。不添加占位文字或虚构根 ID；根级错误使用路径；多个错误与已有 unsupportedContent 诊断一同保留。

回归证据：

- shared IR 定向测试先复现 tableFootnoteRef 未知 mark 与空结构未拒绝，修复后 12 项通过；生产 Schema 的新用例覆盖混合正文/公式与表脚注引用、合法和非法空结构、两个根类型、文档设置来源的元数据出口保护。
- 输出边界新增的两个非空元数据用例初始失败；修复后 HTML/DOCX 实际渲染入口和旧 XML 序列化入口明确抛出 UnsupportedOutputError，JSON 原值及源文档不变。
- 新建与复制测试同步新出口契约。普通前言中存在提出/归口单位文字不意味着两个元数据字段已被旧出口消费；含字段的原稿与副本仍保留字段，旧出口明确阻断。不含这些字段的旧正文、题名、封面与前言导出回归继续通过。
- 最终 shared 完整回归 42 files / 908 tests；client 36 files / 261 tests，隔离 API 默认跳过 1 项；server 2 suites / 23 tests，合计 1192 项通过。shared tsc、client vue-tsc/Vite 构建通过；仅已有大包体提示。golden、依赖、lockfile 和数据库结构未改。

本轮未重复真实浏览器或隔离 SQLite 冷重开；生产加载、引用关联和实际出口的行为由自动测试核验。新提交仍待自动复审和 PR 合并。


## 2fc726e7 复审与调整方案复核（2026-10-06）

本轮重新 fetch 并读取 main 的调整方案（`e0e9ab09`），逐项审计结果见 [WP6 方案审计](wp6-plan-audit.md)。审计记录区分内部模型、实际输出限制、必要交互尚未验收与 WP8 工作，不能用本次自动回归替代标准 XML/Word/真实稿件验收。

| 本轮问题 | 修复及验证 |
|---|---|
| [扩展引用顺序](https://github.com/funtasy2333/SEP/pull/45#discussion_r4190217764) | 最初复现公式注 B 排在后续段落 A 之后。metadata、公式注、图/图组说明、TBX 词项/描述符在所属位置遍历；正文到附录顺序及重复引用去重覆盖，顶层对象 key 重排不影响顺序。文献自身与索引在其输出位置扫描，不抢正文首次引用顺序 |
| [图资源 HTML 丢负载](https://github.com/funtasy2333/SEP/pull/45#discussion_r4190217769) | 最初新增4项资源回读失败。data-resource-payload 使用 JSON 字符串编码，生产 DOMSerializer→HTML 文本→DOMParser 连续3次往返；base64/text/data URL/空值/CR/NUL 保真，资源 ID 与 figure 关联有效。该文件现共21项通过 |
| 主审：文献行内公式与索引目标校验时序 | 延后的行内数组中的 ID 在其实际遍历时登记；索引目标校验在文献/索引行内扫描后执行。覆盖索引指向文献 field 中的行内公式，既不误报悬空，也不重复登记 |
| 方案审计：既有提出/归口设置导致 DOCX/HTML 回归 | 实际输出 DOCX native custom-properties 与 HTML meta 后解除对应阻断。生产 ZIP 解包、XML parser/HTML parser 读取元数据，验证新建/复制/库设置/嵌入设置与特殊字符。人工前言不重写；旧 XML 不新增能力，继续明确拒绝 |

主代理审阅子代理 Resolver 改动后运行完整回归：shared **42 files / 911 tests**；client **36 files / 269 tests**、隔离 API 默认跳过1项；server **2 suites / 23 tests**，合计 **1203 项通过**。shared `tsc --noEmit`、client `vue-tsc -b` 与 Vite 构建通过，仅已有大包体提示。日志为 `/private/tmp/wp6-rereview3-*.log`。

未修改 golden、依赖、lockfile 或数据库结构。主工作区素材哈希与未提交文件保留。本轮没有重复真实浏览器、SQLite 冷重开或 Word 打开验收；此前冷重开证据仍明确属于 2026-10-05。修复与审计已进入同一个 PR，尚未执行合并，未声称下一轮 Codex 复审已批准。


## a3adb2af 复审及同类 HTML 解析检查（2026-10-06）

本轮最新 review（北京时间13:59）针对 `a3adb2af` 提出两条 P2；通过对应 review ID 获取评论，避免把旧评论的更新位置当成新意见。

| 新意见 | 修复与回归 |
|---|---|
| [题名展示标签混入正文](https://github.com/funtasy2333/SEP/pull/45#discussion_r4192024667) | titlePart 只读取 std-title-part-content。同类 identifierPart、publisher、copyright、TBX descriptor、bibField 只读取各自内容槽；standardIdentifier、TBX语言集、索引/分组也只读取实际子项容器。无槽位的外部普通带类型 HTML 保留直接解析 |
| [自由公式说明丢公式/样式](https://github.com/funtasy2333/SEP/pull/45#discussion_r4192024679) | splitInlines 复制完整 IRInline，trimInlines 保留公式/脚注/引用等空文本载荷；旧纯文本 whereList 拆分规则继续回归。shared 测试先复现 style 丢失；生产 Schema 验证仅含公式 atom、公式在前/在后、带样式文本经 PM→IR→PM→IR 保真 |

同类主审检查补修：

- 明确类型的 p/a 解析规则优先于通用段落/链接规则，避免 title/publisher/copyright/TBX/公式注/图说明/索引词被普通 paragraph 吞掉，以及文献/术语/条文引用、外链和文献链接 atom 被泛化成 link。普通外链仍照常解析。
- Tiptap 默认属性解析会把数字/布尔外观的文本转型；作者模型中的文本字段明确按字符串解析，保留版权年份、编号字符串、公式 LaTeX 与引用目标等。数据值2026、0012、true、false经过连续3次 HTML 往返保持；数值度量属性仍采用已有数值解析。
- `wp6MetadataHtml.test.ts` 初始8项有7项失败，修复后扩展至20项通过，覆盖标签、类型、属性、结构子项数、ID、空正文和外部普通 HTML；`wp6FormulaDescription.test.ts` 3项生产 Schema 回归通过。没有靠更改 golden 或忽略字段接受损失。

主代理完成代码审阅并运行 shared **42 files / 912 tests**、client **38 files / 292 tests**（另1项隔离 API 默认跳过）、server **2 suites / 23 tests**；合计 **1227 项通过**。shared tsc、client vue-tsc/Vite 构建通过，仅已有包体提示。日志 `/private/tmp/wp6-rereview4-*.log`。

本轮仍是生产作者模型和转换保真修复，未新增旧 XML 能力、依赖、数据库迁移或改变 WP6/WP8 范围。未重做浏览器/SQLite 冷重开或 Word 验收；此前历史证据不能当成本轮实测。合并与新一轮 Codex 审阅确认仍未完成。


## 296a3fb3 复审修复验收（2026-10-06）

最新 review ID 5424696957（北京时间14:41）针对 296a3fb3 提出两条 P2，通过该 review 的 comments 接口核对，未将旧评论重新定位误认为新问题。

| 意见 | 处理与生产回归 |
|---|---|
| [术语来源丢失或混入展示标签](https://github.com/funtasy2333/SEP/pull/45#discussion_r4192293657) | termSource 优先匹配专用规则并仅读内容槽；嵌在 termDef 中的富文本和空 source 连续3次 DOM→HTML文本→DOM→PM→IR 保留，不混入“来源：”，源输入不变。主审要求保留原来的带类型选择器以及无槽位外部 p/div 正文解析 |
| [过滤后的外链无法恢复原始 href](https://github.com/funtasy2333/SEP/pull/45#discussion_r4192293666) | externalLink/bibExternalLink 用 JSON 字符串 data-external-href 保留作者地址，点击 href 继续过滤。最初31项中7项失败；新增安全协议后33项通过，连续3次覆盖相对/URN/锚点/首尾空白/特殊字符/空值及 mailto/tel；危险地址不生成点击 href。缺失、非法 JSON 或非字符串载荷回退普通 href |

本轮仅修改作者模型 HTML 保真入口与对应测试；shared JSON golden、旧 XML、依赖、lockfile 与数据库结构未改。未重复真实浏览器、隔离 SQLite 冷重开或 Word 验收，前述冷重开证据仍属于2026-10-05。测试完成不等于新一轮 Codex 已批准，PR 尚未合并。


主代理审阅子代理术语来源实现，要求补齐无槽位带类型 HTML 回退后，新增5项全部通过；客户端最终完整回归 **39 files / 310 tests**（另1项隔离 API 默认跳过）。shared **42 files / 912 tests** 和 server **2 suites / 23 tests** 均通过，合计 **1245 项**。shared tsc、client vue-tsc/Vite 构建通过，仅已有大包体提示；日志 `/private/tmp/wp6-rereview5-*.log`。主工作区受保护素材的 SHA-256 与未提交文件保持。


## 063f5427 复审与 fallback 字段验收（2026-10-06）

最新 review ID 5425116106，提交时间北京时间15:26，针对063f5427提出一条 P2：[fallback crossRef 丢 targetKind](https://github.com/funtasy2333/SEP/pull/45#discussion_r4192628639)。已通过该 review 的 comments 接口核对。

- 子代理先复现根/封面两个入口的 targetKind 丢失，再按 IRReferenceTargetKind 保留合法值并诊断非法值；覆盖12种类型、无类型旧数据及源输入不变。主审在相同读取函数发现 tableFootnoteRef.id 与 IRInline.footnote 也被丢弃，一并保留或报告非法结构，未扩大 Schema/旧 XML 能力。
- 生产 Schema 初始4项全部失败：合法图类型丢失，图目标被错误标成表的类型诊断也消失。修复后 `wp6FallbackReferences.test.ts` 扩展至10项通过，覆盖根/封面的题名、编号部件、机构、版权声明，投影后的 PM refType 均保持 figure；通过 JSON 序列化再加载，IR及 Resolver 结果一致。
- 错误的目标类型继续由 Resolver 报告。纯字符串版权持有人中的富引用保留在 IR，投影返回带位置的 IRToPmError；脚注的嵌套引用往返保留。非法 targetKind（包括PM别名bibEntry）、引用 ID 与脚注 content 在实际加载/Resolver/投影入口均有明确诊断，原输入不变。

最终 shared **42 files / 915 tests**、client **40 files / 320 tests**（另1项隔离 API 默认跳过）、server **2 suites / 23 tests**，合计 **1258 项通过**。shared tsc、client vue-tsc/Vite 构建通过，仅已有大包体提示。日志 `/private/tmp/wp6-rereview6-*.log`。未改 golden、依赖、lockfile或数据库结构。

本轮验证覆盖生产 Schema 和 JSON 重加载，未重复实际浏览器、SQLite 冷重开或 Word 验收；历史冷重开证据仍属于2026-10-05。调整后的 WP6/WP8 范围不变，修复已验收不意味着新提交已获 Codex 复审批准，PR 尚未合并。


## 81f7814e 复审修复验收（2026-10-07）

latest review ID 5428705712，2026-10-06北京时间20:59提交，针对81f7814e提出一项P1和一项P2；通过该 review 的 comments 接口核对。

| 意见 | 修复与实测 |
|---|---|
| [编辑公式仍读取陈旧属性/清空后恢复旧公式](https://github.com/funtasy2333/SEP/pull/45#discussion_r4195550776) | 存在的formulaContent始终作为LaTeX编辑源，包括空正文；移除与陈旧snapshot属性的冲突诊断。shared TDD先复现修改与清空两项失败，再验证旧无属性、MathML-only及缺节点诊断。真实Editor事务加载IR→PM后修改/清空正文，attrs仍为旧值，但IR、HTML data-latex、生产DOCX ZIP文本、原JSON重载及IR投影重载均消费新正文，源JSON不变 |
| [无编号目标的错误引用类型漏报](https://github.com/funtasy2333/SEP/pull/45#discussion_r4195550783) | 豁免只用于真正不存在的crossRef目标；已有实体必须检验类型。最初7项新增测试有2项失败：错误引用先出现，后续正确引用生成label后错误被漏报。段落和不编号公式两种目标、两个引用顺序及合法/缺失目标均通过；生产Schema两种顺序回归通过 |

主审补齐原生IR入口边界：latex与sourceInlines文本冲突时，IRToPmError携带节点/位置，不把原生IR的冲突数据当作陈旧PM snapshot而覆盖。新增2项先失败后通过。既有错误类型的默认clause引用指向无编号段落，现同时返回类型不匹配和无引用文本；对应旧测试已按收紧后的诊断更新，未修改golden。MathML原文继续保留，不自动解释、反译或更新它；不将本轮LaTeX修复宣称为完整MathML交付。

本轮未重做真实浏览器、SQLite冷重开或Word稿件验收；真实Editor由生产扩展的自动事务测试覆盖，DOCX从实际ZIP验证公式文本，不能替代Word排版验收。旧XML、依赖、lockfile和数据库结构未改，主工作区受保护素材和未提交文件保留。范围仍为调整后的WP6作者模型与引用校验，未扩大WP8。


主代理最终回归：shared **42 files / 929 tests**、client **41 files / 324 tests**（另1项隔离API默认跳过）、server **2 suites / 23 tests**，合计 **1276项通过**。shared tsc、client vue-tsc/Vite构建通过，仅已有大包体提示。日志 `/private/tmp/wp6-rereview7-*.log`。修复提交仍需新一轮Codex审阅确认，尚未合并。


## c24181ca 复审修复验收（2026-10-07）

最新 Codex review ID `5441631826` 针对 PR #45 的审阅提交 `c24181ca77fa77bdb73923d26f498bed265bf7b3`，北京时间 2026-10-07 19:31 提出一条 P2：[公式源行内格式在导出中可能静默丢失](https://github.com/funtasy2333/SEP/pull/45#discussion_r4206339440)。本轮继续检查这一意见关联的实际生产出口，并对生产 Schema 与编辑集成做了全路径复核。

| 复核组 | 问题与处理 | 生产回归证据 |
|---|---|---|
| 输出边界 | IR 公式的 `sourceInlines`（来自 PM `formulaContent`）含格式 marks、嵌套公式/脚注或与 LaTeX 文本不一致时，HTML、DOCX、旧 XML 不能完整表示；现按实际消费能力阻断，JSON 保留原结构。旧 XML 对 native typed `whereList`、无法表示的单元格语义块、显式表头行数不一致及 `secType` 与标题推断冲突也作精确阻断；不更改 legacy XML 格式。申请单位由 HTML meta 和 DOCX custom property 实际输出，旧 XML 维持既有维护值契约。 | shared `outputBoundary.test.ts` 与 client `wp6OutputBoundaryAudit.test.ts`；实际 HTML/DOCX/XML 生产入口；新建/复制与文件设置兼容回归 |
| 作者 Schema 与 HTML 往返 | 修正 typed paragraph 与通用 `<p>` 的解析优先级；表脚注正文改用唯一 content slot，typed parser 优先且旧无 slot 段落仍兼容，同时排除展示编号。表格完整结构连续 DOM 往返后保留脚注行、定义 ID、marks/crossRef、引用 target；未扩展 XML 语义。 | `wp6HtmlRoundtrip.test.ts`、`tableFootnoteHtml.test.ts`；model 定向报告含 stdParagraph 2 files/24 tests、HTML 往返 3 files/26 tests |
| 编辑器集成与剪贴 | 冷加载/新建/XML 导入补 ID 后先持久化规范化正文；失败保持 dirty 或完整原 EditorState。离开路由等待保存并在设置确认后重新检查 dirty；版本恢复区分取消与真实失败；JSON/raw JSON 下载不被脚注打印校验误拦。粘贴只重映射当前 slice 中唯一复制定义与明确 typed 内部引用；cut/move 保留 ID、片外引用不变。slice 内重复定义存在歧义或与当前文档 ID 冲突时显示原因并拒绝，不 dispatch；段落合并会丢失内部引用目标时也拒绝。 | `wp6IntegrationAudit.test.ts`、`EditorView.saveRetry.test.ts`、`VersionPanel.restore.test.ts`、`ensureNodeId.paste.test.ts` 与 `tableFootnoteHtml.test.ts`；最后一组真实 `DOMSerializer → view.pasteHTML` 2 files/11 tests 通过，含表脚注实际粘贴 |

主代理最终验收：shared **43 files / 942 tests**，`tsc --noEmit` 通过；client **48 files passed、1 skipped**，**366 tests passed、1 默认 opt-in API test skipped**，`vue-tsc -b` 与 Vite build 通过；server **2 suites / 23 tests**，Nest build 通过，合计 **1331 tests passed**。日志：`/private/tmp/wp6-final-shared-test.log`、`/private/tmp/wp6-final-server-test.log`、`/private/tmp/wp6-final-server-build.log`、`/private/tmp/wp6-final-client-test.log`、`/private/tmp/wp6-final-client-build.log`。Vite 仅有既存 chunk-size warning。

本轮未重复 opt-in API、真实浏览器、SQLite 冷重开、Word 打开/排版或正式 XML 外部互操作；这些自动回归不能替代相应验收。验证对象为基于 `c24181ca` 的本轮修复；最终提交与远端状态以 PR 记录核验。本记录不表示新一轮 Codex 审查已批准或 PR 已合并，也不宣称 WP8 新标准 XML 完成。


## 72e127b5 typed-reference 输出边界复审（2026-10-08）

Codex review `5443480187` 于北京时间 2026-10-07 22:02:30 针对 `72e127b5` 提出唯一 P2：[错误 targetKind 的交叉引用仍可导出](https://github.com/funtasy2333/SEP/pull/45#discussion_r4207853177)。可复现输入为一个已存在的 chapter ID 被 `crossRef.targetKind='figure'` 引用：Resolver 已输出 `severity='error' / code='dangling-typed-ref'` 和引用 owner ID；旧输出边界只检查字段 allowlist，HTML/DOCX 根据 targetId 取 label，因此错误类型可被印成有效内容。

- shared `outputBoundary.ts` 现只把 Resolver 的 `dangling-typed-ref` error 映射为 HTML、DOCX、legacy XML 的 `unsupported-output`；保留 owner nodeId 与 Resolver 原 message，以 `resolver.problems[dangling-typed-ref]` 作为来源标识。IRProblem 没有字段 path，因此不捏造 crossRef/bibRef/termRef 具体 mark 的位置。Resolver 的 warning、其他 error code 不扩大阻断范围。PDF 请求使用 HTML 生产内容出口，同步被拒绝。
- `outputBoundary.test.ts` 覆盖 wrong-kind figure→chapter、脚注内 crossRef、nested note 内 bibRef/termRef，且直接 renderHtml/renderDocx 传空 labels 或错误 labels 仍抛 `UnsupportedOutputError`。正确显式 chapter、正确无编号 paragraph/formula、正确和缺省 targetKind 的旧稿继续可输出；无关 Resolver warnings/errors 不阻断。该测试文件 16 项通过。
- client `wp6TypedReferenceOutput.test.ts` 覆盖生产 HTML、DOCX、PDF request builder、legacy XML 错误 target 拒绝；JSON semantic/raw 保留原始错误引用且源对象不变。正确 typed 与旧缺省类型均通过。定向文件 3 项通过。集成菜单/源码入口 `wp6IntegrationAudit.test.ts` 10 项通过：HTML/XML/DOCX/PDF 菜单反馈具体原因，不错误复制/下载；semantic/raw JSON 仍可用。PDF 测试只验证请求构建，不发送外部转换 POST。
- 首次 full shared 暴露两组历史 print tests 使用 `fullFixture()` 通用 helper `xref()`，其把 `tbl-1`、`fig-1`、`f-1`、`bib-2` 也声明成 `clause`。这是错误输入被新 boundary 正确发现，不是应放宽 guard。新增打印专用 `fullRendererFixture()`：深拷贝历史 fixture，只按五个明确 target ID 设置测试引用类型；旧 `fullFixture()`、语义 JSON 输入与所有 JSON goldens 不动。HTML/DOCX 测试 assert 无 `dangling-xref` / `dangling-typed-ref`，两 suite 共 66 项通过，snapshot 与 DOCX golden 未更新。
- 最终 shared 全套 43 files / 946 tests 通过，`tsc --noEmit` 通过；client 全套 50 files 中 49 passed、1 skipped，370 tests passed、1 个 opt-in API test 默认跳过，`vue-tsc -b` 与 Vite build 通过（既有 chunk-size warning）；server 2 suites / 23 tests 与 Nest build 通过。本轮合计 1,339 tests passed，另 1 个默认跳过的 opt-in API 测试。

日志：`/private/tmp/wp6-typed-ref-shared-test.log`、`/private/tmp/wp6-typed-ref-shared-types.log`、`/private/tmp/wp6-typed-ref-client-test.log`、`/private/tmp/wp6-typed-ref-client-build.log`、`/private/tmp/wp6-typed-ref-server-test.log`、`/private/tmp/wp6-typed-ref-server-build.log`。之前 c24181ca 复审的 1,331 通过是上一轮历史计数，未与本轮累加。

本轮保留 VersionPanel 既有 JSON-only snapshot fallback，不改 Resolver 类型语义，不新增操作面板、旧 XML 转换或 MathML 打印；仅更新既有出口诊断。旧 XML 实现移除与新国标 XML 统一切换归 WP8，不重建旧转换器。未重新执行 Microsoft Word/真实标准稿件排版、浏览器冷启动、SQLite 冷重开或外部 PDF 服务验收；本轮回归不表示新 Codex review 已批准或 PR 已合并。


## 2fa97872 公式注与无类型引用复审（2026-10-08）

Codex review `5450144611` 于北京时间 2026-10-08 08:52:04 针对 `2fa9787240634a022dab33ce5ffd61d793babd04` 提出唯一 P2：[公式注（IRFormulaNote）的合法 note 引用被误判为 entity](https://github.com/funtasy2333/SEP/pull/45#discussion_r4213525717)。问题输入是 `formula.notes[n] = {id, content}` 上被 `crossRef.targetKind='note'` 引用：`IRFormulaNote` 没有 `kind`，Resolver 通用扩展兜底记录成 `entity`，错误地产生 `dangling-typed-ref`。

| 覆盖项 | 修复与回归 |
|---|---|
| 公式注 Resolver 类型 | 只在 `visitBlock(formula)` 登记 `ctx.kinds[note.id]='note'`。generic extension 扫描仍负责既有 ID、stable label 与原遍历顺序；不重复 register ID、不计入正文脚注序号、不改 IR 形状。正确 note 引用、错类型引用、前向/后向引用、前言/正文/附录/表格单元格位置、属性键顺序与确定性结果均验证。正确引用不受类型误报；实际不存在的 note target 仍只报原 owner 的 `dangling-xref`；duplicate/missing ID 诊断保留。shared 回归 4 项通过。 |
| 原生 IR 无类型 crossRef 投影 | IR 未声明 `targetKind` 时 `irToPm` 显式写 `refType:''`，避免生产 schema 以默认 `chapter` 改义；PM→IR 将空字符串保留为未声明 kind。production schema → JSON reload → `pmToIr` → `resolve` 回归证明 targetKind、labels、ID 与 source 不变。chapter/figure/note 显式类型继续映射；旧 PM 缺省 refType 的 `chapter` 默认契约不变。未类型目标 figure 由 HTML 与 DOCX 实际 renderer 输出。 |
| 非字符串 refType 与 JSON 保真 | explicit non-string `refType`（包括 null、数字、布尔值）按非法输入诊断，不伪装为默认或缺省类型，并阻断非 JSON 输出。semantic JSON 窄保留 `crossRef.refType:null` 供纠错；其余既有 null normalization 和 JSON golden 保持。 |
| 公式注导出边界 | 虽然 Resolver 现在正确识别 note target，HTML/DOCX/legacy XML 当前并未消费非空 `formula.notes`，所以 boundary 仍精准报告 `.notes` unsupported-output；JSON native、semantic、raw 保留作者数据。 |
| 打印 fixture 哈希消费者 | 移除 renderer helper 对锁定 `ir/__tests__/fixtures.ts` 的修改，迁到 `renderers/__tests__/fullRendererFixture.ts`。原文件 SHA 恢复为 manifest 记录的 `cc6b19157952576cb3ec69dc15a124dfbc6851901c227605758425bb0aef531d`；未改 JSON manifest、HTML snapshots 或 DOCX golden。HTML + DOCX 两 suite 66/66、client `jsonExporter.test.ts` 7/7 通过。 |

### 最终冻结验收

- shared：46 files / 958 tests 通过；`tsc --noEmit` 通过。
- client：51 files passed + 1 skipped（52）；376 tests passed + 1 opt-in API skipped（377）；`vue-tsc -b`、Vite build 通过，只有既有 chunk warning。
- server：2 suites / 23 tests 通过，Nest build 通过。合计 958 + 376 + 23 = **1,357 tests passed**，另有 1 项默认跳过的 opt-in API 测试。
- 最终日志：`/private/tmp/wp6-formula-note-shared-test.log`、`/private/tmp/wp6-formula-note-shared-types.log`、`/private/tmp/wp6-formula-note-client-test.log`、`/private/tmp/wp6-formula-note-client-build.log`、`/private/tmp/wp6-formula-note-server-test.log`、`/private/tmp/wp6-formula-note-server-build.log`。

上一条 typed-reference 记录中的 1,339 通过不能作为当时审阅提交 `2fa97872` 的完整冻结验收：client full-suite 早于 `fullRendererFixture()` 被追加到 SHA 锁定的 `ir/__tests__/fixtures.ts`；随后 shared、client、server 计数对应不同文件状态。此后本轮先将 helper 迁出锁定文件并恢复 source SHA，再重跑 HTML/DOCX suites 与 client JSON exporter SHA consumer，最后由主代理对冻结工作树统一全量验收。旧数字保留为历史记录，不冒充完整验收，也不与新结果相加。

未重新执行 Word 打开/排版、正式 XML 外部互操作、真实标准稿件或浏览器/SQLite 冷重开；本轮自动回归不代表 Codex 已批准本次修复或 PR 已合并。旧 XML 实现移除与新国标 XML 统一切换归 WP8，不重建旧转换器；不新增 XML 映射或 MathML 打印。


## e39101da StandardDoc 根类型复审

Codex review 5450305128 针对审阅提交 e39101daab853a4a926fdc00ff0d4f1d022ca3bb 提出唯一 P2（[comment 4213672349](https://github.com/funtasy2333/SEP/pull/45#discussion_r4213672349)）：IR→PM 生成 StandardDoc 时仅 coverPage 有标准类型；生产 StandardDoc 根默认 national，且 pmToIr 以根类型为优先来源，导致非国标文档重开后被改写成 gb。

本轮只在 StandardDoc 根投影中复用 metaToCover 的现有类型映射，将同一 standardType 写入根与封面：gb→national、industry→industry、local→local、group→group、enterprise→enterprise、guide→guidance。生产 schema 默认、pmToIr 根优先规则和默认 doc 根分支保持不变；默认 doc 仍只在 coverPage 写入类型。相邻审查未发现此路径上的其他非空默认覆盖；缺省和空字符串沿用现有归一化，不将本轮描述为字节全等或空值契约变更。

shared irToPm.test.ts 定向测试 16 项，其中本轮新增 2 项，检查六类映射及 default doc 根仍只使用 coverPage。client 生产 schema 测试 7 项，通过关闭 StarterKit document 并加入 StandardDoc 构建真实 StandardDoc topNode；验证原始 JSON schema reload 与 exportSemanticJson 输出再次 schema reload 后，root/cover 类型、非空元数据、extensionVersion、typed crossRef 保持，且 source IR 未被修改。两组定向测试通过。shared tsc --noEmit 和 client vue-tsc -b 通过。

### 主代理最终冻结验收

- shared：46 files / 960 tests 通过；tsc --noEmit 通过。
- client：53 files 中 52 passed、1 skipped；384 tests 中 383 passed、1 个 opt-in API test 默认 skipped；vue-tsc -b 与 Vite build 通过，仅既有 chunk-size warning。
- server：2 suites / 23 tests 通过；Nest build 通过。
- 合计 1,366 tests passed，另有 1 项默认跳过的 opt-in API test。

六份冻结日志：/private/tmp/wp6-standarddoc-final-shared-test.log、/private/tmp/wp6-standarddoc-final-shared-types.log、/private/tmp/wp6-standarddoc-final-client-test.log、/private/tmp/wp6-standarddoc-final-client-build.log、/private/tmp/wp6-standarddoc-final-server-test.log、/private/tmp/wp6-standarddoc-final-server-build.log。fixture SHA 仍为 cc6b19157952576cb3ec69dc15a124dfbc6851901c227605758425bb0aef531d；无 golden 或 manifest 变更。

上一轮 1,357 项通过是 e39101da 修复提交的历史验收（review 5450144611 审阅的是 2fa97872），早于本轮根类型修复；本轮统一验收已经在修复冻结后重新运行。历史数值保留，但不能代表当前最终状态，也不与本轮相加。

本轮没有运行正式 GB/T 46687.2 XML 互操作、Microsoft Word 打开/排版、真实浏览器冷启动、SQLite 冷重开或真实标准稿件验收。测试结果不表示 Codex 已批准本轮修复或 PR 已合并。WP8 负责移除旧 XML 实现并统一切换至新国标 XML，本轮不重建旧转换器，也不新增 XML 映射或 MathML 打印。
