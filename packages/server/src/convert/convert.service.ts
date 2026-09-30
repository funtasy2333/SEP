import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  runHtmlToPdfPipeline,
  type HtmlToPdfInput,
} from './pdf/pipeline';
import { isPopplerAvailable, isVivliostyleAvailable } from './pdf/build';

/** 出件能力探测结果，供客户端导出面板按可用性显隐卡片。 */
export interface ConvertCapabilities {
  /** IR→HTML→PDF（vivliostyle）管线是否可用：需 vivliostyle CLI + poppler */
  htmlToPdf: boolean;
}

@Injectable()
export class ConvertService implements OnModuleInit {
  private readonly logger = new Logger(ConvertService.name);
  private htmlPdfReady = false;

  async onModuleInit() {
    await this.detectHtmlPdfToolchain();
  }

  /** 探测 IR→HTML→PDF 管线工具链（vivliostyle CLI + poppler）。 */
  private async detectHtmlPdfToolchain(): Promise<void> {
    const viv = isVivliostyleAvailable();
    const poppler = await isPopplerAvailable();
    this.htmlPdfReady = viv && poppler;
    if (!this.htmlPdfReady) {
      const missing = [
        !viv ? '@vivliostyle/cli' : null,
        !poppler ? 'poppler(pdftotext/pdfinfo)' : null,
      ]
        .filter(Boolean)
        .join('、');
      this.logger.warn(
        `IR→HTML→PDF 管线不可用，缺少：${missing}。` +
          (!poppler
            ? '请安装 poppler（macOS: brew install poppler）。'
            : ''),
      );
    } else {
      this.logger.log('IR→HTML→PDF 管线就绪（vivliostyle + poppler）');
    }
  }

  /** 当前出件能力（客户端据此显隐导出卡片）。 */
  getCapabilities(): ConvertCapabilities {
    return { htmlToPdf: this.htmlPdfReady };
  }

  /**
   * IR→HTML→PDF：两遍 vivliostyle 构建（KaTeX 预渲染 + 目次页码注入）。
   * @returns 最终 PDF 的 Buffer
   */
  async convertHtmlToPdf(input: HtmlToPdfInput): Promise<Buffer> {
    if (!this.htmlPdfReady) {
      throw new Error(
        'IR→HTML→PDF 管线不可用：请确认已安装 @vivliostyle/cli 与 poppler。',
      );
    }
    const result = await runHtmlToPdfPipeline(input, this.logger);
    this.logger.log(
      `IR→HTML→PDF 成功：${result.pageCount} 页，PDF ${result.pdf.length} bytes` +
        (result.formulaFailures > 0
          ? `（${result.formulaFailures} 个公式降级）`
          : ''),
    );
    return result.pdf;
  }
}
