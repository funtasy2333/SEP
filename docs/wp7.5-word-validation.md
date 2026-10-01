# WP7.5 封面验收记录（用户模板修订）

2026-09-30。隔离工作树 `/Users/funtasy/.codex/worktrees/wp7-5-cover/set`，分支 `codex/wp7.5-cover`，基线为最新 `origin/main a727ff82c8e1c6abb095bf6e6f944e1db7112d75`。未修改主工作区未提交的终结线图片及未跟踪的 `.pnpm-store/`；用户提供的六个原始模板SHA-256均与开工读取值一致。

## 本次修正与验收范围

六类封面以用户模板修正：T及团体斜杠采用PNG图片、Q采用模板TIFF转PNG；DB图片与2/4位地区数字同行，解析前规范化编号；行业代号从实际编号提取并采用模板48pt Times New Roman粗体、水平130%。团体/企业机构代码保留输入大小写。非国标发布机构改为模板黑体四号常规字。国家标准及指导性文件的机构与发布用含两行机构、垂直居中“发布”的同一幅模板图片，不重复拼接发布文字。

七阶段映射、征求意见稿/送审稿专利征集句、唯一SesCoverStdNo及书眉引用保留。封面节点及XML导入/导出保留新增五字段与既有标题、编号、日期、ICS/CCS、机构、标准类型。旧XML无ses-cover扩展组也经生产schema保留元数据，IR不再因导入适配器丢失类型而回退国标；§9既有文档库DocumentMeta显式覆盖优先级保持不变。

Word环境为Microsoft Word for Mac 16.113.3，六类最终DOCX由真实buildDocxBlob链生成。按用户要求未验WPS。固定样稿通过不等于任意长名称、代号、多行机构、其他字体或Word版本全面通过；WP7.6真实标准文稿整体交付验收未进行。

素材来源见 [素材记录](wp7.5-cover-assets.md)。本次用户模板参照替代旧的T/Q文字近似及机构排版，原始来源仍未正式核验；尤其Q仅34×35 px、72dpi，按用户要求使用原图，不重采样、不称高清或正式素材。国家机构图片文字固定为模板内容；机构变更需另换源。下载卡片更新为“测试版 · 支持图表公式、横排与六类封面”，来源/清晰度限制显示核对提示。

## Word墨迹位置测量

先从原模板及只改缓存占位值的临时副本冻结标志目标，详见 [模板指纹/参照值](wp7.5-template-reference.json)；再校准生成器。没有将模板的说明、链接或占位文字作为执行指令，也未复制模板整套样式/编号/宏。

`cover_measure.py`采用300dpi灰度、阈值<128、实际墨迹四边，允差±1 mm。分类号、称谓、文件编号/代替编号、横线、名称、英文/一致性间距、日期及下横线继续按原方案；标志与发布机构采用本次模板目标。非国标机构的名称长度取元数据，只比较字顶与版心居中，不比较占位名称的宽度。国家机构另检查整体水平居中、两行机构与“发布”的垂直中心差。

| 类型 | 阶段 | 通过数 | 最大绝对偏差 |
|---|---|---:|---:|
| 国家标准 | 发布稿 | 33/33 | 0.77 mm |
| 指导性文件 | 报批稿 | 33/33 | 0.83 mm |
| 行业标准 | 征求意见稿 | 29/29 | 0.99 mm |
| 地方标准 | 送审稿 | 27/27 | 0.74 mm |
| 团体标准 | 公示稿 | 29/29 | 0.82 mm |
| 企业标准 | 工作草案 | 27/27 | 0.75 mm |

共178/178。新结果替代旧版170项记录。六类标志的四边偏差最高0.26 mm；国家机构/发布垂直中心差约0.05 mm（测量JSON保留实际数值）。来源和清晰度限制不因位置通过而消失。完整行块和检查项见 [测量JSON](wp7.5-cover-measurements.json)。六类封面及国标全页已作视觉检查，未见截断或覆盖；Word PDF第2页为空白，第3页目次、第4页前言、第5页正文。

```bash
node packages/client/scripts/wp75-samples.mjs "$PWD/tmp-e2e/wp7.5-template-revision"
python3 scripts/docx-check/word_pdf.py "$PWD/tmp-e2e/wp7.5-template-revision/gb.docx" "$PWD/tmp-e2e/wp7.5-template-revision/gb.pdf"
python3 scripts/docx-check/cover_measure.py "$PWD/tmp-e2e/wp7.5-template-revision/gb.pdf" --kind gb --sample-flow --json
```

其他五类同名生成并指定对应kind。标志四边目标中的HG/DB33/T/TEST/Q/TEST仅适用于该固定样稿，任意其他编号需按实际文本宽度复核。素材重建可运行 `prepare_cover_assets.py --template-dir /Users/funtasy/Desktop/标准模板`；不传参数时用仓库已保存PNG及原件GB图。word_pdf.py仅在Word核验副本去掉打开时域更新触发，再用Word更新域、导PDF并关闭不保存；交付DOCX及产品现有域更新/PDF导出行为不变。

## 人工检查文件

工作树内Git忽略的样稿目录（未提交样稿二进制）：

| 类型 | DOCX | Microsoft Word PDF |
|---|---|---|
| 国家标准 | [gb.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/gb.docx) | [gb.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/gb.pdf) |
| 指导性文件 | [guide.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/guide.docx) | [guide.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/guide.pdf) |
| 行业标准 | [industry.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/industry.docx) | [industry.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/industry.pdf) |
| 地方标准 | [local.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/local.docx) | [local.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/local.pdf) |
| 团体标准 | [group.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/group.docx) | [group.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/group.pdf) |
| 企业标准 | [enterprise.docx](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/enterprise.docx) | [enterprise.pdf](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/wp7.5-template-revision/enterprise.pdf) |

同目录有cover-contact-sheet.png、gb-all-pages.png、manifest.json及measurements.json；补充Word样稿gb-review-discussion、gb-comment、gb-review覆盖剩余阶段与国标专利说明。行业/地方/国标征求意见稿和送审稿的PDF均提取到完整专利征集句；其他阶段没有该句。

## 自动化与正文回归

- shared：32文件、728测试通过；client：13文件、48测试通过；shared/client构建通过。
- 六类包关系/图片尺寸、7阶段及专利、T/Q图文同段、DB两/四位及外侧空白、强制性行业编号、合法码无误警、混合大小写机构码、缺字段、确定性、生产schema及新旧XML往返均覆盖。
- 最后XML/IR修复后重新生成全部10份DOCX，与用于Word验收的稿件逐字节相同，现有PDF对应最终代码。
- 仅有既有Vite大chunk及happy-dom/Katex提示，测试/构建退出码均为0；git diff --check通过。

full与numbering最终golden从SesTocTitle起的整个目次/正文后缀与origin/main逐字节相同；两套header1/2、footer1/2、numbering.xml、settings.xml、fontTable.xml也逐字节相同。新增图片/封面样式不改变编号或正文。

最新WP7.4回归稿与origin/main临时源码生成的Word基线同为12页；第2–12页150dpi灰度逐像素一致，页尺寸和提取文字逐页一致，覆盖目次、编号、14个公式、续表、图片、横排、书眉页码及终结线。结果位于同目录wp74-regression-comparison.json。产品保留当前Vivliostyle PDF管线和已移除LibreOffice接口的状态。

OfficeCLI六类outline/text/HTML/issues已检查，DOCX读取前后SHA不变；HTML无未填模板令牌。空段是画线及分节用途，PAGEREF缓存由Word核验副本更新，原稿保持产品既有行为。OfficeCLI schema validate每类仍报settings.xml的旧mathPr/smallFrac一项；当前origin/main minimal包存在同一项，settings逐字节未变，故本包未宣称完整OOXML schema校验通过。WP7.4公式另有既有OMML schema问题，未在本封面包调整公式。Word实际渲染回归通过；这些严格schema问题留待单独修复。

## 审查与遗留

PR39既有两条P1（生产schema注册、强制性行业编号）及P2（XML五字段往返）已修复。新增P1（XML root front元数据/标准类型丢失）通过schema-backed coverPage迁移和IR/serializer回退修复；新增P2（DB外侧空白导致漏地区码）通过先规范化再解析修复。主审还修正合法编号误发缺码告警、机构代码强制转大写及模板图片后字距。

遗留：Q低清及模板原始来源未正式核验；行业/非国标机构专用字形未核验；国家机构内容固定；替代/采标字段已进入新建表单，余下三字段输入控件仍另开任务（§6.5）；任意长文本及其他Word环境未穷举；STS自定义扩展未作GB/T 37967扩展schema正式认证；既有OMML严格schema问题和WP7.6未完成。没有将上述限制描述为正式素材或全面符合性通过。

## 后续：新建表单和前言

按用户补充要求新增替代/采标输入、编号占位及单位/专利前言初始化，记录见[新建流程验收](wp7.5-new-document-validation.md)。最终shared 733项、client 61项及构建通过；原10份Word验收DOCX逐字节未变，以上178项封面测量仍适用。新建内容在创建时即保存，已有正文不套用新模板。

2026-10-01审查修复：XML导入现有库文档时同步题名、完整front元数据与正文，避免旧库元数据覆盖DOCX/PDF导出。新增3项生产schema/导出请求回归通过；现有PDF渲染管线不变。当前新建样稿与Word实渲染稿件逐字节一致。

2026-10-01日期补正：新建样稿无真实日期时原导出省略日期段及下横线，现六类封面均按侧显示XXXX-XX-XX且固定保留横线。新建样稿已重新Word渲染、28/28位置检查通过（最大0.77 mm），第2–5页150dpi像素/文字一致。原9份已填写日期的封面/阶段DOCX逐字节不变；WP7.4样稿新增封面日期段后另行Word渲染，第2–12页150dpi像素/文字及页尺寸一致。当前shared 744、client 61及构建通过，详见新建流程验收；原178项测量对应已填完整日期的六类样稿。
