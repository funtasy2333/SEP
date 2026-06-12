# Vivliostyle GB/T 1.1 Spike — 验收记录

**构建命令**：
```
pnpm --package=@vivliostyle/cli dlx vivliostyle build spike/vivliostyle-gbt11/index.html -o spike/out.pdf
```
> 注意：`pnpm dlx @vivliostyle/cli` 会报 "multiple binaries" 错误，必须用上述形式指定可执行文件名 `vivliostyle`。

**环境**：Vivliostyle CLI v11.0.1 · Core v2.43.1 · Playwright 无头 Chromium

---

## 场景验收表

### 场景1 — 三级目次：`leader('.')` 点线 + `target-counter` 页码

| 子项 | 结果 | 说明 |
|------|------|------|
| `leader(dotted)` 点线 | ✅ 通过 | 目次各项右侧点线正确渲染 |
| `target-counter(attr(href), page)` 基本功能 | ✅ 通过 | 能正确解析目标元素的页码 |
| 罗马/阿拉伯混合编号下的 target-counter | ❌ **不通过** | 见下方详细说明 |

**已知问题（已决策，见综合结论）**：`target-counter` 与命名页 `counter-reset: page` 存在冲突：

- **方案 A**（在 `.body-content` 上加 `counter-reset: page 1`）：正文页脚显示 1, 2, 3 ✓，但 `target-counter` 对所有正文目标均返回 `1` ✗。根本原因：元素级 `counter-reset` 创建元素作用域的 shadow counter，`target-counter` 读到的是 `.body-content` 的初始值 `1` 而非各页实际计数器值。
- **方案 B**（不使用 `counter-reset`）：`target-counter` 正确返回绝对页码（3, 4, 5…）✓，但正文页脚同样显示绝对页码（3, 4, 5…）✗，不符合 GB/T 要求的"从 1 重新起页"。

**根本原因**：Vivliostyle 未按 CSS Paged Media §5.5 实现"进入新命名页序列时 page counter 自动重置为 1"。

**已定稿 workaround（WP5 实施）**：PDF 管线采用两遍构建（two-pass build）：
1. 第一遍 Vivliostyle 构建，从 PDF bookmark/outline 提取各锚点页码；
2. 将页码以纯文本形式注入 HTML 目次（无 `<a>` 链接），第二遍构建输出最终 PDF；
3. 最终遍文档无内部链接，同时满足命名横排页正常渲染的约束（见"内部链接与命名页尺寸互斥"章节）。

---

### 场景2 — 前言/目次罗马页码，正文阿拉伯数字从 1 起

| 子项 | 结果 | 说明 |
|------|------|------|
| 前言/目次页显示罗马数字 I, II | ✅ 通过 | `@page front { @bottom-center { content: counter(page, upper-roman) } }` |
| 正文页显示阿拉伯数字从 1 起 | ✅ 通过 | `counter-reset: page 1` 已恢复；无内部链接条件下从 1 起编正确（见场景1决策） |
| `counter-reset: page 1` 使正文从 1 起 | ✅ 通过 | 无内部链接条件下与命名横排页可共存（WP0 审查结论 2，已实测） |

---

### 场景3 — 奇偶页眉镜像 + 页边距 上37/下35/左右28mm

| 子项 | 结果 | 说明 |
|------|------|------|
| 奇数页右侧显示标准号 | ✅ 通过 | `@page body:right { @top-right { content: "GB/T XXXX—XXXX" } }` |
| 偶数页左侧显示标准号 | ✅ 通过 | `@page body:left { @top-left { content: "GB/T XXXX—XXXX" } }` |
| 页边距 上37/下35/左右28mm | ✅ 通过 | `margin: 37mm 28mm 35mm 28mm` 生效 |
| `@page` margin-box 分隔线 | ✅ 通过 | `border-bottom: 0.25pt solid` 正确渲染 |

⚠️ **版式参数免责声明**：此 spike 使用的页边距（上37/下35/左右28mm）与 GB/T 1.1-2020 附录 E/F 定稿规范不符（定稿：奇页左25/右20mm、偶页左20/右25mm，页码位于外侧下角）。场景3验收的是奇偶页眉镜像机制本身，版式参数将在 WP4 按定稿规范实施，**不得直接参考此 spike 的 CSS 参数值**。

---

### 场景4 — 跨页长表：`<thead>` 重复 + 「表X（续）」注入

| 子项 | 结果 | 说明 |
|------|------|------|
| `<thead>` 跨页重复 | ✅ 通过 | `thead { display: table-header-group }` 在第 5 页正确重复表头行 |
| 「表X（续）」自动注入 | ❌ **不通过** | 见下方详细说明 |

**已知限制（已决策，见综合结论）**：CSS Paged Media 没有原生机制在续表页自动注入「表X（续）」标题。
- `string-set: table-name content(text)` 可捕获当前表题文字，但 `string()` 函数无法区分"是否为续页"；
- CSS 没有"当前页是否位于某表格续页"的条件查询；
- **已决策（GB/T 1.1-2020 第9.8.3条）**：V1 实施 `<thead>` 重复（含表头行和单位行）；V2 由 WP4 HTML 渲染器在续表起始处插入 `<caption class="table-continued">表X（续）</caption>` 元素（需布局感知，服务端实现）。

---

### 场景5 — 横排宽表两种方案对比

#### 方案A：命名页 `size: A4 landscape`

| 子项 | 结果 | 说明 |
|------|------|------|
| PDF 页面确实为横向 A4 | ✅ **通过**（修正后）| 移除 TOC 内部链接后重新构建：pdfinfo 实测 page 11 = 841.89 × 595.276 pts ✓；原 spike 误报（根因见下方） |
| 表格内容正确横向排布 | ✅ 通过 | 12 列宽表在 landscape 页完整显示 |
| 页码延续正确 | ✅ 通过 | landscape 页的 `@bottom-center` 页码与正文序列连续 |

**结论：方案A可用于生产，推荐使用。**

**⚠️ 原 spike 误报说明**：原构建中 TOC 含 `<a href="#…">` 内部链接，触发 Vivliostyle CLI 11.0.1 已知 bug，导致所有页面均为竖向 A4（pdfinfo 实测）。已于 2026-06-11 移除内部链接并重新构建，横向页正常生成。详见"内部链接与命名页尺寸互斥"章节。

#### 方案B：竖向页内 `rotate(-90deg)` 旋转

| 子项 | 结果 | 说明 |
|------|------|------|
| 旋转内容可视化呈现 | ⚠️ 部分 | 表格内容旋转后可读，但定位错误 |
| 布局正确性 | ❌ **不通过** | 绝对定位在分页媒体中行为不确定；表格溢出页面边界；表题位置错乱 |
| 与正文页面流兼容 | ❌ **不通过** | `position: absolute` 元素脱离文档流，续页分页机制失效 |

**结论：方案B在 Vivliostyle 下不可用于生产。应全部采用方案A。**

> 2026-06-11 复审后处置：方案B 区块及其 CSS 已从样张中移除（原构建中产生一页错乱输出），本节结论作为实验记录存档。

---

### 场景6 — 带编号公式 + 编号右对齐 + 式中键值列表

| 子项 | 结果 | 说明 |
|------|------|------|
| 分数公式正确渲染 | ✅ 通过 | 原生 MathML（`<math display="block"><mfrac>…`），Chromium 109+ 内置支持，无需 CSS/JS 依赖 |
| 公式编号右对齐 | ✅ 通过 | `.formula-block { display: flex }` + `.formula-num { min-width: 5em; text-align: right }` |
| 式中键值列表 | ✅ 通过 | `dl { display: grid; grid-template-columns: min-content 1fr }` 正确对齐 |
| **KaTeX CDN 方案** | ❌ **不可用** | 见下方详细说明 |

**KaTeX CDN 可行性结论（重要）**：

经三次构建实测，Vivliostyle 无头 Chromium 的网络环境不可靠：
- KaTeX JS（`katex.min.js` + `auto-render.min.js`）CDN 可加载（第1、2次构建公式正确渲染）；
- KaTeX CSS（`katex.min.css`，含字体和定位规则）CDN **无法稳定加载**；
- 结果：CSS 缺失时 HTML 输出视觉错误（文字乱序）；同时 `.katex-mathml` 可访问性文本泄漏为可见文字（`display: none !important` 覆盖无效，因 Vivliostyle Chromium 对 MathML 元素有特殊渲染路径）；
- `output: 'html'` 选项可消除 MathML 泄漏，但 HTML 渲染依然依赖 CSS，CDN 加载失败时输出乱码。

**生产 KaTeX 方案（供 WP5 实施）**：
1. WP4 HTML 渲染器输出 `<span class="ses-formula" data-latex="...">` 占位；
2. WP5 服务端在调用 `vivliostyle build` 前，用 `katex.renderToString(latex, { output: 'html', throwOnError: false })` 替换占位元素为预渲染静态 HTML；
3. 同时内联 KaTeX 核心 CSS（排除字体 CDN 依赖，字体可用 Base64 内嵌或系统回退）。

**MathML 替代方案**：原生 MathML 在 Vivliostyle/Chromium 109+ 下稳定可用，无任何外部依赖。
对于不需要 LaTeX 精确排版的场景，MathML 是更简单可靠的选择。

---

### 场景7 — 章标题黑体 15pt / 正文宋体 12pt 字体字号验证

| 子项 | 结果 | 说明 |
|------|------|------|
| 章标题黑体 | ✅ 通过 | `font-family: "SimHei", "STHeiti", sans-serif; font-size: 15pt` |
| 正文宋体 | ✅ 通过 | `font-family: "SimSun", "STSong", serif; font-size: 12pt` |
| 条标题黑体 12pt | ✅ 通过 | 4.1、4.2 等条标题渲染正确 |
| macOS 字体回退 | ✅ 通过 | macOS 无 SimHei/SimSun，自动回退到 STHeiti/STSong，效果一致 |
| Times New Roman 页码 | ✅ 通过 | 页脚页码使用 Times New Roman 衬线数字 |

⚠️ **版式参数免责声明**：此 spike 使用的字号（正文12pt，章标题15pt）与 GB/T 1.1-2020 附录 E/F 定稿规范不符（定稿：正文五号/10.5pt，章条标题同为五号黑体/10.5pt）。场景7验收的是 CJK 字体回退机制本身，实际字号将在 WP4 按定稿规范实施，**不得直接参考此 spike 的 CSS 参数值**。

**注意**：Linux CI 环境（如 GitHub Actions Ubuntu）默认无中文字体，需在 Docker/workflow 中安装 `fonts-noto-cjk` 或类似包，否则中文将显示为方块（tofu）。

---

## 综合结论与对 WP4/WP5 的影响

| 场景 | 结论 |
|------|------|
| §1 目次点线 | ✅ 可直接用于生产 |
| §1/§2 目次页码 + 正文从1起 | ✅ **已决策**：两遍构建（WP5 实施）；`counter-reset: page 1` 与命名横排页可共存 |
| §3 奇偶页眉 | ✅ 可直接用于生产（版式参数须按定稿规范重写） |
| §4 表头重复 | ✅ 可直接用于生产 |
| §4 续表标题 | ✅ **已决策**：V1=表头行重复，V2=插入「续」标题（WP4 服务端布局感知实施） |
| §5 横排宽表 | ✅ 方案A（命名横排页）可直接用于生产；方案B废弃 |
| §6 公式 | ✅ MathML 方案可直接用于生产；KaTeX 需服务端预渲染 |
| §7 字体 | ✅ 可直接用于生产（版式参数须按定稿规范重写；CI 需安装 CJK 字体） |

**所有决策点已由主导人于 2026-06-11 审查确认，WP1+ 可直接启动。**

---

## 内部链接与命名页尺寸互斥（根因记录）

**现象**：原 spike 场景5A（`size: A4 landscape`）误报为 ✅，主导人实测 pdfinfo 显示全部15页均为竖向 A4。

**根因**：Vivliostyle CLI 11.0.1 已知 bug——文档 HTML 内存在任何 `<a href="#…">` 内部链接（fragment link）时，`@page` 规则中的 `size: A4 landscape` 声明被完全忽略，命名页退化为默认尺寸（竖向 A4）。

**复现条件**：`<a href="#…">` 触发；`id="..."` 属性本身不触发。

**修复方法**：移除目次全部内部链接（改为 `<span class="toc-entry">`），重建后 pdfinfo 实测 page 11 = 841.89 × 595.276 pts。

**对生产管线的影响**：两遍构建方案的最终遍 HTML 不含内部链接（页码以纯文本注入），天然满足此约束，无需额外处理。
