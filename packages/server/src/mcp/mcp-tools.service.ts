import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DocumentStage } from '@ses/shared';
import { createNewDocument, type NewDocForm } from '@client/new-document';
import authoringReference from '@docs/authoring-reference';
import { DocumentOpsService } from '../document-ops/document-ops.service';
import { parseDocumentOperationsRequest } from '../document-ops/operations-request';
import { DocumentService } from '../document/document.service';
import { normalizeContent } from '../editor-schema/editor-schema';
import { normalizeClientName } from './mcp-client-name';
import { DEFAULT_EDITOR_BASE_URL } from './mcp.constants';
import { errorResult, jsonResult, toErrorBody } from './mcp-errors';
import {
  DOCUMENT_STAGES,
  STANDARD_TYPES,
  TOOL_NAMES,
  type McpToolName,
} from './mcp-tool-definitions';
import {
  assertOnlyKeys,
  optionalEnum,
  optionalNonEmptyString,
  optionalString,
  parseDocumentId,
  requiredEnum,
  requiredNonEmptyString,
  type ToolArgs,
} from './mcp-tool-args';

/** 一次工具调用的会话上下文。 */
export interface McpToolContext {
  /** 本会话 `initialize` 时客户端自报的 `clientInfo.name`（尚未初始化时为 undefined）。 */
  clientName: string | undefined;
}

type ToolHandler = (
  args: ToolArgs,
  context: McpToolContext,
) => Promise<CallToolResult>;

/** `create_document` 中可选的文本参数，与编辑器「新建文档」表单的同名字段一一对应；缺省为空串（与表单初始值一致）。 */
const CREATE_OPTIONAL_TEXT_FIELDS = [
  'titleEn',
  'stdPrefix',
  'stdNo',
  'icsCode',
  'ccsCode',
  'issuer',
  'applicant',
  'proposer',
  'technicalCommittee',
  'replaces',
  'consistency',
  'industryName',
  'regionName',
  'coverDesignation',
] as const;

/** 编辑器的地址：环境变量为空白时按未设置处理，去掉末尾的斜杠。 */
function editorBaseUrl(): string {
  const configured = process.env.SES_EDITOR_BASE_URL?.trim();
  return (configured || DEFAULT_EDITOR_BASE_URL).replace(/\/+$/, '');
}

/**
 * MCP 工具的实现。每个工具只做三件事：校验参数、调用现有服务（与 REST 接口同一条路径，
 * 校验、乐观锁、事务、版本记录、变更事件都不绕开）、把结果包装成 MCP 工具结果。
 */
@Injectable()
export class McpToolsService {
  private readonly logger = new Logger(McpToolsService.name);

  private readonly handlers: Record<McpToolName, ToolHandler> = {
    list_documents: (args) => this.listDocuments(args),
    create_document: (args) => this.createDocument(args),
    get_outline: (args) => this.getOutline(args),
    get_node: (args) => this.getNode(args),
    apply_operations: (args, context) => this.applyOperations(args, context),
    get_authoring_reference: (args) => this.getAuthoringReference(args),
  };

  constructor(
    private readonly documents: DocumentService,
    private readonly ops: DocumentOpsService,
  ) {}

  /**
   * 执行一次 tools/call。所有失败（未知工具、参数错误、业务错误、意外异常）都以 `isError: true` 的
   * 结果返回，不抛协议级错误，模型据正文即可自行改正。未知工具与 SDK 的 McpServer 一致，也是 `isError` 结果。
   *
   * 日志只记录工具名与错误类型：参数、文档内容、操作内容都不进日志。
   */
  async call(
    name: string,
    rawArgs: unknown,
    context: McpToolContext,
  ): Promise<CallToolResult> {
    if (!(TOOL_NAMES as readonly string[]).includes(name)) {
      return errorResult({
        status: 404,
        code: 'tool-not-found',
        message: `未知工具「${name.slice(0, 40)}」（可用：${TOOL_NAMES.join('、')}）`,
      });
    }
    try {
      const args =
        typeof rawArgs === 'object' && rawArgs !== null
          ? (rawArgs as ToolArgs)
          : {};
      return await this.handlers[name as McpToolName](args, context);
    } catch (error) {
      const body = toErrorBody(error);
      if (body.status >= 500) {
        const type =
          error instanceof Error ? error.constructor.name : typeof error;
        this.logger.error(`工具 ${name} 执行失败（${type}）`);
      }
      return errorResult(body);
    }
  }

  private async listDocuments(args: ToolArgs): Promise<CallToolResult> {
    assertOnlyKeys(args, []);
    const summaries = await this.documents.findSummaries();
    return jsonResult({
      documents: summaries.map((doc) => ({
        id: doc.id,
        title: doc.title,
        stage: doc.stage,
        revision: doc.revision,
        updatedAt: doc.updatedAt.toISOString(),
      })),
    });
  }

  /**
   * 新建文档：参数填入编辑器「新建文档」表单的同一个数据结构，交给 client 的 `createNewDocument`
   * （别名 `@client/new-document`）生成标题、元数据和初始正文，所以标题、阶段、元数据与编辑器首页新建的文档完全一致。
   *
   * 正文要先经 `normalizeContent`（与读写前补齐 nodeId 是同一套规范化）再保存：`createNewDocument`
   * 产出的节点没有 nodeId（编辑器打开文档时才补并保存）。如果原样保存，第一次 get_outline / apply_operations
   * 会先补齐 nodeId 并把 revision 从 0 改成 1，AI 按 create_document 返回的 revision 0 写入就必然 409。
   * 规范化之后，新文档在 revision 0 就已经规范，后续读取不再写库。
   */
  private async createDocument(args: ToolArgs): Promise<CallToolResult> {
    assertOnlyKeys(args, [
      'titleCn',
      'standardType',
      'stage',
      ...CREATE_OPTIONAL_TEXT_FIELDS,
    ]);
    const titleCn = requiredNonEmptyString(args, 'titleCn', '标准的中文名称');
    const type = requiredEnum(args, 'standardType', STANDARD_TYPES);
    const stage =
      optionalEnum(args, 'stage', DOCUMENT_STAGES) ??
      DocumentStage.WORKING_DRAFT;
    const text = Object.fromEntries(
      CREATE_OPTIONAL_TEXT_FIELDS.map((key) => [
        key,
        optionalString(args, key) ?? '',
      ]),
    ) as Record<(typeof CREATE_OPTIONAL_TEXT_FIELDS)[number], string>;
    const form: NewDocForm = { type, stage, titleCn, ...text };

    const draft = createNewDocument(form);
    const created = await this.documents.create({
      ...draft,
      content: normalizeContent(draft.content) as unknown as Record<
        string,
        unknown
      >,
    });
    return jsonResult({
      documentId: created.id,
      revision: created.revision,
      title: created.title,
      editorUrl: `${editorBaseUrl()}/editor/${created.id}`,
    });
  }

  private async getOutline(args: ToolArgs): Promise<CallToolResult> {
    assertOnlyKeys(args, ['documentId']);
    return jsonResult(await this.ops.outline(parseDocumentId(args.documentId)));
  }

  private async getNode(args: ToolArgs): Promise<CallToolResult> {
    assertOnlyKeys(args, ['documentId', 'nodeId', 'container']);
    const documentId = parseDocumentId(args.documentId);
    const nodeId = optionalNonEmptyString(args, 'nodeId', '节点 id');
    const container = optionalNonEmptyString(args, 'container', '容器名');
    if ((nodeId === undefined) === (container === undefined)) {
      throw new BadRequestException(
        'nodeId 与 container 必须恰好给出一个：读取节点用 nodeId，读取前言、引言或参考文献用 container',
      );
    }
    return jsonResult(
      nodeId !== undefined
        ? await this.ops.node(documentId, nodeId)
        : await this.ops.container(documentId, container!),
    );
  }

  /**
   * 批量写入。把参数组装成与 `POST /api/documents/:id/operations` 相同的请求体（来源固定为 ai，
   * client 取本会话的 clientInfo.name），走同一个解析函数与 `DocumentOpsService.apply`。
   */
  private async applyOperations(
    args: ToolArgs,
    context: McpToolContext,
  ): Promise<CallToolResult> {
    assertOnlyKeys(args, ['documentId', 'baseRevision', 'operations', 'note']);
    const documentId = parseDocumentId(args.documentId);
    const request = parseDocumentOperationsRequest({
      baseRevision: args.baseRevision,
      operations: args.operations,
      source: 'ai',
      client: normalizeClientName(context.clientName),
      ...(args.note === undefined ? {} : { note: args.note }),
    });
    return jsonResult(await this.ops.apply(documentId, request));
  }

  private getAuthoringReference(args: ToolArgs): Promise<CallToolResult> {
    assertOnlyKeys(args, []);
    return Promise.resolve({
      content: [{ type: 'text', text: authoringReference }],
    });
  }
}
