# 写作片段说明（AI 写作参考）

本文是 WP9.3 MCP 工具 `get_authoring_reference` 的**唯一来源**，面向通过 MCP 向 SES 文档写入内容的 AI。

> 维护约定：文中标记为 `ses-example` 的 JSON 代码块是**可执行的示例**——测试会逐条读取、归一化、投影为编辑器节点并用生产 schema 校验（`packages/shared/src/ir/__tests__/authoringReference.test.ts`、`packages/client/src/extensions/authoringFragments.test.ts`）。第 3 节的上下文表、第 5 节的问题代码也由测试与实现核对。修改实现（`packages/shared/src/ir/authoring.ts`、`fragmentContext.ts`）或本文时必须同步另一方，否则测试失败。
>
> 示例代码块的信息串格式：`json ses-example context=<父节点> [expect=error code=<问题代码> path=<问题路径>]`。`context=clause:2` 表示父条为 2 级。

## 1. 什么是写作片段

向文档**插入或替换**内容时，你提交一个**片段**：一个节点数组，加上插入位置（上下文，见第 3 节）。片段是精简版的 IR（`packages/shared/src/ir/types.ts`）：

- `id` 和所有可以推导的字段都可以省略；
- 行内内容可以直接写字符串；
- 数组里的字符串就是段落（在参考文献里是文献条目）。

服务端把片段归一化为完整 IR，再投影为编辑器节点写入文档。**全有或全无**：只要有一个问题，整批都不会写入，并返回带路径的问题列表（第 5 节）。

三条总则：

1. 片段永远是**数组**，即使只有一个节点。
2. **不要手写编号**：章号、条号、图号、表号、公式号、注号、附录字母、参考文献序号全部由系统计算。标题里只写标题文字（章标题写「范围」，不要写「1 范围」；表题写「限值」，不要写「表1 限值」）。
3. 先看第 3 节确定上下文：同一种节点放在不同位置，允许与否、层级都不同。

## 2. 通用规则

### 2.1 id

- `id` 可省略，省略时自动生成。给出时必须是非空字符串，片段内不得重复，也不得与文档里已有的 id 冲突。
- **要被交叉引用的节点，创建时就要写显式 `id`**，引用方才有目标可指（见 2.2 的 `crossRef`）。
- 表行、单元格、列项项、式中项的 id 同样可省略。
- 注、示例、列项项里的段落 id 由所属节点派生为 `<所属 id>.p0`，不要单独指定（写了也必须等于这个值）。
- 修改既有节点时沿用它原来的 id；新增节点省略 id 即可。

### 2.2 行内内容

凡是「行内内容」字段（`content`、`title`、`caption`、`term` 等）都可以写成：

- 字符串：`"本文件适用于……"`；
- 数组：元素是字符串，或 `{ "text": "……", "marks": [ …标记… ] }` 对象。需要加粗、上标、引用时用对象。

文本里的换行写成 `\n`（在片段里会成为独立的换行）。空字符串会被丢弃；**空文本不能带标记**。相邻且标记完全相同的文字会合并成一个片段（编辑器里它们本来就是同一段文字）。

标记（`marks`）按 IR 原样接受：

| type | 其他字段 | 说明 |
|---|---|---|
| `bold` `italic` `underline` `sub` `sup` `strike` `code` | 无 | 同一段文字上同一种标记只能出现一次；`code` 不能与其他标记组合 |
| `variable` | `kind`、`name`（可选字符串） | 标记变量符号（语义标记） |
| `externalLink` | `href`（必填）、`title`、`target`、`rel` | `href` 只接受 `http://`、`https://`、`mailto:`、`tel:` 开头且不含空白的地址 |
| `crossRef` | `targetId`（必填）、`targetKind`（可选） | 引用章、条、附录、图、表、公式、注、示例等；`targetKind` 取 `chapter` `clause` `appendix` `figure` `table` `formula` `note` `example` `bibliography` `term` `index` `paragraph` |
| `bibRef` | `targetId`（必填） | 引用参考文献条目 |
| `termRef` | `targetId`（必填） | 引用术语条目 |

交叉引用的显示文字由系统按编号生成（如「表1」「5.2」），你写的 `text` 会在导出时被替换，建议写成与编号一致的文字便于阅读。`targetId` 必须是目标节点的显式 id；目标不存在时这里**不会**报错，由后续的文档校验报告悬空引用。建议总是同时写 `targetKind`：写了之后，目标的类型与之不符也会在文档校验中报告。`crossRef` 的文字里不能含换行。

暂不支持：行内样式 `style`、行内公式 `formula`、脚注 `footnote`、表脚注引用 `tableFootnoteRef`。

```json ses-example context=chapter
[
  {
    "kind": "paragraph",
    "content": [
      "排放限值见",
      { "text": "表1", "marks": [{ "type": "crossRef", "targetId": "tbl-limit", "targetKind": "table" }] },
      "，其中",
      { "text": "CO", "marks": [{ "type": "bold" }] },
      { "text": "2", "marks": [{ "type": "sub" }] },
      "的限值最严。"
    ]
  },
  {
    "kind": "table",
    "id": "tbl-limit",
    "caption": "排放限值",
    "rows": [["污染物", "限值"], ["CO2", "10"]]
  }
]
```

其余标记的写法（可与上例一起参考）：

```json ses-example context=chapter
[
  {
    "kind": "paragraph",
    "content": [
      { "text": "斜体", "marks": [{ "type": "italic" }] },
      { "text": "下划线", "marks": [{ "type": "underline" }] },
      { "text": "删除线", "marks": [{ "type": "strike" }] },
      { "text": "上标", "marks": [{ "type": "sup" }] },
      { "text": "代码", "marks": [{ "type": "code" }] },
      { "text": "m", "marks": [{ "type": "variable", "name": "m" }] },
      { "text": "GB/T 1.1", "marks": [{ "type": "bibRef", "targetId": "bib-gbt1" }] },
      { "text": "标准化", "marks": [{ "type": "termRef", "targetId": "term-std" }] },
      { "text": "标准化管理委员会", "marks": [{ "type": "externalLink", "href": "https://www.sac.gov.cn/", "title": "官网" }] }
    ]
  }
]
```

### 2.3 块与字符串

- 在可以放块的位置，数组里的**字符串就是一个段落**；对象写 `{ "kind": "paragraph", "content": … }`。
- 表格单元格、术语定义的内容：字符串 = 一个段落；块数组 = 多个块（字符串 = 段落，对象需带 `kind`）；若数组元素全是行内片段对象（`{ "text": … }`），则整体是**一个**段落。块数组与行内片段不能混写。
- 注、示例、列项项只有**一段**内容，直接写行内内容；不能写多个段落，也不能嵌套其他块。

### 2.4 字段检查是严格的

- 未知字段会被拒绝（防止 `contnet` 这样的拼写错误被静默忽略）。
- IR 里存在但写作片段暂不支持的字段（如图的 `imageWidth`、表的 `width`、公式的 `mathml`）会给出专门的提示：请省略。
- `warning`、`quote`、`code` 等 IR 扩展块暂不支持，会以 `unsupported-kind` 拒绝。
- 缺省值由系统补齐。可推导字段可以省略：条的 `level` 与列项的 `level` 若给出必须与推导结果一致；`titled` 若给出不能与标题是否为空矛盾；`secType` 若给出则采用你给的值。

读取节点得到的 IR，只要不含暂不支持的字段，就可以原样作为片段回传（替换内容时），其中的 id 会被保留。含暂不支持字段（如手工调整过的列宽、行内样式）的节点，回传时这些字段必须去掉，对应的版式信息会随替换丢失。因此 `replace` 遇到这样的节点默认拒绝，需要显式 `acceptLoss`，见第 7 节。

## 3. 上下文：片段插入在哪里

提交片段时同时给出上下文，格式 `{ "parent": "<父节点>" }`；父节点是条时必须给出它自己的层级：`{ "parent": "clause", "level": 2 }`（在 2 级条内插入，新条为 3 级）。

| parent | 含义 | 允许的 kind | 子条与子术语条目的层级 |
|---|---|---|---|
| `foreword` | 前言正文 | `paragraph` `list` `table` `figure` `formula` `note` `example` | — |
| `introduction` | 引言正文 | `paragraph` `list` `table` `figure` `formula` `note` `example` | — |
| `body` | 文档顶层的章序列 | `chapter` | — |
| `chapter` | 章内部 | `clause` `paragraph` `list` `table` `figure` `formula` `note` `example` `termEntry` | 1 |
| `clause`，level 1~4 | 1~4 级条内部 | `clause` `paragraph` `list` `table` `figure` `formula` `note` `example` `termEntry` | level+1 |
| `clause`，level 5 | 5 级条内部 | `paragraph` `list` `table` `figure` `formula` `note` `example` | — |
| `appendices` | 文档顶层的附录序列 | `appendix` | — |
| `appendix` | 附录内部 | `clause` `paragraph` `list` `table` `figure` `formula` `note` `example` `termEntry` | 1 |
| `bibliography` | 参考文献列表 | `bibEntry` | — |

要点：

- **条的层级由位置决定**：章或附录的直接子条是 1 级，条的子条比父条大 1 级，最高 5 级。你不用写 `level`；写了就必须与推导值一致，否则 `level-mismatch`。术语条目（`termEntry`）的 `level` 缺省取同一推导值，但只影响显示层级、不影响编号，显式给出 1~5 的整数时原样保留。
- 章只能放在 `body`，附录只能放在 `appendices`；章内不能再放章。
- 前言、引言只放块，不放章、条、术语条目。
- 章与附录的先后顺序（章在前、附录在后）取决于插入位置，不由片段内容保证。
- 一个容器里既有子条又直接放正文段（悬置段）不符合 GB/T 1.1，文档校验会给出警告；有子条时，正文段应放进条里。

```json ses-example context=foreword
[
  "为规范……，制定本文件。",
  { "kind": "note", "content": "本文件由……提出并归口。" }
]
```

```json ses-example context=introduction
["随着……，需要对……作出规定。"]
```

```json ses-example context=clause:1
[
  {
    "kind": "clause",
    "title": "二级条",
    "children": [
      { "kind": "clause", "title": "三级条", "children": ["三级条里的正文。"] }
    ]
  }
]
```

## 4. 节点

下表中「缺省」一栏是省略时系统补齐的值。对象写法必须带 `kind`（值就是各小节标题里的名称），所有节点都有可选的 `id`，下面的表不再重复这两项。

### 4.1 段落 `paragraph`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `content` | 是 | | 行内内容 |

可放块的位置，字符串就是段落，下面两种写法等价：

```json ses-example context=chapter
[
  "这是一个段落。",
  { "kind": "paragraph", "content": "这是一个段落。" }
]
```

### 4.2 列项 `list`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `listType` | 否 | `dash` | `dash`（破折号，一级）、`alpha`（a）b）…，一级）、`boxed`（方框数字，一级）、`number`（1）2）…，二级）、`dot`（间隔号，二级） |
| `level` | 否 | 由 `listType` 决定 | `number`、`dot` 固定为 2 级，其余为 1 级；不要写，写了必须一致 |
| `items` | 是 | | 至少一项；每项可以是字符串、行内数组或 `{ "content": …, "id": … }` |

不支持罗马数字列项，也不支持列项嵌套列项：需要二级列项时，在一级列项之后再写一个 `number` 或 `dot` 列项。

```json ses-example context=chapter
[
  { "kind": "list", "items": ["第一项", "第二项"] },
  { "kind": "list", "listType": "alpha", "items": ["甲", { "content": ["乙，其中", { "text": "x", "marks": [{ "type": "variable" }] }] }] },
  { "kind": "list", "listType": "number", "items": ["一级列项之下的二级列项"] }
]
```

### 4.3 表 `table`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `caption` | 是 | | 表题（行内内容，可为空字符串；不要写「表1」） |
| `captionEn` | 否 | 无 | 英文表题 |
| `orientation` | 否 | `portrait` | `portrait` 或 `landscape`（宽表横排） |
| `headerRowCount` | 否 | `1` | 表头行数，0 ~ 行数的整数 |
| `rows` | 是 | | 至少一行；行可以是单元格数组，或 `{ "cells": […], "id": … }` |
| `notes` | 否 | `[]` | 表注，元素是字符串或 `{ "content": … }` |

单元格是字符串，或 `{ "content": …, "colspan": 1, "rowspan": 1, "header": … }`：

- `content` 必填（空单元格写 `""`）；可放段落和列项；
- `colspan`、`rowspan` 缺省为 1，上限 100；
- `header` 缺省为「所在行号 < `headerRowCount`」。

各行按 `colspan`/`rowspan` 展开后占用的列数必须一致，`rowspan` 不能越过最后一行，否则 `table-grid`。表格单元格里不能再放表、图等其他块。

```json ses-example context=chapter
[
  {
    "kind": "table",
    "caption": "检验项目",
    "headerRowCount": 2,
    "rows": [
      [{ "content": "项目", "rowspan": 2 }, { "content": "指标", "colspan": 2 }],
      ["下限", "上限"],
      ["长度", "1", "2"],
      ["质量", { "content": ["1", "2"] }, { "content": [{ "kind": "list", "items": ["a", "b"] }] }]
    ],
    "notes": ["长度的单位为 mm。"]
  }
]
```

### 4.4 图 `figure`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `caption` | 是 | | 图题（可为空字符串；不要写「图1」） |
| `captionEn` | 否 | 无 | 英文图题 |
| `orientation` | 否 | `portrait` | `portrait` 或 `landscape` |
| `src` | 是 | | 只接受 PNG、JPEG、GIF 的 base64 data URL（`data:image/png;base64,……`）；**不会下载外链图片** |
| `alt` | 否 | `""` | 替代文字 |
| `notes` | 否 | `[]` | 必须为空或省略（编辑器的图没有图中注节点；要写说明请放进图题或图后的 `note`） |

```json ses-example context=chapter
[
  {
    "kind": "figure",
    "caption": "示意图",
    "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  }
]
```

### 4.5 公式 `formula`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `latex` | 是 | | LaTeX 源码，首尾空白会被去掉，不能为空 |
| `numbered` | 否 | `true` | 是否编号 |
| `whereList` | 否 | `[]` | 「式中：」说明，元素 `{ "term": 符号, "definition": 说明 }`，两者都必须非空 |

```json ses-example context=chapter
[
  {
    "kind": "formula",
    "latex": "E = mc^2",
    "whereList": [
      { "term": "E", "definition": "能量，单位为焦耳（J）" },
      { "term": "m", "definition": "质量，单位为千克（kg）" }
    ]
  }
]
```

### 4.6 注 `note` 与示例 `example`

内容只有一段，同一作用域内单条注不编号、多条自动编为「注1」「注2」，示例同理——不要自己写「注：」「示例：」前缀。

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `content` | 是 | | 行内内容，或恰含一个 `paragraph` 的块数组 |

```json ses-example context=chapter
[
  { "kind": "note", "content": "单条注不带编号。" },
  { "kind": "example", "content": "示例的内容。" }
]
```

### 4.7 条 `clause`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `title` | 否 | 空 | 条标题（不要写条号） |
| `titled` | 否 | 标题非空 | `false` 表示无题条（此时不能给 `title`）；`true` 时必须有非空标题 |
| `level` | 否 | 由位置推导 | 见第 3 节 |
| `children` | 否 | `[]` | 子节点：块、子条、术语条目（取决于层级） |

```json ses-example context=chapter
[
  { "kind": "clause", "title": "一般要求", "children": ["应符合……的规定。"] },
  { "kind": "clause", "children": ["无题条，只有条号。"] }
]
```

### 4.8 术语条目 `termEntry`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `term` | 是 | | 术语，不能为空 |
| `termEn` | 否 | 无 | 英文对应词 |
| `definition` | 是 | | 定义，不能为空；字符串、段落字符串数组或块数组（只允许段落） |
| `source` | 否 | 无 | 来源，如 `"GB/T 1.1—2020，3.1"`；**不要**把「[来源：……]」写进 `definition` |
| `notes` | 否 | `[]` | 术语的注 |
| `examples` | 否 | `[]` | 术语的示例 |
| `level` | 否 | 与位置对齐 | 显示层级，1~5 的整数，缺省见第 3 节；不影响编号 |

不支持嵌套术语条目和 TBX 语言集。术语条目应放在「术语和定义」章（或其下的条）中。

```json ses-example context=chapter
[
  "下列术语和定义适用于本文件。",
  {
    "kind": "termEntry",
    "term": "标准化",
    "termEn": "standardization",
    "definition": "为了在既定范围内获得最佳秩序，……的活动。",
    "source": "GB/T 20000.1—2014，2.1.1",
    "notes": ["该活动主要包括……"],
    "examples": ["示例内容。"]
  }
]
```

### 4.9 章 `chapter`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `title` | 是 | | 章标题，不能为空（不要写章号） |
| `secType` | 否 | 按标题推断 | `scope`、`norm-refs`、`terms`、`general`。标题恰为「范围」→ `scope`，「规范性引用文件」→ `norm-refs`，「术语和定义」→ `terms`，其余 `general` |
| `children` | 否 | `[]` | 块、1 级条、术语条目 |

```json ses-example context=body
[
  { "kind": "chapter", "title": "范围", "children": ["本文件规定了……"] },
  { "kind": "chapter", "title": "技术要求", "children": [{ "kind": "clause", "title": "一般要求", "children": ["……"] }] }
]
```

### 4.10 附录 `appendix`

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `title` | 是 | | 附录标题，不能为空（不要写「附录A」，也不要写「（规范性）」） |
| `normative` | 否 | `false` | `true` 为规范性附录，`false` 为资料性附录 |
| `children` | 否 | `[]` | 块、1 级条、术语条目 |

```json ses-example context=appendices
[
  { "kind": "appendix", "title": "试验方法", "normative": true, "children": ["……"] }
]
```

向已有附录内部追加内容时用 `appendix` 上下文：

```json ses-example context=appendix
[
  { "kind": "clause", "title": "试验步骤", "children": ["按下列步骤进行。", { "kind": "list", "listType": "number", "items": ["取样", "测量"] }] }
]
```

### 4.11 参考文献条目 `bibEntry`

在 `bibliography` 上下文中，字符串就是一个文献条目；也可以写对象。文献序号由系统编为 [1]、[2]……；正文引用用 `bibRef` 标记指向条目的显式 id。

| 字段 | 必填 | 缺省 | 说明 |
|---|---|---|---|
| `content` | 是 | | 行内内容，不能为空 |

```json ses-example context=bibliography
[
  "GB/T 1.1—2020 标准化工作导则 第1部分：标准化文件的结构和起草规则",
  { "kind": "bibEntry", "id": "bib-iso", "content": "ISO/IEC Directives, Part 2" }
]
```

## 5. 问题与代码

归一化失败时返回问题列表，每项含 `path`（问题位置，如 `fragment[0].children[1].title`）、`code`、`reason`（中文原因）。一次会报出全部问题。

| code | 含义 |
|---|---|
| `invalid-context` | 上下文本身无效 |
| `empty-fragment` | 片段为空（删除内容请用删除操作） |
| `invalid-type` | JSON 类型不对 |
| `missing-field` | 缺少必填字段 |
| `unknown-field` | 未知字段（多为拼写错误） |
| `unsupported-field` | IR 里有、但写作片段暂不支持的字段或标记 |
| `unknown-kind` | 未知的 `kind` |
| `unsupported-kind` | 暂不支持的块（`warning`、`quote`、`code`） |
| `not-allowed-here` | 该节点不能放在此上下文或容器中 |
| `invalid-value` | 取值非法（枚举、格式、范围） |
| `empty-value` | 必须非空的内容为空 |
| `invalid-id` | `id` 不是非空字符串，或违反派生规则 |
| `duplicate-id` | 片段内 id 重复 |
| `id-conflict` | 与文档里已有的 id 冲突 |
| `level-mismatch` | 显式层级与位置推导的层级不一致 |
| `inline-projection` | 行内标记组合无法在编辑器中保留 |
| `table-grid` | 表格各行占用的列数不一致，或 `rowspan` 越界 |

典型错误示例（`expect=error` 的示例必须产生指定 `code` 与 `path` 的问题）：

```json ses-example context=chapter expect=error code=level-mismatch path=fragment[0].level
[{ "kind": "clause", "level": 2, "title": "章下面的第一级条应为 1 级" }]
```

```json ses-example context=foreword expect=error code=not-allowed-here path=fragment[0].kind
[{ "kind": "chapter", "title": "前言里不能放章" }]
```

```json ses-example context=chapter expect=error code=unknown-field path=fragment[0].contnet
[{ "kind": "paragraph", "contnet": "字段名拼错" }]
```

```json ses-example context=chapter expect=error code=table-grid path=fragment[0].rows[1]
[{ "kind": "table", "caption": "列数不一致", "rows": [["甲", "乙"], ["丙"]] }]
```

```json ses-example context=chapter expect=error code=duplicate-id path=fragment[1].id
[
  { "kind": "paragraph", "id": "p-1", "content": "甲" },
  { "kind": "paragraph", "id": "p-1", "content": "乙" }
]
```

```json ses-example context=chapter expect=error code=unsupported-kind path=fragment[0].kind
[{ "kind": "quote", "content": ["暂不支持引文块"] }]
```

```json ses-example context=chapter expect=error code=inline-projection path=fragment[0].content[0].marks[1]
[{ "kind": "paragraph", "content": [{ "text": "重复标记", "marks": [{ "type": "bold" }, { "type": "bold" }] }] }]
```

## 6. 写作约定（GB/T 1.1 要点）

- 章、条、附录的标题只写文字；编号、「附录A」「（规范性）」字样、图表公式的编号都由系统生成。
- 条分层不跳级；有子条的容器不要同时直接放正文段。
- 列项：同一层级用同一种列项类型；一级用 `dash`/`alpha`，其下的二级用 `number`/`dot`。
- 术语和定义章：先写引导语段落，再写术语条目；定义写成可以替换术语的名词性短语。这类行文细节由作者把握，系统不检查。
- 引用其他章条、图表、公式时用 `crossRef`，引用参考文献用 `bibRef`，引用术语用 `termRef`；不要把「见5.2」之类编号写成死文本。
- 需要被引用的节点先创建（写显式 `id`），再创建引用它的内容；同一批片段里先后顺序不限，目标是否存在由文档校验检查。

## 7. 替换节点（replace）与丢失内容

`replace` 把一个节点整体替换为片段。写作片段只能表达节点的一部分内容（见 2.4 与第 4 节里「暂不支持」的字段），所以对含有这类内容的节点，整体替换必然把它们丢掉。规则：

- **哪些节点受影响**：被替换的节点本身，或它的任何后代，含有片段表达不了的内容，如表格样式与列宽、图的资源引用与尺寸、公式的 MathML、TBX 语言集、结构化的参考文献字段、行内样式与脚注，以及警告、引文、代码块。替换章、条、附录时，只要里面有一处，整个替换就受影响。
- **事先查看**：读取节点的结果里 `replaceable` 为 `false` 时，`notReplaceable` 逐条列出将丢失的项与位置（如 `ir.rows[0].cells[0].columnWidths`）。
- **默认拒绝**：`replace` 遇到这样的节点，该操作报问题 `replace-loses-content`（`path` 为 `operations[i].nodeId`，`reason` 列出将丢失的项与位置），整批不生效，不会先替换、事后再警告。
- **显式接受**：确认可以丢失时，在该 `replace` 操作上加 `"acceptLoss": true`，操作才会执行；成功结果的 `warnings` 里保留一条 `replace-loses-content`，说明实际丢失了什么。`acceptLoss` 只允许出现在 `replace` 上，必须是布尔值（缺省为 `false`）；`insert`、`delete`、`move` 带上它会按未知字段报错。
- **`acceptLoss` 不放宽片段检查**：提交的 `content` 仍须是合法的写作片段。把读取节点得到的 IR 原样回传仍会被拒绝，因为其中带着暂不支持的字段，必须先把它们去掉。
- **想保留这些内容**：改为替换节点内部不含这些内容的子节点（如表格所在条里的某个段落），或在旁边用 `insert` 添加新内容。

接受丢失的操作示例（这是操作而不是片段，不带 `ses-example` 标记，不参与示例校验；规则由 `packages/io/src/documentOps` 的测试核对）：

```json
{
  "op": "replace",
  "nodeId": "tbl-styled",
  "acceptLoss": true,
  "content": [{ "kind": "table", "id": "tbl-styled", "caption": "带列宽的表", "rows": [["项目", "值"], ["甲", "乙"]] }]
}
```
