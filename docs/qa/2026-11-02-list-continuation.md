# 2026-11-02 列项继续编号／重新编号（issue #70）验收

## 设计

- 数据：`stdList.attrs.continueNumbering`（PM）／`IRList.continueNumbering`（IR）／写作片段 `continueNumbering`。只在为 `true` 时写出；缺省即「重新编号」，既有文档的 JSON、版本快照与 JSON 导出保持不变，旧数据不会串号。
- 接续规则（唯一实现 `packages/shared/src/ir/listNumbering.ts` 的 `ListSequence`）：设为继续编号的列表接续**同一父节点内、位于其前、最近的同类型列表**（字母接字母、数字接数字、罗马接罗马），首项序号 = 该列表末项序号 + 1，可逐级累加。中间的段落、注、其他类型列项（如二级数字列项）不影响。不跨条、注、表格单元格查找。
- 找不到接续目标：按重新编号显示，编辑器在列表左侧标出提示，Resolver 报 `list-continue-orphan` 警告，校验面板显示 `structure.list-continuation`。编辑器命令在这种情况下直接拒绝设置并说明原因。
- 只对字母、数字、罗马编号列项有效；破折号、间隔号、方框数字没有序号，命令拒绝，写作片段报 `invalid-value`。

## 入口

| 位置 | 操作 |
| --- | --- |
| 编辑器 | 工具栏「设为 → 列项」菜单底部：「继续前一列项编号」「重新编号」；结果以提示条说明本组起始序号；可撤销、重做 |
| MCP | 写作片段 `{"kind":"list","listType":"alpha","continueNumbering":true,…}`；`read_node` 读出该字段；`replace` 修改；示例见 `docs/wp9-authoring-reference.md` 4.2（文档示例由测试执行） |

拆开列表时保留编号意图：把有序列表中间的项改为段落/注/示例，或改成其他类型列项，后半截自动设为继续编号（不从 a）重来）；整组改成另一种有序类型时清除继续编号，不接续原类型的序列。

## 验证

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 同层级同类型列表可选继续或重新开始 | 通过 | `client/src/utils/listNumbering.test.ts`、`shared/src/ir/__tests__/listContinuation.test.ts` |
| issue 案例：一级 a）、b），两组二级各从 1）开始 | 通过 | 同上；编辑器 DOM 与 HTML 在 Chromium 中截图核对 |
| 中间插入说明段落后继续关系保持；另起一组可重新开始 | 通过 | 同上 |
| 插入、删除、移动列项及撤销、重做后编号正确 | 通过 | `listNumbering.test.ts`（移动后失去目标时显示提示并报警告） |
| 保存重开、JSON 往返 | 通过 | getJSON/getHTML 重建编辑器；pmToIr → irToPm → pmToIr 往返 |
| 版本恢复 | 部分验证 | 版本快照保存同一份编辑器 JSON，JSON 往返已验证；**未在界面上实际执行版本恢复** |
| MCP 创建、读取、修改 | 通过 | `io/src/documentOps/listContinuation.test.ts`；写作说明示例由 `authoringReference.test.ts` 执行 |
| 内部引用 | 通过 | 引用接续列表的项，引用文字为「2.1 b）」 |
| HTML | 通过 | 计数器起点 `counter-reset: ses-li N`；screen 与 print 变体 |
| PDF | 通过（单遍） | print HTML 经 Vivliostyle 11.0.1 实际排版，pdftotext 得 a）…b）；未走完整的两遍目次管线 |
| DOCX | 通过（模拟器 + LibreOffice） | 编号实例 `startOverride` 取首项序号；Word 编号模拟器与 LibreOffice 转 PDF 均为 a）…b）；**未在 Microsoft Word 中打开核对** |
| GB/T 46687.2 XML | 通过 | `list-item/label` 写接续后的序号（`b)`） |
| 旧 XML | 明确拒绝 | 旧序列化器每个列表从头编号，含继续编号的文档导出旧 XML 时报「暂未支持」，不静默改号（与罗马列项相同处理） |
| 既有文档不受影响 | 通过 | 语义 JSON golden（SHA 固定）未变；未设置时 IR/PM 均不出现该字段 |

## 合并 main 后的评审修复（2026-11-03）

#67 引入块级列项（`stdListBlockItem`：多段内容、嵌套二级列项）后，Codex 评审指出两处遗漏，均已修复并以「去掉修复即失败」的用例确认：

| 问题 | 修复 | 用例 |
| --- | --- | --- |
| `irToPm` 投影块级 `stdList` 时丢掉 `continueNumbering`：继续编号的块级字母列项往返后从 b） 变回 a）；含这种列表的 XML 导入报 `xml-roundtrip-loss` 被拒绝 | 单段与块级两种 `stdList` 投影都写出该属性 | shared `listContinuation.test.ts`「块级列项」；io `xml46687ListContinuation.test.ts` 块级往返（修复前即报 `xml-roundtrip-loss`） |
| 编辑器计算编号时不进入列表内部：同一块级列项里的第二组嵌套数字列项设为继续编号，编辑器仍显示 1），而 Resolver/导出为 3） | 记录列表自身后继续深入其列项，每个块级列项自成兄弟序列（与 Resolver 一致）；命令的「所在列表」改为取光标最内层的列表，块级列项段落中也能设置 | client `listNumbering.test.ts`「块级列项内的嵌套列表」 |

## 已知限制

- 在列项中间的空项上连按两次回车会把列表拆成两个（既有行为，未改动），后半截按重新编号显示；需要时对后半截选「继续前一列项编号」。
- GB/T 46687.2 XML 导入（WP8.3）用首个列项的 `label` 恢复继续关系：首个标号不是从头编号、且恰好等于按本规则接续前一个同类型列表得到的序号时，导入为继续编号，往返不丢失；其余情况仍按重新编号导入。`label` 文本本身仍不作为数据保存（D-X-07），编号照旧由 Resolver 计算（`shared/src/xml46687/import/listContinuation.ts`）。

## 验证命令

合并 main（含 #67）并修复评审意见后（2026-11-03）：

- `pnpm --filter @ses/shared test`：3539 passed
- `pnpm --filter @ses/io test`：528 passed
- `pnpm --filter @ses/client test`：1624 passed，2 skipped（既有）。与 server 测试并行跑时有 4 个 EditorView 用例 5 秒超时，单独重跑全部通过
- `pnpm --filter @ses/server test`：962 passed
- `vue-tsc -b`（client）、`tsc --noEmit`（shared、io）、`git diff --check`：通过
