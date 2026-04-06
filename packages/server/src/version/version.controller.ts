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

  @Get('document/:documentId')
  findByDocument(
    @Param('documentId', ParseIntPipe) documentId: number,
  ): Promise<VersionEntity[]> {
    return this.versionService.findByDocument(documentId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<VersionEntity> {
    return this.versionService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<VersionEntity>): Promise<VersionEntity> {
    return this.versionService.create(data);
  }
}
