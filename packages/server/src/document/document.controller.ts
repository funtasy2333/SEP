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
import { parseDocumentUpdateRequest } from './document-update';

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

  @Post()
  create(@Body() data: Partial<DocumentEntity>): Promise<DocumentEntity> {
    return this.documentService.create(data);
  }

  /**
   * PUT /api/documents/:id
   * 请求体必须带 baseRevision：缺失 428、类型错误 400、与当前 revision 不一致 409。
   */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<DocumentEntity> {
    const { baseRevision, fields } = parseDocumentUpdateRequest(body);
    return this.documentService.update(id, baseRevision, fields);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.documentService.remove(id);
  }
}
