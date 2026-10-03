# 条文脚注、表注和表脚注补齐

本次范围：编辑器插入/编辑/删除条文脚注，表注行与表脚注行，以及持久化、XML、DOCX、Vivliostyle PDF 的关联与排版。输入材料是功能测试样稿，不是真实标准文稿；WP7.6 的真实稿件验收仍未完成。没有扩展图脚注、索引、备案号等其他功能。

## 规范依据（原 PDF 图像已复核）

源文件：`rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf`。其文字层缺少 Unicode 映射，不能据文字提取结果判断上标括号及字母；本次使用 Poppler 阅读原页图像。

| 条款 | 原 PDF 页/打印页 | 对实现的要求 |
|---|---|---|
| 8.7.3.1 | 23/16 | 术语条目的任何内容不允许插入脚注；编辑入口阻止，导入的非法数据保留并报错，不能静默丢失 |
| 9.8.5、9.11 | 36/29、38/31 | 表注排在表格底部框内、表脚注之前；单条为“注：”，多条为“注1：”等，每张表独立计数 |
| 9.12.1 | 38/31 | 条文脚注提供附加信息，不应包含要求型或推荐型条款；从前言开始全文连续编阿拉伯数字，上标为 1)、2) 等，内容在引用所在页下方 |
| 9.12.2 | 39/32 | 表脚注在表格底部框内紧随表注，每张表从小写 a、b、c 开始；引用处和对应内容处均有相同上标；可包含要求型条款 |
| 10.4.2.2、10.4.4 | 42/35 | 表注/脚注行的外框为粗实线；条文脚注分隔细线为版心宽度的 1/4，标识从第3字位置开始、内容从第5字位置开始；表脚注标识从第3字、内容从第4字位置开始 |
| 表 F.1 #43–45 | 66/59 | 注标识小五黑体，注内容及脚注编号/内容小五宋体 |

“不应包含要求型/推荐型条款”由起草者核对，界面提供提示，不以简单关键词匹配替代内容审查。条文脚注允许的星号等特殊编号尚未提供，本次实现连续数字编号。

## 编辑方式和数据契约

- 条文：将光标放在普通段落需解释的文字后，通过“注 → 脚注”输入内容；点击上标可编辑或删除。选中文字插入时保留原文，在选区末尾插入上标。
- 表注：在表中使用“表格 → 添加表注行”，在表注行中可继续用“注 → 注”增加条目。
- 表脚注：在表格单元格内放置光标，使用“表格 → 添加表脚注行（插入上标）”；引用与脚注内容作为一个编辑事务保存。其他单元格可“引用已有表脚注”，共享同一条内容。删除定义前须先用“删除表脚注上标”移除该表中的所有对应引用；仍有引用时拒绝删除定义。最后一条定义删除时移除整行，撤销/重做保持关联与表格正文。
- 上标存稳定目标 ID，不存固定编号；正文与表内编号只由共享 Resolver 产生，删除和重排后自动更新。
- 旧 `tableFootnote` 节点是旧版表注，继续按表注处理。新 `tableNoteRow` 与 `tableFootnoteRow` 独立，不能把旧表注自动改成带上标的表脚注。
- XML 条文脚注输出相邻 `xref ref-type="fn"` 与 `fn`，导入折叠为一个原位节点；表脚注引用为 `table-fn`，定义放在 `table-wrap-foot`，表注保持 `non-normative-note`。参考 [NISO STS fn](https://www.niso-sts.org/TagLibrary/niso-sts-TL-1-0-html/element/fn.html) 与 [ISO NISO STS 编码指南](https://www.iso.org/files/live/sites/isoorg/files/developing_standards/docs/en/Guidelines%20for%20coding%20ed.2.1.pdf)。这是项目支持的序列化契约，不宣称通过全部外部 STS schema 认证。
- 缺目标、跨表目标、无引用定义、空内容、重复脚注 ID、术语或脚注内部嵌套脚注均明确报错；导出不能以“Word能打开”为理由忽略关联错误。

## 本轮验收记录

日期：2026-10-02。隔离分支 `codex/footnotes-table-notes`，基线 `9898341313853cefcafa5cd49de3cdb1214e89d6`。环境为 macOS、Node 22.22.3、pnpm 10.33.0、Microsoft Word 16.113.3、OfficeCLI 1.0.152、Vivliostyle CLI 11.0.1。测试服务使用独立数据库与 3078/5177 端口，未改动用户 3076/5174 上的文档9；最终快照比较相同，主工作区终结线图片 SHA-256 与开工时相同。

| 项目 | 本轮结果 |
|---|---|
| 共享 IR、编号、关联及 HTML/DOCX 回归 | 35 个文件、764 项通过，覆盖缺目标/跨表/孤立/重复 ID、术语禁用、全文与单表编号、重复引用、真实脚注部件与分页 |
| 编辑器菜单与编辑 | 实机普通段落上标可打开内容框、换行编辑及删除；表注行显示两条注1/注2，表脚注引用可复用。DOMObserver 循环、定义重排及删除最后一行边界均已复现修复并加回归 |
| 保存重开、XML、复制 | 独立样稿保存后冷重开；从文档库复制、编辑条文脚注，再由 UI 导出/导入 XML。数据库快照确认正文、元数据、对应脚注 ID 保留；整表粘贴重建内部目标有回归 |
| 严格 OOXML | `interactive-final.docx` 与 `stress-final.docx` 均得到 `Validation passed: no errors found.`；含分数、求和、矩阵、幂和根式的 `formula-footnotes-final.docx` 同样零错误。包含 `word/footnotes.xml` 的本轮样本已验；不据此宣称所有 LaTeX/导入数据全面合规 |
| Microsoft Word 实机 | 打开最终 stress DOCX、更新域，由本地“最适合打印”导出8页 PDF。前言、正文、末页脚注分别1)、2)、3)，均在调用所在页底；52行长表续页只在末段显示表注与 a/b 定义，定义顺序与首次引用一致 |
| Vivliostyle 既有管线 | 当前 HTML 通过原 `buildPdfExportRequest → runHtmlToPdfPipeline` 两遍流程输出6页、公式降级0；脚注在调用页底、续表注脚注仅在末段。转换管线未改，未恢复 LibreOffice |
| 全量测试及构建 | 服务端2套23项通过，完整 `pnpm build` 通过；保留既有大于500kB chunk 警告。客户端22个文件111项通过 |
| 主代理审查 | 检查编号来源、保存数据、删除/撤销、导入拒绝条件、复制 ID 修复、真实 DOCX 部件及 PDF坐标；审查中修复定义排序与 Resolver 作用域差异、表 fn-group 误识别条文定义的问题 |

### 测量证据

以 PDF 坐标提取并对照渲染页图；1 pt = 25.4/72 mm。表注/脚注外框在 DOCX 使用粗实线，Vivliostyle 注区外上、左右、末底为0.75 pt，两行内部为0.25 pt；仅表注和仅表脚注组合均有回归。Word 表脚注以表框左边界为起点，条文以各页版心左边界为起点；PDF 字形坐标有约0.1 pt量化差异。

| 项目 | Word 最终 PDF | Vivliostyle 当前 PDF | 原文要求 |
|---|---|---|---|
| 页底分隔线 | 41.23 mm，约0.48 pt细线，位于版心左端 | 41.24 mm，细线位于版心左端 | 165 mm版心的1/4，即41.25 mm |
| 条文脚注标识/内容相对缩进 | 约18/36 pt | 18.00/36.00 pt | 9 pt字号的第3/5字位置 |
| 表脚注标识/内容相对缩进 | 约18/27 pt | 约18.19/27.31 pt（粗边框约0.3 pt偏差） | 9 pt字号的第3/4字位置 |
| 脚注内容字号 | PDF约9.12 pt（Word PDF量化）；DOCX样式9 pt | 9 pt | 小五宋体 |
| 顺序与上标 | 注1、注2后为上标a/b；条文1)括号一并上标 | 同上 | 9.11、9.12 |

本机人工检查目录：`/Users/funtasy/PycharmProjects/set/.worktrees/footnotes-table-notes/tmp-e2e/footnotes/`（忽略的测试产物，不写入 Git）。重点文件：

- `interactive-final.docx`：单页表格、共享上标与两条表注。
- `stress-final.docx`、`stress-word-final.pdf`：Microsoft Word 8页长表/脚注验收。
- `stress-pipeline.pdf`、`pipeline-result.json`：原 Vivliostyle 管线输出。
- `measurements-final.json`：文件哈希、页码、字形/上标与分隔线坐标；`word-final-page-8.png` 为原页渲染证据。
- `editor-footnotes.png`、保存快照及 `interactive.xml`：编辑器、保存和 XML 往返证据。
- 最终测试日志：`/private/tmp/sep-footnotes-{shared,client,server,build}-verified.log`。

## 既有边界

保留现有 WP7.3/7.4 行为和 Vivliostyle 转换管线，不恢复 LibreOffice。Q 图片低清、封面素材来源与机构适用性未核验等既有限制保持；本轮不使用测试样稿作正式素材或真实文稿证明。其他 Word 版本、极端长脚注、复杂合并续表需要在交付稿件中复核。Word 脚注分隔线是文档级设置，横竖排混合时目前固定为竖排版心的1/4；横排条文脚注仍需人工校对，不能宣称该情形已合规。

脚注内容支持行内格式和换行；输入框当前按纯文本编辑，改变原有带格式内容会重建为纯文本，未改文字时保留导入格式。复杂列表/表格等脚注块明确拒绝 XML 导入并提示，避免静默丢失；分离的条文 `fn-group` 仅支持每条一个调用，多个调用仍拒绝。图脚注、星号特殊脚注、真正标准稿全流程交付验收尚未完成。

## 编辑区识别提示补充

2026-10-02 根据用户实测反馈，SES 表注区使用蓝灰背景、色条及“表注”名称，表脚注区使用淡紫背景、色条及“表脚注”名称；旧 tableFootnote 表注也适用。样式仅匹配 `.ProseMirror` 编辑区，名称为 CSS 生成内容，不写入 JSON/XML，不改变 DOCX 或 Vivliostyle 输出。客户端构建通过，浏览器核验两区的计算样式和名称，并保留 `tmp-e2e/footnotes/editor-note-regions.png`。

## Codex Review 后续修复

本轮审查确认三条 P2，均针对客户端编辑/序列化边界，不改变正式渲染版式：

| 审查意见 | 修复与回归 |
|---|---|
| 外表引用选项/命令混入内表定义 | 选项与命令共同使用只读取当前表直属 `tableFootnoteRow` 的 helper；真实 Tiptap 回归验证内外表双向拒绝跨表目标、原文不变、各自有效引用仍成功 |
| 内表定义排序被外表遍历截断 | 外表处理后继续进入子树，各张表仍独立收集自己的引用；真实内表首次引用反转及撤销/重做回归验证内表定义重排、外表定义不变 |
| XML serializer 忽略脚注关联错误 | 序列化入口统一拒绝 `dangling-footnote`、`unreferenced-footnote`、`invalid-footnote`，避免版本保存/源码复制绕过 UI 导出检查；有效 XML 往返保持不变 |

嵌套表格两项新增回归先在修复前失败，再在修复后通过。本轮客户端22个文件120项测试通过，client build通过（保留既有大chunk警告），`git diff --check`通过。XML入口新增7项回归，包括异常后有效文稿仍可完整序列化、缺少toJSON的旧调用拒绝生成脚注；版本保存对脚注校验错误中止，源码复制在写剪贴板前检查。日志为 `/private/tmp/sep-pr42-client-review.log` 与 `/private/tmp/sep-pr42-client-review-build.log`。本轮未改shared/server及DOCX/PDF版式；不把手动标记 resolved 等同于 Codex 复审通过。


### 2026-10-03 复审：禁止位置的条文脚注

Codex 针对 `dfdd1a89` 新增一条 P2：XML/JSON 导入的脚注能绕过编辑入口的位置限制。共享 Resolver 现对章/条/附录标题、中文/英文图题、图注子树（含列项）及公式说明的变量/释义报告 `invalid-footnote`；XML 序列化、HTML 与 DOCX 的既有入口校验据此中止。数据保留并报错，不能把非法位置的脚注静默丢掉。公式说明的拆分/去空白处理也保留脚注 atom，否则转换为 IR 前会丢失这一错误。

本次新增10项共享回归（9种禁止位置以及合法正文/列项/注/示例不受影响），新增7项 XML 导入回归（包括附录标题和仅有脚注的公式说明）。修复前9项共享、6项 XML 回归失败，修复后共享35文件774项、客户端22文件127项测试通过；完整 `pnpm build` 通过，保留既有大 chunk 警告，`git diff --check` 通过。日志为 `/private/tmp/sep-pr42-placement-{shared,client,build}.log`；修复前证据为 `/private/tmp/sep-pr42-placement-before.log` 和 `/private/tmp/sep-pr42-placement-xml-before.log`。验证环境仍为 macOS、Node 22.22.3、pnpm 10.33.0。

本次没有改动正式版式、服务端或转换管线，也未重跑 Word/PDF 人工验收；上文测量与严格 OOXML 结果仍是2026-10-02样稿证据。PR 保持未合并，审查意见修复与 Codex 再次复审结论分别记录。


### 2026-10-03 再复审：公式主体中的脚注

Codex 针对 `48e6c00579` 新增一条 P2：`formulaContent` 的行内脚注在转换为纯 LaTeX 时消失，后续 Resolver 无法阻断导出。现在含脚注的公式主体以可选 `sourceInlines` 保留原始行内数据，由 Resolver 报告 `invalid-footnote`，脚注收集器及渲染入口检查也读取该字段。纯 LaTeX 公式的原有 IR 结构保持不变。XML 的 `tex-math` 含脚注时也解析并保留 atom，不再通过 `textContent` 静默删除脚注。

新增5项共享与4项客户端回归：仅脚注/文字与脚注混合/嵌套脚注的公式主体保留 ID、内容和行内格式；真实 ProseMirror schema 接受的粘贴 JSON 在 XML 入口被拒绝；XML 导入亦保留脚注并拒绝再次导出；HTML/DOCX 入口拒绝非法公式；正常公式 IR 保持不变。另以直接构造的 IR 验证表内公式上标即使目标有效也不能在纯 LaTeX 渲染时被抹掉，此项不代表支持单元格 PM 中的公式转换。修复前3项共享、4项客户端新增回归失败；修复后共享35文件779项、客户端22文件131项测试通过，完整构建及 `git diff --check` 通过，保留既有大 chunk 警告。

本次日志为 `/private/tmp/sep-pr42-formula-{shared,client,build}.log`，修复前证据为 `/private/tmp/sep-pr42-formula-before-{shared,client}.log`。环境仍为 macOS、Node 22.22.3、pnpm 10.33.0；本次未重跑服务端测试和 Word/PDF 人工验收，未改版式或转换管线。PR 未合并，后续复审结论单独报告。


### 2026-10-03 再复审：参考文献标题与未映射脚注

Codex 针对 `ddadc522ea` 新增一条 P2：参考文献标题中的脚注未进入 IR，XML 出口以伪造 ID/“?”标签继续生成内容。现在转换器追踪脚注 atom 的实际转换结果，并检查其是否仍在最终 IR 树中；未映射的条文/表脚注上标以可选 `unmappedFootnotes` 保存内容、ID与所在容器，Resolver 明确报告 `invalid-footnote`，XML/HTML/DOCX 均阻断输出。检查最终树同时覆盖固定标题、未知容器，以及先前已转换却被后续部分覆盖的脚注。正常文稿不增加该诊断字段。

XML 的条文脚注、表脚注引用和表脚注定义统一要求有效 Resolver 标签；删除伪造 `fn_<nodeId>`/`tfn_<nodeId>` 和“?”标签 fallback，序列化节点与 `toJSON()` 不一致时也不能绕过。新增6项共享、4项客户端回归，包括参考文献标题 XML/JSON、附录标识、隐藏的无题条标题、未知节点、被后续参考文献覆盖的数据、未映射的表上标，以及正文/表脚注缺失标签的最后一道校验。修复前已复现5项共享回归与参考文献标题 XML/缺少标签入口失败；正常文献条目脚注仍可往返。修复后共享35文件785项、客户端22文件135项测试、完整构建及 `git diff --check` 通过，保留既有大 chunk 警告。日志为 `/private/tmp/sep-pr42-unmapped-{shared,client,build}.log`；修复前日志为 `/private/tmp/sep-pr42-unmapped-before-{shared,client}.log`。

本次全量检查纠正一项旧验收断言：`convertTableCellBlocks` 只支持段落和列表，嵌套 `stdTable` 被跳过，之前“嵌套表格无脚注错误”来自内表数据未入 IR，不能用作合法导出证据。内外表引用选项及命令、重排/撤销行为的测试保持；现在额外确认含内表上标的导出被拒绝，而不会丢失脚注后继续输出。嵌套表格导出尚未支持，保留为明确遗留项，未在此轮扩展转换能力。

环境仍为 macOS、Node 22.22.3、pnpm 10.33.0。本次未重跑服务端测试、Word/PDF 人工验收，未改变正式版式或转换管线。所有审查修复与 Codex 新复审结论分别记录；PR 未合并。

### 2026-10-03 再复审：独立表脚注区上边框

Codex 针对 `fd0415d1` 新增一条 P2：仅有表脚注、没有表注时，DOCX 仍使用内部细线作为表脚注区上边框。修复为按实际已输出的表注行选择：独立表脚注上边框 `w:sz=6`（0.75 pt）；有表注时两区之间 `w:sz=2`（0.25 pt）。缺少表注、空白表注和回调返回空白均按独立表脚注处理。HTML 原有对应规则保持。

新增4项回归覆盖以上3种独立情况及表注/表脚注组合，兼验跨列、零左内边距与 OOXML 子项顺序。修复前3项失败，修复后表格专项16项、共享全量35文件789项、客户端22文件135项通过；完整 `pnpm build` 及 `git diff --check` 通过，保留既有大 chunk 警告。本轮未重跑服务端测试或 Vivliostyle 实机管线。日志为 `/private/tmp/sep-pr42-border-{before,shared,client,build}.log`。

用当前客户端 `buildDocxBlob` 生成两个对照表，再在 Microsoft Word 16.113.3 更新域、通过本地“最适合打印”导出 PDF。OfficeCLI 1.0.152 对新 DOCX 严格校验零错误；通用 issues 检查仍提示5处布局空段和2处原始 DOCX 中未缓存的 PAGEREF 域，Word 导出后目次显示 II/1。该样本无条文脚注或公式，只验证本次表边框，不能据此宣称所有文稿合规。

| 第5页测量 | DOCX 设置 | Word PDF 路径厚度 | PDF 上边框 Y 坐标（pt） |
|---|---|---|---|
| 独立表脚注区上边框 | 0.75 pt | 约0.72 pt | 259.92–260.64（两段各约233 pt） |
| 组合表注区上边框 | 0.75 pt | 约0.72 pt | 330.24–330.96 |
| 表注与表脚注之间 | 0.25 pt | 约0.24 pt | 342.72–342.96 |

PDF 将线输出为黑色填充矩形，以上厚度由矩形高度提取；Word PDF 量化值与 DOCX 设置分别记录。已查看5页缩略图及第5页原页渲染，无内容截断；封面后出现一张空白页，其原因尚未核实，本样本不作为封面/分页验收通过的证据，保留为交付复核项。

本机产物仍在 `tmp-e2e/footnotes/` 忽略目录：`standalone-border-review.json`、`standalone-border-review.docx`、`standalone-border-word-review.pdf`、`standalone-border-word-page-5.png`、`standalone-border-measurements.json` 和 `border-contact.png`。样稿明确为测试 fixture，不是真实标准文稿；模板素材来源限制保留。环境为 macOS 26.4、Node 22.22.3、pnpm 10.33.0，PR 保持未合并，修复完成与 Codex 复审通过分别记录。

### 2026-10-03 再复审：仅有表脚注上标的单元格

Codex 针对 `ec819134` 新增一条 P2：空单元格中插入的表脚注 atom 在 IR 中源文字为空，DOCX 单元格空白判断只看 `run.text.trim()`，因此用“—”替代上标但仍输出定义。现使用现有 `renderRun` 判断去掉源文字首尾空白后是否仍有实际输出；表脚注上标和有效交叉引用不会误判为空，真正空白单元格仍用一字线。正式行内内容按原始数据渲染，不对实际文字进行 trim；重复引用共享定义、上标格式和首次引用顺序保持。

本次按同类问题补查单元格过滤、行内渲染和分页估算：HTML 原有渲染无需修改；DOCX 分页估算对无源文字的段落至少计一行，不会因仅有上标而排除数据行。新增7项客户端完整导出回归，以真实编辑器 schema 校验，分别对原始 PM 和 XML 往返后的 PM 执行 HTML 与 `buildDocxBlob` 打包检查：仅上标、空白加上标、多段落、重复引用、colspan、rowspan、表头；逐格断言调用未丢失、上标格式、定义唯一且顺序一致、空白对照格仍为“—”、纵向合并续格不产生重复调用。修复前7种往返场景均在 DOCX 上标断言失败；修复后原始/往返两套都通过。另新增2项共享回归覆盖源文字为空的交叉引用及未解析目标的既有空格行为。

本轮共享35文件791项、客户端23文件142项、完整 `pnpm build` 与 `git diff --check` 通过，保留既有大 chunk 警告。日志为 `/private/tmp/sep-pr42-emptycell-{before,targeted,shared,client,build}.log`。当前构建的客户端导出包另生成 `tmp-e2e/footnotes/footnote-only-cell-review.docx`（对应 JSON 同名），OfficeCLI 1.0.152 严格 OOXML 校验零错误。样稿为测试 fixture，模板素材来源限制保留。本轮没有重跑 Word/PDF 人工验收、服务端测试或 Vivliostyle 管线，不能复用前轮 PDF 作为本次人工验收证据。

连续复审暴露了首轮检查对特殊输入与转换边界的覆盖不足；测试总数和手动 resolved 都不能代替最新提交的复审结论。本次修复与同类检查完成，最新 Codex 复审仍需单独确认。WP7.6 真实稿件、嵌套表导出、横排条文脚注分隔线与上一轮新样稿空白页的既有未完成项保持明确，PR 未合并。
