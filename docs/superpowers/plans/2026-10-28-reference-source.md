# 文内引用与来源插入实施计划

**Goal:** 在主编辑器中选择并跳转文内引用，插入及编辑四类位置的来源。

**Architecture:** 引用选择和来源编辑使用独立 Vue 控件，操作逻辑放在可测试的工具函数中。复用稳定 ID、Resolver 标签、termSource 和 stdParagraph，不新增数据模型。

**Tech Stack:** Vue 3、Tiptap 3、ProseMirror、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-28-reference-source-design.md`（方案 1 已确认）。

## 约束与关注点

不修改用户既有文稿或未跟踪输出。对话框期间文档变化必须拒绝旧位置写入；来源不能误删相邻正文；嵌套术语来源不能写到父术语；图表来源须放在对象整体之后；外链行为保留。

## 步骤

- [x] 引用定位：`extensions/marks/cross-ref.ts` 提前接管内部引用；`crossRefNavigation.test.ts` 先复现新开页，再验证新旧 ID、失效引用、外链。
- [x] 引用选择：`utils/internalReference.ts` 提供目标列表和选区插入；`components/editor/ReferenceControl.vue` 提供筛选及选择，捕获文档和选区并在提交前重验。
- [x] 来源编辑：`utils/sourceAnnotation.ts` 定位术语/段落/图/表及已有来源，事务式新增、替换、删除；`SourceControl.vue` 提供正文输入及确认、取消、删除。
- [x] 接入 `EditorView.vue` 工具栏和失效引用提示。使用真实编辑器测试选择插入、保存重载、撤销及来源导出保留。
- [x] 执行 client 全套测试、构建和浏览器交互验收；核对 diff，记录尚未支持的旧 XML 路径限制。

由当前会话直接实施；根据代码审查技能调用一次只读审查子代理。

## 验收记录

2026-10-28：client 1448 passed / 2 既有 skipped；shared 2909 passed；io 448 passed；client build、shared build、git diff --check 通过。首轮 client 有一项资源竞争导致的 5 秒超时，单独及最终 `--maxWorkers=3` 全套均通过；旧“XML 应拒绝 termSource”测试按新增能力改为验证来源不混入定义。

真实 Chromium 对主编辑器进行筛选引用、插入、文内定位、四类来源、编辑/取消/删除、保存重开验收，所有 API 请求由隔离脚本处理，未写业务数据库。术语来源的前后方括号通过真实 computedStyle 核验。脚本、截图与结果位于 `tmp-e2e/reference-source-20261028/`。

独立审查发现的两项问题均补回归修复：新插入引用在重编号、撤销、部分格式变化及连续引用时同步显示；代码块禁止静默退化为普通编号。旧稿自定义引用文字不自动改写。

原有格式边界继续生效：例如嵌套术语的 HTML/DOCX/旧 XML 出口仍会明确阻断；此次未扩大其支持范围。GB/T 46687.2 XML 出件仍未接入 UI，未将其描述为已上线能力。来源采用已确认的相邻段落方案，图表移动时须连同来源段落移动。
