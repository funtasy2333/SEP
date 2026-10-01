# WP7.5 新建标准与前言初始化验收

2026-10-01，按用户补充要求开发，在现有隔离分支codex/wp7.5-cover/PR39继续；未改主工作区未提交文件。

## 最终行为

- 新建“基本信息”增加“标准替代情况”和“标准采标情况”。前者填写被代替的标准编号，首次发布可留空；后者填写采标文件及一致性程度，未采标可留空。分别保存为既有replaces和consistency，进入文档元数据、schema-backed coverPage及DOCX封面/XML。
- 编号未填写（包括纯空白）时，预览和保存共同使用显式占位符，例如GB/T XXXXX—XXXX。未知年份不填当前年份；行业/地区/机构前缀用XX/T、DBXX/T、T/XXX、Q/XXX，指导性文件用GB/Z，用户明确填写的前缀和序号优先。占位符属于尚未填写的草案信息，不是分配的正式编号。
- 创建请求一次提交元数据与初始化正文，包含封面属性、前言、范围/规范性引用文件/术语和定义三个空章节。原先创建content={}、首次打开才套固定模板的路径改为创建时保存。
- 已填写单位自动生成“本文件由…提出。”“本文件由…归口。”“本文件起草单位：…。”，空单位不生成空句。起草单位沿用既有表单的applicant存储键，避免改变API/数据库兼容字段。
- 前言新增原句：“请注意本文件的某些内容可能涉及专利。本文件的发布机构不承担识别这些专利的责任。”所有新建类型/阶段均含该前言提示；封面征求意见稿/送审稿专利征集句仍是独立原有规则。
- 初始化只用于新建或无已保存内容的文档；加载已有正文仍优先原内容。之后修改单位元数据不会自动覆盖用户编辑过的前言。
- 显式XXXXX—XXXX占位序号不再使已填写的SJ、DB33、T/AbC或Q/Acme标记代码消失，畸形/歧义代码仍不猜测。默认DBXX中的XX明确是未知地区占位。

## 验证结果

- shared 32文件/744测试通过，client 16文件/61测试通过；两端构建通过，git diff --check通过。Vite既有大chunk提示仍在。
- 真实Vue/Element Plus新建对话框测试：新增输入实际进入create事件，所选团体类型和占位编号一致，单位进入持久化正文；关闭重开清空替代/采标填写值。
- JSON保存回载→生产编辑器schema→IR→XML再导入→真实buildDocxBlob验证编号、两字段、单位语句及完整专利提示；缺单位时不输出空责任语句，独立文档不共享可变默认内容。
- 编号覆盖六类默认、空白、显式前缀/序号及占位下仍保留的标记代码。没有改编号、目次、图表公式、横排、页眉页脚或现有PDF产品管线。
- 修订后原9类封面/阶段及WP7.4回归DOCX共10份逐字节匹配上一轮Word验收稿件，原178项测量与非封面11页像素回归结果继续适用；没有因新增表单重新更新既有golden。
- Microsoft Word for Mac 16.113.3实渲染新建样稿为5页，封面占位编号/替代/采标及第4页前言单位/专利提示均可提取并已视觉核对，无截断覆盖。OfficeCLI可见HTML、outline及issues已检查；默认章节和编号占位是本任务要求的草案模板，不假称最终正文或正式编号。

## XML导入审查修复

导入现有库文档时，先解析XML并通过生产schema的nodeFromJSON/check校验，再一次保存题名、完整元数据和正文。XML front字段覆盖旧值；缺失的可选front字段清空，提出/归口/起草单位及原阶段保留。导入期间暂停自动保存并禁用编辑，读取/解析/保存失败恢复编辑；已有保存进行中时提示稍后导入。未知非空标准类型拒绝导入。

3项新增回归使用真实DOMParser和生产schema，验证旧国家标准导入地方标准后DOCX/PDF请求使用新题名、编号、类型，缺字段清空及类型别名。保持现有PDF渲染请求和显式元数据优先规则。未变更DOCX生成链，原Word稿件及新建样稿字节验证继续适用。

## 2026-10-01 日期与横线修复

原新建表单不填发布日期/实施日期，导出器因两者均为空而省略整个SesCoverDates段，附于该段的下横线也消失。现改为六类DOCX统一保留日期段：每侧未知日期显示XXXX-XX-XX，真实日期优先、去首尾空白，横线始终保留；不将占位写入元数据。新增11项覆盖六类、双空/空白/单侧/真实日期，实际新建导出测试也检查占位与日期段。

样稿在Microsoft Word for Mac 16.113.3重新渲染为5页，300dpi测量日期字顶251.21 mm（目标251.5，差−0.29）、左右端25.06/194.73 mm、下横线257.05 mm（目标257，差+0.05）；当前样稿28/28封面位置检查通过，最大偏差0.77 mm。date-cover-measurements.json保留原始结果。已视觉检查封面与全页缩略图；第2–5页文字及150dpi灰度像素与修复前完全一致，DOCX唯一变化为新增封面日期段。编号fixture的golden/snapshot也仅增加该段，目次和正文逐字节不变。原9份已填写日期的封面/阶段DOCX与原Word验收稿逐字节一致；WP7.4样稿原未填日期，当前仅增加同一封面日期段，另行Word渲染仍12页，第2–12页文字、页尺寸及150dpi像素全部一致，复核稿位于/tmp/wp75-date-regression/wp74-regression.docx/.pdf。

shared 744项、client 61项及两端构建通过。OfficeCLI HTML/outline/issues已检查，固定横线/分节空段及草案空章节是设计内容，目次在Word PDF中已计算；strict schema仍仅报原有settings/mathPr/smallFrac，不宣称完整schema通过。PDF产品管线未改。

## 人工检查与复现

[创建流程DOCX样稿](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/new-document/new-document.docx)，[Word PDF](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/new-document/new-document.pdf)。同目录new-document.json为创建请求数据及导出警告，foreword.png/all-pages.png为核验图，机构名为测试数据。

```bash
node packages/client/scripts/new-document-sample.mjs "$PWD/tmp-e2e/new-document/new-document.docx"
python3 scripts/docx-check/word_pdf.py "$PWD/tmp-e2e/new-document/new-document.docx" "$PWD/tmp-e2e/new-document/new-document.pdf"
pnpm --filter @ses/client test
pnpm --filter @ses/shared test
```

仅创建时填入前言，不自动改写已有文稿。备案号、行业名称、地方名称表单仍另开任务。先前Q低清/素材来源未核验、固定国家机构图片、OMML严格schema和WP7.6遗留边界不变，见wp7.5-word-validation.md。
