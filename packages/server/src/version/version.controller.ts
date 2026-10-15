import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { VersionService } from './version.service';
import { VersionEntity } from './version.entity';

@Controller('versions')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  /** 版本列表（最新在前），不含 baseContent；需要写入前内容请读取单个版本。 */
  @Get('document/:documentId')
  findByDocument(
    @Param('documentId', ParseIntPipe) documentId: number,
  ): Promise<VersionEntity[]> {
    return this.versionService.findByDocument(documentId);
  }

  /** 单个版本详情，含 baseContent（AI 写入的版本才有，其余为 null）。 */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<VersionEntity> {
    return this.versionService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<VersionEntity>): Promise<VersionEntity> {
    return this.versionService.create(data);
  }
}
