# WP7.5 封面验收记录

2026-09-30。最初从当时最新 `origin/main` 的 `382b709de696672c6e2977ff4fbf5ddb5d6dd643` 开工；开发期间主分支合入列项修复与移除 LibreOffice 导出的变更，已重基到最新 `a727ff82c8e1c6abb095bf6e6f944e1db7112d75` 并重新验收。独立分支 `codex/wp7.5-cover`，工作树 `/Users/funtasy/.codex/worktrees/wp7-5-cover/set`。主工作区的未提交 `docs/素材/终结线.jpg` 与未跟踪 `.pnpm-store/` 未纳入本包。

## 结论与边界

WP7.5 实现与本次 Word 样稿验收通过。六类封面取代占位封面，始终保留唯一的 `SesCoverStdNo` 段；七种阶段穷尽映射；征求意见稿、送审稿有完整的专利征集说明。新增五个封面字段支持封面节点、IR、文档元数据覆盖及真实 ProseMirror 保存/重载。

实际环境为 **Microsoft Word for Mac 16.113.3**（本次 AppleScript 读取版本），**未验证 WPS，按用户要求不作为本包验收条件**。以下是固定样稿在本环境的结果，不是对其他 Word 版本、字体替换、任意长度元数据或用户另存后再编辑的保证。WP7.6 真实标准文稿的整体交付验收尚未进行。

素材限制见 [封面素材记录](wp7.5-cover-assets.md)：DB 原始来源未核实；行业/T/Q 标志与非国标发布机构专用字为明确标注的近似。T/Q 未使用不合格或第三方模板素材，不称正式标志。国标发布机构图片来自 GB/T 1.1-2020 原件的固定2020文字，不是可定制或已核验当前机构的官方数字标志。导出包含近似素材或缺失必要信息时，DOCX 下载会显示核对提示。

## 可复现的生成与测量

```bash
node packages/client/scripts/wp75-samples.mjs "$PWD/tmp-e2e/wp7.5"
python3 scripts/docx-check/word_pdf.py "$PWD/tmp-e2e/wp7.5/gb.docx" "$PWD/tmp-e2e/wp7.5/gb.pdf"
python3 scripts/docx-check/cover_measure.py "$PWD/tmp-e2e/wp7.5/gb.pdf" --kind gb --sample-flow --json
```

对 guide/industry/local/group/enterprise 用同名 DOCX/PDF 与 `--kind` 重复 Word 渲染和测量。生成器经过真实 `buildDocxBlob` 链，输出原始 DOCX；`word_pdf.py` 只在 Word 沙盒核验副本去除打开时的域更新提示触发标记，随后用 Word 更新域、导出 PDF，关闭且不保存。产品的 `PAGEREF`、自动更新设置与当前主分支 PDF 导出行为不改变。

`cover_measure.py` 沿用 `measure.py` 的 **300 dpi 灰度、灰度小于128算墨迹**，按实际像素测量，未将 OOXML 定位值当作渲染结果。`--sample-flow` 专用于本生成器的两行中文名称、两行英文（四类）及一行一致性标识；其他文稿需按实际行数核对。分节后的全部页面也已作视觉检查；第2页为空白页，第3页目次、第4页前言、第5页正文。

完整数值、行块和逐项判定随 PR 保存于 [测量 JSON](wp7.5-cover-measurements.json)，本地还有 `tmp-e2e/wp7.5/measurements.json`、`manifest.json`、`cover-contact-sheet.png`、`gb-all-pages.png`。

| 封面类型 | 阶段样稿 | 检查通过数 | 最大绝对偏差 |
|---|---|---:|---:|
| 国家标准 gb | 发布稿 | 31/31 | 0.77 mm |
| 指导性文件 guide | 报批稿 | 31/31 | 0.83 mm |
| 行业标准 industry | 征求意见稿 | 28/28 | 0.99 mm |
| 地方标准 local | 送审稿 | 26/26 | 0.92 mm |
| 团体标准 group | 公示稿 | 28/28 | 0.92 mm |
| 企业标准 enterprise | 工作草案 | 26/26 | 0.92 mm |

合计 **170/170**；目标允差为 ±1 mm。包含分类号、40×20 mm 标志区墨迹四边、称谓、编号与代替编号、横线、名称、发布日期/实施日期与下横线；国标发布机构两行块比较 x=68.6–151.4/y=264–276，非国标一行机构按方案小二字比较字顶264及版心内居中。名称首行字顶115.40 mm、行距12.95 mm（目标约12.9）；有英文时英文距中文末行10.50 mm、一致性距英文末行14.48 mm，全部达标。近似素材的定位通过不等于素材质量或正式来源通过。

额外 Word 样稿 `gb-review-discussion` 覆盖送审讨论稿；`gb-comment` 与 `gb-review` 再核验国标两种专利说明。七阶段中的每一项同时有自动化测试。行业征求意见稿、地方送审稿、国标征求意见稿/送审稿的 PDF 均能提取完整专利征集句。没有专利说明的其他阶段也有回归断言。

## 人工检查文件

这些文件在本地工作树的 Git 忽略目录中，未提交样稿二进制。PDF 为 Microsoft Word 实际导出的核验副本；DOCX 为真实导出链生成、保留原有更新域行为的稿件。

| 类型 | DOCX | Word PDF |
|---|---|---|
| 国家标准 | [gb.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/gb.docx) | [gb.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/gb.pdf) |
| 指导性文件 | [guide.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/guide.docx) | [guide.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/guide.pdf) |
| 行业标准 | [industry.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/industry.docx) | [industry.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/industry.pdf) |
| 地方标准 | [local.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/local.docx) | [local.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/local.pdf) |
| 团体标准 | [group.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/group.docx) | [group.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/group.pdf) |
| 企业标准 | [enterprise.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/enterprise.docx) | [enterprise.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5/enterprise.pdf) |

补充样稿同目录下 `gb-review-discussion.docx/.pdf`、`gb-comment.docx/.pdf`、`gb-review.docx/.pdf`；回归稿 `wp74-regression.docx/.pdf`。审查补充稿 `industry-mandatory.docx/.pdf` 验证 `HG 1234—2026` 显示 `HG` 标志。源素材可通过 `python3 scripts/docx-check/prepare_cover_assets.py` 重建。

## 自动化与 WP7.3/WP7.4 回归

- `pnpm --filter @ses/shared test`：32文件、709测试通过。
- `pnpm --filter @ses/client test`：13文件、47测试通过。
- shared build、client build 通过。Vite 仍有原有大 chunk 提示，非失败。
- 六类分别校验包 XML/关系、子元素顺序、编号引用、确定性和 JSON 往返；七阶段、专利、缺字段/空白编号告警、编号规范化、英文类型差异、图片ID共同分配与封面元数据真实 schema 往返均覆盖。
- full/numbering golden 的目次后正文树分别 **84/84、168/168** 元素与基线相同；`numbering.xml`、四个页眉页脚、`settings.xml`、`fontTable.xml` 逐字节未变。改变的部件仅封面内容/样式及图片所需内容类型、关系和两张 media。
- 用 `origin/main` 源码临时只读副本生成 WP7.4 Word 基线，和当前生成器的回归稿同为 **12页**。除封面外第2–12页，**150 dpi灰度渲染逐像素一致，页尺寸与PDF提取文字逐页一致**，包括目次、编号、14个公式、续表、图片、横排、书眉页码和终结线。结果在本地 `wp74-regression-comparison.json`。
- 保留当前主分支 Vivliostyle PDF 管线及已移除 LibreOffice 导出的行为；没有恢复被移除的接口或调用。仅 DOCX 输出按本包增加封面，DOCX 卡片继续标为测试版。主分支二级数字与间隔号列项修复的测试及正文快照也保持一致。

## 审查已修正的问题与遗留项

实现审查已修复：真实编辑器未注册封面节点会丢元数据（生产扩展工厂已注册，回归测试直接使用同一配置）；缺名称告警重复；地方/企业不应输出英文；日期顺序不符原件；缺发布机构时不能拿地区名称猜测机构；歧义编号不能误拆公司/行政代码；文字近似标志需按 Word 实测缩放；素材告警不能在实际 DOCX 导出界面静默丢弃；带空格的强制性行业编号如 `HG 1234—2026` 错用 `XX` 标志（已从完整规范编号提取行业代号，补8组有效/畸形/异类编号回归）。PR #39 收到的两条 P1 与一条 P2 审查意见均已修复。P1 修复后重新生成的原九份DOCX与已验收版本逐字节相同，既有Word测量仍对应最终实现。更新快照没有掩盖正文改动，上述树比较和Word像素对照独立验证了回归边界。

XML 往返的 P2：五字段写入 `custom-meta-group content-type="ses-cover"` 应用扩展，解析后由 `coverPage` 保存；生产导入入口只适配根节点类型，不迁移全局 schema。真实 DOMParser → 生产 schema → IR → 二次 XML 导出验证新字段，以及编号、标题、日期、ICS/CCS、机构不丢失；无扩展组的旧 XML 解析保持原行为。新增 `happy-dom` 仅为 client 测试开发依赖。该应用扩展没有进行 GB/T 37967 的扩展 schema 正式符合性认证。此修复不改 DOCX 渲染或本次 Word 样稿。

遗留：DB/T/Q及行业正式标志来源、非国标专用字仍待合格源替换；团体/企业为§6.2比照版式，未取得专属封面规范样本；新增五字段尚未进入封面表单输入界面（本包仅节点/IR/元数据支持，按§6.5另开任务）；国标机构文字固定于2020原件，机构变化或指定其他机构时需换源；任意长名称/译名/多行机构及其他 Word 版本未作穷举，正式交付仍需核对；WP7.6 尚未完成。
