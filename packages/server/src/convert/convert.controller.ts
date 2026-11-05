import { Controller, Get } from '@nestjs/common';
import { ConvertService, type ConvertCapabilities } from './convert.service';

/**
 * 只提供出件能力探测。PDF 导出统一走 GET /api/documents/:id/export/pdf（ExportService.exportPdf，
 * 在服务端用库里的文档构建 print HTML 并屏蔽外部图片）；不再接受调用方自带 HTML 的转换接口，
 * 否则任何能访问本服务的页面都可以让无头浏览器按任意 HTML 发请求。
 */
@Controller('convert')
export class ConvertController {
  constructor(private readonly convertService: ConvertService) {}

  /**
   * GET /api/convert/capabilities
   * 返回 Vivliostyle PDF 出件能力，供前端显隐导出卡片。
   */
  @Get('capabilities')
  getCapabilities(): ConvertCapabilities {
    return this.convertService.getCapabilities();
  }
}
