import {
  Body,
  Controller,
  Get,
  Post,
  HttpException,
  HttpStatus,
  Logger,
  StreamableFile,
  ValidationPipe,
} from '@nestjs/common';
import { ConvertService, type ConvertCapabilities } from './convert.service';
import { HtmlToPdfDto } from './dto/html-to-pdf.dto';

@Controller('convert')
export class ConvertController {
  private readonly logger = new Logger(ConvertController.name);

  constructor(private readonly convertService: ConvertService) {}

  /**
   * GET /api/convert/capabilities
   * 返回 Vivliostyle PDF 出件能力，供前端显隐导出卡片。
   */
  @Get('capabilities')
  getCapabilities(): ConvertCapabilities {
    return this.convertService.getCapabilities();
  }

  /**
   * POST /api/convert/html-to-pdf
   * 接收 print 变体 HTML + 目次目标，两遍 vivliostyle 构建产出 GB/T 1.1 版式 PDF。
   */
  @Post('html-to-pdf')
  async htmlToPdf(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: HtmlToPdfDto,
  ): Promise<StreamableFile> {
    this.logger.log(
      `收到 HTML 转 PDF 请求: ${dto.toc.length} 个目次目标, HTML ${dto.html.length} 字符`,
    );

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await this.convertService.convertHtmlToPdf({
        html: dto.html,
        toc: dto.toc,
        docTitle: dto.docTitle ?? '',
      });
    } catch (error) {
      this.logger.error('HTML 转 PDF 失败', error as Error);
      throw new HttpException(
        `转换失败: ${(error as Error).message || error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const baseName = (dto.filename || '标准文件').replace(/\.pdf$/i, '');
    const pdfFilename = `${baseName}.pdf`;
    return new StreamableFile(pdfBuffer, {
      type: 'application/pdf',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(pdfFilename)}`,
      length: pdfBuffer.length,
    });
  }
}
