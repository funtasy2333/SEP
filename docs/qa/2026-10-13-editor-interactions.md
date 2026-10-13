# 2026-10-13 编辑交互修复验收

基线：`17d36a31739e9242e2b265ea35bbfd7630d5b706`；分支：`codex/editor-interaction-fixes`。

## 修复及证据

| 用户问题 | 最终行为 | 验证 |
| --- | --- | --- |
| 横向输入光标线 | 关闭编辑器 gap cursor，正文使用文字光标 | 浏览器方向键操作、gap cursor 检查 |
| 无法删除表格 | 删除完整 stdTable（表题、网格、表注与脚注）；从表题、单元格、整表及矩形选区均可删除 | 生产 schema 回归、浏览器 UI 删除、undo/redo |
| 表格菜单过长 | 一级菜单保留插入、行与列、单元格、表注与脚注、删除；操作置于右侧二级菜单 | 真实菜单插行、删行、合并、拆分 |
| 无法跨行跨列选中 | 矩形选区显示高亮；打开菜单前保存选区，执行命令时恢复 | 鼠标横向、纵向、矩形拖选分别选中 2、2、4 格 |
| 列项不能改段落；改注丢字 | 转换整项内容，拆分前后列表，保留 marks、nodeId、选中文字和撤销重做 | 20 项编辑交互回归；浏览器回车续列项后改段落、部分选区改注 |
| 前言默认文本 | 新建与手动添加前言共用专利识别语句及“本文件主要起草人：”行，姓名待用户填写 | 模板回归、浏览器添加前言、保存重开 |
| 团体标准封面发布字宽 | 团体封面“发　布”使用 100% 字宽；行业、地方、企业模板维持 87% | shared 封面回归、实际 UI 导出 DOCX 的 w:w=100、OpenXML 校验通过 |

格式转换还维护正文、正文脚注负载、根/封面 typed inline 元数据里的交叉引用；列表正文派生锚点随转换重定向。内嵌裸网格删除保留外层标准表格。已有正文不重套前言模板。

## 验证命令

- `pnpm --filter @ses/client test --maxWorkers=2`：444 passed，1 existing skipped。
- `pnpm --filter @ses/shared test`：1030 passed。
- `pnpm --filter @ses/shared build`：通过。
- `pnpm --filter @ses/client build`：通过；保留原有大 chunk 提示。
- `node packages/client/scripts/editor-interactions-browser.mjs http://127.0.0.1:5188 output/editor-interactions`：完整流程通过，无 pageerror。
- `officecli validate output/editor-interactions/group-cover.docx`：no errors found。
- 实际导出的 `word/document.xml` 中“发　布”run：黑体、14 pt、`w:w w:val="100"`。
- `git diff --check`：通过。
- 独立只读审查后已修复引用负载遗漏；最终审查未发现可确认 P1/P2。

浏览器脚本使用内存 API 样稿，不写真实文档库。截图使用 `caret: 'initial'`，避免截图隐藏光标的操作干扰原生选区。隔离工作树的 `@ses/shared` 指向该工作树源码。

截图和导出样稿保存在工作树 `output/editor-interactions/`，不纳入源码提交。OfficeCLI HTML 封面截图仅为辅助预览，不等同于 Word 的原生分页及图文框验收。本轮已核验字体缩放 OOXML，不对整体封面 Word 原生布局作新验收结论。

当前主工作区 `main` 和原有未提交内容保持原状；该修复尚未合并或部署。
