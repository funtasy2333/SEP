import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import { DocumentEntity } from './document.entity';
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
