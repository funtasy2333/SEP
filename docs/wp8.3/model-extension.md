# WP8.3 保真模型增量（已授权，实施规格）

用户最后决定：全部 `samples/valid` 可导入优先，扩展生产模型保留 03 的嵌套列项、05 的多 graphic/fig-group、08 的表替代图、09 的 array/公式组/共享脚注；已批准 bold+code 与嵌套列表保层级。不得裁剪样例、复制定义冒充共享、拆图冒充组或静默丢失。仅覆盖下述明确结构和现有已支持结构，其他无法保真内容按 error，不能推断任意 STS 子结构均受支持。实现前主导冻结契约并串行集成 S0；此设计本身不声明实现完成。全部路径基于 `65f8cdff`；生产代码最终按集成后的 S0 审查。

## 1. 合同与兼容

以下为明确的目标类型（`NodeId`、`IRInline`、`IRTableRow`、`IRTableColumn`、`IRFormula`、`IRFigure`、`IRLegend` 已存在）。新增字段可选，仅实际存在时输出；旧 JSON、旧 `IRFigure.src/resourceId`、`IRInline.footnote` 与旧单图/单脚注编码不变。所有新 node、属性、标记在生产 Schema 的 Node.js/client 相同扩展列表注册，`nodeFromJSON().check()` 后保存/重开、`pmToIr` 和 `irToPm` 双向无损。新增节点不添加编辑菜单；不可编辑也要可见并保留、复制/删除时维护 NodeId。新增结构进入 `hasSemanticExtensions`，延用 `extensionVersion:1`；`pmToIr` 对未知未来版本继续阻断。不得混合 text 与 block 的同一 ProseMirror content expression。需确认 nodeId 插件、复制/粘贴 ID 重映射、server 校验器、受限输出边界及跨格式消费者；旧文档不被迁移。

```ts
interface IRGraphic {
  id: NodeId; src: string; resourceId?: NodeId;
  contentType?: string; specificUse?: 'size:T'|'size:S'|'size:M'|'size:L'
}
// IRFigure 增加 primaryGraphic?: { contentType?: string; specificUse?: IRGraphic['specificUse'] }
// 和 additionalGraphics?: IRGraphic[]；第一个图仍用既有 src/resourceId。
interface IRFigureSet { kind:'figureSet'; id:NodeId; legend?:IRLegend; figures:IRFigure[] }
// IRTable 增加 alternativeGraphic?: IRGraphic，关联属于该表。
interface IRArray { kind:'array'; id:NodeId; columns:IRTableColumn[]; rows:IRTableRow[];
  columnGroups?: Array<{ start:number; count:number }> }
interface IRFormulaGroup { kind:'formulaGroup'; id:NodeId; numbered:boolean; formulas:IRFormula[] }
// IRInline 增加 footnoteRef?: { targetId:NodeId; refText:string }
// 与 footnoteDefinition?: IRFootnote，分别为引用和定义锚点。
```

`IRBlock` 增加 `IRFigureSet | IRArray | IRFormulaGroup`；`IRFigureGroup` 已存在但表示图内部描述/资源分组，不复用为 XML `fig-group`，避免混淆；命名 `figureSet` 明确为 XML 组。每个 `IRGraphic` 是资源引用而非图对象，顺序与所属图/表固定，单一资源可被不同 graphic 引用。`columnGroups` 是 0-based 连续区间，覆盖其源 `colgroup` 内的 col；无组的 `col` 不需伪造组；不可重叠、越界或重复，宽度/对齐仍由 columns 保留。`IRFormulaGroup` 是组级编号与有序成员，成员保留独立 NodeId、MathML、备注等，不拆平为兄弟公式；原始 XML 子公式没有 id 时新建 NodeId，导出是否输出子 id 由其 numbered 状态决定。

共享脚注：`footnoteDefinition` 是正文中的一个有位置的定义锚点，持有唯一 id 和唯一正文；每个 `footnoteRef` 指向同一 id、保存各自显示文本，顺序与定义位置保留。09 的两个引用在定义之前，故绝不能采用“定义必须紧随首引用”假设。旧一对一 `footnote` 保持原位编码；两种编码不能对同一 id 重复定义。多个目标的单个 rid 仍 error；两个各自单目标的 xref 可以指同一脚注。悬空、重复定义、定义在禁止容器、嵌套脚注、空正文均 error。引用计数和定义身份必须在 PM↔IR 中保留；导出单次定义及每个引用，位置保持，不把正文复制到每个引用。

## 2. 生产 PM 形态与转换

- figure 主图沿用当前 `figure` attrs；可选 `primaryGraphic` 与 `additionalGraphics` 是结构化、经过类型校验的属性数组，按序存 `{nodeId,src,resourceId?,contentType?,specificUse?}`。`pmToIr` 保留唯一节点 ID，`irToPm` 原样投影；只要任一资源缺失不得生成 PM。额外图在视图中按序显示，避免拖拽或保存仅保留第一个；对外图源走已有资源安全策略。`figureSet` 为 block，内容表达式 `figureLegend? figure+`，legend 的同一实体在组级，子图保持原有 figure，允许原来的 fig 序列及每图内容；使用新名字避免与现有 figure group 语义冲突。
- `stdTable.attrs.alternativeGraphic` 持有同结构资源引用；不能将其当第二张独立图或表的显示资源。需对已有表复制/保存/资源收集逻辑增加属性扫描；空题仍 `caption=[]`。渲染时 XML table-wrap 在表和 table-wrap-foot 后按原模型指定位置输出 graphic，content-type=`disp_table`。
- `alignedArray` block 包含独立 `arrayTable`/行/格节点，节点实际命名由 owner 固定；约束对应 `table` 网格，不套用强制题名和自动表编号的 stdTable。节点 attrs 保留 columnGroups 与列名义宽度/对齐；行格可复用 Schema 兼容的 tableRow/tableCell，但必须声明合法 content expression，不复用将其转成 numbered `IRTable` 的适配分支。09 为 colgroup 两列 + tbody 两行，无表题。
- `formulaGroup` block 含 `formula+`，保留 group nodeId/numbered 与成员顺序；公式现有节点不变。显示层可将各成员逐行呈现，组标签只标一次，不能给每行自动编号或丢失 MathML。
- 两个 inline atom：`sharedFootnoteRef` attrs `{targetId,refText}`；`sharedFootnoteDefinition` attrs `{nodeId,content:PMJsonNode[]}`，content 是安全受限的现有脚注行内 PM JSON，采用现有 footnoteRef attrs 校验并在 pmToIr 中转换到 IR；定义在原始位置，不生成两个正文副本。复制/粘贴一批内容时重映射同批次内部引用并维持多对一关系；跨批次或被删除的定义变悬空时给出 error，不自动指向其他同文脚注。`irToPm`/`pmToIr` 的 `unmappedFootnotes`、诊断与 attrs 深校验必须扩展支持两种编码；仅单引用旧 atom 保持原样。

S0 负责 `code` mark 与 bold 共存和嵌套 list 节点，先集成，后续 owner 在其 HEAD 基础上顺序修改 `types.ts`、`irToPm.ts`、`pmToIr.ts`、Resolver、统一 Schema/扩展注册、公共内容边界；这些文件均由 M-core 单一 owner 修改，不能与 S0 或领域映射并行写入。P0 解析器继续独立并行。领域任务可在 M-core 合同冻结后只写独立 import 模块/测试；交叉问题通过主导提交给 M-core。

## 3. Resolver、输出边界和资源

Resolver 第一遍收集 `footnoteDefinition` 的 id、定义位置与正文，第二遍给共享定义一个编号与 xmlId、引用解析到同一标签；旧脚注沿用原编号顺序，组内多处引用不重复增加脚注序号。重复/缺失目标阻断。`figureSet` 本身不强制编号，成员图按文档顺序计入图序；`formulaGroup` 占一个公式编号，成员不额外占编号，`array` 不进入表编号序列；所有新 id 不由 XML id 解码，重导出按 Resolver 重新派生。

XML 输出需要新增 `fig-group/legend/fig*`，`fig` 输出主图与 extras 顺序；table-wrap 在原 foot 后输出 alternative；array 输出 `array/table` 与原 colgroup 区间；公式组输出 `disp-formula-group/label?/disp-formula+`；共享脚注在保存的原位置输出所有 `xref[fn]` 与唯一 `fn`。输出必须能再次导入并保留关系，保留原有 4 golden 的单图与旧 footnote 字节行为；这些新形式经 `validate.py` import 和 export 测试确认，不假设现有 export profile 已支持。应同步内容模型与 Python 中 implementation warning，不为通过删负例。

扩展 `collectXml46687ImageRefs` 及资源准备，遍历主图、每个 additional graphic、figureSet 内子图、表替代 graphic 及行内图。资源 href 确定且全局唯一：主图沿用所属图 xmlId；额外图 `${figXmlId}_g${1-based额外图序号}`；表替代图 `${tableXmlId}_alt`；每个 href 对应 manifest 条目及文件。即使多项指向同一资源 key，各自保留引用及对应条目，禁止基名歧义；重新导出重派生 href 属规范化，不能用输入原 href 推导 NodeId。io manifest/data URL 保留每个资源字节、媒体类型及归属；ZIP 与纯 XML 缺必要资源均 error，valid 中有图片时测试应显式提供完整资源，而不是用空图。

`outputBoundary` 对 XML46687 明确放行上述已实现形态；HTML/DOCX 若尚未完整表现语义，明确 `unsupported-output` error，不输出不完整内容（不得借用已存在 figure group 的语义）；生产编辑视图至少可见全部内容与关联。任何 unsupported 分支、资源键遗漏、未知属性均不得静默忽略；回检对比 nodeId 双向映射、每个关系、文本、顺序、MathML 和资源身份。

## 4. 可执行验收和顺序

1. S0 单独红绿并集成：bold+code 同一文本的 marks、03 的 alpha→dash 嵌套深度/顺序、四原版 golden 中对应内容通过生产 Schema、保存重开、PM→IR。
2. M-core 拥有全部共享模型/Schema/双向转换/Resolver/边界/导出/资源公共文件，基于 S0 集成提交，先写新增结构的 PM→IR→PM 测试红灯；测试覆盖两图同一 fig、包含共享 legend 两分图、表替代图与父表、两列 array、两公式组、两个 xref 指向同一定义及定义位置；检查所有关系与资源字节。改旧拒绝测试为更强正例，保留其他拒绝测试。
3. M-core 集成后 P1 公共合同唯一 owner、P2/P3/P4/P5 不共享可写文件；P4 消费扩展类型，P5 按两遍索引输出共享脚注，P8 唯一 owner 同步矩阵、schema/validate.py 及测试。调用方构造 05/08 图像所需 manifest；09 含 `array`、`disp-formula-group` 及共享脚注，先后定义位置、双引用与唯一正文必须一致。
4. 9 个 valid 全集导入（同资源的包和纯 XML）；四原版 golden 经生产 Schema → PM→IR → 导出及幂等，明确规范化仅限批准项。所有 import shall/should 行由真实 `[M-…]` 标题覆盖；异写、V-12 告警、无损规范化及全部原安全负例持续存在。server Jest 直接调用 io 与 client Vitest 比较，独立新空库、不触碰默认数据库。

真实样稿未取得；自写 9 valid 的支持不能说明外部互操作通过。13 个 export-only invalid 冲突见 `design.md`，不能通过改文件名或删除测试制造结论。
