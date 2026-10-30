import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  attachmentDisposition,
  buildWarningHeaders,
} from '../export/export-http';
import { SES_PACKAGE_MIME } from './ses-package-format';
import { SesPackageService } from './ses-package.service';

@Controller('documents')
export class SesPackageController {
  constructor(private readonly sesPackageService: SesPackageService) {}

  /** GET /api/documents/:id/export/ses：下载完整 SES 文档包。 */
  @Get(':id/export/ses')
  async exportPackage(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.sesPackageService.exportPackage(id);
    res.set(buildWarningHeaders(result.warnings));
    return new StreamableFile(result.bytes, {
      type: SES_PACKAGE_MIME,
      disposition: attachmentDisposition(result.filename),
      length: result.bytes.length,
    });
  }
}
