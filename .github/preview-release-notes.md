SES 标准化文件编辑系统 0.1.0 预览版。

- **Windows**：下载 `SES-0.1.0-preview-windows.zip`，完整解压后双击 `启动SES.cmd`；双击 `退出SES.cmd` 退出。缺少 Node.js 时按需安装便携版，pnpm 安装在 SES 目录。
- **macOS**：下载 `SES-0.1.0-preview-macos.zip`，安装 Node.js >=20.19.0、pnpm >=9 后，完整解压并双击 `启动SES.command`；双击 `退出SES.command` 退出。
- Windows 的依赖安装优先使用官方 HTTPS 来源；失败后自动重试中国大陆 npmmirror 镜像，不修改全局 npm 源。macOS 保持现有来源选择行为。

首次启动需要联网安装依赖和构建。这两个 ZIP 只包含 SES 源码、资源、启动文件和使用说明，不包含开发过程文档、测试、已有数据库或 node_modules。无需安装 Git 或 Python。

访问 http://localhost:5173/。文档保存在 `packages/server/data/ses.db`，日志在 `.ses-run/`，启动前的数据库备份在 `output/startup-backups/`。PDF 预览需要另装 Poppler，DOCX 编辑与导出不需要。详见包内 `使用说明.md`。

这是 Preview 版本，欢迎试用反馈。
