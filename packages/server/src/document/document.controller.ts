import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import { DocumentEntity } from './document.entity';
import {
  parseEmptyTrashRequest,
  parsePermanentDeleteRequest,
} from './trash-request';

function requirePositiveId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BadRequestException('文档 id 必须是正整数');
  }
  return id;
}
import {
  parseDocumentMeta,
  parseDocumentUpdateRequest,
} from './document-update';

@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Get()
  findAll(): Promise<DocumentEntity[]> {
    return this.documentService.findAll();
  }

  /** GET /api/documents/trash。必须在 `:id` 路由之前声明。 */
  @Get('trash')
  findTrash() {
    return this.documentService.findTrash();
  }

  /** POST /api/documents/trash/empty：只清理请求中携带的确认快照。 */
  @Post('trash/empty')
  @HttpCode(HttpStatus.OK)
  async emptyTrash(@Body() body: unknown): Promise<void> {
    await this.documentService.emptyTrash(parseEmptyTrashRequest(body));
  }

  /** POST /api/documents/:id/restore：恢复同一文档并递增 revision。 */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(@Param('id', ParseIntPipe) id: number): Promise<DocumentEntity> {
    return this.documentService.restore(requirePositiveId(id));
  }

  /** DELETE /api/documents/:id/permanent：必须携带当前回收站条目的 baseRevision。 */
  @Delete(':id/permanent')
  permanentDelete(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<void> {
    return this.documentService.permanentDelete(
      requirePositiveId(id),
      parsePermanentDeleteRequest(body),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<DocumentEntity> {
    return this.documentService.findOne(id);
  }

  /** POST /api/documents。meta 的字段类型与 PUT 同样校验（不合法 400），其余字段沿用原行为。 */
  @Post()
  create(@Body() data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    if (data?.meta !== undefined) parseDocumentMeta(data.meta);
    return this.documentService.create(data);
  }

  /**
   * PUT /api/documents/:id
   * 请求体必须带 baseRevision：缺失 428、类型错误 400、与当前 revision 不一致 409。
   * 成功后发布变更事件（来源 human：此接口是编辑器自动保存的入口）。
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<DocumentEntity> {
    const { baseRevision, fields } = parseDocumentUpdateRequest(body);
    return this.documentService.update(id, baseRevision, fields, {
      source: 'human',
    });
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.documentService.remove(id);
  }
}
