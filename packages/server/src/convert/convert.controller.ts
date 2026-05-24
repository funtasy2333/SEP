import {
  BadRequestException,
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
  StreamableFile,
  Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConvertService } from './convert.service';

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
