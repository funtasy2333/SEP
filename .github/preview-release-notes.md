SES 标准化文件编辑系统 0.1.1 预览版。

## 本版更新（相对 0.1.0 Preview）

- **SES 文档包（.ses）导出与导入**：在编辑器「导出」中下载 `.ses` 文件（UTF-8 JSON），包含正文、内嵌图片、文件设置、包格式版本和全部已保存版本（含 AI 修改前内容）。在标准库首页「导入 .ses」：本地没有该文档时新建；本地已有同一文档时可选择「更新现有文档」或「另存为新文档」。更新时按版本身份合并两边的版本历史，并留下一条「导入 .ses」记录，可在版本历史中「查看本次修改」或「回滚到修改前」。正文不做自动合并，双方都改过时请对照后手工取舍。格式说明见仓库 `docs/ses-package-format.md`。
- **文内引用**：补齐内部引用的选择与定位，以及来源信息的编辑。
- 文档与版本新增稳定身份标识；从 0.1.0 升级时，启动后会自动为已有文档和版本补齐，不改动正文。

GB/T 46687.2—2026 XML 导出的内部实现已合入，编辑器中的 XML 导出入口尚未切换到新格式。

## 下载与启动

- **Windows**：下载 `SES-0.1.1-preview-windows.zip`，完整解压后双击 `启动SES.cmd`；双击 `退出SES.cmd` 退出。缺少 Node.js 时按需安装便携版，pnpm 安装在 SES 目录。
- **macOS**：下载 `SES-0.1.1-preview-macos.zip`，安装 Node.js >=20.19.0、pnpm >=9 后，完整解压并双击 `启动SES.command`；双击 `退出SES.command` 退出。
- Windows 的依赖安装优先使用官方 HTTPS 来源；失败后自动重试中国大陆 npmmirror 镜像，不修改全局 npm 源。macOS 保持现有来源选择行为。

首次启动需要联网安装依赖和构建。这两个 ZIP 只包含 SES 源码、资源、启动文件和使用说明，不包含开发过程文档、测试、已有数据库或 node_modules。无需安装 Git 或 Python。

从 0.1.0 升级：先双击退出脚本停止旧版本，将旧目录中的 `packages/server/data/ses.db` 复制到新目录的同一位置后再启动新版本；升级前请备份整个旧目录。

访问 http://localhost:5173/。文档保存在 `packages/server/data/ses.db`，日志在 `.ses-run/`，启动前的数据库备份在 `output/startup-backups/`。PDF 预览需要另装 Poppler，DOCX 编辑与导出不需要。详见包内 `使用说明.md`。

这是 Preview 版本，欢迎试用反馈。
