# WP6 验收记录

状态：调整后的 WP6 实现、代码审查与项目契约验收通过（2026-10-05），待 PR 审阅及合并。按用户确认的调整方案实施。基线为 `origin/main` 的 `e4690a320233b23122df0ba9a510b30ced16fbe2`；开发分支 `codex/wp6-json-model`。本记录不表示 GB/T 46687.2—2026 XML、外部互操作或 Word 真实稿件验收完成。

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

主工作区现有素材修改和未跟踪目录均保留；主素材文件 SHA-256 保持 `8134494f8e129a1880f44725c7f61bda39833149bbb30451e07834f2657809c8`。远端 main 再次 fetch 后仍为上述基线。

## 后续边界

WP8 负责原文元素/属性矩阵、正式 ID 约定、唯一 XML46687.2 双向转换、校验及真实外部互操作。当前描述符 kind/value 与外部 ID 映射是项目数据契约，不是具体 TBX/XML 标准元素认证。新增 MathML 保存原文和编辑源；本次不保证编辑器已把所有原生 MathML 排成数学视觉效果。
