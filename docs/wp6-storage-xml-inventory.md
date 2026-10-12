# WP6：存储与旧 XML 入口盘点

日期：2026-10-05。代码基线：`e4690a32`（main）。此次按调整后的 WP6 方案开发，旧 XML 切换由 WP8 完成。

## 存储边界

- `DocumentEntity.content` 为 SQLite `simple-json`，普通保存经过 `EditorView.vue` → `documentApi.update` → `DocumentService.update`，存储生产 PM JSON，不依赖 XML。
- `VersionEntity.content` 也是 `simple-json`，`xml` 是可空文本。`VersionPanel.vue` 创建版本时由当前 PM Doc 生成旧 XML；一般 XML 失败仍允许保存 JSON 的既有 fallback 存在，脚注校验失败会中止。WP8 需统一调整该行为，WP6 不切换旧 XML。
- 版本预览、比对及回滚消费 JSON `content`；回滚由 `setEditorContent` 调用保留根属性的 `replaceEditorDocument`，不解析 `xml`。复制使用 `createDocumentDuplicate` 深拷贝 JSON。
- 当前 `docToText` 预览/比对的编号已消费 Resolver，但文本展示主要覆盖旧节点；新增结构化属性不能认为已经得到逐字段差异展示。原始 PM JSON 与新 IR/JSON 的保真验收独立进行。

## 旧 XML 调用入口

| 入口 | 当前路径/调用 | WP8 处理 |
|---|---|---|
| XML 上传 | `EditorView.vue` → `parseXmlToEditorJson` | 新格式解析/完整校验后再替换文档 |
| 源码切换 | `EditorView.vue` 的源码计算属性 → `serializeToXml` | 仅新国标 XML |
| 源码复制/下载 | `EditorView.vue` 复制/下载源码；转换失败时禁用，诊断不得下载为伪 XML | 跟随唯一新格式源码 |
| XML 导出卡片 | `EditorView.vue:handleExportFormat('xml')` → `serializeToXml` | 新格式及资源包 |
| 公共 serializer API | `serializer/index.ts` 导出的旧 parser/serializer | 名称可保留，内部旧算法和 fallback 删除 |
| 版本快照 | `VersionPanel.vue:handleCreateVersion` → `serializeToXml` | 不吞掉 XML 失败，JSON 普通保存保持独立 |
| 版本预览/比对/回滚 | `VersionPanel.vue` → `content` | 保持 JSON，旧 XML-only 明确拒绝 |
| 文件设置校准/复制 | `documentSettings.ts` / `duplicateDocument.ts` | JSON 操作；其旧 XML 回归测试由 WP8 改为新格式 |
| 样例/测试 | `serializer/__fixtures__/sample-standard.xml` 及旧 XML 测试 | 仅负例保留；JSON migration golden 保留其来源说明 |

## 本机只读存量盘点

用 Python `sqlite3` 的 `file:…?mode=ro` 打开主工作区 `packages/server/data/ses.db`，只统计形状与数量，不输出文档正文，不写业务数据。

| 表 | 记录数 | 有效 PM JSON | 缺失/无效 PM JSON | XML 非空 | XML-only |
|---|---:|---:|---:|---:|---:|
| documents | 2 | 2 | 0 | 无此列 | 无此列 |
| versions | 0 | 0 | 0 | 0 | 0 |

“有效”这里只表示 JSON 可解析、根为 `doc`/`standardDoc`、`content` 为数组；此盘点不等于生产 Schema 全量验收，也不代表其他部署没有旧 XML-only 数据。WP8 切换前仍须重新盘点目标部署。

## 版本契约

IR 原有 `schemaVersion: 1` 保留；新增字段采用可选扩展契约，旧 IR 无需补齐新字段。生产 PM JSON 不新增数据库表/迁移，不把显示编号作为主键。扩展版本字段、精确默认值和两端映射在 WP6 验收记录及类型定义中列出。资源清单仅保存可序列化描述和资源数据，不执行资源包交付；后者属于 WP8。
