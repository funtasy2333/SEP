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

**已知问题（需主导人决策）**：`target-counter` 与命名页 `counter-reset: page` 存在冲突：

- **方案 A**（在 `.body-content` 上加 `counter-reset: page 1`）：正文页脚显示 1, 2, 3 ✓，但 `target-counter` 对所有正文目标均返回 `1` ✗。根本原因：元素级 `counter-reset` 创建元素作用域的 shadow counter，`target-counter` 读到的是 `.body-content` 的初始值 `1` 而非各页实际计数器值。
- **方案 B**（不使用 `counter-reset`）：`target-counter` 正确返回绝对页码（3, 4, 5…）✓，但正文页脚同样显示绝对页码（3, 4, 5…）✗，不符合 GB/T 要求的"从 1 重新起页"。

**根本原因**：Vivliostyle 未按 CSS Paged Media §5.5 实现"进入新命名页序列时 page counter 自动重置为 1"。

**推荐 workaround（供主导人确认）**：PDF 管线采用两遍构建（two-pass build）：
1. 第一遍 Vivliostyle 构建，从 PDF bookmark/outline 提取各锚点页码；
2. 将页码注入 HTML 的 TOC `<a>` 后 `data-page` 属性，用 CSS `content: attr(data-page)` 代替 `target-counter`；
3. 第二遍构建输出最终 PDF。

---

### 场景2 — 前言/目次罗马页码，正文阿拉伯数字从 1 起

| 子项 | 结果 | 说明 |
|------|------|------|
| 前言/目次页显示罗马数字 I, II | ✅ 通过 | `@page front { @bottom-center { content: counter(page, upper-roman) } }` |
| 正文页显示阿拉伯数字 | ✅ 通过（绝对值）/ ❌ 不通过（从1起） | 见场景1说明，两者不可兼得 |
| `counter-reset: page 1` 使正文从 1 起 | ⚠️ 部分通过 | 页脚正确，但破坏 target-counter（见场景1） |

---

### 场景3 — 奇偶页眉镜像 + 页边距 上37/下35/左右28mm

| 子项 | 结果 | 说明 |
|------|------|------|
| 奇数页右侧显示标准号 | ✅ 通过 | `@page body:right { @top-right { content: "GB/T XXXX—XXXX" } }` |
| 偶数页左侧显示标准号 | ✅ 通过 | `@page body:left { @top-left { content: "GB/T XXXX—XXXX" } }` |
| 页边距 上37/下35/左右28mm | ✅ 通过 | `margin: 37mm 28mm 35mm 28mm` 生效 |
| `@page` margin-box 分隔线 | ✅ 通过 | `border-bottom: 0.25pt solid` 正确渲染 |

---

### 场景4 — 跨页长表：`<thead>` 重复 + 「表X（续）」注入

| 子项 | 结果 | 说明 |
|------|------|------|
| `<thead>` 跨页重复 | ✅ 通过 | `thead { display: table-header-group }` 在第 5 页正确重复表头行 |
| 「表X（续）」自动注入 | ❌ **不通过** | 见下方详细说明 |

**已知限制（需主导人决策）**：CSS Paged Media 没有原生机制在续表页自动注入「表X（续）」标题。
- `string-set: table-name content(text)` 可捕获当前表题文字，但 `string()` 函数无法区分"是否为续页"；
- CSS 没有"当前页是否位于某表格续页"的条件查询；
- **推荐 workaround**：在 HTML 渲染器（WP4）生成 HTML 时，对宽表插入一个 `<caption class="table-continued">表X（续）</caption>` 元素，配合 CSS `break-before: always; display: none` 仅在续页显示。实际需要布局感知（服务端两遍渲染或 JavaScript 计算）。

---

### 场景5 — 横排宽表两种方案对比

#### 方案A：命名页 `size: A4 landscape`

| 子项 | 结果 | 说明 |
|------|------|------|
| PDF 页面确实为横向 A4 | ✅ 通过 | `.landscape-section { page: landscape }` + `@page landscape { size: A4 landscape }` |
| 表格内容正确横向排布 | ✅ 通过 | 12 列宽表在 landscape 页完整显示 |
| 页码延续正确 | ✅ 通过 | landscape 页的 `@bottom-center` 页码与正文序列连续 |

**结论：方案A可用于生产，推荐使用。**

#### 方案B：竖向页内 `rotate(-90deg)` 旋转

| 子项 | 结果 | 说明 |
|------|------|------|
| 旋转内容可视化呈现 | ⚠️ 部分 | 表格内容旋转后可读，但定位错误 |
| 布局正确性 | ❌ **不通过** | 绝对定位在分页媒体中行为不确定；表格溢出页面边界；表题位置错乱 |
| 与正文页面流兼容 | ❌ **不通过** | `position: absolute` 元素脱离文档流，续页分页机制失效 |

**结论：方案B在 Vivliostyle 下不可用于生产。应全部采用方案A。**

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

**注意**：Linux CI 环境（如 GitHub Actions Ubuntu）默认无中文字体，需在 Docker/workflow 中安装 `fonts-noto-cjk` 或类似包，否则中文将显示为方块（tofu）。

---

## 综合结论与对 WP4/WP5 的影响

| 场景 | 结论 |
|------|------|
| §1 目次点线 | ✅ 可直接用于生产 |
| §1/§2 目次页码 + 正文从1起 | ⚠️ **需主导人决策**：两遍构建 workaround，或接受绝对页码 |
| §3 奇偶页眉 | ✅ 可直接用于生产 |
| §4 表头重复 | ✅ 可直接用于生产 |
| §4 续表标题 | ⚠️ **需主导人决策**：需服务端布局感知预处理 |
| §5 横排宽表 | ✅ 方案A（命名横排页）可直接用于生产；方案B废弃 |
| §6 公式 | ✅ MathML 方案可直接用于生产；KaTeX 需服务端预渲染 |
| §7 字体 | ✅ 可直接用于生产（CI 需安装 CJK 字体） |

**需在启动 WP4/WP5 前由主导人确认的两个决策点**：
1. **目次页码**：接受两遍构建（复杂度增加），还是接受绝对页码（不符 GB/T 惯例）？
2. **续表标题**：接受预处理方案（需布局感知），还是暂不实现（仅 `<thead>` 重复）？
