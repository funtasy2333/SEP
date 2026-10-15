# 本地接入 MCP（WP9.3）

让 Claude Code 等 MCP 客户端连接本机运行的 SES：AI 新建文档、读取结构、写入内容、校验、出件，人同时在编辑器里修改同一份文档。本文只讲**本地部署**（服务端与 AI 客户端在同一台机器上）；云端部署（WP9.4）需要用户体系与鉴权，不适用本文。设计背景见 [WP9 人机共写方案](wp9-ai-coauthoring.md)。

## 1. 前提

1. 安装依赖：`pnpm install`；
2. 启动服务端，二选一：
   - 开发：`pnpm dev`（前端 5173 + 后端 3000），只要后端用 `pnpm dev:server`；
   - 生产式：`pnpm build` 后在 `packages/server` 目录执行 `pnpm start:prod`（即 `node dist/main`）。数据库在**启动目录**下的 `data/ses.db`，在别的目录启动会得到另一份空库；
3. 服务端默认监听 3000 端口，**只监听本机的 127.0.0.1**（见 4.1），MCP 端点是 **`http://127.0.0.1:3000/mcp`**（注意没有 `/api` 前缀）。改端口用环境变量 `PORT`。文档里统一写 `127.0.0.1`：`localhost` 在多数客户端也能用，但个别客户端会把 `localhost` 解析成 IPv6 的 `::1` 并且只尝试这一个地址，而服务端默认只监听 IPv4 回环，这样的客户端会连不上；
4. 人要看到 AI 的修改，在浏览器打开编辑器（开发时 http://localhost:5173）。AI 写入后，已打开的文档会自动载入并提示来源；有未保存的本地输入时会提示冲突，不会被静默覆盖；
5. 导出 PDF 需要 Vivliostyle 与 Poppler（见 [ENVIRONMENT.md](../ENVIRONMENT.md) 2.1），缺少时 `export_document` 导出 pdf 返回 503 并列出缺少的依赖，其他格式不受影响。

## 2. 在 Claude Code 中接入

```bash
claude mcp add --transport http ses http://127.0.0.1:3000/mcp
```

默认只对当前项目（本机、当前目录）生效。想让整个项目共用同一份配置，可以手写项目根目录的 `.mcp.json`（**本仓库不提交这个文件**，地址和端口因人而异）：

```json
{
  "mcpServers": {
    "ses": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

接入后在 Claude Code 里用 `/mcp` 查看连接状态；服务端没有启动时会显示连接失败，启动服务端后重新连接即可。

Claude Code 对 MCP 工具默认逐次询问是否允许。`export_document` 可以把文件写到本机的允许目录里（见 4.2），**建议不要把它加入自动允许**。

## 3. 工具与典型流程

| 工具 | 用途 | 只读 |
|---|---|---|
| `list_documents` | 列出全部文档（id、标题、阶段、revision） | 是 |
| `create_document` | 新建文档，与编辑器首页「新建文档」结果一致；返回 `editorUrl` | 否 |
| `get_outline` | 结构树；nodeId 缺失或重复的文档会先补齐并保存（revision 可能加 1） | 否* |
| `get_node` | 读取节点、前言、引言、参考文献的内容；同样会先补齐 nodeId | 否* |
| `apply_operations` | 批量插入、替换、删除、移动，带 `baseRevision`，整批全有或全无；记为「AI 修改」，人可在版本面板回滚 | 否 |
| `validate_document` | 只读检查：文档问题 `problems`，以及 docx / pdf / html 能否出件 `exports` | 是 |
| `export_document` | 导出 docx / pdf / html / json；返回下载地址，可选保存到本机的允许目录 | 否 |
| `get_authoring_reference` | 写作说明全文（写作片段格式、GB/T 1.1 约定） | 是 |

\* 读取前会检查文档的 nodeId：缺失的补齐、重复的重新生成并保存（revision 加 1，发 system 事件，不生成版本记录），所以这两个工具在 MCP 的 annotations 里标为非只读（`readOnlyHint: false`，`destructiveHint: false`，`idempotentHint: true`）。nodeId 完整时不写库；补齐一次后重复调用结果相同。

典型流程（`initialize` 返回的说明里也有同样的要点）：

1. `get_authoring_reference` 了解写法；`list_documents` 找文档，或 `create_document` 新建；
2. `get_outline` → `get_node` 读到要改的位置；
3. `apply_operations` 写入，`baseRevision` 取最近一次读取或写入返回的 `revision`；
4. 收到 409 说明文档已被人或其他 AI 改过：**重新读取**，在新内容的基础上重新生成操作，不要只换上新的 `revision` 重发；
5. 写完用 `validate_document` 检查：`problems` 逐项修正，`exports` 里要用的格式都是 `ok` 后再出件；
6. `export_document` 出件。不给 `outputPath` 只返回 `downloadUrl`（在浏览器中打开即可下载）；用户要文件时，把 `outputPath` 设为文件名（如 `规范.docx`），文件会保存到服务端的导出目录（默认是用户主目录下的 `SES-exports`，见 4.2），返回的 `savedTo` 是实际路径。

对 Claude Code 可以这样说：「在 SES 里新建一份国家标准《……》，把范围写好，检查没问题后导出 docx。」想让文件直接落在某个工作目录里，先把该目录加入 `SES_MCP_OUTPUT_DIRS`（见 4.2）。

返回值要点：

- `validate_document` → `{ revision, problems, exports: { docx, pdf, html } }`。`problems` 与 `apply_operations` 返回的问题同一来源（没有 `introduced`）；`exports.*` 是 `{ ok: true }` 或 `{ ok: false, source, message, problems }`，判断与 `export_document` 导出前的检查完全相同；`pdf` 另有 `available`（PDF 管线是否可用，与 `/api/convert/capabilities` 一致）。json 导出不做导出前检查，不在其中；
- `export_document` → `{ format, filename, size, warnings, downloadUrl, savedTo? }`。文件内容不在结果里。`warnings` 与 REST 导出响应头 `X-SES-Export-Warnings` 同一来源（但不截断）；`downloadUrl` 用的是本次请求的 Host，即客户端连接服务端用的地址（按本文接入就是 `http://127.0.0.1:3000/...`）；`savedTo` 是文件实际保存的绝对路径。

## 4. 安全限制

### 4.1 只接受本机连接

本地部署没有登录鉴权，所以有两层限制。

**第一层：服务端默认只监听 127.0.0.1。** 局域网里的设备连不上服务端的任何接口（REST 和 `/mcp` 都一样）。默认只监听 IPv4 回环，不监听 `::1`，所以客户端要写 `127.0.0.1`（见第 1 节）。

要允许局域网访问（例如在另一台机器的浏览器里使用编辑器），设置环境变量 `SES_LISTEN_HOST`：`0.0.0.0` 监听所有 IPv4 网卡，也可以填某一块网卡的地址；空白按未设置处理。启动日志会打印实际监听的地址，监听的不是回环地址时还会打一条警告：「已监听非本机地址，REST 接口没有鉴权，局域网内的设备可以读写全部文档」。**这正是风险所在**：REST 接口（`/api/...`）没有鉴权，局域网内任何设备都能读写全部文档，只应在可信的网络里这样做。变量名不是 `HOST`：有些环境把 `HOST` 设成机器名，用它会让服务端意外绑到局域网地址，所以服务端不读 `HOST`。

**第二层：`/mcp` 的访问守卫**（与上一层互为双重保险，把监听地址改成局域网地址后依然有效）。三条必须同时满足，否则 403：

1. 连接来自回环地址（127.0.0.0/8、`::1`）；即使用 `SES_LISTEN_HOST` 把服务端放到了局域网上，局域网里的机器也连不上 `/mcp`；
2. `Host` 头是 `localhost`、`127.0.0.1` 或 `[::1]`（端口任意）——防止 DNS 重绑定；
3. 有 `Origin` 头时（浏览器发出的请求），必须是 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`（端口任意）——防止本机浏览器里的其他网页跨站调用。Claude Code 这类非浏览器客户端不带 `Origin`。

因此不能通过 `http://<本机局域网地址>:3000/mcp` 或域名反向代理访问。没有登录鉴权意味着**本机上任何进程都能调用这些工具**，请只在自己的机器上使用。

注意：访问守卫只限制 `/mcp`。REST 接口（`/api/...`，包括 `downloadUrl` 指向的下载地址）没有鉴权，防护只有第一层（默认只监听 127.0.0.1）；改了 `SES_LISTEN_HOST` 就不要把服务端暴露在不可信的网络里。

### 4.2 `outputPath`：把文件写到本机的允许目录

`export_document` 的 `outputPath` 让服务端把导出文件直接保存到本机，但**只能写到允许的目录里**，不能写到任意位置。

**允许的目录**：

- 默认只有**默认导出目录**：用户主目录下的 `SES-exports`（`~/SES-exports`，Windows 上是 `%USERPROFILE%\SES-exports`）。它不存在时，在首次写入前自动创建（在 Linux / macOS 上权限为 0700，仅所有者可访问）；
- 用环境变量 `SES_MCP_OUTPUT_DIRS` 指定自己的目录：多个目录用平台的路径分隔符隔开（Linux / macOS 用 `:`，Windows 用 `;`），**每一项必须是绝对路径**，相对路径和空项被忽略。例如 `SES_MCP_OUTPUT_DIRS=/home/me/work/reports:/home/me/Documents`。配置的目录必须**已经存在**，服务端不会替你创建；
- 配置了有效的目录后，只有这些目录是允许的（默认导出目录不再自动包含，要用请自己加进去）；没有配置、或者配置里没有任何有效项时，只允许默认导出目录。

**`outputPath` 怎么写**：

- 只给文件名（如 `规范.docx`）即可。文件名和相对路径（如 `草稿/规范.docx`，子目录须已存在）都相对于**第一个**允许目录解析，所以 AI 不需要知道任何目录；也可以给允许目录内的绝对路径；
- 扩展名与格式一致（`.docx` / `.pdf` / `.html` / `.json`，大小写不敏感），否则 400；
- 父目录必须已存在且是目录（默认导出目录本身除外，见上），服务端不会创建其他目录，否则 400；
- 不在允许的目录内 → 403，`code: "output-dir-not-allowed"`，消息里列出允许的目录，并提示「只给文件名即可保存到 <第一个目录>；要保存到其他目录，请用户把它加入 `SES_MCP_OUTPUT_DIRS`」。用 `..` 逃出允许目录、或允许目录里指向外部的符号链接目录都算不在其内：判断时对目标的父目录和每个允许目录取 `realpath`（解析符号链接后的真实路径），父目录必须等于某个允许目录或位于其内；
- 成功时返回的 `savedTo` 是文件实际保存的绝对路径，请告诉用户；
- 目标已存在时默认失败（409，`code: "file-exists"`）；`overwrite: true` 才会替换。不覆盖时用 `O_EXCL` 创建，目标是符号链接也会失败；覆盖时先写同目录临时文件再 `rename`，替换的是目录项本身（目标是符号链接时换掉的是链接，链接指向的文件不受影响），失败时清理临时文件；
- 其他写入失败（没有权限、目标是目录、磁盘满等）返回 4xx 和 `code`。错误消息里会带路径（返回给调用方本人），**服务端日志里不会有路径**。

**风险**：写入范围已经从「服务端进程有权限写的任何位置」收窄到允许目录，但允许目录里的文件仍然可能被替换：`overwrite: true` 可以替换同名文件。如果 AI 受到文档内容或其他来源的提示注入，可能被诱导覆盖允许目录中的文件，所以**不要把 `SES_MCP_OUTPUT_DIRS` 设成主目录、系统目录或存放重要文件的目录**，用一个专门放导出文件的目录。依靠的防线是：目录限制；默认不覆盖；客户端对 `export_document`（标注为 `destructiveHint`）的逐次确认；以及下面的开关。另外，目录检查与实际写入之间有一个极短的时间窗口，同一台机器上另一个有权限修改允许目录的进程理论上可以在这期间把目录换成符号链接；这需要对允许目录有写权限，不在本地单用户部署的防护范围内。

**关闭方式**：把环境变量 `SES_MCP_ALLOW_FILE_WRITE` 设为 `0` 或 `false`（大小写不敏感），之后给了 `outputPath` 一律 403（`code: "file-write-disabled"`），不给 `outputPath` 的导出照常，只返回 `downloadUrl`。其他取值（含未设置）均为允许。

**这是本地部署的能力，云端部署（WP9.4）必须关闭它。**

## 5. 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `3000` | 服务端端口；`downloadUrl` 取不到请求 Host 时回退到 `http://localhost:<PORT>` |
| `SES_LISTEN_HOST` | `127.0.0.1` | 服务端监听的地址，默认只接受本机连接；设为 `0.0.0.0` 等非回环地址允许局域网访问（REST 接口没有鉴权，启动时会打警告），见 4.1。空白按未设置处理。不要用 `HOST` |
| `SES_EDITOR_BASE_URL` | `http://localhost:5173` | `create_document` 返回的 `editorUrl` 的前缀（编辑器的地址）；空白按未设置处理，末尾的 `/` 会去掉 |
| `SES_MCP_ALLOW_FILE_WRITE` | 允许 | `0` / `false` 时禁用 `outputPath`，见 4.2 |
| `SES_MCP_OUTPUT_DIRS` | 空（只允许 `~/SES-exports`） | `outputPath` 允许写入的目录；多个目录用 `:`（Windows 用 `;`）分隔，每项必须是绝对路径，相对路径与空项忽略；相对路径与文件名相对于第一个目录解析。未配置或没有有效项时只允许默认导出目录，见 4.2 |

设置方式：启动服务端前在 shell 里导出，或写进仓库根目录的 `.env`（已被 `.gitignore` 忽略；服务端启动时读取 `packages/server` 的上上级目录里的 `.env`，已存在的环境变量不会被覆盖）。`SES_MCP_*` 与 `SES_EDITOR_BASE_URL` 在每次调用时读取，`PORT` 与 `SES_LISTEN_HOST` 只在服务端启动时读取；`.env` 只在启动时加载，改了要重启服务端。

## 6. 已知限制

- **会话保存在内存里**：服务端重启后，客户端原来的会话失效（服务端返回 404），客户端需要重新 `initialize`。Claude Code 2.1.296 实测会自动重新建立会话；其他客户端未验证。会话空闲 24 小时失效，同时最多 100 个，满了淘汰最久未使用的；
- **只支持 stdio 的 MCP 客户端**无法直连 HTTP 端点，需要一个把 stdio 桥接到 HTTP 的小工具。本仓库**没有验证过任何桥接工具**，不推荐具体的实现；
- 导出 PDF 要跑两遍 Vivliostyle，短文档也要数秒到十几秒，长文档更久；客户端的工具调用超时过短时会先超时；
- `export_document` 不支持指定 DOCX 的创建时间（`docProps/core.xml` 里是导出时刻），两次导出的 DOCX 只有这一处不同；
- 若 `validate_document` 报告 `missing-id`，说明文档里有节点还没有 nodeId（多见于只在首页新建、从未在编辑器里打开过的文档）。`validate_document` 是只读的，不会补；先调用一次 `get_outline`（会补齐并保存）再校验；
- `problems` 与 `warnings` 不限条数；问题很多的文档，结果会很长；
- `outputPath` 的目录限制只在 Linux 上完整测试过。Windows 的 `;` 分隔与盘符绝对路径的解析有单元测试（用 `path.win32` 在 Linux 上验证），但 Windows 上的 `realpath`、符号链接与权限行为未验证；
- `outputPath` 的父目录不存在时先报 400（`parent-not-found`），不在允许目录内才报 403，所以调用方能从返回码区分出允许目录之外某个目录是否存在。这是检查顺序的结果（先确认目录，再用其真实路径判断是否在允许范围内），目录是否存在在本机上本来就不是秘密。
