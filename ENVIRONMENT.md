# 环境配置指南

本文档说明运行 **标准化文件编辑系统 (SES)** 所需的全部环境依赖及其安装方法。

---

## 1. 必需环境

### 1.1 Node.js (>= 20.19.0)

项目使用 Node.js 运行时，前端和后端均基于 TypeScript 开发。

- **推荐版本**：Node.js 22 LTS
- **下载地址**：https://nodejs.org/

安装完成后验证：

```bash
node --version   # 应输出 v20.19.0 或更高
```

### 1.2 pnpm (>= 9.0)

项目使用 pnpm 作为包管理器，采用 Workspace 管理 monorepo 结构。

```bash
# 通过 npm 全局安装
npm install -g pnpm

# 或通过 corepack（Node.js 16.13+ 内置）
corepack enable
corepack prepare pnpm@latest --activate
```

安装完成后验证：

```bash
pnpm --version   # 应输出 9.x.x 或更高
```

### 1.3 Git

用于代码版本管理和项目克隆。

- **下载地址**：https://git-scm.com/downloads

```bash
git --version
```

---

## 2. 可选环境

### 2.1 Poppler（PDF 版式预览）

PDF 版式预览使用工作区依赖 `@vivliostyle/cli` 排版，并通过 Poppler 的 `pdftotext` 和 `pdfinfo` 定位目次页码、核对页数。只导出 DOCX 时可以不安装 Poppler。

- macOS：`brew install poppler`
- Linux（Ubuntu/Debian）：`sudo apt install poppler-utils`
- Windows：安装 Poppler 并将包含 `pdftotext`、`pdfinfo` 的目录加入 `PATH`

用 `pdftotext -v` 和 `pdfinfo -v` 验证；服务端启动时会检查这两个命令。

### 2.2 Python 3（辅助脚本，可选）

`scripts/` 目录下包含一些辅助调试和分析脚本（如 DOCX 结构检查等），运行这些脚本需要 Python 3 环境。**日常开发和使用不需要安装 Python**。

- **下载地址**：https://www.python.org/downloads/

```bash
python --version   # 应输出 Python 3.x.x
```

---

## 3. 项目安装与启动

### 3.1 克隆项目

```bash
git clone https://github.com/funtasy2333/SEP.git
cd SEP
```

### 3.2 安装依赖

```bash
pnpm install
```

该命令会自动安装所有子包（`packages/client`、`packages/server`、`packages/shared`）的依赖。

### 3.3 启动开发环境

同时启动前端和后端开发服务器：

```bash
pnpm dev
```

或分别启动：

```bash
# 仅启动前端（Vite 开发服务器，默认端口 5173）
pnpm dev:client

# 仅启动后端（NestJS 开发服务器，默认端口 3000）
pnpm dev:server
```

### 3.4 构建生产版本

```bash
pnpm build
```

---

## 4. 端口说明

| 服务     | 默认端口 | 说明                       |
| -------- | -------- | -------------------------- |
| 前端     | 5173     | Vite 开发服务器            |
| 后端 API | 3000     | NestJS 服务，路径前缀 /api |

---

## 5. 环境概览

| 依赖项      | 是否必需 | 最低版本  | 用途                          |
| ----------- | -------- | --------- | ----------------------------- |
| Node.js     | 是       | 20.19.0   | JavaScript 运行时             |
| pnpm        | 是       | 9.0       | 包管理器（Workspace monorepo）|
| Git         | 是       | -         | 代码版本管理                  |
| Poppler     | 否       | -         | PDF 版式预览的目次页码与页数检查 |
| Python 3    | 否       | 3.x       | 辅助调试脚本                  |
