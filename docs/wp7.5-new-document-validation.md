# WP7.5 新建标准与前言初始化验收

2026-09-30，按用户补充要求开发，在现有隔离分支codex/wp7.5-cover/PR39继续；未改主工作区未提交文件。

## 最终行为

- 新建“基本信息”增加“标准替代情况”和“标准采标情况”。前者填写被代替的标准编号，首次发布可留空；后者填写采标文件及一致性程度，未采标可留空。分别保存为既有replaces和consistency，进入文档元数据、schema-backed coverPage及DOCX封面/XML。
- 编号未填写（包括纯空白）时，预览和保存共同使用显式占位符，例如GB/T XXXXX—XXXX。未知年份不填当前年份；行业/地区/机构前缀用XX/T、DBXX/T、T/XXX、Q/XXX，指导性文件用GB/Z，用户明确填写的前缀和序号优先。占位符属于尚未填写的草案信息，不是分配的正式编号。
- 创建请求一次提交元数据与初始化正文，包含封面属性、前言、范围/规范性引用文件/术语和定义三个空章节。原先创建content={}、首次打开才套固定模板的路径改为创建时保存。
- 已填写单位自动生成“本文件由…提出。”“本文件由…归口。”“本文件起草单位：…。”，空单位不生成空句。起草单位沿用既有表单的applicant存储键，避免改变API/数据库兼容字段。
- 前言新增原句：“请注意本文件的某些内容可能涉及专利。本文件的发布机构不承担识别这些专利的责任。”所有新建类型/阶段均含该前言提示；封面征求意见稿/送审稿专利征集句仍是独立原有规则。
- 初始化只用于新建或无已保存内容的文档；加载已有正文仍优先原内容。之后修改单位元数据不会自动覆盖用户编辑过的前言。
- 显式XXXXX—XXXX占位序号不再使已填写的SJ、DB33、T/AbC或Q/Acme标记代码消失，畸形/歧义代码仍不猜测。默认DBXX中的XX明确是未知地区占位。

## 验证结果

- shared 32文件/733测试通过，client 15文件/58测试通过；两端构建通过，git diff --check通过。Vite既有大chunk提示仍在。
- 真实Vue/Element Plus新建对话框测试：新增输入实际进入create事件，所选团体类型和占位编号一致，单位进入持久化正文；关闭重开清空替代/采标填写值。
- JSON保存回载→生产编辑器schema→IR→XML再导入→真实buildDocxBlob验证编号、两字段、单位语句及完整专利提示；缺单位时不输出空责任语句，独立文档不共享可变默认内容。
- 编号覆盖六类默认、空白、显式前缀/序号及占位下仍保留的标记代码。没有改编号、目次、图表公式、横排、页眉页脚或现有PDF产品管线。
- 修订后原9类封面/阶段及WP7.4回归DOCX共10份逐字节匹配上一轮Word验收稿件，原178项测量与非封面11页像素回归结果继续适用；没有因新增表单重新更新既有golden。
- Microsoft Word for Mac 16.113.3实渲染新建样稿为5页，封面占位编号/替代/采标及第4页前言单位/专利提示均可提取并已视觉核对，无截断覆盖。OfficeCLI可见HTML、outline及issues已检查；默认章节和编号占位是本任务要求的草案模板，不假称最终正文或正式编号。

## 人工检查与复现

[创建流程DOCX样稿](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/new-document/new-document.docx)，[Word PDF](/Users/funtasy/.codex/worktrees/wp7-5-cover/set/tmp-e2e/new-document/new-document.pdf)。同目录new-document.json为创建请求数据及导出警告，foreword.png/all-pages.png为核验图，机构名为测试数据。

```bash
node packages/client/scripts/new-document-sample.mjs "$PWD/tmp-e2e/new-document/new-document.docx"
python3 scripts/docx-check/word_pdf.py "$PWD/tmp-e2e/new-document/new-document.docx" "$PWD/tmp-e2e/new-document/new-document.pdf"
pnpm --filter @ses/client test
pnpm --filter @ses/shared test
```

仅创建时填入前言，不自动改写已有文稿。备案号、行业名称、地方名称表单仍另开任务。先前Q低清/素材来源未核验、固定国家机构图片、OMML严格schema和WP7.6遗留边界不变，见wp7.5-word-validation.md。
