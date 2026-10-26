# WP8.M M-Z-b 验收记录：真实保存重开与目视走查

状态：2026-10-26 在基线 `ccdfe99`（G1～G8 与 M-Z-a 已合入）上完成设计 §4.9 第 5、6 项，并为用户准备 Word 实测样稿（§4.9 之外的补充要求）。本记录只记录实测结果与发现的问题，**没有修复任何缺陷**（缺陷与处理建议见“发现的问题”，由主导人决定是否派修复任务）。

本记录**不**表示 Microsoft Word 实机验收完成：DOCX 的 Word 检查由用户用 `/tmp/claude-0/-home-user-SEP/3548a3a1-3442-5826-a26f-190013361684/scratchpad/wp8m-word-check.docx` 完成，检查清单见 [Word 检查清单](#word-检查清单)。也不表示 GB/T 46687.2—2026 XML 导出完成（XML46687 白名单仍留给 WP8.2）。

## 一、执行环境与安全约束

| 项 | 值 |
|---|---|
| 仓库 / 基线 | worktree 分支，`git reset --hard claude/wizardly-babbage-d3djmo` 后 HEAD 为 `ccdfe99` |
| 系统 / 运行时 | Linux 6.18；Node v22.22.0；pnpm 10.28.0；Vite v8.0.3 |
| 服务端 | `pnpm --filter @ses/server build` 得到 `packages/server/dist/main.js`，以 `node dist/main.js` 启动；SQLite 库固定在**启动进程的当前目录**下 `data/ses.db` |
| 浏览器 | Chromium 141.0.7390.37（`/opt/pw-browsers/chromium-1194`，未执行 `playwright install`），由全局 playwright 1.56.1 驱动（环境预装的是 chromium-1194，与 1.56.x 配套；仓库 server 包自带的 `playwright-chromium@1.49.1` 期望的 Chromium 修订号不同，没有尝试它，脚本用环境变量 `WP8M_PLAYWRIGHT` 指向匹配版本的入口） |
| PDF 管线 | 服务端探测到 vivliostyle + poppler 可用（`/api/convert/capabilities` → `htmlToPdf: true`），因此版式预览走产品真实的 IR → print HTML → vivliostyle → PDF |
| 隔离方式 | 全部服务只绑定 `127.0.0.1`，端口 3098（保存重开验收）、3099（目视走查）、5198（Vite 开发服务器），均不是默认端口；工作目录都在 scratchpad `wp8m-acceptance/server-a/`、`server-b/` 下，每次都是**全新的空库**（脚本与测试开头都断言 `GET /api/documents` 为空）；Vite 通过一份临时配置（`mergeConfig` 覆盖 `/api` 代理目标为 `http://127.0.0.1:3099`，用完已删除、未提交）只代理到隔离实例 |
| 业务库 | 未读写 `packages/server/data/ses.db` 或任何既有库（该 worktree 下 `packages/server/data` 目录根本不存在）；验收结束后所有进程已停止（3098、3099、5198 均无监听） |

## 二、真实 API/SQLite 保存—冷重开验收（§4.9 第 5 项）

入口：`packages/client/src/extensions/wp8mPersistence.acceptance.test.ts`。opt-in：只有同时提供 `WP8M_API_URL` 与 `WP8M_EVIDENCE_FILE` 才运行，默认套件整体跳过（该文件在 client 全量回归里计为 skipped）。`WP8M_ACCEPTANCE_PHASE` 取 `prepare`（默认）或 `reopen`，中间必须真实停止并重启服务端。prepare 强制空库、回环主机、非 3000 端口。使用 M-Z-a 的全要素 fixture `__fixtures__/wp8m.ts`（G1～G8，32 个矩阵行）。

### 命令

```
pnpm --filter @ses/server build
# 在全新目录 server-a 下启动（PORT=3098，SES_LISTEN_HOST=127.0.0.1）：node …/packages/server/dist/main.js
WP8M_API_URL=http://127.0.0.1:3098/api WP8M_EVIDENCE_FILE=…/evidence.json \
  pnpm --filter @ses/client exec vitest run src/extensions/wp8mPersistence.acceptance.test.ts      # prepare
# kill 服务端进程 → 确认连接被拒 → 在同一目录重新启动
WP8M_ACCEPTANCE_PHASE=reopen WP8M_API_URL=… WP8M_EVIDENCE_FILE=… pnpm --filter @ses/client exec vitest run src/extensions/wp8mPersistence.acceptance.test.ts   # reopen
```

### prepare（2026-10-26 11:34:37 UTC）

1. 全新空库上保存全要素文档（`POST /documents`，revision 0），响应内容与提交的规范化 JSON `toEqual`。
2. 版本快照 A（`WP8M-initial`，编辑前）。
3. 编辑后保存（`PUT /documents/1`，带 `baseRevision: 0`，revision → 1）。编辑覆盖各组代表性的一处：G1 标准化条目标题加后缀、**新增一条标准化条目**（`wp8m-acc-nr-5`，插在 `g1-nr-3` 之后）、非标准化条目与自定义参考文献标题加后缀；G2 缩略语释义；G5 术语领域；G6 引言 0.2 条文；G7 罗马列项改字并**新增第 5 项**、多块注第一段；G8 名义列宽 40:60 → 30:70。编辑后断言：每处编辑落在正确的 IR 位置，Resolver 的 `ref_<序号>` 随新增条目重排（新条目 `ref_4`，原第 4 条变 `ref_5`）。
4. 版本快照 B（`WP8M-acceptance`，编辑后）。
5. 副本（`createDocumentDuplicate` → `POST /documents`，id 2，题名“…（副本）”）。副本的 IR 正文、附录、参考文献、参考文献标题、资源与原稿一致（副本比原稿多一个封面，是 `createDocumentDuplicate` 把库内元数据同步成封面的既有行为，所以不比较 `front` 整体）。
6. 对每份存储内容：Schema `check()`；`pmToIr` 无 warning、无 `unsupportedContent`、`extensionVersion=1`；Resolver 无 error（warning 只有 fixture 既有写法带来的两条 `hanging-paragraph`）；语义 JSON 含全部 12 个新节点与 2 个新 mark，含 `listType:"roman"`、`refType:"abbreviation"`、`refType:"listItem"` 与 `0.1`/`0.1.1`/`0.1.2`/`0.2`/`0.3`/`3.3.1`/`3.3.2`/`C.1` 各编号，不含 `ext_`；编辑前的存储内容（版本 A）的 IR 与 shared 侧 IR 原生版本（`wp8mFixtures.ts`）深度相等。
7. 输出边界基线：HTML 15、DOCX 15 条阻断（恰为 §7.1 暂不排版的 6 个行内图 + 2 个图例 + 2 个图中示例 + 1 个文档级资源 + 2 个单元格边框样式 + 2 个列宽），XML 33、XML46687 31（两者之差恰为 2 个罗马列项）。

### 服务端真实重启

| 步骤 | 证据 |
|---|---|
| prepare 时的服务端进程 | PID **430**，`/proc/430/cwd` 为 `…/wp8m-acceptance/server-a`；`data/ses.db` SHA-256 `ee668845721bd16d86b18f067d5fa60ec293e31c3f07a91b7bb4b56db9ef53a8` |
| 停止 | `kill 430`，`kill -0 430` 失败（进程已不存在）；`curl http://127.0.0.1:3098/api/documents` 连接被拒（HTTP 000）；停止后库文件 SHA-256 不变 |
| 重启 | 同一目录重新启动，新 PID **954**（11:35:04 UTC 启动日志） |
| reopen（11:35:19 UTC） | 通过；停止 954 后库文件 SHA-256 仍是 `ee668845…53a8`（reopen 全程只读） |

### reopen 核对（全部通过）

- 原稿（id 1，revision 1）、副本（id 2）、版本 A（id 1）、版本 B（id 2）读回后，`content` 与 prepare 证据逐字段 `toEqual`；原稿与副本的 `meta`、`title`、`stage`、`revision`、版本号也相等。
- 稳定序列化（键排序）的 SHA-256 与 prepare 时一致：

| 内容 | SHA-256 |
|---|---|
| 原稿 `document.content`（= 版本 B） | `c77919b278d12b9b0e7a57757080ca9c27b3f20e6b47f8c58ab1367b192211ad` |
| 副本 | `7fb04b15387baa3b27b00ba31d9b1eb7011b6dfd33e300714942c40341c453b8` |
| 版本 A（编辑前；与 fixture 本身的 SHA 相同） | `e26d1742ab2e916990704aad9389470f60e918bed5df18304a60a63c10bef162` |

- 重开后的四份内容再做第 6 步的全部结构断言：原稿、副本、版本 B 含编辑，版本 A 不含任何编辑标记且列宽仍为 40:60；副本正文与原稿一致；版本 B 的 IR 与原稿相等；版本 A 的 IR 与原生 IR 版本相等且不等于编辑后的原稿。
- 输出边界签名（HTML 15、DOCX 15、XML 33、XML46687 31，含每条的节点 id 与路径）与 prepare 完全一致。
- 生产编辑器实际加载入口：重开内容经 `Editor` + `replaceEditorDocument` 载入，保存形态与 `exportSemanticJson` 与 prepare 时载入的结果一致（遮蔽编辑器自动补的 nodeId，去掉末尾光标空段落，与 `wp8mIntegration.test.ts` 同一口径）。
- 负向对照：把证据文件里的一处文字（`GB/T 1.1—2020` → `…2021`）篡改后再跑 reopen，**失败**（`content` 不相等），说明核对不是空转。

证据文件 `evidence.json` SHA-256 `235ef3577d5d74e343a14f15638b6018f87885d871d85c65e7dcaf916a2a9f22`；reopen 摘要 `evidence.json.reopen.json` SHA-256 `a1ae1c86b5994ad3c42a5d1e610b65a74e19619a74c359f903a160c7e62cc1d3`（均在 scratchpad，不入库）。

## 三、目视走查（§4.9 第 6 项）

入口：`packages/client/scripts/wp8m-browser-walkthrough.mjs <origin> <output-dir>`（真实 Chromium + 真实编辑器 + 隔离 API）。脚本把全要素 fixture（经生产 Schema 规范化）和“去掉暂不排版结构”的版本各存为一份文档，对每个清单项截图并给出可机检的 DOM/样式断言，再做编辑器内实际按键与导出。运行方式：

```
# 隔离的 Vite（临时配置，端口 5198，/api 只代理到 127.0.0.1:3099 的空库实例）
pnpm --filter @ses/client exec vite --config vite.wp8m-acceptance.config.ts
WP8M_PLAYWRIGHT=/opt/node-tools/node_modules/playwright/index.mjs \
  node packages/client/scripts/wp8m-browser-walkthrough.mjs http://127.0.0.1:5198 <output-dir>
```

临时配置 `packages/client/vite.wp8m-acceptance.config.ts`（不提交，用完删除）：

```ts
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
export default mergeConfig(base, defineConfig({
  server: { host: '127.0.0.1', port: 5198, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3099' } } },
}))
```

最终一次完整运行在新建的空库上通过（页面错误 0、控制台 error 0）；之前几次运行因下文 F-6 与脚本自身问题失败或作废，其数据库已随隔离实例丢弃。截图放 `docs/qa/wp8m/`（PNG8，共约 0.5 MB），证据 JSON 见 [`walkthrough-evidence.json`](../qa/wp8m/walkthrough-evidence.json)。

### 截图索引与判定

编辑器内（全要素文档，1440×1100 视口）：

| # | 清单项 | 截图 | 可机检断言 | 判定 |
|---|---|---|---|---|
| 1 | 规范性引用章 | [01](../qa/wp8m/01-norm-ref-chapter.png) | 4 条（3 条标准化 + 1 条非标准化）；每项首行缩进 2em（30px）；编号与名称之间 `::before` 为一个全角空格；非标准化条目带脚注标记 | 正常 |
| 2 | 正文 `std` / `mixed-citation` 标记 | [02](../qa/wp8m/02-std-ref-marks.png) | 标记文本与 fixture 一致，样式为点状下划线（有别于交叉引用的蓝色实线） | 正常 |
| 3 | 缩略语表 | [03](../qa/wp8m/03-abbreviation-list.png) | 第 4 章 3 项；附录 A、第 4.1 条各有一张表（共 3 个 `defList`）；释义内的缩略语交叉引用可点 | 正常（分隔符口径见 F-3） |
| 4a | 图例、图注、图中示例 | [04a](../qa/wp8m/04a-figure-legend-notes-example.png) | 图例标题“图例” + 3 项；图注 注1/注2、图中示例“示例：”；顺序为图例 → 注 → 示例 | 正常 |
| 4b | 行内图 | [04b](../qa/wp8m/04b-inline-images.png) | 6 个行内图；size S/M/L 实测 18/36/54 px（1.2/2.4/3.6 em，字号 15px）；无尺寸图按 `max-height:1.2em` 自适应，fixture 的 1×1 PNG 因此只显示 1 px | 正常（fixture 图片过小，无尺寸图只是一点） |
| 5 | 术语领域〈〉 | [05](../qa/wp8m/05-term-subject-field.png) | 4 处领域；`::before` 为“〈”、`::after` 为“〉”（不入内容）；编辑器里单独成行，位于术语名与定义之间；含粗体的“化学”正常 | 正常 |
| 6 | 引言 0.1/0.2 与大纲 | [06](../qa/wp8m/06-introduction-clauses-outline.png) | 引言条显示 0.1、0.1.1、0.1.2、0.2、0.3（无题条）；大纲含“0.1 背景 / 0.1.1 起因 / 0.1.2 说明 / 0.2 目的”，其后“1 范围”（章编号不受引言条影响） | 正常 |
| 7 | 罗马列项 `i）` | [07](../qa/wp8m/07-roman-list.png) | 标记为 `counter(roman-counter, lower-roman) "） "`，显示 i）ii）iii）iv）；引用文字“见占位甲/乙”为蓝色交叉引用 | 正常（编辑器内文字起排位置略不齐，见 F-5） |
| 8 | 多段注 / 示例 | [08](../qa/wp8m/08-multi-block-notes-examples.png)、[08b](../qa/wp8m/08b-foreword-multi-block-note.png) | 多块注：标记“注2：”+ 第一段，第二段与第一段文字左对齐，其下注内列项；单段 `noteBlock`；多块示例“示例2：”下为引语与罗马列项 `i）ii）`；前言页的多段注 | 正常 |
| 9 | 列宽 4:6 与边框样式 | [09](../qa/wp8m/09-table-columns-borders.png) | 两列表表头实测宽 265 : 397.5 px = 0.400；单元格“甲”四边 solid / none / dashed / solid（上边 5px 粗实线、下边 3px 虚线），“乙”四边 dotted；三列合并单元格表 20% / 空 / 50% 按名义宽度排布；旧式表不受影响 | 正常 |
| 10 | 自定义参考文献标题 | [10](../qa/wp8m/10-bibliography-title.png) | 标题为“参考书目” | 正常 |

编辑器内实际按键（真实键盘事件，光标由脚本放置到指定节点内；与 G1、G3 报告对照）：

| # | 操作 | 截图 | 结果 | 判定 |
|---|---|---|---|---|
| 11 | 规范性引用 std 条目的**编号**中按 Enter；**名称**中按 Enter | [11](../qa/wp8m/11-norm-ref-enter-no-split.png) | 两次按键后 `editor.getJSON().content` 与按键前逐字相同，std 条目仍为 3 条（不拆分）。与 `wp8mG1.test.ts` 的结论一致 | 正常 |
| 11+ | （补充）非标准化（mixed）条目中按 Enter，再 Ctrl+Z | — | mixed 条目 1 → 2（拆出新条目，G1 报告的既有行为），撤销后文档回到按键前 | 正常 |
| 12 | 图例标题中按 Enter | [12](../qa/wp8m/12-legend-title-enter.png) | 光标进入第一项（`g3-lg-1`）的符号格（`whereTerm`），图例标题仍只有 1 个（没有被劈开）。与 `wp8mG3.test.ts` 的结论一致 | 正常 |

导出（真实 UI）：

| # | 操作 | 截图 | 结果 | 判定 |
|---|---|---|---|---|
| 13 | 全要素文档 → 导出 → DOCX | [13](../qa/wp8m/13-export-blocked-full-doc.png) | 被输出边界阻断，提示恰含 §7.1 暂不排版的 15 处（与 §3.4 + §7.1 基线一致）；JSON 导出仍可用且 `extensionVersion=1` | 行为正常；提示的呈现见 F-1 |
| 14 | 去掉暂不排版结构的文档 → 导出 → 版式预览（HTML 打印 → vivliostyle → PDF）与 DOCX | 下列 14a～14g | PDF 11 页，DOCX 导出成功；HTML、DOCX 对该文档均无 `unsupported-output` | 正常 |

“去掉暂不排版结构”指去掉图例、图中示例、行内图（及其文档级图资源）、`stdTable.columns`、单元格边框属性（与 `wp8mIntegration.test.ts` 的 `withoutBlockedStructures` 同口径，这里在 PM 层做）。打印预览各页（PDF 由 `pdftoppm -r 90` 渲染，页文字由 `pdftotext -layout` 做了断言）：

| # | 页 | 截图 | 核对内容 | 判定 |
|---|---|---|---|---|
| 14a | 目次（第 1 页） | [14a](../qa/wp8m/print-preview-toc-introduction-custom-bibliography-title.png) | “引言 …… III”，“参考书目 …… 8”（自定义标题进目次）；引言条（0.1 等）不进目次，与设计一致 | 正常 |
| 14b | 引言（第 3 页） | [14b](../qa/wp8m/print-preview-introduction-clauses.png) | 0.1 背景 / 0.1.1 起因 / 0.1.2 说明 / 0.2 目的 / 0.3 无标题条按条标题排版（黑体、编号后空一字），条内注与脚注 1) 正常 | 正常 |
| 14c | 规范性引用与术语领域（第 4 页） | [14c](../qa/wp8m/print-preview-norm-refs-and-subject-field.png) | 清单每项空两字起排，“GB/T 321　优先数和优先数系”之间一个全角空格，文件之后无标点；非标准化条目带脚注 2)；术语“〈顾客满意〉由成员组织……”领域与定义同一段、在定义之前 | 正常（页尾的术语编号行见 F-2） |
| 14d | 缩略语与图注（第 5 页） | [14d](../qa/wp8m/print-preview-abbreviations-figure-notes.png) | 缩略语每项一段、与释义同一行，首行缩进两字、回行顶格；〈化学〉领域；图中的注（注1、注2）排在图题之上 | 正常（分隔符为全角冒号，口径见 F-3） |
| 14e | 罗马列项与多段注（第 6 页） | [14e](../qa/wp8m/print-preview-roman-list-multi-block-notes.png) | `i）ii）iii）iv）` 标识后的文字对齐在同一列；“见 8.1 iii）”引用文字与标识一致；多块注第二段与第一段对齐、注内列项缩进；多块示例内的罗马列项；表格单元格内多段注 | 正常 |
| 14f | 附录领域（第 10 页） | [14f](../qa/wp8m/print-preview-appendix-subject-field.png) | 附录 C.1 “〈附录领域〉附录中的术语。” | 正常 |
| 14g | 参考书目（第 11 页） | [14g](../qa/wp8m/print-preview-bibliography-custom-title.png) | 标题“参考书目”，条目 [1] | 正常 |

另外的参考图：[word-sample-libreoffice-reference-roman.png](../qa/wp8m/word-sample-libreoffice-reference-roman.png) 是 Word 样稿在 LibreOffice 里的渲染（**仅供参考，不是 Word 验收**），见 F-4。

## 四、发现的问题（只记录，不修复）

严重程度：中 = 影响用户可见结果；低 = 呈现或边角；信息 = 口径或环境，无需改代码即可决定。

| 编号 | 严重程度 | 问题 | 复现步骤 | 备注 / 初步判断 |
|---|---|---|---|---|
| F-1 | 低 | 导出被阻断时的提示难以阅读：全要素文档有 15 处暂不排版的结构，提示把 15 条路径连成一整段，长路径在横向被裁掉（如“…image（节点 g3-scope-p）。请”之后的“保留”被裁），对话框高度超出视口，下方的格式卡片要滚动才看得到 | 打开全要素文档（`__fixtures__/wp8m.ts`）→ 导出 → 点 DOCX（或 HTML / 版式预览），见 [13](../qa/wp8m/13-export-blocked-full-doc.png) | 提示组件是 WP6 既有的，条数少时无此问题；WP8.M 新结构一多就暴露。可按条分行、折叠或只列前 N 条加总数 |
| F-2 | 低 | 打印预览中，术语条目的编号行可能孤立在页尾，术语名与定义在下一页（“3.3.2”在第 4 页底，“仅领域术语”及其定义在第 5 页顶） | 去掉暂不排版结构的文档 → 导出版式预览 → 看第 4～5 页，见 [14c](../qa/wp8m/print-preview-norm-refs-and-subject-field.png) | 既有打印 CSS 缺口，不是 WP8.M 引入：`printCss.ts` 里 `.ses-term-num-line` 没有 `break-after: avoid`、`.ses-term-entry` 没有 `break-inside: avoid` |
| F-3 | 信息 / 需决定 | 缩略语分隔符口径不一致：设计 §7.1 的表格文字是“缩略语与释义同行，释义前**空一字**”；G2 的实现在 HTML 与 DOCX 都输出全角冒号“ADC：模数转换器…”（`html.ts` 的 `ses-def-sep`、`docx/body/block.ts` 注释写明“GB/T 46687.2—2026 印刷页 2 的 3.2 缩略语实排”），编辑器里则以 1em 间隔分列显示、没有冒号 | 看 [03](../qa/wp8m/03-abbreviation-list.png) 与 [14d](../qa/wp8m/print-preview-abbreviations-figure-notes.png) | 不是缺陷，是设计文字与 G2 依据的实排样张之间的差异，需主导人确认以哪个为准；改动只涉及 HTML 与 DOCX 两个渲染器的分隔符 |
| F-4 | 中（待 Word 实测） | 罗马列项标识较宽时文字被推到下一个制表位：`vii）`、`viii）` 的文字比 `i）`～`vi）`、`ix）` 更靠右，回行后与首行不齐。这是 A14 的已知限制（`numbering.ts` 注释：Times New Roman 下 `i）`～`vi）` 能落在 2 字悬挂量内）；LibreOffice 中已复现，Word 是否一致需要用户实测 | 打开 `wp8m-word-check.docx` 第 8.1 条的 9 项罗马列项，或看 [参考图](../qa/wp8m/word-sample-libreoffice-reference-roman.png) | 设计 §7.1 D-M-06 决定“真排”；实际文档里罗马列项一般不超过 6 项，但 7、8 项并不罕见。如 Word 实测确认，可考虑给 A14 增大悬挂量或对宽标识改用 `suff=nothing` + 固定制表位（需主导人决定） |
| F-5 | 低 | 编辑器里罗马列项文字起排位置随标识宽度略有不同（`i）` 与 `iii）` 的文字不齐），而打印预览、DOCX 里是对齐的 | 看 [07](../qa/wp8m/07-roman-list.png) | `standard-nodes.css` 用 `counter(…)'） '` 的行内 `::before`，字母列项因标识等宽不显现。纯编辑器显示细节，可给 `::before` 设固定最小宽度 |
| F-6 | 信息（环境 / 工具） | Playwright 的 `page.screenshot` 默认 `caret: 'hide'` 会在尚未获得焦点的编辑器里引起一次 DOM 变化，被 ProseMirror 的 `readDOMChange` 读成回车，把某段落劈开并生成一个空标题的章（本次在“去掉暂不排版结构”的文档里复现，截图后状态里章数 9 → 4，编辑器随即显示“正文待保存”）。改用 `caret: 'initial'` 后不再发生 | 以默认选项对该文档截图：载入后等 2.5 秒，截图前后各读一次 `editor.state.doc` | 仓库既有浏览器脚本一律用 `caret: 'initial'`，本次脚本也是，并在按键测试前断言“截图之后文档内容与载入时完全相同”。未深究 ProseMirror 为何把该次 DOM 变化读成回车，真实用户操作不会触发；若主导人想排查，可从 `readDOMChange` 的调用栈入手 |
| F-7 | 低（既有行为） | 编辑器里交叉引用显示的是 fixture 里存的静态文字（“见表1”），目标表实际编号为表 3；导出的 HTML/DOCX 与打印预览里是正确的“见表 3” | 看 [09](../qa/wp8m/09-table-columns-borders.png)（“见表1。”与下方“表3 两列表”）与 [14e](../qa/wp8m/print-preview-roman-list-multi-block-notes.png)（“见表 3。”） | WP6 起的既有口径（标记里的文字只在导出时按 Resolver 的 `refText` 替换），不是 WP8.M 引入；写进记录以免与新结构的显示混淆 |

没有发现与 G1～G8 设计相悖的功能性缺陷：保存重开无损、编辑行为与 G1/G3 报告一致、输出边界与 §3.4 + §7.1 一致，打印预览的版式与 §7.1 的文字型结构要求一致（F-3 为口径问题）。

## 五、Word 实测样稿与检查清单

### 样稿

- 文件：`/tmp/claude-0/-home-user-SEP/3548a3a1-3442-5826-a26f-190013361684/scratchpad/wp8m-word-check.docx`（**不入库**），SHA-256 `32356f4fc94578fe1e6f737c51ec7c34572b6de01c8900918257c8dc25313598`，40 915 字节。
- 生成：`node packages/client/scripts/wp8m-word-sample.mjs <绝对路径.docx>`（走真实的 `buildDocxBlob`，与编辑器“导出 DOCX”同一条链路）。内容 = 全要素 fixture 去掉 §7.1 暂不排版的结构，并把第 8.1 条的罗马列项扩成 9 项（i）～ix），其中第 1～4 项文字很短，第 5～9 项文字较长、会回行）。封面采用模板图片，会有一条已知 warning `cover-asset-approximation`（封面素材来源未核实），与本次检查无关。
- 生成后自检：`numbering.xml` 有 17 个 `abstractNum`，A17 的 L1/L2 为 `0.%2　`、`0.%2.%3　`；引言五个条的段落分别绑定 A17 的按需实例（numId 101）的 ilvl 1/2/2/1/1；罗马列项用 A14 的按需实例（numId 105），L0 为 `lowerRoman` + `%1）`，标识字体 Times New Roman / 宋体。LibreOffice 渲染（仅作参考）引言条显示 0.1、0.1.1、0.1.2、0.2、0.3，能正常打开。

### Word 检查清单

请用真实 Word 打开样稿；若提示“更新域”请选“是”（目次页码由 Word 计算）。逐项记录“通过 / 不通过 + 现象（最好截图）”。

| # | 位置 | 检查点 | 预期 | 备注 |
|---|---|---|---|---|
| W0 | 打开文件 | Word 是否提示“发现无法读取的内容 / 需要修复” | 不应出现 | 出现请记录提示原文与修复后缺了什么 |
| W1 | 引言页（A17 引言条编号） | 引言里五个条的编号是否显示 **0.1、0.1.1、0.1.2、0.2、0.3** | 依次为 0.1 背景 / 0.1.1 起因 / 0.1.2 说明 / 0.2 目的 / 0.3（无标题条，只有编号和条文） | 设计文档明确写着 A17“尚未在真实 Word 中实测”，这是**首次实测** |
| W2 | 引言页与第 1 章 | 引言条的编号是否**不影响**章编号：引言之后第 1 章仍显示“1 范围”；引言条不出现在目次里 | 是 | 若第 1 章变成 2 或目次里出现 0.1，请记录 |
| W3 | 引言页 | 编号与标题之间是否空一个汉字；编号、标题是否为黑体、条文为宋体；0.3 无标题条的编号是否仍是黑体 | 是 | |
| W4 | 引言页 | 在 0.2 目的的条文后回车、新建一个条，编号是否续为 0.3（可选） | 续编为 0.3 | 属于可编辑性检查，不通过不影响版式结论 |
| W5 | 第 8.1 条罗马列项（9 项） | 标识是否显示 **i） ii） iii） iv） v） vi） vii） viii） ix）**（全角右括号）；“见 8.1 iii）”交叉引用文字的括号与列项标识一致 | 是 | 字母为 Times New Roman 风格，括号为宋体 |
| W6 | 同上 | **iii）～vi）的文字是否落在第五字位**，即与 i）、ii） 以及 v） 的文字起排位置在同一列；回行后第二行是否与首行文字左对齐 | 是（A14 的设计预期） | 这是本次最需要 Word 回答的问题 |
| W7 | 同上 | **vii）及以上**：vii）、viii） 的文字是否被推到下一个制表位（比 i）～vi）更靠右）；ix） 是否又回到第五字位 | 预期会出现（已知限制 F-4；LibreOffice 里 vii）、viii） 靠右、ix） 回到原位） | 请如实记录 Word 的实际表现：是否跳位、跳多少、回行是否与首行不齐 |
| W8 | 第 8.1 条后部“示例2” | 多块示例里的罗马列项是否重新从 i） 开始（第二个列表实例） | 是 | |
| W9 | 第 4 章 符号和缩略语（及附录 A） | 缩略语表：每项一段，“ADC：模数转换器（…）”缩略语与释义同行；首行缩进两字、回行顶格 | 是；分隔符是全角冒号（口径见 F-3，请一并告诉我们你认为应是冒号还是空一字） | |
| W10 | 第 2 章 规范性引用文件 | 清单每项空两字起排，“GB/T 321　优先数和优先数系”之间是一个全角空格；条目没有编号或 [n]；文件之后无标点；非标准化文件“《中华人民共和国计量法》”后有脚注，且脚注在本页页底 | 是 | |
| W11 | 第 3 章 术语和定义；附录 C | 〈领域〉：3.1 协会 → “〈顾客满意〉由成员组织……”领域与定义在同一段、在定义之前；3.3.1 “〈ISO 和/或 IEC 发布的〉”；3.3.2 “〈化学〉”（“化学”为粗体）；附录 C.1 “〈附录领域〉” | 是 | |
| W12 | 前言页；第 8.1 条；第 8.2 条表格 | 多段注：第二段文字是否与第一段文字左对齐；注内破折号列项是否缩进；第 8.1 条“注2：”下有脚注标记 3)，且脚注在页底；前言里的多段注；第 8.2 条表格单元格内的多段注 | 是 | |
| W13 | 目次 | 目次含“引言”“参考书目”（自定义标题），页码由域计算后正确 | 是 | |

## 六、回归验证

本任务只新增一个 opt-in 验收测试、两个脚本、本记录与截图，没有改动任何产品代码、快照或 golden。在最终工作树上运行：

| 命令 | 结果 |
|---|---|
| `pnpm --filter @ses/shared test` | 83 个文件、1992 项通过 |
| `pnpm --filter @ses/shared exec tsc --noEmit` | 通过 |
| `pnpm --filter @ses/io test` | 24 个文件、331 项通过 |
| `pnpm --filter @ses/client exec vitest run --maxWorkers=2` | 102 个文件通过、2 个跳过（WP6 与 WP8.M 的 opt-in 验收）；1361 项通过、2 项跳过 |
| `pnpm --filter @ses/client build`（含 `vue-tsc -b`） | 通过（仅已有的 chunk 大小提示） |
| `git diff --stat ccdfe99 HEAD` 对 `__snapshots__`、golden 目录、`shared/src/ir/__tests__/fixtures.ts`、`wp6.ts` | 空（0 变化） |

## 七、未执行与限制

- 未在真实 Microsoft Word 中打开样稿（由用户按上表执行）；LibreOffice 渲染只作参考。
- 目视走查用的是产品真实的“版式预览”管线（vivliostyle 排版 PDF），没有另外在浏览器里打印 print HTML；未做真实打印机输出。
- 全要素 fixture 里的图片是 1×1 像素 PNG 与占位图，只能验证“有没有、占位多大”，不能验证真实图片的缩放观感。
- 保存重开验收只覆盖 API/SQLite 层与生产编辑器的加载入口；没有像 WP6 那样做“浏览器编辑保存 → 服务重启 → 浏览器重开”的整链路（本次浏览器走查读的是 API 直接写入的文档）。
- 本记录不含 XML46687 导出（WP8.2）。
