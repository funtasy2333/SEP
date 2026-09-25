# WP7.0 spike：从零生成 DOCX 的 Word 机制验证

> 2026-09-24，主导人实测。环境：Microsoft Word for Mac 16.113.2（本机无 WPS、无 LibreOffice）。
> 本目录不进入生产代码，是 `docs/wp7-docx-delivery.md` 的实测依据；实施方可直接参照 `gen_spike.py`
> 里的 XML 写法（已被 Word 接受并正确渲染）。

## 文件

| 文件 | 说明 |
|---|---|
| `gen_spike.py` | 不依赖任何模板、从零拼 DOCX（styles / numbering / settings / 页眉页脚 / 分节 / 目次域 / 公式 / 终结线） |
| `omml2.js` | 公式转换原型：KaTeX → MathML → n-ary 吸收 → mathml2omml → 转义还原 |
| `omml.json` | `omml2.js` 产出的 OMML，供 `gen_spike.py` 读取 |
| `spike.docx` | 最终版（v9）生成结果 |
| `spike-word.pdf` | Word 打开 `spike.docx`、更新目次后导出的 PDF |
| `probe_v10.py` | v10（2026-09-25，WP7.2 规格核对）：编号实例的计数语义、STYLEREF 缺值、字距、分节空段；生成 9 个小文档，结论见下表 v10 各行 |

复现：

```bash
npm install && node omml2.js && python3 gen_spike.py spike.docx
```

v10：`python3 probe_v10.py <outdir>`，再对每个文档运行 `scripts/docx-check/word_pdf.py`，用 PyMuPDF 取文字核对。

用 Word 导出 PDF（macOS；文件必须放在 Word 沙盒目录内，否则会弹文件授权；首次运行需允许「控制 Microsoft Word」）：

```bash
osascript -e 'tell application "Microsoft Word"' -e 'open (POSIX file "/Users/<you>/Library/Containers/com.microsoft.Word/Data/spike.docx")' -e 'update (table of contents 1 of active document)' -e 'save as active document file name "/Users/<you>/Library/Containers/com.microsoft.Word/Data/spike.pdf" file format format PDF' -e 'close active document saving no' -e 'end tell'
```

## 结论（按迭代）

| 版本 | 验证项 | 结果 |
|---|---|---|
| v1 | 从零生成的 DOCX 能否被 Word 正常打开 | ✅ 无修复提示；嵌入 SimSun / SimHei / Times New Roman |
| v1 | 封面 → 目次（罗马 I 起）→ 前言 → 正文（阿拉伯 1 起）分节、`oddPage` 自动空白页 | ✅ 空白页不印书眉页码（符合 10.1.4） |
| v1 | 奇偶书眉（`evenAndOddHeaders` + `mirrorMargins`）、书眉 `STYLEREF` 取封面文件编号 | ✅ |
| v1 | 目次域 `TOC \o "1-2" \h \z \u` | ✅ 自定义样式靠段落大纲级别入目次；附录三行（段内换行）在目次中合成一行「附录A （规范性） 标题」；无标题条不入目次 |
| v1 | 单条注「注：」、多条注按组重起「注1/注2」、「示例：」独占一行、列表按实例重起 a)、破折号列项、参考文献 [n] | ✅ |
| v1 | 无标题条、术语条目编号与有标题条共用章条列表（样式级 numPr） | ❌ 编号不显示 |
| v1 | 附录图/表作为附录多级列表的第 7/8 级（`lvlRestart=1`） | ❌ 图/表编号对，但 A.1.1 被顶成 A.1.2 |
| v1 | 公式：行内 OMML + 居中制表位 + 点线右对齐编号（10.4.3） | ✅ 版式对；但 ∑ 与被加项间有大空隙 |
| v2 | 去掉级别→样式绑定；附录图/表改为每附录一个编号实例（lvlOverride 覆盖 lvlText） | ✅ 附录 A.1.1、图A.2、图B.1/表B.1 全对；❌ 无标题条仍不显示 |
| v3 | 无标题条/术语编号改用独立 numId（指向同一 abstractNum） | ❌ 仍不显示。另存后可见：Word 给每个级别只绑定**第一个**引用它的样式，其余样式上的 numPr 被删除 |
| v4 | 无标题条、术语条目编号、附录无标题条改为**段落级** numPr | ✅ 3.1/3.2、4.1→4.2（无题）→4.3→4.3.1→4.3.2、5.1、A.2 全对 |
| v4 | 公式预处理「n-ary 吸收」（把 ∑∫ 后的被加/被积项包进 mrow） | ✅ 空隙消失，(xᵢ−x̄)² 整体进入 ∑ |
| v5 | 同段落内用 `m:oMathPara` 能否得到显示样式 | ❌ Word 一律降为行内样式（分式缩小、∑ 上下限在侧）；满足「……」点线连接的代价，记为已知限制 |
| v6 | 三号标题关闭网格对齐 + 固定 20 磅行距 + 段前 500 / 段后 600 | ✅ 目次、正文首页名称字顶 43.9 mm（原件 44.0），到下文 12.5 mm（原件 12） |
| v6–v7 | `pageBreakBefore` 或手动分页符后的标题 | ❌ Word 吞掉页首的段前距（标题顶到 35 mm） |
| v8–v9 | 前言、每个附录、参考文献各起一节（`nextPage`，页码续编） | ✅ 字顶 43.9–44.3 mm。注意：`sectPr` 写在**一节末尾**、描述的是它结束的那一节 |
| v10 | 同一 abstractNum 的两个实例 X、Y（都写 `startOverride`）交错使用：X Y Y X Y | ❌ 显示 注1 注1 注2 **注3 注4**。计数器属于 abstractNum、各实例共用；`startOverride` 只在实例**第一次被使用**时重置一次（T1；列表实例交错同理，T5：a) b) a) **b) c)**） |
| v10 | 对照：同一 abstractNum 的两个实例都不写 override | 甲1 甲2 甲3（T2），与上一行同一机制 |
| v10 | 只在 L1 使用的新实例，override 只写 ilvl 0 | ❌ 接着前一个实例的 L1 往下数：2) 3) 4) 5)（T4）；override 写 ilvl 0 与 ilvl 1 则各自 1) 2)（T4b ✅） |
| v10 | 回到前一组时新建实例，`startOverride` 写该组的下一个序号 | ✅ 注1 注1 注2 **注2 注3**（resume） |
| v10 | 父列表与嵌套项共用实例：L0 L1 L1 L0 L1 | ✅ a) 1) 2) b) 1)（T3） |
| v10 | 段落级 numPr 指向由另一个样式「属主」的固定实例（表注 → 注的 A7） | ✅ 注：（T6） |
| v10 | 间隔号（`SesListDot`，另一 abstractNum 的 L1）嵌在字母列表中 | ✅ a) · b)，字母列表计数不受影响（T8） |
| v10 | 字距：「目」的 run 加 `w:spacing 640`；附录 L0 的 lvl rPr 加 `w:spacing 210` | ✅ 与「前　　言」（两个全角空格）同宽；「附　录　A」 |
| v10 | 书眉 `STYLEREF` 的缓存值写成别的文字 | Word 渲染（含导出 PDF）时重算，显示封面段落的实际文字，缓存值不出现 |
| v10 | 封面有 `SES_封面文件编号` 段但为空 / 文档中没有该样式的段落 | 空段 → 书眉空白；没有该段 → 书眉显示「错误!文档中没有指定样式的文字。」 |
| v10 | 分节空段（无 pStyle，同 `gen_spike.py`）：版心排满 43 行后紧接分节空段 | ✅ 不多出空白页（44 行时第 44 行正常转到下一页） |
| v10 | 编号格式：upperLetter / lowerLetter 从 25 起、lowerRoman 从 4 起、upperRoman 14 | Y Z **AA BB CC**（小写同）；iv v vi vii viii ix；XIV |

## 实测对照（Word 渲染 vs GB/T 1.1-2020 出版物本身，300 dpi 墨迹检测）

| 项 | Word（spike） | 原件出版物 | 图 E.1/E.2 标称 |
|---|---|---|---|
| 书眉字顶 | 26.0 mm | 25.7 mm | 距纸顶 25 |
| 正文首行字顶 | 35.1 mm | 35.3 mm | 书眉下 5 |
| 页码距纸底 | 20.7 mm | 20.7 mm | 20 |
| 页码距外侧纸边 | 24.2 mm | — | 24 |
| 目次/前言/附录/参考文献标题字顶 | 43.9–44.3 mm | 43.7–44.2 mm | 书眉下 15 |
| 终结线 | 段落下边框 0.75 磅 | 长 40.3 mm、粗 0.25 mm | 版心宽 1/4 |
| 表格线 | — | 外框/表头 0.25 mm，内线约 0.1 mm | 粗/细实线 |
| 标题字距 | — | 「目　　次」「前　　言」「索　　引」两字间 2 个全角空格；「附　录　A」「参　考　文　献」逐字 1 个 | — |

## 未验证（留给后续工作包）

- WPS 渲染（本机无 WPS）
- 表头跨页重复、横排节的页眉页码
- `w:updateFields` 打开时的更新提示
- 封面（图文框定位 + 标志图片）
