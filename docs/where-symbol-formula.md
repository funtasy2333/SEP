# 式中符号公式化（行内公式一期）

状态：已实施（2026-10-18），**Microsoft Word 渲染验收未完成**（见第 6 节）。工作包编号待定。

## 1. 问题

公式下方的「式中：q<sub>V</sub>——体积流量」，符号原来只能写成文字加上下标：DOCX 用 Word 字符格式（`w:vertAlign`），PDF 用 HTML `<sub>/<sup>`。主公式则由公式引擎排版（DOCX 为 OMML/Cambria Math，PDF 为 KaTeX）。两者的字体、正斜体、角标大小和位置明显不同，编辑器里也没有上下标输入入口。

## 2. 决策（2026-10-16）

| 事项 | 决定 |
|---|---|
| 范围 | 本期只做式中符号（`whereList[i].term`）；正文、注、表格中的行内公式留待后续工作包。导出端按通用方式实现，是否允许由导出边界控制 |
| 输入方式 | 可视化公式编辑器（MathLive），保留 LaTeX 源码作为备用 |
| 编辑器形态 | 结构化条目「符号 \| 释义」；旧的自由文本式中继续可导出，并提供一键转换 |
| MCP | 同步支持写入公式形式的式中符号 |

## 3. 模型与出件

- 符号是 `IRInline.formula { id, latex }`（PM 节点 `formulaInline`）。出件只消费 LaTeX：带 `mathml`/`source`、空 `latex`、带 `marks` 或脚注的公式片段，在导出边界拒绝（`packages/shared/src/renderers/outputBoundary.ts`）；不在 `whereList[i].term` 的行内公式同样拒绝，提示「本期只支持式中符号使用行内公式」。旧 XML 出口照旧拒绝（GB/T 46687.2 的映射归 WP8）。
- **DOCX**：`@ses/io` 用 KaTeX 行内模式（`displayMode:false`）把符号转成 `<m:oMath>`，以行内公式自己的 id 写入 `formulaOmml`；符号位置直接输出该 OMML，缺失时回退为 LaTeX 源码并记 `formula-missing-omml`。
- **破折号制表位**：Word 不测量 OMML 宽度，由宿主估算后经 `formulaWidths` 传入。规则（单位：汉字宽）：基线字符汉字计 1、其余计 0.5；上下标乘 0.7；`mover/munder` 取基线与标记的较大者；最后加 0.25 余量。未传入时按 LaTeX 源码保守估算（每个非格式命令计 1 个字符，脚标按全宽）。制表位与悬挂缩进公式不变（`docs/wp7-docx-delivery.md` §5.10）。
- **HTML/PDF**：输出 `<span class="ses-formula-inline" data-latex="…">`；PDF 预渲染按 KaTeX 行内模式替换，失败时降级为源码并计入 failures。行内 KaTeX 与块级公式同为 KaTeX 默认缩放（1.21em），符号与主公式同大。

## 4. 编辑器

- 斜杠菜单「式中」或工具栏「式中」：光标在公式内时追加一条并打开符号输入；公式还有非空自由文本式中时，先弹出转换对照表。
- 键盘：符号格 Enter/Tab 到释义；释义 Shift-Tab 回符号；释义 Enter 在下方新建一条；空条目开头 Backspace 删除该条（最后一条连同式中列表删除）；非空释义开头 Backspace 只把光标移回符号格。
- 符号以 KaTeX 行内模式显示；点击、或选中后按 Enter 打开编辑弹窗。空符号格显示「点击插入符号」。
- 公式输入弹窗（`MathInputDialog.vue`）：MathLive 0.110.0，按需加载为独立 chunk（构建实测 808 kB，gzip 221 kB；主 chunk 大小不变）；不加载外部字体与音效（复用 `katex.min.css` 的 KaTeX 字体）。工具条提供上下标、正体、平均值与常用希腊字母。写回前校验：不能有未填写的占位，且 KaTeX 必须能解析；MathLive 加载失败时自动退回 LaTeX 源码输入。
- 一键转换（`whereListConversion.ts`）：按 `parseWhereList` 拆条；符号只在能可靠还原时转成公式——纯文字加斜体/上下标标记，字符限于拉丁字母、数字、常用标点、撇号和希腊字母。基线字母按数学斜体；脚标沿用作者的标记：带斜体的保持斜体，未标斜体的字母写成 `\mathrm{…}`（与原排版一致）。其余符号保留为文字并在对照表中标出。转换可撤销；弹窗期间公式被修改则不覆盖。

## 5. MCP

写作片段的 `whereList[i].term` 接受 `{"formula": {"latex": "…", "id"?: "…"}}`；写入前用 KaTeX 校验，失败返回 `invalid-value` 与位置。读出的公式可原样整体替换。写法见 `docs/wp9-authoring-reference.md` §4.5。

## 6. 验证

自动化测试（2026-10-18）：shared 1286、io 263、server 748 全部通过，server 生产构建通过；client 731 通过、1 项跳过（跳过的那项早已存在，与本次无关）；client `vue-tsc` 通过。

浏览器端到端（Vite 开发服务器 + Chromium）：添加式中 → MathLive 输入 `q`、下标、`V` 得到 `q_{V}` → 写回后以 KaTeX 显示；旧式中转换对照表与写回；点击符号重新编辑。控制台无错误。过程中发现并修复两处问题：工具条按钮抢走焦点，导致占位填不进去；空符号格的占位与 Tiptap Placeholder 的 `is-empty` 类名冲突。

PDF（服务端出件）：式中符号由 KaTeX 排版，与主公式字形一致。

DOCX：式中段落中的 OMML 位于制表符之前；验收样例（`q_{V}`、`\Delta p_{\max}`、`\rho_{\mathrm{w}}`、`\bar{x}`、`\lambda`、`\sigma_{\mathrm{c},0.2}`、`x_{i}^{2}`）的制表位分别为 862 与 1155 twips。LibreOffice 不渲染本项目输出的 OMML（主公式同样为空），因此只能用来确认破折号对齐与悬挂缩进，**公式外观需在 Microsoft Word 中验收**：

1. 式中符号与主公式中同一符号的字体、斜体、角标是否一致；
2. 各条「——」是否对齐，回行是否与释义起点对齐（重点看 `\sigma_{\mathrm{c},0.2}` 一组）；
3. 双击符号能否作为公式编辑。

## 7. 已知限制与后续

- 正文、注、表格中的行内公式：留待后续工作包（导出端已支持，需放开边界并补编辑入口）。
- 结构化式中在旧 XML 出口被拒绝（现状），GB/T 46687.2 映射在 WP8 处理。
- server 的 KaTeX 仍锁定 0.16.11（WP5 决定），client/io 为 0.16.44；编辑器预览与 PDF 可能有细小字形差异，是否统一另行决定。
- PDF 的式中条目没有「——」（现有打印样式只排两列），与 DOCX 不一致；这是原有问题，本期未改。
