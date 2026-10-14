import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DocumentStage, StandardType } from '@ses/shared';
import { READABLE_CONTAINERS } from '../document-ops/document-ops.service';
import { MAX_NOTE_LENGTH } from '../document-ops/operations-request';

/**
 * 工具的名称、描述与参数 JSON Schema（手写：不引入 zod 等直接依赖）。
 *
 * 描述面向模型：写清楚何时用、返回什么、下一步做什么。Schema 只用于让客户端提示参数；
 * 真正的校验在 {@link McpToolsService}（`mcp-tool-args.ts` 与现有的 operations 解析函数），
 * 不依赖客户端遵守 Schema。`openWorldHint` 全部为 false：工具只访问 SES 自己的数据。
 */

export const STANDARD_TYPES: readonly StandardType[] =
  Object.values(StandardType);
export const DOCUMENT_STAGES: readonly DocumentStage[] =
  Object.values(DocumentStage);

/** export_document 支持的格式。 */
export const EXPORT_FORMATS = ['docx', 'pdf', 'html', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const TOOL_NAMES = [
  'list_documents',
  'create_document',
  'get_outline',
  'get_node',
  'apply_operations',
  'validate_document',
  'export_document',
  'get_authoring_reference',
] as const;
export type McpToolName = (typeof TOOL_NAMES)[number];

const documentId = {
  type: 'integer',
  minimum: 1,
  description: '文档 id（list_documents 或 create_document 返回）',
};

const readOnly = { readOnlyHint: true, openWorldHint: false };

const optionalText = (description: string) => ({ type: 'string', description });

const POSITION_DESCRIPTION =
  '插入位置：\'start\'（父节点内容开头，章/条/附录为标题之后）、\'end\'（末尾），或 {"before": nodeId} / {"after": nodeId}（某个直接子节点之前/之后）';

const operationSchema = {
  type: 'object',
  description:
    '一个操作，op 决定需要哪些字段：insert 需要 parent、position、content；replace 需要 nodeId、content（可选 acceptLoss）；delete 需要 nodeId；move 需要 nodeId、parent、position。' +
    'parent 是容器名（foreword、introduction、body、appendices、bibliography）或章/条/附录的 nodeId；content 是写作片段（节点数组，格式见 get_authoring_reference）。',
  properties: {
    op: { type: 'string', enum: ['insert', 'replace', 'delete', 'move'] },
    nodeId: {
      type: 'string',
      description: 'replace、delete、move 的目标节点 id',
    },
    parent: {
      type: 'string',
      description: 'insert、move 的目标父节点：容器名或章/条/附录的 nodeId',
    },
    position: {
      description: POSITION_DESCRIPTION,
      oneOf: [
        { type: 'string', enum: ['start', 'end'] },
        {
          type: 'object',
          properties: { before: { type: 'string' } },
          required: ['before'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { after: { type: 'string' } },
          required: ['after'],
          additionalProperties: false,
        },
      ],
    },
    content: {
      type: 'array',
      description:
        'insert、replace 的写作片段：节点数组，格式见 get_authoring_reference',
    },
    acceptLoss: {
      type: 'boolean',
      description:
        '仅 replace：明确接受整体替换造成的内容丢失（读取节点时 replaceable 为 false 的节点）；默认 false',
    },
  },
  required: ['op'],
  additionalProperties: false,
};

export const TOOL_DEFINITIONS: readonly (Tool & { name: McpToolName })[] = [
  {
    name: 'list_documents',
    description:
      '列出 SES 中的全部文档，最近修改的在前。返回 { documents: [{ id, title, stage, revision, updatedAt }] }，' +
      '不含正文与文件设置。用于找到要修改的文档 id，或确认文档是否存在。' +
      '下一步：用 get_outline 查看某个文档的结构，或用 create_document 新建文档。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'create_document',
    description:
      '新建一份标准文档，结果与编辑器首页「新建文档」完全一致：带封面、前言，以及「范围」「规范性引用文件」「术语和定义」三章的初始骨架。' +
      '只需 titleCn 与 standardType，其余都是封面和文件设置里的可选信息，没有就不要填（标准编号缺省为占位符，之后可在编辑器里补）。' +
      '返回 { documentId, revision, title, editorUrl }，editorUrl 是编辑器中打开该文档的地址，可交给用户。' +
      '下一步：get_authoring_reference 了解写法，get_outline 查看骨架，再用 apply_operations 写入内容（baseRevision 取返回的 revision）。',
    inputSchema: {
      type: 'object',
      properties: {
        titleCn: optionalText('标准的中文名称（必填，不能为空）'),
        standardType: {
          type: 'string',
          enum: [...STANDARD_TYPES],
          description:
            '标准类型：national 国家标准、industry 行业标准、local 地方标准、group 团体标准、enterprise 企业标准、guidance 指导性技术文件',
        },
        stage: {
          type: 'string',
          enum: [...DOCUMENT_STAGES],
          description: '起始阶段，缺省为 working_draft（工作草案）',
        },
        titleEn: optionalText('英文名称'),
        stdPrefix: optionalText(
          '标准代号，如 GB/T、HG/T；缺省按 standardType 取默认值',
        ),
        stdNo: optionalText(
          '顺序号与年份，如 12345—2026；缺省为占位符 XXXXX—XXXX',
        ),
        icsCode: optionalText('ICS 号，如 35.240.99'),
        ccsCode: optionalText('CCS 号，如 L 70'),
        issuer: optionalText('发布单位'),
        applicant: optionalText('起草单位'),
        proposer: optionalText('提出单位'),
        technicalCommittee: optionalText('归口单位'),
        replaces: optionalText('被代替的标准编号，首次发布不填'),
        consistency: optionalText(
          '采标情况（采标文件编号和一致性程度），未采标不填',
        ),
        industryName: optionalText('行业名称（行业标准封面用）'),
        regionName: optionalText('地区名称（地方标准封面用）'),
        coverDesignation: optionalText(
          '封面标准称谓的完整覆盖值（仅行业、地方、团体、企业标准使用），一般不需要填',
        ),
      },
      required: ['titleCn', 'standardType'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'get_outline',
    description:
      '读取文档的结构树：前言、引言，以及正文各章、条、附录、表、图、公式的 nodeId、类型、编号、标题。' +
      '返回 { revision, outline }。revision 是之后 apply_operations 的 baseRevision；' +
      '文档里缺少 nodeId 时会先补齐并保存，所以 revision 可能比此前看到的大 1。' +
      '下一步：用 get_node 读取具体节点的内容，或直接用 apply_operations 修改。',
    inputSchema: {
      type: 'object',
      properties: { documentId },
      required: ['documentId'],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'get_node',
    description:
      `读取一个节点或一个容器的内容。nodeId 与 container 必须恰好给一个：nodeId 取自 get_outline（章、条、附录、表、图、公式等）；` +
      `container 是 ${READABLE_CONTAINERS.join('、')} 之一（前言、引言、参考文献的内容与其中节点的 id 只能这样读取）。` +
      '返回 { revision, node } 或 { revision, container }：node 含写作片段形式的内容（ir）、编号、父节点与位置、以及能否原样替换（replaceable）。' +
      '下一步：据此用 apply_operations 在其前后插入、替换或删除。',
    inputSchema: {
      type: 'object',
      properties: {
        documentId,
        nodeId: {
          type: 'string',
          description: '节点 id（取自 get_outline 或其他 get_node 的结果）',
        },
        container: {
          type: 'string',
          enum: [...READABLE_CONTAINERS],
          description: '容器名；与 nodeId 二选一',
        },
      },
      required: ['documentId'],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'apply_operations',
    description:
      '批量修改文档（insert 插入、replace 替换、delete 删除、move 移动）。整批全有或全无：任何一个操作不合法，整批都不写入，并返回带路径和原因的 issues。' +
      'baseRevision 必须是最近一次读取（get_outline、get_node）或写入返回的 revision；与文档当前 revision 不一致时返回 409 和当前 revision，' +
      '说明文档已被修改，请重新读取后再修改。' +
      '成功返回 { revision, operations, problems, warnings, versionId }：revision 供下一次写入使用；operations 逐个列出写入、移除、移动的 nodeId；' +
      'problems 是写入后文档的校验问题（introduced 为 true 的是本批新引入的），不阻止写入，应据此修正；warnings 是写入时的提示。' +
      '修改直接生效，并在版本历史中记为「AI 修改」，人可以在编辑器中查看并回滚。写入内容的格式见 get_authoring_reference。',
    inputSchema: {
      type: 'object',
      properties: {
        documentId,
        baseRevision: {
          type: 'integer',
          minimum: 0,
          description: '最近一次读取或写入返回的 revision',
        },
        operations: {
          type: 'array',
          minItems: 1,
          items: operationSchema,
          description: '按顺序执行的操作数组（单个操作也要放进数组）',
        },
        note: {
          type: 'string',
          maxLength: MAX_NOTE_LENGTH,
          description:
            '版本记录里的修改说明（可选）；缺省时按操作自动生成，如「AI 修改：插入 2 处」',
        },
      },
      required: ['documentId', 'baseRevision', 'operations'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'validate_document',
    description:
      '检查文档，不修改任何内容。返回 { revision, problems, exports }。' +
      'problems 是文档的结构问题（悬空引用、标题跳级、空章节、脚注问题等），每项有 code、severity（error / warning）、nodeId、message；' +
      '来源与 apply_operations 返回的 problems 相同，只是没有 introduced 字段（这里没有「本批操作」可供对比）。' +
      'exports 是 docx、pdf、html 各自的导出前检查，与 export_document 在导出前做的检查完全相同：通过为 { ok: true }；' +
      '未通过为 { ok: false, source, message, problems }，source 是 footnote（脚注校验）或 output-boundary（该格式无法无损输出的内容），' +
      'message 与导出失败时（422）的 message 相同，problems 逐项列出原因和位置；未通过的格式 export_document 会失败。' +
      'pdf 额外带 available：服务端的 PDF 管线是否可用，false 时导出 pdf 会返回 503 并列出缺少的依赖（检查通过而管线不可用，pdf 仍是 ok: true）。' +
      'json 导出不做导出前检查，不在其中。' +
      '文档内容为空或不符合编辑器文档结构时，整个工具返回错误（422，带 problems）。' +
      '如果 problems 里出现 missing-id（节点还没有 nodeId，常见于只在首页新建、从未在编辑器里打开过的文档），先调用 get_outline 补齐后再校验。' +
      '下一步：按 problems 用 apply_operations 修正；exports 全部 ok 后用 export_document 出件。',
    inputSchema: {
      type: 'object',
      properties: { documentId },
      required: ['documentId'],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'export_document',
    description:
      '把文档导出为 docx、pdf、html 或 json，与编辑器及导出接口走同一条路径（同样会先做导出前检查）。文件内容不会放进结果。' +
      '返回 { format, filename, size, warnings, downloadUrl, savedTo? }：filename 是建议的文件名，size 是字节数，' +
      'warnings 是导出告警（如外部图片不会被抓取而留空，每项有 code、message，可能有 nodeId），downloadUrl 是本机上的下载地址，用户可以在浏览器中打开。' +
      '不给 outputPath 时只返回 downloadUrl，不写任何文件。用户要得到文件时，把 outputPath 设为用户工作目录下的绝对路径（含文件名；扩展名必须与 format 对应；' +
      '父目录必须已存在，不会自动创建），成功时 savedTo 是最终的绝对路径。' +
      '目标文件已存在时默认失败（409，code 为 file-exists）；只有用户明确同意替换时才把 overwrite 设为 true，原文件会被替换且无法恢复。' +
      '写入本机文件可能被服务端禁用（403，code 为 file-write-disabled），此时去掉 outputPath，把 downloadUrl 交给用户。' +
      '导出前检查未通过时返回 422，先用 validate_document 查看原因并修正；pdf 的管线缺少依赖时返回 503，消息列出缺少的依赖，可改导出别的格式。',
    inputSchema: {
      type: 'object',
      properties: {
        documentId,
        format: {
          type: 'string',
          enum: [...EXPORT_FORMATS],
          description:
            'docx（Word 文档）、pdf（版式预览）、html（语义 HTML）、json（语义 JSON）',
        },
        outputPath: {
          type: 'string',
          description:
            '可选：把文件写到本机的这个绝对路径（含文件名，扩展名与 format 一致，父目录须已存在）；不给则只返回 downloadUrl',
        },
        overwrite: {
          type: 'boolean',
          description:
            '仅与 outputPath 一起使用：目标已存在时是否替换；默认 false（已存在则失败）',
        },
      },
      required: ['documentId', 'format'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_authoring_reference',
    description:
      '返回写作说明全文（Markdown）：向文档插入或替换内容时使用的「写作片段」格式、各节点的写法、插入位置的上下文规则、问题代码，以及 GB/T 1.1 写作约定。' +
      '首次使用 SES 或准备调用 apply_operations 之前先读一遍；内容固定不变，同一会话里读一次即可。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: readOnly,
  },
];
