SES 标准化文件编辑系统 0.3.0 预览版。

## 本版更新（相对 0.2.2 Preview）

- **自包含离线包（Windows x64 与 macOS Apple Silicon）**。新发布的 `SES-0.3.0-preview-windows.zip` 与 `SES-0.3.0-preview-macos-arm64.zip` 已内置 Node.js 22.22.0、已构建前后端和生产运行依赖（含预编译 SQLite），完整解压后双击即可离线启动，无需安装 Node.js 或 pnpm。继续同步提供通用 macOS 源码包 `SES-0.3.0-preview-macos.zip` 供 Intel Mac 与旧版兼容使用。
- **桌面与开始菜单 / 应用程序快捷方式**。首次成功启动会自动创建带 SES 图标的桌面和开始菜单快捷方式（macOS 在桌面与 `~/Applications` 创建轻量原生 `SES.app`，可固定至 Dock），之后无需再到文件夹里翻找启动脚本；也可在网页右上角「设置」中随时重建。
- **开机后台自启**。网页右上角「设置」新增「开机后台自启」开关：开启后登录系统自动在后台静默启动 SES 服务（不弹黑框也不自动打开浏览器，无需管理员权限），直接点浏览器书签即可编辑，也便于本地 MCP 常驻连接。
- **启动 / 退出成功自动关窗**。`启动SES` 与 `退出SES` 脚本执行成功后自动关闭命令行窗口，仅在启动或退出失败时暂停并保留报错信息。
- **应用内升级改进**。支持自包含包之间的完整升级与失败回滚，并优化 Windows 升级中转进程与执行器清理流程。
- **PDF 导出**。本预览版继续暂停 PDF 导出。

## 应用内升级与退出

- 在网页「设置 → 升级 / 退出」中检查并安装新版本，提供两个通道：**稳定版**（GitHub Release，Windows x64 与 macOS Apple Silicon 优先下载自包含发布包）和**每次提交**（main 最新提交，需联网按源码构建，可能不稳定）。升级会自动备份数据库到 `output/upgrade-backups/`，新版本无法启动时自动恢复到升级前；不支持降级。
- 同一页面提供「创建 / 重建快捷方式」、「开机后台自启」开关与「退出 SES」。关闭网页不会退出 SES。
- 应用内升级、桌面集成与退出仅对通过启动脚本运行的 SES 可用。
- **从 0.1.1 及更早版本升级仍需手动一次**（见下方手动升级步骤）；升级到带有此功能的版本之后，即可在应用内升级。

## 下载与启动

- **Windows 10/11（64 位 x64，自包含）**：下载 `SES-0.3.0-preview-windows.zip`，完整解压后双击 `启动SES.cmd` 即可离线启动；双击 `退出SES.cmd` 退出。
- **macOS（Apple Silicon arm64，自包含）**：下载 `SES-0.3.0-preview-macos-arm64.zip`，完整解压后双击 `启动SES.command` 即可离线启动；双击 `退出SES.command` 退出。
- **macOS（通用源码包 / Intel）**：下载 `SES-0.3.0-preview-macos.zip`，安装 Node.js >=20.19.0、pnpm >=9 后完整解压并双击 `启动SES.command`（首次启动联网安装依赖并构建）。

从 0.1.1 及更早版本手动升级：先双击退出脚本停止旧版本，将旧目录中的 `packages/server/data/ses.db` 复制到新目录的同一位置后再启动新版本；升级前请备份整个旧目录。

访问 http://localhost:5173/（Windows 亦可使用 http://127.0.0.1:5173/），本地 MCP 地址为 http://127.0.0.1:3000/mcp。文档保存在 `packages/server/data/ses.db`，日志在 `.ses-run/`，启动前的数据库备份在 `output/startup-backups/`（数据库未变化时不重复备份，默认保留最近 10 份；升级备份默认保留最近 5 份）。详见包内 `使用说明.md`。

这是 Preview 版本，欢迎试用反馈。
