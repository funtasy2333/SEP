import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Logger,
  StreamableFile,
  Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConvertService } from './convert.service';

@Controller('convert')
export class ConvertController {
  private readonly logger = new Logger(ConvertController.name);

  constructor(private readonly convertService: ConvertService) {}

  /**
   * POST /api/convert/docx-to-pdf
   * 接收 DOCX 文件，通过 Word COM 自动化转换为 PDF 后返回。
   */
  @Post('docx-to-pdf')
  @UseInterceptors(FileInterceptor('file'))
  @Header('Content-Type', 'application/pdf')
  async docxToPdf(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<StreamableFile> {
    if (!file) {
      throw new HttpException('未上传文件', HttpStatus.BAD_REQUEST);
    }

    if (
      file.mimetype !==
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      !file.originalname.endsWith('.docx')
    ) {
      throw new HttpException(
        '仅支持 .docx 格式文件',
        HttpStatus.BAD_REQUEST,
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
