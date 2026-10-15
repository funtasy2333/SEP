import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import type { DocumentOutline, ReadContainerInfo, ReadNodeInfo } from '@ses/io';
import {
  DocumentOpsService,
  type OperationsResult,
} from './document-ops.service';
import { parseDocumentOperationsRequest } from './operations-request';

/**
 * 文档操作层的 REST 接口（设计文档 §6.3）：结构树、读取节点、批量写入。
 * 读接口返回的 `revision` 是 AI 下一次写入应使用的 `baseRevision`。
 *
 * 读接口读取前会补齐缺失或重复的 nodeId 并持久化（revision 加 1，发布 system 事件，不生成版本），
 * 所以返回的 revision 可能比此前通过 GET /documents/:id 看到的大 1；细节见 DocumentOpsService.prepare。
 * 文档内容为空或不符合编辑器生产 schema 时，读写都返回 422（响应体含 problems，与导出接口一致）。
 */
@Controller('documents')
export class DocumentOpsController {
  constructor(private readonly ops: DocumentOpsService) {}

  /** GET /api/documents/:id/outline → `{ revision, outline }`。文档不存在 404。 */
  @Get(':id/outline')
  outline(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ revision: number; outline: DocumentOutline }> {
    return this.ops.outline(id);
  }

  /**
   * GET /api/documents/:id/nodes/:nodeId → `{ revision, node }`。
   * 文档不存在或 nodeId 不存在 404（节点不存在时响应体带 `code: 'node-not-found'`）；
   * nodeId 存在但位于表、列项等内部不能单独寻址、或文档里有重复 id 422（带引擎的 `code`）。
   */
  @Get(':id/nodes/:nodeId')
  node(
    @Param('id', ParseIntPipe) id: number,
    @Param('nodeId') nodeId: string,
  ): Promise<{ revision: number; node: ReadNodeInfo }> {
    return this.ops.node(id, nodeId);
  }

  /**
   * GET /api/documents/:id/containers/:name → `{ revision, container }`。
   * name 只允许 foreword / introduction / bibliography，其他 400；文档不存在 404。
   */
  @Get(':id/containers/:name')
  container(
    @Param('id', ParseIntPipe) id: number,
    @Param('name') name: string,
  ): Promise<{ revision: number; container: ReadContainerInfo }> {
    return this.ops.container(id, name);
  }

  /**
   * POST /api/documents/:id/operations
   * 请求体：`{ baseRevision, operations, source: 'ai' | 'human', client?, note? }`。
   * 成功 200：`{ revision, operations, problems, warnings, versionId? }`；
   * 请求形状错误 400（operations 的问题在 `issues`）、缺 baseRevision 428、revision 不符 409（与 PUT 同一响应体）、
   * 引擎拒绝整批操作 422（`issues`）、文档不存在 404。
   * source 为 ai 时同一事务内生成一条「AI 修改」版本记录（带 baseContent），human 不生成。
   * 用 200 而不是 201：这是对既有文档的修改，响应里的 versionId 只是附带产物。
   */
  @Post(':id/operations')
  @HttpCode(200)
  apply(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<OperationsResult> {
    return this.ops.apply(id, parseDocumentOperationsRequest(body));
  }
}
