import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  attachmentDisposition,
  buildWarningHeaders,
} from '../export/export-http';
import { parseBaseRevision } from '../document/document-update';
import { parseSesPackage, SES_PACKAGE_MIME } from './ses-package-format';
import { SesPackageService } from './ses-package.service';

function parseIntegerQuery(
  query: Record<string, unknown>,
  name: string,
  allowZero: boolean,
): number | undefined {
  const raw = query[name];
  if (raw === undefined) return undefined;
  if (
    typeof raw !== 'string' ||
    !/^(0|[1-9]\d*)$/.test(raw) ||
    (!allowZero && raw === '0')
  ) {
    throw new BadRequestException(
      `${name} 必须是${allowZero ? '非负' : '正'}整数`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(
      `${name} 必须是${allowZero ? '非负' : '正'}整数`,
    );
  }
  return value;
}

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

  /** POST /api/documents/import/ses：预览、新建或更新导入。 */
  @Post('import/ses')
  @HttpCode(HttpStatus.OK)
  async importPackage(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const contentType = req.headers['content-type'];
    const mediaType =
      typeof contentType === 'string'
        ? contentType.split(';', 1)[0].trim().toLowerCase()
        : undefined;
    if (mediaType !== SES_PACKAGE_MIME) {
      throw new UnsupportedMediaTypeException(
        `Content-Type 必须是 ${SES_PACKAGE_MIME}`,
      );
    }
    const mode = query.mode;
    if (
      typeof mode !== 'string' ||
      !['preview', 'new', 'update'].includes(mode)
    ) {
      throw new BadRequestException('mode 必须是 preview / new / update');
    }

    const targetId = parseIntegerQuery(query, 'targetId', false);
    const baseRevisionValue = parseIntegerQuery(query, 'baseRevision', true);
    const baseRevision =
      mode === 'update'
        ? parseBaseRevision(baseRevisionValue)
        : (baseRevisionValue ?? 0);

    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('SES 文档包请求体必须是原始字节');
    }
    const pkg = parseSesPackage(req.body);

    if (mode === 'preview') {
      res.status(HttpStatus.OK);
      return this.sesPackageService.previewImport(pkg);
    }
    if (mode === 'new') {
      res.status(HttpStatus.CREATED);
      return this.sesPackageService.importAsNew(pkg);
    }
    if (targetId === undefined) {
      throw new BadRequestException('update 模式必须提供正整数 targetId');
    }
    res.status(HttpStatus.OK);
    return this.sesPackageService.importUpdate(pkg, targetId, baseRevision);
  }
}
