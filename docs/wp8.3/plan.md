# WP8.3 XML 导入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking. 具体实现由子代理完成，主导负责任务书、审查、cherry-pick、PR 和评审；禁止子代理再派生。

**Goal:** XML/资源包经同构严格解析、结构/语义校验、纯 IR 映射和生产 Schema 校验后安全导入，失败返回 null，保留中文定位问题。

**Architecture:** shared 产出纯数据树、同步纯映射及诊断；io 准备资源和 NodeId、调用生产校验器并回检 PM→IR；client/server 使用同一链路。UI、HTTP/MCP 和旧入口切换留 WP8.4。

**Tech Stack:** 既有 TypeScript、Vitest、Jest、JSZip、生产 Tiptap/ProseMirror Schema；不新增依赖。

**Spec:** [设计](design.md)、[391 行导入映射](matrix-import.md)、用户完整规格 `/workspace/attachments/3f4efb28-a0c9-466d-8a02-b5f927c463af/已粘贴的文本.txt`。

## 全局约束与用户决定

- 用户已授权 gpt-6.1-terra / xhigh、手工 worktree、代理树与声明审计；平台不提供原始 output 文件，不声称执行指定 grep。
- 所有实现子代理专属 worktree，首步 reset 自己分支并核对主导指定 SHA；先 frozen install，只本地中文 checkpoint，不 push、不 PR、不切主工作树、不派生。
- 不改依赖清单、lockfile、JSON golden、`shared/src/ir/__tests__/fixtures.ts`、`client/src/extensions/__fixtures__/wp6.ts`；不删、跳过、弱化既有测试。shared 禁参数属性、enum、namespace。
- 用户已批准最小 Schema/PM↔IR 补齐，保留嵌套列表层级、不压平，支持粗体与代码组合；不新增编辑菜单。
- 用户已采纳：多目标 rid/tfoot/多 graphic/fig-group/附录 term-sec/无法保存关联的表替代图阻断；frame/rules/scope 沿用警告；HTTP/MCP 留 WP8.4。
- 用户又要求样例验收“不区分”。这与前条冲突：合法样例 05/08/09 含拟拒绝结构，另有 13 个 invalid 属导出负例且既有 import 接受。已请求明确优先级，相关产品口径任务暂不执行。解析器与已批准的 Schema 不依赖该选择。
- 固定主线基线 `65f8cdff6b6e6ea0c4e51fb44433a28a97711e5b`；集成树包含已审查设计三提交。
- 全部问题中文，error 阻断；输入不变。运行时不联网加载 XML 外部内容，不依赖 Python。
- 测试不得读写 `packages/server/data/ses.db`；服务仅新空库、非默认端口和 127.0.0.1，完毕停进程。

## Review Focus

- 同 URI 不同前缀及默认 MathML namespace：接受并保持语义，错误绑定必须定位。
- 相邻 CDATA/实体/文本绕过单文本限额：合并计数且在增长前阻断。
- Schema 允许结构而 PM 投影静默丢样式或层级：经生产 Schema 和 PM→IR 验证全部保留。
- ID 重新分配导致关联目标错位：比较映射后的引用指向，不通过删除所有 ID 掩盖错误。
- 资源包大条目、基名歧义、ZIP 路径：限额内解析、缺失/冲突返回 null，不覆盖文档。

## P0：严格解析器（可先执行，独立于其他任务）

**Files:** 新增 `packages/shared/src/xml46687/parse.ts`、`parse.test.ts`，必要专属小辅助文件；不修改 shared/index、MathML 渲染器或公共问题联合。

**Interfaces:** 消费既有 `tree.ts`，导出 `parseXml46687(xml: string): Xml46687ParseResult`、`XML46687_PARSE_LIMITS`。结果 `{ tree: XmlDocument | null, problems: Xml46687ParseProblem[] }`；诊断 `{ code: 'xml-syntax'|'xml-namespace'|'xml-forbidden-doctype'|'xml-forbidden-entity'|'xml-forbidden-pi'|'xml-encoding'|'xml-limit'; severity:'error'; message:string; xml:{line:number;column:number;path:string} }`。P1 facade 将 parser-local 诊断转换公共类型。

- [ ] 先写失败测试：合法 namespace/实体/CDATA/注释/保留空白/位置；反例 QName/属性重复/未绑定前缀/非法字符/DOCTYPE/PI/实体及各限额。
- [ ] 跑 `pnpm --filter @ses/shared exec vitest run src/xml46687/parse.test.ts`，确认功能缺失时真实失败。
- [ ] 实现 XML 1.0 严格扫描，CRLF/CR 归一，URI+local 解析，xml/xmlns 规则；不预绑定 mml/tbx/xlink；树中元素/文本/注释均带位置。
- [ ] 上限：UTF-8 16 MiB，元素深度 128，合并连续解码文本 UTF-8 1 MiB，总节点 500000。用增长前检查和 namespace 变更日志；不以复制整个 scope/累积字符串造成平方增长。
- [ ] 定向测试、强制外部校验的 shared 套件和所有公共必跑命令；报告每项结果及既有 server PDF 基线失败；本地中文 checkpoint。

## S0：生产 Schema 最小保真补齐（与 P0 并行）

**Files:** 按实际需要修改 `packages/client/src/extensions/editorExtensions.ts`、`extensions/nodes/std-list.ts`、`extensions/index.ts`、nodeId 插件登记、`packages/shared/src/ir/{irToPm,pmToIr,inlineProjectionDiagnostics}.ts` 和专属测试。新增节点/标记须兼容旧 PM JSON；不改 parser/导入公共契约。

**Interfaces:** 维持 `irToPm(doc,options)`、`pmToIr(pm)` 和 `createEditorSchema()` 签名；旧扁平列表 JSON 不变。嵌套内容需以生产 Schema 可表达的结构存储，不混合 ProseMirror inline/block 内容表达式。若采用新增 block item，应明确类型和 nodeId/PM↔IR/显示链路，原扁平 stdListItem 保留。

- [ ] 新失败测试：含 bold+code、alpha/roman 父列表含不同类型嵌套列表，经生产 Schema `nodeFromJSON().check()`、JSON 保存重开、PM→IR 后保留所有内容/顺序/引用。
- [ ] 验证红灯，定位既有 code excludes 和 stdListItem.inline* 限制。
- [ ] 最小实现：仅放开可保真组合；保留其他组合/无效内容的保护。保留嵌套深度/顺序，不压平；编号既有 D-M-17 不扩。
- [ ] 若旧测试钉住本次明确取消的拒绝行为，转换为更强的完整保存重开正例并逐项说明；不删除覆盖或泛化放宽其他不支持结构。发现必须修改 JSON golden/锁定夹具则停止报告。
- [ ] 定向及公共全部验证；原始四 golden 对应 IR 的生产 Schema 投影用真实夹具证明，不剪裁、不改 golden。提交中文 checkpoint。

## P1：公共契约、索引与映射上下文（P0 后）

**Files:** shared `xml46687/import/{contracts,context,index}.ts` 与公共 facade/index、专属契约测试。公共问题联合和码数由此 owner 独占。

**Interfaces:** 冻结设计 §10.1 的同步 `mapXml46687(tree,{nodeIdsByPath,resources})`、只读资源、XML 位置、纯 ID 索引；模块回调采用上下文注册以供 P3/P4/P5 相互消费。不预写未实施的成功桩；未接入域必须 error。

- [ ] 索引/不透明 id/重复与悬空引用、目标类型测试先红后绿。
- [ ] 冻结精确签名/文件归属，主导审查并集成后再派领域并行实现。

## P2：内容模型与旧格式（验收优先级明确后，P1 后可并行）

**Files:** shared `import/{validate,legacy}.ts` 与测试；只由 P8 修改源矩阵/Python。

**Interfaces:** `validateXml46687(tree): { problems: ImportProblem[] }`；引用索引消费 P1 类型。正文、表、图、TBX 等的语境/次序/基数及 V-1…V-18 依据最终确定口径。

- [ ] 真实样例接受拒绝、中文错误码/行列、旧格式组合特征先测。
- [ ] TS 运行时校验，不调用 Python；测试调用 import profile 对照并记录已批准差异。

## P3：结构/文本/元数据（P1 后，与 P2/P4/P5 不同文件）

**Files:** shared `import/{structure,inline,metadata}.ts` 与领域测试。

**Interfaces:** 消费 P1 上下文，向调度器提供域函数；IR 字段依据设计逐行表。保留多块注、引言条、样式组合和嵌套列表，所有 XML id 只作关联。

- [ ] 各矩阵行带真实 `[M-…]` 测试名，先失败再实现，未知/非法内容不可静默丢弃。
- [ ] 元数据/引言/无标题条、警告/引文/代码及保留空白的生产投影测试。

## P4：表、图、公式（P1 后）

**Files:** shared `import/{table,media,mathml}.ts` 与测试。

**Interfaces:** P1 context/资源表，表网格/colgroup、图例、行内图、独立安全 MathML 字符串；同步映射，无资源 I/O。

- [ ] 跨行跨列、表脚注、缺图及不保真结构的负例；MathML URI 重建及原生内容保存。
- [ ] 只实现用户最终批准的多图/替代图/组规则，未授权不扩模型。

## P5：TBX、文献及引用（P1 后）

**Files:** shared `import/{terms,refs}.ts` 与测试。

**Interfaces:** P1 索引/上下文，条目级 subjectField、多语言/描述符、规范性文献、缩略语、xref/fn/index；不写公共文件。

- [ ] 正反例先测，验证节点重映射及交叉引用保真，错误目标/多个 rid 按最终口径。

## P6：io 与资源包（P1–P5 集成后）

**Files:** io `xml46687Import.ts`、包导入与专属测试、io index。

**Interfaces:** 设计 §10.1 的 `importXml46687(xml,options)` / `importXml46687Package(bytes,options)`，生产 ContentValidator 必注入；资源与位置 NodeId 在 io 准备。

- [ ] 真实 XML/包→IR→生产 Schema→PM→IR→重新导出；失败 null/输入不变。
- [ ] ZIP 分块实际限额、重复名/路径穿越/基名歧义、manifest 对应、持久 dataURL；不修改依赖。

## P7/P8：跨端与验收收尾（集成后）

**Files:** server Jest 专属导入测试、client Vitest 跨端测试、shared 矩阵覆盖；矩阵/Python/约定同步由单一 owner 修改。

- [ ] 4 原版 golden 经生产 Schema 完整往返并幂等，资源包两端一致；JSON golden 保持原样。
- [ ] M-4.3.4-02/03 改 accept；DOCTYPE 全拒、URI 判断及其余状态根据最终用户裁决同步，测试动态计算 mandatory 接收行。
- [ ] 全部必跑命令、样例错误码、快照差异、真实样稿未取得及所有失败如实入验收文档。
- [ ] 主导在干净集成树审查、cherry-pick、全量验证、一个 draft PR；自动评审核实后处理，回复前 git log 核对提交号。

## 全任务必跑命令

```
REQUIRE_XML_VALIDATION=1 pnpm --filter @ses/shared test
pnpm --filter @ses/shared exec tsc --noEmit
REQUIRE_XML_VALIDATION=1 pnpm --filter @ses/io test
pnpm --filter @ses/client exec vitest run --maxWorkers=2
pnpm --filter @ses/client build
cd packages/server && NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand
python3 scripts/xml46687/test_validate.py
```

当前基础环境：本地 xmllint 为 `/workspace/wp83-tools/xml/usr/bin/xmllint`；pnpm 缓存使用 `/tmp`，安装生成的 workspace 配置须还原；better-sqlite3 必要时执行既有允许依赖的原生安装。主导已见 server PDF 基线失败 761/762；不得改输入、跳过或改测试绕过，不改 HOME、不移除运行时网络代理/安全配置。
