import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { DOCX_MIME_TYPE } from '@ses/io';
import type { Response } from 'express';
import {
  attachmentDisposition,
  buildWarningHeaders,
  parseCreatedAt,
} from './export-http';
import { ExportService } from './export.service';

@Controller('documents')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  /**
   * GET /api/documents/:id/export/docx[?createdAt=<ISO 8601>]
   * 导出库中该文档的 DOCX（与编辑器导出等价，见 ExportService.exportDocx）。
   * 文档不存在 404；内容为空、脚注校验或输出边界未通过 422（响应体含 message、detail、problems）；
   * createdAt 非法 400。导出告警不混进文件，见 X-SES-Export-Warning* 响应头。
   */
  @Get(':id/export/docx')
  async exportDocx(
    @Param('id', ParseIntPipe) id: number,
    @Query('createdAt') createdAt: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const createdAtValue = parseCreatedAt(createdAt);
    const result = await this.exportService.exportDocx(id, createdAtValue);
    res.set(buildWarningHeaders(result.warnings));
    return new StreamableFile(result.bytes, {
      type: DOCX_MIME_TYPE,
      disposition: attachmentDisposition(result.filename),
      length: result.bytes.length,
    });
  }
}
