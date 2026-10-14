import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ExportGuardFailure } from '@ses/io';
import { DocumentStage } from '@ses/shared';
import { createNewDocument, type NewDocForm } from '@client/new-document';
import authoringReference from '@docs/authoring-reference';
import { DocumentOpsService } from '../document-ops/document-ops.service';
import { parseDocumentOperationsRequest } from '../document-ops/operations-request';
import { DocumentService } from '../document/document.service';
import { normalizeContent } from '../editor-schema/editor-schema';
import type { ExportWarning } from '../export/export-http';
import { ExportService } from '../export/export.service';
import { isAllowedHost } from './mcp-access';
import { normalizeClientName } from './mcp-client-name';
import { DEFAULT_EDITOR_BASE_URL } from './mcp.constants';
import { errorResult, jsonResult, toErrorBody } from './mcp-errors';
import { prepareOutputTarget, writeOutputFile } from './mcp-file-output';
import {
  DOCUMENT_STAGES,
  EXPORT_FORMATS,
  STANDARD_TYPES,
  TOOL_NAMES,
  type ExportFormat,
  type McpToolName,
} from './mcp-tool-definitions';
import {
  assertOnlyKeys,
  optionalBoolean,
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
  /**
   * 本次调用所在 HTTP 请求的 Host 头（含端口）。请求已经过访问守卫，正常只可能是
   * localhost / 127.0.0.1 / [::1] 加端口；取不到时为 undefined。工具服务只拿到这个字符串，不接触 express 请求。
   */
  host: string | undefined;
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

/**
 * 导出文件的下载地址的前缀：`http://<本次请求的 Host>`，这样 AI 给用户的链接和 AI 自己连上来用的地址一致
 * （localhost、127.0.0.1、[::1] 三种写法，用户机器上都能打开）。Host 取不到、或不是访问守卫允许的值
 * （直接调用工具服务而没经过守卫时）则退回 `http://localhost:${PORT ?? 3000}`，与 main.ts 的监听端口一致。
 */
export function downloadBaseUrl(host: string | undefined): string {
  if (host !== undefined && isAllowedHost(host)) return `http://${host}`;
  return `http://localhost:${process.env.PORT?.trim() || 3000}`;
}

/** 导出前检查的结论 → validate_document 返回的形状。 */
function exportCheckResult(
  failure: ExportGuardFailure | null,
):
  | { ok: true }
  | { ok: false; source: string; message: string; problems: unknown[] } {
  return failure === null
    ? { ok: true }
    : {
        ok: false,
        source: failure.source,
        message: failure.message,
        problems: failure.problems,
      };
}

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
    validate_document: (args) => this.validateDocument(args),
    export_document: (args, context) => this.exportDocument(args, context),
    get_authoring_reference: (args) => this.getAuthoringReference(args),
  };

  constructor(
    private readonly documents: DocumentService,
    private readonly ops: DocumentOpsService,
    private readonly exportService: ExportService,
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
      // toErrorBody 已把非 503 的 5xx 统一成 500；503（PDF 管线缺依赖）是预期的状况，不当作内部错误记日志。
      if (body.status === 500) {
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

  /**
   * 校验文档（只读）。检查逻辑全部在 `ExportService.validateForExport`：它与各导出接口共用同一个读取与检查方法，
   * 所以这里的 exports 与真正导出时的导出前检查不会分叉。本工具不经过 `DocumentOpsService`（那条路径会补 nodeId 并写库）。
   */
  private async validateDocument(args: ToolArgs): Promise<CallToolResult> {
    assertOnlyKeys(args, ['documentId']);
    const validation = await this.exportService.validateForExport(
      parseDocumentId(args.documentId),
    );
    return jsonResult({
      revision: validation.revision,
      problems: validation.problems,
      exports: {
        docx: exportCheckResult(validation.checks.docx),
        pdf: {
          ...exportCheckResult(validation.checks.pdf),
          available: validation.pdfAvailable,
        },
        html: exportCheckResult(validation.checks.html),
      },
    });
  }

  /**
   * 出件。调用与 REST 导出接口相同的 `ExportService.export*`（含导出前检查），不重复实现任何导出逻辑；
   * 文件内容不进入工具结果：只有下载地址，以及（给了 outputPath 时）写到本机的文件。
   *
   * 顺序：先校验参数与 outputPath（开关、绝对路径、扩展名、父目录、已存在），再导出，最后写文件——
   * 路径不对时不会白白跑一遍 PDF 管线。写文件的约束见 mcp-file-output.ts。
   * 日志只记录文档 id、格式、字节数与错误码，不记录路径。
   */
  private async exportDocument(
    args: ToolArgs,
    context: McpToolContext,
  ): Promise<CallToolResult> {
    assertOnlyKeys(args, ['documentId', 'format', 'outputPath', 'overwrite']);
    const documentId = parseDocumentId(args.documentId);
    const format = requiredEnum(args, 'format', EXPORT_FORMATS);
    const outputPath = optionalNonEmptyString(
      args,
      'outputPath',
      '本机上的绝对路径',
    );
    const overwrite = optionalBoolean(args, 'overwrite') ?? false;

    const target =
      outputPath === undefined
        ? undefined
        : await prepareOutputTarget(outputPath, format, overwrite);
    const exported = await this.runExport(documentId, format);

    if (target !== undefined) {
      try {
        await writeOutputFile(target, exported.bytes, overwrite);
      } catch (error) {
        // 错误消息里有路径，不进日志：只记错误码。
        const code =
          error instanceof HttpException
            ? (error.getResponse() as { code?: unknown }).code
            : undefined;
        this.logger.warn(
          `文档 #${documentId} 的 ${format} 导出文件写入本机失败（${typeof code === 'string' ? code : '未知'}）`,
        );
        throw error;
      }
      this.logger.log(
        `文档 #${documentId} 的 ${format} 导出文件已写入本机（${exported.bytes.length} 字节）`,
      );
    }
    return jsonResult({
      format,
      filename: exported.filename,
      size: exported.bytes.length,
      warnings: exported.warnings,
      downloadUrl: `${downloadBaseUrl(context.host)}/api/documents/${documentId}/export/${format}`,
      ...(target === undefined ? {} : { savedTo: target }),
    });
  }

  /** 按格式调用对应的 ExportService 方法（REST 导出接口调用的同一批），统一成字节与告警。 */
  private async runExport(
    documentId: number,
    format: ExportFormat,
  ): Promise<{
    bytes: Uint8Array;
    warnings: ExportWarning[];
    filename: string;
  }> {
    switch (format) {
      case 'docx': {
        const { bytes, warnings, filename } =
          await this.exportService.exportDocx(documentId);
        return { bytes, warnings, filename };
      }
      case 'pdf': {
        const { bytes, warnings, filename } =
          await this.exportService.exportPdf(documentId);
        return { bytes, warnings, filename };
      }
      case 'html': {
        const { content, filename } =
          await this.exportService.exportHtml(documentId);
        return { bytes: Buffer.from(content, 'utf8'), warnings: [], filename };
      }
      case 'json': {
        const { content, filename } =
          await this.exportService.exportJson(documentId);
        return { bytes: Buffer.from(content, 'utf8'), warnings: [], filename };
      }
    }
  }

  private getAuthoringReference(args: ToolArgs): Promise<CallToolResult> {
    assertOnlyKeys(args, []);
    return Promise.resolve({
      content: [{ type: 'text', text: authoringReference }],
    });
  }
}
