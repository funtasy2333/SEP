# WP7.6 当前基线补充验收（2026-10-03）

**状态：部分完成；真实标准文稿流程与横排条文脚注分隔线仍未完成。** 本文的 DOCX/PDF 均为功能测试样稿。已再次询问真实文稿来源、版本及路径，尚未收到确认；仓库 fixture、spike 和主库“测试标准”“测试标准TEST”均不充当真实文稿。未宣称全面符合 GB/T 1.1、所有 OOXML/OMML 组合或所有 Word 版本。

## 基线与隔离

本轮重新 fetch，`origin/main` 为 `3ffff1f01367bff513482fd1217e4cc64751cb8c`。PR #40/#41/#42 均已合并；#42 的 squash 即本基线，最新旧 head `d0d123f6` 的 Codex 回复为 “Didn't find any major issues”。这些历史结论不替代本分支新提交的审查。

分支 `codex/wp76-acceptance`，独立工作树 `/Users/funtasy/.codex/worktrees/wp76-acceptance/set`。主工作区终结线图片 SHA256 保持 `8134494f8e129a1880f44725c7f61bda39833149bbb30451e07834f2657809c8`；主工作区 `.pnpm-store/`、`.worktrees/` 未清理、覆盖或提交。依赖用独立 `/private/tmp/sep-wp76-store`。

环境：macOS 26.4、Microsoft Word for Mac 16.113.3、OfficeCLI 1.0.152、Node 22.22.3、pnpm 10.33.0、Python 3.11.4。Word 版本已读当前应用 plist 核实。测试 UI 为 5193，后端 3093，数据库位于本工作树 `tmp-e2e/wp76-acceptance/browser-runtime/data/ses.db`，仅创建了本轮测试文档。无需 WPS 验证；未恢复 LibreOffice，也未扩展 WP6/WP8。

## 本轮修复

1. **独立相邻表被 Word 合并。** 补充样稿中两张表连续输出 `w:tbl`，Word 在后表续页重复第一张表的标题和表头。现按 Word 的表边界规则，在相邻顶层表之间输出普通空段。竖排与横排各有红灯回归；修复后 Word 第7/8页只显示本表标题，第8–10页只延续表3，合并单元格和定义保持。没有删除 `oddPage` 或改变节/编号规则。
2. **脚注 payload 静默丢内容。** `footnoteRef.attrs.content` 可携带 schema 不校验的任意 JSON；含合法文字加不支持的块节点时，旧转换只输出文字。现在将无法无损映射的脚注标为 `invalid-footnote`，XML、HTML、DOCX 一并拒绝输出；源 PM 数据不修改。未知块、未知格式、无效节点/文本/marks 均有回归；旧别名 strong/em 在 XML 中无对应序列化分支，也明确拒绝。叶节点的额外内容字段、mark及其attrs内的content/text和嵌套对象均拒绝，格式类型和引用字段也做结构检查；负例逐一确认三出口阻断且源JSON不变，合法粗斜体、上下标、换行和交叉引用保留。未新增复杂块脚注能力。条文与表脚注的上标引用若自身带附加格式，也明确阻断；错误提示指导先取消上标附加格式，源数据不剥离。脚注正文的规范格式继续支持。
3. **横排脚注提示。** 文稿同时包含条文脚注与横排节时，DOCX 返回并在 UI 显示 `footnote-landscape-separator` 提示。提示反映既有未完成项，不能当成分隔线修复。表内仍只允许表脚注，不引入非法条文脚注来伪造通过样稿。

## 本轮逐项检查

| 项目 | 当前证据与覆盖 | 结果 |
|---|---|---|
| 真实标准文稿完整流程 | 来源/版本/路径尚未确认；新建/导入→编辑→保存重开→复制→DOCX→Word 尚无合格真实输入 | **未完成** |
| 实际 UI 持久化流程 | 空隔离库；新建、XML 导出再导入、脚注样稿导入、段落编辑、保存/reload、复制、DOCX/XML 六次下载；5步断言、0 pageerror；三份下载 DOCX 均由本机 Word 渲染 | 样稿通过；本轮 UI 编辑的是正文段落，不重复宣称所有菜单操作已人工穷举。UI输入的早期fixture横排表题注写“横排条文脚注”，实际仅含表脚注；final/delivery已改为“横排表脚注”，不是横排条文脚注通过证据 |
| 新建封面与前言 | 空编号与日期占位、替代/采标、提出/归口/起草单位、专利句；保存与 XML 回导元数据一致；重开不重套初始化模板 | 样稿通过 |
| 六类封面 | 当前 0.75 pt 源码重新生成及 Word 渲染；ICS/CCS、标志、编号、名称/译名、替代/采标、日期和机构位置 | 178/178 项在 ±1 mm 内；素材资格仍有限 |
| 阶段 | 本轮 Word 九份封面覆盖六类与七阶段：国标发布稿、指导性报批稿、行业征求意见稿、地方送审稿、团体公示稿、企业工作草案及国标送审讨论/征求意见/送审稿；逐份阶段以manifest为准 | 已覆盖样稿通过；不把九份 Word 样稿说成六类型×七阶段42份实排 |
| 目次与书眉页码 | Word 更新 PAGEREF；full 11页、numbering 13页；前置罗马数字、正文阿拉伯数字、附录和参考文献、镜像书眉/页码；逐页图像核查 | 样稿通过；章条增删后仍需重新导出/调整目录条目 |
| 封面后空白页 | 当前生产导出的 delivery、standalone-border 以及 UI 下载稿均实排；delivery 第2页无文字、无矢量图，灰度最小值255；第3页目次I、第4页前言II、第5页正文1 | **预期 oddPage 空白**，无书眉页码，无需删节 |
| 条文脚注 | 前言、正文、恢复竖排的调用分别 1)、2)、3)，Word 第4/5/12页底内容对应；上下标、小五宋体；marker/content 相对版心左端18/36 pt | 覆盖样稿通过 |
| 竖排条文分隔线 | Word PDF 第4/5/12页矢量宽 41.233 mm，对165 mm版心的1/4目标41.25 mm；厚约0.48 pt，对名义0.5 pt | 样稿通过 |
| 独立/组合表注脚注框 | 当前 standalone-border 第5页：独立上框0.72 pt，组合外上框0.72 pt，内部0.24 pt；OOXML名义0.75/0.75/0.25 pt | Word 和 schema 分开通过 |
| 仅上标单元格 | Word 第7/11页仍显示 a/b；B、A、B 的调用顺序显示 a、b、a；真正空单元格显示一字线；定义次序B、A，重复不重造定义 | 样稿通过 |
| 合并与续表 | colspan、rowspan 保留；70条记录分布第8–10页，续表标题/表头重复，仅第10页末段有表注和a/b定义；横排表第11页，恢复竖排第12页 | 样稿通过；极端任意组合仍需目标文稿复核 |
| XML/JSON/复制 | 生产 schema→JSON保存重开→XML往返→复制→buildDocxBlob；三份当前DOCX均Word实排；UI复制仅改题名与阶段，非封面正文及原文档快照不变 | 样稿通过；STS扩展没有正式外部schema认证 |
| 横排条文脚注 | 测试副本仅将前言节旋转横排，脚注内容不变；Word实测128.270 mm，对252 mm版心目标63 mm | **失败/未完成**；此物理分节探测不是编辑器支持的横排段落流程 |
| 图表公式/横排回归 | 当前 wp74 12页、14类公式、矩阵/n-ary、64行续表、横排及终结线；逐页Word图像；与明确标为历史的PDF比较，第2–12页像素完全相同，第1页封面线宽变化 | 样稿通过；既有 mathsf/color 保真限制未扩展 |
| 编号 | 当前 numbering PDF 90/90视觉行期望通过；层级章条、术语、列项、示例/注及附录 | 样稿通过 |
| 严格 OOXML/OMML | 20份**生产导出/既有golden打包样本**逐份 OfficeCLI 校验，实际输出均为“Validation passed: no errors found.”，文件哈希可核查；物理横排探测副本另计，不混入20份通过数 | 样稿通过；Word能打开不等于schema通过 |
| Vivliostyle | 当前UI点击版式预览→既有 `/api/convert/html-to-pdf` 两遍服务→HTTP201→实际下载，0 pageerror | 通过，PDF独立于Word验收件 |

## 测量与原始依据

本轮读 `wp7-docx-delivery.md` §10、WP7.5两份验收文档、WP7.6历史记录及脚注记录，再核对仓库 GB/T 1.1—2020 **原PDF页图像**：物理页38/39（打印31/32）、40/42（33/35）、53/54/55（46/47/48）、61/62（54/55）、66（59）。覆盖脚注编号/位置/字体、单/双数页、正文、前言、参考文献。封面目标仍采用项目冻结 `wp7.5-template-reference.json`，团体/企业素材适用范围不借 GB/T 示意图背书。

封面按现有 `cover_measure.py` 的300dpi灰度墨迹边界测量；位置目标与线宽分别核对。脚注分隔线/表边框从实际 Word PDF 的填充矩形坐标读取，另查看整页图像确认。full的辅助文字外包框测量为书眉顶约25.50 mm、页码距底约19.96 mm；此为PDF文字外包框，不混同历史灰度墨迹边界。条文内容字号Word PDF约9.12 pt，上标约4.56 pt；表脚注第7页 marker/content 相对表左框约18.24/27.24 pt。小量差异包含Word输出取整，不能据此把所有版式元素都称为±1 mm合格。

| 类别 | 通过项 | 最大绝对偏差/mm |
|---|---:|---:|
| 国家标准 | 33/33 | 0.77 |
| 指导性技术文件 | 33/33 | 0.83 |
| 行业标准 | 29/29 | 0.99 |
| 地方标准 | 27/27 | 0.74 |
| 团体标准 | 29/29 | 0.82 |
| 企业标准 | 27/27 | 0.75 |

六类当前 DOCX 上下两条封面线均 `w:sz=6`（0.75 pt）；Word PDF 约0.72 pt。新建空值稿测量另有28/28项通过，不混入上述178项。

[原始封面测量](wp7.6-acceptance-2026-10-03-cover-measurements.json)与[完整证据、SHA256及逐份schema输出](wp7.6-acceptance-2026-10-03-evidence.json)随文提交。二进制及隔离库留在忽略目录 `tmp-e2e/wp76-acceptance/`。Word通过 `word_pdf.py` 仅打开核验副本、更新域、导出并关闭副本；输入DOCX不修改，不关闭用户文档。交付稿打开后的PAGEREF仍需按说明更新。

## 可人工检查的本地文件

下列均为本轮实际输出；全量路径及哈希见证据JSON。

| 文件 | DOCX | Word PDF |
|---|---|---|
| 脚注、合并、续表与横排补充稿 | [delivery.docx](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/final/delivery.docx) | [delivery.pdf](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/final/delivery.pdf) |
| XML往返/复制 | 同目录 `xml-roundtrip.docx`、`duplicate.docx` | 同名PDF |
| 独立/组合表脚注边框 | [standalone-border.docx](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/final/standalone-border.docx) | [standalone-border.pdf](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/final/standalone-border.pdf) |
| UI新建空值、编辑重开、复制 | [browser-fixture目录](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/browser-fixture) 中 `created/reopened/duplicate.docx` | 同名PDF及editor.png |
| 六类及阶段封面 | [covers目录](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/covers) | 九份同名PDF |
| 公式图表与横排 | [wp74.docx](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/wp74.docx) | [wp74.pdf](/Users/funtasy/.codex/worktrees/wp76-acceptance/set/tmp-e2e/wp76-acceptance/wp74.pdf) |
| 全结构/编号 | 根目录 `full.docx`、`numbering.docx` | 同名PDF |
| 横排条文分隔线失败探测 | 根目录 `footnote-landscape-probe.docx`（只改核验副本的物理分节） | 同名PDF第4页；**非生产交付件** |
| 现有预览管线 | 无DOCX | 根目录 `vivliostyle-preview.pdf`；非Word PDF |

## 测试与复现

最终共享层35文件795项、客户端24文件171项、服务端2套23项通过；完整 `pnpm build` 通过。新增边界专测29项、相邻表2项、横排提示2项。边界和相邻表均先复现红灯；日志路径在证据中。既有Vite大chunk及happy-dom/KaTeX提示保留。主代理审阅全部补丁，并在最终文本类型守卫后核对全量结果和无损路径。`git diff --check`通过。

```bash
# 从当前client源码及生产schema导出，不复用历史DOCX
node packages/client/scripts/wp76-footnote-samples.mjs "$PWD/tmp-e2e/wp76-acceptance/final" <可选的边框fixture.json>
python3 scripts/docx-check/word_pdf.py tmp-e2e/wp76-acceptance/final/delivery.docx tmp-e2e/wp76-acceptance/final/delivery.pdf
# Word串行运行；不要同时驱动同一应用
node packages/client/scripts/wp75-samples.mjs "$PWD/tmp-e2e/wp76-acceptance/covers"
python3 scripts/docx-check/cover_measure.py tmp-e2e/wp76-acceptance/covers/gb.pdf --kind gb --sample-flow --json
python3 scripts/docx-check/expect.py tmp-e2e/wp76-acceptance/numbering.pdf
# UI脚本只接受本机origin且拒绝非空文档库；重新执行应另建隔离空库，不能删业务库
WP76_BROWSER_ORIGIN=http://localhost:5193 node packages/client/scripts/wp76-browser-flow.mjs <已确认来源的XML> <输出目录>
```

## 尚未完成与完成条件

- **真实文稿总验收**：需要用户确认原稿来源、版本及路径；若为DOCX/PDF，须先确认转录方式与完整性，不能自动把样稿认作真实稿。随后重走完整UI和Word流程并人工确认。
- **横排条文脚注分隔线**：当前探测实排128.270 mm，目标63 mm；百分比表格、VML/相对DrawingML探测均未在本机Word达到目标，未将失败方案写入生产代码。横排页脚注及跨页延续须后续修复和实排验收；本轮没有跨页长条文脚注达到横排页的成功证据。
- **既有限制**：嵌套表导出、块结构复杂脚注、特殊星号脚注、图脚注尚未扩展；`mathsf`/`color`既有字体颜色保真限制、本机以外Word版本、极端长标题/表格仍需按真实目标追加验证。
- **素材资格**：Q原图34×35 px/72dpi、国家发布机构整幅固定文字、模板来源及专用字形尚待核实；本轮位置通过不赋予正式/高清素材资格。
- **PR与外部审查**：[草稿PR #43](https://github.com/funtasy2333/SEP/pull/43) 的首轮 `6a4d9e42` 收到1条P2：strong/em在XML中丢格式。已补红灯并采用规范mark白名单阻断，13项边界及全量回归通过；后续 `74c72b4b` 复审又指出叶节点携带子内容仍丢文字，已补11类隐藏内容红灯并修复，另校验畸形跨引用；27项脚注专测及当前全量回归通过。虽然文档提交 `c5b7ce0e` 收到无重大问题回复，仍继续修复此前已确认缺陷。`1610ced2` 复审指出上标引用本身的marks未检测，已将条文和表脚注两入口同时修复，schema-valid红灯及三出口/源数据保留测试通过；边界专测29项、客户端171项通过，继续请求最终新head复审。实际修复、手动resolved及新提交复审结果分别核对，新复审以GitHub当前状态为准。没有合并授权，保持未合并；旧PR的无重大问题不作为本PR结论。

脚注上标目前不支持附加粗斜体等格式；编辑器选区包含上标而施加格式时，请先取消上标上的附加格式再导出。这是明确拒绝的边界，默认自动上标和脚注正文的规范格式仍支持。

仅在真实稿件流程完成、目标稿件所需的遗留问题处理并人工确认后，才能标记WP7.6总验收完成。
