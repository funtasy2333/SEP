# SES 文档包格式（.ses）

SES 文档包用于在不同 SES 数据库之间迁移、备份和恢复一份文档的完整编辑状态。`.ses` 文件是 UTF-8 编码的 JSON，不压缩、不打 zip；正文、文件设置和已保存版本都在同一文件中。

文档包适合往返传递，不提供正文合并、文件协同或外部图片抓取。导入时可以新建文档，也可以把包中的当前正文和设置更新到同一身份的本地文档，并保留两边已有的版本。

## 文件形态

导出的响应类型为 `application/vnd.ses-package+json`，文件扩展名为 `.ses`。JSON 使用 UTF-8，包含 `formatVersion`，用于后续格式演进。

下面是一个 v1 包的完整 JSON 形状示例。文档正文包含 `data:` 图片引用和 `figureResource` 资源节点；示例中的 UUID 和带时区的时间均为合法值。

```json
{
  "format": "ses-document-package",
  "formatVersion": 1,
  "exportedAt": "2026-10-30T08:00:00.000Z",
  "generator": {
    "name": "SES",
    "version": "0.1.0"
  },
  "document": {
    "uid": "6f1c0459-bf20-4d7c-9e8b-983f51bcab57",
    "title": "示例标准",
    "meta": {
      "standardNo": "GB/T 12345—2026",
      "titleCn": "示例标准",
      "titleEn": "Example Standard",
      "standardType": "national"
    },
    "stage": "working_draft",
    "content": {
      "type": "doc",
      "content": [
        {
          "type": "chapter",
          "attrs": {
            "nodeId": "chapter-scope",
            "secType": "scope"
          },
          "content": [
            {
              "type": "chapterTitle",
              "content": [
                {
                  "type": "text",
                  "text": "范围"
                }
              ]
            },
            {
              "type": "stdParagraph",
              "attrs": {
                "nodeId": "paragraph-scope"
              },
              "content": [
                {
                  "type": "text",
                  "text": "正文中的内嵌图片："
                },
                {
                  "type": "inlineImage",
                  "attrs": {
                    "src": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
                    "resourceId": "resource-1",
                    "alt": "样图",
                    "size": "S"
                  }
                }
              ]
            }
          ]
        },
        {
          "type": "figureResource",
          "attrs": {
            "nodeId": "resource-1",
            "mediaType": "image/png",
            "name": "tiny.png",
            "encoding": "dataUrl",
            "data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
          }
        }
      ]
    },
    "createdAt": "2026-10-01T09:30:00.000Z",
    "updatedAt": "2026-10-30T07:59:00.000Z"
  },
  "versions": [
    {
      "uid": "a2e9e2bc-63b8-4d53-a2ad-709357b111c0",
      "versionNo": "1.0",
      "stage": "working_draft",
      "content": {
        "type": "doc",
        "content": [
          {
            "type": "chapter",
            "attrs": {
              "nodeId": "chapter-scope",
              "secType": "scope"
            },
            "content": [
              {
                "type": "chapterTitle",
                "content": [
                  {
                    "type": "text",
                    "text": "范围"
                  }
                ]
              },
              {
                "type": "stdParagraph",
                "attrs": {
                  "nodeId": "paragraph-scope"
                },
                "content": [
                  {
                    "type": "text",
                    "text": "初始版本正文。"
                  }
                ]
              }
            ]
          }
        ]
      },
      "baseContent": null,
      "note": "初始版本",
      "source": "human",
      "client": null,
      "createdAt": "2026-10-01T09:30:00.000Z"
    }
  ]
}
```

正文 `content` 是编辑器使用的 ProseMirror JSON。当前正文必须通过当前编辑器 schema 校验；校验时会调用 `normalizeContent`，但校验结果不会替换包内 JSON。导入和导出保留通过校验的原 JSON，避免补默认属性或修复 `nodeId` 时改动图片、`figureResource` 或其他节点数据。

## 字段说明

### 顶层字段

| 字段 | 类型与要求 | 含义 |
| --- | --- | --- |
| `format` | 必填字符串，固定为 `ses-document-package` | 文档包类型标识。 |
| `formatVersion` | 必填正整数；当前只接受 `1` | 包格式版本。 |
| `exportedAt` | 必填、带时区的 ISO 8601 时间字符串 | 本次生成包的时间，不用于覆盖文档时间。 |
| `generator` | 必填对象，含字符串 `name`、`version` | 生成程序标识。SES 当前导出为 `SES`、`0.1.0`。 |
| `document` | 必填对象 | 当前文档身份、设置和正文。 |
| `versions` | 必填数组，可以为空 | 全部已保存版本，导出时按 `createdAt`、数据库 id 升序排列。 |

### `document` 字段

| 字段 | 类型与要求 | 含义 |
| --- | --- | --- |
| `uid` | 必填 UUID 字符串 | 文档稳定身份，用于本地匹配。 |
| `title` | 必填字符串 | 文档标题。 |
| `meta` | 必填 JSON 对象 | 文件设置元数据，见下表。 |
| `stage` | 必填字符串 | 当前编制阶段。 |
| `content` | 必填 JSON 对象，须通过当前编辑器 schema | 当前正文原始 JSON。 |
| `createdAt` | 必填、带时区的 ISO 8601 时间字符串 | 记录源文档创建时间；导入时不用于设置本地文档时间。 |
| `updatedAt` | 必填、带时区的 ISO 8601 时间字符串 | 记录源文档更新时间；导入时不用于设置本地文档时间。 |

`meta` 使用 `DocumentMeta` 字段。正常文档要求 `titleCn` 和 `standardType`；支持的已知字段为 `standardNo`、`icsCode`、`ccsCode`、`titleCn`、`titleEn`、`publishDate`、`implementDate`、`standardType`、`issuer`、`applicant`、`replaces`、`consistency`、`filingNo`、`industryName`、`regionName`、`coverDesignation`、`proposer`、`technicalCommittee`。可选值可省略；出现的已知字段必须为字符串，不能为 `null`。导入校验要求 `meta` 是对象，并校验已知字段的类型；未知元数据字段会原样保留。

### `versions[]` 字段

| 字段 | 类型与要求 | 含义 |
| --- | --- | --- |
| `uid` | 必填 UUID 字符串 | 版本稳定身份，导入时按它去重。 |
| `versionNo` | 必填字符串 | 版本号；格式由已有版本管理规则解释。 |
| `stage` | 必填字符串 | 该版本保存时的阶段。 |
| `content` | 必填 JSON 对象，且 `type` 必须为 `doc` | 版本正文。 |
| `baseContent` | 必填；JSON 对象且 `type` 为 `doc`，或 `null` | 写入前正文；用于保存 AI 写入前状态的版本。 |
| `note` | 必填字符串或 `null` | 版本说明。 |
| `source` | 必填字符串：`human`、`ai` 或 `import` | 版本来源。 |
| `client` | 必填字符串或 `null`，字符串最多 200 个字符 | 写入方标识，例如 MCP 客户端名。 |
| `createdAt` | 必填、带时区的 ISO 8601 时间字符串 | 版本保存时间；导入时保留该时间。 |

当前正文和版本正文的校验范围不同：当前 `document.content` 按当前编辑器 schema 完整校验；版本的 `content`、`baseContent` 只要求是对象且 `type: "doc"`，不按当前 schema 校验，以容纳较早版本的节点结构。

### `null`、时间和未包含字段

上述包结构字段中，显式允许 `null` 的是 `versions[].baseContent`、`versions[].note` 和 `versions[].client`。`meta` 不能为 `null`，其已知字段也不能为 `null`；未知元数据键会原样保留且不作类型校验。正文 `content` 及未知元数据键内部的 JSON 值不受上述字段表的 null 规则约束。其他必填字段必须提供对应类型的值。时间必须是带时区的 ISO 8601 字符串，例如 `2026-10-30T08:00:00.000Z` 或 `2026-10-30T16:00:00+08:00`。

包不包含数据库 `id`、`documentId`、`revision`、`deletedAt` 或版本表旧 `xml` 字段；`xml` 不参与导入。解析器会丢弃顶层、`document`、`generator` 和版本对象中的未声明字段；`meta` 的未知键会保留，正文 `content` 则按原 JSON 保留。`generator` 与 `exportedAt` 用于记录包的来源和生成时间，不用于覆盖文档或版本的业务状态。

数据库中的文档和版本 `uid` 列为兼容旧库而允许暂时为 `null`；服务启动时会为旧记录补齐 UUID。普通文档和版本创建由服务端生成 uid，并忽略客户端提供的 uid。`.ses` 包内的文档与版本 uid 均必须是 UUID 字符串，不能为 `null`。

文档的 `createdAt`、`updatedAt` 仅随包记录，导入新文档时由本地数据库生成时间；更新现有文档时保留本地创建时间并由更新操作刷新更新时间。版本的 `createdAt` 在导入时使用包内时间；再次导出时以 UTC ISO 形式表示。

## 导入与身份规则

首页的「导入 .ses」先调用只读预览。预览按文档 uid 查找本地记录，优先返回活动文档；没有活动文档时返回同 uid 的回收站记录。无匹配时，`match` 为 `null`、`inTrash` 为 `false`，`newVersions` 为包内版本数，其他差异计数为空或为 `false`。

预览的响应结构如下：

```json
{
  "match": { "id": 12, "title": "示例标准", "revision": 4 },
  "inTrash": false,
  "newVersions": 1,
  "localOnlyVersions": 2,
  "contentDiffers": true,
  "versionNoCollisions": ["1.0"]
}
```

`newVersions` 是包中 uid 尚未出现在本地的版本数；`localOnlyVersions` 是本地 uid 不在包中的版本数；`contentDiffers` 比较本地当前正文与包正文，JSON 对象的键顺序不影响结果，数组顺序仍影响结果；`versionNoCollisions` 列出将新增的包内版本号与本地版本号重复的值。

### 新建或另存为新文档

`mode=new` 新建文档。若该文档 uid 未被本地占用，沿用包内 uid。若任何本地记录已占用该 uid（包括回收站），则生成新的文档 uid，标题追加「（导入副本）」并同步 `meta.titleCn`；正文、版本和其余文件设置沿用包内内容。版本 uid 与版本时间保留。

没有匹配项时，首页直接新建并打开导入后的文档。匹配项在回收站时，首页提示先恢复，或另存为新文档；用户也可取消。

### 更新同一文档

`mode=update` 只用于匹配的活动文档，必须传 `targetId` 和预览所得的 `baseRevision`。文档 `revision` 变化会返回 `409`，整个事务不写入，首页提示重新导入。

更新在同一事务内完成：

1. 按版本 uid 追加本地没有的包内版本；同 uid 版本跳过、不覆盖。两边原有版本都保留。版本号只与导入前的本地版本比较（与预览的 `versionNoCollisions` 一致）：冲突时分配下一个未占用版本号，并在说明中记录「原版本号 x.y」；原说明存在时接在其后。
2. 如果本地正文与包内正文不同，与 AI 写入一样留一条导入记录：版本 `source` 为 `import`，`note` 精确为「导入 .ses 文档包」，`content` 与 `stage` 是导入后的正文与阶段（即更新后的当前状态），`baseContent` 是导入前的本地正文。`baseContent → content` 就是这次导入带来的修改：版本历史对这条记录提供「查看本次修改」与「回滚到修改前」，导入前的本地正文（包括尚未存成版本的编辑）因此不会丢失。导入记录在包内版本之后分配版本号，不会占用对方的版本号。正文相同时不留记录。
3. 用包内 `title`、`meta`、`stage` 和 `content` 更新当前文档，文档 `revision` 加 1。事务提交后发布 `source: import` 的文档变更事件。

如果正文不同，而本地当前正文不是对象或其 `type` 不是 `doc`（无法作为导入记录的 `baseContent`），接口返回 `422`，不写入数据也不发布事件；先在编辑器保存可用正文，或另存为新文档。若 `baseRevision` 已过期，会先返回 `409`。

正文不会自动合并。包内正文成为更新后的当前正文，导入前的本地正文保留在导入记录的 `baseContent` 中；用户在版本历史中「查看本次修改」对照后手工取舍，必要时「回滚到修改前」。重复往返会按版本 uid 追加两边的版本并集，本地独有版本不会删除。

## HTTP 接口

| 方法与路径 | 用途 | 成功响应 |
| --- | --- | --- |
| `GET /api/documents/:id/export/ses` | 导出活动文档及全部版本 | `200`，附件类型 `application/vnd.ses-package+json`。不存在或在回收站的文档返回 `404`。 |
| `POST /api/documents/import/ses?mode=preview` | 校验包并只读预览本地身份与版本差异 | `200`，返回上文的预览对象。 |
| `POST /api/documents/import/ses?mode=new` | 新建文档或另存为副本 | `201`，返回新建的文档对象。 |
| `POST /api/documents/import/ses?mode=update&targetId=…&baseRevision=…` | 更新匹配的活动文档 | `200`，返回更新后的文档对象。 |

导入请求必须使用 `Content-Type: application/vnd.ses-package+json` 和原始 UTF-8 字节请求体，服务端请求体上限为 200 MiB（209715200 字节，配置值 `200mb`）；超限返回 `413`。格式、字段类型、UUID、时间、重复版本 uid 或 JSON 解析错误返回 `400`；当前正文不符合编辑器 schema 返回 `422`；版本正文只校验对象及 `type: "doc"`。不支持的包格式版本（包括更高版本）返回 `400`，更高版本的错误信息会提示升级 SES。缺少 `baseRevision` 返回 `428`；目标修订号过期返回 `409`；目标位于回收站时返回 `409`；目标不存在返回 `404`；更新目标 uid 与包不匹配返回 `400`；请求 MIME 不匹配返回 `415`。

导出响应使用 UTF-8 `Content-Disposition` 附件文件名。外部图片告警通过响应头返回，不写进包内：`X-SES-Export-Warning-Count` 是告警总数；`X-SES-Export-Warnings` 在有明细且响应头长度允许时提供百分号编码的 JSON 数组；明细会限制单条消息长度并在总长度上限内截断，截断时 `X-SES-Export-Warnings-Truncated: true`。客户端可以据此显示完整告警数和可用明细。

## 图片与版本演进

正文中的 `data:` 图片 URL、`figureResource` 节点及其中的 data URL 按原 JSON 保留，不下载、不改写、不抽取。非 `data:` 图片不会被服务端抓取或内嵌；原 `src` 引用仍保留在 JSON 中。导出只读扫描当前正文以及每个版本的 `content` 和 `baseContent`，对 `figureImage`、`inlineImage`、`image` 节点中的非 `data:` `src` 生成告警。

新增可选字段不升 `formatVersion`；改变字段语义或删除字段时，必须升级 `formatVersion` 并提供迁移。当前只支持 v1；更高版本需升级 SES 后再导入。

## 已知限制

- 不提供正文自动合并或逐段冲突解决；两边有改动时需用版本比较后手工取舍。
- 更新按 uid 追加版本并保留本地独有版本；同 uid 版本不会被包内版本覆盖。另存为新文档会创建新的文档身份，形成独立分支。
- 不抽取图片、不去重、不压缩；文件体积会随内嵌图片和历史版本增加，单次导入请求上限为 200 MiB（209715200 字节，配置值 `200mb`）。
- 旧版本正文只按 JSON 对象且 `type: "doc"` 校验，不按当前 schema 校验；恢复较早版本后，若其节点已不受当前编辑器支持，仍需处理该正文。
- 新建后从未写入正文的文档（正文为空）不能导出，接口返回 `422`，与其他出件一致；在编辑器中打开并保存正文后即可导出。导出时当前正文也须通过当前编辑器 schema 校验。
- 导入记录的修改前内容只有正文（`baseContent`），版本表没有 `title`、`meta` 字段；「回滚到修改前」只恢复正文，文档 `title` 不随之恢复（封面字段随正文中的封面节点恢复）。
- 导入记录的正文通常与对方最后保存的版本相同，版本列表中会多一条内容相同的记录；这是为了提供「查看本次修改」。
- MCP 的 `export_document` 尚不提供 `.ses` 格式；标准库卡片菜单也没有 `.ses` 导出入口。导出入口位于编辑器的导出对话框。
