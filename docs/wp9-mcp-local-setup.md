# 本地接入 MCP（WP9.3）

让 Claude Code 等 MCP 客户端连接本机运行的 SES：AI 新建文档、读取结构、写入内容、校验、出件，人同时在编辑器里修改同一份文档。本文只讲**本地部署**（服务端与 AI 客户端在同一台机器上）；云端部署（WP9.4）需要用户体系与鉴权，不适用本文。设计背景见 [WP9 人机共写方案](wp9-ai-coauthoring.md)。

## 1. 前提

1. 安装依赖：`pnpm install`；
2. 启动服务端，二选一：
   - 开发：`pnpm dev`（前端 5173 + 后端 3000），只要后端用 `pnpm dev:server`；
   - 生产式：`pnpm build` 后在 `packages/server` 目录执行 `pnpm start:prod`（即 `node dist/main`）。数据库在**启动目录**下的 `data/ses.db`，在别的目录启动会得到另一份空库；
3. 服务端默认监听 3000 端口，MCP 端点是 **`http://localhost:3000/mcp`**（注意没有 `/api` 前缀）。改端口用环境变量 `PORT`；
4. 人要看到 AI 的修改，在浏览器打开编辑器（开发时 http://localhost:5173）。AI 写入后，已打开的文档会自动载入并提示来源；有未保存的本地输入时会提示冲突，不会被静默覆盖；
5. 导出 PDF 需要 Vivliostyle 与 Poppler（见 [ENVIRONMENT.md](../ENVIRONMENT.md) 2.1），缺少时 `export_document` 导出 pdf 返回 503 并列出缺少的依赖，其他格式不受影响。

## 2. 在 Claude Code 中接入

```bash
claude mcp add --transport http ses http://localhost:3000/mcp
```

默认只对当前项目（本机、当前目录）生效。想让整个项目共用同一份配置，可以手写项目根目录的 `.mcp.json`（**本仓库不提交这个文件**，地址和端口因人而异）：

```json
{
  "mcpServers": {
    "ses": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

接入后在 Claude Code 里用 `/mcp` 查看连接状态；服务端没有启动时会显示连接失败，启动服务端后重新连接即可。

Claude Code 对 MCP 工具默认逐次询问是否允许。`export_document` 可以把文件写到本机（见 4.2），**建议不要把它加入自动允许**。

## 3. 工具与典型流程

| 工具 | 用途 | 只读 |
|---|---|---|
| `list_documents` | 列出全部文档（id、标题、阶段、revision） | 是 |
| `create_document` | 新建文档，与编辑器首页「新建文档」结果一致；返回 `editorUrl` | 否 |
| `get_outline` | 结构树；缺少 nodeId 的文档会先补齐并保存（revision 可能加 1） | 是* |
| `get_node` | 读取节点、前言、引言、参考文献的内容 | 是* |
| `apply_operations` | 批量插入、替换、删除、移动，带 `baseRevision`，整批全有或全无；记为「AI 修改」，人可在版本面板回滚 | 否 |
| `validate_document` | 只读检查：文档问题 `problems`，以及 docx / pdf / html 能否出件 `exports` | 是 |
| `export_document` | 导出 docx / pdf / html / json；返回下载地址，可选写到本机路径 | 否 |
| `get_authoring_reference` | 写作说明全文（写作片段格式、GB/T 1.1 约定） | 是 |

\* 仅在文档缺少 nodeId 时才会写库，其余情况只读。

典型流程（`initialize` 返回的说明里也有同样的要点）：

1. `get_authoring_reference` 了解写法；`list_documents` 找文档，或 `create_document` 新建；
2. `get_outline` → `get_node` 读到要改的位置；
3. `apply_operations` 写入，`baseRevision` 取最近一次读取或写入返回的 `revision`；
4. 收到 409 说明文档已被人或其他 AI 改过：**重新读取**，在新内容的基础上重新生成操作，不要只换上新的 `revision` 重发；
5. 写完用 `validate_document` 检查：`problems` 逐项修正，`exports` 里要用的格式都是 `ok` 后再出件；
6. `export_document` 出件。不给 `outputPath` 只返回 `downloadUrl`（在浏览器中打开即可下载）；用户要文件时，把 `outputPath` 设为用户工作目录下的绝对路径。

对 Claude Code 可以这样说：「在 SES 里新建一份国家标准《……》，把范围写好，检查没问题后导出 docx 到当前目录。」

返回值要点：

- `validate_document` → `{ revision, problems, exports: { docx, pdf, html } }`。`problems` 与 `apply_operations` 返回的问题同一来源（没有 `introduced`）；`exports.*` 是 `{ ok: true }` 或 `{ ok: false, source, message, problems }`，判断与 `export_document` 导出前的检查完全相同；`pdf` 另有 `available`（PDF 管线是否可用，与 `/api/convert/capabilities` 一致）。json 导出不做导出前检查，不在其中；
- `export_document` → `{ format, filename, size, warnings, downloadUrl, savedTo? }`。文件内容不在结果里。`warnings` 与 REST 导出响应头 `X-SES-Export-Warnings` 同一来源（但不截断）；`downloadUrl` 用的是本次请求的 Host，即客户端连接服务端用的地址。

## 4. 安全限制

### 4.1 只接受本机连接

本地部署没有登录鉴权，`/mcp` 改为只接受本机的请求。三条必须同时满足，否则 403：

1. 连接来自回环地址（127.0.0.0/8、`::1`）；服务端默认监听所有网卡，局域网里的机器连不上 `/mcp`；
2. `Host` 头是 `localhost`、`127.0.0.1` 或 `[::1]`（端口任意）——防止 DNS 重绑定；
3. 有 `Origin` 头时（浏览器发出的请求），必须是 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`（端口任意）——防止本机浏览器里的其他网页跨站调用。Claude Code 这类非浏览器客户端不带 `Origin`。

因此不能通过 `http://<本机局域网地址>:3000/mcp` 或域名反向代理访问。没有登录鉴权意味着**本机上任何进程都能调用这些工具**，请只在自己的机器上使用。

注意：这只限制 `/mcp`。REST 接口（`/api/...`，包括 `downloadUrl` 指向的下载地址）本来就没有鉴权，且服务端默认监听所有网卡，不要把服务端暴露在不可信的网络里。

### 4.2 `outputPath`：写文件到本机

`export_document` 的 `outputPath` 让服务端把导出文件直接写到本机路径，方便「导出到我的工作目录」。规则：

- 必须是**绝对路径**，扩展名与格式一致（`.docx` / `.pdf` / `.html` / `.json`，大小写不敏感），否则 400；
- **父目录必须已存在**且是目录，服务端不会创建目录，否则 400；
- 目标已存在时默认失败（409，`code: "file-exists"`）；`overwrite: true` 才会替换。不覆盖时用 `O_EXCL` 创建，目标是符号链接也会失败；覆盖时先写同目录临时文件再 `rename`，替换的是目录项本身（目标是符号链接时换掉的是链接，链接指向的文件不受影响），失败时清理临时文件；
- 其他写入失败（没有权限、目标是目录、磁盘满等）返回 4xx 和 `code`。错误消息里会带路径（返回给调用方本人），**服务端日志里不会有路径**。

**风险**：`outputPath` 可以写到服务端进程有权限写的**任何位置**，没有目录白名单；`overwrite: true` 可以替换同名文件，包括 `package.json` 这类 `.json`、已有的 `.html`。如果 AI 受到文档内容或其他来源的提示注入，可能被诱导覆盖用户文件。依靠的防线是：默认不覆盖；客户端对 `export_document`（标注为 `destructiveHint`）的逐次确认；以及下面的开关。

**关闭方式**：把环境变量 `SES_MCP_ALLOW_FILE_WRITE` 设为 `0` 或 `false`（大小写不敏感），之后给了 `outputPath` 一律 403（`code: "file-write-disabled"`），不给 `outputPath` 的导出照常，只返回 `downloadUrl`。其他取值（含未设置）均为允许。

**这是本地部署的能力，云端部署（WP9.4）必须关闭它。**

## 5. 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `3000` | 服务端端口；`downloadUrl` 取不到请求 Host 时回退到 `http://localhost:<PORT>` |
| `SES_EDITOR_BASE_URL` | `http://localhost:5173` | `create_document` 返回的 `editorUrl` 的前缀（编辑器的地址）；空白按未设置处理，末尾的 `/` 会去掉 |
| `SES_MCP_ALLOW_FILE_WRITE` | 允许 | `0` / `false` 时禁用 `outputPath`，见 4.2 |

设置方式：启动服务端前在 shell 里导出，或写进仓库根目录的 `.env`（已被 `.gitignore` 忽略；服务端启动时读取 `packages/server` 的上上级目录里的 `.env`，已存在的环境变量不会被覆盖）。变量在每次调用时读取，但 `.env` 只在启动时加载，改了要重启服务端。

## 6. 已知限制

- **会话保存在内存里**：服务端重启后，客户端原来的会话失效（服务端返回 404），客户端需要重新 `initialize`。Claude Code 2.1.296 实测会自动重新建立会话；其他客户端未验证。会话空闲 24 小时失效，同时最多 100 个，满了淘汰最久未使用的；
- **只支持 stdio 的 MCP 客户端**无法直连 HTTP 端点，需要一个把 stdio 桥接到 HTTP 的小工具。本仓库**没有验证过任何桥接工具**，不推荐具体的实现；
- 导出 PDF 要跑两遍 Vivliostyle，短文档也要数秒到十几秒，长文档更久；客户端的工具调用超时过短时会先超时；
- `export_document` 不支持指定 DOCX 的创建时间（`docProps/core.xml` 里是导出时刻），两次导出的 DOCX 只有这一处不同；
- 若 `validate_document` 报告 `missing-id`，说明文档里有节点还没有 nodeId（多见于只在首页新建、从未在编辑器里打开过的文档）。`validate_document` 是只读的，不会补；先调用一次 `get_outline`（会补齐并保存）再校验；
- `problems` 与 `warnings` 不限条数；问题很多的文档，结果会很长；
- `outputPath` 只按 Linux 语义测试过；Windows 的路径、符号链接与权限行为未验证。
