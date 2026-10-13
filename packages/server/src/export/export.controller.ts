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
import { ExportService, type TextExportResult } from './export.service';

const PDF_MIME_TYPE = 'application/pdf';
const HTML_MIME_TYPE = 'text/html; charset=utf-8';
const JSON_MIME_TYPE = 'application/json; charset=utf-8';

function textFile(result: TextExportResult, type: string): StreamableFile {
  const bytes = Buffer.from(result.content, 'utf8');
  return new StreamableFile(bytes, {
    type,
    disposition: attachmentDisposition(result.filename),
    length: bytes.length,
  });
}

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

  /**
   * GET /api/documents/:id/export/pdf
   * 导出库中该文档的 PDF（与编辑器导出等价，见 ExportService.exportPdf）：封面同步 → 导出前检查 →
   * print HTML 与目次目标 → 现有 IR→HTML→PDF 两遍构建管线。
   * 文档不存在 404；内容为空或导出前检查未通过 422（响应体同 DOCX 接口）；
   * 管线缺依赖（/api/convert/capabilities 的 htmlToPdf 为 false）503，响应体列出缺少的依赖。
   * 与 DOCX 一致，服务端不抓取外部图片：非 data URL 的图片留空并记入 X-SES-Export-Warning* 响应头。
   */
  @Get(':id/export/pdf')
  async exportPdf(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.exportService.exportPdf(id);
    res.set(buildWarningHeaders(result.warnings));
    return new StreamableFile(result.bytes, {
      type: PDF_MIME_TYPE,
      disposition: attachmentDisposition(result.filename),
      length: result.bytes.length,
    });
  }

  /**
   * GET /api/documents/:id/export/html
   * 导出库中该文档的语义 HTML（与编辑器 HTML 导出等价）。404、422 约定同 DOCX 接口。
   */
  @Get(':id/export/html')
  async exportHtml(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    return textFile(await this.exportService.exportHtml(id), HTML_MIME_TYPE);
  }

  /**
   * GET /api/documents/:id/export/json
   * 导出库中该文档的语义 JSON（与编辑器 JSON 导出等价，两空格缩进）。
   * 与编辑器一致不做导出前检查；404、内容为空 422 约定同 DOCX 接口。
   */
  @Get(':id/export/json')
  async exportJson(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    return textFile(await this.exportService.exportJson(id), JSON_MIME_TYPE);
  }
}
