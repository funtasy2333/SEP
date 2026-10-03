# WP7.6 交付验收记录（2026-10-01）

> 历史记录：以下测试数字、产物路径和当时PR状态保留原日期。当前 `origin/main` 已合并 #40/#41/#42（2026-10-03 重验）；最新补充验收及未完成项见 [2026-10-03 当前基线验收](wp7.6-acceptance-2026-10-03.md)。

**状态：部分完成，真实标准文稿验收未完成。** 本次已实施并复核schema与横排终结线修复，完成补充样稿的浏览器流程、Microsoft Word渲染、位置测量和回归。仓库只有fixture；主工作区数据库仅有名称为“测试标准”“测试标准TEST”的稿件，未据此认定任何稿件为真实标准。已向用户询问真实稿件路径，尚未收到。本文所有样稿都是测试数据，不能代替WP7.6真实稿件交付验收，也不宣称全面符合GB/T 1.1或任意OOXML/OMML组合。

## 当前基线与环境

- 开工远程重验：PR #39已于2026-10-01 10:24:56 UTC合并，`origin/main`为`f2fad9e9f21ccd19d4e958e78680337715fdf986`。
- 分支：`codex/wp7.6-delivery`；独立worktree：`/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery`。主工作区已有未提交终结线图片和`.pnpm-store/`保持原状，未用于本轮修改。
- Microsoft Word for Mac 16.113.3；OfficeCLI 1.0.152；Node 22.22.3；pnpm 10.33.0；Python 3.11.4；macOS。只验Microsoft Word，WPS按用户要求不纳入本次验收。
- Word PDF由`word_pdf.py`驱动Word实际打开和更新域后导出；它只在Word沙盒中的核验副本去掉打开时域更新触发，输入DOCX不修改。六类/阶段九份封面及WP7.4样稿共10份从最终源码再生成，均与Word验收DOCX逐字节一致。用户直接打开交付DOCX时仍需按既有说明更新目次域。
- 本轮依据当前`wp7-docx-delivery.md`（含第10节）、两份WP7.5验收文档和仓库内GB/T 1.1—2020原PDF。历史结果仅定位待验项，下面数值均为本轮重验。

## 逐项验收表

“样稿通过”只覆盖表中材料和本机环境；“部分/未完成”仍需继续处理。

| 项目 | 本轮证据/实际检查 | 状态 |
|---|---|---|
| 真实稿件完整流程 | 创建/导入→编辑→保存重开→复制→DOCX→Word PDF，缺经确认的真实文稿 | **未完成**，待用户提供稿件 |
| 浏览器及持久化流程 | 实际UI、隔离SQLite、XML文件输入、手动保存、reload、首页复制及六次DOCX/XML下载；5步断言通过，0个pageerror | 样稿通过，输入为`sample-standard.xml` fixture |
| 封面 | 六类封面、ICS/CCS、标志、编号、替代、采标、名称与译名、日期、发布机构、七阶段；与原PDF图像和项目冻结模板目标核对 | 样稿通过，178/178位置检查在±1 mm内；素材资格限制保留 |
| 目次 | Word更新PAGEREF，标题层级/引导点/前置罗马数字及正文页码；浏览器导入稿和full/numbering实排 | 样稿通过；增删章条后仍需重新导出 |
| 前言 | 新建稿的单位信息、专利责任提示；征求意见/送审封面专利征集说明，其他阶段不出现 | 样稿通过；不改写已有正文 |
| 章条及列项编号 | `numbering.pdf`中的90条视觉行期望，附录/术语/示例/注等；与附录E原图核对布局 | 样稿通过，90/90 |
| 术语 | full及浏览器稿：条目编号独立、中文/英文名称、定义、注，连续编号 | 样稿通过 |
| 图与表 | WP7.4生产导出样稿：图片、跨行跨列表、64行续表、重复表头、标题/表注；Word逐页图像检查 | 样稿通过；当时 `tableFootnote` 实际为表注，未验证关联上标的表脚注；脚注补齐另见 [本轮脚注记录](footnotes-table-notes-validation.md)，任意复杂合并/续表仍需复核 |
| 公式 | 14类方案公式、矩阵单元格、n-ary主体；另外8种样式/尺寸输入；严格schema和Word实际字形检查分开进行 | 主体及已覆盖schema通过；`mathsf`字体、`color`颜色未保留，见遗留R4 |
| 附录及参考文献 | full与浏览器稿：附录标识/性质/标题/章条，文献序号；分页与前置/正文分区 | 样稿通过 |
| 横排 | WP7.4横排图/表共用节、恢复竖排、末尾横排、页码连续；书眉和页码按项目§5.15横排约定核对 | 样稿通过，不宣称其他横排装订方案也已验证 |
| 书眉页码 | full第3–11页，镜像外侧位置、前置罗马数字/正文阿拉伯数字；下表毫米值 | 样稿通过 |
| 终结线 | 原PDF§10.1.5、附录E及项目§5.13：居中、版心宽度1/4、最后要素同页；横排原61.976→62.992 mm | 已修复，Word实测目标63 mm；竖排约41.402 mm/目标41.25 mm |
| WP7.5替代/采标及空值 | 浏览器新建空编号`GB/T XXXXX—XXXX`、两侧空日期`XXXX-XX-XX`；日期下横线实际保留；新建XML回导后元数据核对 | 样稿通过；占位不是正式编号或日期 |
| XML与复制一致性 | 题名/类型/编号/替代/采标及单位meta核对；copy meta仅改题名，正文深拷贝、阶段工作草案；源稿不变 | 样稿通过；XML未提供的单位meta按现行契约保留库中原值，不据此宣称XML完整序列化全部单位字段 |
| 初始化不得覆盖已有正文 | XML导入后的编辑标记保存重开仍在；重开content/meta深比较相等；复制的非封面正文相等，已有前言未重套单位模板 | 样稿通过 |
| OOXML/OMML严格schema | baseline37项；最终18份DOCX逐一`officecli validate`，实际输出均为`Validation passed: no errors found.` | 本轮样稿已修复/通过；Word能打开不作为schema通过依据 |
| WP7.3/7.4回归 | full11页、numbering13页逐页文字/尺寸/150dpi灰度像素完全相等；WP7.4共12页，仅末页终结线预期区域不同 | 样稿通过；不是任意文稿无回归的证明 |
| Vivliostyle PDF | 当前UI版式预览按钮→`/api/convert/html-to-pdf`→既有两遍服务，HTTP201，13个目次目标，实际PDF下载 | 通过；与Word PDF独立，未恢复LibreOffice |

## 本轮修复与回归依据

1. **数学设置schema次序**：`m:mathPr`原将`dispDef`放在`smallFrac`前，严格校验报1项。现按schema重排为`mathFont/smallFrac/dispDef/intLim/naryLim`，既有值不变；新增次序及默认值测试，三套settings golden仅重排对应节点。
2. **转换器OMML**：WP7.4基线另有36项错误，包括`sty="undefined"`、空或重复`w:rPr`、互斥normal/style、非法`scrLvl`和重复参数属性。现在仅规范化已知等价属性：有效数学粗/斜体保留，空或等效冗余Word run属性去除，未定义样式去除；默认scriptlevel省略，1/2映射到argSz -1/-2，相同重复尺寸合并。冲突/不支持的尺寸抛出转换错误，沿用可见告警与LaTeX降级。公式主体不删除；矩阵2行4单元格、字形、尺寸和n-ary结构增加回归断言。此修复不承诺所有转换器输出或所有LaTeX字体/颜色都保真。
3. **横排终结线宽度**：Word边框延伸量原被多扣，252 mm版心的终结线仅61.976 mm。左右缩进由5415改5386 twip，重渲染测得62.992 mm；中心150.961 mm/目标151 mm，最后横排表及终结线同页。测试按版心1/4和已测Word边框延伸核对宽度，而不是只断言常量。WP7.4第1–11页完全相等；末页遮去终结线差异矩形外的像素相等。完整比较的`pass=false`为预期区域变更，不伪报全像素相等。
4. 更新DOCX测试版提示，明确真实文稿尚待验收和封面素材限制。未改Vivliostyle转换代码、未增加备案号/行业/地方名称表单、未扩展WP6/WP8。

主导人已审阅子代理的schema变更与全部补丁；五份golden与origin/main差异精确限定为上述mathPr次序及横排终结线缩进，文档主体、编号和域结构没有随golden更新改变。浏览器初次下载仍命中开发服务缓存的旧mathPr，本轮停止旧Vite服务并重新走全部流程、下载和Word渲染，最终18份校验使用重下载的当前文件；旧件只保存在`browser-prebuild`本地调查目录，不作为最终通过证据。

## 毫米测量与规范图像

规范文件：`rules/GBT 1.1-2020 标准化工作导则 第1部分：标准化文件的结构和起草规则.pdf`。已阅读原PDF打印页46、47、48、50、51、52、53、54、55、57的图像（实际PDF页为打印页+7），覆盖封面、目次、前言、条款、附录/文献等相关附录E示意；不用乱码文字层推断规范位置。封面目标同时采用项目用户模板冻结值`wp7.5-template-reference.json`，两类依据适用范围分开：GB/T附录E没有逐一规定的团体/企业标志，按项目模板核对。

测量：Word PDF→300dpi灰度→像素<128墨迹边界→毫米；定位窗口仅找元素，结论来自PDF实际像素而不是DOCX frame。名称流动/字形差异按既有脚本规则处理。终结线另读取Word PDF实际填充矩形的矢量坐标测量宽度及中心，并视觉确认同页位置。目标及原始像素边界、每项偏差见[封面测量JSON](wp7.6-cover-measurements.json)；样稿出处、DOCX/PDF SHA256、浏览器步骤、书眉和终结线证据见[交付证据JSON](wp7.6-delivery-evidence.json)。

| 封面 | 通过/总项 | 最大绝对偏差/mm |
|---|---:|---:|
| 国家标准 | 33/33 | 0.77 |
| 指导性技术文件 | 33/33 | 0.83 |
| 行业标准 | 29/29 | 0.99 |
| 地方标准 | 27/27 | 0.74 |
| 团体标准 | 29/29 | 0.82 |
| 企业标准 | 27/27 | 0.75 |
| 浏览器新建空编号/空日期稿（另计） | 28/28 | 0.77 |

空日期稿字顶251.21 mm/目标251.5，日期段左右25.06/194.73 mm/目标25/195，下横线257.05 mm/目标257；替代及采标实际可见，单位前言在第4页，未截断覆盖。

| full PDF页 | 内容 | 书眉字顶/mm | 首行字顶/mm | 页码距底/mm | 页码距外侧/mm |
|---|---|---:|---:|---:|---:|
| 2、6 | oddPage空白 | — | — | — | — |
| 3、4、5 | 目次/前言/引言 | 26.0 | 43.9 | 20.7 | 24.1 |
| 7 | 正文首页 | 26.0 | 43.9 | 20.7 | 24.4 |
| 8 | 正文续页 | 26.0 | 35.1 | 20.7 | 24.0 |
| 9 | 附录A | 26.0 | 44.3 | 20.7 | 24.2 |
| 10 | 附录B | 26.0 | 44.3 | 20.7 | 24.0 |
| 11 | 参考文献 | 26.0 | 44.3 | 20.7 | 24.2 |

沿用§10.3已冻结同字形Word目标/容差（续页目标35.3±0.3 mm）；不是把规范示意图当成所有字形字顶的统一像素模板。横排页另按§5.15核验，不套用上述竖排量窗。

## 人工检查文件

以下是本轮本地实际文件，位于Git忽略的`tmp-e2e`目录；二进制不提交Git。先检查新建稿的封面/前言，再看导入与副本目次、正文、附录，最后看WP7.4第5页公式、第6–8页续表、第9页横排和第12页终结线。

| 材料（均为测试样稿） | DOCX | Word PDF |
|---|---|---|
| UI新建空值稿 | [created.docx](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/browser-fixture/created.docx) | [created.pdf](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/browser-fixture/created.pdf) |
| UI导入/编辑/重开 | [reopened.docx](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/browser-fixture/reopened.docx) | [reopened.pdf](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/browser-fixture/reopened.pdf) |
| UI复制稿 | [duplicate.docx](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/browser-fixture/duplicate.docx) | [duplicate.pdf](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/browser-fixture/duplicate.pdf) |
| 六类封面 | [封面目录](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/covers) | 同目录gb、guide、industry、local、group、enterprise及gb-review-discussion、gb-comment、gb-review的同名PDF |
| 图表公式/横排 | [wp74.docx](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/wp74.docx) | [wp74.pdf](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/wp74.pdf) |
| 全结构 | [full.docx](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/full.docx) | [full.pdf](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/full.pdf) |
| 编号90项 | [numbering.docx](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/numbering.docx) | [numbering.pdf](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/wp7.6/numbering.pdf) |
| 公式样式边界 | [style-variants.docx](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/schema-agent/style-variants.docx) | [style-variants.pdf](/Users/funtasy/PycharmProjects/set/.worktrees/wp7.6-delivery/tmp-e2e/schema-agent/style-variants.pdf) |

原PDF图像在同目录`reference/`；Word核验图在`final/`；JSON、编号逐条输出、测试/构建日志在`tmp-e2e/wp7.6/`。`vivliostyle-preview.pdf`只属于保留管线验证，不作为Word验收件。

## 测试与复现

- `pnpm --filter @ses/shared test`：32文件，745项通过。
- `pnpm --filter @ses/client test`：17文件，68项通过。
- `pnpm --filter @ses/server exec jest --runInBand`：2套，23项通过。
- `pnpm build`：shared、server、client均通过。既有Vite大chunk和happy-dom/KaTeX提示仍在，无新增构建错误。
- `git diff --check`通过；schema以每份工具的实际校验输出判断，不能只看OfficeCLI进程退出码。

```bash
node packages/client/scripts/wp75-samples.mjs "$PWD/tmp-e2e/wp7.6/covers"
node packages/client/scripts/wp74-sample.mjs "$PWD/tmp-e2e/wp7.6/wp74.docx"
python3 scripts/docx-check/pack.py packages/shared/src/renderers/docx/__tests__/__golden__/numbering "$PWD/tmp-e2e/wp7.6/numbering.docx"
python3 scripts/docx-check/word_pdf.py "$PWD/tmp-e2e/wp7.6/numbering.docx" "$PWD/tmp-e2e/wp7.6/numbering.pdf"
python3 scripts/docx-check/expect.py tmp-e2e/wp7.6/numbering.pdf
python3 scripts/docx-check/cover_measure.py tmp-e2e/wp7.6/covers/gb.pdf --kind gb --sample-flow --json
python3 scripts/docx-check/compare_pdf.py baseline.pdf current.pdf
```

浏览器全流程脚本：`node packages/client/scripts/wp76-browser-flow.mjs <source.xml> <output-dir>`。先完成构建，从独立worktree的`packages/server`工作目录用`PORT=3076 node dist/main.js`启动；Vite在5174且`/api`代理3076。启动时数据库必须为空（脚本主动拒绝非空库），不要删业务数据库以满足条件；应准备另一个隔离空数据目录/checkout。服务器数据库路径相对运行工作目录为`data/ses.db`。本轮保留的隔离库已有最终测试稿，再跑应另建空库。可用如下独立Vite启动命令（在client目录运行），改动shared后需重启开发服务以免复用旧缓存：

```bash
node --input-type=module -e 'import {createServer} from "vite"; const s=await createServer({server:{port:5174,strictPort:true,proxy:{"/api":{target:"http://localhost:3076",changeOrigin:true}}}}); await s.listen(); s.printUrls();'
```

脚本记录输入路径及SHA，不自动认定真实文稿。提供真实XML后，仍需人工确认来源/版本/范围，重走流程并逐项Word验收；若原稿只有DOCX/PDF，先明确如何转录及验证内容完整性。生成DOCX后必须另行Word渲染，不用HTML或Vivliostyle PDF替代该验收。

## 遗留清单与完成条件

| 编号 | 状态 | 下一步 |
|---|---|---|
| R1 | **真实稿件流程未完成** | 获取经确认稿件，完整走UI流程；检查内容无损、逐项测量、Word PDF并经用户人工确认，再更新总验收状态 |
| R2 | Q原图34×35 px/72 dpi；模板素材来源、行业/非国标专用字形未核验；国家机构图片文字固定 | 正式交付前核验素材资格、清晰度及机构适用性；不得称为正式/高清素材 |
| R3 | 其他Word版本、任意长标题/极端表格及公式组合未穷举；续表有人工分页校对边界 | 用目标稿件和实际交付环境追加验证；本机测试不能代替全部环境 |
| R4 | **本轮已确认既有字体/颜色保真限制**：样式边界稿第5页的`\mathsf{x}`仍为普通字体、`\color{red}{x}`仍为黑色；数学粗体/斜体、正常文本及脚本尺寸样例可见 | 未在schema窄修中扩展转换器的全部视觉格式；真实稿件如依赖这些样式，须另作保真修复及Word对照，不可按schema成功放行 |
| R5 | STS自定义扩展没有GB/T 37967扩展schema正式认证；既有输入控件及WP6/WP8待单独任务 | 保留现状及边界，不顺手扩展 |
| R6 | 自动/外部代码审查以PR当前状态为准 | 逐条核对实际意见并修复；本轮以草稿PR交付，未经用户授权不合并 |

WP7.6总验收只有在R1完成、目标稿件需要的遗留问题处理并人工确认后才能标记完成。本轮的测试、schema和模板测量属于补充证据。

## PR与审查状态

[PR #40](https://github.com/funtasy2333/SEP/pull/40)已提交：OPEN、草稿、未合并。2026-10-01 11:23:22 UTC重查：外部reviews、review threads和远程checks均为0；已完成主导人代码审查，未将“没有意见”描述为外部审批通过。真实稿件验收及上表遗留项仍保留，未经用户授权不合并。

## 2026-10-02 用户授权合并

用户明确授权合并 PR #40 和 #41。PR #40 已转为 Ready 并合并，合并提交 `4b31065b364fb2efcfe470897bc82f4b3b80c325`。此授权改变 PR 发布状态，不将真实稿件总验收或遗留项改为通过。后续 PR #41 合并基线时保留本 PR 的 schema/终结线修复，并将六类封面上下横线改为 0.75 pt；旧封面测量属于 0.5 pt 版本，不充当新线宽的测量证据。组合分支本次 shared 745、client 99、server 23 项全部通过，全项目构建通过。
