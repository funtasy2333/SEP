import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
  StreamableFile,
  Header,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConvertService, type ConvertCapabilities } from './convert.service';
import { HtmlToPdfDto } from './dto/html-to-pdf.dto';

const MAX_DOCX_FILE_SIZE = 10 * 1024 * 1024;

type UploadedDocxFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Controller('convert')
export class ConvertController {
  private readonly logger = new Logger(ConvertController.name);

  constructor(private readonly convertService: ConvertService) {}

  /**
   * GET /api/convert/capabilities
   * 返回出件能力（vivliostyle 管线 / LibreOffice 高保真路径），供前端显隐导出卡片。
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

  /**
   * POST /api/convert/docx-to-pdf
   * 接收 DOCX 文件，通过 Word COM 自动化转换为 PDF 后返回。
  */
  @Post('docx-to-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_DOCX_FILE_SIZE,
      },
    }),
  )
  @Header('Content-Type', 'application/pdf')
  async docxToPdf(
    @UploadedFile() file: UploadedDocxFile,
  ): Promise<StreamableFile> {
    if (!file) {
      throw new HttpException('未上传文件', HttpStatus.BAD_REQUEST);
    }

    if (
      file.mimetype !==
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      !file.originalname.endsWith('.docx')
    ) {
      throw new BadRequestException('仅支持 .docx 格式文件');
    }

    if (file.size > MAX_DOCX_FILE_SIZE) {
      throw new PayloadTooLargeException(
        `文件大小不能超过 ${MAX_DOCX_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }

    this.logger.log(
      `收到 DOCX 转 PDF 请求: ${file.originalname} (${file.size} bytes)`,
    );

    try {
      const pdfBuffer = await this.convertService.convertDocxToPdf(
        file.buffer,
        file.originalname,
      );

      const pdfFilename = file.originalname.replace(/\.docx$/i, '.pdf');

      return new StreamableFile(pdfBuffer, {
        type: 'application/pdf',
        disposition: `attachment; filename*=UTF-8''${encodeURIComponent(pdfFilename)}`,
        length: pdfBuffer.length,
      });
    } catch (error) {
      this.logger.error('DOCX 转 PDF 失败', error);
      throw new HttpException(
        `转换失败: ${error.message || error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
